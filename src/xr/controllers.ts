import * as THREE from "three";

import type { PinchEvent } from "./hands";

/** xr-standard gamepad layout (Touch, Touch Plus, Touch Pro): the trigger and the grip. */
export const TRIGGER = 0;
export const SQUEEZE = 1;
/** A on the right controller, X on the left. */
export const PRIMARY = 4;
/** A press survives a tracking dropout this short; longer and the controller is lost. */
export const TRACKING_GRACE_S = 0.15;

/** A button on a tracked controller: true/false, or null when the controller has no gamepad (not tracked). */
export function buttonPressed(gamepad: Gamepad | null | undefined, index: number): boolean | null {
  if (!gamepad) return null;
  return gamepad.buttons[index]?.pressed ?? false;
}

/**
 * A controller button read as the same start / hold / end / lost a pinch
 * gives, so the trigger gives orders and the grip holds the board through the
 * very code the hands use. A button already down when tracking begins (the
 * trigger that pressed "Play on your table") counts only after it is let go.
 */
export class PressTracker {
  readonly point = new THREE.Vector3();
  private active = false;
  private armed = false;
  private lastSeen = Number.NEGATIVE_INFINITY;

  get held(): boolean {
    return this.active;
  }

  update(
    pressed: boolean | null,
    point: THREE.Vector3 | null,
    now: number,
    options: { allowStart?: boolean } = {},
  ): PinchEvent | null {
    if (pressed === null || !point) {
      if (!this.active) return null;
      if (now - this.lastSeen <= TRACKING_GRACE_S) return "hold";
      this.active = false;
      this.armed = false;
      return "lost";
    }

    this.lastSeen = now;
    this.point.copy(point);
    if (!pressed) {
      this.armed = true;
      if (!this.active) return null;
      this.active = false;
      return "end";
    }
    if (this.active) return "hold";
    if (!this.armed || options.allowStart === false) return null;
    this.active = true;
    return "start";
  }

  reset(): void {
    this.active = false;
    this.armed = false;
    this.lastSeen = Number.NEGATIVE_INFINITY;
  }
}

/** A short buzz on the controller, where it has a motor; never throws. */
export function pulse(source: XRInputSource, intensity: number, ms: number): void {
  const actuator = (source.gamepad as (Gamepad & { hapticActuators?: readonly unknown[] }) | undefined)?.hapticActuators?.[0] as
    | { pulse?: (value: number, duration: number) => Promise<unknown> | unknown }
    | undefined;
  try {
    const result = actuator?.pulse?.(intensity, ms);
    if (result instanceof Promise) result.catch(() => undefined);
  } catch {
    // no motor, or the browser refused: the game goes on without the buzz
  }
}
