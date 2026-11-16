/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks (window.__xr, __iwer) are untyped test globals */
// d. Promotion: a white pawn has fought its way to b7. The hand sends it into a8, taking the rook;
// the headset's promotion card offers Queen, Rook, Bishop, Knight; a poke on Queen crowns it.
import type { P3 } from "../lib/hands.ts";
import { defineShot } from "../lib/shot.ts";
import { BOARD_VIEW, close, EYE, POKE_R, REACH_R, ROOM_VIEW, up } from "../lib/stage.ts";

/** Ids the promotion card's Queen button may have (Lane A's card; the first one on show is used). */
const QUEEN_IDS = ["promote-q", "promote-queen", "promotion-q", "promo-q", "queen", "q"];

export default defineShot({
  name: "d-promotion",
  description: "The b7 pawn takes the rook on a8; the headset's promotion card comes up; a poke on Queen crowns it.",
  seconds: 12,
  // 1.e4 d5 2.exd5 c6 3.dxc6 Nf6 4.cxb7 Bf5, and after the promotion a quiet reply.
  replies: ["d7d5", "c7c6", "g8f6", "c8f5", "e7e6"],
  async setup({ camera, game }) {
    camera.cut(ROOM_VIEW);
    await game.enter();
    await game.place(BOARD_VIEW);
    await game.settle();
    await game.play("e2e4");
    await game.play("e4d5");
    await game.play("d5c6");
    await game.play("c6b7");
    return { b7: await game.square("b7"), a8: await game.square("a8") };
  },
  firstView: ({ b7, a8 }) => close([(b7[0] + a8[0]) / 2 + 0.03, b7[1], (b7[2] + a8[2]) / 2 + 0.06], 48),
  async play({ camera, right, game, page, wait, waitFor, until, mark }, { b7, a8 }) {
    right.place([b7[0] + 0.32, b7[1] + 0.05, b7[2] + 0.3], REACH_R);
    await wait(400);
    await right.glide(up(b7, 0.07), 1000, { q: REACH_R });
    await right.glide(up(b7, 0.02), 420);
    await right.pinch(200);
    mark("pinch", { square: "b7" });
    await wait(200);
    await right.arc(up(a8, 0.025), 700, 0.03);
    await wait(200);
    await right.open(220);
    mark("release", { square: "a8" });
    right.moveTo([a8[0] + 0.35, a8[1] + 0.05, a8[2] + 0.45], 1000);
    // The card: wait for one of its buttons to be on show.
    await waitFor(
      (ids) => ids.some((id) => (window as any).__xr.buttonWorld(id)),
      QUEEN_IDS,
      { maxMs: 8000, label: "the promotion card (Lane A)" },
    );
    const queen = (await page.evaluate((ids) => ids.find((id) => (window as any).__xr.buttonWorld(id)) ?? null, QUEEN_IDS)) as string;
    mark("promotion-card");
    const card = (await game.button(queen)) as P3;
    camera.move(close([(card[0] + a8[0]) / 2, (card[1] + a8[1]) / 2, (card[2] + a8[2]) / 2 + 0.04], 70), 900);
    await wait(700);
    await right.poke(queen, { q: POKE_R, approachMs: 800 });
    mark("promoted", { to: "queen" });
    right.moveTo([a8[0] + 0.4, a8[1] - 0.1, a8[2] + 0.5], 900);
    camera.move(close([a8[0] + 0.05, a8[1], a8[2] + 0.08], 62), 1200);
    await game.settle(10_000);
    await wait(1200);
    camera.move({ from: EYE, at: BOARD_VIEW.at, hfovDeg: 80 }, 1600);
    await wait(1600);
    await until(11);
  },
});
