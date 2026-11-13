import { describe, expect, it } from "vitest";

import { IdleScheduler } from "./idleScheduler";

describe("IdleScheduler", () => {
  it("alternates idle figures across frames with two buckets", () => {
    const scheduler = new IdleScheduler(2);
    const a = {};
    const b = {};
    const ran: string[] = [];
    for (let frame = 0; frame < 4; frame += 1) {
      scheduler.beginFrame();
      if (scheduler.step(a, 0.01, false) !== null) ran.push(`a${frame}`);
      if (scheduler.step(b, 0.01, false) !== null) ran.push(`b${frame}`);
    }
    expect(ran).toEqual(["a0", "b1", "a2", "b3"]);
  });

  it("hands back the time a skipped figure missed", () => {
    const scheduler = new IdleScheduler(3);
    const figure = {};
    const deltas: (number | null)[] = [];
    for (let frame = 0; frame < 6; frame += 1) {
      scheduler.beginFrame();
      deltas.push(scheduler.step(figure, 0.01, false));
    }
    const ran = deltas.filter((delta): delta is number => delta !== null);
    expect(ran).toHaveLength(2);
    // Every frame's time reaches the figure exactly once.
    expect(ran.reduce((sum, delta) => sum + delta, 0)).toBeCloseTo(0.01 + 0.03, 10);
  });

  it("always runs a busy figure and flushes what it had banked", () => {
    const scheduler = new IdleScheduler(3);
    const figure = {};
    scheduler.beginFrame();
    expect(scheduler.step(figure, 0.01, false)).toBeCloseTo(0.01, 10); // its bucket
    scheduler.beginFrame();
    expect(scheduler.step(figure, 0.01, false)).toBeNull(); // banks 0.01
    scheduler.beginFrame();
    expect(scheduler.step(figure, 0.01, true)).toBeCloseTo(0.02, 10); // banked + this frame
    scheduler.beginFrame();
    expect(scheduler.step(figure, 0.02, true)).toBeCloseTo(0.02, 10); // nothing banked
  });

  it("runs everything every frame with one bucket", () => {
    const scheduler = new IdleScheduler(1);
    const figure = {};
    for (let frame = 0; frame < 3; frame += 1) {
      scheduler.beginFrame();
      expect(scheduler.step(figure, 0.016, false)).toBeCloseTo(0.016, 10);
    }
  });
});
