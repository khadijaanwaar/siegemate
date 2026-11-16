/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks are untyped test globals */
// README capture.jpg: Grande Armée against the Sun Empire; side-on at board height about 30 cm from the action,
// from the player's left; a line infantryman fires at the Sun warrior one square away (exd5): muzzle flash and smoke.
// Stormwatch.
import { defineShot } from "../lib/shot.ts";
import { intoMove, mid, README, seated, setupStorage, view } from "./_common.ts";

export default defineShot({
  name: "capture",
  description: "Side-on at board height: the infantryman's shot (exd5).",
  seconds: 3,
  still: README("capture"),
  storage: setupStorage("empire", "sun"),
  replies: ["d7d5"],
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.arena("storm");
    await ctx.game.play("e2e4");
    return { e4: await ctx.game.square("e4"), d5: await ctx.game.square("d5") };
  },
  firstView: ({ e4, d5 }) => {
    const m = mid(e4, d5);
    return view([m[0] - 0.3, m[1] + 0.06, m[2] + 0.04], [m[0] + 0.02, m[1] + 0.035, m[2]], 50);
  },
  async play(ctx) {
    await ctx.page.evaluate(() => void (window as any).__xr.move("e4", "d5"));
    await intoMove(ctx, 3, Number(process.env.HIT_MS ?? 2700));
  },
});
