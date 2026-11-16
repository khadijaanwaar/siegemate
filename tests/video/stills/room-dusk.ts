// README room-dusk.jpg: wide, from behind and above the player's right shoulder, the room two thirds of the frame and
// the board in the lower middle; Siege at Dusk at full strength. Pieces mid-game, nobody moving.
import { defineShot } from "../lib/shot.ts";
import { EYE } from "../lib/stage.ts";
import { README, seated, setupStorage, view } from "./_common.ts";

export default defineShot({
  name: "room-dusk",
  description: "Wide over the right shoulder: the room under Siege at Dusk.",
  seconds: 2,
  still: README("room-dusk"),
  storage: setupStorage("ivory", "sun"),
  replies: ["e7e5", "b8c6", "f8c5"],
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.play("e2e4");
    await ctx.game.play("g1f3");
    await ctx.game.play("f1c4");
    await ctx.game.arena("dusk");
    return { c: await ctx.game.square("e5") };
  },
  // A panorama has no parallax: the eye moves only a little up and back, the lens does the rest.
  firstView: ({ c }) => view([EYE[0] + 0.14, EYE[1] + 0.2, EYE[2] + 0.3], [c[0] - 0.05, c[1] + 0.32, c[2] - 0.2], 92),
  async play(ctx) {
    await ctx.wait(1500);
  },
});
