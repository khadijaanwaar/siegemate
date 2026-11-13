import type { SaveStorage } from "./persist";
import type { Difficulty, Faction, GameMode, GameResult } from "./types";

/** Wins, losses and draws, from the player's side of the board. */
export interface Record3 {
  wins: number;
  losses: number;
  draws: number;
}

/**
 * The player's record against the computer, kept on this device. Hotseat and
 * showcase games are not counted: there is no "you" in them.
 */
export interface PlayerStats {
  version: 1;
  total: Record3;
  byDifficulty: Record<Difficulty, Record3>;
  /** Wins in a row right now; a loss or a draw resets it. */
  streak: number;
  bestStreak: number;
  /** The shortest win, in full moves; null before the first win. */
  fastestWinMoves: number | null;
  lastPlayedAt: number | null;
}

/** One finished game, as the shell reports it. */
export interface FinishedGame {
  mode: GameMode;
  difficulty: Difficulty;
  playerColor: Faction;
  result: GameResult;
  /** Half-moves played. */
  plies: number;
  at: number;
}

export type Outcome = "win" | "loss" | "draw";

export const STATS_KEY = "mr-chess:stats";

const zero = (): Record3 => ({ wins: 0, losses: 0, draws: 0 });

export function emptyStats(): PlayerStats {
  return {
    version: 1,
    total: zero(),
    byDifficulty: { easy: zero(), medium: zero(), hard: zero() },
    streak: 0,
    bestStreak: 0,
    fastestWinMoves: null,
    lastPlayedAt: null,
  };
}

export function outcomeFor(game: Pick<FinishedGame, "result" | "playerColor">): Outcome {
  if (game.result.winner === null) return "draw";
  return game.result.winner === game.playerColor ? "win" : "loss";
}

function bump(record: Record3, outcome: Outcome): Record3 {
  return {
    wins: record.wins + (outcome === "win" ? 1 : 0),
    losses: record.losses + (outcome === "loss" ? 1 : 0),
    draws: record.draws + (outcome === "draw" ? 1 : 0),
  };
}

/** The stats after `game`; a new object, `stats` is left as it was. */
export function recordGame(stats: PlayerStats, game: FinishedGame): PlayerStats {
  if (game.mode !== "ai") return stats;
  const outcome = outcomeFor(game);
  const streak = outcome === "win" ? stats.streak + 1 : 0;
  const moves = Math.ceil(game.plies / 2);
  return {
    ...stats,
    total: bump(stats.total, outcome),
    byDifficulty: { ...stats.byDifficulty, [game.difficulty]: bump(stats.byDifficulty[game.difficulty], outcome) },
    streak,
    bestStreak: Math.max(stats.bestStreak, streak),
    fastestWinMoves:
      outcome === "win" ? Math.min(stats.fastestWinMoves ?? Number.POSITIVE_INFINITY, moves) : stats.fastestWinMoves,
    lastPlayedAt: game.at,
  };
}

/** Whole-percent share of games won, or null before any game. */
export function winRate(record: Record3): number | null {
  const games = record.wins + record.losses + record.draws;
  return games === 0 ? null : Math.round((record.wins / games) * 100);
}

function isRecord3(value: unknown): value is Record3 {
  const record = value as Partial<Record3> | null;
  return (
    typeof record === "object" &&
    record !== null &&
    typeof record.wins === "number" &&
    typeof record.losses === "number" &&
    typeof record.draws === "number"
  );
}

function isStats(value: unknown): value is PlayerStats {
  const stats = value as Partial<PlayerStats> | null;
  return (
    typeof stats === "object" &&
    stats !== null &&
    stats.version === 1 &&
    isRecord3(stats.total) &&
    typeof stats.byDifficulty === "object" &&
    stats.byDifficulty !== null &&
    (["easy", "medium", "hard"] as const).every((difficulty) => isRecord3(stats.byDifficulty?.[difficulty])) &&
    typeof stats.streak === "number" &&
    typeof stats.bestStreak === "number"
  );
}

export function loadStats(storage: SaveStorage): PlayerStats {
  try {
    const raw = storage.getItem(STATS_KEY);
    if (!raw) return emptyStats();
    const parsed: unknown = JSON.parse(raw);
    return isStats(parsed) ? parsed : emptyStats();
  } catch {
    return emptyStats();
  }
}

export function saveStats(storage: SaveStorage, stats: PlayerStats): void {
  try {
    storage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // Private browsing or a full quota: the record lives for this visit only.
  }
}
