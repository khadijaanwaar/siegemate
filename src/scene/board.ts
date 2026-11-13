import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { SquareId } from "../core/types";
import type { ArenaLook } from "./arena";
import { buildOverlayAtlas, type OverlayAtlas, type UvRect } from "./overlayAtlas";
import {
  BLEND_ADD,
  BLEND_OVER,
  Decal,
  type DecalStyle,
  OverlayBatch,
  createOverlayMaterial,
  groupFacesByMaterial,
} from "./overlayBatch";
import {
  boardBorderTexture,
  captureMarkerTexture,
  castleMarkerTexture,
  columnTexture,
  marbleTexture,
  moveMarkerTexture,
  premoveCancelTexture,
  premoveMarkerTexture,
  premoveOrderTexture,
  premoveTargetTexture,
  premoveThreadTexture,
  promoteMarkerTexture,
  landingRingTexture,
  radialTexture,
  selectMarkerTexture,
  shockwaveTexture,
  tileMaskTexture,
} from "./textures";

export const TILE = 1.02;
export const BOARD_TOP = 0;

const FILES = "abcdefgh";

export type HighlightKind =
  | "select"
  | "move"
  | "capture"
  | "castle"
  | "promote"
  | "last"
  | "check"
  | "hint"
  /** Square a queued move *could* be aimed at while the engine is thinking. */
  | "premove"
  /** The square the queued move starts from. */
  | "queued"
  /** The square the queued move is aimed at — the one that must be readable. */
  | "queuedTarget";

const HIGHLIGHT_COLORS: Record<HighlightKind, number> = {
  select: 0xffc95e,
  move: 0x5cf2a4,
  capture: 0xff5a44,
  castle: 0x63b8ff,
  promote: 0xc784ff,
  last: 0xd9a441,
  check: 0xff3b30,
  hint: 0x6aa9ff,
  // Cold pewter, deliberately outside the palette every *played* move uses:
  // an intention has no business competing with the move on the board.
  premove: 0x7d8ba3,
  queued: 0x8ea0bd,
  // The destination is the half of a queued move worth reading, so it is the
  // bright end of the pewter: near-white steel against the dim origin.
  queuedTarget: 0xe6edff,
};

/** How dark an unreachable square goes while a piece is selected. */
const SHROUD_OPACITY = 0.62;

/** Base opacity of the soft glow disc lying flat on the tile. */
const GLOW_OPACITY: Record<HighlightKind, number> = {
  select: 0.5,
  move: 0.46,
  capture: 0.58,
  castle: 0.5,
  promote: 0.54,
  last: 0.22,
  check: 0.6,
  hint: 0.3,
  premove: 0.2,
  queued: 0.26,
  queuedTarget: 0.5,
};

/** Base opacity of the crisp reticle drawn on top of the glow. */
const MARKER_OPACITY: Record<HighlightKind, number> = {
  select: 0.85,
  move: 0.9,
  capture: 1,
  castle: 0.95,
  promote: 1,
  last: 0,
  check: 0.8,
  hint: 0.5,
  premove: 0.42,
  queued: 0.6,
  queuedTarget: 1,
};

/** Base opacity of the vertical light column standing on the square. */
const BEAM_OPACITY: Record<HighlightKind, number> = {
  select: 0.16,
  move: 0.3,
  capture: 0.42,
  castle: 0.34,
  promote: 0.46,
  last: 0,
  check: 0.3,
  hint: 0.12,
  premove: 0.08,
  queued: 0.12,
  queuedTarget: 0.28,
};

/**
 * How much of a reticle is drawn *through* whatever stands in front of it.
 *
 * The figures are life-size and the camera is low, so a destination is routinely
 * behind a body rather than beside one: measured on the opening position, a
 * knight's own two squares are 88% hidden on a desktop window and ~64% on a
 * phone. A marker that only exists on the stone is therefore a marker the player
 * cannot see. Each destination is drawn a second time with the depth test off,
 * additively and at a fraction of its strength, so an occluded square reads as
 * light bleeding through the figure instead of vanishing. Deliberately low: this
 * is a whisper saying "the square is behind me", not a decal on the model.
 */
const XRAY_OPACITY: Record<HighlightKind, number> = {
  select: 0,
  move: 0.3,
  capture: 0.38,
  castle: 0.34,
  promote: 0.38,
  last: 0,
  check: 0,
  hint: 0.26,
  premove: 0.2,
  queued: 0.26,
  queuedTarget: 0.44,
};

/** Radians per second the reticle spins (capture locks turn the other way). */
const MARKER_SPIN: Record<HighlightKind, number> = {
  select: 0,
  move: 0.35,
  capture: -0.7,
  castle: 0.5,
  promote: 0.9,
  last: 0,
  check: 0.5,
  hint: 0.2,
  premove: 0.12,
  queued: 0.22,
  // A border that rotates stops being a border. The destination frame is the
  // one mark on the board that must stay square to the tile it claims.
  queuedTarget: 0,
};

const POP_DURATION = 0.26;

/** Deepest queue the game allows, and so how many threads to keep ready. */
const MAX_PREMOVE_LINKS = 5;

/** How high above the destination tile the dismiss coin floats. */
const CANCEL_LIFT = 0.62;
/** World size of the coin sprite, transparent hit margin included. */
const CANCEL_SIZE = 0.62;
/** Resting tint of the dismiss coin: the pewter of the queued move. */
const CANCEL_COLD = new THREE.Color(0xd7e2f6);
/** Under the pointer it warms to an ember — this is the button that destroys. */
const CANCEL_HOT = new THREE.Color(0xff8f7a);

/**
 * How high the order numerals ride. Low enough to belong to the square, well
 * clear of the dismiss coin at {@link CANCEL_LIFT} so the two never collide on
 * the last link of a chain — they stack, numeral under coin.
 */
const ORDER_LIFT = 0.28;
/** World size of an order numeral sprite. */
const ORDER_SIZE = 0.34;
/** The pewter the whole premove language is painted in. */
const ORDER_TINT = new THREE.Color(0xe6edff);

/**
 * The two ends of a thread's colour ramp. The link that runs *next* burns in
 * near-white steel; the ones behind it cool toward the dim pewter of an origin
 * ring, so the chain reads in order along its own lines and not just off the
 * numerals.
 */
const THREAD_HEAD = new THREE.Color(0xe6edff);
const THREAD_TAIL = new THREE.Color(0x7f90ad);

