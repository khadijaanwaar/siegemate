import { describe, expect, it } from "vitest";

import {
  emptyStats,
  loadStats,
  outcomeFor,
  recordGame,
  saveStats,
  STATS_KEY,
  winRate,
  type FinishedGame,
} from "./stats";

const win: FinishedGame = {
  mode: "ai",
  difficulty: "medium",
  playerColor: "w",
  result: { winner: "w", reason: "checkmate" },
  plies: 41,
  at: 1_000,
};
const loss: FinishedGame = { ...win, result: { winner: "b", reason: "resignation" }, plies: 30, at: 2_000 };
const draw: FinishedGame = { ...win, result: { winner: null, reason: "stalemate" }, plies: 80, at: 3_000 };

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

describe("outcomeFor", () => {
  it("reads the result from the player's side", () => {
    expect(outcomeFor(win)).toBe("win");
    expect(outcomeFor({ ...win, playerColor: "b" })).toBe("loss");
    expect(outcomeFor(draw)).toBe("draw");
  });
});

describe("recordGame", () => {
  it("counts wins, losses and draws overall and per strength", () => {
    let stats = emptyStats();
    stats = recordGame(stats, win);
    stats = recordGame(stats, loss);
    stats = recordGame(stats, draw);
    stats = recordGame(stats, { ...win, difficulty: "hard", at: 4_000 });
    expect(stats.total).toEqual({ wins: 2, losses: 1, draws: 1 });
    expect(stats.byDifficulty.medium).toEqual({ wins: 1, losses: 1, draws: 1 });
    expect(stats.byDifficulty.hard).toEqual({ wins: 1, losses: 0, draws: 0 });
    expect(stats.lastPlayedAt).toBe(4_000);
  });

  it("keeps the current and best winning streak; a draw or a loss ends it", () => {
    let stats = emptyStats();
    for (const game of [win, win, win, loss, win, draw, win]) stats = recordGame(stats, game);
    expect(stats.bestStreak).toBe(3);
    expect(stats.streak).toBe(1);
  });

  it("remembers the fastest win in moves, not plies", () => {
    let stats = emptyStats();
    stats = recordGame(stats, { ...win, plies: 41 });
    stats = recordGame(stats, { ...win, plies: 19 });
    stats = recordGame(stats, { ...loss, plies: 4 });
    expect(stats.fastestWinMoves).toBe(10);
  });

  it("ignores games that are not against the computer", () => {
    const stats = recordGame(emptyStats(), { ...win, mode: "hotseat" });
    expect(stats.total).toEqual({ wins: 0, losses: 0, draws: 0 });
  });

  it("does not change the stats it was given", () => {
    const before = emptyStats();
    recordGame(before, win);
    expect(before.total.wins).toBe(0);
  });
});

describe("winRate", () => {
  it("is null before any decisive or drawn game, else a whole percentage", () => {
    expect(winRate({ wins: 0, losses: 0, draws: 0 })).toBeNull();
    expect(winRate({ wins: 2, losses: 1, draws: 0 })).toBe(67);
  });
});

describe("stats storage", () => {
  it("round-trips", () => {
    const storage = new MemoryStorage();
    const stats = recordGame(emptyStats(), win);
    saveStats(storage, stats);
    expect(loadStats(storage)).toEqual(stats);
  });

  it("starts fresh on a corrupt or foreign entry, or storage that throws", () => {
    const storage = new MemoryStorage();
    storage.setItem(STATS_KEY, "not json");
    expect(loadStats(storage)).toEqual(emptyStats());
    storage.setItem(STATS_KEY, JSON.stringify({ version: 7 }));
    expect(loadStats(storage)).toEqual(emptyStats());
    const hostile = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    expect(loadStats(hostile)).toEqual(emptyStats());
    expect(() => saveStats(hostile, emptyStats())).not.toThrow();
  });
});
