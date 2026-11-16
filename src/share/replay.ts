import { Chess } from "chess.js";

import type { ArmySkinId } from "../assets/generated";
import type { Difficulty, EndReason, Faction, GameResult, PieceKind, SquareId } from "../core/types";
import type { ArenaTheme } from "../scene/arena";

/**
 * A finished (or abandoned) game, small enough to travel in a URL hash.
 *
 * `#r=<token>` carries the whole battle: the moves, who played what, the armies
 * and the battleground, and how it ended. There is no server: the link is the
 * game, so it opens offline from the service-worker cache and never reaches the
 * network (a hash is not sent with the request).
 */
export interface ReplayMove {
  from: SquareId;
  to: SquareId;
  promotion: PieceKind | null;
}

export type ReplayMode = "ai" | "hotseat" | "demo";

export interface ReplayGame {
  mode: ReplayMode;
  /** The human's side against the computer (white otherwise). */
  playerColor: Faction;
  /** The computer's strength; in a showcase, the white engine's. */
  difficulty: Difficulty;
  /** The black engine's strength in a showcase; the same as `difficulty` otherwise. */
  blackDifficulty: Difficulty;
  armies: Record<Faction, ArmySkinId>;
  arena: ArenaTheme;
  /** How it ended; null when the game was left unfinished. */
  result: GameResult | null;
  /** The UTC day it was played, `YYYY-MM-DD`. */
  date: string;
  moves: ReplayMove[];
}

/** The hash key: `#r=<token>`. */
export const REPLAY_HASH_KEY = "r";

/**
 * Wire format, version 1 (the token's first character):
 *
 *   "1" + base64url(bytes), no padding, where bytes =
 *     [0] mode:2 | side:1 | strength:2 | black strength:2 | 0
 *     [1] white army:2 | black army:2 | battleground:3 | 0
 *     [2] outcome:2 (none, white, black, draw) | reason:3 | 000
 *     [3..4] day number since 2020-01-01 (UTC), big-endian
 *     varint  ply count
 *     ...     the moves: one mixed-radix integer, big-endian, no leading zero
 *     last 3  checksum of everything before it (FNV-1a, folded to 24 bits)
 *
 * Each ply is stored as its index in that position's legal moves, sorted by
 * from, to and promotion — not in chess.js's generation order, which a library
 * update could change. The indices are packed as one number in mixed radix (the
 * radix of each ply is how many moves were legal), so a forced move costs
 * nothing and a typical ply about five bits: a 60-move game is ~80 bytes.
 *
 * The code tables below are frozen for v1. Presentation orders elsewhere
 * (`ARENA_ORDER`, `ARMY_SKIN_ORDER`) may change; these may not.
 */
const VERSION = "1";
const MODES: readonly ReplayMode[] = ["ai", "hotseat", "demo"];
const SIDES: readonly Faction[] = ["w", "b"];
const STRENGTHS: readonly Difficulty[] = ["easy", "medium", "hard"];
const ARMIES: readonly ArmySkinId[] = ["ivory", "sun", "empire"];
const ARENAS: readonly ArenaTheme[] = ["jungle", "dawn", "sands", "frost", "storm", "dusk"];
const REASONS: readonly EndReason[] = [
  "checkmate",
  "stalemate",
  "resignation",
  "timeout",
  "threefold",
  "insufficient",
  "fiftymove",
  "draw",
];
/** Reasons that need a winner; the rest are draws. */
const DECISIVE: ReadonlySet<EndReason> = new Set(["checkmate", "resignation", "timeout"]);
const EPOCH_MS = Date.UTC(2020, 0, 1);
const DAY_MS = 86_400_000;
const MAX_PLIES = 1200;
const HEADER_BYTES = 5;
const CHECK_BYTES = 3;

// ------------------------------------------------------------------- public

