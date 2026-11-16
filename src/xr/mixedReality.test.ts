/// <reference types="webxr" />
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameController } from "../core/gameController";
import type { SceneEngine } from "../scene/sceneEngine";
import type { MixedRealityHooks } from "./mixedReality";
import type { TableSession } from "./session";

/** What the stand-in panels report: whether a fingertip is in a panel's poke volume, and what was asked of them. */
const panels = vi.hoisted(() => ({ fingertipOnPanel: false, rayOnPanel: null as null | { distance: number }, calls: [] as string[] }));

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
      poke(hand: string, fingertip: unknown): boolean {
        return fingertip !== null && panels.fingertipOnPanel;
      }
      rayTarget(): unknown {
        return panels.rayOnPanel ? { panel: {}, button: null, distance: panels.rayOnPanel.distance } : null;
      }
      hoverRay(): void {}
      pressTarget(): void {}
      toggleMenu(): void {
        panels.calls.push("toggleMenu");
      }
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

/** A tracked hand or a Touch controller the test moves by hand. */
interface FakeInput {
  source: XRInputSource;
  joints: Map<string, THREE.Vector3>;
  ray: { origin: THREE.Vector3; direction: THREE.Vector3 } | null;
  /** Thumb and index tips together (pinched) or apart, around `at`. */
  pinch(pinched: boolean, at: THREE.Vector3): void;
  /** Where its pointer ray starts and points. */
  aim(origin: THREE.Vector3, direction: THREE.Vector3): void;
}

function fakeInput(handedness: XRHandedness, kind: "hand" | "controller"): FakeInput {
  const joints = new Map<string, THREE.Vector3>();
  const source: Record<string, unknown> = {
    handedness,
    targetRayMode: "tracked-pointer",
    targetRaySpace: handedness + ":ray",
  };
  if (kind === "hand") source.hand = { get: (name: string) => handedness + ":" + name };
  else source.gamepad = { buttons: [0, 1, 2, 3, 4, 5].map(() => ({ pressed: false })), axes: [0, 0, 0, 0] };
  const input: FakeInput = {
    source: source as unknown as XRInputSource,
    joints,
    ray: null,
    pinch(pinched, at) {
      const half = pinched ? 0.004 : 0.02;
      joints.set(handedness + ":thumb-tip", at.clone().add(new THREE.Vector3(0, -half, 0)));
      joints.set(handedness + ":index-finger-tip", at.clone().add(new THREE.Vector3(0, half, 0)));
      input.ray ??= { origin: at.clone(), direction: new THREE.Vector3(0, 0, -1) };
    },
    aim(origin, direction) {
      input.ray = { origin: origin.clone(), direction: direction.clone().normalize() };
    },
  };
  return input;
}

