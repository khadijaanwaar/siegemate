import { replayUrl, type ReplayGame } from "./replay";

/**
 * The battle on offer to share, between the 2D shell (which knows the armies
 * and the battleground) and the headset's result card (which only knows the
 * game). Also holds a share asked for in the headset: the 2D share sheet
 * opens for it once the player is back on the page.
 */
let current: ReplayGame | null = null;
let queued = false;
const listeners = new Set<() => void>();

export function setShareable(game: ReplayGame | null): void {
  if (game === current) return;
  current = game;
  if (!game) queued = false;
  notify();
}

export function getShareable(): ReplayGame | null {
  return current;
}

/** The page a link opens: this one, without its hash (the live site in production). */
export function shareBase(): string {
  return typeof window === "undefined" ? "https://siegemate.pages.dev/" : `${window.location.origin}${window.location.pathname}`;
}

/** The link for the battle on offer, or null when there is none (or it cannot be encoded). */
export function shareableUrl(game: ReplayGame | null = current): string | null {
  if (!game) return null;
  try {
    return replayUrl(game, shareBase());
  } catch (error) {
    console.warn("[share] this game cannot be put in a link", error);
    return null;
  }
}

/** The headset asked to share: show the sheet when the 2D page is back. */
export function queueShare(): void {
  if (!current) return;
  queued = true;
  notify();
}

export function isShareQueued(): boolean {
  return queued;
}

/** Clears and returns the queued request. */
export function takeQueuedShare(): boolean {
  const was = queued;
  queued = false;
  return was;
}

export function subscribeShare(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}
