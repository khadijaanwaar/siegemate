// README share.jpg: after a checkmate win, the headset's share card: "Scan to replay", the QR code,
// "siegemate.pages.dev", Back; the end position behind it. Frostfall. Square on, about 45 cm away.
import type { P3 } from "../lib/hands.ts";
import { defineShot } from "../lib/shot.ts";
import { README, SCHOLARS_REPLIES, scholarsMate, seated, setupStorage, squareOn } from "./_common.ts";

export default defineShot({
  name: "share",
  description: "The share card with its QR code, square on.",
  seconds: 2,
  still: README("share"),
  storage: setupStorage("ivory", "sun"),
  replies: SCHOLARS_REPLIES,
  async setup(ctx) {
    await seated(ctx);
    await scholarsMate(ctx);
    await ctx.game.arena("frost");
    await ctx.game.press("share");
    await ctx.wait(800);
    const back = await ctx.game.button("share-back");
    if (!back) throw new Error("no share card on show");
    return { at: back };
  },
  // The card is 20 cm by 27.5 cm; its Back button sits near the bottom.
  firstView: ({ at }) => squareOn([at[0], at[1] + 0.11, at[2]] as P3, 0.45, 64),
  async play(ctx) {
    await ctx.wait(600);
  },
});
