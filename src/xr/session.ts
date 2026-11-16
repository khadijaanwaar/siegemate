/// <reference types="webxr" />

/**
 * The mixed reality session: passthrough (`immersive-ar`) on the floor-level
 * reference space, with hands and hit-test asked for but never required, so a
 * headset that lacks one still gets a working table. Nothing else is asked
 * for: every optional feature can add a permission prompt.
 *
 * Foveation and the framebuffer scale are set before the session starts (three
 * refuses a scale change once presenting), and the refresh rate goes to 72 Hz:
 * Quest Browser's default, and the rate the frame budget is planned against.
 */

export const TABLE_SESSION_INIT: XRSessionInit = {
  requiredFeatures: ["local-floor"],
  optionalFeatures: ["hand-tracking", "hit-test"],
};

export const TARGET_FRAME_RATE = 72;

/** The slice of `navigator.xr` this module uses (fakeable in tests). */
export interface XrSystemLike {
  isSessionSupported(mode: XRSessionMode): Promise<boolean>;
  requestSession(mode: XRSessionMode, init?: XRSessionInit): Promise<XRSession>;
}

/** The slice of `WebGLRenderer` this module uses (fakeable in tests). */
export interface XrRendererLike {
  xr: {
    setReferenceSpaceType(type: XRReferenceSpaceType): void;
    setFoveation(value: number): void;
    setFramebufferScaleFactor(value: number): void;
    setSession(session: XRSession): Promise<void>;
  };
}

export interface TableSession {
  readonly session: XRSession;
  readonly hasHitTest: boolean;
  readonly hasHands: boolean;
  /** `visible`, `visible-blurred` (system menu over us) or `hidden` (headset off). */
  onVisibility(callback: (state: XRVisibilityState) => void): () => void;
  /** `requestedByApp` is true only when {@link TableSession.end} ended it. */
  onEnd(callback: (requestedByApp: boolean) => void): () => void;
  end(): Promise<void>;
}

function defaultXr(): XrSystemLike | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator.xr as XrSystemLike | undefined);
}

export async function isTableXrSupported(xr: XrSystemLike | undefined = defaultXr()): Promise<boolean> {
  if (!xr) return false;
  try {
    return await xr.isSessionSupported("immersive-ar");
  } catch {
    return false;
  }
}

/**
 * The lowest offered rate at or above `target`; failing that the highest one
 * offered; `null` when the headset lists none (leave its default alone).
 */
export function pickFrameRate(supported: ArrayLike<number> | undefined, target = TARGET_FRAME_RATE): number | null {
  if (!supported || supported.length === 0) return null;
  const rates = Array.from(supported).sort((a, b) => a - b);
  return rates.find((rate) => rate >= target) ?? rates[rates.length - 1];
}

function granted(session: XRSession, feature: string): boolean {
  const enabled = (session as XRSession & { enabledFeatures?: readonly string[] }).enabledFeatures;
  if (enabled) return enabled.includes(feature);
  // Browsers that do not list enabled features: probe for the API instead.
  if (feature === "hit-test") return typeof session.requestHitTestSource === "function";
  return false;
}

export async function startTableSession(
  renderer: XrRendererLike,
  xr: XrSystemLike | undefined = defaultXr(),
): Promise<TableSession> {
  if (!xr) throw new Error("WebXR is not available in this browser");

  const session = await xr.requestSession("immersive-ar", TABLE_SESSION_INIT);
  renderer.xr.setReferenceSpaceType("local-floor");
  renderer.xr.setFramebufferScaleFactor(1);
  renderer.xr.setFoveation(1);
  await renderer.xr.setSession(session);

  const rate = pickFrameRate(session.supportedFrameRates);
  if (rate !== null && typeof session.updateTargetFrameRate === "function") {
    // A refused rate is not worth failing the session over.
    await session.updateTargetFrameRate(rate).catch(() => undefined);
  }

  let endingByApp = false;
  return {
    session,
    hasHitTest: granted(session, "hit-test"),
    hasHands: granted(session, "hand-tracking"),
    onVisibility(callback) {
      const listener = (): void => callback(session.visibilityState);
      session.addEventListener("visibilitychange", listener);
      return () => session.removeEventListener("visibilitychange", listener);
    },
    onEnd(callback) {
      const listener = (): void => callback(endingByApp);
      session.addEventListener("end", listener);
      return () => session.removeEventListener("end", listener);
    },
    async end() {
      endingByApp = true;
      await session.end();
    },
  };
}
