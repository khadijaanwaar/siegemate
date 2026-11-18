// Devpost card 10: after a checkmate win, the headset's share card (Scan to replay, the QR, siegemate.pages.dev,
// Back) square on, the end position behind it. Siege at Dusk. The game shows the share card in the result card's
// place, so VICTORY and the QR are never up together: card-10b-victory is the result card.
import type { P3 } from "../lib/hands.ts";
import { defineShot } from "../lib/shot.ts";
import { CARD, SCHOLARS_REPLIES, scholarsMate, seated, setupStorage, squareOn } from "./_common.ts";

export default defineShot({
  name: "card-10-share",
  description: "Card 10: the share card's QR, square on.",
  seconds: 2,
  still: CARD("10-share"),
  label: null,
  storage: setupStorage("ivory", "sun"),
  replies: SCHOLARS_REPLIES,
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.arena("dusk");
    await scholarsMate(ctx);
    await ctx.game.press("share");
    await ctx.wait(800);
    const back = await ctx.game.button("share-back");
    if (!back) throw new Error("no share card on show");
    return { at: back };
  },
  firstView: ({ at }) => squareOn([at[0], at[1] + 0.1, at[2]] as P3, Number(process.env.D ?? 0.55), Number(process.env.FOV ?? 60)),
  async play(ctx) {
    await ctx.wait(600);
  },
});
