import * as THREE from "three";

/** Game units (metres in the 2D hall) to real metres on the table: a 1.02 tile becomes 5 cm. */
export const TABLE_SCALE = 0.049;

/** How far the board's stone base reaches below the tile tops, in game units. */
export const BOARD_DEPTH_UNITS = 0.75;

/** The player can pinch the board between these multiples of its default size. */
export const SCALE_LIMITS = { min: 0.6, max: 1.6 } as const;

/** Real metres of the stand-in slab shown when no real table was found. */
const PLINTH = { width: 0.52, depth: 0.52, height: 0.03 } as const;

/**
 * The board's place in the room. `root` carries the real-world pose (metres,
 * floor-level reference space); `content` is scaled from game units, so the
 * scene engine can re-parent the board, the figures and their effects under it
 * and keep thinking in the units it was written in.
 */
export class TableRig {
  readonly root = new THREE.Group();
  readonly content = new THREE.Group();
  private readonly plinth: THREE.Mesh;
  private multiplier = 1;

  constructor() {
    this.root.name = "table_rig";
    this.content.name = "table_content";
    this.root.add(this.content);

    const material = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.82, metalness: 0.05 });
    this.plinth = new THREE.Mesh(new THREE.BoxGeometry(PLINTH.width, PLINTH.height, PLINTH.depth), material);
    this.plinth.name = "table_plinth";
    this.plinth.visible = false;
    this.root.add(this.plinth);

    this.applyScale();
  }

  /** Real metres per game unit at the current size. */
  get unitsToMeters(): number {
    return TABLE_SCALE * this.multiplier;
  }

  /** `position` is the surface the board stands on; yaw turns white's side toward the player at 0 when facing -Z. */
  setPose(position: THREE.Vector3, yaw: number): void {
    this.root.position.copy(position);
    this.root.rotation.set(0, yaw, 0);
    this.root.updateMatrixWorld(true);
  }

  /** Returns the multiplier actually applied after clamping. */
  setScale(multiplier: number): number {
    this.multiplier = THREE.MathUtils.clamp(multiplier, SCALE_LIMITS.min, SCALE_LIMITS.max);
    this.applyScale();
    return this.multiplier;
  }

  get scaleMultiplier(): number {
    return this.multiplier;
  }

  get plinthVisible(): boolean {
    return this.plinth.visible;
  }

  /** The stand-in slab under the board, for when it hangs at seat height with no real table under it. */
  showPlinth(visible: boolean): void {
    this.plinth.visible = visible;
  }

  /**
   * Metres along `ray` (world space) to where it meets the board's top within
   * `halfUnits` (game units) of its centre, or null when it misses or points away.
   * A plane test: cheap enough for every hand, every frame.
   */
  rayToBoard(ray: THREE.Ray, halfUnits: number): number | null {
    this.root.updateMatrixWorld(true);
    this.inverse.copy(this.root.matrixWorld).invert();
    const local = this.localRay.copy(ray).applyMatrix4(this.inverse);
    const top = this.content.position.y;
    if (Math.abs(local.direction.y) < 1e-6) return null;
    const distance = (top - local.origin.y) / local.direction.y;
    if (distance < 0) return null;
    const half = halfUnits * this.unitsToMeters;
    const x = local.origin.x + local.direction.x * distance;
    const z = local.origin.z + local.direction.z * distance;
    return Math.abs(x) <= half && Math.abs(z) <= half ? distance : null;
  }

  /** Metres from a world point to the board's block (the surface it stands on up to its top), `halfUnits` wide each way. */
  distanceToBoard(point: THREE.Vector3, halfUnits: number): number {
    this.root.updateMatrixWorld(true);
    this.inverse.copy(this.root.matrixWorld).invert();
    const local = this.localPoint.copy(point).applyMatrix4(this.inverse);
    const half = halfUnits * this.unitsToMeters;
    const dx = Math.max(Math.abs(local.x) - half, 0);
    const dz = Math.max(Math.abs(local.z) - half, 0);
    const dy = local.y > this.content.position.y ? local.y - this.content.position.y : Math.max(-local.y, 0);
    return Math.hypot(dx, dy, dz);
  }

  private readonly localPoint = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();
  private readonly localRay = new THREE.Ray();

  toWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.content.localToWorld(out.copy(local));
  }

  toLocal(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.content.worldToLocal(out.copy(world));
  }

  dispose(): void {
    this.plinth.geometry.dispose();
    (this.plinth.material as THREE.Material).dispose();
    this.root.removeFromParent();
  }

  private applyScale(): void {
    const scale = this.unitsToMeters;
    this.content.scale.setScalar(scale);
    // The base's underside rests on the rig's origin; the plinth, when shown,
    // hangs below it so its top is flush with that surface.
    this.content.position.y = BOARD_DEPTH_UNITS * scale;
    this.plinth.position.y = -PLINTH.height / 2;
    // The stand-in grows with the board, so a bigger board never overhangs it.
    this.plinth.scale.set(this.multiplier, 1, this.multiplier);
    this.root.updateMatrixWorld(true);
  }
}
