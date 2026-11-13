import type { StartOptions } from "./gameController";

/**
 * A match in progress, enough to stand it back up after the headset session
 * ends under it (battery, the Meta button, a crash): the moves, who plays what,
 * and what was left on the clocks.
 */
export interface SavedGame {
  version: 1;
  options: StartOptions;
  /** The moves so far; replayed to rebuild the position. */
  pgn: string;
  /** The position the moves must arrive at — a cross-check on the replay. */
  fen: string;
  clock: { whiteMs: number; blackMs: number };
  savedAt: number;
}

export const SAVE_KEY = "mr-chess:game";

/** The slice of `Storage` used here (fakeable, and `localStorage` can throw). */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isSavedGame(value: unknown): value is SavedGame {
  if (typeof value !== "object" || value === null) return false;
  const save = value as Partial<SavedGame>;
  return (
    save.version === 1 &&
    typeof save.pgn === "string" &&
    typeof save.fen === "string" &&
    typeof save.savedAt === "number" &&
    typeof save.options === "object" &&
    save.options !== null &&
    typeof save.clock?.whiteMs === "number" &&
    typeof save.clock?.blackMs === "number"
  );
}

export function saveGame(storage: SaveStorage, save: SavedGame): void {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Private browsing or a full quota: the match simply is not resumable.
  }
}

export function loadSavedGame(storage: SaveStorage): SavedGame | null {
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSavedGame(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearSavedGame(storage: SaveStorage): void {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // nothing to clear, or nothing we may touch
  }
}
