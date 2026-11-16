import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";

import type { PieceKind } from "../core/types";
import {
  REPLAY_HASH_KEY,
  decodeReplay,
  encodeReplay,
  legalMoves,
  readReplayHash,
  replayUrl,
  type ReplayGame,
  type ReplayMove,
} from "./replay";

const SITE = "https://siegemate.pages.dev/";

/** Plays SAN moves on a fresh board and returns them as from/to/promotion. */
function movesFromSan(sans: string[]): ReplayMove[] {
  const chess = new Chess();
  return sans.map((san) => {
    const move = chess.move(san);
    return { from: move.from, to: move.to, promotion: (move.promotion as PieceKind | undefined) ?? null };
  });
}

/** A deterministic pseudo-random legal game (mulberry32), `plies` long or until it ends. */
function randomGame(plies: number, seed: number): ReplayMove[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const chess = new Chess();
  const out: ReplayMove[] = [];
  while (out.length < plies) {
    const legal = legalMoves(chess);
    if (legal.length === 0) break;
    const move = legal[Math.floor(next() * legal.length)];
    chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? undefined });
    out.push(move);
  }
  return out;
}

function game(overrides: Partial<ReplayGame> = {}): ReplayGame {
  return {
    mode: "ai",
    playerColor: "w",
    difficulty: "medium",
    blackDifficulty: "medium",
    armies: { w: "ivory", b: "sun" },
    arena: "jungle",
    result: { winner: "b", reason: "checkmate" },
    date: "2026-11-16",
    // Fool's mate: black mates on the fourth ply.
    moves: movesFromSan(["f3", "e5", "g4", "Qh4#"]),
    ...overrides,
  };
}

// Kingside and queenside castling, en passant and an under-promotion to a knight.
const SPECIAL_SAN = [
  "e4", "d5", "e5", "f5", "exf6", "Nc6", "fxg7", "Bd7", "gxh8=N", "e6",
  "Nf3", "Qe7", "Bc4", "O-O-O", "O-O", "e5",
];

