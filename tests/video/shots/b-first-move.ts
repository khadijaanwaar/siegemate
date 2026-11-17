/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks (window.__xr, __iwer) are untyped test globals */
// b. The first move: the right hand pinches the e2 pawn, carries the order to e4, lets go; the pawn
// marches and the computer answers e7-e5.
import { defineShot } from "../lib/shot.ts";
import { BOARD_VIEW, close, EYE, REACH_R, ROOM_VIEW, up } from "../lib/stage.ts";

export default defineShot({
  name: "b-first-move",
  description: "Pinch the e2 pawn, carry the order to e4 and let go: the pawn marches, the computer answers e7-e5.",
  seconds: 13,
  replies: ["e7e5"],
  async setup({ camera, game }) {
    camera.cut(ROOM_VIEW);
    await game.enter();
    await game.place(BOARD_VIEW);
    await game.settle();
    return { e2: await game.square("e2"), e4: await game.square("e4"), e7: await game.square("e7") };
  },
  firstView: ({ e2, e4 }) => close([e2[0] + 0.08, (e2[1] + e4[1]) / 2, (e2[2] + e4[2]) / 2 - 0.04], 58),
  async play({ camera, right, game, wait, until, waitFor, mark }, { e2, e4, e7 }) {
    // The hand comes in from the lower right, open, and hovers over the pawn.
    right.place([e2[0] + 0.32, e2[1] + 0.05, e2[2] + 0.22], REACH_R);
    await wait(500);
    await right.glide(up(e2, 0.07), 1100, { q: REACH_R });
    await wait(150);
    await right.glide(up(e2, 0.02), 450);
    await right.pinch(200);
    mark("pinch", { square: "e2" });
    await wait(250);
    // Carry the order up the board: the command line follows the hand to e4.
    await right.arc(up(e4, 0.025), 1500, 0.035);
    await wait(200);
    await right.open(220);
    mark("release", { square: "e4" });
    // The hand drifts back out of the way while the pawn marches; the eye follows up the board.
    right.moveTo([e4[0] + 0.3, e4[1] + 0.02, e4[2] + 0.35], 1200);
    camera.move(close([0.06, e4[1], (e4[2] + e7[2]) / 2], 66), 2200);
    await waitFor(() => (window as any).__xr.snapshot().sanList.length >= 2, undefined, { maxMs: 8000, label: "the computer's reply" });
    mark("reply");
    await game.settle(8000);
    camera.move({ from: EYE, at: BOARD_VIEW.at, hfovDeg: 80 }, 1800);
    await wait(1800);
    await until(12);
  },
});
