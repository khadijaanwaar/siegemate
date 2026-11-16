// README menu.jpg: the headset menu open beside the board, square on, legible; the right index fingertip hovering
// on the height row's ▲ (raise). Frostfall.
import type { P3 } from "../lib/hands.ts";
import { defineShot } from "../lib/shot.ts";
import { POKE_R } from "../lib/stage.ts";
import { README, seated, setupStorage, squareOn } from "./_common.ts";

export default defineShot({
  name: "menu",
  description: "The headset menu, square on, a fingertip on ▲.",
  seconds: 2,
  still: README("menu"),
  storage: setupStorage("ivory", "sun"),
  async setup(ctx) {
    await seated(ctx);
    await ctx.game.arena("frost");
    await ctx.game.press("menu");
    await ctx.wait(600);
    return { raise: (await ctx.game.button("raise"))!, arena: (await ctx.game.button("arena"))! };
  },
  firstView: ({ raise, arena }) => squareOn([(raise[0] + arena[0]) / 2 - 0.02, (raise[1] + arena[1]) / 2, (raise[2] + arena[2]) / 2] as P3, 0.62, 58),
  async play({ right, wait, camera }, { raise }) {
    const eye = camera.view().from;
    const n = [eye[0] - raise[0], eye[1] - raise[1], eye[2] - raise[2]];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!);
    right.pose("point", 0);
    right.place([raise[0] + (n[0]! / l) * 0.012, raise[1] + (n[1]! / l) * 0.012 - 0.004, raise[2] + (n[2]! / l) * 0.012], POKE_R, "tip");
    await wait(500);
  },
});
