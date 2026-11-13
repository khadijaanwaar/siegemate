import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { palmFacesHead, palmNormal, PinchTracker } from "./hands";

const at = (x: number, y = 1, z = -0.3) => new THREE.Vector3(x, y, z);

describe("PinchTracker", () => {
  it("starts under 1.5 cm, holds until 2.5 cm, then ends", () => {
    const pinch = new PinchTracker();
    expect(pinch.update(at(0), at(0.03), 0)).toBeNull();
    expect(pinch.update(at(0), at(0.014), 0.01)).toBe("start");
    expect(pinch.update(at(0), at(0.02), 0.02)).toBe("hold");
    expect(pinch.update(at(0), at(0.024), 0.03)).toBe("hold");
    expect(pinch.update(at(0), at(0.026), 0.04)).toBe("end");
    expect(pinch.update(at(0), at(0.02), 0.05)).toBeNull();
  });

  it("reports the point between the fingertips", () => {
    const pinch = new PinchTracker();
    pinch.update(at(0.1), at(0.11), 0);
    expect(pinch.point.x).toBeCloseTo(0.105, 6);
    expect(pinch.pinching).toBe(true);
  });

  it("rides out a short tracking dropout but calls a long one lost", () => {
    const pinch = new PinchTracker();
    pinch.update(at(0), at(0.01), 0);
    expect(pinch.update(null, null, 0.1)).toBe("hold");
    expect(pinch.update(null, null, 0.16)).toBe("lost");
    expect(pinch.pinching).toBe(false);
    expect(pinch.update(null, null, 0.2)).toBeNull();
  });

  it("forgets the dropout once the fingers come back", () => {
    const pinch = new PinchTracker();
    pinch.update(at(0), at(0.01), 0);
    pinch.update(null, null, 0.1);
    expect(pinch.update(at(0), at(0.01), 0.12)).toBe("hold");
    expect(pinch.update(null, null, 0.2)).toBe("hold");
  });

  it("does not start a pinch the caller vetoes (the system gesture)", () => {
    const pinch = new PinchTracker();
    expect(pinch.update(at(0), at(0.01), 0, { allowStart: false })).toBeNull();
    expect(pinch.pinching).toBe(false);
  });
});

describe("palm direction", () => {
  // A right hand held up in front of the face, palm toward it: thumb side on the right.
  const wrist = new THREE.Vector3(0, 0.95, -0.3);
  const indexBase = new THREE.Vector3(0.03, 1.03, -0.3);
  const pinkyBase = new THREE.Vector3(-0.03, 1.02, -0.3);
  const head = new THREE.Vector3(0, 1.2, 0);

  it("points out of the palm for a right hand", () => {
    const normal = palmNormal("right", wrist, indexBase, pinkyBase);
    expect(normal.z).toBeGreaterThan(0.9);
    expect(palmFacesHead(wrist, normal, head)).toBe(true);
  });

  it("mirrors for a left hand", () => {
    const normal = palmNormal("left", wrist, pinkyBase, indexBase);
    expect(normal.z).toBeGreaterThan(0.9);
  });

  it("does not flag a palm turned down toward the board", () => {
    const normal = new THREE.Vector3(0, -1, 0);
    expect(palmFacesHead(wrist, normal, head)).toBe(false);
  });
});
