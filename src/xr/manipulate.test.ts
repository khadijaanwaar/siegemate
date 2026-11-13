import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { BOARD_SIZE_KEY, DEFAULT_BOARD_SIZE, loadBoardSize, saveBoardSize, twoHandTransform } from "./manipulate";

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

  it("grows with the hands pulled apart and shrinks as they close, within limits", () => {
    expect(twoHandTransform(start, { left: v(-0.13, 0.9, -0.4), right: v(0.13, 0.9, -0.4) }).scale).toBeCloseTo(1.3, 6);
    expect(twoHandTransform(start, { left: v(-0.05, 0.9, -0.4), right: v(0.05, 0.9, -0.4) }).scale).toBeCloseTo(0.6, 6);
    expect(twoHandTransform(start, { left: v(-0.5, 0.9, -0.4), right: v(0.5, 0.9, -0.4) }).scale).toBeCloseTo(1.6, 6);
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
