/**
 * The marks every figure carries — contact shadow, faction ring, rank crest and
 * tactical counter — drawn for the whole board at once.
 *
 * Each of those is the same quad for thirty-odd figures, differing only in
 * where it stands, how opaque it is, its tint and which picture it shows. Drawn
 * as a mesh or sprite per figure they cost up to three draw calls a figure (96
 * for a full board); here each kind is one `InstancedMesh` over a texture atlas,
 * so all the marks on the board cost at most four.
 *
 * A figure keeps an empty {@link FigureMark.anchor} in its own hierarchy where
 * the mesh used to be, and moves, scales, rotates and hides that exactly as
 * before. Just before the scene is drawn the layers read every anchor's world
 * matrix and visibility — so the marks follow figures into the tray, through
 * the promotion picker and onto a rescaled table without knowing about any of
 * them.
 */

import * as THREE from "three";

import type { Faction, PieceKind } from "../core/types";
import { rankBadgeTexture, tacticalTokenTexture } from "./rankBadges";
import { factionRingTexture, radialTexture } from "./textures";

/** One figure's entry in a shared layer. */
export interface FigureMark {
  /**
   * Stand-in for the old mesh: parent it in the figure, and its world matrix and
   * its visibility (all the way up the hierarchy) are what get drawn.
   */
  readonly anchor: THREE.Object3D;
  /** Multiplies the picture, in linear working space. */
  readonly color: THREE.Color;
  /** 0 leaves the mark out of the draw entirely. */
  opacity: number;
}

type LayerName = "shadow" | "ring" | "token" | "crest";

interface Atlas {
  texture: THREE.CanvasTexture;
  /** Per cell: u, v of the lower-left corner, then width and height in UV. */
  rects: THREE.Vector4[];
}

interface LayerStyle {
  name: LayerName;
  renderOrder: number;
  depthTest: boolean;
  toneMapped: boolean;
  /** Faces the camera like a sprite, instead of lying in its anchor's plane. */
  billboard: boolean;
}

/** Atlas cell size; every source picture is a 256 px canvas. */
const CELL = 256;
/** Empty border around each cell, so mip levels do not bleed neighbours in. */
const PAD = 8;

const KINDS: PieceKind[] = ["p", "n", "b", "r", "q", "k"];
const FACTIONS: Faction[] = ["w", "b"];
const RING_SHAPES = ["band", "sunburst"] as const;

/** Packs canvases into one texture, `columns` across. */
function buildAtlas(images: CanvasImageSource[], columns: number): Atlas {
  const rows = Math.ceil(images.length / columns);
  const step = CELL + PAD * 2;
  const canvas = document.createElement("canvas");
  canvas.width = columns * step;
  canvas.height = rows * step;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  const rects = images.map((image, index) => {
    const x = (index % columns) * step + PAD;
    const y = Math.floor(index / columns) * step + PAD;
    ctx.drawImage(image, x, y, CELL, CELL);
    // Canvas rows run down, UV rows run up (the texture is flipped on upload).
    return new THREE.Vector4(x / canvas.width, 1 - (y + CELL) / canvas.height, CELL / canvas.width, CELL / canvas.height);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, rects };
}

/** Canvases from throwaway textures: only the pixels are kept. */
function canvasesOf(textures: THREE.CanvasTexture[]): CanvasImageSource[] {
  const images = textures.map((texture) => texture.image as CanvasImageSource);
  for (const texture of textures) texture.dispose();
  return images;
}

function crestCell(kind: PieceKind, faction: Faction): number {
  return FACTIONS.indexOf(faction) * KINDS.length + KINDS.indexOf(kind);
}

/**
 * Instanced quads with a per-instance atlas cell and opacity. A billboard
 * reproduces `THREE.Sprite` with size attenuation: the quad stands at the
 * instance's position, faces the camera and is as wide as the instance's scale.
 */
function installMarkShader(shader: THREE.WebGLProgramParametersWithUniforms, billboard: boolean): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
attribute vec4 markRect;
attribute float markAlpha;
varying float vMarkAlpha;`,
    )
    .replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
vMapUv = markRect.xy + vMapUv * markRect.zw;
vMarkAlpha = markAlpha;`,
    );
  if (billboard) {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `mat4 markWorld = modelMatrix * instanceMatrix;
vec4 mvPosition = viewMatrix * vec4( markWorld[ 3 ].xyz, 1.0 );
mvPosition.xy += position.xy * vec2( length( markWorld[ 0 ].xyz ), length( markWorld[ 1 ].xyz ) );
gl_Position = projectionMatrix * mvPosition;`,
    );
  }
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying float vMarkAlpha;")
    .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= vMarkAlpha;");
}

const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3();

