/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks are untyped test globals */
// Devpost 04: promotion, from the seat: the white pawn on the last rank waiting, the promotion card on the player's
// edge of the board ("Promote your pawn to", Queen, Rook, Bishop, Knight), the right index fingertip on Queen.
// Stormwatch.
import type { P3 } from "../lib/hands.ts";
import { defineShot } from "../lib/shot.ts";
import { EYE, POKE_R, REACH_R, up } from "../lib/stage.ts";
import { fromSeat, GALLERY, mid, seated, setupStorage } from "./_common.ts";

export default defineShot({
  name: "04-crown-the-pawn",
  description: "The promotion card, a fingertip on Queen.",
  seconds: 4,
  still: GALLERY("04-crown-the-pawn"),
  storage: setupStorage("ivory", "sun"),
  replies: ["d7d5", "c7c6", "g8f6", "c8f5"],
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.play("e2e4");
    await ctx.game.play("e4d5");
    await ctx.game.play("d5c6");
    await ctx.game.play("c6b7");
    await ctx.game.arena("storm");
    // The pawn goes into a8 by hand (the card comes from a headset move), all before the still's frame.
    const b7 = await ctx.game.square("b7");
    const a8 = await ctx.game.square("a8");
    ctx.right.place(up(b7, 0.06), REACH_R);
    await ctx.right.glide(up(b7, 0.02), 200);
    await ctx.right.pinch(120);
    await ctx.wait(100);
    await ctx.right.glide(up(a8, 0.025), 400);
    await ctx.right.open(150);
    ctx.right.place("parked");
    await ctx.waitFor(() => Boolean((window as any).__xr.buttonWorld("promote-q")), undefined, { maxMs: 8000, label: "the promotion card" });
    await ctx.wait(600);
    return { a8, queen: (await ctx.game.button("promote-q"))!, knight: (await ctx.game.button("promote-n"))! };
  },
  firstView: ({ a8, queen, knight }) => fromSeat(mid(mid(queen, knight), a8, 0.3), 58),
  async play({ right, wait }, { queen }) {
    const n = [EYE[0] - queen[0], EYE[1] - queen[1], EYE[2] - queen[2]];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!);
    right.pose("point", 0);
    right.place([queen[0] + (n[0]! / l) * 0.012, queen[1] + (n[1]! / l) * 0.012, queen[2] + (n[2]! / l) * 0.012] as P3, POKE_R, "tip");
    await wait(500);
  },
});
