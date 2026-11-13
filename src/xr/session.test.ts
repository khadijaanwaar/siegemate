import { describe, expect, it, vi } from "vitest";

import {
  isTableXrSupported,
  pickFrameRate,
  startTableSession,
  TABLE_SESSION_INIT,
  type XrRendererLike,
} from "./session";

class FakeSession extends EventTarget {
  visibilityState: XRVisibilityState = "visible";
  enabledFeatures: string[] | undefined;
  supportedFrameRates: Float32Array | undefined;
  updateTargetFrameRate = vi.fn(async (rate: number) => {
    void rate;
  });
  end = vi.fn(async () => {
    this.dispatchEvent(new Event("end"));
  });
  constructor(features: string[] | undefined, rates: number[] | undefined) {
    super();
    this.enabledFeatures = features;
    this.supportedFrameRates = rates ? new Float32Array(rates) : undefined;
  }
  setVisibility(state: XRVisibilityState): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

function fakeXr(session: FakeSession, supported = true) {
  return {
    isSessionSupported: vi.fn(async (mode: XRSessionMode) => supported && mode === "immersive-ar"),
    requestSession: vi.fn(async (mode: XRSessionMode, init: XRSessionInit) => {
      void mode;
      void init;
      return session as unknown as XRSession;
    }),
  };
}

function fakeRenderer(): XrRendererLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    xr: {
      setReferenceSpaceType: (type) => calls.push(`ref:${type}`),
      setFoveation: (value) => calls.push(`foveation:${value}`),
      setFramebufferScaleFactor: (value) => calls.push(`scale:${value}`),
      setSession: async () => {
        calls.push("session");
      },
    },
  };
}

describe("pickFrameRate", () => {
  it("takes 72 Hz when the headset offers it", () => {
    expect(pickFrameRate([60, 72, 90, 120])).toBe(72);
  });

  it("leaves the rate alone when the headset lists none", () => {
    expect(pickFrameRate(undefined)).toBeNull();
    expect(pickFrameRate([])).toBeNull();
  });

  it("takes the nearest rate at or above the target otherwise", () => {
    expect(pickFrameRate([60, 90, 120])).toBe(90);
    expect(pickFrameRate([60])).toBe(60);
  });
});

describe("startTableSession", () => {
  it("asks for passthrough with hands, hit-test, anchors and planes as optional", async () => {
    const session = new FakeSession(["local-floor", "hand-tracking", "hit-test"], [72, 90]);
    const xr = fakeXr(session);
    await startTableSession(fakeRenderer(), xr);
    expect(xr.requestSession).toHaveBeenCalledWith("immersive-ar", TABLE_SESSION_INIT);
    expect(TABLE_SESSION_INIT.requiredFeatures).toEqual(["local-floor"]);
    expect(TABLE_SESSION_INIT.optionalFeatures).toEqual(["hand-tracking", "hit-test", "anchors", "plane-detection"]);
  });

  it("sets foveation and framebuffer scale before the session, then 72 Hz", async () => {
    const session = new FakeSession(["local-floor"], [60, 72, 90]);
    const renderer = fakeRenderer();
    await startTableSession(renderer, fakeXr(session));
    expect(renderer.calls).toEqual(["ref:local-floor", "scale:1", "foveation:1", "session"]);
    expect(session.updateTargetFrameRate).toHaveBeenCalledWith(72);
  });

  it("reports which optional features the headset granted", async () => {
    const session = new FakeSession(["local-floor", "hand-tracking"], undefined);
    const table = await startTableSession(fakeRenderer(), fakeXr(session));
    expect(table.hasHands).toBe(true);
    expect(table.hasHitTest).toBe(false);
    expect(session.updateTargetFrameRate).not.toHaveBeenCalled();
  });

  it("passes visibility changes through", async () => {
    const session = new FakeSession(["local-floor"], undefined);
    const table = await startTableSession(fakeRenderer(), fakeXr(session));
    const seen: XRVisibilityState[] = [];
    table.onVisibility((state) => seen.push(state));
    session.setVisibility("visible-blurred");
    session.setVisibility("visible");
    expect(seen).toEqual(["visible-blurred", "visible"]);
  });

  it("tells an app-requested exit from one the system forced", async () => {
    const first = new FakeSession(["local-floor"], undefined);
    const exited = await startTableSession(fakeRenderer(), fakeXr(first));
    const byApp: boolean[] = [];
    exited.onEnd((requestedByApp) => byApp.push(requestedByApp));
    await exited.end();

    const second = new FakeSession(["local-floor"], undefined);
    const dropped = await startTableSession(fakeRenderer(), fakeXr(second));
    dropped.onEnd((requestedByApp) => byApp.push(requestedByApp));
    second.dispatchEvent(new Event("end"));

    expect(byApp).toEqual([true, false]);
  });
});

describe("isTableXrSupported", () => {
  it("is false without navigator.xr", async () => {
    expect(await isTableXrSupported(undefined)).toBe(false);
  });

  it("asks for immersive-ar", async () => {
    const xr = fakeXr(new FakeSession([], undefined));
    expect(await isTableXrSupported(xr)).toBe(true);
    expect(xr.isSessionSupported).toHaveBeenCalledWith("immersive-ar");
  });

  it("is false when the check throws", async () => {
    const xr = {
      isSessionSupported: vi.fn(async () => {
        throw new Error("blocked");
      }),
      requestSession: vi.fn(),
    };
    expect(await isTableXrSupported(xr)).toBe(false);
  });
});
