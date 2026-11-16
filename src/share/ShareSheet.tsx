import { useEffect, useId, useMemo, useState } from "react";
import { Check, Download, Link2, Share2, X } from "lucide-react";

import { battleCardFile } from "./battleCard";
import type { ReplayGame } from "./replay";
import { copyText, downloadFile, shareBattle, type ShareOutcome } from "./shareBattle";
import { shareBase, shareableUrl } from "./shareStore";
import { battleHeadline, shareText } from "./story";
import "./share.css";

const OUTCOME_COPY: Record<ShareOutcome, string> = {
  shared: "Shared",
  cancelled: "",
  "saved-and-copied": "Card saved · link copied",
  saved: "Card saved",
};

interface ShareSheetProps {
  game: ReplayGame;
  onClose: () => void;
}

/**
 * The battle card and the ways to send it. The card is drawn as soon as the
 * sheet opens, so the Share press goes straight to the platform's sheet while
 * the tap still counts as the player's gesture.
 */
export function ShareSheet({ game, onClose }: ShareSheetProps) {
  const titleId = useId();
  const url = useMemo(() => shareableUrl(game) ?? shareBase(), [game]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    battleCardFile(game)
      .then((made) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(made);
        setFile(made);
        setPreview(objectUrl);
      })
      .catch((error: unknown) => console.warn("[share] could not draw the battle card", error));
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [game]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const say = (message: string): void => {
    setStatus(message);
    if (message) setTimeout(() => setStatus((current) => (current === message ? "" : current)), 3500);
  };

  const share = async (): Promise<void> => {
    const outcome = await shareBattle({ url, title: "Siegemate", text: shareText(game), file });
    say(OUTCOME_COPY[outcome]);
  };

  const copy = async (): Promise<void> => {
    say((await copyText(url)) ? "Link copied" : "Copy the link from the box below");
  };

  const save = (): void => {
    if (!file) return;
    downloadFile(file);
    say("Card saved");
  };

  return (
    <div
      className="mc-modal-pad mc-dialog-scrim pointer-events-auto absolute inset-0 z-40 flex items-center justify-center"
      data-testid="share-sheet"
    >
      <div className="mc-dialog mc-rise mc-share" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button type="button" className="mc-btn mc-btn-ghost mc-share-close" onClick={onClose} aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        <h2 id={titleId} className="mc-share-title">
          Share this battle
        </h2>
        <p className="mc-share-sub">{battleHeadline(game)}</p>

        <div className="mc-share-card">
          {preview ? (
            <img src={preview} alt={`Battle card: ${battleHeadline(game)}`} data-testid="battle-card" />
          ) : (
            <div className="mc-share-card-wait" aria-hidden="true" />
          )}
        </div>

        <div className="mc-share-actions">
          <button
            type="button"
            className="mc-btn mc-btn-primary mc-btn-lg"
            onClick={() => void share()}
            disabled={!file && !canShare}
          >
            <Share2 size={18} aria-hidden="true" /> {canShare ? "Share" : "Save card & copy link"}
          </button>
          <button type="button" className="mc-btn mc-btn-lg" onClick={() => void copy()}>
            <Link2 size={18} aria-hidden="true" /> Copy link
          </button>
          <button type="button" className="mc-btn mc-btn-lg" onClick={save} disabled={!file}>
            <Download size={18} aria-hidden="true" /> Save card
          </button>
        </div>

        <input className="mc-share-link" value={url} readOnly aria-label="Replay link" onFocus={(event) => event.currentTarget.select()} />
        <p className="mc-share-status" role="status" aria-live="polite">
          {status ? (
            <>
              <Check size={16} aria-hidden="true" /> {status}
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
