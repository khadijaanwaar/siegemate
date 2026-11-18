/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks are untyped test globals */
// Devpost card 09: everything in reach from the seat: the headset menu open beside the board (height, sound and
// music), and both hands pinching the board's edges, pulling it bigger. Dawn Court.
import type { P3 } from "../lib/hands.ts";
import { handTurn } from "../lib/hands.ts";
import { defineShot } from "../lib/shot.ts";
import { REACH_R } from "../lib/stage.ts";
import { CARD, fromSeat, mid, seated, setupStorage } from "./_common.ts";

const REACH_L = handTurn(-75, -25, -75);

export default defineShot({
  name: "card-09-in-reach",
  description: "Card 09: the menu open and both hands resizing the board.",
  seconds: 3,
  still: CARD("09-in-reach"),
  label: null,
  storage: setupStorage("ivory", "sun"),
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.arena("dawn");
    if (process.env.MENU !== "0") {
      await ctx.game.press("menu");
      await ctx.wait(600);
    }
    const a1 = await ctx.game.square("a1");
    const h8 = await ctx.game.square("h8");
    const c: P3 = mid(a1, h8);
    return { c, half: Math.abs(h8[0] - a1[0]) / 2 + 0.035, menu: await ctx.game.button("raise") };
  },
  firstView: ({ c, menu }) => {
    const at: P3 = menu ? mid(c, menu, Number(process.env.MK ?? 0.24)) : c;
    return fromSeat([at[0], at[1] + 0.03, at[2] + 0.02], Number(process.env.FOV ?? 88));
  },
  async play(ctx, { c, half }) {
    const { left, right, wait, page } = ctx;
    const grow = Number(process.env.GROW ?? 1.25);
    const at = (side: number, spread: number): P3 => [c[0] + side * spread, c[1] + 0.03, c[2] + half * Number(process.env.GZ ?? 0.55)];
    left.place(at(-1, half + 0.06), REACH_L);
    right.place(at(1, half + 0.06), REACH_R);
    await wait(150);
    left.moveTo(at(-1, half), 250);
    await right.glide(at(1, half), 250);
    ctx.tracks.left.pinchTo(ctx.time(), 1, 140);
    await right.pinch(140);
    await wait(150);
    left.moveTo(at(-1, half * grow), 900, { ease: "minimum-jerk" });
    await right.glide(at(1, half * grow), 900);
    await wait(200);
    const size = await page.evaluate(() => (window as any).__xr.boardSize());
    const menuOpen = await page.evaluate(() => (window as any).__xr.ui().panels.includes("menu"));
    console.log(`[film] card-09: board size ${size}, menu open ${menuOpen}`);
    if (!(size > 1.2)) throw new Error(`the board did not grow (size ${size}, menu open ${menuOpen})`);
  },
});
