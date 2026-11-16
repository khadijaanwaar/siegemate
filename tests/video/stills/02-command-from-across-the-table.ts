/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks are untyped test globals */
// Devpost 02: Touch controller play, from behind and above the player's right shoulder: the right controller in
// frame, its ray running to the board; the player has black (the board turned so black is near) and orders the g8
// knight along the ray to f6, legal squares lit. Dune Bastion.
import type { Quat } from "../lib/camera.ts";
import type { P3 } from "../lib/hands.ts";
import { defineShot } from "../lib/shot.ts";
import { BOARD_VIEW, EYE, ROOM_VIEW, up } from "../lib/stage.ts";
import { GALLERY, setupStorage, view } from "./_common.ts";

/** The quaternion turning a controller's forward (-Z) from `from` toward `to`. */
function aim(from: P3, to: P3): Quat {
  let [dx, dy, dz] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const l = Math.hypot(dx, dy, dz);
  dx /= l;
  dy /= l;
  dz /= l;
  const [cx, cy, cz, w] = [dy, -dx, 0, 1 - dz];
  const n = Math.hypot(cx, cy, cz, w);
  return [cx / n, cy / n, cz / n, w / n];
}

const HOLD: P3 = [0.17, 0.86, -0.2];

export default defineShot({
  name: "02-command-from-across-the-table",
  description: "Playing black with a Touch controller: the ray orders the g8 knight to f6.",
  seconds: 3,
  still: GALLERY("02-command-from-across-the-table"),
  storage: setupStorage("ivory", "sun"),
  replies: ["e2e4"],
  async setup(ctx) {
    await ctx.page.evaluate(() => ((window as any).__iwer.primaryInputMode = "controller"));
    ctx.camera.cut(ROOM_VIEW);
    await ctx.game.enter({ playerColor: "b", difficulty: "medium" });
    ctx.camera.cut(BOARD_VIEW);
    await ctx.waitFor(() => (window as any).__xr.placement() === "aiming", undefined, { maxMs: 3500, label: "the reticle on the table" });
    await ctx.game.controller("right", HOLD, aim(HOLD, [0.1, 0.5, -0.66]), 1);
    await ctx.waitFor(() => (window as any).__xr.state() === "playing", undefined, { maxMs: 2000, label: "the board placed" });
    await ctx.game.controller("right", HOLD, aim(HOLD, [0.1, 0.5, -0.66]), 0);
    await ctx.wait(200);
    await ctx.waitFor(() => (window as any).__xr.snapshot().sanList.length >= 1, undefined, { maxMs: 8000, label: "white's first move" });
    await ctx.game.settle();
    await ctx.game.arena("sands");
    return { g8: await ctx.game.square("g8"), f6: await ctx.game.square("f6") };
  },
  firstView: ({ f6 }) => view([EYE[0] + 0.2, EYE[1] + 0.25, EYE[2] + 0.28], [f6[0], f6[1] - 0.02, f6[2] - 0.02], 72),
  async play({ game, wait }, { g8, f6 }) {
    await game.controller("right", HOLD, aim(HOLD, up(g8, 0.03)), 0);
    await wait(200);
    await game.controller("right", HOLD, aim(HOLD, up(g8, 0.03)), 1);
    await wait(250);
    for (let k = 1; k <= 8; k++) {
      const t: P3 = [g8[0] + (f6[0] - g8[0]) * (k / 8), g8[1] + 0.01, g8[2] + (f6[2] - g8[2]) * (k / 8)];
      await game.controller("right", HOLD, aim(HOLD, t), 1);
      await wait(40);
    }
    await wait(300);
  },
});
