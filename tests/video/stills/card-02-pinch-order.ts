// Devpost card 02: low and close on the right hand mid-pinch, carrying the e2 footsoldier's order: the green line from the
// figure to the fingers, e3 and e4 lit, the target ring on e4. Ivory Kingdom against the Sun Empire, Dawn Court.
import { defineShot } from "../lib/shot.ts";
import { REACH_R, up } from "../lib/stage.ts";
import { CARD, mid, seated, setupStorage, view } from "./_common.ts";

export default defineShot({
  name: "card-02-pinch-order",
  description: "Card 02: the hand pinching a pawn's order, legal squares lit, the line to the fingers.",
  seconds: 3,
  still: CARD("02-pinch-order"),
  label: null,
  storage: setupStorage("ivory", "sun"),
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.arena("dawn");
    return { e2: await ctx.game.square("e2"), e4: await ctx.game.square("e4") };
  },
  // From low on the left, toward the hand coming in from the right: the pinch, the line down to the figure on e2,
  // and e3 and e4 lit between them.
  firstView: ({ e2, e4 }) => {
    const p = up(mid(e2, e4, 0.65), Number(process.env.PY ?? 0.08));
    return view(
      [p[0] - Number(process.env.CX ?? 0.3), p[1] + Number(process.env.CY ?? 0.13), p[2] + Number(process.env.CZ ?? 0.24)],
      [p[0] + 0.02, p[1], p[2]],
      Number(process.env.FOV ?? 58),
    );
  },
  async play({ right, wait }, { e2, e4 }) {
    right.place(up(e2, 0.1), REACH_R);
    await right.glide(up(e2, 0.03), 300);
    await right.pinch(150);
    await wait(150);
    await right.glide(up(mid(e2, e4, 0.8), Number(process.env.HAND_UP ?? 0.035)), 700);
    await wait(250);
  },
});
