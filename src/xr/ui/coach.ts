import type { PlacementState } from "../placement";

export type CoachStep = "find-table" | "place" | "first-move" | "two-hands" | "none";
/** What the player is holding up: their hands, or Touch controllers. */
export type Pointer = "hands" | "controllers";

const COPY: Record<Pointer, Record<Exclude<CoachStep, "none">, string>> = {
  hands: {
    "find-table": "Look at your table",
    place: "Pinch to place",
    "first-move": "Pinch a soldier, drop on a glow",
    "two-hands": "Pinch both board edges: move · resize",
  },
  controllers: {
    "find-table": "Look at your table",
    place: "Trigger to place",
    "first-move": "Trigger a soldier, then a glow",
    "two-hands": "Both grips at board: move · resize",
  },
};

/** The hint's words, in the language of whatever the player is holding. */
export function coachCopy(step: Exclude<CoachStep, "none">, pointer: Pointer): string {
  return COPY[pointer][step];
}

export interface CoachInput {
  mr: "off" | "starting" | "placing" | "playing";
  placement: PlacementState;
  /** The player has made a move this session. */
  playerMoved: boolean;
  /** Finished or skipped the lessons before (kept on the device). */
  onboarded: boolean;
  now: number;
}

/** How long the two-hand tip stays up after the first move. */
export const TWO_HANDS_HINT_S = 6;

/**
 * Which one hint the player sees. Teaching is by doing (Meta's onboarding
 * guidance): every step waits for the player to actually do it, one gesture at
 * a time, and the lesson steps never come back once finished or skipped. The
 * two placement prompts are not lessons, so they show every session.
 */
export class Coach {
  private skipped = false;
  private replaying = false;
  private twoHandsUntil: number | null = null;
  private done = false;

  /** True once the lessons were completed or skipped this session (persist it). */
  get finished(): boolean {
    return this.done;
  }

  skip(): void {
    this.skipped = true;
    this.done = true;
  }

  /** "How to play": run the lessons again. */
  replay(): void {
    this.skipped = false;
    this.done = false;
    this.replaying = true;
    this.twoHandsUntil = null;
  }

  step(input: CoachInput): CoachStep {
    if (input.mr === "off" || input.mr === "starting") return "none";
    if (input.mr === "placing") return input.placement === "aiming" ? "place" : "find-table";

    const lessons = (!input.onboarded || this.replaying) && !this.skipped;
    if (!lessons) return "none";
    if (!input.playerMoved && this.twoHandsUntil === null) return "first-move";
    if (this.twoHandsUntil === null) this.twoHandsUntil = input.now + TWO_HANDS_HINT_S;
    if (input.now < this.twoHandsUntil) return "two-hands";
    this.done = true;
    this.replaying = false;
    this.skipped = true;
    return "none";
  }
}
