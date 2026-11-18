// Devpost card 10b: the result card, VICTORY with its record line, Rematch, Exit and "Share this battle", the final
// position below it. Siege at Dusk. The alternative to card 10 (the two cards share one place in the game).
import type { P3 } from "../lib/hands.ts";
import { defineShot } from "../lib/shot.ts";
import { CARD, mid, SCHOLARS_REPLIES, scholarsMate, seated, setupStorage, squareOn } from "./_common.ts";

export default defineShot({
  name: "card-10b-victory",
  description: "Card 10b: the VICTORY card above the final position.",
  seconds: 2,
  still: CARD("10b-victory"),
  label: null,
  storage: setupStorage("ivory", "sun"),
  replies: SCHOLARS_REPLIES,
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.arena("dusk");
    await scholarsMate(ctx);
    const rematch = (await ctx.game.button("rematch"))!;
    const exit = (await ctx.game.button("exit"))!;
    return { c: mid(rematch, exit) };
  },
  firstView: ({ c }) => squareOn([c[0], c[1] - Number(process.env.DY ?? -0.03), c[2]] as P3, Number(process.env.D ?? 0.66), Number(process.env.FOV ?? 60)),
  async play(ctx) {
    await ctx.wait(800);
  },
});
