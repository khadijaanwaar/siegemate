/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks are untyped test globals */
// README table.jpg: the seated player's own view, looking down about 40°, Dawn Court; the opening, white to move,
// the coach's first lesson ("Pinch a soldier, drop on a glow") with the suggested pawn's squares lit, the control
// slab to the right. No hands.
import { defineShot } from "../lib/shot.ts";
import { fromSeat, README, seated, setupStorage } from "./_common.ts";

export default defineShot({
  name: "table",
  description: "The seated view: opening, the first-move lesson, the slab.",
  seconds: 2,
  still: README("table"),
  storage: setupStorage("ivory", "sun", false),
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.arena("dawn");
    await ctx.waitFor(() => (window as any).__xr.ui().coach === "first-move", undefined, { maxMs: 6000, label: "the first-move lesson" });
    return { c: await ctx.game.square("e4"), slab: (await ctx.game.button("menu"))! };
  },
  firstView: ({ c, slab }) => fromSeat([(c[0] + slab[0]) / 2 - 0.04, c[1] + 0.02, c[2] + 0.02], 76),
  async play(ctx) {
    await ctx.wait(1200);
  },
});
