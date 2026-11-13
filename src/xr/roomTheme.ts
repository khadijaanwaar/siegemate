import * as THREE from "three";

import { ARENA_ORDER, type ArenaTheme } from "../scene/arena";

export type RoomWeather = "none" | "snow" | "rain" | "sand" | "pollen" | "embers";

export interface RoomTheme {
  /** Darkens and tints the real room (passthrough): shown = colour * alpha + room * (1 - alpha). */
  veil: { color: number; alpha: number };
  weather: { kind: RoomWeather; count: number; color: number; opacity: number };
  /** Light the board throws onto the real table around it. */
  glow: { color: number; intensity: number };
}

/** The room is never dimmed past this: the player must always see where they are. */
export const MAX_VEIL_ALPHA = 0.5;
/** Weather never comes closer than this to the eyes. */
export const HEAD_CLEARANCE_M = 0.35;
/** The weather fills a cylinder this wide around the player... */
const FIELD_RADIUS_M = 1.8;
/** ...from this far below the eyes to this far above them. */
const FIELD_BELOW_M = 1.2;
const FIELD_ABOVE_M = 1.0;

/**
 * Each battleground as a room. Dawn Court leaves the room as it is; the siege
 * at dusk takes the lights down and sends embers up past the board. Weather
 * matches the map's own (snow, rain, driven sand), the rainforest drifts its
 * pollen, and the board's light pools on the real table in the map's lamp colour.
 */
export const ROOM_THEMES: Record<ArenaTheme, RoomTheme> = {
  dawn: {
    veil: { color: 0x1a1408, alpha: 0 },
    weather: { kind: "none", count: 0, color: 0xffffff, opacity: 0 },
    glow: { color: 0xffd9a0, intensity: 0.35 },
  },
  jungle: {
    veil: { color: 0x0b1f0c, alpha: 0.22 },
    weather: { kind: "pollen", count: 220, color: 0xffe9a8, opacity: 0.85 },
    glow: { color: 0xc8ff9a, intensity: 0.32 },
  },
  sands: {
    veil: { color: 0x2e200b, alpha: 0.12 },
    weather: { kind: "sand", count: 380, color: 0xf0dca8, opacity: 0.45 },
    glow: { color: 0xffc46b, intensity: 0.4 },
  },
  frost: {
    veil: { color: 0x0c1626, alpha: 0.18 },
    weather: { kind: "snow", count: 420, color: 0xf2f8ff, opacity: 0.9 },
    glow: { color: 0xbfe0ff, intensity: 0.35 },
  },
  storm: {
    veil: { color: 0x090d14, alpha: 0.34 },
    weather: { kind: "rain", count: 480, color: 0xd6e4f5, opacity: 0.5 },
    glow: { color: 0x9fc2ff, intensity: 0.3 },
  },
  dusk: {
    veil: { color: 0x1a0803, alpha: 0.45 },
    weather: { kind: "embers", count: 160, color: 0xff8a3c, opacity: 0.95 },
    glow: { color: 0xff8a3c, intensity: 0.55 },
  },
};

export function nextArena(theme: ArenaTheme): ArenaTheme {
  return ARENA_ORDER[(ARENA_ORDER.indexOf(theme) + 1) % ARENA_ORDER.length];
}

export interface BoardArea {
  center: THREE.Vector3;
  half: number;
}

function inHead(point: THREE.Vector3, head: THREE.Vector3): boolean {
  return point.distanceTo(head) < HEAD_CLEARANCE_M;
}

function overBoard(point: THREE.Vector3, board: BoardArea | null): boolean {
  if (!board) return false;
  return (
    Math.abs(point.x - board.center.x) < board.half &&
    Math.abs(point.z - board.center.z) < board.half &&
    point.y < board.center.y + 0.3
  );
}

/** A fresh particle somewhere in the field (the top for falling kinds, the bottom for embers). */
export function spawnParticle(
  kind: RoomWeather,
  head: THREE.Vector3,
  board: BoardArea | null,
  random: () => number,
  out: THREE.Vector3,
  anywhere = true,
): THREE.Vector3 {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * FIELD_RADIUS_M;
    const bottom = head.y - FIELD_BELOW_M;
    const top = head.y + FIELD_ABOVE_M;
    const height = anywhere ? bottom + random() * (top - bottom) : kind === "embers" ? bottom : top;
    out.set(head.x + Math.cos(angle) * radius, height, head.z + Math.sin(angle) * radius);
    if (!inHead(out, head) && !overBoard(out, board)) return out;
  }
  // Out at the rim, level with the eyes: always clear of both.
  return out.set(head.x + FIELD_RADIUS_M, head.y, head.z);
}

/**
 * One particle's step. Snow drifts down and sways, rain drops fast, sand is
 * carried sideways, pollen wanders, embers rise. Anything leaving the field,
 * reaching the board or entering the head's clearance starts over.
 */
export function stepParticle(
  kind: RoomWeather,
  point: THREE.Vector3,
  dt: number,
  phase: number,
  head: THREE.Vector3,
  board: BoardArea | null,
  random: () => number,
): void {
  switch (kind) {
    case "snow":
      point.y -= 0.22 * dt;
      point.x += Math.sin(phase) * 0.05 * dt;
      break;
    case "rain":
      point.y -= 3.2 * dt;
      point.x += 0.4 * dt;
      break;
    case "sand":
      point.x += 1.6 * dt;
      point.y -= 0.12 * dt;
      break;
    case "pollen":
      point.x += Math.sin(phase) * 0.04 * dt;
      point.y += Math.cos(phase * 0.7) * 0.03 * dt;
      point.z += Math.cos(phase) * 0.04 * dt;
      break;
    case "embers":
      point.y += 0.28 * dt;
      point.x += Math.sin(phase * 1.3) * 0.06 * dt;
      break;
    default:
      return;
  }
  const flat = Math.hypot(point.x - head.x, point.z - head.z);
  const outside = flat > FIELD_RADIUS_M || point.y < head.y - FIELD_BELOW_M || point.y > head.y + FIELD_ABOVE_M;
  if (outside || overBoard(point, board)) spawnParticle(kind, head, board, random, point, false);
  if (inHead(point, head)) {
    // Push it out to the edge of the clearance rather than through the eyes.
    const away = point.clone().sub(head);
    if (away.lengthSq() < 1e-6) away.set(1, 0, 0);
    point.copy(head).add(away.setLength(HEAD_CLEARANCE_M + 0.01));
  }
}
