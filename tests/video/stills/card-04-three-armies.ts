/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks are untyped test globals */
// Devpost card 04: a Grande Armée musketeer fires on the Ivory footsoldier across (exd5): muzzle flash and smoke,
// the Ivory ranks beyond. Dawn Court.
import { defineShot } from "../lib/shot.ts";
import { CARD, intoMove, mid, seated, setupStorage, view } from "./_common.ts";

export default defineShot({
  name: "card-04-three-armies",
  description: "Card 04: Grande Armée musketeers against the Ivory Kingdom, a musket volley (exd5).",
  seconds: 4,
  still: CARD("04-three-armies"),
  label: null,
  storage: setupStorage("empire", "ivory"),
  replies: ["d7d5", "g8f6"],
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.arena("dawn");
    await ctx.game.play("e2e4");
    return { e4: await ctx.game.square("e4"), d5: await ctx.game.square("d5") };
  },
  // Side-on at figure height from the player's left, about 30 cm out: the musketeer on the right of the frame, the
  // Ivory footsoldier on the left, the Ivory ranks beyond.
  firstView: ({ e4, d5 }) => {
    const m = mid(e4, d5);
    return view(
      [m[0] - Number(process.env.CX ?? 0.3), m[1] + Number(process.env.CY ?? 0.07), m[2] + Number(process.env.CZ ?? 0.05)],
      [m[0] + 0.02, m[1] + 0.04, m[2]],
      Number(process.env.FOV ?? 34),
    );
  },
  async play(ctx) {
    await ctx.page.evaluate(() => void (window as any).__xr.move("e4", "d5"));
    await intoMove(ctx, 3, Number(process.env.HIT_MS ?? 2500));
  },
});
