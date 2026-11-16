/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks (window.__xr, __iwer) are untyped test globals */
// f. The headset menu: the left hand opens Menu on the slab beside the board, raises the board two
// steps with Height ▲, and turns the sound off and on again.
import { defineShot } from "../lib/shot.ts";
import { BOARD_VIEW, EYE, POKE_L, ROOM_VIEW } from "../lib/stage.ts";

/** Ids the menu's buttons may have once Lane A adds them (the first one on show is used). */
const HEIGHT_UP = ["height-up", "raise", "up", "height+"];
const SOUND = ["sound", "sound-toggle", "audio", "sfx"];

export default defineShot({
  name: "f-menu",
  description: "Menu on the slab, Height ▲ twice (the board rises), Sound off and on: the headset's own controls.",
  seconds: 11,
  async setup({ camera, game }) {
    camera.cut(ROOM_VIEW);
    await game.enter();
    await game.place(BOARD_VIEW);
    await game.settle();
    return {};
  },
  firstView: () => ({ from: EYE, at: [0.13, 0.62, -0.64], hfovDeg: 82 }),
  async play({ left, page, wait, until, mark, waitFor }) {
    const first = async (ids: string[]) => (await page.evaluate((list) => list.find((id) => (window as any).__xr.buttonWorld(id)) ?? null, ids)) as string | null;
    left.place("parked", POKE_L);
    await wait(600);
    await left.poke("menu", { q: POKE_L, approachMs: 1000 });
    mark("menu-open");
    await waitFor((ids) => ids.some((id) => (window as any).__xr.buttonWorld(id)), HEIGHT_UP, { maxMs: 1500, label: "Height ▲ on the menu (Lane A)" });
    await wait(400);
    const upId = (await first(HEIGHT_UP))!;
    for (let i = 0; i < 2; i++) {
      await left.poke(upId, { approachMs: 500 });
      mark("height-up");
      await wait(600);
    }
    const sound = await first(SOUND);
    if (sound) {
      await left.poke(sound, { approachMs: 500 });
      mark("sound", { on: false });
      await wait(900);
      await left.poke(sound, { approachMs: 300 });
      mark("sound", { on: true });
      await wait(600);
    }
    await left.poke("menu", { approachMs: 500 });
    mark("menu-closed");
    left.moveTo([-0.45, 0.4, -0.1], 900);
    await wait(1200);
    await until(11);
  },
});
