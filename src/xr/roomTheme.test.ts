import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { ARENA_ORDER } from "../scene/arena";
import {
  crowdsTheFace,
  FORWARD_CLEARANCE_M,
  FORWARD_HALF_ANGLE,
  HEAD_CLEARANCE_M,
  MAX_VEIL_ALPHA,
  nextArena,
  ROOM_THEMES,
  SAND_SPEED,
  spawnParticle,
  stepParticle,
  type RoomWeather,
} from "./roomTheme";

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

  it("keeps the rain sparse", () => {
    expect(ROOM_THEMES.storm.weather.count).toBeLessThanOrEqual(240);
  });
});

describe("weather particles", () => {
  const head = new THREE.Vector3(0, 1.2, 0);
  const board = { center: new THREE.Vector3(0, 0.75, -0.45), half: 0.28 };
  const kinds: RoomWeather[] = ["snow", "rain", "sand", "pollen", "embers"];
  /** Is a point within the forward column, measured independently of the module? */
  const inFront = (point: THREE.Vector3, yaw: number) => {
    const dx = point.x - head.x;
    const dz = point.z - head.z;
    const flat = Math.hypot(dx, dz);
    if (flat >= FORWARD_CLEARANCE_M) return false;
    const along = (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / flat;
    return Math.acos(Math.min(1, Math.max(-1, along))) < FORWARD_HALF_ANGLE;
  };
  const overBoard = (point: THREE.Vector3) =>
    Math.abs(point.x - board.center.x) < board.half && Math.abs(point.z - board.center.z) < board.half && point.y < board.center.y + 0.3;

  it("keep at least 0.7 m from the eyes and 1.2 m clear in front of them", () => {
    expect(HEAD_CLEARANCE_M).toBeGreaterThanOrEqual(0.7);
    expect(FORWARD_CLEARANCE_M).toBeGreaterThanOrEqual(1.2);
  });

  it("never spawn inside the head's clearance, in front of the face or over the board", () => {
    const random = seeded(7);
    const point = new THREE.Vector3();
    for (const yaw of [0, Math.PI / 2, -2.4, Math.PI]) {
      const bad = { head: 0, front: 0, board: 0 };
      for (let i = 0; i < 2000; i += 1) {
        spawnParticle("snow", head, board, random, point, true, yaw);
        if (point.distanceTo(head) < HEAD_CLEARANCE_M) bad.head += 1;
        if (inFront(point, yaw)) bad.front += 1;
        if (overBoard(point)) bad.board += 1;
      }
      expect(bad, `yaw ${yaw}`).toEqual({ head: 0, front: 0, board: 0 });
    }
  });

  it("without a head direction, keep the line from the eyes to the board clear", () => {
    const random = seeded(5);
    const point = new THREE.Vector3();
    const towardBoard = Math.atan2(-(board.center.x - head.x), -(board.center.z - head.z));
    let crowded = 0;
    for (let i = 0; i < 2000; i += 1) {
      spawnParticle("rain", head, board, random, point);
      if (point.distanceTo(head) < HEAD_CLEARANCE_M || inFront(point, towardBoard)) crowded += 1;
    }
    expect(crowded).toBe(0);
  });

  it("never step into the face, whatever the weather", () => {
    const random = seeded(13);
    const yaw = 0.6;
    for (const kind of kinds) {
      const points = Array.from({ length: 120 }, () => spawnParticle(kind, head, board, random, new THREE.Vector3(), true, yaw));
      let crowded = 0;
      for (let frame = 0; frame < 240; frame += 1) {
        for (const point of points) {
          stepParticle(kind, point, 1 / 72, frame / 72, head, board, random, yaw);
          if (point.distanceTo(head) < HEAD_CLEARANCE_M || inFront(point, yaw)) crowded += 1;
        }
      }
      expect(crowded, kind).toBe(0);
    }
  });

  it("snow falls slowly, rain faster, embers rise", () => {
    const random = seeded(3);
    const fall = (kind: RoomWeather) => {
      const point = new THREE.Vector3(1, 1.5, 0.6);
      stepParticle(kind, point, 0.1, 0, head, board, random);
      return 1.5 - point.y;
    };
    expect(fall("rain")).toBeGreaterThan(fall("snow"));
    expect(fall("snow")).toBeGreaterThan(0);
    expect(fall("embers")).toBeLessThan(0);
  });

  it("sand drifts no faster than 0.3 m/s", () => {
    const random = seeded(17);
    const point = new THREE.Vector3(1, 1.5, 0.6);
    const before = point.clone();
    stepParticle("sand", point, 0.1, 0, head, board, random);
    expect(SAND_SPEED).toBeLessThanOrEqual(0.3);
    expect(point.distanceTo(before) / 0.1).toBeLessThanOrEqual(0.3 + 1e-6);
  });

  it("a particle that drifts into the head's clearance starts over elsewhere", () => {
    const random = seeded(11);
    const point = head.clone().add(new THREE.Vector3(0, 0.05, 0));
    stepParticle("snow", point, 0.016, 0, head, board, random, 0);
    expect(point.distanceTo(head)).toBeGreaterThanOrEqual(HEAD_CLEARANCE_M);
    expect(crowdsTheFace(point, head, 0)).toBe(false);
  });

  it("a particle the player turns to face starts over out of view", () => {
    const random = seeded(19);
    // 1 m to the right: clear while facing ahead, in front once the head turns right.
    const point = new THREE.Vector3(head.x + 1, head.y, head.z);
    const right = -Math.PI / 2;
    expect(crowdsTheFace(point, head, 0)).toBe(false);
    expect(crowdsTheFace(point, head, right)).toBe(true);
    stepParticle("pollen", point, 0.016, 0, head, board, random, right);
    expect(crowdsTheFace(point, head, right)).toBe(false);
  });
});

describe("nextArena", () => {
  it("cycles through the battlegrounds in the picker's order", () => {
    expect(nextArena(ARENA_ORDER[0])).toBe(ARENA_ORDER[1]);
    expect(nextArena(ARENA_ORDER[ARENA_ORDER.length - 1])).toBe(ARENA_ORDER[0]);
  });
});
