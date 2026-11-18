/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks are untyped test globals */
// Devpost card 07: no table. Facing the window, away from the coffee table, the reticle finds nothing; after the
// 8 s search the board settles at seat height on its stand-in slab (src/xr/placement.ts). The window and the
// armchair behind it.
import type { P3 } from "../lib/hands.ts";
import { defineShot } from "../lib/shot.ts";
import { EYE } from "../lib/stage.ts";
import { CARD, mid, setupStorage, view } from "./_common.ts";

const AWAY = { from: EYE, at: [-1.0, 0.95, 0.05] as P3, hfovDeg: 80 };

export default defineShot({
  name: "card-07-no-table",
  description: "Card 07: the board at seat height on its stand-in slab, no table under it.",
  seconds: 2,
  still: CARD("07-no-table"),
  label: null,
  storage: setupStorage("ivory", "sun"),
  async setup(ctx) {
    ctx.camera.cut(AWAY);
    await ctx.game.enter({ difficulty: "medium" });
    await ctx.waitFor(() => (window as any).__xr.placement() === "fallback", undefined, { maxMs: 12_000, label: "the fallback board" });
    await ctx.game.settle();
    return { c: mid(await ctx.game.square("d4"), await ctx.game.square("e5")) };
  },
  // From just behind and above the player's head (the player faces -x): the slab's edge with the floor showing below
  // it, the window and the armchair beyond. The board stands in free air, so the room photo's parallax shows nowhere.
  firstView: ({ c }) =>
    view(
      [EYE[0] + Number(process.env.BX ?? 0.32), EYE[1] + Number(process.env.BY ?? 0.14), EYE[2] + Number(process.env.BZ ?? 0.12)],
      [c[0], c[1] + Number(process.env.AY ?? -0.06), c[2]],
      Number(process.env.FOV ?? 72),
    ),
  async play({ left, right, wait }) {
    left.place([0.45, 0.4, 0.5]);
    right.place([0.55, 0.4, 0.5]);
    await wait(800);
  },
});
