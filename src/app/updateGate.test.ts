import { describe, expect, it, vi } from "vitest";

import { setMatchInProgress, whenIdle } from "./updateGate";

describe("update gate", () => {
  it("applies a waiting update at once at the menu", () => {
    setMatchInProgress(false);
    const apply = vi.fn();
    whenIdle(apply);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("holds an update during a match and applies it when the match ends", () => {
    setMatchInProgress(true);
    const apply = vi.fn();
    whenIdle(apply);
    expect(apply).not.toHaveBeenCalled();
    setMatchInProgress(true);
    expect(apply).not.toHaveBeenCalled();
    setMatchInProgress(false);
    expect(apply).toHaveBeenCalledTimes(1);
    setMatchInProgress(false);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
