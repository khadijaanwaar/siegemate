import * as THREE from "three";

import type { UvRect } from "./overlayAtlas";

/** `aMode.x` of an instance in a mixed batch: light added on top. */
export const BLEND_ADD = 0;
/** `aMode.x` of an instance in a mixed batch: ordinary alpha-over, like a shroud or a label. */
export const BLEND_OVER = 1;

/**
 * Writes `T(x, y, z) · Ry(spin) · S(sx, sy, sz)` at `offset`, column-major as
 * three.js stores matrices. Quads are built lying flat, so `spin` is what the
 * old meshes called `rotation.z` while turned flat with `rotation.x = -π/2`.
 */
export function writePlacement(
  out: Float32Array,
  offset: number,
  x: number,
  y: number,
  z: number,
  spin: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  const c = Math.cos(spin);
  const s = Math.sin(spin);
  out[offset] = c * sx;
  out[offset + 1] = 0;
  out[offset + 2] = -s * sx;
  out[offset + 3] = 0;
  out[offset + 4] = 0;
  out[offset + 5] = sy;
  out[offset + 6] = 0;
  out[offset + 7] = 0;
  out[offset + 8] = s * sz;
  out[offset + 9] = 0;
  out[offset + 10] = c * sz;
  out[offset + 11] = 0;
  out[offset + 12] = x;
  out[offset + 13] = y;
  out[offset + 14] = z;
  out[offset + 15] = 1;
}

/** The look of one pooled overlay: where, how big, how turned, how strong. */
export class Decal {
  readonly position = new THREE.Vector3();
  readonly scale = new THREE.Vector3(1, 1, 1);
  /** Turn about the board's up axis. */
  spin = 0;
  visible = false;
  opacity = 0;
  readonly color = new THREE.Color(0xffffff);
}

export interface DecalStyle {
  /** Size of the shape at scale 1 (the old plane geometry's width). */
  size: number;
  rect: UvRect;
  blend: number;
  /** Folded into the opacity: lets one soft disc stand in for slightly dimmer copies of itself. */
  alpha?: number;
  /** Face the camera like a sprite instead of lying on the board. */
  billboard?: boolean;
  /** Which shape of a multi-shape geometry to keep (see `parts` on the material). */
  part?: number;
}

/**
 * One instanced draw holding any number of overlays. Filled from scratch every
 * frame with only what is lit, so the draw disappears entirely when nothing is.
 */
