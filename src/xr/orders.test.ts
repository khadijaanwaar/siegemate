import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { GRAB_RADIUS_M, HandOrders, type OrderTarget } from "./orders";

function fakeEngine(overrides: Partial<OrderTarget> = {}): OrderTarget & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    figureNear: vi.fn((point: THREE.Vector3, radius: number) => {
      calls.push(`near:${radius}`);
      return point.x < 0.01 ? "e2" : null;
    }),
    beginOrder: vi.fn((square: string) => {
      calls.push(`begin:${square}`);
      return true;
    }),
    squareAtWorld: vi.fn((point: THREE.Vector3) => (point.z < -0.1 ? "e4" : point.z > 0.5 ? null : "e3")),
    releaseOrder: vi.fn((square: string | null) => {
      calls.push(`release:${square}`);
    }),
    cancelOrder: vi.fn(() => {
      calls.push("cancel");
    }),
    pickWithRay: vi.fn(() => ({ square: "d4" })),
    canOrder: vi.fn((square: string) => square === "e2"),
    isLegalTarget: vi.fn(() => false),
    tapSquare: vi.fn((square: string | null) => {
      calls.push(`tap:${square}`);
    }),
    ...overrides,
  };
}

const near = new THREE.Vector3(0, 0.8, 0);
const overE4 = new THREE.Vector3(0, 0.82, -0.2);
const offBoard = new THREE.Vector3(0, 0.8, 0.8);
const far = new THREE.Vector3(0.3, 1, -0.1);
const ray = new THREE.Ray(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, -0.5, -1).normalize());
const FRAME = 1 / 72;

/** The ray's square, frame by frame: `[square, seconds]` runs, as `pickWithRay` will see them. */
function sweep(...runs: [string | null, number][]): { pick: OrderTarget["pickWithRay"]; frames: number } {
  const squares: (string | null)[] = [];
  for (const [square, seconds] of runs) for (let i = 0; i < Math.round(seconds / FRAME); i += 1) squares.push(square);
  let index = 0;
  return { pick: vi.fn(() => ({ square: squares[Math.min(index++, squares.length - 1)] })), frames: squares.length };
}

/** Presses on the first frame, holds through the rest, lets go after the last. */
function pressAlong(orders: HandOrders, frames: number, point = far): number {
  let now = 10;
  orders.update("start", point, ray, now);
  for (let frame = 1; frame < frames; frame += 1) {
    now += FRAME;
    orders.update("hold", point, ray, now);
  }
  now += FRAME;
  orders.update("end", point, ray, now);
  return now;
}

