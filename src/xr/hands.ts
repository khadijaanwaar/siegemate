import * as THREE from "three";

/** Fingertips closer than this start a pinch... */
export const PINCH_START_M = 0.015;
/** ...and must open past this to end it, so a wobble at the edge cannot flicker. */
export const PINCH_END_M = 0.025;
/** A pinch survives a tracking dropout this short; longer and the hand is lost. */
export const TRACKING_GRACE_S = 0.15;
/** Palm-to-head alignment at which a pinch is the Quest system gesture, not ours. */
const SYSTEM_GESTURE_DOT = 0.6;

export type PinchEvent = "start" | "hold" | "end" | "lost";

/**
 * Pinch detection from the thumb and index tips of one tracked hand. Hand
 * tracking drops joints for a frame or two all the time (fast motion, the
 * other hand in the way), so a held pinch rides out short gaps and only a long
 * one is reported as `lost`. The caller decides what `lost` means; for a
 * carried figure it means "put it back", never "drop it here".
 */
export class PinchTracker {
  readonly point = new THREE.Vector3();
  private active = false;
  private lastSeen = Number.NEGATIVE_INFINITY;

  get pinching(): boolean {
    return this.active;
  }

  update(
    thumbTip: THREE.Vector3 | null,
    indexTip: THREE.Vector3 | null,
    now: number,
    options: { allowStart?: boolean } = {},
  ): PinchEvent | null {
    if (!thumbTip || !indexTip) {
      if (!this.active) return null;
      if (now - this.lastSeen <= TRACKING_GRACE_S) return "hold";
      this.active = false;
      return "lost";
    }

    this.lastSeen = now;
    this.point.addVectors(thumbTip, indexTip).multiplyScalar(0.5);
    const gap = thumbTip.distanceTo(indexTip);

    if (!this.active) {
      if (gap < PINCH_START_M && options.allowStart !== false) {
        this.active = true;
        return "start";
      }
      return null;
    }
    if (gap > PINCH_END_M) {
      this.active = false;
      return "end";
    }
    return "hold";
  }

  reset(): void {
    this.active = false;
    this.lastSeen = Number.NEGATIVE_INFINITY;
  }
}

/**
 * The direction out of the palm, from the wrist and the index and pinky
 * knuckles. The cross product flips with handedness, hence the argument.
 */
export function palmNormal(
  handedness: XRHandedness,
  wrist: THREE.Vector3,
  indexBase: THREE.Vector3,
  pinkyBase: THREE.Vector3,
): THREE.Vector3 {
  const toIndex = new THREE.Vector3().subVectors(indexBase, wrist);
  const toPinky = new THREE.Vector3().subVectors(pinkyBase, wrist);
  const normal =
    handedness === "left" ? new THREE.Vector3().crossVectors(toPinky, toIndex) : new THREE.Vector3().crossVectors(toIndex, toPinky);
  return normal.normalize();
}

/**
 * True when the palm is turned toward the eyes: a pinch made like that opens
 * the Quest system menu, and the app must not act on it (VRC.Quest.Input.8).
 */
export function palmFacesHead(wrist: THREE.Vector3, normal: THREE.Vector3, head: THREE.Vector3): boolean {
  const toHead = new THREE.Vector3().subVectors(head, wrist).normalize();
  return normal.dot(toHead) > SYSTEM_GESTURE_DOT;
}
