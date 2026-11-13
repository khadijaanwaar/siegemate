import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { FALLBACK_AFTER_S, fallbackBoardPose, isTableSurface, Placement, yawFacing } from "./placement";

const up = new THREE.Vector3(0, 1, 0);
const head = { position: new THREE.Vector3(0, 1.2, 0), yaw: 0 };

describe("fallbackBoardPose", () => {
  it("stands the board 45 cm ahead and 40 cm below the eyes, facing the player", () => {
    const pose = fallbackBoardPose(head);
    expect(pose.position.x).toBeCloseTo(0, 6);
    expect(pose.position.y).toBeCloseTo(0.8, 6);
    expect(pose.position.z).toBeCloseTo(-0.45, 6);
    expect(pose.yaw).toBeCloseTo(0, 6);
  });

  it("follows where the player is looking", () => {
    const pose = fallbackBoardPose({ position: new THREE.Vector3(1, 1.2, 1), yaw: Math.PI / 2 });
    // Yaw +90 degrees turns the -Z forward to -X.
    expect(pose.position.x).toBeCloseTo(1 - 0.45, 6);
    expect(pose.position.z).toBeCloseTo(1, 6);
    expect(pose.yaw).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe("isTableSurface", () => {
  it("accepts surfaces facing up and refuses walls and slopes", () => {
    expect(isTableSurface(up)).toBe(true);
    expect(isTableSurface(new THREE.Vector3(0, 0, 1))).toBe(false);
    expect(isTableSurface(new THREE.Vector3(0, 1, 1).normalize())).toBe(false);
  });
});

describe("yawFacing", () => {
  it("turns the white side toward the player", () => {
    expect(yawFacing(new THREE.Vector3(0, 0.75, -0.5), new THREE.Vector3(0, 1.2, 0))).toBeCloseTo(0, 6);
    expect(yawFacing(new THREE.Vector3(-0.5, 0.75, 0), new THREE.Vector3(0, 1.2, 0))).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe("Placement", () => {
  it("aims at a table it finds and places the board there on confirm", () => {
    const placement = new Placement();
    placement.update(0.1, head, { position: new THREE.Vector3(0, 0.74, -0.5), normal: up });
    expect(placement.state).toBe("aiming");
    const pose = placement.confirm();
    expect(placement.state).toBe("placed");
    expect(pose?.position.y).toBeCloseTo(0.74, 6);
    expect(pose?.yaw).toBeCloseTo(0, 6);
  });

  it("ignores walls while searching", () => {
    const placement = new Placement();
    placement.update(0.1, head, { position: new THREE.Vector3(0, 1, -1), normal: new THREE.Vector3(0, 0, 1) });
    expect(placement.state).toBe("searching");
    expect(placement.confirm()).toBeNull();
  });

  it("falls back to seat height when no table turns up in time", () => {
    const placement = new Placement();
    placement.update(0, head, null);
    placement.update(FALLBACK_AFTER_S - 0.1, head, null);
    expect(placement.state).toBe("searching");
    placement.update(FALLBACK_AFTER_S + 0.01, head, null);
    expect(placement.state).toBe("fallback");
    expect(placement.pose?.position.y).toBeCloseTo(0.8, 6);
  });

  it("stays put in fallback when a table appears later, until asked to re-place", () => {
    const placement = new Placement();
    placement.update(0, head, null);
    placement.update(FALLBACK_AFTER_S + 1, head, null);
    placement.update(FALLBACK_AFTER_S + 2, head, { position: new THREE.Vector3(0, 0.74, -0.5), normal: up });
    expect(placement.state).toBe("fallback");
    placement.replace(FALLBACK_AFTER_S + 3);
    expect(placement.state).toBe("searching");
    placement.update(FALLBACK_AFTER_S + 3.1, head, { position: new THREE.Vector3(0, 0.74, -0.5), normal: up });
    expect(placement.state).toBe("aiming");
  });

  it("keeps aiming through a brief loss of the hit, then falls back to searching", () => {
    const placement = new Placement();
    placement.update(0, head, { position: new THREE.Vector3(0, 0.74, -0.5), normal: up });
    placement.update(0.2, head, null);
    expect(placement.state).toBe("aiming");
    placement.update(1.0, head, null);
    expect(placement.state).toBe("searching");
  });
});
