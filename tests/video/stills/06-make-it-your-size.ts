/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks are untyped test globals */
// Devpost 06: the two-hand resize from the seat: both hands pinching the board's left and right edges and pulled
// apart, the board mid-grow (about 1.4x). Dawn Court. The control slab to the right.
import type { P3 } from "../lib/hands.ts";
import { handTurn } from "../lib/hands.ts";
import { defineShot } from "../lib/shot.ts";
import { REACH_R } from "../lib/stage.ts";
import { fromSeat, GALLERY, seated, setupStorage } from "./_common.ts";

const REACH_L = handTurn(-75, -25, -75);

export default defineShot({
  name: "06-make-it-your-size",
  description: "Both hands pull the board's edges apart: it grows.",
  seconds: 3,
  still: GALLERY("06-make-it-your-size"),
  storage: setupStorage("ivory", "sun"),
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.arena("dawn");
    const a1 = await ctx.game.square("a1");
    const h8 = await ctx.game.square("h8");
    const c: P3 = [(a1[0] + h8[0]) / 2, a1[1], (a1[2] + h8[2]) / 2];
    return { c, half: Math.abs(h8[0] - a1[0]) / 2 + 0.035 };
  },
  firstView: ({ c }) => fromSeat([c[0] + 0.05, c[1] + 0.05, c[2] + 0.04], 90),
  async play(ctx, { c, half }) {
    const { left, right, wait, page } = ctx;
    const at = (side: number, spread: number): P3 => [c[0] + side * spread, c[1] + 0.03, c[2] + 0.05];
    left.place(at(-1, half + 0.06), REACH_L);
    right.place(at(1, half + 0.06), REACH_R);
    await wait(150);
    left.moveTo(at(-1, half), 250);
    await right.glide(at(1, half), 250);
    // Both pinches close together (the game wants them within 300 ms of each other).
    ctx.tracks.left.pinchTo(ctx.time(), 1, 140);
    await right.pinch(140);
    await wait(150);
    left.moveTo(at(-1, half * 1.4), 900, { ease: "minimum-jerk" });
    await right.glide(at(1, half * 1.4), 900);
    await wait(200);
    const size = await page.evaluate(() => (window as any).__xr.boardSize());
    if (!(size > 1.3)) throw new Error(`the board did not grow (size ${size})`);
  },
});