/** The token for `#r=`. Throws if the moves are not a legal game or the result does not fit them. */
export function encodeReplay(game: ReplayGame): string {
  const chess = new Chess();
  const radices: number[] = [];
  const indices: number[] = [];
  for (const move of game.moves) {
    const legal = legalMoves(chess);
    const index = legal.findIndex(
      (candidate) => candidate.from === move.from && candidate.to === move.to && candidate.promotion === (move.promotion ?? null),
    );
    if (index < 0) throw new Error(`replay: illegal move ${move.from}${move.to}${move.promotion ?? ""}`);
    radices.push(legal.length);
    indices.push(index);
    play(chess, legal[index]);
  }
  if (game.moves.length > MAX_PLIES) throw new Error("replay: too many moves");
  if (!resultFits(game.result, chess)) throw new Error("replay: the result does not match the final position");

  let value = 0n;
  for (let ply = indices.length - 1; ply >= 0; ply -= 1) {
    value = value * BigInt(radices[ply]) + BigInt(indices[ply]);
  }

  const day = dayNumber(game.date);
  const outcome = game.result === null ? 0 : game.result.winner === "w" ? 1 : game.result.winner === "b" ? 2 : 3;
  const reason = game.result === null ? 0 : REASONS.indexOf(game.result.reason);
  const bytes: number[] = [
    code(MODES, game.mode) | (code(SIDES, game.playerColor) << 2) | (code(STRENGTHS, game.difficulty) << 3) | (code(STRENGTHS, game.blackDifficulty) << 5),
    code(ARMIES, game.armies.w) | (code(ARMIES, game.armies.b) << 2) | (code(ARENAS, game.arena) << 4),
    outcome | (reason << 2),
    day >> 8,
    day & 0xff,
    ...varint(game.moves.length),
    ...bigToBytes(value),
  ];
  bytes.push(...checksum(bytes));
  return VERSION + toBase64Url(bytes);
}

/** The game in a token, or null for anything that is not a whole, untampered v1 link. Never throws. */
export function decodeReplay(token: string): ReplayGame | null {
  try {
    return decode(token);
  } catch {
    return null;
  }
}

/** The shareable link: `base` (the page URL without its hash) + `#r=<token>`. */
export function replayUrl(game: ReplayGame, base: string): string {
  const root = base.split("#")[0];
  return `${root}#${REPLAY_HASH_KEY}=${encodeReplay(game)}`;
}

/**
 * Reads `location.hash`. `present` says whether the hash asked for a replay at
 * all, so a broken link can be told apart from no link.
 */
export function readReplayHash(hash: string): { present: boolean; game: ReplayGame | null } {
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  const prefix = `${REPLAY_HASH_KEY}=`;
  if (!body.startsWith(prefix)) return { present: false, game: null };
  return { present: true, game: decodeReplay(body.slice(prefix.length)) };
}

