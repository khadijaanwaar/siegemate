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
    tapSquare: vi.fn((square: string | null) => {
      calls.push(`tap:${square}`);
    }),
    ...overrides,
  };
}

const near = new THREE.Vector3(0, 0.8, 0);
const overE4 = new THREE.Vector3(0, 0.82, -0.2);
const offBoard = new THREE.Vector3(0, 0.8, 0.8);
const ray = new THREE.Ray(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, -0.5, -1).normalize());

describe("HandOrders", () => {
  it("orders the figure under the pinch to the square the hand lets go over", () => {
    const engine = fakeEngine();
    const orders = new HandOrders(engine);
    orders.update("start", near, ray);
    expect(orders.mode).toBe("ordering");
    expect(engine.calls).toContain(`near:${GRAB_RADIUS_M}`);
    orders.update("hold", overE4, ray);
    expect(orders.aimSquare).toBe("e4");
    orders.update("end", overE4, ray);
    expect(engine.calls).toEqual([`near:${GRAB_RADIUS_M}`, "begin:e2", "release:e4"]);
    expect(orders.mode).toBe("idle");
  });

  it("stands down when the hand is lost mid-order, playing nothing", () => {
    const engine = fakeEngine();
    const orders = new HandOrders(engine);
    orders.update("start", near, ray);
    orders.update("hold", overE4, ray);
    orders.update("lost", overE4, null);
    expect(engine.calls).toContain("cancel");
    expect(engine.calls.some((call) => call.startsWith("release"))).toBe(false);
    expect(orders.mode).toBe("idle");
  });

  it("lets go off the board as a release over nothing", () => {
    const engine = fakeEngine();
    const orders = new HandOrders(engine);
    orders.update("start", near, ray);
    orders.update("hold", offBoard, ray);
    orders.update("end", offBoard, ray);
    expect(engine.calls).toContain("release:null");
  });

  it("releases on the square aimed at while pinched, not where the opening fingers land", () => {
    const engine = fakeEngine();
    const orders = new HandOrders(engine);
    orders.update("start", near, ray);
    orders.update("hold", overE4, ray);
    orders.update("end", offBoard, ray); // the fingertips spread as the hand opens
    expect(engine.calls).toContain("release:e4");
  });

  it("keeps the figure selected when let go without moving", () => {
    const engine = fakeEngine();
    const orders = new HandOrders(engine);
    orders.update("start", near, ray);
    orders.update("end", near, ray);
    expect(engine.calls).toContain("release:e2");
  });

  it("aims with the ray when the pinch is not on a figure, and taps where it lets go", () => {
    const engine = fakeEngine();
    const orders = new HandOrders(engine);
    const far = new THREE.Vector3(0.3, 1, -0.1);
    orders.update("start", far, ray);
    expect(orders.mode).toBe("aiming");
    expect(orders.aimSquare).toBe("d4");
    orders.update("end", far, ray);
    expect(engine.calls).toContain("tap:d4");
  });

  it("does nothing when a ray pinch ends pointing off the board", () => {
    const engine = fakeEngine({ pickWithRay: vi.fn(() => ({ square: null })) });
    const orders = new HandOrders(engine);
    const far = new THREE.Vector3(0.3, 1, -0.1);
    orders.update("start", far, ray);
    orders.update("end", far, ray);
    expect(engine.calls.some((call) => call.startsWith("tap"))).toBe(false);
  });

  it("falls back to the ray when the engine refuses the figure (not this side's turn)", () => {
    const engine = fakeEngine({ beginOrder: vi.fn(() => false) });
    const orders = new HandOrders(engine);
    orders.update("start", near, ray);
    expect(orders.mode).toBe("aiming");
  });

  describe("by ray (a controller, or a hand pointing from afar)", () => {
    const far = new THREE.Vector3(0.3, 1, -0.1);
    const pointing = (...squares: (string | null)[]) => {
      const pick = vi.fn(() => ({ square: squares[squares.length - 1] ?? null }));
      for (const square of squares) pick.mockReturnValueOnce({ square });
      return pick;
    };

    it("pressed on one of your figures takes the order; let go over another square plays it", () => {
      const engine = fakeEngine({ pickWithRay: pointing("e2", "e4") });
      const orders = new HandOrders(engine);
      orders.update("start", far, ray);
      expect(orders.mode).toBe("ordering");
      expect(orders.byRay).toBe(true);
      orders.update("hold", far, ray);
      expect(orders.aimSquare).toBe("e4");
      orders.update("end", far, ray);
      expect(engine.calls).toEqual(["near:0.03", "begin:e2", "release:e4"]);
    });

    it("let go over its own square, the figure stays selected for a second click", () => {
      const engine = fakeEngine({ pickWithRay: pointing("e2", "e2") });
      const orders = new HandOrders(engine);
      orders.update("start", far, ray);
      orders.update("end", far, ray);
      expect(engine.calls).toContain("release:e2");
      expect(engine.calls.some((call) => call.startsWith("tap"))).toBe(false);
    });

    it("never begins an order on a figure that is not yours (a capture plays on release, not on press)", () => {
      const engine = fakeEngine({ pickWithRay: pointing("d7", "d7") });
      const orders = new HandOrders(engine);
      orders.update("start", far, ray);
      expect(orders.mode).toBe("aiming");
      expect(engine.calls.some((call) => call.startsWith("begin"))).toBe(false);
      orders.update("end", far, ray);
      expect(engine.calls).toContain("tap:d7");
    });

    it("dragged off the board, stands down", () => {
      const engine = fakeEngine({ pickWithRay: pointing("e2", null) });
      const orders = new HandOrders(engine);
      orders.update("start", far, ray);
      orders.update("hold", far, ray);
      orders.update("end", far, ray);
      expect(engine.calls).toContain("release:null");
    });

    it("keeps its aim through a moment without a ray", () => {
      const engine = fakeEngine({ pickWithRay: pointing("e2", "e4") });
      const orders = new HandOrders(engine);
      orders.update("start", far, ray);
      orders.update("hold", far, ray);
      orders.update("hold", far, null);
      orders.update("end", far, null);
      expect(engine.calls).toContain("release:e4");
    });
  });

  it("ignores a pinch with no ray and no figure in reach", () => {
    const engine = fakeEngine();
    const orders = new HandOrders(engine);
    orders.update("start", new THREE.Vector3(0.3, 1, -0.1), null);
    expect(orders.mode).toBe("idle");
  });
});