/** Visible all the way up, and actually in the scene this layer draws into. */
function drawnIn(anchor: THREE.Object3D, scene: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = anchor;
  let top: THREE.Object3D = anchor;
  while (node) {
    if (!node.visible) return false;
    top = node;
    node = node.parent;
  }
  return top === scene;
}

class MarkLayer {
  readonly marks = new Set<FigureMark>();
  private readonly cells = new Map<FigureMark, number>();
  private atlas: Atlas | null = null;
  private material: THREE.MeshBasicMaterial | null = null;
  private mesh: THREE.InstancedMesh | null = null;
  private capacity = 0;
  /** Camera position of the last draw, for back-to-front crest order. */
  private readonly eye = new THREE.Vector3();
  private readonly drawn: FigureMark[] = [];
  private readonly depth = new Map<FigureMark, number>();
  /** Extra size on top of each anchor's own scale (crests shrink on a real table). */
  sizeMultiplier = 1;

  constructor(
    private readonly style: LayerStyle,
    private readonly makeAtlas: () => Atlas,
    private readonly root: THREE.Object3D,
  ) {}

  add(cell: number, color: THREE.ColorRepresentation, opacity: number): FigureMark {
    const anchor = new THREE.Object3D();
    anchor.name = `mark_${this.style.name}`;
    const mark: FigureMark = { anchor, color: new THREE.Color(color), opacity };
    this.marks.add(mark);
    this.cells.set(mark, cell);
    return mark;
  }

  remove(mark: FigureMark): boolean {
    this.cells.delete(mark);
    return this.marks.delete(mark);
  }

  /** Rewrites every instance from the anchors as they stand this frame. */
  sync(rootInverse: THREE.Matrix4, scene: THREE.Object3D): void {
    const drawn = this.drawn;
    drawn.length = 0;
    for (const mark of this.marks) {
      if (mark.opacity > 0.002 && drawnIn(mark.anchor, scene)) drawn.push(mark);
    }
    if (drawn.length === 0) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }
    if (drawn.length > this.capacity) this.build(Math.max(48, this.capacity * 2, drawn.length));
    const mesh = this.mesh;
    const atlas = this.atlas;
    if (!mesh || !atlas) return;

    for (const mark of drawn) mark.anchor.updateWorldMatrix(true, false);
    if (this.style.billboard) {
      // Crests ignore the depth buffer, so they have to be painted far to near.
      this.depth.clear();
      for (const mark of drawn) {
        this.depth.set(mark, scratchPosition.setFromMatrixPosition(mark.anchor.matrixWorld).distanceToSquared(this.eye));
      }
      drawn.sort((a, b) => (this.depth.get(b) ?? 0) - (this.depth.get(a) ?? 0));
    }

    const rects = mesh.geometry.getAttribute("markRect") as THREE.InstancedBufferAttribute;
    const alphas = mesh.geometry.getAttribute("markAlpha") as THREE.InstancedBufferAttribute;
    drawn.forEach((mark, index) => {
      scratchMatrix.multiplyMatrices(rootInverse, mark.anchor.matrixWorld);
      if (this.sizeMultiplier !== 1) scratchMatrix.scale(scratchScale.setScalar(this.sizeMultiplier));
      mesh.setMatrixAt(index, scratchMatrix);
      mesh.setColorAt(index, mark.color);
      const rect = atlas.rects[this.cells.get(mark) ?? 0] ?? atlas.rects[0];
      rects.setXYZW(index, rect.x, rect.y, rect.z, rect.w);
      alphas.setX(index, Math.min(1, mark.opacity));
    });
    mesh.count = drawn.length;
    mesh.visible = true;
    // Recomputed on demand, so transparent sorting sees where the marks are now.
    mesh.boundingSphere = null;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    rects.needsUpdate = true;
    alphas.needsUpdate = true;
  }

  private build(capacity: number): void {
    if (!this.atlas) this.atlas = this.makeAtlas();
    if (!this.material) {
      const style = this.style;
      const material = new THREE.MeshBasicMaterial({
        map: this.atlas.texture,
        transparent: true,
        depthWrite: false,
        depthTest: style.depthTest,
        toneMapped: style.toneMapped,
      });
      material.onBeforeCompile = (shader) => installMarkShader(shader, style.billboard);
      material.customProgramCacheKey = () => `figure-mark-${style.billboard ? "billboard" : "flat"}`;
      this.material = material;
    }

    const geometry = new THREE.PlaneGeometry(1, 1);
    const dynamic = (attribute: THREE.InstancedBufferAttribute): THREE.InstancedBufferAttribute =>
      attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("markRect", dynamic(new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)));
    geometry.setAttribute("markAlpha", dynamic(new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)));
    const mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = dynamic(new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    mesh.name = `marks_${this.style.name}`;
    mesh.renderOrder = this.style.renderOrder;
    // One layer spans the whole board; a bound around it would almost never cull.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // Marks are decoration: a pointer ray must go straight through them.
    mesh.raycast = () => undefined;
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      this.eye.setFromMatrixPosition(camera.matrixWorld);
    };

    if (this.mesh) this.disposeMesh();
    this.mesh = mesh;
    this.capacity = capacity;
    this.root.add(mesh);
    // Built mid-update, after the root has passed its matrix on to its children.
    mesh.updateMatrixWorld(true);
  }

  private disposeMesh(): void {
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.mesh = null;
    this.capacity = 0;
  }

  dispose(): void {
    this.disposeMesh();
    this.material?.dispose();
    this.material = null;
    this.atlas?.texture.dispose();
    this.atlas = null;
    this.marks.clear();
    this.cells.clear();
  }
}

