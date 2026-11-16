/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks are untyped test globals */
// Devpost 03: a caster's capture from the far side of the board at figure height, about 25 cm out, the player's side
// facing camera: the Ivory sorceress (queen) throws her volley down the d-file at the Sun Empire figure on d6.
// Sun Temple. No panels in frame.
import { defineShot } from "../lib/shot.ts";
import { GALLERY, intoMove, seated, setupStorage, view } from "./_common.ts";

export default defineShot({
  name: "03-a-volley-of-fire",
  description: "The sorceress's volley down the d-file (Qxd6), seen from the far side.",
  seconds: 3,
  still: GALLERY("03-a-volley-of-fire"),
  storage: setupStorage("ivory", "sun"),
  // 1.d4 e5 2.dxe5 d6 3.exd6 cxd6, then 4.Qxd6 on camera, and a quiet reply after it.
  replies: ["e7e5", "d7d6", "c7d6", "g8f6"],
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.play("d2d4");
    await ctx.game.play("d4e5");
    await ctx.game.play("e5d6");
    return { d6: await ctx.game.square("d6"), d3: await ctx.game.square("d3"), d8: await ctx.game.square("d8") };
  },
  firstView: ({ d6, d3, d8 }) => view([d6[0] + 0.06, d6[1] + Number(process.env.CAM_UP ?? 0.2), d8[2] - 0.16], [d3[0], d3[1] + 0.02, d3[2] - 0.03], 46),
  async play(ctx) {
    await ctx.page.evaluate(() => void (window as any).__xr.move("d1", "d6"));
    await intoMove(ctx, 7, Number(process.env.HIT_MS ?? 2000));
  },
});
