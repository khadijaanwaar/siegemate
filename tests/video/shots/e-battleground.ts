// e. The room takes on the battleground: from the headset menu, Battleground steps from Dune
// Bastion to Frostfall (snow in the room), Stormwatch (rain) and Siege at Dusk (embers), and the
// room's tint and weather change with it.
import { defineShot } from "../lib/shot.ts";
import { BOARD_VIEW, EYE, POKE_L, ROOM_VIEW } from "../lib/stage.ts";

export default defineShot({
  name: "e-battleground",
  description: "Menu, then Battleground three times: the room turns from desert gold to falling snow, rain, then dusk embers.",
  seconds: 14,
  async setup({ camera, game, wait }) {
    camera.cut(ROOM_VIEW);
    await game.enter();
    await game.place(BOARD_VIEW);
    await game.settle();
    // Two steps on before the shot (Sun Temple -> Dawn Court -> Dune Bastion), menu closed again.
    await game.press("menu");
    await game.press("arena");
    await wait(400);
    await game.press("arena");
    await wait(400);
    await game.press("menu");
    await wait(2500);
    return {};
  },
  // Wider than a player's working view, a little up from the board: the room around it is the subject.
  firstView: () => ({ from: EYE, at: [0, 0.6, -0.7], hfovDeg: 84 }),
  async play({ camera, left, wait, until, mark }) {
    left.place("parked", POKE_L);
    await wait(700);
    await left.poke("menu", { q: POKE_L, approachMs: 900 });
    mark("menu-open");
    await wait(500);
    for (const step of ["frost", "storm", "dusk"]) {
      await left.poke("arena", { approachMs: 450 });
      mark("battleground", { to: step });
      // Look up into the room a little while it changes, then back.
      camera.move({ from: EYE, at: [0, 0.72, -0.75], hfovDeg: 88 }, 1200);
      await wait(1500);
      camera.move({ from: EYE, at: [0, 0.6, -0.7], hfovDeg: 84 }, 900);
      await wait(900);
    }
    await left.poke("menu", { approachMs: 450 });
    mark("menu-closed");
    left.moveTo([-0.45, 0.4, -0.1], 900);
    camera.move({ from: EYE, at: BOARD_VIEW.at, hfovDeg: 80 }, 1500);
    await wait(1500);
    await until(14);
  },
});
