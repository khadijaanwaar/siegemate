import { describe, expect, it } from "vitest";

import { PokeTracker, POKE_PRESS_M, POKE_RELEASE_M } from "./poke";

describe("PokeTracker", () => {
  it("presses once the fingertip is 7 mm past the surface, over a button", () => {
    const poke = new PokeTracker();
    expect(poke.update(0.03, "play")).toBeNull(); // hovering 3 cm in front
    expect(poke.hovered).toBe("play");
    expect(poke.update(-0.005, "play")).toBeNull(); // touching, not yet pressed in
    expect(poke.update(-POKE_PRESS_M - 0.001, "play")).toBe("play");
  });

  it("does not repeat while the finger stays in, and re-arms after it backs out", () => {
    const poke = new PokeTracker();
    poke.update(0.02, "undo");
    expect(poke.update(-0.01, "undo")).toBe("undo");
    expect(poke.update(-0.012, "undo")).toBeNull();
    expect(poke.update(POKE_RELEASE_M - 0.001, "undo")).toBeNull(); // not far enough out yet
    expect(poke.update(POKE_RELEASE_M + 0.001, "undo")).toBeNull(); // re-armed
    expect(poke.update(-0.01, "undo")).toBe("undo");
  });

  it("refuses a finger that enters from behind the panel", () => {
    const poke = new PokeTracker();
    expect(poke.update(-0.02, "menu")).toBeNull();
    expect(poke.update(-0.03, "menu")).toBeNull();
  });

  it("does nothing off the buttons, and forgets a lost finger", () => {
    const poke = new PokeTracker();
    poke.update(0.02, null);
    expect(poke.update(-0.01, null)).toBeNull();
    poke.update(0.02, "menu");
    poke.update(null, null); // hand lost
    expect(poke.hovered).toBeNull();
    expect(poke.update(-0.01, "menu")).toBeNull(); // re-entering from behind does not count
  });
});