/** Overshooting ease so squares snap into place with a little punch. */
function easeOutBack(t: number): number {
  const c = 1.9;
  const p = t - 1;
  return 1 + (c + 1) * p * p * p + c * p * p;
}

export function squareToWorld(square: SquareId, y = BOARD_TOP): THREE.Vector3 {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return new THREE.Vector3((file - 3.5) * TILE, y, (3.5 - (rank - 1)) * TILE);
}

export function worldToSquare(x: number, z: number): SquareId | null {
  const file = Math.round(x / TILE + 3.5);
  const rank = Math.round(3.5 - z / TILE) + 1;
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return `${FILES[file]}${rank}`;
}

export function isLightSquare(square: SquareId): boolean {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return (file + rank) % 2 === 0;
}

/*
 * The board's overlays are drawn in three instanced batches instead of a mesh
 * apiece (the board used to cost 72 drawables standing still, and hundreds of
 * draw calls with a piece selected). Each batch's render order brackets the
 * orders its overlays had against the rest of the scene: the figures' contact
 * shadows sit at 1, their faction rings at 3.
 */
/** Veils (were 1) and glow discs (were 2): after the shadows, under the rings and any smoke. */
const FLOOR_ORDER = 1.5;
/** Beams (3), reticles and threads (4), hover ring, ripples and flares (5–7): all added light. */
const MARK_ORDER = 4;
/** Drawn through the figures: x-ray reticles (9), order numerals (11), the dismiss coin (12). */
const XRAY_ORDER = 12;

/** Old plane-geometry sizes, now instance scales on one unit quad. */
const SHROUD_SIZE = TILE * 1.01;
const GLOW_SIZE = TILE * 0.98;
const MARKER_SIZE = TILE * 0.92;
const HOVER_SIZE = TILE;
const IMPACT_RING_SIZE = TILE * 2.4;
const IMPACT_FLARE_SIZE = TILE * 1.5;
const LANDING_RING_SIZE = TILE * 2.1;
const LANDING_GLOW_SIZE = TILE * 1.35;

/** `aPart` of the light column inside the marks geometry (the flat quad is 0). */
const PART_BEAM = 1;

const SHROUD_COLOR = 0x05070e;
const HOVER_COLOR = 0xffd88a;

/** Atlas cell of each kind's reticle; `last` is a bare glow. */
const MARKER_CELL: Record<HighlightKind, string | null> = {
  select: "select",
  move: "move",
  capture: "capture",
  castle: "castle",
  promote: "promote",
  last: null,
  check: "capture",
  hint: "move",
  premove: "premove",
  queued: "premove",
  queuedTarget: "queuedTarget",
};

/** A tile knocked out of place by an impact, settling back with damped bounce. */
interface TileJolt {
  tile: THREE.Mesh;
  home: THREE.Vector3;
  /** Seconds elapsed; negative while the shock travels out to this tile. */
  age: number;
  strength: number;
  duration: number;
  seed: number;
}

/** Where a square's stone is drawn: which instanced mesh, which instance. */
interface TileInstance {
  mesh: THREE.InstancedMesh;
  index: number;
}

/** One pooled shockwave ring / flare pair playing on a square. */
interface ImpactWave {
  ring: Decal;
  flare: Decal;
  age: number;
  duration: number;
  active: boolean;
}

/** Arrival ripple on the square a figure just set down on. */
interface LandingRipple {
  ring: Decal;
  glow: Decal;
  age: number;
  duration: number;
  strength: number;
  active: boolean;
}

/** A dark veil laid over a square the selected piece cannot reach. */
interface ShroudSlot {
  veil: Decal;
  target: number;
  current: number;
  /** Seconds still to wait before this square starts fading. */
  delay: number;
}

interface HighlightSlot {
  glow: Decal;
  marker: Decal;
  /** The same reticle again, drawn through anything standing in the way. */
  xray: Decal;
  beam: Decal;
  /** How the current kind's reticle is drawn, or `null` for a bare glow. */
  markerStyle: DecalStyle | null;
  kind: HighlightKind | null;
  pulse: boolean;
  /** Seconds since the highlight was set; negative while waiting on its stagger. */
  age: number;
  phase: number;
}

interface OverlayStyles {
  veil: DecalStyle;
  glow: DecalStyle;
  beam: DecalStyle;
  thread: DecalStyle;
  hover: DecalStyle;
  landingGlow: DecalStyle;
  landingRing: DecalStyle;
  impactRing: DecalStyle;
  flare: DecalStyle;
  coin: DecalStyle;
  orders: DecalStyle[];
}

/** The pointer ring as a picture: the old ring geometry spanned 0.42–0.48 of a tile. */
function hoverRingCanvas(): HTMLCanvasElement {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  const centre = size / 2;
  const pixelsPerUnit = size / HOVER_SIZE;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(centre, centre, TILE * 0.48 * pixelsPerUnit, 0, Math.PI * 2);
  ctx.arc(centre, centre, TILE * 0.42 * pixelsPerUnit, 0, Math.PI * 2, true);
  ctx.fill();
  return canvas;
}

/** A flat unit quad and the beam's open column in one geometry, told apart by `aPart`. */
function markGeometry(): THREE.BufferGeometry {
  const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const column = new THREE.CylinderGeometry(TILE * 0.4, TILE * 0.44, 0.55, 20, 1, true);
  const tag = (geometry: THREE.BufferGeometry, part: number): void => {
    const count = geometry.getAttribute("position").count;
    geometry.setAttribute("aPart", new THREE.Float32BufferAttribute(new Float32Array(count).fill(part), 1));
  };
  tag(quad, 0);
  tag(column, PART_BEAM);
  const merged = mergeGeometries([quad, column]);
  quad.dispose();
  column.dispose();
  if (!merged) throw new Error("board: could not merge the mark shapes");
  merged.deleteAttribute("normal");
  return merged;
}

/** A flat unit quad lying on the board, for the batches that need nothing else. */
function quadGeometry(): THREE.BufferGeometry {
  const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  quad.deleteAttribute("normal");
  return quad;
}

/**
 * The playing surface: 64 bevelled marble/basalt tiles on a carved base with a
 * bronze-trimmed, engraved border, plus the pooled highlight overlays.
 *
 * Drawn in a handful of calls: the tiles are two instanced meshes (light and
 * dark keep their own materials), the base two, the trim one, and every
 * overlay goes through one of three instanced batches sharing a texture atlas.
 */
export class BoardView {
  readonly group = new THREE.Group();
  /** One invisible stand-in per square, for picking; the stone itself is drawn instanced. */
  readonly tiles: THREE.Mesh[] = [];