/** Today as `YYYY-MM-DD` (UTC), the date a link records. */
export function todayStamp(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The position after the first `plies` moves (all of them by default). */
export function replayPosition(game: ReplayGame, plies = game.moves.length): Chess {
  const chess = new Chess();
  for (const move of game.moves.slice(0, plies)) play(chess, move);
  return chess;
}

// ------------------------------------------------------------------ decoding

function decode(token: string): ReplayGame | null {
  if (typeof token !== "string" || token[0] !== VERSION) return null;
  const bytes = fromBase64Url(token.slice(1));
  if (!bytes || bytes.length < HEADER_BYTES + 1 + CHECK_BYTES) return null;

  const body = bytes.slice(0, -CHECK_BYTES);
  const expected = checksum(body);
  for (let index = 0; index < CHECK_BYTES; index += 1) {
    if (bytes[body.length + index] !== expected[index]) return null;
  }

  const [h0, h1, h2, dayHigh, dayLow] = body;
  if (h0 & 0x80 || h1 & 0x80 || h2 & 0xe0) return null;
  const mode = MODES[h0 & 0b11];
  const playerColor = SIDES[(h0 >> 2) & 1];
  const difficulty = STRENGTHS[(h0 >> 3) & 0b11];
  const blackDifficulty = STRENGTHS[(h0 >> 5) & 0b11];
  const white = ARMIES[h1 & 0b11];
  const black = ARMIES[(h1 >> 2) & 0b11];
  const arena = ARENAS[(h1 >> 4) & 0b111];
  const outcome = h2 & 0b11;
  const reason = REASONS[(h2 >> 2) & 0b111];
  if (!mode || !difficulty || !blackDifficulty || !white || !black || !arena || !reason) return null;
  if (outcome === 0 && h2 !== 0) return null;

  const count = readVarint(body, HEADER_BYTES);
  if (!count || count.value > MAX_PLIES) return null;
  const moveBytes = body.slice(count.next);
  if (moveBytes.length > 0 && moveBytes[0] === 0) return null; // not the canonical (shortest) form
  let value = bytesToBig(moveBytes);

  const chess = new Chess();
  const moves: ReplayMove[] = [];
  for (let ply = 0; ply < count.value; ply += 1) {
    const legal = legalMoves(chess);
    if (legal.length === 0) return null;
    const radix = BigInt(legal.length);
    const move = legal[Number(value % radix)];
    value /= radix;
    play(chess, move);
    moves.push(move);
  }
  if (value !== 0n) return null;

  const result: GameResult | null =
    outcome === 0 ? null : { winner: outcome === 1 ? "w" : outcome === 2 ? "b" : null, reason };
  if (!resultFits(result, chess)) return null;

  return {
    mode,
    playerColor,
    difficulty,
    blackDifficulty,
    armies: { w: white, b: black },
    arena,
    result,
    date: new Date(EPOCH_MS + ((dayHigh << 8) | dayLow) * DAY_MS).toISOString().slice(0, 10),
    moves,
  };
}

// ------------------------------------------------------------------- helpers

/** chess.js's internal move record (0x88 squares), read by the fast path below. */
interface RawMove {
  from: number;
  to: number;
  promotion?: string;
}

type RawMoveSource = { _moves?: (options: { legal: boolean }) => RawMove[] };

/**
 * Every legal move in the position, sorted by from, to and promotion.
 *
 * `chess.moves({ verbose: true })` builds a SAN and two FENs for each candidate,
 * which costs ~25 ms a ply: a long game would take seconds to encode on a
 * headset. chess.js's own generator (`_moves`, the one `moves()` calls) gives
 * the same list for a fraction of that, so it is used when present; the public
 * call is the fallback if a release ever renames it. The sort makes both paths,
 * and every chess.js version, produce the same order.
 */
export function legalMoves(chess: Chess, fast = true): ReplayMove[] {
  const source = chess as unknown as RawMoveSource;
  const list: ReplayMove[] =
    fast && typeof source._moves === "function"
      ? source._moves.call(chess, { legal: true }).map((raw) => ({
          from: squareName(raw.from),
          to: squareName(raw.to),
          promotion: (raw.promotion as PieceKind | undefined) ?? null,
        }))
      : chess.moves({ verbose: true }).map((move) => ({
          from: move.from,
          to: move.to,
          promotion: (move.promotion as PieceKind | undefined) ?? null,
        }));
  return list.sort((a, b) => {
    const left = a.from + a.to + (a.promotion ?? "");
    const right = b.from + b.to + (b.promotion ?? "");
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/** 0x88 index → algebraic square. */
function squareName(index: number): SquareId {
  return "abcdefgh"[index & 7] + String(8 - (index >> 4));
}

function play(chess: Chess, move: ReplayMove): void {
  chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? undefined });
}

/** A result is only kept if the final position can bear it. */
function resultFits(result: GameResult | null, chess: Chess): boolean {
  if (result === null) return true;
  if (!REASONS.includes(result.reason)) return false;
  if (DECISIVE.has(result.reason) !== (result.winner !== null)) return false;
  const toMove = chess.turn() as Faction;
  if (result.reason === "checkmate") return chess.isCheckmate() && result.winner !== toMove;
  if (result.reason === "stalemate") return chess.isStalemate();
  // Mate on the board can only be reported as mate.
  return !chess.isCheckmate();
}

function code<T>(table: readonly T[], value: T): number {
  const index = table.indexOf(value);
  if (index < 0) throw new Error(`replay: unknown value ${String(value)}`);
  return index;
}

function dayNumber(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const ms = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
  const day = Math.round((ms - EPOCH_MS) / DAY_MS);
  if (!Number.isFinite(day) || day < 0 || day > 0xffff) throw new Error(`replay: date out of range ${date}`);
  return day;
}

function varint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  do {
    const low = rest & 0x7f;
    rest >>>= 7;
    out.push(rest > 0 ? low | 0x80 : low);
  } while (rest > 0);
  return out;
}

function readVarint(bytes: number[], start: number): { value: number; next: number } | null {
  let value = 0;
  for (let index = start, shift = 0; index < bytes.length && shift < 21; index += 1, shift += 7) {
    const byte = bytes[index];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      // Canonical only: no trailing zero group.
      if (index > start && byte === 0) return null;
      return { value, next: index + 1 };
    }
  }
  return null;
}

function bigToBytes(value: bigint): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest > 0n) {
    out.unshift(Number(rest & 0xffn));
    rest >>= 8n;
  }
  return out;
}

function bytesToBig(bytes: number[]): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function checksum(bytes: number[]): number[] {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const folded = ((hash >>> 24) ^ hash) & 0xffffff;
  return [folded >> 16, (folded >> 8) & 0xff, folded & 0xff];
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toBase64Url(bytes: number[]): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - index) * 8) / 6));
    for (let char = 0; char < chars; char += 1) out += ALPHABET[(chunk >> (18 - char * 6)) & 0x3f];
  }
  return out;
}

/** Strict: unknown characters, an impossible length or stray padding bits all fail. */
function fromBase64Url(text: string): number[] | null {
  if (text.length % 4 === 1) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  return buffer === 0 ? bytes : null;
}
