import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { ARENA_ORDER } from "../scene/arena";
import { HEAD_CLEARANCE_M, MAX_VEIL_ALPHA, nextArena, ROOM_THEMES, spawnParticle, stepParticle } from "./roomTheme";

const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

describe("ROOM_THEMES", () => {
  it("never dims the room past the safety ceiling, so the player always sees it", () => {
    for (const theme of ARENA_ORDER) expect(ROOM_THEMES[theme].veil.alpha).toBeLessThanOrEqual(MAX_VEIL_ALPHA);
    expect(MAX_VEIL_ALPHA).toBeLessThanOrEqual(0.6);
  });

  it("makes the siege at dusk darker than the dawn court", () => {
    expect(ROOM_THEMES.dusk.veil.alpha).toBeGreaterThan(ROOM_THEMES.dawn.veil.alpha);
  });

  it("brings each map's weather into the room", () => {
    expect(ROOM_THEMES.frost.weather.kind).toBe("snow");
    expect(ROOM_THEMES.storm.weather.kind).toBe("rain");
    expect(ROOM_THEMES.sands.weather.kind).toBe("sand");
    expect(ROOM_THEMES.jungle.weather.kind).toBe("pollen");
    expect(ROOM_THEMES.dusk.weather.kind).toBe("embers");
  });
});

describe("weather particles", () => {
  const head = new THREE.Vector3(0, 1.2, 0);
  const board = { center: new THREE.Vector3(0, 0.75, -0.45), half: 0.28 };

  it("never spawn inside the head's clearance or over the board", () => {
    const random = seeded(7);
    const point = new THREE.Vector3();
    for (let i = 0; i < 2000; i += 1) {
      spawnParticle("snow", head, board, random, point);
      expect(point.distanceTo(head)).toBeGreaterThanOrEqual(HEAD_CLEARANCE_M);
      const overBoard =
        Math.abs(point.x - board.center.x) < board.half && Math.abs(point.z - board.center.z) < board.half && point.y < board.center.y + 0.3;
      expect(overBoard).toBe(false);
    }
  });

  it("snow falls slowly, rain fast, embers rise", () => {
    const random = seeded(3);
    const fall = (kind: Parameters<typeof stepParticle>[0]) => {
      const point = new THREE.Vector3(1, 1.5, 0);
      stepParticle(kind, point, 0.1, 0, head, board, random);
      return 1.5 - point.y;
    };
    expect(fall("rain")).toBeGreaterThan(fall("snow"));
    expect(fall("snow")).toBeGreaterThan(0);
    expect(fall("embers")).toBeLessThan(0);
  });

  it("a particle that drifts into the head's clearance is moved away", () => {
    const random = seeded(11);
    const point = head.clone().add(new THREE.Vector3(0, 0.05, 0));
    stepParticle("snow", point, 0.016, 0, head, board, random);
    expect(point.distanceTo(head)).toBeGreaterThanOrEqual(HEAD_CLEARANCE_M);
  });
});

describe("nextArena", () => {
  it("cycles through the battlegrounds in the picker's order", () => {
    expect(nextArena(ARENA_ORDER[0])).toBe(ARENA_ORDER[1]);
    expect(nextArena(ARENA_ORDER[ARENA_ORDER.length - 1])).toBe(ARENA_ORDER[0]);
  });
});
