import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  BOARD_HEIGHT_KEY,
  BOARD_SIZE_KEY,
  DEFAULT_BOARD_SIZE,
  loadBoardHeight,
  loadBoardSize,
  nudgeHeight,
  pastDeadZone,
  saveBoardHeight,
  saveBoardSize,
  twoHandTransform,
} from "./manipulate";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const start = {
  left: v(-0.1, 0.9, -0.4),
  right: v(0.1, 0.9, -0.4),
  position: v(0, 0.75, -0.45),
  yaw: 0,
  scale: 1,
  keepHeight: true,
};

describe("twoHandTransform", () => {
  it("leaves the board alone when the hands have not moved", () => {
    const result = twoHandTransform(start, { left: start.left, right: start.right });
    expect(result.scale).toBeCloseTo(1, 6);
    expect(result.yaw).toBeCloseTo(0, 6);
    expect(result.position.distanceTo(start.position)).toBeLessThan(1e-9);
  });

  it("grows with the hands pulled apart and shrinks as they close, past a 5% band, within limits", () => {
    expect(twoHandTransform(start, { left: v(-0.13, 0.9, -0.4), right: v(0.13, 0.9, -0.4) }).scale).toBeCloseTo(1.3 / 1.05, 6);
    expect(twoHandTransform(start, { left: v(-0.08, 0.9, -0.4), right: v(0.08, 0.9, -0.4) }).scale).toBeCloseTo(0.8 / 0.95, 6);
    expect(twoHandTransform(start, { left: v(-0.05, 0.9, -0.4), right: v(0.05, 0.9, -0.4) }).scale).toBeCloseTo(0.6, 6);
    expect(twoHandTransform(start, { left: v(-0.5, 0.9, -0.4), right: v(0.5, 0.9, -0.4) }).scale).toBeCloseTo(1.6, 6);
  });

  it("holds the size while the hands' span stays within 5% (carrying and turning never resize by accident)", () => {
    expect(twoHandTransform(start, { left: v(-0.104, 0.9, -0.4), right: v(0.104, 0.9, -0.4) }).scale).toBe(1);
    expect(twoHandTransform(start, { left: v(-0.096, 0.9, -0.4), right: v(0.096, 0.9, -0.4) }).scale).toBe(1);
  });

  it("follows the hands across the table but keeps it on the table's height", () => {
    const moved = twoHandTransform(start, { left: v(0, 1.0, -0.5), right: v(0.2, 1.0, -0.5) });
    expect(moved.position.x).toBeCloseTo(0.1, 6);
    expect(moved.position.z).toBeCloseTo(-0.55, 6);
    expect(moved.position.y).toBeCloseTo(0.75, 6);
  });

  it("lifts with the hands when it stands on the stand-in plinth", () => {
    const moved = twoHandTransform({ ...start, keepHeight: false }, { left: v(-0.1, 1.0, -0.4), right: v(0.1, 1.0, -0.4) });
    expect(moved.position.y).toBeCloseTo(0.85, 6);
  });

  it("turns with a twist of the hands about the vertical", () => {
    // Right hand swings back toward the player, left forward: a quarter turn left.
    const turned = twoHandTransform(start, { left: v(0, 0.9, -0.5), right: v(0, 0.9, -0.3) });
    expect(Math.abs(turned.yaw)).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe("pastDeadZone", () => {
  const turned = (degrees: number) => {
    const angle = (degrees * Math.PI) / 180;
    return { left: v(-0.1 * Math.cos(angle), 0.9, -0.4 + 0.1 * Math.sin(angle)), right: v(0.1 * Math.cos(angle), 0.9, -0.4 - 0.1 * Math.sin(angle)) };
  };

  it("ignores the small wobble of two hands closing together", () => {
    expect(pastDeadZone(start, { left: v(-0.1, 0.9, -0.385), right: v(0.1, 0.9, -0.385) })).toBe(false);
    expect(pastDeadZone(start, turned(4))).toBe(false);
    expect(pastDeadZone(start, { left: v(-0.104, 0.9, -0.4), right: v(0.104, 0.9, -0.4) })).toBe(false);
  });

  it("lets go of the board past 2 cm of carry, 5 degrees of turn or 5% of spread", () => {
    expect(pastDeadZone(start, { left: v(-0.1, 0.9, -0.375), right: v(0.1, 0.9, -0.375) })).toBe(true);
    expect(pastDeadZone(start, turned(6))).toBe(true);
    expect(pastDeadZone(start, { left: v(-0.106, 0.9, -0.4), right: v(0.106, 0.9, -0.4) })).toBe(true);
  });
});

describe("board height", () => {
  it("steps 2 cm a press and stops 25 cm either side of where the board was placed", () => {
    expect(nudgeHeight(0, 1)).toBeCloseTo(0.02, 9);
    expect(nudgeHeight(0.04, -1)).toBeCloseTo(0.02, 9);
    expect(nudgeHeight(0.24, 1)).toBeCloseTo(0.25, 9);
    expect(nudgeHeight(0.25, 1)).toBeCloseTo(0.25, 9);
    expect(nudgeHeight(-0.25, -1)).toBeCloseTo(-0.25, 9);
    // Thirteen presses from the bottom stop at the top, never past it.
    let height = -0.25;
    for (let press = 0; press < 30; press += 1) height = nudgeHeight(height, 1);
    expect(height).toBeCloseTo(0.25, 9);
  });

  it("is remembered, clamped, and survives bad storage", () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    };
    expect(loadBoardHeight(storage)).toBe(0);
    saveBoardHeight(storage, 0.06);
    expect(loadBoardHeight(storage)).toBeCloseTo(0.06, 9);
    items.set(BOARD_HEIGHT_KEY, "3");
    expect(loadBoardHeight(storage)).toBe(0.25);
    items.set(BOARD_HEIGHT_KEY, "nonsense");
    expect(loadBoardHeight(storage)).toBe(0);
    const hostile = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    expect(loadBoardHeight(hostile)).toBe(0);
    expect(() => saveBoardHeight(hostile, 0.02)).not.toThrow();
  });
});

describe("board size storage", () => {
  it("defaults, round-trips, clamps and survives bad storage", () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    };
    expect(loadBoardSize(storage)).toBe(DEFAULT_BOARD_SIZE);
    saveBoardSize(storage, 1.4);
    expect(loadBoardSize(storage)).toBe(1.4);
    items.set(BOARD_SIZE_KEY, "9");
    expect(loadBoardSize(storage)).toBe(1.6);
    items.set(BOARD_SIZE_KEY, "nonsense");
    expect(loadBoardSize(storage)).toBe(DEFAULT_BOARD_SIZE);
    const hostile = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    expect(loadBoardSize(hostile)).toBe(DEFAULT_BOARD_SIZE);
    expect(() => saveBoardSize(hostile, 1.2)).not.toThrow();
  });
});
