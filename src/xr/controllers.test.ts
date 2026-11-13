import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { buttonPressed, PressTracker, pulse, SQUEEZE, TRACKING_GRACE_S, TRIGGER } from "./controllers";

const here = new THREE.Vector3(0.1, 1, -0.3);

/** A tracker that has seen the button up once (armed), as after the first frame. */
function armed(): PressTracker {
  const tracker = new PressTracker();
  tracker.update(false, here, 0);
  return tracker;
}

describe("PressTracker", () => {
  it("starts on press, holds while down, ends on release", () => {
    const tracker = armed();
    expect(tracker.update(true, here, 0.1)).toBe("start");
    expect(tracker.held).toBe(true);
    expect(tracker.update(true, here, 0.2)).toBe("hold");
    expect(tracker.update(false, here, 0.3)).toBe("end");
    expect(tracker.held).toBe(false);
    expect(tracker.update(false, here, 0.4)).toBeNull();
  });

  it("reports where the controller is", () => {
    const tracker = armed();
    tracker.update(true, new THREE.Vector3(0.2, 0.9, -0.4), 0.1);
    expect(tracker.point.toArray()).toEqual([0.2, 0.9, -0.4]);
  });

  it("ignores a button already down when tracking begins until it has been let go", () => {
    // The trigger that pressed "Play on your table" can still be down as the session opens.
    const tracker = new PressTracker();
    expect(tracker.update(true, here, 0)).toBeNull();
    expect(tracker.update(true, here, 0.1)).toBeNull();
    expect(tracker.update(false, here, 0.2)).toBeNull();
    expect(tracker.update(true, here, 0.3)).toBe("start");
  });

  it("rides out a short tracking gap but calls a long one lost", () => {
    const tracker = armed();
    tracker.update(true, here, 1);
    expect(tracker.update(null, null, 1 + TRACKING_GRACE_S / 2)).toBe("hold");
    expect(tracker.update(null, null, 1 + TRACKING_GRACE_S * 2)).toBe("lost");
    expect(tracker.held).toBe(false);
  });

  it("must be let go again after a lost press before it can start another", () => {
    const tracker = armed();
    tracker.update(true, here, 1);
    tracker.update(null, null, 2);
    expect(tracker.update(true, here, 2.1)).toBeNull();
    tracker.update(false, here, 2.2);
    expect(tracker.update(true, here, 2.3)).toBe("start");
  });

  it("does not start a press the caller vetoes", () => {
    const tracker = armed();
    expect(tracker.update(true, here, 0.1, { allowStart: false })).toBeNull();
    expect(tracker.held).toBe(false);
  });

  it("forgets everything on reset", () => {
    const tracker = armed();
    tracker.update(true, here, 0.1);
    tracker.reset();
    expect(tracker.held).toBe(false);
    expect(tracker.update(true, here, 0.2)).toBeNull(); // must be let go first
  });
});

describe("buttonPressed", () => {
  const pad = (pressed: boolean[]) => ({ buttons: pressed.map((value) => ({ pressed: value })) }) as unknown as Gamepad;

  it("reads the trigger and the grip from the standard layout", () => {
    expect(buttonPressed(pad([true, false]), TRIGGER)).toBe(true);
    expect(buttonPressed(pad([true, false]), SQUEEZE)).toBe(false);
    expect(buttonPressed(pad([false, true]), SQUEEZE)).toBe(true);
  });

  it("is null without a gamepad (not tracked), false for a missing button", () => {
    expect(buttonPressed(null, TRIGGER)).toBeNull();
    expect(buttonPressed(undefined, TRIGGER)).toBeNull();
    expect(buttonPressed(pad([]), SQUEEZE)).toBe(false);
  });
});

describe("pulse", () => {
  it("buzzes the first haptic actuator", () => {
    const actuator = { pulse: vi.fn(() => Promise.resolve(true)) };
    pulse({ gamepad: { hapticActuators: [actuator] } } as unknown as XRInputSource, 0.4, 30);
    expect(actuator.pulse).toHaveBeenCalledWith(0.4, 30);
  });

  it("is silent where there is nothing to buzz, or the buzz fails", () => {
    expect(() => pulse({ gamepad: undefined } as unknown as XRInputSource, 0.4, 30)).not.toThrow();
    expect(() => pulse({ gamepad: { hapticActuators: [] } } as unknown as XRInputSource, 0.4, 30)).not.toThrow();
    const throwing = {
      pulse: vi.fn(() => {
        throw new Error("no");
      }),
    };
    expect(() => pulse({ gamepad: { hapticActuators: [throwing] } } as unknown as XRInputSource, 0.4, 30)).not.toThrow();
    const rejecting = { pulse: vi.fn(() => Promise.reject(new Error("no"))) };
    expect(() => pulse({ gamepad: { hapticActuators: [rejecting] } } as unknown as XRInputSource, 0.4, 30)).not.toThrow();
  });
});