function fakeEngine() {
  const space = new EventTarget() as unknown as XRReferenceSpace;
  let handler: FrameHandler = null;
  let inputs: FakeInput[] = [];
  const pose = (position: THREE.Vector3, orientation = new THREE.Quaternion()) => ({
    transform: {
      position: { x: position.x, y: position.y, z: position.z },
      orientation: { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w },
    },
  });
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
    orderedSquare: null as string | null,
    figureNear: vi.fn((): string | null => null),
    beginOrder: vi.fn(() => true),
    squareAtWorld: vi.fn((): string | null => null),
    releaseOrder: vi.fn(),
    cancelOrder: vi.fn(),
    pickWithRay: vi.fn((): { square: string | null } => ({ square: null })),
    canOrder: vi.fn(() => false),
    tapSquare: vi.fn(),
    isLegalTarget: vi.fn(() => false),
    squareCenterWorld: (square: string, out: THREE.Vector3) => out.set(0, 0.8, -0.45),
  };
  return {
    engine: engine as unknown as SceneEngine,
    fake: engine,
    space,
    /** The hands and controllers the session lists from now on. */
    setInputs(next: FakeInput[], table: ReturnType<typeof fakeTable>) {
      inputs = next;
      table.session.inputSources = next.map((input) => input.source);
    },
    /** One headset frame with the eyes at `head` looking along `yaw` (0 = -Z). */
    frame(seconds: number, head = new THREE.Vector3(0, 1.2, 0), yaw = 0) {
      const orientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const frame = {
        getViewerPose: () => pose(head, orientation),
        getHitTestResults: () => [],
        getJointPose: (joint: unknown) => {
          for (const input of inputs) {
            const at = input.joints.get(joint as string);
            if (at) return pose(at);
          }
          return undefined;
        },
        getPose: (raySpace: unknown) => {
          const input = inputs.find((candidate) => (candidate.source.targetRaySpace as unknown) === raySpace);
          if (!input?.ray) return undefined;
          const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), input.ray.direction);
          return pose(input.ray.origin, turn);
        },
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

/** Headset frames from `from` to `to` seconds at 72 Hz. */
function run(engine: ReturnType<typeof fakeEngine>, from: number, to: number): void {
  for (let now = from; now <= to + 1e-9; now += 1 / 72) engine.frame(now);
}

/** Entered, and the board settled at seat height (no table in the fake session). */
async function playing(hooks: MixedRealityHooks = {}, snapshot = {}) {
  const setup = await entered(hooks, snapshot);
  run(setup.engine, 0, 8.2);
  expect(setup.mixed.current).toBe("playing");
  return setup;
}

beforeEach(() => {
  sessions.start.mockReset();
  panels.fingertipOnPanel = false;
  panels.rayOnPanel = null;
  panels.calls = [];
});

describe("MixedReality placement", () => {
  it("falls back to seat height after 8 s of visible searching, not counting time under the system menu", async () => {
    const { mixed, table, engine } = await entered();
    table.setVisibility("visible-blurred");
    run(engine, 0, 10);
    expect(mixed.current).toBe("placing");
    table.setVisibility("visible");
    run(engine, 10, 17.5);
    expect(mixed.current).toBe("placing");
    run(engine, 17.5, 18.2);
    expect(mixed.current).toBe("playing");
    expect(mixed.placementState).toBe("fallback");
  });
});

describe("MixedReality sides", () => {
  it("turns the board so a player of black has their own army nearest, and back for white", async () => {
    const { mixed, game } = await playing({}, { playerColor: "b" });
    expect(mixed.debugSizes().flipped).toBe(true);
    game.state.playerColor = "w";
    game.emit("reset");
    expect(mixed.debugSizes().flipped).toBe(false);
  });

  it("keeps white near for two players at one board", async () => {
    const { mixed } = await playing({}, { mode: "hotseat", playerColor: "b" });
    expect(mixed.debugSizes().flipped).toBe(false);
  });
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

/** Presses (or lets go of) a button on a fake controller's gamepad. */
function button(input: FakeInput, index: number, pressed: boolean): void {
  (input.source.gamepad as unknown as { buttons: { pressed: boolean }[] }).buttons[index].pressed = pressed;
}

describe("MixedReality controllers", () => {
  it("A or X opens the menu, once per press", async () => {
    const { engine, table } = await playing();
    const right = fakeInput("right", "controller");
    right.aim(new THREE.Vector3(0.2, 1.1, -0.2), new THREE.Vector3(0, 0, -1));
    engine.setInputs([right], table);
    engine.frame(9);
    button(right, 4, true);
    engine.frame(9.02);
    engine.frame(9.04);
    expect(panels.calls).toEqual(["toggleMenu"]);
    button(right, 4, false);
    engine.frame(9.06);
    button(right, 4, true);
    engine.frame(9.08);
    expect(panels.calls).toEqual(["toggleMenu", "toggleMenu"]);
  });
});

/** The lines the markers draw: the pointer rays (one per side), and the command line while a hand carries an order. */
function drawnRays(mixed: InstanceType<typeof MixedReality>): number {
  const group = (mixed as unknown as { markers: { group: THREE.Group } }).markers.group;
  return group.children.filter((child) => (child as THREE.Line).isLine && child.visible).length;
}

describe("MixedReality two-hand grab", () => {
  // The fallback board stands at (0, 0.8, -0.45), about 28 cm each way from its centre.
  const leftEdge = new THREE.Vector3(-0.3, 0.85, -0.45);
  const rightEdge = new THREE.Vector3(0.3, 0.85, -0.45);

  async function twoHands() {
    const setup = await playing();
    const left = fakeInput("left", "hand");
    const right = fakeInput("right", "hand");
    setup.engine.setInputs([left, right], setup.table);
    return { ...setup, left, right };
  }

  /** Both hands pinched at `l` and `r`, then spread `spread` metres each way over a few frames. */
  function grabAndSpread(setup: Awaited<ReturnType<typeof twoHands>>, l: THREE.Vector3, r: THREE.Vector3, spread: number, gapS = 0): void {
    const { engine, left, right } = setup;
    left.pinch(false, l);
    right.pinch(false, r);
    engine.frame(9);
    left.pinch(true, l);
    engine.frame(9.02);
    let now = 9.02 + gapS;
    right.pinch(true, r);
    engine.frame(now);
    for (let step = 1; step <= 6; step += 1) {
      now += 0.02;
      const offset = new THREE.Vector3((spread * step) / 6, 0, 0);
      left.pinch(true, l.clone().sub(offset));
      right.pinch(true, r.clone().add(offset));
      engine.frame(now);
    }
  }

  it("two pinches closed together beside the board, pulled apart, grow it", async () => {
    const setup = await twoHands();
    const before = setup.mixed.boardSize;
    grabAndSpread(setup, leftEdge, rightEdge, 0.1);
    expect(setup.mixed.boardSize).toBeGreaterThan(before * 1.1);
  });

  it("a second pinch long after the first is not a grab", async () => {
    const setup = await twoHands();
    const before = setup.mixed.boardSize;
    grabAndSpread(setup, leftEdge, rightEdge, 0.06, 0.5);
    expect(setup.mixed.boardSize).toBe(before);
  });

  it("two pinches away from the board are not a grab", async () => {
    const setup = await twoHands();
    const before = setup.mixed.boardSize;
    grabAndSpread(setup, leftEdge.clone().setY(1.2), rightEdge.clone().setY(1.2), 0.06);
    expect(setup.mixed.boardSize).toBe(before);
  });

  it("the wobble of closing two pinches moves nothing", async () => {
    const setup = await twoHands();
    const before = { size: setup.mixed.boardSize, at: setup.mixed.debugSizes().rigAt };
    grabAndSpread(setup, leftEdge, rightEdge, 0.012);
    expect(setup.mixed.boardSize).toBe(before.size);
    expect(setup.mixed.debugSizes().rigAt).toEqual(before.at);
  });
});

describe("MixedReality hands", () => {
  const atPawn = new THREE.Vector3(0.02, 0.85, -0.4);

  it("draws a hand's ray only while it is on the board or a panel", async () => {
    const { mixed, engine, table } = await playing();
    const hand = fakeInput("right", "hand");
    engine.setInputs([hand], table);
    hand.pinch(false, new THREE.Vector3(0.1, 1.0, -0.2));
    hand.aim(new THREE.Vector3(0.1, 1.0, -0.2), new THREE.Vector3(1, 0, 0));
    engine.frame(9);
    expect(drawnRays(mixed)).toBe(0);
    hand.aim(new THREE.Vector3(0.1, 1.0, -0.2), new THREE.Vector3(0, -1, 0));
    engine.frame(9.02);
    expect(drawnRays(mixed)).toBe(1);
    hand.aim(new THREE.Vector3(0.1, 1.0, -0.2), new THREE.Vector3(1, 0, 0));
    panels.rayOnPanel = { distance: 0.3 };
    engine.frame(9.04);
    expect(drawnRays(mixed)).toBe(1);
  });

  it("keeps a controller's ray drawn when it points at nothing", async () => {
    const { mixed, engine, table } = await playing();
    const right = fakeInput("right", "controller");
    right.aim(new THREE.Vector3(0.2, 1.1, -0.2), new THREE.Vector3(1, 0, 0));
    engine.setInputs([right], table);
    engine.frame(9);
    expect(drawnRays(mixed)).toBe(1);
  });

  it("lets an ordering hand's release through even with its fingertip in a panel's poke volume", async () => {
    const { engine, table } = await playing();
    const hand = fakeInput("right", "hand");
    engine.setInputs([hand], table);
    engine.fake.figureNear.mockReturnValue("e2");
    hand.pinch(false, atPawn);
    engine.frame(9);
    hand.pinch(true, atPawn);
    engine.frame(9.02);
    expect(engine.fake.beginOrder).toHaveBeenCalledWith("e2");
    // Carrying the figure past the slab: the fingertip enters a panel's poke volume.
    panels.fingertipOnPanel = true;
    engine.frame(9.04);
    hand.pinch(false, atPawn);
    engine.frame(9.06);
    expect(engine.fake.releaseOrder).toHaveBeenCalled();
  });
});