describe("HandOrders", () => {
  it("orders the figure under the pinch to the square the hand lets go over", () => {
    const engine = fakeEngine();
    const orders = new HandOrders(engine);
    orders.update("start", near, ray, 0);
    expect(orders.mode).toBe("ordering");
    expect(engine.calls).toContain(`near:${GRAB_RADIUS_M}`);
    orders.update("hold", overE4, ray, 0.1);
    expect(orders.aimSquare).toBe("e4");
    orders.update("end", overE4, ray, 0.2);
    expect(engine.calls).toEqual([`near:${GRAB_RADIUS_M}`, "begin:e2", "release:e4"]);
    expect(orders.mode).toBe("idle");
  });

  it("stands down when the hand is lost mid-order, playing nothing", () => {
    const engine = fakeEngine();
    const orders = new HandOrders(engine);
    orders.update("start", near, ray, 0);
    orders.update("hold", overE4, ray, 0.1);
    orders.update("lost", overE4, null, 0.2);
    expect(engine.calls).toContain("cancel");
    expect(engine.calls.some((call) => call.startsWith("release"))).toBe(false);
    expect(orders.mode).toBe("idle");
  });

  it("lets go off the board as a release over nothing", () => {
    const engine = fakeEngine();
    const orders = new HandOrders(engine);
    orders.update("start", near, ray, 0);
    orders.update("hold", offBoard, ray, 0.1);
    orders.update("end", offBoard, ray, 0.2);
    expect(engine.calls).toContain("release:null");
  });

  it("releases on the square aimed at while pinched, not where the opening fingers land", () => {
    const engine = fakeEngine();
    const orders = new HandOrders(engine);
    orders.update("start", near, ray, 0);
    orders.update("hold", overE4, ray, 0.1);
    orders.update("end", offBoard, ray, 0.2); // the fingertips spread as the hand opens
    expect(engine.calls).toContain("release:e4");
  });

  it("keeps the figure selected when let go without moving", () => {
    const engine = fakeEngine();
    const orders = new HandOrders(engine);
    orders.update("start", near, ray, 0);
    orders.update("end", near, ray, 0.1);
    expect(engine.calls).toContain("release:e2");
  });

  it("aims with the ray when the pinch is not on a figure, and taps where it lets go", () => {
    const engine = fakeEngine();
    const orders = new HandOrders(engine);
    orders.update("start", far, ray, 0);
    expect(orders.mode).toBe("aiming");
    expect(orders.aimSquare).toBe("d4");
    orders.update("end", far, ray, 0.1);
    expect(engine.calls).toContain("tap:d4");
  });

  it("does nothing when a ray pinch ends pointing off the board", () => {
    const engine = fakeEngine({ pickWithRay: vi.fn(() => ({ square: null })) });
    const orders = new HandOrders(engine);
    orders.update("start", far, ray, 0);
    orders.update("end", far, ray, 0.1);
    expect(engine.calls.some((call) => call.startsWith("tap"))).toBe(false);
  });

  it("falls back to the ray when the engine refuses the figure (not this side's turn)", () => {
    const engine = fakeEngine({ beginOrder: vi.fn(() => false) });
    const orders = new HandOrders(engine);
    orders.update("start", near, ray, 0);
    expect(orders.mode).toBe("aiming");
  });

  describe("stray pinches", () => {
    it("a pinch with the ray off the board aims at nothing, even when the ray then crosses the board", () => {
      const { pick, frames } = sweep([null, 0.05], ["d4", 0.3]);
      const engine = fakeEngine({ pickWithRay: pick });
      const orders = new HandOrders(engine);
      pressAlong(orders, frames);
      expect(engine.calls.some((call) => call.startsWith("tap"))).toBe(false);
      expect(orders.mode).toBe("idle");
    });

    it("a ray swept across the board and let go on another, unlit square plays nothing", () => {
      const { pick, frames } = sweep(["d4", 0.1], ["d5", 0.1], ["e5", 0.3]);
      const engine = fakeEngine({ pickWithRay: pick });
      pressAlong(new HandOrders(engine), frames);
      expect(engine.calls.some((call) => call.startsWith("tap"))).toBe(false);
    });

    it("let go over a lit square it rested on for 150 ms or more, it taps that square", () => {
      const { pick, frames } = sweep(["a3", 0.1], ["e4", 0.3]);
      const engine = fakeEngine({ pickWithRay: pick, isLegalTarget: vi.fn((square: string) => square === "e4") });
      pressAlong(new HandOrders(engine), frames);
      expect(engine.calls).toContain("tap:e4");
    });

    it("a lit square only passed over on the way is not tapped", () => {
      const { pick, frames } = sweep(["a3", 0.1], ["e4", 0.1], ["h8", 0.2]);
      const engine = fakeEngine({ pickWithRay: pick, isLegalTarget: vi.fn((square: string) => square === "e4") });
      pressAlong(new HandOrders(engine), frames);
      expect(engine.calls.some((call) => call.startsWith("tap"))).toBe(false);
    });

    it("judges the release by where the ray was 100 ms before, not where opening the hand flicked it", () => {
      const { pick, frames } = sweep(["d4", 0.4], ["d5", 0.04]);
      const engine = fakeEngine({ pickWithRay: pick });
      pressAlong(new HandOrders(engine), frames);
      expect(engine.calls).toContain("tap:d4");
    });
  });

  describe("by ray (a controller, or a hand pointing from afar)", () => {
    const pointing = (...squares: (string | null)[]) => {
      const pick = vi.fn(() => ({ square: squares[squares.length - 1] ?? null }));
      for (const square of squares) pick.mockReturnValueOnce({ square });
      return pick;
    };

    it("pressed on one of your figures takes the order; let go over another square plays it", () => {
      const engine = fakeEngine({ pickWithRay: pointing("e2", "e4") });
      const orders = new HandOrders(engine);
      orders.update("start", far, ray, 0);
      expect(orders.mode).toBe("ordering");
      expect(orders.byRay).toBe(true);
      orders.update("hold", far, ray, 0.1);
      expect(orders.aimSquare).toBe("e4");
      orders.update("end", far, ray, 0.3);
      expect(engine.calls).toEqual(["near:0.03", "begin:e2", "release:e4"]);
    });

    it("let go, it plays the square the ray was on 100 ms before, not where opening the hand flicked it", () => {
      const { pick, frames } = sweep(["e2", 0.1], ["e4", 0.3], ["e5", 0.04]);
      const engine = fakeEngine({ pickWithRay: pick });
      pressAlong(new HandOrders(engine), frames);
      expect(engine.calls).toContain("release:e4");
    });

    it("let go over its own square, the figure stays selected for a second click", () => {
      const engine = fakeEngine({ pickWithRay: pointing("e2", "e2") });
      const orders = new HandOrders(engine);
      orders.update("start", far, ray, 0);
      orders.update("end", far, ray, 0.1);
      expect(engine.calls).toContain("release:e2");
      expect(engine.calls.some((call) => call.startsWith("tap"))).toBe(false);
    });

    it("never begins an order on a figure that is not yours (a capture plays on release, not on press)", () => {
      const engine = fakeEngine({ pickWithRay: pointing("d7", "d7") });
      const orders = new HandOrders(engine);
      orders.update("start", far, ray, 0);
      expect(orders.mode).toBe("aiming");
      expect(engine.calls.some((call) => call.startsWith("begin"))).toBe(false);
      orders.update("end", far, ray, 0.1);
      expect(engine.calls).toContain("tap:d7");
    });

    it("dragged off the board, stands down", () => {
      const engine = fakeEngine({ pickWithRay: pointing("e2", null) });
      const orders = new HandOrders(engine);
      orders.update("start", far, ray, 0);
      orders.update("hold", far, ray, 0.1);
      orders.update("end", far, ray, 0.3);
      expect(engine.calls).toContain("release:null");
    });

    it("keeps its aim through a moment without a ray", () => {
      const engine = fakeEngine({ pickWithRay: pointing("e2", "e4") });
      const orders = new HandOrders(engine);
      orders.update("start", far, ray, 0);
      orders.update("hold", far, ray, 0.1);
      orders.update("hold", far, null, 0.2);
      orders.update("end", far, null, 0.3);
      expect(engine.calls).toContain("release:e4");
    });
  });

  it("ignores a pinch with no ray and no figure in reach", () => {
    const engine = fakeEngine();
    const orders = new HandOrders(engine);
    orders.update("start", new THREE.Vector3(0.3, 1, -0.1), null, 0);
    expect(orders.mode).toBe("idle");
  });
});
