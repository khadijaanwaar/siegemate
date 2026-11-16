/// <reference types="webxr" />
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameController } from "../core/gameController";
import type { SceneEngine } from "../scene/sceneEngine";
import type { MixedRealityHooks } from "./mixedReality";
import type { TableSession } from "./session";

// The panels and the room draw into 2D canvases; neither exists under node, and
// neither is what these tests are about.
vi.mock("./ui/tableUi", async () => {
  const three = await import("three");
  return {
    TableUi: class {
      readonly group = new three.Group();
      lessonMove = null;
      update(): void {}
      showPerf(): void {}
      poke(): boolean {
        return false;
      }
      rayTarget(): null {
        return null;
      }
      hoverRay(): void {}
      pressTarget(): void {}
    },
  };
});
vi.mock("./roomStyler", async () => {
  const three = await import("three");
  return {
    RoomStyler: class {
      readonly group = new three.Group();
      current: string | null = null;
      setTheme(theme: string): void {
        this.current = theme;
      }
      update(): void {}
    },
  };
});
const sessions = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("./session", () => ({ startTableSession: sessions.start }));

const { MixedReality } = await import("./mixedReality");

type FrameHandler = ((time: number, frame: XRFrame) => void) | null;

/** A passthrough session the test drives by hand: visibility, ending, and the reference space. */
function fakeTable() {
  let visibility: ((state: XRVisibilityState) => void) | null = null;
  let ended: ((byApp: boolean) => void) | null = null;
  const session = { inputSources: [] as XRInputSource[], visibilityState: "visible" as XRVisibilityState };
  const table: TableSession = {
    session: session as unknown as XRSession,
    hasHitTest: false,
    hasHands: true,
    hasAnchors: false,
    hasPlanes: false,
    onVisibility(callback) {
      visibility = callback;
      return () => {
        visibility = null;
      };
    },
    onEnd(callback) {
      ended = callback;
      return () => {
        ended = null;
      };
    },
    async end() {
      ended?.(true);
    },
  };
  return {
    table,
    session,
    setVisibility(state: XRVisibilityState) {
      session.visibilityState = state;
      visibility?.(state);
    },
    /** The system ended it (Quest menu, "Quit"). */
    drop() {
      ended?.(false);
    },
  };
}

function fakeEngine() {
  const space = new EventTarget() as unknown as XRReferenceSpace;
  let handler: FrameHandler = null;
  const engine = {
    xrScene: new THREE.Scene(),
    xrRenderer: { xr: { getReferenceSpace: () => space }, info: { render: { calls: 0 } } },
    enterTable: vi.fn(),
    exitTable: vi.fn(),
    setXrFrameHandler: vi.fn((next: FrameHandler) => {
      handler = next;
    }),
    previewMove: vi.fn(),
    getArena: () => "jungle",
    pendingPromotion: null,
    figureNear: () => null,
    pickWithRay: () => ({ square: null }),
  };
  return {
    engine: engine as unknown as SceneEngine,
    space,
    /** One headset frame with the eyes at `head` looking along `yaw` (0 = -Z). */
    frame(seconds: number, head = new THREE.Vector3(0, 1.2, 0), yaw = 0) {
      const orientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const frame = {
        getViewerPose: () => ({
          transform: {
            position: { x: head.x, y: head.y, z: head.z },
            orientation: { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w },
          },
        }),
        getHitTestResults: () => [],
        getPose: () => undefined,
      };
      handler?.(seconds * 1000, frame as unknown as XRFrame);
    },
  };
}

function fakeController(snapshot: Partial<ReturnType<GameController["getSnapshot"]>> = {}) {
  const listeners = new Map<string, (() => void)[]>();
  const state = { status: "playing", mode: "ai", playerColor: "w", difficulty: "easy", turn: "w", ...snapshot };
  return {
    controller: {
      getSnapshot: () => state,
      on: (event: string, listener: () => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return () => undefined;
      },
    } as unknown as GameController,
    state,
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
  };
}

async function entered(hooks: MixedRealityHooks = {}, snapshot = {}) {
  const table = fakeTable();
  sessions.start.mockResolvedValue(table.table);
  const engine = fakeEngine();
  const game = fakeController(snapshot);
  const mixed = new MixedReality(engine.engine, game.controller, hooks);
  await mixed.enter();
  return { mixed, table, engine, game };
}

beforeEach(() => {
  sessions.start.mockReset();
});

describe("MixedReality lifecycle", () => {
  it("hands focus back when the system ends the session while the menu was up, so the 2D game is not left paused", async () => {
    const focus: boolean[] = [];
    const exits: boolean[] = [];
    const { table } = await entered({ onFocus: (focused) => focus.push(focused), onExit: (byApp) => exits.push(byApp) });
    table.setVisibility("visible-blurred");
    table.drop();
    expect(focus).toEqual([false, true]);
    expect(exits).toEqual([false]);
  });

  it("does not report focus again when the session ends while in focus", async () => {
    const focus: boolean[] = [];
    const { mixed } = await entered({ onFocus: (focused) => focus.push(focused) });
    await mixed.exit();
    expect(focus).toEqual([]);
  });
});