/**
 * Re-syncs the layers whenever the renderer brings world matrices up to date —
 * inside `renderer.render`, after every animation and camera move of the frame
 * and before anything is uploaded, whatever loop is driving the frame.
 */
class MarksRoot extends THREE.Group {
  constructor(private readonly onSync: () => void) {
    super();
  }

  override updateMatrixWorld(force?: boolean): void {
    super.updateMatrixWorld(force);
    this.onSync();
  }
}

/** The four shared mark layers. Add {@link group} to the scene once. */
export class FigureMarks {
  readonly group: THREE.Group;
  private readonly layers: Record<LayerName, MarkLayer>;
  private readonly rootInverse = new THREE.Matrix4();

  constructor() {
    this.group = new MarksRoot(() => this.sync());
    this.group.name = "figure_marks";
    this.layers = {
      shadow: new MarkLayer(
        { name: "shadow", renderOrder: 1, depthTest: true, toneMapped: true, billboard: false },
        () => buildAtlas(canvasesOf([radialTexture("rgba(0,0,0,0.85)", "rgba(0,0,0,0)")]), 1),
        this.group,
      ),
      // The band and the counter are instruments, not lit stone: kept out of the
      // grade so they read the same in a bright hall and a dark one.
      ring: new MarkLayer(
        { name: "ring", renderOrder: 3, depthTest: true, toneMapped: false, billboard: false },
        () => buildAtlas(canvasesOf(RING_SHAPES.map((shape) => factionRingTexture(shape))), RING_SHAPES.length),
        this.group,
      ),
      token: new MarkLayer(
        { name: "token", renderOrder: 12, depthTest: true, toneMapped: false, billboard: false },
        () =>
          buildAtlas(
            FACTIONS.flatMap((faction) => KINDS.map((kind) => tacticalTokenTexture(kind, faction).image as CanvasImageSource)),
            4,
          ),
        this.group,
      ),
      // Always legible: a crest hidden behind the piece in front of it would
      // defeat the whole point of putting it there.
      crest: new MarkLayer(
        { name: "crest", renderOrder: 40, depthTest: false, toneMapped: true, billboard: true },
        () =>
          buildAtlas(
            FACTIONS.flatMap((faction) => KINDS.map((kind) => rankBadgeTexture(kind, faction).image as CanvasImageSource)),
            4,
          ),
        this.group,
      ),
    };
  }

  /** Soft dark disc under the feet. */
  addShadow(opacity: number): FigureMark {
    return this.layers.shadow.add(0, 0x000000, opacity);
  }

  /** The faction band painted on the figure's tile, in its colour and shape. */
  addRing(shape: (typeof RING_SHAPES)[number], color: THREE.ColorRepresentation, opacity: number): FigureMark {
    return this.layers.ring.add(RING_SHAPES.indexOf(shape), color, opacity);
  }

  /** Floating rank crest; always faces the camera. */
  addCrest(kind: PieceKind, faction: Faction, opacity: number): FigureMark {
    return this.layers.crest.add(crestCell(kind, faction), 0xffffff, opacity);
  }

  /** Flat overhead counter for the tactical view. */
  addToken(kind: PieceKind, faction: Faction, opacity: number): FigureMark {
    return this.layers.token.add(crestCell(kind, faction), 0xffffff, opacity);
  }

  /** Drops a mark; detaching its anchor is the caller's business. */
  remove(mark: FigureMark | null): void {
    if (!mark) return;
    for (const layer of Object.values(this.layers)) if (layer.remove(mark)) return;
  }

  private sync(): void {
    let scene: THREE.Object3D = this.group;
    while (scene.parent) scene = scene.parent;
    this.rootInverse.copy(this.group.matrixWorld).invert();
    for (const layer of Object.values(this.layers)) layer.sync(this.rootInverse, scene);
  }

  /** Rank crests at this multiple of their own size (1 in the hall, smaller on a real table). */
  setCrestScale(multiplier: number): void {
    this.layers.crest.sizeMultiplier = multiplier;
  }

  dispose(): void {
    for (const layer of Object.values(this.layers)) layer.dispose();
    this.group.removeFromParent();
  }
}
