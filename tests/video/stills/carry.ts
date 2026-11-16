// README carry.jpg: from the player's eye, closer; the right hand mid-pinch about 12 cm above the board, ordering the
// Ivory knight on g1: the order line from it to the pinch, f3 and h3 lit, the target ring on f3. Sun Temple.
import { defineShot } from "../lib/shot.ts";
import { REACH_R, up } from "../lib/stage.ts";
import { fromSeat, mid, README, seated, setupStorage } from "./_common.ts";

export default defineShot({
  name: "carry",
  description: "The right hand carrying the g1 knight's order to f3.",
  seconds: 3,
  still: README("carry"),
  storage: setupStorage("ivory", "sun"),
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.arena("jungle");
    return { g1: await ctx.game.square("g1"), f3: await ctx.game.square("f3") };
  },
  firstView: ({ g1, f3 }) => fromSeat(mid(g1, f3, 0.6), 52),
  async play({ right, wait }, { g1, f3 }) {
    right.place(up(g1, 0.1), REACH_R);
    await right.glide(up(g1, 0.03), 300);
    await right.pinch(150);
    await wait(150);
    await right.glide(up(f3, Number(process.env.HAND_UP ?? 0.06)), 700);
    await wait(250);
  },
});
