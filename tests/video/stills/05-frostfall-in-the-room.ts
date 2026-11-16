// Devpost 05: wide, the board the right third of the frame and the room the rest; Frostfall: the cool veil, snow
// falling through the room and parting over the board. Mid-game, Grande Armée against Ivory Kingdom.
// (Shot from the seat, turned left, rather than from 1.5 m to the left: the room is a photograph and keeps true
// only from the seat.)
import { defineShot } from "../lib/shot.ts";
import { EYE } from "../lib/stage.ts";
import { GALLERY, seated, setupStorage, view } from "./_common.ts";

export default defineShot({
  name: "05-frostfall-in-the-room",
  description: "Frostfall: snow through the room, the board in the right third.",
  seconds: 3,
  still: GALLERY("05-frostfall-in-the-room"),
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
    return {};
  },
  firstView: () => view(EYE, [-0.42, 0.8, -0.85], 92),
  async play(ctx) {
    await ctx.wait(1500);
  },
});
