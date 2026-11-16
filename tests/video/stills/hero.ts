/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks are untyped test globals */
// README hero.jpg: low three-quarter view from the player's right, eye about 25 cm above the table, Siege at
// Dusk; mid-board a Sun Empire warrior lands its strike on an Ivory footsoldier (dxe4). No panels, no hands.
import { defineShot } from "../lib/shot.ts";
import { intoMove, README, seated, setupStorage, view } from "./_common.ts";

export default defineShot({
  name: "hero",
  description: "Low three-quarter view, Siege at Dusk, a capture's hit frame mid-board.",
  seconds: 4,
  still: README("hero"),
  storage: setupStorage("ivory", "sun"),
  replies: ["d7d5", "d5e4"],
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.arena("dusk");
    await ctx.game.play("e2e4");
    const e4 = await ctx.game.square("e4");
    const e1 = await ctx.game.square("e1");
    const e8 = await ctx.game.square("e8");
    return { e4, e1, e8 };
  },
  firstView: ({ e4, e1, e8 }) => view([e4[0] + 0.36, e4[1] + 0.25, e1[2] + 0.12], [e4[0] - 0.04, e4[1] + 0.03, (e4[2] + e8[2]) / 2 + 0.06], 52),
  async play(ctx) {
    await ctx.page.evaluate(() => void (window as any).__xr.move("a2", "a3"));
    await intoMove(ctx, 4, Number(process.env.HIT_MS ?? 1500));
  },
});
