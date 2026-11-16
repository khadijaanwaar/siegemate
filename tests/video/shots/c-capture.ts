/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks (window.__xr, __iwer) are untyped test globals */
// c. A capture fight on the table: after 1.e4 d5 the right hand sends the e4 pawn into d5; the
// pawn strikes the defender down, and the black queen comes out and takes it back (Qxd5).
import { defineShot } from "../lib/shot.ts";
import { BOARD_VIEW, close, EYE, REACH_R, ROOM_VIEW, up } from "../lib/stage.ts";

export default defineShot({
  name: "c-capture",
  description: "After 1.e4 d5 the hand sends the e4 pawn into d5: it strikes the black pawn down; the black queen takes back (Qxd5).",
  seconds: 13,
  replies: ["d7d5", "d8d5"],
  async setup({ camera, game }) {
    camera.cut(ROOM_VIEW);
    await game.enter();
    await game.place(BOARD_VIEW);
    await game.settle();
    await game.play("e2e4");
    return { e4: await game.square("e4"), d5: await game.square("d5"), d8: await game.square("d8") };
  },
  // Close on the two pawns, from the seat (a lens move, not a lean: the room stays true).
  firstView: ({ e4, d5 }) => close([(e4[0] + d5[0]) / 2 + 0.02, e4[1], (e4[2] + d5[2]) / 2 + 0.03], 48),
  async play({ camera, right, game, wait, waitFor, until, mark }, { e4, d5, d8 }) {
    right.place([e4[0] + 0.3, e4[1] + 0.04, e4[2] + 0.25], REACH_R);
    await wait(400);
    await right.glide(up(e4, 0.07), 1000, { q: REACH_R });
    await wait(120);
    await right.glide(up(e4, 0.02), 420);
    await right.pinch(200);
    mark("pinch", { square: "e4" });
    await wait(200);
    await right.arc(up(d5, 0.025), 800, 0.03);
    await wait(250);
    await right.open(220);
    mark("release", { square: "d5" });
    right.moveTo([d5[0] + 0.32, d5[1] + 0.03, d5[2] + 0.4], 1300);
    // Hold on the fight, then widen as the queen comes down the file.
    // The fight on d5 ends when the computer starts thinking (or has already answered).
    await waitFor(() => {
      const s = (window as any).__xr.snapshot();
      return s.sanList.length >= 4 || (s.sanList.length === 3 && !s.busy);
    }, undefined, { maxMs: 10_000, label: "exd5 fought out" });
    mark("white-captured");
    camera.move(close([(d5[0] + d8[0]) / 2, d5[1], (d5[2] + d8[2]) / 2 + 0.02], 58), 1400);
    await waitFor(() => (window as any).__xr.snapshot().sanList.length >= 4, undefined, { maxMs: 8000, label: "Qxd5 played" });
    mark("black-recaptures");
    await game.settle(10_000);
    camera.move({ from: EYE, at: BOARD_VIEW.at, hfovDeg: 78 }, 1400);
    await wait(1400);
  },
});
