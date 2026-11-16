// Shared games for the sharing e2e specs, encoded with the app's own codec
// (src/share/replay.ts is loaded straight from TypeScript by Node's type stripping).
import { Chess } from "chess.js";

const { encodeReplay } = await import("../../src/share/replay.ts");

function fromSan(sans) {
  const chess = new Chess();
  return sans.map((san) => {
    const move = chess.move(san);
    return { from: move.from, to: move.to, promotion: move.promotion ?? null };
  });
}

/** Scholar's mate: white mates on move 4 (7 plies); Sun Empire vs Grande Armée on Frostfall. */
export const SCHOLARS = {
  mode: "ai",
  playerColor: "w",
  difficulty: "medium",
  blackDifficulty: "medium",
  armies: { w: "sun", b: "empire" },
  arena: "frost",
  result: { winner: "w", reason: "checkmate" },
  date: "2026-11-16",
  moves: fromSan(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]),
};

/** The Opera Game (Morphy, Paris 1858): 33 plies, ends in mate. */
export const OPERA = {
  mode: "hotseat",
  playerColor: "w",
  difficulty: "medium",
  blackDifficulty: "medium",
  armies: { w: "ivory", b: "sun" },
  arena: "jungle",
  result: { winner: "w", reason: "checkmate" },
  date: "2026-11-16",
  moves: fromSan([
    "e4", "e5", "Nf3", "d6", "d4", "Bg4", "dxe5", "Bxf3", "Qxf3", "dxe5", "Bc4", "Nf6", "Qb3", "Qe7",
    "Nc3", "c6", "Bg5", "b5", "Nxb5", "cxb5", "Bxb5+", "Nbd7", "O-O-O", "Rd8", "Rxd7", "Rxd7", "Rd1",
    "Qe6", "Bxd7+", "Nxd7", "Qb8+", "Nxb8", "Rd8#",
  ]),
};

export function token(game) {
  return encodeReplay(game);
}

export function finalFen(game) {
  const chess = new Chess();
  for (const move of game.moves) chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? undefined });
  return chess.fen();
}
