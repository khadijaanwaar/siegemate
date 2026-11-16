import type { GameController, StartOptions } from "../core/gameController";
import type { SavedGame } from "../core/persist";
import { replayPosition, type ReplayGame } from "./replay";

export interface ReplayState {
  /** Plies on the board. */
  ply: number;
  total: number;
  playing: boolean;
  /** A move is being animated. */
  busy: boolean;
}

/** Pause between moves while playing, after each move's own animation. */
const GAP_MS = 650;

/**
 * Plays a shared game back through the ordinary controller and scene, so the
 * moves march and fight exactly as they did: forward is a real (animated)
 * move on a two-player board nobody may touch; any jump (back, to the start,
 * to the end) restores the position instantly the way a resumed match does.
 */
export class ReplayDriver {
  private ply = 0;
  private playing = false;
  private busy = false;
  /** Bumped by every jump, so a step or a play loop already running knows it is stale. */
  private epoch = 0;
  private disposed = false;
  /** Whether the position after n plies is already decided (replaying it costs a little, so once each). */
  private readonly overAt = new Map<number, boolean>();

  constructor(
    private readonly controller: GameController,
    readonly game: ReplayGame,
    private readonly onChange: (state: ReplayState) => void,
    private readonly gapMs = GAP_MS,
  ) {}

  get state(): ReplayState {
    return { ply: this.ply, total: this.game.moves.length, playing: this.playing, busy: this.busy };
  }

  get atEnd(): boolean {
    return this.ply >= this.game.moves.length;
  }

  /** Puts the position after `ply` moves on the board, without animation. */
  seek(ply: number): boolean {
    const target = Math.max(0, Math.min(this.game.moves.length, Math.round(ply)));
    const chess = replayPosition(this.game, target);
    const save: SavedGame = {
      version: 1,
      options: this.options(),
      pgn: chess.pgn(),
      fen: chess.fen(),
      clock: { whiteMs: 0, blackMs: 0 },
      savedAt: Date.now(),
    };
    this.epoch += 1;
    this.playing = false;
    this.busy = false;
    if (!this.controller.resume(save)) return false;
    this.ply = target;
    this.emit();
    return true;
  }

  /** Plays the next move, animated. False at the end, mid-move or after a jump. */
  async stepForward(): Promise<boolean> {
    if (this.busy || this.atEnd || this.disposed) return false;
    const epoch = this.epoch;
    const move = this.game.moves[this.ply];
    this.busy = true;
    this.emit();
    const played = await this.controller.tryMove(move.from, move.to, move.promotion ?? undefined);
    if (epoch !== this.epoch || this.disposed) return false;
    this.busy = false;
    if (played) this.ply += 1;
    this.emit();
    return played;
  }

  stepBack(): boolean {
    if (this.ply === 0) return false;
    return this.seek(this.ply - 1);
  }

  /** Plays on from here to the end (from the start if it is already over). */
  async play(): Promise<void> {
    if (this.playing || this.disposed) return;
    if (this.atEnd) this.seek(0);
    const epoch = this.epoch;
    this.playing = true;
    this.emit();
    while (this.playing && epoch === this.epoch && !this.atEnd && !this.disposed) {
      if (!(await this.stepForward())) break;
      if (this.atEnd) break;
      await new Promise((resolve) => setTimeout(resolve, this.gapMs));
    }
    if (epoch === this.epoch) {
      this.playing = false;
      this.emit();
    }
  }

  /** Stops after the move in progress. */
  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else void this.play();
  }

  /** Whether the position here can be played on against the computer (not over yet). */
  canContinue(): boolean {
    let over = this.overAt.get(this.ply);
    if (over === undefined) {
      over = replayPosition(this.game, this.ply).isGameOver();
      this.overAt.set(this.ply, over);
    }
    return !over;
  }

  /**
   * The match from this position as a game against the computer, the player
   * taking the side to move. The replay is over once this is used.
   */
  continueOptions(): StartOptions {
    const turn = replayPosition(this.game, this.ply).turn() as "w" | "b";
    return { mode: "ai", difficulty: this.game.difficulty, playerColor: turn, clockMinutes: null };
  }

  dispose(): void {
    this.disposed = true;
    this.playing = false;
    this.epoch += 1;
  }

  private options(): StartOptions {
    return { mode: "hotseat", difficulty: this.game.difficulty, playerColor: this.game.playerColor, clockMinutes: null };
  }

  private emit(): void {
    if (!this.disposed) this.onChange(this.state);
  }
}
