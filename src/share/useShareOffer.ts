import { useCallback, useEffect, useRef, useState } from "react";
import type * as THREE from "three";

import { qrMatrix } from "./qr";
import type { ReplayGame } from "./replay";
import { getShareable, isShareQueued, setShareable, shareableUrl, subscribeShare, takeQueuedShare } from "./shareStore";

/**
 * The finished battle on offer to share, and the share sheet. `game` is put
 * where the headset's result card can find it; a share asked for in the
 * headset opens the sheet here once the session is over, so the player
 * finds the card and the buttons waiting when they take the headset off.
 */
export function useShareOffer(
  game: ReplayGame | null,
  xr: () => THREE.WebXRManager | null,
  ready: boolean,
): { sheet: ReplayGame | null; canShare: boolean; open: (game: ReplayGame) => void; close: () => void } {
  const [sheet, setSheet] = useState<ReplayGame | null>(null);
  const xrRef = useRef(xr);
  xrRef.current = xr;

  useEffect(() => {
    setShareable(game);
    if (!game) setSheet(null);
  }, [game]);

  const open = useCallback((shared: ReplayGame) => {
    if (shareableUrl(shared)) setSheet(shared);
  }, []);
  const close = useCallback(() => setSheet(null), []);

  useEffect(() => {
    if (!ready) return;
    const manager = xrRef.current();
    const showQueued = (): void => {
      if (manager?.isPresenting) return; // still in the headset: wait for the session to end
      const current = getShareable();
      if (takeQueuedShare() && current) open(current);
    };
    const off = subscribeShare(() => {
      if (isShareQueued()) showQueued();
    });
    manager?.addEventListener("sessionend", showQueued);
    return () => {
      off();
      manager?.removeEventListener("sessionend", showQueued);
    };
  }, [ready, open]);

  // Dev and test builds only: the link on offer and the QR it makes, for the e2e specs.
  useEffect(() => {
    if (!(import.meta.env.DEV || import.meta.env.MODE === "test")) return;
    (window as unknown as { __share: unknown }).__share = { link: () => shareableUrl(), qr: (text: string) => qrMatrix(text) };
  }, []);

  return { sheet, canShare: game !== null, open, close };
}
