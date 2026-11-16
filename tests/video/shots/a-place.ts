/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks (window.__xr, __iwer) are untyped test globals */
// a. Into mixed reality: the game's page floats in the room as a browser window; the pointer taps
// "Play on your table"; the window gives way to the room, the head tips down to the coffee table,
// the reticle finds it, a pinch puts the board down and the board settles onto the table.
import { defineShot } from "../lib/shot.ts";
import { BOARD_VIEW, EYE, REACH_R } from "../lib/stage.ts";

/** Where the browser window floats: ahead, a little below eye height, 1.2 m wide. */
const WINDOW_AT: [number, number, number] = [0, 1.06, -1.45];

export default defineShot({
  name: "a-place",
  description: "The page in a browser window, tap Play on your table; the room appears, the reticle finds the coffee table, a pinch sets the board down.",
  seconds: 11,
  async setup({ wait }) {
    // The menu, on screen and settled (fonts, the hall behind it).
    await wait(1500);
    return {};
  },
  firstView: () => ({ from: EYE, at: [0, 1.02, -1.45] }),
  async play(ctx) {
    const { camera, right, game, wait, waitFor, mark } = ctx;
    ctx.showWindow(WINDOW_AT, 1.2, 300);
    await wait(700);
    const b = await game.menuButton();
    if (!b) throw new Error("the menu has no mixed reality button");
    const target = ctx.windowPoint(b.x, b.y);
    ctx.cursorTo([target[0] + 0.22, target[1] - 0.16, target[2]], 0);
    await wait(150);
    ctx.cursorTo(target, 800);
    await wait(950);
    ctx.cursorPress(true);
    mark("tap", { button: "Play on your table" });
    await wait(120);
    ctx.cursorPress(false);
    ctx.hideWindow(450);
    await game.enterFromMenu();
    mark("mixed-reality");
    // The room, then a look down to the table: the reticle finds it within reach.
    await wait(300);
    camera.move(BOARD_VIEW, 1700);
    await waitFor(() => (window as any).__xr.placement() === "aiming", undefined, { maxMs: 3000, label: "the reticle on the table" });
    mark("table-found");
    await wait(900);
    // The right hand comes up into view and pinches: the board goes down.
    right.place([0.3, 0.6, -0.25], REACH_R);
    await right.glide([0.17, 0.72, -0.42], 700, { q: REACH_R });
    await right.pinch(180);
    await waitFor(() => (window as any).__xr.state() === "playing", undefined, { maxMs: 1500, label: "the board placed" });
    mark("placed");
    await wait(150);
    await right.open(200);
    right.moveTo([0.42, 0.45, -0.1], 900);
    camera.move({ from: EYE, at: BOARD_VIEW.at, hfovDeg: 80 }, 2200);
    await wait(2600);
  },
});
