import type * as THREE from "three";

import type { SquareId } from "../core/types";
import type { PinchEvent } from "./hands";

/** A pinch this close to a figure's body (feet to crown) takes hold of it. */
export const GRAB_RADIUS_M = 0.03;

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
  tapSquare(square: SquareId | null): void;
}

export type HandMode = "idle" | "ordering" | "aiming";

/**
 * One hand's (or controller's) orders. Pinch a figure of yours and it is
 * selected (its destinations light); carry the pinch over a square and let go,
 * and the figure marches there. Out of reach, the ray does the same: press
 * with it on a figure of yours, drag the ray to a lit square, let go. Pressed
 * anywhere else, the ray taps the square it is let go over, so click, then
 * click again, plays too. Losing the hand mid-order never plays a move.
 */
export class HandOrders {
  private current: HandMode = "idle";
  private aim: SquareId | null = null;
  private ray = false;

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

  update(event: PinchEvent | null, point: THREE.Vector3, ray: THREE.Ray | null): void {
    switch (event) {
      case "start":
        this.start(point, ray);
        return;
      case "hold":
        if (this.current === "ordering" && !this.ray) this.aim = this.engine.squareAtWorld(point);
        else if (this.current !== "idle" && ray) this.aim = this.engine.pickWithRay(ray).square;
        return;
      case "end":
        // The square aimed at while the pinch was still closed: opening the hand
        // spreads the fingertips and throws their midpoint centimetres off.
        if (this.current === "ordering") this.engine.releaseOrder(this.aim);
        else if (this.current === "aiming" && this.aim !== null) this.engine.tapSquare(this.aim);
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

  private start(point: THREE.Vector3, ray: THREE.Ray | null): void {
    const square = this.engine.figureNear(point, GRAB_RADIUS_M);
    if (square && this.engine.beginOrder(square)) {
      this.current = "ordering";
      this.aim = square;
      return;
    }
    if (!ray) return;
    const pointed = this.engine.pickWithRay(ray).square;
    // Only a figure of yours is taken on the press: anything else (a lit
    // square, an enemy to capture) waits for the release, like a click.
    if (pointed && this.engine.canOrder(pointed) && this.engine.beginOrder(pointed)) {
      this.current = "ordering";
      this.ray = true;
      this.aim = pointed;
      return;
    }
    this.current = "aiming";
    this.aim = pointed;
  }

  private reset(): void {
    this.current = "idle";
    this.aim = null;
    this.ray = false;
  }
}