  private slots = new Map<SquareId, HighlightSlot>();
  /** Held down while a modal panel owns the screen (the promotion picker). */
  private overlaysMuted = false;
  private shrouds = new Map<SquareId, ShroudSlot>();
  private hoverRing = new Decal();
  /** Threads drawn along each link of the queued chain. */
  private premoveLinks: Decal[] = [];
  /** The dismiss coin hanging over a queued move's destination. */
  private coin = new Decal();
  /** Invisible twin of the coin, kept where it is drawn so a ray can find it. */
  private premoveCancel: THREE.Sprite;
  private premoveCancelSquare: SquareId | null = null;
  private premoveCancelHot = false;
  private premoveCancelHeat = 0;
  private premoveCancelAge = 0;
  /** The 1..5 numerals riding over each square of the queued chain. */
  private premoveOrders: Decal[] = [];
  private premoveOrderAges: number[] = [];
  /** Materials the arena theme repaints (tile contrast, base stone, trim). */
  private lightTileMaterial: THREE.MeshPhysicalMaterial;
  private darkTileMaterial: THREE.MeshPhysicalMaterial;
  private baseMaterial: THREE.MeshStandardMaterial | null = null;
  private borderMaterial: THREE.MeshStandardMaterial | null = null;
  private trimMaterial: THREE.MeshStandardMaterial | null = null;
  private disposables: { dispose: () => void }[] = [];
  private elapsed = 0;
  private tileBySquare = new Map<SquareId, THREE.Mesh>();
  private tileInstances = new Map<THREE.Mesh, TileInstance>();
  private jolts: TileJolt[] = [];
  private waves: ImpactWave[] = [];
  private waveCursor = 0;
  private landings: LandingRipple[] = [];
  private landingCursor = 0;

  /** Shroud veils and glow discs (mixed blending: the veil darkens, the glows add). */
  private floor: OverlayBatch;
  /** Reticles, beams, threads, the hover ring, ripples and flares. */
  private marks: OverlayBatch;
  /** Everything drawn through the figures: x-ray reticles, order numerals, the coin. */
  private xrays: OverlayBatch;
  private styles: OverlayStyles;
  private markerStyles: Record<HighlightKind, DecalStyle | null>;

  constructor() {
    this.group.name = "board";

    const lightMap = this.track(marbleTexture(false));
    const darkMap = this.track(marbleTexture(true));
    const lightMaterial = this.track(
      new THREE.MeshPhysicalMaterial({
        map: lightMap,
        color: 0xf6efe0,
        roughness: 0.22,
        metalness: 0.02,
        clearcoat: 0.7,
        clearcoatRoughness: 0.18,
        envMapIntensity: 0.9,
      }),
    );
    const darkMaterial = this.track(
      new THREE.MeshPhysicalMaterial({
        map: darkMap,
        color: 0x23252c,
        roughness: 0.3,
        metalness: 0.12,
        clearcoat: 0.6,
        clearcoatRoughness: 0.25,
        envMapIntensity: 0.8,
      }),
    );

    this.lightTileMaterial = lightMaterial;
    this.darkTileMaterial = darkMaterial;

    const tileGeometry = this.track(new RoundedBoxGeometry(TILE * 0.97, 0.18, TILE * 0.97, 3, 0.035));
    this.buildTiles(tileGeometry, lightMaterial, darkMaterial);
    this.buildBase();

    const atlas = this.buildAtlas();
    const map = atlas.texture;
    const rect = (key: string): UvRect => {
      const found = atlas.rects.get(key);
      if (!found) throw new Error(`board: atlas cell "${key}" missing`);
      return found;
    };
    this.styles = {
      veil: { size: SHROUD_SIZE, rect: rect("veil"), blend: BLEND_OVER },
      // One full-strength disc stands in for the 0.95 / 0.9 copies the glows used.
      glow: { size: GLOW_SIZE, rect: rect("disc"), blend: BLEND_ADD, alpha: 0.95 },
      beam: { size: 1, rect: rect("column"), blend: BLEND_ADD, part: PART_BEAM },
      thread: { size: 1, rect: rect("thread"), blend: BLEND_ADD },
      hover: { size: HOVER_SIZE, rect: rect("hover"), blend: BLEND_ADD },
      landingGlow: { size: LANDING_GLOW_SIZE, rect: rect("disc"), blend: BLEND_ADD, alpha: 0.9 },
      landingRing: { size: LANDING_RING_SIZE, rect: rect("landing"), blend: BLEND_ADD },
      impactRing: { size: IMPACT_RING_SIZE, rect: rect("shock"), blend: BLEND_ADD },
      flare: { size: IMPACT_FLARE_SIZE, rect: rect("disc"), blend: BLEND_ADD },
      coin: { size: 1, rect: rect("coin"), blend: BLEND_OVER, billboard: true },
      orders: Array.from({ length: MAX_PREMOVE_LINKS }, (_, index) => ({
        size: 1,
        rect: rect(`order${index + 1}`),
        blend: BLEND_OVER,
        billboard: true,
      })),
    };
    const markerStyle = (kind: HighlightKind): DecalStyle | null => {
      const cell = MARKER_CELL[kind];
      return cell ? { size: MARKER_SIZE, rect: rect(cell), blend: BLEND_ADD } : null;
    };
    this.markerStyles = {
      select: markerStyle("select"),
      move: markerStyle("move"),
      capture: markerStyle("capture"),
      castle: markerStyle("castle"),
      promote: markerStyle("promote"),
      last: markerStyle("last"),
      check: markerStyle("check"),
      hint: markerStyle("hint"),
      premove: markerStyle("premove"),
      queued: markerStyle("queued"),
      queuedTarget: markerStyle("queuedTarget"),
    };

    this.floor = this.track(
      new OverlayBatch(
        "board-floor",
        quadGeometry(),
        this.track(createOverlayMaterial({ map, blend: "mixed", depthTest: true })),
        64 * 2,
        FLOOR_ORDER,
      ),
    );
    this.marks = this.track(
      new OverlayBatch(
        "board-marks",
        markGeometry(),
        this.track(
          createOverlayMaterial({ map, blend: "additive", depthTest: true, side: THREE.DoubleSide, parts: true }),
        ),
        64 * 2 + MAX_PREMOVE_LINKS + 1 + 5 * 2 + 4 * 2,
        MARK_ORDER,
      ),
    );
    this.xrays = this.track(
      new OverlayBatch(
        "board-xray",
        quadGeometry(),
        this.track(createOverlayMaterial({ map, blend: "mixed", depthTest: false, billboards: true })),
        64 + MAX_PREMOVE_LINKS + 1,
        XRAY_ORDER,
      ),
    );
    this.group.add(this.floor.mesh, this.marks.mesh, this.xrays.mesh);

    this.buildShroud();
    this.buildHighlights();
    this.buildImpactWaves();
    this.buildLandingRipples();

    this.hoverRing.color.setHex(HOVER_COLOR);
    this.hoverRing.position.y = BOARD_TOP + 0.012;
    this.hoverRing.visible = true;

    this.buildPremoveLink();
    this.premoveCancel = this.buildPremoveCancel();
    this.buildPremoveOrders();
  }

