/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks (window.__xr, __iwer) are untyped test globals */
// g. Checkmate and the result card: after 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? the hand sends the queen
// into f7 (Qxf7#); the result card rises over the table, and "Share this battle" shows the replay
// link as a QR code for a phone to pick up.
import { defineShot } from "../lib/shot.ts";
import { BOARD_VIEW, close, EYE, POKE_R, REACH_R, ROOM_VIEW, up } from "../lib/stage.ts";

/** Ids the result card's share button may have once Lane C adds it (the first one on show is used). */
const SHARE = ["share", "share-battle", "share-qr", "qr"];

export default defineShot({
  name: "g-result",
  description: "Qxf7#: the queen takes f7, the result card rises; Share this battle shows the replay link as a QR code.",
  seconds: 13,
  replies: ["e7e5", "b8c6", "g8f6"],
  async setup({ camera, game }) {
    camera.cut(ROOM_VIEW);
    await game.enter();
    await game.place(BOARD_VIEW);
    await game.settle();
    await game.play("e2e4");
    await game.play("f1c4");
    await game.play("d1h5");
    return { h5: await game.square("h5"), f7: await game.square("f7") };
  },
  firstView: ({ h5, f7 }) => close([(h5[0] + f7[0]) / 2, h5[1], (h5[2] + f7[2]) / 2 + 0.04], 50),
  async play({ camera, right, game, page, wait, waitFor, until, mark }, { h5, f7 }) {
    right.place([h5[0] + 0.3, h5[1] + 0.05, h5[2] + 0.3], REACH_R);
    await wait(400);
    await right.glide(up(h5, 0.08), 1000, { q: REACH_R });
    await right.glide(up(h5, 0.03), 420);
    await right.pinch(200);
    mark("pinch", { square: "h5" });
    await wait(200);
    await right.arc(up(f7, 0.03), 900, 0.035);
    await wait(200);
    await right.open(220);
    mark("release", { square: "f7" });
    right.moveTo([f7[0] + 0.35, f7[1] + 0.02, f7[2] + 0.5], 1100);
    await waitFor(() => (window as any).__xr.snapshot().status !== "playing", undefined, { maxMs: 10_000, label: "checkmate" });
    mark("checkmate");
    // The result card: wait for it, then take it in with the board.
    await waitFor(() => (window as any).__xr.ui().panels.includes("result"), undefined, { maxMs: 8000, label: "the result card" });
    mark("result-card");
    // Close on the card (and later its QR code), from the seat.
    const card = (await game.button("rematch")) ?? BOARD_VIEW.at;
    camera.move(close([card[0] + 0.03, card[1] - 0.01, card[2]], 56), 1600);
    await wait(2200);
    const share = (await page.evaluate((ids) => ids.find((id) => (window as any).__xr.buttonWorld(id)) ?? null, SHARE)) as string | null;
    if (share) {
      await right.poke(share, { q: POKE_R, approachMs: 900 });
      mark("share-qr");
      right.moveTo([0.45, 0.4, -0.1], 900);
      await wait(3000);
    } else {
      mark("no-share-button-yet");
      await wait(1500);
    }
    await until(12);
  },
});
