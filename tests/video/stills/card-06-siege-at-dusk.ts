// Devpost card 06: Siege at Dusk from the seat: the room dimmed orange, embers rising beside the board, warm light on
// the table. Mid-game, Ivory Kingdom against the Sun Empire, nobody moving.
import { defineShot } from "../lib/shot.ts";
import { CARD, mid, seated, setupStorage, view } from "./_common.ts";

export default defineShot({
  name: "card-06-siege-at-dusk",
  description: "Card 06: Siege at Dusk, embers beside the board.",
  seconds: 3,
  still: CARD("06-siege-at-dusk"),
  label: null,
  storage: setupStorage("ivory", "sun"),
  replies: ["e7e5", "b8c6", "f8c5"],
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.play("e2e4");
    await ctx.game.play("g1f3");
    await ctx.game.play("f1c4");
    await ctx.game.arena("dusk");
    await ctx.wait(2500);
    return { c: mid(await ctx.game.square("a1"), await ctx.game.square("h8")) };
  },
  // Leaning in over the board from the near side, as card 05 does (the same room under another battleground), the
  // figures large, the dark sofa behind: the embers show against it.
  firstView: ({ c }) =>
    view(
      [c[0] - 0.04 + Number(process.env.CX ?? 0), c[1] + Number(process.env.CY ?? 0.3), c[2] + Number(process.env.CZ ?? 0.42)],
      [c[0] + Number(process.env.AX ?? 0), c[1] + Number(process.env.AY ?? 0.06), c[2] - 0.15],
      Number(process.env.FOV ?? 58),
    ),
  async play(ctx) {
    await ctx.wait(1500);
  },
});
