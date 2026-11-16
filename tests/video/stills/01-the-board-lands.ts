/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks are untyped test globals */
// Devpost 01: the moment of placement from the seat, looking down about 35°: the board has just stood up inside the
// placement ring, every figure idle; the right hand at the bottom right, fingers just opening from the pinch.
// Dawn Court.
import { defineShot } from "../lib/shot.ts";
import { EYE, REACH_R, ROOM_VIEW } from "../lib/stage.ts";
import { GALLERY, seated, setupStorage } from "./_common.ts";

export default defineShot({
  name: "01-the-board-lands",
  description: "The board lands on the table, the hand opening from the pinch.",
  seconds: 3,
  still: GALLERY("01-the-board-lands"),
  storage: setupStorage("ivory", "sun"),
  async setup(ctx) {
    // Dawn Court is picked from the headset menu once a board stands; then Re-place sends it back to the search.
    await seated(ctx);
    await ctx.game.arena("dawn");
    ctx.camera.cut(ROOM_VIEW);
    await ctx.game.press("menu");
    await ctx.game.press("replace");
    await ctx.waitFor(() => (window as any).__xr.state() === "placing", undefined, { maxMs: 2000, label: "placing again" });
    if ((await ctx.game.ui()).panels.includes("menu")) await ctx.game.press("menu");
    await ctx.wait(300);
    return {};
  },
  firstView: () => ({ from: EYE, at: [0, 0.52, -0.76], hfovDeg: 78 }),
  async play({ right, wait, waitFor }) {
    await waitFor(() => (window as any).__xr.placement() === "aiming", undefined, { maxMs: 3000, label: "the reticle on the table" });
    right.place([0.24, 0.66, -0.36], REACH_R);
    await wait(300);
    await right.pinch(150);
    await waitFor(() => (window as any).__xr.state() === "playing", undefined, { maxMs: 1500, label: "the board placed" });
    await wait(90);
    await right.open(140);
  },
});
