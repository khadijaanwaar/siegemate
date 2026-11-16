import type * as THREE from "three";

import type { SquareId } from "../core/types";
import type { PinchEvent } from "./hands";

/** A pinch this close to a figure's body (feet to crown) takes hold of it. */
export const GRAB_RADIUS_M = 0.03;
/** Opening a hand (or letting go of a trigger) swings its ray: a release is judged by where it was this long before. */
export const RELEASE_LOOKBACK_S = 0.1;
/** A ray let go over a square other than the one it was pressed on taps it only if it is lit and the ray rested on it this long. */
export const DWELL_S = 0.15;
/** How much of the ray's path is kept for judging a release. */
const HISTORY_S = 1;

/** The part of the scene engine a hand gives orders through. */
export interface OrderTarget {
  figureNear(point: THREE.Vector3, radiusMeters: number): SquareId | null;
  beginOrder(square: SquareId): boolean;
  squareAtWorld(point: THREE.Vector3): SquareId | null;
  releaseOrder(square: SquareId | null): void;
  cancelOrder(): void;
  pickWithRay(ray: THREE.Ray): { square: SquareId | null };
  /** The square holds a figure the player commands (pressing it takes the order rather than playing a move). */
  canOrder(square: SquareId): boolean;
  /** The square is lit as a destination of the figure being ordered. */
  isLegalTarget(square: SquareId): boolean;
  tapSquare(square: SquareId | null): void;
}

export type HandMode = "idle" | "ordering" | "aiming";

/**
 * One hand's (or controller's) orders. Pinch a figure of yours and it is
 * selected (its destinations light); carry the pinch over a square and let go,
 * and the figure marches there. Out of reach, the ray does the same: press
 * with it on a figure of yours, drag the ray to a lit square, let go. Pressed
 * anywhere else on the board, the ray taps the square it is let go over, so
 * click, then click again, plays too. Losing the hand mid-order never plays a
 * move.
 *
 * Stray pinches play nothing: a pinch with the ray off the board aims at
 * nothing, a ray let go is judged by where it was {@link RELEASE_LOOKBACK_S}
 * before (opening the hand swings it), and a ray swept across the board taps
 * only the square it was pressed on, or a lit square it rested on for
 * {@link DWELL_S}.
 */
export class HandOrders {
  private current: HandMode = "idle";
  private aim: SquareId | null = null;
  private ray = false;
  /** The square the ray was pressed on (aiming). */
  private pressedOn: SquareId | null = null;
  /** The ray's square over time, for a ray press (aiming, or an order taken along the ray). */
  private path: { at: number; square: SquareId | null }[] = [];

  constructor(private readonly engine: OrderTarget) {}

  get mode(): HandMode {
    return this.current;
  }

  /** The square the hand is aiming at right now (for the marker), or null. */
  get aimSquare(): SquareId | null {
    return this.current === "idle" ? null : this.aim;
  }

  /** The order in hand was taken along the ray (it is aimed with the ray, not carried by hand). */
  get byRay(): boolean {
    return this.current === "ordering" && this.ray;
  }

  /** `now` in seconds, on the clock the frames run on. */
  update(event: PinchEvent | null, point: THREE.Vector3, ray: THREE.Ray | null, now: number): void {
    switch (event) {
      case "start":
        this.start(point, ray, now);
        return;
      case "hold":
        if (this.current === "ordering" && !this.ray) this.aim = this.engine.squareAtWorld(point);
        else if (this.current !== "idle" && ray) this.aim = this.engine.pickWithRay(ray).square;
        if (this.byRay || this.current === "aiming") this.record(now);
        return;
      case "end":
        // The square aimed at while the pinch was still closed: opening the hand
        // spreads the fingertips and throws their midpoint centimetres off.
        if (this.current === "ordering") this.engine.releaseOrder(this.ray ? this.aimBefore(now) : this.aim);
        else if (this.current === "aiming") {
          const square = this.aimBefore(now);
          if (square !== null && (square === this.pressedOn || (this.engine.isLegalTarget(square) && this.dwell(square, now) >= DWELL_S))) {
            this.engine.tapSquare(square);
          }
        }
        this.reset();
        return;
      case "lost":
        if (this.current === "ordering") this.engine.cancelOrder();
        this.reset();
        return;
      default:
        return;
    }
  }

  /** A second hand joined in to move the board: drop any aim without tapping. An order in hand stays. */
  cancelAim(): void {
    if (this.current === "aiming") this.reset();
  }

  private start(point: THREE.Vector3, ray: THREE.Ray | null, now: number): void {
    const square = this.engine.figureNear(point, GRAB_RADIUS_M);
    if (square && this.engine.beginOrder(square)) {
      this.current = "ordering";
      this.aim = square;
      return;
    }
    if (!ray) return;
    const pointed = this.engine.pickWithRay(ray).square;
    // A pinch with the ray off the board is not aimed at the board at all
    // (a hand resting, scratching, reaching for a cup): nothing to tap later.
    if (pointed === null) return;
    // Only a figure of yours is taken on the press: anything else (a lit
    // square, an enemy to capture) waits for the release, like a click.
    if (this.engine.canOrder(pointed) && this.engine.beginOrder(pointed)) {
      this.current = "ordering";
      this.ray = true;
    } else {
      this.current = "aiming";
      this.pressedOn = pointed;
    }
    this.aim = pointed;
    this.record(now);
  }

  private record(now: number): void {
    this.path.push({ at: now, square: this.aim });
    while (this.path.length > 1 && this.path[0].at < now - HISTORY_S) this.path.shift();
  }

  /** Where the ray was {@link RELEASE_LOOKBACK_S} before `now` (the press itself, if that is earlier). */
  private aimBefore(now: number): SquareId | null {
    const cutoff = now - RELEASE_LOOKBACK_S;
    let square = this.path[0]?.square ?? this.aim;
    for (const sample of this.path) {
      if (sample.at > cutoff) break;
      square = sample.square;
    }
    return square;
  }

  /** How long the ray rested on `square` in its last visit, up to `now`. */
  private dwell(square: SquareId, now: number): number {
    const cutoff = now - RELEASE_LOOKBACK_S;
    let last = -1;
    for (let index = 0; index < this.path.length && this.path[index].at <= cutoff; index += 1) {
      if (this.path[index].square === square) last = index;
    }
    if (last < 0) return 0;
    let first = last;
    while (first > 0 && this.path[first - 1].square === square) first -= 1;
    let end = last;
    while (end + 1 < this.path.length && this.path[end + 1].square === square) end += 1;
    const leftAt = end + 1 < this.path.length ? this.path[end + 1].at : now;
    return leftAt - this.path[first].at;
  }

  private reset(): void {
    this.current = "idle";
    this.aim = null;
    this.ray = false;
    this.pressedOn = null;
    this.path = [];
  }
}