// Whole games are replayed move by move here: generous timeouts for a busy machine.
describe("replay link codec", { timeout: 30_000 }, () => {
  it("round-trips a finished game with every field", () => {
    const original = game({
      mode: "demo",
      playerColor: "b",
      difficulty: "hard",
      blackDifficulty: "easy",
      armies: { w: "empire", b: "ivory" },
      arena: "dusk",
      date: "2031-02-28",
    });
    expect(decodeReplay(encodeReplay(original))).toEqual(original);
  });

  it("round-trips every army and battleground", () => {
    const armies = ["ivory", "sun", "empire"] as const;
    const arenas = ["dawn", "frost", "dusk", "jungle", "sands", "storm"] as const;
    for (const w of armies) {
      for (const b of armies) {
        for (const arena of arenas) {
          const original = game({ armies: { w, b }, arena });
          expect(decodeReplay(encodeReplay(original))).toEqual(original);
        }
      }
    }
  });

  it("keeps castling, en passant and under-promotion", () => {
    const moves = movesFromSan(SPECIAL_SAN);
    const original = game({ moves, result: { winner: "w", reason: "resignation" } });
    const decoded = decodeReplay(encodeReplay(original));
    expect(decoded).toEqual(original);
    expect(decoded?.moves).toContainEqual({ from: "g7", to: "h8", promotion: "n" });
    expect(decoded?.moves).toContainEqual({ from: "e5", to: "f6", promotion: null }); // en passant
    expect(decoded?.moves).toContainEqual({ from: "e1", to: "g1", promotion: null });
    expect(decoded?.moves).toContainEqual({ from: "e8", to: "c8", promotion: null });
  });

  it("keeps a result that the moves alone cannot show", () => {
    for (const result of [
      { winner: "w", reason: "timeout" },
      { winner: "b", reason: "resignation" },
      { winner: null, reason: "draw" },
      null,
    ] as const) {
      const original = game({ moves: movesFromSan(["e4", "e5", "Nf3"]), result });
      expect(decodeReplay(encodeReplay(original))?.result).toEqual(result);
    }
  });

  it("round-trips an empty game and a long one", () => {
    const empty = game({ moves: [], result: { winner: "b", reason: "resignation" } });
    expect(decodeReplay(encodeReplay(empty))).toEqual(empty);
    const long = game({ moves: randomGame(400, 7), result: null });
    expect(decodeReplay(encodeReplay(long))).toEqual(long);
  });

  it("keeps a 60-move game well under a QR-friendly 300 characters, link included", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const moves = randomGame(120, seed);
      const url = replayUrl(game({ moves, result: null }), SITE);
      expect(url.length).toBeLessThan(300);
    }
  });

  it("builds a link the hash reader takes back", () => {
    const original = game();
    const url = replayUrl(original, SITE);
    expect(url.startsWith(`${SITE}#${REPLAY_HASH_KEY}=`)).toBe(true);
    const hash = url.slice(url.indexOf("#"));
    expect(readReplayHash(hash)).toEqual({ present: true, game: original });
    expect(readReplayHash("")).toEqual({ present: false, game: null });
    expect(readReplayHash("#settings")).toEqual({ present: false, game: null });
    expect(readReplayHash(`#${REPLAY_HASH_KEY}=nonsense`)).toEqual({ present: true, game: null });
  });

  it("uses only URL-safe characters", () => {
    const token = encodeReplay(game({ moves: randomGame(200, 9), result: null }));
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects every single-character change", () => {
    const token = encodeReplay(game({ moves: movesFromSan(SPECIAL_SAN), result: null }));
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let index = 0; index < token.length; index += 1) {
      for (const replacement of [alphabet[(alphabet.indexOf(token[index]) + 1) % 64], alphabet[(alphabet.indexOf(token[index]) + 29) % 64]]) {
        const tampered = token.slice(0, index) + replacement + token.slice(index + 1);
        expect(decodeReplay(tampered)).toBeNull();
      }
    }
  });

  it("rejects truncation, extension, junk and an unknown version", () => {
    const token = encodeReplay(game());
    expect(decodeReplay(token.slice(0, -1))).toBeNull();
    expect(decodeReplay(token.slice(0, 5))).toBeNull();
    expect(decodeReplay(`${token}A`)).toBeNull();
    expect(decodeReplay(`9${token.slice(1)}`)).toBeNull();
    expect(decodeReplay("")).toBeNull();
    expect(decodeReplay("1")).toBeNull();
    expect(decodeReplay("1!!!!")).toBeNull();
    expect(decodeReplay("1 abc")).toBeNull();
    expect(decodeReplay(null as unknown as string)).toBeNull();
  });

  it("refuses a result the final position contradicts", () => {
    const quiet = movesFromSan(["e4", "e5"]);
    expect(() => encodeReplay(game({ moves: quiet, result: { winner: "w", reason: "checkmate" } }))).toThrow();
    expect(() => encodeReplay(game({ result: { winner: "w", reason: "checkmate" } }))).toThrow(); // black mated white
    expect(() => encodeReplay(game({ moves: quiet, result: { winner: null, reason: "stalemate" } }))).toThrow();
    expect(() => encodeReplay(game({ moves: quiet, result: { winner: null, reason: "resignation" } }))).toThrow();
  });

  it("orders legal moves the same through chess.js's fast and public generators", () => {
    const chess = new Chess();
    for (const game of [movesFromSan(SPECIAL_SAN), randomGame(20, 11)]) {
      chess.reset();
      for (const move of game) {
        expect(legalMoves(chess, true)).toEqual(legalMoves(chess, false));
        chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? undefined });
      }
    }
    // A position with promotions on offer.
    chess.load("8/P6k/8/8/8/8/6Kp/8 w - - 0 1");
    expect(legalMoves(chess, true)).toEqual(legalMoves(chess, false));
    expect(legalMoves(chess).filter((move) => move.from === "a7").map((move) => move.promotion)).toEqual(["b", "n", "q", "r"]);
  });

  it("refuses an illegal move", () => {
    expect(() => encodeReplay(game({ moves: [{ from: "e2", to: "e5", promotion: null }], result: null }))).toThrow();
  });
});