  /**
   * One texture for every overlay picture, so the overlays can share draws.
   * The source canvases are painted by the same functions as before and only
   * copied; the per-picture textures are never uploaded.
   */
  private buildAtlas(): OverlayAtlas {
    const sources: { key: string; texture: THREE.CanvasTexture }[] = [
      { key: "veil", texture: tileMaskTexture() },
      { key: "disc", texture: radialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)") },
      { key: "column", texture: columnTexture() },
      { key: "thread", texture: premoveThreadTexture() },
      { key: "shock", texture: shockwaveTexture() },
      { key: "landing", texture: landingRingTexture() },
      { key: "select", texture: selectMarkerTexture() },
      { key: "move", texture: moveMarkerTexture() },
      { key: "capture", texture: captureMarkerTexture() },
      { key: "castle", texture: castleMarkerTexture() },
      { key: "promote", texture: promoteMarkerTexture() },
      { key: "premove", texture: premoveMarkerTexture() },
      { key: "queuedTarget", texture: premoveTargetTexture() },
      { key: "coin", texture: premoveCancelTexture() },
      ...Array.from({ length: MAX_PREMOVE_LINKS }, (_, index) => ({
        key: `order${index + 1}`,
        texture: premoveOrderTexture(index + 1),
      })),
    ];
    const atlas = buildOverlayAtlas([
      ...sources.map(({ key, texture }) => ({ key, image: texture.image })),
      { key: "hover", image: hoverRingCanvas() },
    ]);
    for (const { texture } of sources) texture.dispose();
    this.track(atlas.texture);
    return atlas;
  }

  /**
   * Two instanced meshes, light and dark, each keeping its own marble and
   * finish. Picking still wants an object per square, so each square also gets
   * an invisible stand-in; a jolt moves the stand-in and copies it across.
   */
  private buildTiles(
    geometry: THREE.BufferGeometry,
    lightMaterial: THREE.Material,
    darkMaterial: THREE.Material,
  ): void {
    const lightTiles = this.track(new THREE.InstancedMesh(geometry, lightMaterial, 32));
    const darkTiles = this.track(new THREE.InstancedMesh(geometry, darkMaterial, 32));
    lightTiles.name = "board-tiles-light";
    darkTiles.name = "board-tiles-dark";
    const pickMaterial = this.track(new THREE.MeshBasicMaterial());
    let lightIndex = 0;
    let darkIndex = 0;

    for (let rank = 1; rank <= 8; rank += 1) {
      for (let fileIndex = 0; fileIndex < 8; fileIndex += 1) {
        const square = `${FILES[fileIndex]}${rank}`;
        const light = isLightSquare(square);
        const tile = new THREE.Mesh(geometry, pickMaterial);
        const position = squareToWorld(square, -0.09);
        tile.position.copy(position);
        tile.visible = false;
        tile.userData.square = square;
        tile.userData.home = position.clone();
        tile.updateMatrix();
        const mesh = light ? lightTiles : darkTiles;
        const index = light ? lightIndex++ : darkIndex++;
        mesh.setMatrixAt(index, tile.matrix);
        this.tileInstances.set(tile, { mesh, index });
        this.tileBySquare.set(square, tile);
        this.tiles.push(tile);
        this.group.add(tile);
      }
    }

    for (const mesh of [lightTiles, darkTiles]) {
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.computeBoundingSphere();
      // Room for a jolted tile to leave its square for a moment.
      if (mesh.boundingSphere) mesh.boundingSphere.radius += 0.5;
      this.group.add(mesh);
    }
  }

