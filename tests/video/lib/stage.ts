// The film's set: the photographed lounge, where its coffee table is, and the seated views shots
// start from. See assets/rooms/README.md for how the table was matched to the photograph.
import type { RoomSpec } from "./boot.ts";
import type { View } from "./camera.ts";
import { handTurn, type P3 } from "./hands.ts";

/** The seated eye: everything is filmed from here (a panorama has no parallax; only turn and zoom). */
export const EYE: [number, number, number] = [0, 1.1, 0];

export const LOUNGE: RoomSpec = {
  file: "tests/video/assets/rooms/anniversary_lounge-film.jpg",
  yawDeg: 105.5,
  table: { y: 0.5, x0: -0.32, x1: 0.32, z0: -1.2, z1: -0.38 },
};

/** Where the board's centre comes to rest when placed from the seat (the reticle's hit). */
export const BOARD_AT: [number, number, number] = [0, 0.5, -0.66];

/** Looking ahead into the room, over the table (no reticle: the table is below the view's centre). */
export const ROOM_VIEW: View = { from: EYE, at: [0, 1.0, -1] };

/** Looking down at the board as a seated player does. */
export const BOARD_VIEW: View = { from: EYE, at: [0, 0.52, -0.66] };

/** A seated player's view of the board, a little closer (lens), for the hands at work. */
export const close = (at: [number, number, number], hfovDeg = 64): View => ({ from: EYE, at, hfovDeg });

/** The film keeps its first-run state out of the way unless a shot asks for it. */
export const STORAGE: Record<string, string> = {
  "mr-chess:onboarded": "1",
  "mr-chess:board-size": "0.95",
};

/** The right hand reaching in from the right to pick a figure: fingers pointing left and down, thumb up. */
export const REACH_R = handTurn(75, -25, 75);
/** The left hand coming in to poke a headset button: index ahead, a little in. */
export const POKE_L = handTurn(-20, -20, -10);
/** The right hand coming in to poke. */
export const POKE_R = handTurn(20, -20, 10);

/** `p` raised by `dy` metres. */
export const up = (p: P3, dy: number): P3 => [p[0], p[1] + dy, p[2]];
