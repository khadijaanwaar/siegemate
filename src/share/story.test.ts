import { describe, expect, it } from "vitest";

import type { GameSnapshot, LedgerMove } from "../core/types";
import { decodeReplay, encodeReplay, type ReplayGame } from "./replay";
import { battleCompany, battleDate, battleHeadline, battleReason, replayFromSnapshot, sideName } from "./story";

const base: Pick<ReplayGame, "armies" | "result" | "moves"> = {
  armies: { w: "ivory", b: "sun" },
  result: { winner: "w", reason: "checkmate" },
  moves: Array.from({ length: 67 }, () => ({ from: "a1", to: "a2", promotion: null })),
};

describe("battle story", () => {
  it("names the winner, the beaten army and the length", () => {
    expect(battleHeadline(base)).toBe("Ivory Kingdom beat the Sun Empire in 34 moves");
    expect(battleHeadline({ ...base, result: { winner: "b", reason: "resignation" } })).toBe(
      "Sun Empire beat the Ivory Kingdom in 34 moves",
    );
    expect(battleHeadline({ ...base, result: { winner: null, reason: "stalemate" } })).toBe(
      "Ivory Kingdom and the Sun Empire drew in 34 moves",
    );
    expect(battleHeadline({ ...base, moves: base.moves.slice(0, 1) })).toBe("Ivory Kingdom beat the Sun Empire in 1 move");
  });

  it("tells two copies of one army apart by colour", () => {
    const mirror = { ...base, armies: { w: "empire", b: "empire" } as const };
    expect(sideName(mirror, "b")).toBe("Grande Armée (black)");
    expect(battleHeadline(mirror)).toBe("Grande Armée (white) beat the Grande Armée (black) in 34 moves");
  });

  it("words the reason, the company and the date", () => {
    expect(battleReason({ result: { winner: "w", reason: "timeout" } })).toBe("On time");
    expect(battleReason({ result: null })).toBe("Unfinished");
    expect(battleCompany({ mode: "ai", difficulty: "hard", blackDifficulty: "hard", playerColor: "w" })).toBe(
      "Against the computer · Warlord",
    );
    expect(battleCompany({ mode: "demo", difficulty: "easy", blackDifficulty: "hard", playerColor: "w" })).toBe(
      "Showcase · Squire vs Warlord",
    );
    expect(battleDate("2026-11-16")).toBe("16 Nov 2026");
  });
});

describe("replayFromSnapshot", () => {
  const ledger = (from: string, to: string, promotion: LedgerMove["promotion"] = null): LedgerMove => ({
    ply: 0,
    number: 1,
    color: "w",
    kind: "p",
    san: "",
    from,
    to,
    capture: false,
    castle: false,
    promotion,
    check: false,
    mate: false,
  });
  const snapshot = {
    mode: "ai",
    difficulty: "hard",
    playerColor: "b",
    demo: null,
    result: { winner: "b", reason: "checkmate" },
    moves: [ledger("f2", "f3"), ledger("e7", "e5"), ledger("g2", "g4"), ledger("d8", "h4")],
  } as unknown as GameSnapshot;

  it("carries the match into a link that decodes to the same game", () => {
    const game = replayFromSnapshot(snapshot, { w: "sun", b: "empire" }, "storm", Date.UTC(2026, 10, 16, 23, 0));
    expect(game).toMatchObject({
      mode: "ai",
      playerColor: "b",
      difficulty: "hard",
      armies: { w: "sun", b: "empire" },
      arena: "storm",
      date: "2026-11-16",
    });
    expect(decodeReplay(encodeReplay(game as ReplayGame))).toEqual(game);
  });

  it("keeps both engines of a showcase and skips the attract loop and empty games", () => {
    const demo = { ...snapshot, mode: "demo", demo: { white: "easy", black: "hard", speed: 1, autoRematch: false } } as GameSnapshot;
    expect(replayFromSnapshot(demo, { w: "ivory", b: "sun" }, "jungle")).toMatchObject({ difficulty: "easy", blackDifficulty: "hard" });
    expect(replayFromSnapshot({ ...snapshot, mode: "attract" } as GameSnapshot, { w: "ivory", b: "sun" }, "jungle")).toBeNull();
    expect(replayFromSnapshot({ ...snapshot, moves: [] } as GameSnapshot, { w: "ivory", b: "sun" }, "jungle")).toBeNull();
  });
});