  /** Copies a stand-in tile's pose onto the instance that draws it. */
  private syncTile(tile: THREE.Mesh): void {
    const instance = this.tileInstances.get(tile);
    if (!instance) return;
    tile.updateMatrix();
    instance.mesh.setMatrixAt(instance.index, tile.matrix);
    instance.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * The order numerals. Like the coin they ignore the depth buffer: a chain
   * runs *through* the figures still standing on the board, so the one mark
   * that says "this happens third" cannot be the one hidden behind a rook.
   */
  private buildPremoveOrders(): void {
    for (let index = 0; index < MAX_PREMOVE_LINKS; index += 1) {
      const order = new Decal();
      order.color.copy(ORDER_TINT);
      order.scale.setScalar(ORDER_SIZE);
      this.premoveOrders.push(order);
      this.premoveOrderAges.push(0);
    }
  }

  /**
   * Numbers the squares of the queued chain, oldest first.
   *
   * A lone queued move gets **no** numeral: "1" on its own answers a question
   * nobody asked and adds a mark to a board that is already carrying a ring, a
   * frame, a thread and a coin. The count only appears once there is an order
   * to read — from the second link on.
   */
  setPremoveOrders(squares: SquareId[]): void {
    const numbered = squares.length > 1 ? squares : [];
    for (let index = 0; index < this.premoveOrders.length; index += 1) {
      const order = this.premoveOrders[index];
      const square = numbered[index];
      if (!square) {
        order.visible = false;
        order.opacity = 0;
        continue;
      }
      const centre = squareToWorld(square, BOARD_TOP);
      order.position.set(centre.x, BOARD_TOP + ORDER_LIFT, centre.z);
      if (!order.visible) {
        this.premoveOrderAges[index] = 0;
        order.opacity = 0;
      }
      // The head of the chain is the link that runs next, so it is the bright
      // one; the tail dims off so the eye reads the plan in order.
      const fade = index === 0 ? 1 : Math.max(0.62, 1 - index * 0.1);
      order.color.copy(ORDER_TINT).multiplyScalar(fade);
      order.visible = !this.overlaysMuted;
    }
  }

  /**
   * The threads between the squares of a queued chain. Marks alone read as
   * unrelated lights on a busy board; the lines are what make them one *plan*
   * at a glance, and they breathe so they are never mistaken for played moves.
   *
   * One thread per possible link, ready up front: the deepest queue the game
   * allows is five. Each carries which way it runs (its spin, which keeps the
   * comet texture's +x pointed at the destination) and how far down the chain
   * it sits (its tint).
   */
  private buildPremoveLink(): void {
    for (let index = 0; index < MAX_PREMOVE_LINKS; index += 1) {
      const link = new Decal();
      link.color.copy(THREAD_HEAD);
      link.position.y = BOARD_TOP + 0.018;
      this.premoveLinks.push(link);
    }
  }

  /**
   * The dismiss coin. It faces the player from any camera angle like a sprite,
   * and it ignores the depth buffer: a cancel button hidden behind the figure
   * standing in front of it would be a cancel button that does not exist. It is
   * drawn in the x-ray batch; the sprite returned here only answers rays.
   */
  private buildPremoveCancel(): THREE.Sprite {
    this.coin.color.copy(CANCEL_COLD);
    this.coin.scale.setScalar(CANCEL_SIZE);
    const handle = new THREE.Sprite(this.track(new THREE.SpriteMaterial()));
    handle.name = "premove-cancel";
    handle.visible = false;
    handle.scale.setScalar(CANCEL_SIZE);
    this.group.add(handle);
    return handle;
  }

  /** Hangs the dismiss coin over a square, or takes it away. */
  setPremoveCancel(square: SquareId | null): void {
    if (square === this.premoveCancelSquare) return;
    this.premoveCancelSquare = square;
    this.premoveCancelHot = false;
    this.premoveCancelHeat = 0;
    this.coin.color.copy(CANCEL_COLD);
    if (!square) {
      this.coin.visible = false;
      this.coin.opacity = 0;
      return;
    }
    const centre = squareToWorld(square, BOARD_TOP);
    this.coin.position.set(centre.x, BOARD_TOP + CANCEL_LIFT, centre.z);
    this.premoveCancel.position.copy(this.coin.position);
    this.premoveCancelAge = 0;
    this.coin.opacity = 0;
    this.coin.visible = !this.overlaysMuted;
  }

  /** Lights the coin up while the pointer is on it. */
  setPremoveCancelHot(hot: boolean): void {
    this.premoveCancelHot = hot;
  }

  /** The coin as a ray target, or `null` when there is nothing to dismiss. */
  premoveCancelHandle(): THREE.Object3D | null {
    return this.coin.visible && this.premoveCancelSquare ? this.premoveCancel : null;
  }

  /**
   * Lays a thread along every link of the queued chain, or takes them away.
   *
   * The thread's local +x is the direction of travel — `atan2(-dz, dx)` aims it
   * from the origin at the destination — and the gradient map is painted along
   * that same axis, so the comet always burns *into* the square the plan is
   * entering without any per-link texture work.
   */
  setPremoveLinks(moves: { from: SquareId; to: SquareId }[]): void {
    for (let index = 0; index < this.premoveLinks.length; index += 1) {
      const link = this.premoveLinks[index];
      const move = moves[index];
      if (!move) {
        link.visible = false;
        link.opacity = 0;
        continue;
      }
      // The link that runs next is steel; the ones behind it cool toward the
      // pewter of an origin ring, so the chain reads in order along its lines.
      const depth = moves.length > 1 ? index / (moves.length - 1) : 0;
      link.color.copy(THREAD_HEAD).lerp(THREAD_TAIL, depth * 0.85);
      const from = squareToWorld(move.from, BOARD_TOP);
      const to = squareToWorld(move.to, BOARD_TOP);
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.001) {
        link.visible = false;
        link.opacity = 0;
        continue;
      }
      link.position.set((from.x + to.x) / 2, BOARD_TOP + 0.018, (from.z + to.z) / 2);
      link.spin = Math.atan2(-dz, dx);
      // Pulled in at both ends so the thread starts and stops inside the two
      // reticles rather than crossing them.
      link.scale.set(Math.max(0.2, length - TILE * 0.5), 1, TILE * 0.22);
      link.visible = true;
    }
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private buildBase(): void {
    const size = TILE * 8 + 1.5;
    const geometry = this.track(new RoundedBoxGeometry(size, 0.62, size, 4, 0.09));
    // Box faces are +x, -x, +y, -y, +z, -z: the five stone faces become one
    // draw and the inlaid top another, instead of one draw per face.
    groupFacesByMaterial(geometry, [0, 0, 1, 0, 0, 0]);
    const stone = this.track(
      new THREE.MeshStandardMaterial({ color: 0x3b342b, roughness: 0.72, metalness: 0.25 }),
    );
    this.baseMaterial = stone;
    const top = this.track(
      new THREE.MeshStandardMaterial({
        map: this.track(boardBorderTexture()),
        color: 0xbfae8e,
        roughness: 0.55,
        metalness: 0.45,
        envMapIntensity: 1.1,
      }),
    );
    this.borderMaterial = top;
    const base = new THREE.Mesh(geometry, [stone, top]);
    base.name = "board-base";
    base.position.y = -0.42;
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);

    // Bronze trim: a thin torus-like frame catching bloom at grazing angles.
    const trimGeometry = this.track(new RoundedBoxGeometry(size + 0.18, 0.14, size + 0.18, 3, 0.06));
    const trim = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x8a6a33,
        roughness: 0.28,
        metalness: 0.95,
        emissive: 0x2a1a06,
        emissiveIntensity: 0.4,
        envMapIntensity: 1.4,
      }),
    );
    this.trimMaterial = trim;
    const trimMesh = new THREE.Mesh(trimGeometry, trim);
    trimMesh.name = "board-trim";
    trimMesh.position.y = -0.7;
    trimMesh.castShadow = true;
    this.group.add(trimMesh);
  }

  private buildHighlights(): void {
    let index = 0;
    for (let rank = 1; rank <= 8; rank += 1) {
      for (let fileIndex = 0; fileIndex < 8; fileIndex += 1) {
        const square = `${FILES[fileIndex]}${rank}`;
        const glow = new Decal();
        glow.position.copy(squareToWorld(square, BOARD_TOP + 0.008));
        const marker = new Decal();
        marker.position.copy(squareToWorld(square, BOARD_TOP + 0.016));
        const xray = new Decal();
        xray.position.copy(squareToWorld(square, BOARD_TOP + 0.017));
        const beam = new Decal();
        beam.position.copy(squareToWorld(square, BOARD_TOP + 0.275));
        this.slots.set(square, {
          glow,
          marker,
          xray,
          beam,
          markerStyle: null,
          kind: null,
          pulse: false,
          age: 0,
          phase: (index % 7) * 0.42,
        });
        index += 1;
      }
    }
  }

  /**
   * One dark veil per square, sitting just above the stone. While a piece is
   * selected every square it cannot reach is dimmed, so the lit destinations
   * read instantly instead of competing with 64 evenly-lit tiles.
   */
  private buildShroud(): void {
    for (let rank = 1; rank <= 8; rank += 1) {
      for (let fileIndex = 0; fileIndex < 8; fileIndex += 1) {
        const square = `${FILES[fileIndex]}${rank}`;
        const veil = new Decal();
        veil.color.setHex(SHROUD_COLOR);
        veil.position.copy(squareToWorld(square, BOARD_TOP + 0.004));
        this.shrouds.set(square, { veil, target: 0, current: 0, delay: 0 });
      }
    }
  }

  /**
   * Veils every square except `reachable`. Pass `null` to lift the veil.
   * `origin` staggers the fade so the shadow closes in from the chosen piece.
   */
  setShroud(reachable: Iterable<SquareId> | null, origin?: SquareId): void {
    if (!reachable) {
      for (const slot of this.shrouds.values()) {
        slot.target = 0;
        slot.delay = 0;
      }
      return;
    }
    const lit = new Set<SquareId>(reachable);
    const originPosition = origin ? squareToWorld(origin) : null;
    for (const [square, slot] of this.shrouds) {
      const clear = lit.has(square);
      slot.target = clear ? 0 : SHROUD_OPACITY;
      slot.delay =
        clear || !originPosition
          ? 0
          : Math.min((squareToWorld(square).distanceTo(originPosition) / TILE) * 0.016, 0.12);
    }
  }

  private updateShroud(delta: number): void {
    for (const slot of this.shrouds.values()) {
      if (slot.delay > 0) {
        slot.delay -= delta;
        if (slot.delay > 0) continue;
      }
      if (Math.abs(slot.target - slot.current) < 0.002) {
        if (slot.current !== slot.target) {
          slot.current = slot.target;
          slot.veil.opacity = slot.current;
          slot.veil.visible = slot.current > 0.004;
        }
        continue;
      }
      // Closes in a touch slower than it lifts, so releasing feels snappy.
      const speed = slot.target > slot.current ? 8 : 13;
      slot.current += (slot.target - slot.current) * Math.min(1, delta * speed);
      slot.veil.opacity = slot.current;
      slot.veil.visible = slot.current > 0.004;
    }
  }

  /** Pool of reusable shockwave rings + flares for capture impacts. */
  private buildImpactWaves(): void {
    for (let i = 0; i < 4; i += 1) {
      this.waves.push({ ring: new Decal(), flare: new Decal(), age: 0, duration: 0.5, active: false });
    }
  }

  /** Pool of reusable arrival ripples: a dust ring plus a soft ground glow. */
  private buildLandingRipples(): void {
    for (let i = 0; i < 5; i += 1) {
      this.landings.push({
        ring: new Decal(),
        glow: new Decal(),
        age: 0,
        duration: 0.7,
        strength: 1,
        active: false,
      });
    }
  }

  /**
   * Arrival on a square: a dust ring rolls outward from under the figure's feet
   * over a short bloom of faction light, and the tile takes a small dip. Softer
   * and slower than {@link impact} — this is weight settling, not a blow.
   */
  land(square: SquareId, color = 0xffd6a0, strength = 1): void {
    const centre = squareToWorld(square, BOARD_TOP + 0.018);

    const ripple = this.landings[this.landingCursor % this.landings.length];
    this.landingCursor += 1;
    ripple.age = 0;
    ripple.duration = 0.62 + strength * 0.16;
    ripple.strength = strength;
    ripple.active = true;
    ripple.ring.position.copy(centre);
    ripple.ring.spin = Math.random() * Math.PI * 2;
    ripple.ring.scale.setScalar(0.2);
    ripple.ring.visible = true;
    ripple.ring.color.setHex(color);
    ripple.glow.position.copy(centre).setY(BOARD_TOP + 0.014);
    ripple.glow.scale.setScalar(0.6);
    ripple.glow.visible = true;
    ripple.glow.color.setHex(color);

    this.joltTiles(square, strength * 0.42, 1.4);
  }

  /**
   * Capture impact on a square: a white-hot flash that decays into a coloured
   * shockwave ring, while the struck tile and its neighbours are jolted out of
   * the board and bounce back into place.
   */
  impact(square: SquareId, color = 0xff6a3c, strength = 1): void {
    const centre = squareToWorld(square, BOARD_TOP + 0.02);

    const wave = this.waves[this.waveCursor % this.waves.length];
    this.waveCursor += 1;
    wave.age = 0;
    wave.duration = 0.6;
    wave.active = true;
    wave.ring.position.copy(centre);
    wave.ring.spin = Math.random() * Math.PI;
    wave.ring.visible = true;
    wave.ring.color.setHex(color);
    wave.flare.position.copy(centre).setY(BOARD_TOP + 0.03);
    wave.flare.visible = true;
    wave.flare.color.setHex(0xfff3d2);

    this.joltTiles(square, strength, 2.2);
  }

  /** Shock spreads outward: neighbours kick later and weaker than the centre. */
  private joltTiles(square: SquareId, strength: number, reach: number): void {
    if (strength <= 0) return;
    const origin = squareToWorld(square);
    for (const [target, tile] of this.tileBySquare) {
      const distance = squareToWorld(target).distanceTo(origin) / TILE;
      if (distance > reach) continue;
      const falloff = Math.max(0, 1 - distance / (reach + 0.2));
      const amount = strength * falloff * falloff;
      if (amount < 0.04) continue;
      this.jolts = this.jolts.filter((entry) => entry.tile !== tile);
      this.jolts.push({
        tile,
        home: (tile.userData.home as THREE.Vector3).clone(),
        age: -distance * 0.035,
        strength: amount,
        duration: 0.5 + distance * 0.06,
        seed: Math.random() * Math.PI * 2,
      });
    }
  }

  private updateImpacts(delta: number): void {
    for (let i = this.jolts.length - 1; i >= 0; i -= 1) {
      const jolt = this.jolts[i];
      jolt.age += delta;
      if (jolt.age < 0) continue;
      const t = jolt.age / jolt.duration;
      if (t >= 1) {
        jolt.tile.position.copy(jolt.home);
        jolt.tile.rotation.set(0, 0, 0);
        this.syncTile(jolt.tile);
        this.jolts.splice(i, 1);
        continue;
      }
      // Damped oscillation: punched down first, then settling.
      const decay = Math.exp(-t * 6.5) * (1 - t);
      const swing = Math.sin(jolt.age * 34 + jolt.seed) * decay * jolt.strength;
      jolt.tile.position.set(
        jolt.home.x + Math.sin(jolt.age * 41 + jolt.seed) * decay * jolt.strength * 0.035,
        jolt.home.y - swing * 0.13,
        jolt.home.z + Math.cos(jolt.age * 38 + jolt.seed) * decay * jolt.strength * 0.035,
      );
      jolt.tile.rotation.set(swing * 0.05, 0, Math.cos(jolt.age * 30 + jolt.seed) * decay * jolt.strength * 0.05);
      this.syncTile(jolt.tile);
    }

    for (const wave of this.waves) {
      if (!wave.active) continue;
      wave.age += delta;
      const t = wave.age / wave.duration;
      if (t >= 1) {
        wave.active = false;
        wave.ring.visible = false;
        wave.flare.visible = false;
        wave.ring.opacity = 0;
        wave.flare.opacity = 0;
        continue;
      }
      const eased = 1 - Math.pow(1 - t, 2.6);
      wave.ring.scale.setScalar(0.25 + eased * 1.35);
      wave.ring.opacity = Math.pow(1 - t, 1.7) * 0.95;
      wave.ring.spin += delta * 0.6;

      // The flare is a two-frame blowout: peaks instantly, gone in ~0.18s.
      const flareT = Math.min(1, wave.age / 0.18);
      wave.flare.scale.setScalar(0.5 + flareT * 1.1);
      wave.flare.opacity = Math.pow(1 - flareT, 2) * 1.1;
      wave.flare.visible = flareT < 1;
    }

    for (const ripple of this.landings) {
      if (!ripple.active) continue;
      ripple.age += delta;
      const t = ripple.age / ripple.duration;
      if (t >= 1) {
        ripple.active = false;
        ripple.ring.visible = false;
        ripple.glow.visible = false;
        ripple.ring.opacity = 0;
        ripple.glow.opacity = 0;
        continue;
      }
      // The dust rolls out fast then coasts; the light under it dies quicker.
      const eased = 1 - Math.pow(1 - t, 3);
      ripple.ring.scale.setScalar(0.2 + eased * (0.85 + ripple.strength * 0.5));
      ripple.ring.opacity = Math.sin(Math.PI * Math.pow(t, 0.55)) * 0.55 * ripple.strength;
      ripple.ring.spin += delta * 0.35;

      const glowT = Math.min(1, ripple.age / (ripple.duration * 0.45));
      ripple.glow.scale.setScalar(0.6 + glowT * 0.75);
      ripple.glow.opacity = Math.pow(1 - glowT, 2.1) * 0.5 * ripple.strength;
      ripple.glow.visible = glowT < 1;
    }
  }

  clearHighlights(kinds?: HighlightKind[]): void {
    if (!kinds) {
      this.setShroud(null);
      this.setPremoveLinks([]);
      this.setPremoveCancel(null);
      this.setPremoveOrders([]);
    }
    for (const slot of this.slots.values()) {
      if (kinds && slot.kind && !kinds.includes(slot.kind)) continue;
      slot.kind = null;
      slot.pulse = false;
      slot.age = 0;
      for (const decal of [slot.glow, slot.marker, slot.xray, slot.beam]) {
        decal.visible = false;
        decal.opacity = 0;
      }
    }
  }

  /**
   * Lights a square up. `delay` staggers the pop-in so a fan of legal moves
   * ripples outward from the selected piece instead of appearing all at once.
   */
  setHighlight(square: SquareId, kind: HighlightKind, pulse = false, delay = 0): void {
    const slot = this.slots.get(square);
    if (!slot) return;
    const restart = slot.kind !== kind;
    slot.kind = kind;
    slot.pulse = pulse;
    if (restart) slot.age = -delay;

    const color = HIGHLIGHT_COLORS[kind];
    slot.glow.color.setHex(color);
    slot.marker.color.setHex(color);
    slot.xray.color.setHex(color);
    slot.beam.color.setHex(color);

    slot.markerStyle = this.markerStyles[kind];
    slot.marker.spin = 0;
    slot.xray.spin = 0;

    const visible = slot.age >= 0;
    const hasMarker = slot.markerStyle !== null;
    slot.glow.visible = visible;
    slot.marker.visible = visible && hasMarker;
    slot.xray.visible = visible && hasMarker && XRAY_OPACITY[kind] > 0;
    slot.beam.visible = visible && BEAM_OPACITY[kind] > 0;
  }

  /**
   * Pops the dismiss coin in, bobs it, and warms it under the pointer. The bob
   * is what stops it reading as part of the stone: it hangs in the air over the
   * square, so it is plainly a control rather than another marker.
   */
  private updatePremoveCancel(delta: number): void {
    if (!this.coin.visible || !this.premoveCancelSquare) return;
    this.premoveCancelAge = Math.min(this.premoveCancelAge + delta, POP_DURATION);
    const pop = easeOutBack(this.premoveCancelAge / POP_DURATION);
    const target = this.premoveCancelHot ? 1 : 0;
    this.premoveCancelHeat += (target - this.premoveCancelHeat) * Math.min(1, delta * 12);
    const heat = this.premoveCancelHeat;
    const bob = Math.sin(this.elapsed * 2.2) * 0.03;
    const centre = squareToWorld(this.premoveCancelSquare, BOARD_TOP);
    this.coin.position.set(centre.x, BOARD_TOP + CANCEL_LIFT + bob, centre.z);
    this.coin.scale.setScalar(CANCEL_SIZE * (0.4 + pop * 0.6) * (1 + heat * 0.16));
    this.coin.opacity = (0.78 + heat * 0.22) * Math.min(1, pop);
    this.coin.color.copy(CANCEL_COLD).lerp(CANCEL_HOT, heat);
    this.premoveCancel.position.copy(this.coin.position);
    this.premoveCancel.scale.copy(this.coin.scale);
  }

  /**
   * Pops each numeral in. They do not bob: bobbing is what marks the coin out
   * as a control, and a number you can press would be a lie.
   */
  private updatePremoveOrders(delta: number): void {
    for (let index = 0; index < this.premoveOrders.length; index += 1) {
      const order = this.premoveOrders[index];
      if (!order.visible) continue;
      this.premoveOrderAges[index] = Math.min(this.premoveOrderAges[index] + delta, POP_DURATION);
      const pop = easeOutBack(this.premoveOrderAges[index] / POP_DURATION);
      order.scale.setScalar(ORDER_SIZE * (0.5 + pop * 0.5));
      order.opacity = 0.92 * Math.min(1, pop);
    }
  }

  /**
   * Silences the overlays that deliberately ignore the depth buffer — the x-ray
   * reticles. They are drawn through everything in the way, a modal panel
   * included, so they have to stand down while one is up.
   */
  setOverlaysMuted(muted: boolean): void {
    if (this.overlaysMuted === muted) return;
    this.overlaysMuted = muted;
    this.coin.visible = !muted && this.premoveCancelSquare !== null;
    for (const order of this.premoveOrders) {
      if (muted) order.visible = false;
      else if (order.opacity > 0) order.visible = true;
    }
    if (!muted) return;
    for (const slot of this.slots.values()) {
      slot.xray.visible = false;
      slot.xray.opacity = 0;
    }
  }

  setHover(square: SquareId | null): void {
    if (!square) {
      this.hoverRing.opacity = 0;
      return;
    }
    this.hoverRing.position.copy(squareToWorld(square, BOARD_TOP + 0.014));
    this.hoverRing.opacity = 0.5;
  }

  update(delta: number): void {
    this.elapsed += delta;
    this.updateImpacts(delta);
    this.updateShroud(delta);
    if (this.premoveLinks[0].visible) {
      const wave = (Math.sin(this.elapsed * 2.2) + 1) * 0.5;
      const opacity = 0.16 + wave * 0.16;
      for (const link of this.premoveLinks) {
        if (link.visible) link.opacity = opacity;
      }
    }
    this.updatePremoveCancel(delta);
    this.updatePremoveOrders(delta);
    this.updateHighlights(delta);
    this.flush();
  }

  private updateHighlights(delta: number): void {
    for (const slot of this.slots.values()) {
      const kind = slot.kind;
      if (!kind) continue;

      slot.age += delta;
      if (slot.age < 0) {
        slot.glow.visible = false;
        slot.marker.visible = false;
        slot.xray.visible = false;
        slot.beam.visible = false;
        continue;
      }

      const hasMarker = slot.markerStyle !== null;
      const hasXray = hasMarker && XRAY_OPACITY[kind] > 0 && !this.overlaysMuted;
      const hasBeam = BEAM_OPACITY[kind] > 0;
      slot.glow.visible = true;
      slot.marker.visible = hasMarker;
      slot.xray.visible = hasXray;
      slot.beam.visible = hasBeam;

      // Pop-in: overshoot the scale, then breathe.
      const t = Math.min(slot.age / POP_DURATION, 1);
      const pop = easeOutBack(t);
      const wave = (Math.sin(this.elapsed * (slot.pulse ? 5.6 : 3.4) + slot.phase) + 1) * 0.5;
      const breath = slot.pulse ? 0.45 + wave * 0.85 : 0.8 + wave * 0.25;
      const fade = t;

      slot.glow.opacity = GLOW_OPACITY[kind] * breath * fade;
      slot.glow.scale.setScalar(0.55 + pop * 0.45);

      if (hasMarker) {
        slot.marker.opacity = MARKER_OPACITY[kind] * (0.72 + breath * 0.34) * fade;
        slot.marker.scale.setScalar(0.35 + pop * 0.65 + (slot.pulse ? wave * 0.05 : wave * 0.02));
        slot.marker.spin += delta * MARKER_SPIN[kind];
      }

      if (hasXray) {
        // Locked to the reticle it shadows, a touch smaller so the two read as
        // one mark rather than a double exposure when nothing is in the way.
        slot.xray.opacity = XRAY_OPACITY[kind] * (0.66 + breath * 0.34) * fade;
        slot.xray.scale.setScalar(slot.marker.scale.x * 0.9);
        slot.xray.spin = slot.marker.spin;
      }

      if (hasBeam) {
        slot.beam.opacity = BEAM_OPACITY[kind] * breath * fade;
        slot.beam.scale.set(1, 0.4 + pop * 0.6, 1);
        slot.beam.position.y = BOARD_TOP + 0.275 * (0.4 + pop * 0.6);
      }
    }
  }

  /**
   * Writes everything lit into the three batches, in the order the old meshes'
   * render orders put them: inside one draw, instances blend in sequence, so
   * the veils go down before the glows and the numerals before the coin.
   */
  private flush(): void {
    const { floor, marks, xrays, styles } = this;

    floor.begin();
    for (const slot of this.shrouds.values()) floor.push(slot.veil, styles.veil);
    for (const slot of this.slots.values()) floor.push(slot.glow, styles.glow);
    floor.end();

    marks.begin();
    for (const slot of this.slots.values()) {
      marks.push(slot.beam, styles.beam);
      if (slot.markerStyle) marks.push(slot.marker, slot.markerStyle);
    }
    for (const link of this.premoveLinks) marks.push(link, styles.thread);
    marks.push(this.hoverRing, styles.hover);
    for (const ripple of this.landings) {
      marks.push(ripple.glow, styles.landingGlow);
      marks.push(ripple.ring, styles.landingRing);
    }
    for (const wave of this.waves) {
      marks.push(wave.ring, styles.impactRing);
      marks.push(wave.flare, styles.flare);
    }
    marks.end();

    xrays.begin();
    for (const slot of this.slots.values()) {
      if (slot.markerStyle) xrays.push(slot.xray, slot.markerStyle);
    }
    this.premoveOrders.forEach((order, index) => xrays.push(order, styles.orders[index]));
    xrays.push(this.coin, styles.coin);
    xrays.end();
  }

  /**
   * Retunes the playing surface for an arena theme. The dark squares carry the
   * most weight here: near-black basalt swallows the obsidian army under low
   * light, so daylight themes lift them to a readable slate.
   */
  applyArena(look: ArenaLook): void {
    this.lightTileMaterial.color.setHex(look.board.light);
    this.darkTileMaterial.color.setHex(look.board.dark);
    this.baseMaterial?.color.setHex(look.board.base);
    this.borderMaterial?.color.setHex(look.board.border);
    this.trimMaterial?.color.setHex(look.board.trim);
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables = [];
    this.slots.clear();
    this.shrouds.clear();
    this.tileInstances.clear();
    this.group.clear();
  }
}
