/** A poke registers once the fingertip is this far past the panel's face (Meta: ~7 mm of travel)... */
export const POKE_PRESS_M = 0.007;
/** ...and re-arms only after the finger has backed out this far in front of it. */
export const POKE_RELEASE_M = 0.012;
/** Closer than this in front of a button counts as hovering it. */
export const POKE_HOVER_M = 0.04;

/**
 * Poking a flat panel with the index fingertip. Fed the fingertip's signed
 * distance to the panel's face each frame (positive in front) and the button
 * under it, it reports a press once per push. A finger that arrives from
 * behind the panel (reaching through it) never presses, which is what keeps
 * a hand moving toward the board from tapping a panel in the way.
 */
export class PokeTracker {
  private armed = false;
  private down = false;
  private over: string | null = null;

  get hovered(): string | null {
    return this.over;
  }

  /** `distance` null means the fingertip is not tracked this frame. */
  update(distance: number | null, button: string | null): string | null {
    if (distance === null) {
      this.armed = false;
      this.down = false;
      this.over = null;
      return null;
    }
    this.over = distance <= POKE_HOVER_M ? button : null;

    if (distance > POKE_RELEASE_M) {
      this.armed = true;
      this.down = false;
      return null;
    }
    if (!this.armed || this.down || distance > -POKE_PRESS_M) return null;
    this.down = true;
    return button;
  }
}
