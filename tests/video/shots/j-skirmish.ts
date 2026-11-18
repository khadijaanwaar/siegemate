/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks (window.__xr) are untyped test globals */
// j. A stretch of real play: the Grande Armée (white) against the Ivory Kingdom in the Sun Temple. After
// 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5 d5 (off camera) the hand plays the Fried Liver: 5.exd5 Nxd5 6.Nxf7 Kxf7
// 7.Qf3+ Ke6. Four fights and a check, the computer answering each move.
import type { P3 } from "../lib/hands.ts";
import { defineShot } from "../lib/shot.ts";
import { BOARD_VIEW, close, EYE, REACH_R, ROOM_VIEW, up } from "../lib/stage.ts";

export default defineShot({
  name: "j-skirmish",
  description: "The Fried Liver on the table: exd5 Nxd5, Nxf7 Kxf7, Qf3+ Ke6; four fights and a check, Grande Armée against Ivory.",
  seconds: 26,
  storage: { "kg.armies": JSON.stringify({ w: "empire", b: "ivory" }) },
  replies: ["e7e5", "b8c6", "g8f6", "d7d5", "f6d5", "e8f7", "f7e6"],
  async setup({ camera, game }) {
    camera.cut(ROOM_VIEW);
    await game.enter();
    await game.place(BOARD_VIEW);
    await game.settle();
    await game.arena("jungle");
    for (const m of ["e2e4", "g1f3", "f1c4", "f3g5"]) await game.play(m);
    const sq = async (s: string) => (await game.square(s)) as P3;
    return { e4: await sq("e4"), d5: await sq("d5"), g5: await sq("g5"), f7: await sq("f7"), d1: await sq("d1"), f3: await sq("f3"), e6: await sq("e6") };
  },
  // From the seat, on the centre and the black king's side, close enough for the fights.
  firstView: ({ d5, f7 }) => close([(d5[0] + f7[0]) / 2 + 0.02, d5[1], (d5[2] + f7[2]) / 2 + 0.06], 60),
  async play({ camera, right, wait, waitFor, game, mark, page }, { e4, d5, g5, f7, d1, f3, e6 }) {
    /** The hand takes the figure on `from` to `to`, lets go and drifts off to the right. */
    const order = async (from: P3, to: P3, name: string, arcMs: number) => {
      right.place([from[0] + 0.3, from[1] + 0.04, from[2] + 0.24], REACH_R);
      await wait(250);
      await right.glide(up(from, 0.07), 800, { q: REACH_R });
      await wait(100);
      await right.glide(up(from, 0.02), 380);
      await right.pinch(180);
      mark("pinch", { move: name });
      await wait(150);
      await right.arc(up(to, 0.025), arcMs, 0.035);
      await wait(200);
      await right.open(200);
      mark("release", { move: name });
      right.moveTo([to[0] + 0.34, to[1] + 0.03, to[2] + 0.42], 1200);
    };
    /** Until the computer's reply (ply `n`) has landed and every fight is over. */
    const answered = async (n: number, label: string) => {
      await waitFor((k) => (window as any).__xr.snapshot().sanList.length >= k, n, { maxMs: 15_000, label });
      mark("reply", { san: await page.evaluate(() => (window as any).__xr.snapshot().sanList.at(-1)) });
      await game.settle(12_000);
    };

    await order(e4, d5, "exd5", 800);
    await answered(10, "exd5 Nxd5");
    await wait(300);
    await order(g5, f7, "Nxf7", 900);
    await answered(12, "Nxf7 Kxf7");
    // Back a little and toward the player for the queen's check from d1.
    camera.move(close([(d1[0] + e6[0]) / 2 + 0.03, d1[1], (d1[2] + e6[2]) / 2 + 0.02], 66), 1000);
    await wait(500);
    await order(d1, f3, "Qf3+", 900);
    mark("check");
    await answered(14, "Qf3+ Ke6");
    camera.move({ from: EYE, at: BOARD_VIEW.at, hfovDeg: 78 }, 1400);
    await wait(1600);
  },
});
