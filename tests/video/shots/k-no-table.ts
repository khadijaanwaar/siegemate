/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks (window.__xr) are untyped test globals */
// k. No table: the player sits facing the sofa, away from the coffee table, so the reticle finds nothing. The game's
// own fallback (src/xr/placement.ts, FALLBACK_AFTER_S = 8): after 8 s of searching the board settles 0.45 m ahead
// and 0.4 m below the eyes, on its stand-in slab. Most of the 8 s pass off camera; the film keeps the last of the
// search ("Look at your table"), the board arriving, and the look down to it.
import { defineShot } from "../lib/shot.ts";
import { EYE } from "../lib/stage.ts";

/** Turned left, toward the sofa: the gaze never meets the coffee table. */
const AWAY = { from: EYE, at: [-1.0, 0.95, 0.05] as [number, number, number], hfovDeg: 80 };

export default defineShot({
  name: "k-no-table",
  description: "Facing away from any table: after the 8 s search the board settles in front of the player at seat height.",
  seconds: 10,
  async setup({ camera, game, wait, page }) {
    camera.cut(AWAY);
    await game.enter();
    // 5.5 of the 8 searching seconds, unfilmed.
    await wait(5500);
    const p = await page.evaluate(() => String((window as any).__xr.placement()));
    if (p !== "searching") throw new Error(`placement is ${p}, not searching (did the gaze meet the table?)`);
    return {};
  },
  firstView: () => AWAY,
  async play({ camera, game, wait, waitFor, mark, left, right }) {
    // No hands in this one (out of view behind, to the right; "parked" is in view when looking left and down).
    left.place([0.45, 0.4, 0.5]);
    right.place([0.55, 0.4, 0.5]);
    await waitFor(() => (window as any).__xr.placement() === "fallback", undefined, { maxMs: 6000, label: "the fallback board" });
    mark("fallback");
    const [d4, e5] = [await game.square("d4"), await game.square("e5")];
    const at: [number, number, number] = [(d4[0] + e5[0]) / 2, d4[1], (d4[2] + e5[2]) / 2];
    await wait(500);
    // Look down to where it stands (the board's centre, between d4 and e5).
    camera.move({ from: EYE, at, hfovDeg: 78 }, 1400);
    await wait(5600);
  },
});
