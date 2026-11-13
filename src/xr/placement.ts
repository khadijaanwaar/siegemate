import * as THREE from "three";

/** Seconds of searching for a table before the board appears at seat height anyway. */
export const FALLBACK_AFTER_S = 4;
/** A lost hit keeps the reticle where it was for this long, so a flicker does not reset aiming. */
const AIM_GRACE_S = 0.5;
/** Seated reach: the board centre this far ahead of the eyes... */
const FALLBACK_AHEAD_M = 0.45;
/** ...and this far below them (a table under a seated player's elbows). */
const FALLBACK_BELOW_M = 0.4;
/** cos(25°): flatter than this counts as a table top. */
const MIN_UP_DOT = 0.9;
/** A table the player can reach: this far away at most, measured flat... */
const MAX_REACH_M = 1.0;
/** ...and between these depths below the eyes (a desk seated, a counter standing; never the floor). */
const MIN_DROP_M = 0.15;
const MAX_DROP_M = 0.95;

export interface BoardPose {
  /** The surface point the board stands on, in the floor-level reference space. */
  position: THREE.Vector3;
  /** Rotation about +Y; 0 puts white's side toward a player facing -Z. */
  yaw: number;
}

export interface HeadPose {
  position: THREE.Vector3;
  /** Rotation about +Y of where the player faces; 0 is -Z. */
  yaw: number;
}

export interface SurfaceHit {
  position: THREE.Vector3;
  normal: THREE.Vector3;
}

export type PlacementState = "searching" | "aiming" | "placed" | "fallback";

const UP = new THREE.Vector3(0, 1, 0);

export function fallbackBoardPose(head: HeadPose): BoardPose {
  const position = new THREE.Vector3(
    head.position.x - Math.sin(head.yaw) * FALLBACK_AHEAD_M,
    head.position.y - FALLBACK_BELOW_M,
    head.position.z - Math.cos(head.yaw) * FALLBACK_AHEAD_M,
  );
  return { position, yaw: head.yaw };
}

export function isTableSurface(normal: THREE.Vector3): boolean {
  return normal.dot(UP) >= MIN_UP_DOT;
}

/**
 * A surface the board belongs on: within arm's reach and at table height. A
 * phone held up, or a headset glancing down, mostly finds the floor a metre or
 * two away; a board stood there is tiny and out of reach.
 */
export function isReachableSurface(point: THREE.Vector3, head: THREE.Vector3): boolean {
  const reach = Math.hypot(point.x - head.x, point.z - head.z);
  const drop = head.y - point.y;
  return reach <= MAX_REACH_M && drop >= MIN_DROP_M && drop <= MAX_DROP_M;
}

/** The yaw that turns the board's white side (+Z) toward `head`. */
export function yawFacing(board: THREE.Vector3, head: THREE.Vector3): number {
  return Math.atan2(head.x - board.x, head.z - board.z);
}

/**
 * Where the board goes. Fed one hit-test result per frame (or none):
 * `searching` until a flat surface is under the reticle, `aiming` while one
 * is, `placed` once the player pinches, and `fallback` when no table turns up
 * within {@link FALLBACK_AFTER_S}. A fallback never jumps to a table found
 * later on its own; the player asks for that with {@link Placement.replace}.
 */
export class Placement {
  private current: PlacementState = "searching";
  private searchFrom: number | null = null;
  private lastHitAt = Number.NEGATIVE_INFINITY;
  private aim: BoardPose | null = null;
  private settled: BoardPose | null = null;

  get state(): PlacementState {
    return this.current;
  }

  /** The reticle while aiming, the board once placed or fallen back, else null. */
  get pose(): BoardPose | null {
    if (this.current === "aiming") return this.aim;
    if (this.current === "placed" || this.current === "fallback") return this.settled;
    return null;
  }

  update(now: number, head: HeadPose, hit: SurfaceHit | null): void {
    if (this.current === "placed" || this.current === "fallback") return;
    if (this.searchFrom === null) this.searchFrom = now;

    if (hit && isTableSurface(hit.normal) && isReachableSurface(hit.position, head.position)) {
      this.lastHitAt = now;
      this.aim = { position: hit.position.clone(), yaw: yawFacing(hit.position, head.position) };
      this.current = "aiming";
      return;
    }

    if (this.current === "aiming" && now - this.lastHitAt <= AIM_GRACE_S) return;
    this.current = "searching";
    this.aim = null;

    const since = Math.max(this.searchFrom, Number.isFinite(this.lastHitAt) ? this.lastHitAt : this.searchFrom);
    if (now - since >= FALLBACK_AFTER_S) {
      this.settled = fallbackBoardPose(head);
      this.current = "fallback";
    }
  }

  /** The player pinched while aiming: the board goes on the table. */
  confirm(): BoardPose | null {
    if (this.current !== "aiming" || !this.aim) return null;
    this.settled = this.aim;
    this.current = "placed";
    return this.settled;
  }

  /** "Re-place board": start looking for a table again. */
  replace(now: number): void {
    this.current = "searching";
    this.searchFrom = now;
    this.lastHitAt = Number.NEGATIVE_INFINITY;
    this.aim = null;
    this.settled = null;
  }
}
