import * as THREE from "three";

import type { SaveStorage } from "../core/persist";
import { SCALE_LIMITS } from "./tableRig";

/** The board's size on first entry: a touch larger than 5 cm squares, so the figures read. */
export const DEFAULT_BOARD_SIZE = 1.15;
export const BOARD_SIZE_KEY = "mr-chess:board-size";

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
 * it, and the distance between them scales it. Everything is relative to the
 * moment the second hand closed, so nothing jumps when the gesture starts.
 */
export function twoHandTransform(start: TwoHandStart, now: { left: THREE.Vector3; right: THREE.Vector3 }): BoardTransform {
  const startSpan = start.left.distanceTo(start.right);
  const span = now.left.distanceTo(now.right);
  const scale = THREE.MathUtils.clamp(start.scale * (span / Math.max(startSpan, 1e-4)), SCALE_LIMITS.min, SCALE_LIMITS.max);

  const startMid = new THREE.Vector3().addVectors(start.left, start.right).multiplyScalar(0.5);
  const mid = new THREE.Vector3().addVectors(now.left, now.right).multiplyScalar(0.5);
  const position = start.position.clone().add(mid.sub(startMid));
  if (start.keepHeight) position.y = start.position.y;

  const angle = (a: THREE.Vector3, b: THREE.Vector3): number => Math.atan2(b.z - a.z, b.x - a.x);
  const yaw = start.yaw - (angle(now.left, now.right) - angle(start.left, start.right));

  return { position, yaw, scale };
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
