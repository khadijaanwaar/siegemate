import { ChevronLeft, ChevronRight, Home, Pause, Play, Share2, SkipBack, SkipForward, Swords } from "lucide-react";

import type { ReplayGame } from "./replay";
import type { ReplayState } from "./replayDriver";
import { arenaName, battleHeadline, battleReason, sideName } from "./story";
import "./share.css";

interface ReplayBarProps {
  game: ReplayGame;
  state: ReplayState;
  onToggle: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onStart: () => void;
  onEnd: () => void;
  /** Absent when the position on the board is already over. */
  onContinue?: () => void;
  onShare: () => void;
  onOwnGame: () => void;
}

/**
 * The replay transport: who fought where, how far along the board is, and
 * the ways out — take over against the computer, or start a game of your own.
 */
export function ReplayBar({ game, state, onToggle, onStepBack, onStepForward, onStart, onEnd, onContinue, onShare, onOwnGame }: ReplayBarProps) {
  const move = Math.ceil(state.ply / 2);
  const total = Math.ceil(state.total / 2);
  const atEnd = state.ply >= state.total;
  const ratio = state.total ? state.ply / state.total : 1;

  return (
    <section className="mc-replay mc-slate mc-fade pointer-events-auto" aria-label="Replay" data-testid="replay-bar">
      <div className="mc-replay-head">
        <p className="mc-replay-title">
          Replay · {sideName(game, "w")} vs {sideName(game, "b")} · {arenaName(game.arena)}
        </p>
        <p className="mc-replay-ply" data-testid="replay-ply" data-ply={state.ply} data-total={state.total}>
          Move {move} of {total}
        </p>
      </div>
      {atEnd ? (
        <p className="mc-replay-result" data-testid="replay-result">
          {battleHeadline(game)} · {battleReason(game)}
        </p>
      ) : null}
      <div className="mc-replay-track" aria-hidden="true">
        <div className="mc-replay-fill" style={{ width: `${ratio * 100}%` }} />
      </div>

      <div className="mc-replay-row">
        <div className="mc-replay-controls">
          <button type="button" className="mc-btn mc-btn-ghost" onClick={onStart} disabled={state.ply === 0} aria-label="To the start">
            <SkipBack size={18} aria-hidden="true" />
          </button>
          <button type="button" className="mc-btn mc-btn-ghost" onClick={onStepBack} disabled={state.ply === 0 || state.busy} aria-label="Back one move">
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mc-btn mc-btn-primary"
            onClick={onToggle}
            aria-label={state.playing ? "Pause" : atEnd ? "Play again from the start" : "Play"}
            data-testid="replay-toggle"
          >
            {state.playing ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
          </button>
          <button type="button" className="mc-btn mc-btn-ghost" onClick={onStepForward} disabled={atEnd || state.busy || state.playing} aria-label="Forward one move">
            <ChevronRight size={20} aria-hidden="true" />
          </button>
          <button type="button" className="mc-btn mc-btn-ghost" onClick={onEnd} disabled={atEnd} aria-label="To the end" data-testid="replay-end">
            <SkipForward size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="mc-replay-actions">
          {onContinue ? (
            <button type="button" className="mc-btn mc-btn-md" onClick={onContinue} disabled={state.busy}>
              <Swords size={16} aria-hidden="true" /> Play from here
            </button>
          ) : null}
          <button type="button" className="mc-btn mc-btn-md" onClick={onShare}>
            <Share2 size={16} aria-hidden="true" /> Share
          </button>
          <button type="button" className="mc-btn mc-btn-md" onClick={onOwnGame} data-testid="replay-own-game">
            <Home size={16} aria-hidden="true" /> Play your own game
          </button>
        </div>
      </div>
    </section>
  );
}
