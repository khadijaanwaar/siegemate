// Devpost 07: the end of a game: the headset result card "VICTORY" with its record line, Rematch, Exit and "Share
// this battle"; the final position on the board below, the queen standing over the king's square. Square on to the
// card from about 45 cm. Siege at Dusk. (The game shows the share card in the result card's place, not beside it;
// the README's share.jpg has the QR side.)
import type { P3 } from "../lib/hands.ts";
import { defineShot } from "../lib/shot.ts";
import { GALLERY, mid, SCHOLARS_REPLIES, scholarsMate, seated, setupStorage, squareOn } from "./_common.ts";

export default defineShot({
  name: "07-share-the-battle",
  description: "The VICTORY card with Share this battle, Siege at Dusk.",
  seconds: 2,
  still: GALLERY("07-share-the-battle"),
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
  firstView: ({ c }) => squareOn([c[0], c[1] - 0.005, c[2]] as P3, 0.45, 62),
  async play(ctx) {
    await ctx.wait(800);
  },
});
