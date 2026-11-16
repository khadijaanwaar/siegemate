/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks (window.__xr, __iwer) are untyped test globals */
// Shared set-up for the README and Devpost stills (docs/images/readme/SHOTLIST.md,
// docs/submission/gallery/CAPTIONS.md). Each still is a shot whose last frame is saved.
import type { View } from "../lib/camera.ts";
import type { P3 } from "../lib/hands.ts";
import type { ShotContext } from "../lib/shot.ts";
import { BOARD_VIEW, EYE, ROOM_VIEW } from "../lib/stage.ts";

/** README: drawn at 2560x1440, Lanczos to 1920x1080, JPEG q85 (SHOTLIST.md). */
export const README = (name: string) => ({ file: `docs/images/readme/${name}.jpg`, size: [2560, 1440] as [number, number], out: [1920, 1080] as [number, number], quality: 85 });
/** Devpost gallery: 2160x1440 (3:2), JPEG q88 (CAPTIONS.md). */
export const GALLERY = (name: string) => ({ file: `docs/submission/gallery/${name}.jpg`, size: [2160, 1440] as [number, number], out: [2160, 1440] as [number, number], quality: 88 });

/** Default board size (1.15x), the chosen armies, coach hints done. */
export const setupStorage = (w = "ivory", b = "sun", onboarded = true): Record<string, string> => ({
  "mr-chess:board-size": "1.15",
  "mr-chess:onboarded": onboarded ? "1" : "0",
  "kg.armies": JSON.stringify({ w, b }),
});

/** Enter, put the board on the table from the seat, and let it settle. */
export async function seated(ctx: ShotContext, config: Record<string, unknown> = {}): Promise<void> {
  ctx.camera.cut(ROOM_VIEW);
  await ctx.game.enter({ difficulty: "medium", ...config });
  await ctx.game.place(BOARD_VIEW);
  await ctx.game.settle();
}

/** A view from `from` (world) at `at`, lens `hfovDeg`. */
export const view = (from: P3, at: P3, hfovDeg = 60): View => ({ from, at, hfovDeg });

/** The seat, looking at `at`. */
export const fromSeat = (at: P3, hfovDeg = 70): View => ({ from: EYE, at, hfovDeg });

/** Wait until the game is in the middle of a move (busy) after `plies` plies, then `ms` more. */
export async function intoMove(ctx: ShotContext, plies: number, ms: number): Promise<void> {
  await ctx.waitFor((n) => (window as any).__xr.snapshot().sanList.length >= n, plies, { maxMs: 15_000, label: `ply ${plies}` });
  await ctx.wait(ms);
}

/** A camera `d` metres out from a card centred at `c`, square on (headset cards face the seat). */
export function squareOn(c: P3, d: number, hfovDeg: number): View {
  const n = [EYE[0] - c[0], EYE[1] - c[1], EYE[2] - c[2]];
  const l = Math.hypot(n[0]!, n[1]!, n[2]!);
  return view([c[0] + (n[0]! / l) * d, c[1] + (n[1]! / l) * d, c[2] + (n[2]! / l) * d], c, hfovDeg);
}

/** Setup: 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6 4.Qxf7#, the result card up (replies e7e5, b8c6, g8f6). */
export async function scholarsMate(ctx: ShotContext): Promise<void> {
  await ctx.game.play("e2e4");
  await ctx.game.play("f1c4");
  await ctx.game.play("d1h5");
  await ctx.page.evaluate(() => void (window as any).__xr.move("h5", "f7"));
  await ctx.waitFor(() => (window as any).__xr.ui().panels.includes("result"), undefined, { maxMs: 15_000, label: "the result card" });
  await ctx.game.settle();
}
export const SCHOLARS_REPLIES = ["e7e5", "b8c6", "g8f6"];

export const mid =(a: P3, b: P3, k = 0.5): P3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
