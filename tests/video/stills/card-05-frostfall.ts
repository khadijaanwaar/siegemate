// Devpost card 05: Frostfall from the seat, the board in the lower half and the room above it: the cool veil, snow
// falling through the room and parting over the board. Mid-game, Grande Armée against the Ivory Kingdom.
import { defineShot } from "../lib/shot.ts";
import { CARD, mid, seated, setupStorage, view } from "./_common.ts";

export default defineShot({
  name: "card-05-frostfall",
  description: "Card 05: Frostfall, snow through the room around the board.",
  seconds: 3,
  still: CARD("05-frostfall"),
  label: null,
  storage: setupStorage("empire", "ivory"),
  replies: ["e7e5", "g8f6", "f8c5", "e8g8"],
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.play("e2e4");
    await ctx.game.play("g1f3");
    await ctx.game.play("f1c4");
    await ctx.game.play("d2d3");
    await ctx.game.arena("frost");
    await ctx.wait(2500);
    return { c: mid(await ctx.game.square("a1"), await ctx.game.square("h8")) };
  },
  // Leaning in over the board from the near side, the figures large, the dark sofa behind: the snow show against it.
  firstView: ({ c }) =>
    view(
      [c[0] + 0.06 + Number(process.env.CX ?? 0), c[1] + Number(process.env.CY ?? 0.3), c[2] + Number(process.env.CZ ?? 0.42)],
      [c[0] + Number(process.env.AX ?? 0), c[1] + Number(process.env.AY ?? 0.06), c[2] - 0.15],
      Number(process.env.FOV ?? 58),
    ),
  async play(ctx) {
    await ctx.wait(1500);
  },
});
