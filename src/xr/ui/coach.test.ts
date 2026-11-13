import { describe, expect, it } from "vitest";

import { Coach, TWO_HANDS_HINT_S, type CoachInput } from "./coach";

const base: CoachInput = { mr: "placing", placement: "searching", playerMoved: false, onboarded: false, now: 0 };

describe("Coach", () => {
  it("walks a first-time player from the table to their first move to the two-hand tip", () => {
    const coach = new Coach();
    expect(coach.step(base)).toBe("find-table");
    expect(coach.step({ ...base, placement: "aiming" })).toBe("place");
    expect(coach.step({ ...base, mr: "playing", placement: "placed", now: 1 })).toBe("first-move");
    expect(coach.step({ ...base, mr: "playing", placement: "placed", playerMoved: true, now: 10 })).toBe("two-hands");
    expect(coach.step({ ...base, mr: "playing", placement: "placed", playerMoved: true, now: 10 + TWO_HANDS_HINT_S + 0.1 })).toBe("none");
    expect(coach.finished).toBe(true);
  });

  it("skips the lessons for a player who has done them, but still helps find the table", () => {
    const coach = new Coach();
    expect(coach.step({ ...base, onboarded: true })).toBe("find-table");
    expect(coach.step({ ...base, onboarded: true, mr: "playing", placement: "fallback" })).toBe("none");
  });

  it("can be skipped, and finishes when skipped", () => {
    const coach = new Coach();
    coach.step({ ...base, mr: "playing", placement: "placed" });
    coach.skip();
    expect(coach.step({ ...base, mr: "playing", placement: "placed" })).toBe("none");
    expect(coach.finished).toBe(true);
  });

  it("can be replayed from the menu", () => {
    const coach = new Coach();
    coach.skip();
    coach.replay();
    expect(coach.step({ ...base, mr: "playing", placement: "placed", onboarded: true })).toBe("first-move");
  });

  it("says nothing outside mixed reality", () => {
    expect(new Coach().step({ ...base, mr: "off" })).toBe("none");
  });
});
