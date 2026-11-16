import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Home, Pause, RotateCw, Share2, Swords } from "lucide-react";

import { DEMO_REMATCH_DELAY_MS } from "../core/gameController";
import type { PlayerStats } from "../core/stats";
import type { Difficulty, EndReason, Faction, GameResult } from "../core/types";
import { Crest } from "./Heraldry";
import { RecordStrip } from "./RecordStrip";

/**
 * Extra framing for an AI vs AI duel. The viewer is an audience,
 * not a combatant: the dialog names the two engines, counts the loop down where
 * one is queued, and offers to hold the board so the final position can be read.
 */
export interface ShowcaseOutcome {
  /** 1-based duel counter within this AI vs AI session. */
  round: number;
  white: Difficulty;
  black: Difficulty;
  /** The loop is armed — another duel starts on its own. */
  autoRematch: boolean;
  /** Live ms left on the queued rematch, or null when nothing is queued. */
  getRematchRemaining: () => number | null;
  /** Disarm the loop so the board stays on the final position. */
  onHold: () => void;
}

interface GameOverModalProps {
  result: GameResult;
  pgn: string;
  playerColor: Faction;
  versusComputer: boolean;
  moveCount: number;
  /** The player's record including this game (games against the computer only). */
  stats?: PlayerStats;
  showcase?: ShowcaseOutcome | null;
  onRematch: () => void;
  onMenu: () => void;
  /** Opens the battle card and the replay link (absent when there is nothing to share). */
  onShare?: () => void;
}

const REASON_COPY: Record<EndReason, string> = {
  checkmate: "Checkmate",
  stalemate: "Stalemate",
  resignation: "By resignation",
  timeout: "On time",
  threefold: "Threefold repetition",
  insufficient: "Insufficient material",
  fiftymove: "Fifty-move rule",
  draw: "Drawn position",
};

const ENGINE_NAME: Record<Difficulty, string> = {
  easy: "Squire",
  medium: "Knight",
  hard: "Warlord",
};

const SIDE_NAME: Record<Faction, string> = { w: "Ivory", b: "Obsidian" };

export function GameOverModal({
  result,
  pgn,
  playerColor,
  versusComputer,
  moveCount,
  showcase,
  stats,
  onRematch,
  onMenu,
  onShare,
}: GameOverModalProps) {
  const [copied, setCopied] = useState(false);
  const headlineId = useId();

  const { winner } = result;
  // Against the computer the card speaks to the player; otherwise it names the side.
  const personal = versusComputer && !showcase;
  const headline =
    winner === null ? "Draw" : personal ? (winner === playerColor ? "Victory" : "Defeat") : `${SIDE_NAME[winner]} wins`;
  const tone = winner === null ? "draw" : personal ? (winner === playerColor ? "win" : "loss") : winner;
  const reason = showcase
    ? `${REASON_COPY[result.reason]} · ${moveCount} ${moveCount === 1 ? "move" : "moves"}`
    : REASON_COPY[result.reason];

  const copyPgn = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(pgn);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.warn("[ui] clipboard unavailable", error);
    }
  };

  // A showcase is watched, so the final position is the picture: the backdrop
  // stays thin and unblurred there instead of hiding the hall behind the card.
  return (
    <div
      className="mc-modal-pad mc-dialog-scrim pointer-events-auto absolute inset-0 z-30 flex items-center justify-center"
      data-showcase={showcase ? "true" : undefined}
    >
      <div className="mc-dialog mc-rise" role="dialog" aria-modal="true" aria-labelledby={headlineId}>
        {showcase ? (
          <p className="mc-dialog-eyebrow">
            {ENGINE_NAME[showcase.white]} vs {ENGINE_NAME[showcase.black]} · Duel {showcase.round}
          </p>
        ) : null}

        <div className="mc-dialog-crests" aria-hidden="true">
          {result.winner ? (
            <Crest faction={result.winner} size={44} active />
          ) : (
            <>
              <Crest faction="w" size={36} />
              <Crest faction="b" size={36} />
            </>
          )}
        </div>

        <h2 id={headlineId} className="mc-wordmark mc-dialog-headline" data-tone={tone}>
          {headline}
        </h2>
        <p className="mc-dialog-reason">{reason}</p>

        {stats && !showcase ? (
          <div className="mc-dialog-record">
            <RecordStrip stats={stats} />
          </div>
        ) : null}

        {showcase?.autoRematch ? (
          <NextDuelCountdown getRemaining={showcase.getRematchRemaining} onHold={showcase.onHold} />
        ) : null}

        <div className="mc-dialog-actions">
          <button type="button" className="mc-btn mc-btn-primary mc-btn-lg" onClick={onRematch}>
            {showcase ? <RotateCw size={18} aria-hidden="true" /> : <Swords size={18} aria-hidden="true" />} Rematch
          </button>
          <button type="button" className="mc-btn mc-btn-lg" onClick={onMenu} aria-label="Back to the menu">
            <Home size={18} aria-hidden="true" /> Menu
          </button>
          {onShare ? (
            <button type="button" className="mc-btn mc-btn-md" onClick={onShare}>
              <Share2 size={18} aria-hidden="true" /> Share
            </button>
          ) : null}
          <button
            type="button"
            className={`mc-btn mc-btn-ghost mc-btn-md${onShare ? "" : " mc-dialog-copy"}`}
            onClick={() => void copyPgn()}
          >
            {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
            {copied ? "Copied" : "Copy PGN"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The showcase loop, made visible. It reads the deadline off the controller on
 * its own 100 ms tick — the countdown must not push a snapshot through the whole
 * interface once every tenth of a second — and offers the one control the loop
 * was missing: a way to stop it without hunting for the transport rail.
 */
function NextDuelCountdown({ getRemaining, onHold }: { getRemaining: () => number | null; onHold: () => void }) {
  const [remaining, setRemaining] = useState<number | null>(() => getRemaining());
  const read = useRef(getRemaining);
  read.current = getRemaining;

  useEffect(() => {
    const timer = setInterval(() => setRemaining(read.current()), 100);
    return () => clearInterval(timer);
  }, []);

  if (remaining === null) return null;
  const seconds = Math.max(1, Math.ceil(remaining / 1000));
  const ratio = Math.min(1, Math.max(0, remaining / DEMO_REMATCH_DELAY_MS));

  return (
    <div className="mc-countdown">
      <div className="mc-countdown-row">
        <p>Next duel in {seconds}s</p>
        <button type="button" className="mc-btn mc-btn-md" onClick={onHold} aria-label="Hold: stay on this position">
          <Pause size={16} aria-hidden="true" /> Hold
        </button>
      </div>
      <div className="mc-countdown-track" aria-hidden="true">
        <div className="mc-countdown-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
