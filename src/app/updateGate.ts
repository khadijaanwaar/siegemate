/**
 * When a newer version of the game is waiting, apply it at once unless a match
 * is being played (applying reloads the page). The shell marks the match as
 * busy; when it goes idle, a waiting update is applied then.
 */
let busy = false;
let pending: (() => void) | null = null;

export function setMatchInProgress(value: boolean): void {
  busy = value;
  if (!busy && pending) {
    const apply = pending;
    pending = null;
    apply();
  }
}

/** Runs `apply` now, or as soon as no match is in progress. */
export function whenIdle(apply: () => void): void {
  if (busy) pending = apply;
  else apply();
}