export class OverlayBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly uvRect: THREE.InstancedBufferAttribute;
  private readonly mode: THREE.InstancedBufferAttribute;
  private cursor = 0;

  constructor(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, renderOrder: number) {
    this.capacity = capacity;
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.uvRect = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.mode = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    for (const attribute of [this.tint, this.uvRect, this.mode]) attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aTint", this.tint);
    geometry.setAttribute("aUvRect", this.uvRect);
    geometry.setAttribute("aMode", this.mode);

    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = name;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.renderOrder = renderOrder;
    // Instances come and go every frame; a fixed sphere around the whole board
    // keeps culling and sorting honest without recomputing it.
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 9);
  }

  get count(): number {
    return this.cursor;
  }

  begin(): void {
    this.cursor = 0;
  }

  /** Queues one overlay. Invisible or fully transparent ones are skipped; past capacity they are dropped. */
  push(decal: Decal, style: DecalStyle): void {
    if (!decal.visible) return;
    const opacity = decal.opacity * (style.alpha ?? 1);
    if (opacity <= 0) return;
    if (this.cursor >= this.capacity) return;
    const i = this.cursor;
    const size = style.size;
    writePlacement(
      this.mesh.instanceMatrix.array as Float32Array,
      i * 16,
      decal.position.x,
      decal.position.y,
      decal.position.z,
      decal.spin,
      decal.scale.x * size,
      decal.scale.y * size,
      decal.scale.z * size,
    );
    const tint = this.tint.array as Float32Array;
    tint[i * 4] = decal.color.r;
    tint[i * 4 + 1] = decal.color.g;
    tint[i * 4 + 2] = decal.color.b;
    tint[i * 4 + 3] = opacity;
    const uv = this.uvRect.array as Float32Array;
    uv[i * 4] = style.rect[0];
    uv[i * 4 + 1] = style.rect[1];
    uv[i * 4 + 2] = style.rect[2];
    uv[i * 4 + 3] = style.rect[3];
    const mode = this.mode.array as Float32Array;
    mode[i * 4] = style.blend;
    mode[i * 4 + 1] = style.billboard ? 1 : 0;
    mode[i * 4 + 2] = style.part ?? 0;
    mode[i * 4 + 3] = 0;
    this.cursor += 1;
  }

  /** Hands what was queued since {@link begin} to the GPU (only the used range). */
  end(): void {
    const count = this.cursor;
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    if (count === 0) return;
    for (const attribute of [this.mesh.instanceMatrix, this.tint, this.uvRect, this.mode]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, count * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

export interface OverlayMaterialOptions {
  map: THREE.Texture;
  /**
   * `additive`: every instance adds light. `mixed`: each instance picks, through
   * its blend mode, between added light and ordinary alpha-over, so a veil and
   * the glows above it can share one draw (premultiplied output, alpha zeroed
   * for the additive ones).
   */
  blend: "additive" | "mixed";
  depthTest: boolean;
  side?: THREE.Side;
  /** Allows instances that face the camera like sprites. */
  billboards?: boolean;
  /** The geometry carries several shapes tagged by an `aPart` attribute; each instance keeps one. */
  parts?: boolean;
}

const VERTEX_PARS = /* glsl */ `
attribute vec4 aTint;
attribute vec4 aUvRect;
attribute vec4 aMode;
varying vec4 vOverlayTint;
varying float vOverlayBlend;
`;

const VERTEX_UV = /* glsl */ `
	vMapUv = aUvRect.xy + vMapUv * aUvRect.zw;
	vOverlayTint = aTint;
	vOverlayBlend = aMode.x;
`;

// The shapes an instance does not use collapse to a point: zero-area, never rasterised.
const PARTS_VERTEX = /* glsl */ `
	if ( abs( aPart - aMode.z ) > 0.5 ) transformed = vec3( 0.0 );
`;

// Same maths as three's sprite shader (centre 0.5, no rotation, size attenuation on).
const BILLBOARD_PROJECT = /* glsl */ `
	vec4 mvPosition = vec4( transformed, 1.0 );
	if ( aMode.y > 0.5 ) {
		mat4 placed = modelMatrix * instanceMatrix;
		vec2 spriteScale = vec2( length( placed[ 0 ].xyz ), length( placed[ 1 ].xyz ) );
		mvPosition = modelViewMatrix * ( instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) );
		mvPosition.xy += vec2( transformed.x, - transformed.z ) * spriteScale;
	} else {
		mvPosition = modelViewMatrix * ( instanceMatrix * mvPosition );
	}
	gl_Position = projectionMatrix * mvPosition;
`;

function patch(source: string, marker: string, replacement: string): string {
  if (!source.includes(marker)) throw new Error(`overlay material: shader chunk ${marker} not found`);
  return source.replace(marker, replacement);
}

/**
 * A `MeshBasicMaterial` reading per-instance tint (rgb + opacity), atlas cell
 * and blend mode, so it keeps fog, tone mapping and output colour handling
 * exactly as the per-overlay materials had them.
 */
export function createOverlayMaterial(options: OverlayMaterialOptions): THREE.MeshBasicMaterial {
  const mixed = options.blend === "mixed";
  const material = new THREE.MeshBasicMaterial({
    map: options.map,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    depthTest: options.depthTest,
    side: options.side ?? THREE.FrontSide,
    blending: mixed ? THREE.NormalBlending : THREE.AdditiveBlending,
    premultipliedAlpha: mixed,
  });
  // Double-sided transparents are otherwise drawn twice (back faces, then front).
  material.forceSinglePass = true;
  const key = `board-overlay:${options.blend}:${options.billboards ? "billboard" : "flat"}:${options.parts ? "parts" : "single"}`;
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader) => {
    let vertex = patch(shader.vertexShader, "#include <common>", `#include <common>\n${VERTEX_PARS}${options.parts ? "attribute float aPart;\n" : ""}`);
    vertex = patch(vertex, "#include <uv_vertex>", `#include <uv_vertex>\n${VERTEX_UV}`);
    if (options.parts) vertex = patch(vertex, "#include <begin_vertex>", `#include <begin_vertex>\n${PARTS_VERTEX}`);
    if (options.billboards) vertex = patch(vertex, "#include <project_vertex>", BILLBOARD_PROJECT);
    shader.vertexShader = vertex;

    let fragment = patch(
      shader.fragmentShader,
      "#include <common>",
      "#include <common>\nvarying vec4 vOverlayTint;\nvarying float vOverlayBlend;",
    );
    fragment = patch(fragment, "#include <color_fragment>", "#include <color_fragment>\n\tdiffuseColor *= vOverlayTint;");
    if (mixed) {
      fragment = patch(
        fragment,
        "#include <premultiplied_alpha_fragment>",
        "#include <premultiplied_alpha_fragment>\n\tgl_FragColor.a *= vOverlayBlend;",
      );
    }
    shader.fragmentShader = fragment;
  };
  return material;
}

/**
 * Re-indexes a geometry so all its groups bound for the same material are one
 * contiguous range: `slotOf[g]` is the new material slot of old group `g`. A
 * box with five stone faces and an inlaid top then draws in two calls, not six.
 */
export function groupFacesByMaterial(geometry: THREE.BufferGeometry, slotOf: readonly number[]): void {
  const groups = geometry.groups.map((group) => ({ ...group }));
  if (groups.length !== slotOf.length) throw new Error("groupFacesByMaterial: one slot per group");
  const source = geometry.index;
  const vertexCount = geometry.getAttribute("position").count;
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const indices = vertexCount > 65535 ? new Uint32Array(total) : new Uint16Array(total);
  const slots = Math.max(...slotOf) + 1;
  geometry.clearGroups();
  let cursor = 0;
  for (let slot = 0; slot < slots; slot += 1) {
    const start = cursor;
    groups.forEach((group, g) => {
      if (slotOf[g] !== slot) return;
      for (let i = group.start; i < group.start + group.count; i += 1) {
        indices[cursor] = source ? source.getX(i) : i;
        cursor += 1;
      }
    });
    if (cursor > start) geometry.addGroup(start, cursor - start, slot);
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
}
