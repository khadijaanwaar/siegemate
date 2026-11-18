/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks are untyped test globals */
// Devpost card 03: a capture's hit frame at figure height, from the player's left, about 30 cm out (the darker side of the room behind): the Ivory
// footsoldier on e4 takes the Sun warrior on d5 (exd5): shield on shield, the spear going in, before the burst that
// ends the fight (that one blooms white). Sun Temple.
import { defineShot } from "../lib/shot.ts";
import { CARD, intoMove, mid, seated, setupStorage, view } from "./_common.ts";

export default defineShot({
  name: "card-03-capture-fight",
  description: "Card 03: the hit frame of exd5 at figure height.",
  seconds: 4,
  still: CARD("03-capture-fight"),
  label: null,
  storage: setupStorage("ivory", "sun"),
  replies: ["d7d5", "g8f6"],
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.arena("jungle");
    await ctx.game.play("e2e4");
    return { e4: await ctx.game.square("e4"), d5: await ctx.game.square("d5") };
  },
  firstView: ({ e4, d5 }) => {
    const m = mid(e4, d5);
    // Where the two meet: most of the way to d5.
    const f = mid(e4, d5, Number(process.env.MK ?? 0.8));
    return view(
      [m[0] - Number(process.env.CX ?? 0.26), m[1] + Number(process.env.CY ?? 0.07), m[2] + Number(process.env.CZ ?? 0.1)],
      [f[0], f[1] + 0.04, f[2]],
      Number(process.env.FOV ?? 34),
    );
  },
  async play(ctx) {
    await ctx.page.evaluate(() => void (window as any).__xr.move("e4", "d5"));
    await intoMove(ctx, 3, Number(process.env.HIT_MS ?? 1050));
  },
});
