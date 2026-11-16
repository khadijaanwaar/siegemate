import { ARMY_SKINS, type ArmySkinId } from "../assets/generated";
import type { Difficulty, EndReason, Faction, GameSnapshot } from "../core/types";
import { ARENA_LOOKS, type ArenaTheme } from "../scene/arena";
import { todayStamp, type ReplayGame } from "./replay";

/**
 * The words around a shared battle: the result line, the reason, the
 * battleground and who played — one source for the battle card, the share
 * text and the replay bar.
 */

const REASON: Record<EndReason, string> = {
  checkmate: "Checkmate",
  stalemate: "Stalemate",
  resignation: "By resignation",
  timeout: "On time",
  threefold: "Threefold repetition",
  insufficient: "Insufficient material",
  fiftymove: "Fifty-move rule",
  draw: "Drawn position",
};

const ENGINE: Record<Difficulty, string> = { easy: "Squire", medium: "Knight", hard: "Warlord" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Full moves played (a move is one ply by each side). */
export function fullMoves(game: Pick<ReplayGame, "moves">): number {
  return Math.ceil(game.moves.length / 2);
}

/** The army a side fielded, told apart by colour when both sides chose the same one. */
export function sideName(game: Pick<ReplayGame, "armies">, side: Faction): string {
  const label = ARMY_SKINS[game.armies[side]].label;
  return game.armies.w === game.armies.b ? `${label} (${side === "w" ? "white" : "black"})` : label;
}

/** "the Sun Empire": an army named mid-sentence. */
function objectName(game: Pick<ReplayGame, "armies">, side: Faction): string {
  return `the ${sideName(game, side)}`;
}

/** "Ivory Kingdom beat the Sun Empire in 34 moves". */
export function battleHeadline(game: Pick<ReplayGame, "armies" | "result" | "moves">): string {
  const moves = fullMoves(game);
  const span = `in ${moves} ${moves === 1 ? "move" : "moves"}`;
  const { result } = game;
  if (!result) return `${sideName(game, "w")} met ${objectName(game, "b")} · ${moves} ${moves === 1 ? "move" : "moves"}`;
  if (result.winner === null) return `${sideName(game, "w")} and ${objectName(game, "b")} drew ${span}`;
  const loser: Faction = result.winner === "w" ? "b" : "w";
  return `${sideName(game, result.winner)} beat ${objectName(game, loser)} ${span}`;
}

/** "Checkmate", "By resignation", … or "Unfinished". */
export function battleReason(game: Pick<ReplayGame, "result">): string {
  return game.result ? REASON[game.result.reason] : "Unfinished";
}

export function arenaName(arena: ArenaTheme): string {
  return ARENA_LOOKS[arena].label;
}

/** Who was at the table: "Against the computer · Knight", "Two players", "Showcase · Knight vs Warlord". */
export function battleCompany(game: Pick<ReplayGame, "mode" | "difficulty" | "blackDifficulty" | "playerColor">): string {
  if (game.mode === "ai") return `Against the computer · ${ENGINE[game.difficulty]}`;
  if (game.mode === "demo") return `Showcase · ${ENGINE[game.difficulty]} vs ${ENGINE[game.blackDifficulty]}`;
  return "Two players, one board";
}

/** "16 Nov 2026" from `2026-11-16`. */
export function battleDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1] ?? ""} ${year}`;
}

/** The text that travels with a shared link. */
export function shareText(game: ReplayGame): string {
  return `${battleHeadline(game)}. ${battleReason(game)} on ${arenaName(game.arena)}. Replay it in Siegemate:`;
}

/**
 * The finished match as a shareable replay, or null when there is nothing to
 * share (no game, the attract loop, or a game the link cannot hold).
 */
export function replayFromSnapshot(
  snapshot: GameSnapshot,
  armies: Record<Faction, ArmySkinId>,
  arena: ArenaTheme,
  now: number = Date.now(),
): ReplayGame | null {
  if (snapshot.mode === "attract" || snapshot.moves.length === 0) return null;
  const demo = snapshot.mode === "demo" ? snapshot.demo : null;
  return {
    mode: snapshot.mode,
    playerColor: snapshot.playerColor,
    difficulty: demo ? demo.white : snapshot.difficulty,
    blackDifficulty: demo ? demo.black : snapshot.difficulty,
    armies: { w: armies.w, b: armies.b },
    arena,
    result: snapshot.result,
    date: todayStamp(now),
    moves: snapshot.moves.map((move) => ({ from: move.from, to: move.to, promotion: move.promotion })),
  };
}
