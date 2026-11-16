import * as THREE from "three";

import type { SaveStorage } from "../core/persist";
import { SCALE_LIMITS } from "./tableRig";

/** The board's size on first entry: a touch larger than 5 cm squares, so the figures read. */
export const DEFAULT_BOARD_SIZE = 1.15;
export const BOARD_SIZE_KEY = "mr-chess:board-size";

/** Both hands must close within this long of each other to take the board... */
export const TWO_HAND_SYNC_S = 0.3;
/** ...and within this far of it (two pinches across the room are not a grab). */
export const TWO_HAND_REACH_M = 0.1;
/** Nothing moves until the hands carry, turn or spread past one of these. */
export const DEAD_ZONE = { moveM: 0.02, turnRad: THREE.MathUtils.degToRad(5), spread: 0.05 } as const;
/** The hands' span may change this much (as a ratio) without resizing the board. */
const SCALE_BAND = 0.05;

export interface TwoHandStart {
  left: THREE.Vector3;
  right: THREE.Vector3;
  /** The board's pose and size when the second hand closed. */
  position: THREE.Vector3;
  yaw: number;
  scale: number;
  /** On a real table the board slides on it; on the plinth it follows the hands up and down too. */
  keepHeight: boolean;
}

export interface BoardTransform {
  position: THREE.Vector3;
  yaw: number;
  scale: number;
}

/**
 * Two pinching hands move, turn and resize the board together: the midpoint
 * carries it, the angle of the line between the hands (seen from above) turns
 * it, and the distance between them scales it. Everything is relative to
 * `start` (the moment the hands left the dead zone, see {@link pastDeadZone}),
 * so nothing jumps when the gesture starts.
 */
export function twoHandTransform(start: TwoHandStart, now: { left: THREE.Vector3; right: THREE.Vector3 }): BoardTransform {
  const startSpan = start.left.distanceTo(start.right);
  const span = now.left.distanceTo(now.right);
  // A band around 1: carrying and turning never resize by accident, and past
  // it the size follows on smoothly from where the band ends (no jump).
  const ratio = span / Math.max(startSpan, 1e-4);
  const banded = ratio > 1 + SCALE_BAND ? ratio / (1 + SCALE_BAND) : ratio < 1 - SCALE_BAND ? ratio / (1 - SCALE_BAND) : 1;
  const scale = THREE.MathUtils.clamp(start.scale * banded, SCALE_LIMITS.min, SCALE_LIMITS.max);

  const startMid = new THREE.Vector3().addVectors(start.left, start.right).multiplyScalar(0.5);
  const mid = new THREE.Vector3().addVectors(now.left, now.right).multiplyScalar(0.5);
  const position = start.position.clone().add(mid.sub(startMid));
  if (start.keepHeight) position.y = start.position.y;

  const angle = (a: THREE.Vector3, b: THREE.Vector3): number => Math.atan2(b.z - a.z, b.x - a.x);
  const yaw = start.yaw - (angle(now.left, now.right) - angle(start.left, start.right));

  return { position, yaw, scale };
}

/**
 * True once two hands that closed on the board have carried it 2 cm, turned it
 * 5 degrees or spread 5%: below that it is the wobble of closing two pinches,
 * and the board stays exactly where it is.
 */
export function pastDeadZone(start: { left: THREE.Vector3; right: THREE.Vector3 }, now: { left: THREE.Vector3; right: THREE.Vector3 }): boolean {
  const startMid = new THREE.Vector3().addVectors(start.left, start.right).multiplyScalar(0.5);
  const mid = new THREE.Vector3().addVectors(now.left, now.right).multiplyScalar(0.5);
  if (mid.distanceTo(startMid) > DEAD_ZONE.moveM) return true;
  const angle = (a: THREE.Vector3, b: THREE.Vector3): number => Math.atan2(b.z - a.z, b.x - a.x);
  const turn = Math.abs(THREE.MathUtils.euclideanModulo(angle(now.left, now.right) - angle(start.left, start.right) + Math.PI, Math.PI * 2) - Math.PI);
  if (turn > DEAD_ZONE.turnRad) return true;
  const ratio = now.left.distanceTo(now.right) / Math.max(start.left.distanceTo(start.right), 1e-4);
  return Math.abs(ratio - 1) > DEAD_ZONE.spread;
}

export function loadBoardSize(storage: SaveStorage): number {
  try {
    const value = Number.parseFloat(storage.getItem(BOARD_SIZE_KEY) ?? "");
    if (!Number.isFinite(value)) return DEFAULT_BOARD_SIZE;
    return THREE.MathUtils.clamp(value, SCALE_LIMITS.min, SCALE_LIMITS.max);
  } catch {
    return DEFAULT_BOARD_SIZE;
  }
}

export function saveBoardSize(storage: SaveStorage, size: number): void {
  try {
    storage.setItem(BOARD_SIZE_KEY, size.toFixed(3));
  } catch {
    // The size simply is not remembered.
  }
}
