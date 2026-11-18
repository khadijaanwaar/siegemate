// Devpost card 01 (and the thumbnail): low across the board from the player's right-hand corner, about 20 cm above
// it: the Grande Armée in the near ranks, the Sun Empire across, every figure idle, the real room behind.
import { defineShot } from "../lib/shot.ts";
import { CARD, mid, seated, setupStorage, view } from "./_common.ts";

export default defineShot({
  name: "card-01-hero",
  description: "Card 01: low across the board, both armies idle, the room behind.",
  seconds: 2,
  still: CARD("01-hero"),
  label: null,
  storage: setupStorage("empire", "sun"),
  async setup(ctx) {
    await seated(ctx);
    const a1 = await ctx.game.square("a1");
    const h8 = await ctx.game.square("h8");
    const h1 = await ctx.game.square("h1");
    return { c: mid(a1, h8), h1 };
  },
  firstView: ({ c, h1 }) =>
    view(
      [h1[0] + Number(process.env.CX ?? 0.2), c[1] + Number(process.env.CY ?? 0.2), h1[2] + Number(process.env.CZ ?? 0.4)],
      [c[0] - 0.03, c[1] + Number(process.env.AY ?? 0.03), c[2] - 0.06],
      Number(process.env.FOV ?? 48),
    ),
  async play(ctx) {
    await ctx.wait(1200);
  },
});
