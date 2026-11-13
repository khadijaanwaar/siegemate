/**
 * Spreads idle figures across frames. Thirty-two skeletons breathing in their
 * stance is the biggest steady CPU cost of a quiet board, and a breath read at
 * 30 Hz looks the same as one read at 60. A figure that is doing something
 * (selected, marching, striking, dying) runs every frame.
 *
 * Time is never lost: a skipped figure banks its frame's delta and gets all of
 * it on the next frame it runs, so clips stay in step with the clock.
 */
export class IdleScheduler {
  private frame = -1;
  private next = 0;
  private readonly slots = new WeakMap<object, { slot: number; banked: number }>();

  constructor(private buckets: number) {
    this.setBuckets(buckets);
  }

  /** 1 runs everything every frame; 2 runs each idle figure every other frame. */
  setBuckets(buckets: number): void {
    this.buckets = Math.max(1, Math.floor(buckets));
  }

  beginFrame(): void {
    this.frame += 1;
  }

  /** The delta to update `figure` with this frame, or `null` to skip it. */
  step(figure: object, delta: number, busy: boolean): number | null {
    let entry = this.slots.get(figure);
    if (!entry) {
      entry = { slot: this.next, banked: 0 };
      this.next += 1;
      this.slots.set(figure, entry);
    }
    const due = busy || this.buckets === 1 || this.frame % this.buckets === entry.slot % this.buckets;
    if (!due) {
      entry.banked += delta;
      return null;
    }
    const total = entry.banked + delta;
    entry.banked = 0;
    return total;
  }
}
