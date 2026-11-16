/// <reference types="webxr" />
import * as THREE from "three";

import type { GameController } from "../core/gameController";
import { ARENA_LOOKS, type ArenaTheme } from "../scene/arena";
import type { SceneEngine } from "../scene/sceneEngine";
import type { SquareId } from "../core/types";
import { buttonPressed, PressTracker, PRIMARY, pulse, SQUEEZE, TRIGGER } from "./controllers";
import { palmFacesHead, palmNormal, PinchTracker, type PinchEvent } from "./hands";
import { Markers } from "./markers";
import { loadBoardSize, pastDeadZone, saveBoardSize, TWO_HAND_REACH_M, TWO_HAND_SYNC_S, twoHandTransform, type TwoHandStart } from "./manipulate";
import { GRAB_RADIUS_M, HandOrders } from "./orders";
import { Placement, type HeadPose, type SurfaceHit } from "./placement";
import { startTableSession, type TableSession } from "./session";
import { RoomStyler } from "./roomStyler";
import { nextArena, type BoardArea } from "./roomTheme";
import { TableRig } from "./tableRig";
import type { Pointer } from "./ui/coach";
import { TableUi } from "./ui/tableUi";

export type MixedRealityState = "off" | "starting" | "placing" | "playing";

export interface MixedRealityHooks {
  /** The session is over (the player left, or the system ended it); the 2D game takes back over. */
  onExit?: (requestedByApp: boolean) => void;
  onStateChange?: (state: MixedRealityState) => void;
  /** System menu up / headset off (`false`), or back (`true`). */
  onFocus?: (focused: boolean) => void;
  /** The player picked another battleground in the headset (board, music and room follow). */
  onArena?: (theme: ArenaTheme) => void;
}

/** The board base's half width in game units, with its trim (matches the UI layout). */
const BOARD_HALF_UNITS = 4.92;

const HANDS: XRHandedness[] = ["left", "right"];

/** localStorage, or a no-op stand-in where it is unavailable (it can throw in private browsing). */
function safeStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // fall through
  }
  return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
}
const UP = new THREE.Vector3(0, 1, 0);

type InputKind = "hand" | "controller";
type PanelTarget = NonNullable<ReturnType<TableUi["rayTarget"]>>;

/** How far a controller's ray reaches when it is on nothing, in metres (a hand's is not drawn then). */
const CONTROLLER_RAY_M = 1.5;

/**
 * Per-side state that survives across frames: the side's input source may
 * come and go, and switch between a tracked hand and a controller.
 */
interface HandSlot {
  pinch: PinchTracker;
  trigger: PressTracker;
  grip: PressTracker;
  /** A / X: opens and closes the menu. */
  menuButton: PressTracker;
  orders: HandOrders;
  /** This press started on a panel: it belongs to the panel until it lets go. */
  panelPinch: boolean;
  /** What this side was last seen as. */
  kind: InputKind | null;
  /** Its pointer ray last frame (tests and diagnostics). */
  ray: THREE.Ray | null;
  /** When its current hold (pinch, or grip) closed, and whether that was within reach of the board. */
  holdSince: number | null;
  holdNear: boolean;
}

interface InputRead {
  slot: HandSlot;
  source: XRInputSource;
  event: PinchEvent | null;
  point: THREE.Vector3;
  ray: THREE.Ray | null;
  target: PanelTarget | null;
}

/**
 * The game on a real table: starts the passthrough session, finds the table,
 * stands the board on it, and turns hands and controllers into orders. The
 * scene engine keeps playing the game exactly as in the 2D hall; this layer
 * only decides where the board is and what the player is pointing at.
 */
export class MixedReality {
  private table: TableSession | null = null;
  private readonly rig = new TableRig();
  private readonly placement = new Placement();
  private readonly markers = new Markers();
  private readonly hands = new Map<XRHandedness, HandSlot>();
  private hitSource: XRHitTestSource | null = null;
  private state: MixedRealityState = "off";
  /** Set while both hands pinch away from any figure: they carry, turn and resize the board. */
  private twoHand: TwoHandStart | null = null;
  /** The two-hand grab has left its dead zone and the board follows the hands. */
  private twoHandMoving = false;
  /** False while the system menu is over the session or the headset is off (what {@link MixedRealityHooks.onFocus} last said). */
  private focused = true;
  private readonly unsubscribe: (() => void)[] = [];

  // Scratch, reused every frame.
  private readonly head: HeadPose = { position: new THREE.Vector3(), yaw: 0 };
  private readonly thumb = new THREE.Vector3();
  private readonly index = new THREE.Vector3();
  private readonly wrist = new THREE.Vector3();
  private readonly indexBase = new THREE.Vector3();
  private readonly pinkyBase = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly figurePoint = new THREE.Vector3();
  private readonly aimPoint = new THREE.Vector3();
  private readonly fingertip = new THREE.Vector3();
  private readonly gripPoint = new THREE.Vector3();
  /** What the player holds up (the coach speaks of pinches or of triggers). */
  private pointer: Pointer = "hands";
  private readonly ui: TableUi;
  private readonly room = new RoomStyler();
  private lastFrameAt = 0;
  /** `?debug` frame statistics, reported twice a second. */
  private perfWindow = { since: 0, frames: 0, worst: 0 };
  private lessonKey = "";

  constructor(
    private readonly engine: SceneEngine,
    private readonly controller: GameController,
    private readonly hooks: MixedRealityHooks = {},
  ) {
    for (const handedness of HANDS) {
      this.hands.set(handedness, {
        pinch: new PinchTracker(),
        trigger: new PressTracker(),
        grip: new PressTracker(),
        menuButton: new PressTracker(),
        orders: new HandOrders(engine),
        panelPinch: false,
        kind: null,
        ray: null,
        holdSince: null,
        holdNear: false,
      });
    }
    this.ui = new TableUi(controller, {
      newGame: ({ difficulty, playerColor }) =>
        controller.start({ mode: "ai", difficulty, playerColor, clockMinutes: null }),
      undo: () => {
        controller.undo();
      },
      replace: () => this.replace(),
      exit: () => void this.exit(),
      cycleArena: () => this.hooks.onArena?.(nextArena(this.engine.getArena())),
      arenaLabel: () => ARENA_LOOKS[this.engine.getArena()].label,
      promotion: () => this.engine.pendingPromotion,
      promote: (kind) => {
        this.engine.choosePromotion(kind);
      },
    });
    this.rig.setScale(loadBoardSize(safeStorage()));
  }

  get current(): MixedRealityState {
    return this.state;
  }

  get placementState(): string {
    return this.placement.state;
  }

  async enter(): Promise<void> {
    if (this.state !== "off") return;
    this.setState("starting");
    try {
      this.table = await startTableSession(this.engine.xrRenderer);
    } catch (error) {
      this.setState("off");
      throw error;
    }
    const { session } = this.table;

    if (this.table.hasHitTest && session.requestHitTestSource) {
      try {
        const viewer = await session.requestReferenceSpace("viewer");
        this.hitSource = (await session.requestHitTestSource({ space: viewer })) ?? null;
      } catch {
        this.hitSource = null; // the board falls back to seat height
      }
    }

    this.engine.xrScene.add(this.markers.group);
    this.engine.xrScene.add(this.ui.group);
    this.engine.xrScene.add(this.room.group);
    this.engine.enterTable(this.rig);
    this.rig.root.visible = false;
    this.placement.replace(performance.now() / 1000);

    this.unsubscribe.push(
      this.table.onVisibility((visibility) => this.setFocused(visibility === "visible")),
      this.table.onEnd((requestedByApp) => this.teardown(requestedByApp)),
    );
    this.engine.setXrFrameHandler((time, frame) => this.onFrame(time / 1000, frame));
    this.setState("placing");
  }

  async exit(): Promise<void> {
    if (!this.table) return;
    await this.table.end(); // teardown runs from the session's end event
  }

  /** Tests: where a hand's pinch point is right now (thumb and index midpoint), and whether it is pinching. */
  debugPinch(handedness: XRHandedness): { x: number; y: number; z: number; pinching: boolean; mode: string } | null {
    const slot = this.hands.get(handedness);
    if (!slot) return null;
    const { x, y, z } = slot.pinch.point;
    return { x, y, z, pinching: slot.pinch.pinching, mode: slot.orders.mode };
  }

  /** Tests: one side's controller as the game reads it. */
  debugPointer(
    handedness: XRHandedness,
  ): {
    kind: string | null;
    mode: string;
    byRay: boolean;
    aim: string | null;
    trigger: boolean;
    grip: boolean;
    pointer: Pointer;
    ray: { origin: number[]; direction: number[] } | null;
  } | null {
    const slot = this.hands.get(handedness);
    if (!slot) return null;
    return {
      kind: slot.kind,
      mode: slot.orders.mode,
      byRay: slot.orders.byRay,
      aim: slot.orders.aimSquare,
      trigger: slot.trigger.held,
      grip: slot.grip.held,
      pointer: this.pointer,
      ray: slot.ray ? { origin: slot.ray.origin.toArray(), direction: slot.ray.direction.toArray() } : null,
    };
  }

  /** Tests: the world-space centre of a visible headset button. */
  debugButtonWorld(id: string): { x: number; y: number; z: number } | null {
    const at = this.ui.buttonWorld(id);
    return at ? { x: at.x, y: at.y, z: at.z } : null;
  }

  /** Tests: what the headset UI shows, and pressing one of its buttons. */
  debugUi(): ReturnType<TableUi["describe"]> {
    return this.ui.describe();
  }

  /** Tests: real-world sizes of what is on the table, in metres. */
  debugSizes(): Record<string, unknown> {
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const measure = (object: THREE.Object3D | undefined): number[] | null => {
      if (!object) return null;
      box.setFromObject(object);
      if (box.isEmpty()) return null;
      box.getSize(size);
      return [size.x, size.y, size.z].map((value) => Math.round(value * 1000) / 1000);
    };
    const content = this.rig.content;
    const board = content.getObjectByName("game_world")?.children.find((child) => child.name === "board");
    const glow = this.room.group.children[1];
    const xr = this.engine.xrRenderer.xr;
    return {
      xrEnabled: xr.enabled,
      presenting: xr.isPresenting,
      unitsToMeters: this.rig.unitsToMeters,
      contentScale: content.scale.x,
      rigVisible: this.rig.root.visible,
      board: measure(board),
      glowScale: glow?.scale.x,
      head: this.head.position.toArray().map((value) => Math.round(value * 100) / 100),
      rigAt: this.rig.root.position.toArray().map((value) => Math.round(value * 100) / 100),
    };
  }

  /** Tests: the room's current battleground styling. */
  debugRoom(): { theme: string | null } {
    return { theme: this.room.current };
  }

  debugPanels(): Record<string, string> {
    return this.ui.snapshots();
  }

  debugPress(id: string): boolean {
    return this.ui.pressById(id);
  }

  /** The board's size as a multiple of its base (5 cm squares). */
  get boardSize(): number {
    return this.rig.scaleMultiplier;
  }

  /** "Re-place board": look for the table again. */
  replace(): void {
    if (this.state !== "playing") return;
    this.placement.replace(performance.now() / 1000);
    this.rig.root.visible = false;
    this.rig.showPlinth(false);
    this.setState("placing");
  }

  // ------------------------------------------------------------------ frame

  private onFrame(now: number, frame: XRFrame): void {
    const space = this.engine.xrRenderer.xr.getReferenceSpace();
    if (!space) return;
    const viewer = frame.getViewerPose(space);
    if (viewer) this.readHead(viewer.transform);

    // The search for a table runs only while the player can see it: time under
    // the system menu or with the headset off never brings on the fallback.
    if (this.state === "placing" && this.table?.session.visibilityState === "visible") this.updatePlacement(now, frame, space);
    this.updateInputs(now, frame, space);
    this.styleRoom(now);
    this.samplePerf(now);
    this.ui.update(
      now,
      { mr: this.state, placement: this.placement.state, pointer: this.pointer },
      this.head.position,
      this.head.yaw,
      this.rig,
    );
    this.showLesson();
  }

  private samplePerf(now: number): void {
    const stats = this.perfWindow;
    if (stats.since === 0) stats.since = now;
    const gap = this.lastPerfAt ? (now - this.lastPerfAt) * 1000 : 0;
    this.lastPerfAt = now;
    stats.frames += 1;
    stats.worst = Math.max(stats.worst, gap);
    if (now - stats.since < 0.5) return;
    this.ui.showPerf({
      fps: stats.frames / (now - stats.since),
      worstMs: stats.worst,
      calls: this.engine.xrRenderer.info.render.calls,
    });
    this.perfWindow = { since: now, frames: 0, worst: 0 };
  }

  private lastPerfAt = 0;

  /** The battleground restyles the room: veil, weather, and the board's light on the table. */
  private styleRoom(now: number): void {
    const dt = this.lastFrameAt ? Math.min(0.05, now - this.lastFrameAt) : 0;
    this.lastFrameAt = now;
    const board: BoardArea | null = this.rig.root.visible
      ? { center: this.rig.root.position, half: BOARD_HALF_UNITS * this.rig.unitsToMeters }
      : null;
    const arena = this.engine.getArena();
    if (this.room.current !== arena) this.room.setTheme(arena, this.head.position, board);
    this.room.update(dt, this.head.position, board, this.rig.root.rotation.y);
  }

  /** The first-move lesson pulses the suggested move on the board. */
  private showLesson(): void {
    const move = this.ui.lessonMove;
    const key = move ? `${move.from}${move.to}` : "";
    if (key === this.lessonKey) return;
    this.lessonKey = key;
    this.engine.previewMove(move);
  }

  private readHead(transform: XRRigidTransform): void {
    const { position, orientation } = transform;
    this.head.position.set(position.x, position.y, position.z);
    this.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    this.head.yaw = Math.atan2(-forward.x, -forward.z);
  }

  private updatePlacement(now: number, frame: XRFrame, space: XRReferenceSpace): void {
    let hit: SurfaceHit | null = null;
    if (this.hitSource) {
      const pose = frame.getHitTestResults(this.hitSource)[0]?.getPose(space);
      if (pose) {
        const { position, orientation } = pose.transform;
        this.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
        hit = {
          position: new THREE.Vector3(position.x, position.y, position.z),
          normal: UP.clone().applyQuaternion(this.quaternion),
        };
      }
    }
    this.placement.update(now, this.head, hit);

    const pose = this.placement.pose;
    if (this.placement.state === "aiming" && pose) {
      // The real board previews where it would go.
      this.rig.setPose(pose.position, pose.yaw);
      this.rig.root.visible = true;
      this.markers.showPlacement(pose.position);
    } else if (this.placement.state === "fallback" && pose) {
      this.settle(pose.position, pose.yaw, true);
    } else {
      this.rig.root.visible = false;
      this.markers.showPlacement(null);
    }
  }

  private settle(position: THREE.Vector3, yaw: number, plinth: boolean): void {
    this.rig.setPose(position, yaw);
    this.rig.showPlinth(plinth);
    this.rig.root.visible = true;
    this.markers.showPlacement(null);
    this.setState("playing");
  }

  private confirmPlacement(): boolean {
    if (this.state !== "placing") return false;
    const pose = this.placement.confirm();
    if (!pose) return false;
    this.settle(pose.position, pose.yaw, false);
    return true;
  }

  /**
   * Hands and controllers, every frame, through one path. A hand pinches and a
   * controller pulls its trigger: both become the same start / hold / end, so
   * panels, orders and the board treat them alike. A side can change from
   * hand to controller mid-session (controllers picked up or put down).
   */
  private updateInputs(now: number, frame: XRFrame, space: XRReferenceSpace): void {
    const seen = new Set<XRHandedness>();
    const reads: InputRead[] = [];
    const rays: { ray: THREE.Ray; length: number }[] = [];
    let panelTarget: PanelTarget | null = null;
    let poked = false;
    let anyHand = false;
    let anyController = false;

    for (const source of this.table?.session.inputSources ?? []) {
      if (source.targetRayMode !== "tracked-pointer") continue;
      const slot = this.hands.get(source.handedness);
      // One source per side: should a hand and a controller ever both be
      // listed for it, the first wins rather than the side flipping each frame.
      if (!slot || seen.has(source.handedness)) continue;
      seen.add(source.handedness);
      const kind: InputKind = source.hand ? "hand" : "controller";
      if (slot.kind !== kind) this.switchKind(slot, kind);
      if (kind === "hand") anyHand = true;
      else anyController = true;

      const ray = this.rayOf(frame, source, space);
      slot.ray = ray;
      let event: PinchEvent | null;
      let point: THREE.Vector3;
      let poking = false;
      if (source.hand) {
        const thumb = this.joint(frame, source.hand, "thumb-tip", space, this.thumb);
        const index = this.joint(frame, source.hand, "index-finger-tip", space, this.index);
        const wrist = this.joint(frame, source.hand, "wrist", space, this.wrist);
        const indexBase = this.joint(frame, source.hand, "index-finger-metacarpal", space, this.indexBase);
        const pinkyBase = this.joint(frame, source.hand, "pinky-finger-metacarpal", space, this.pinkyBase);
        const systemGesture =
          wrist && indexBase && pinkyBase
            ? palmFacesHead(wrist, palmNormal(source.handedness, wrist, indexBase, pinkyBase), this.head.position)
            : false;
        event = slot.pinch.update(thumb, index, now, { allowStart: !systemGesture });
        point = slot.pinch.point;
        // A hand mid-order (carrying a figure, or aiming) pokes nothing: its
        // fingertip passing a panel must neither press it nor swallow the release.
        const busy = slot.orders.mode !== "idle";
        poking = this.ui.poke(source.handedness, index && !busy ? this.fingertip.copy(index) : null);
        poked ||= poking;
      } else {
        event = slot.trigger.update(buttonPressed(source.gamepad, TRIGGER), ray ? ray.origin : null, now);
        point = slot.trigger.point;
        const grip = source.gripSpace ? frame.getPose(source.gripSpace, space) : undefined;
        const gripAt = grip ? this.gripPoint.set(grip.transform.position.x, grip.transform.position.y, grip.transform.position.z) : ray ? ray.origin : null;
        slot.grip.update(buttonPressed(source.gamepad, SQUEEZE), gripAt, now);
        if (slot.menuButton.update(buttonPressed(source.gamepad, PRIMARY), this.head.position, now) === "start" && this.state === "playing") {
          this.ui.toggleMenu();
          pulse(source, 0.25, 15);
        }
      }

      if (event === "start" && this.confirmPlacement()) {
        if (kind === "controller") pulse(source, 0.5, 40);
        continue;
      }

      // Panels first: a fingertip on a panel pokes it, and a press along a ray
      // that lands on a panel belongs to the panel (a button presses; the card
      // itself just stops the press from reaching the board behind it). A hand
      // already closing on a figure keeps the figure.
      const target = ray ? this.ui.rayTarget(ray) : null;
      if (target && !panelTarget) panelTarget = target;
      if (event === "start" && target) {
        const onFigure = kind === "hand" && this.state === "playing" && this.engine.figureNear(point, GRAB_RADIUS_M) !== null;
        if (!onFigure) {
          if (target.button) {
            this.ui.pressTarget(target);
            if (kind === "controller") pulse(source, 0.25, 15);
          }
          slot.panelPinch = true;
        }
      }
      if (slot.panelPinch || poking) {
        if (event === "end" || event === "lost") slot.panelPinch = false;
        if (ray && target && !poking) rays.push({ ray, length: target.distance });
        continue;
      }
      reads.push({ slot, source, event, point, ray, target });
    }

    // A side whose input source vanished still has to report `lost`.
    for (const [handedness, slot] of this.hands) {
      if (seen.has(handedness)) continue;
      const tracker = slot.kind === "controller" ? slot.trigger : slot.pinch;
      const event = tracker.update(null, null, now);
      slot.grip.update(null, null, now);
      slot.menuButton.update(null, null, now);
      if (event) slot.orders.update(event, tracker.point, null, now);
      if (event === "lost") slot.panelPinch = false;
    }

    this.updateTwoHand(now);

    let ordering = false;
    let ring: SquareId | null = null;
    for (const { slot, source, event, point, ray, target } of reads) {
      const before = slot.orders.mode;
      if (this.state === "playing" && !this.twoHand) slot.orders.update(event, point, ray, now);
      const after = slot.orders.mode;
      if (slot.kind === "controller") {
        if (before !== "ordering" && after === "ordering") pulse(source, 0.3, 20);
        else if (event === "end" && before !== "idle") pulse(source, 0.5, 30);
      }
      if (after === "ordering") ordering = this.showOrder(slot) || ordering;

      // What the ray is on: a panel, the square being aimed at, or (a
      // controller at rest) the square it hovers, which the ring shows.
      let square = slot.orders.aimSquare;
      if (!square && !target && ray && slot.kind === "controller" && this.state === "playing" && !this.twoHand) {
        square = this.engine.pickWithRay(ray).square;
      }
      if (!ring && after !== "ordering") ring = square;
      if (!ray || this.twoHand || (after === "ordering" && !slot.orders.byRay)) continue;
      // A hand's ray shows only while it is on a panel or the board: a hand at
      // rest, or busy with something else in the room, draws nothing.
      const onBoard = !target && !square && slot.kind === "hand" && this.rig.root.visible ? this.rig.rayToBoard(ray, BOARD_HALF_UNITS) : null;
      const length = target
        ? target.distance
        : square
          ? ray.origin.distanceTo(this.engine.squareCenterWorld(square, this.aimPoint))
          : slot.kind === "controller"
            ? CONTROLLER_RAY_M
            : onBoard;
      if (length !== null) rays.push({ ray, length });
    }

    if (panelTarget) this.ui.hoverRay(panelTarget);
    else if (!poked) this.ui.hoverRay(null);
    for (const index of [0, 1] as const) this.markers.showRay(index, rays[index]?.ray ?? null, rays[index]?.length);
    if (!ordering) {
      this.markers.showOrder(null, null, false);
      const legal = ring !== null && (this.engine.isLegalTarget(ring) || this.engine.canOrder(ring));
      this.markers.showAim(ring ? this.engine.squareCenterWorld(ring, this.aimPoint) : null, legal, this.rig.root.rotation.y);
    }
    if (anyController) this.pointer = "controllers";
    else if (anyHand) this.pointer = "hands";
  }

  /**
   * Both sides holding (pinch, or grip on a controller), neither giving an
   * order: they carry, turn and resize the board. Only a deliberate grab
   * counts: both closed within {@link TWO_HAND_SYNC_S} of each other and
   * within {@link TWO_HAND_REACH_M} of the board. Then nothing moves until the
   * hands leave the dead zone, and the board follows on from there.
   */
  private updateTwoHand(now: number): void {
    const leftSlot = this.hands.get("left");
    const rightSlot = this.hands.get("right");
    const left = this.trackHold(leftSlot, now);
    const right = this.trackHold(rightSlot, now);
    if (this.state === "playing" && left && right && leftSlot && rightSlot) {
      if (!this.twoHand) {
        const together = Math.abs((leftSlot.holdSince ?? 0) - (rightSlot.holdSince ?? 0)) <= TWO_HAND_SYNC_S;
        if (!together || !leftSlot.holdNear || !rightSlot.holdNear) return;
        for (const slot of this.hands.values()) slot.orders.cancelAim();
        this.twoHandMoving = false;
        this.twoHand = {
          left: left.clone(),
          right: right.clone(),
          position: this.rig.root.position.clone(),
          yaw: this.rig.root.rotation.y,
          scale: this.rig.scaleMultiplier,
          keepHeight: !this.rig.plinthVisible,
        };
      }
      if (!this.twoHandMoving) {
        if (!pastDeadZone(this.twoHand, { left, right })) return;
        // Pick up from here, so leaving the dead zone never makes the board jump.
        this.twoHandMoving = true;
        this.twoHand.left.copy(left);
        this.twoHand.right.copy(right);
      }
      const next = twoHandTransform(this.twoHand, { left, right });
      this.rig.setPose(next.position, next.yaw);
      this.rig.setScale(next.scale);
    } else if (this.twoHand) {
      this.twoHand = null;
      saveBoardSize(safeStorage(), this.rig.scaleMultiplier);
    }
  }

  /** A side's hold point, noting when the hold closed and whether it closed on the board. */
  private trackHold(slot: HandSlot | undefined, now: number): THREE.Vector3 | null {
    const point = this.holdPoint(slot);
    if (!slot) return null;
    if (!point) slot.holdSince = null;
    else if (slot.holdSince === null) {
      slot.holdSince = now;
      slot.holdNear = this.rig.root.visible && this.rig.distanceToBoard(point, BOARD_HALF_UNITS) <= TWO_HAND_REACH_M;
    }
    return point;
  }

  private holdPoint(slot: HandSlot | undefined): THREE.Vector3 | null {
    if (!slot || slot.panelPinch || slot.orders.mode === "ordering") return null;
    if (slot.kind === "controller") return slot.grip.held ? slot.grip.point : null;
    if (slot.kind === "hand") return slot.pinch.pinching ? slot.pinch.point : null;
    return null;
  }

  /** A side changed between hand and controller: whatever it was doing stands down. */
  private switchKind(slot: HandSlot, kind: InputKind | null): void {
    // `lost` never reads the clock.
    if (slot.orders.mode !== "idle") slot.orders.update("lost", slot.pinch.point, null, 0);
    slot.pinch.reset();
    slot.trigger.reset();
    slot.grip.reset();
    slot.menuButton.reset();
    slot.panelPinch = false;
    slot.kind = kind;
  }

  /** Draws the command line and the target ring for a hand giving an order (a ray order shows its ray instead of the line). */
  private showOrder(slot: HandSlot): boolean {
    const from = this.engine.orderedSquare;
    if (!from) return false;
    this.engine.squareCenterWorld(from, this.figurePoint);
    this.figurePoint.y += 0.03;
    const aim = slot.orders.aimSquare;
    const legal = aim !== null && this.engine.isLegalTarget(aim);
    const carried = slot.kind === "controller" ? slot.trigger.point : slot.pinch.point;
    this.markers.showOrder(slot.orders.byRay ? null : this.figurePoint, carried, legal);
    this.markers.showAim(aim ? this.engine.squareCenterWorld(aim, this.aimPoint) : null, legal, this.rig.root.rotation.y);
    return true;
  }

  private joint(
    frame: XRFrame,
    hand: XRHand,
    name: XRHandJoint,
    space: XRReferenceSpace,
    out: THREE.Vector3,
  ): THREE.Vector3 | null {
    const jointSpace = hand.get(name);
    const pose = jointSpace && frame.getJointPose ? frame.getJointPose(jointSpace, space) : undefined;
    if (!pose) return null;
    const { x, y, z } = pose.transform.position;
    return out.set(x, y, z);
  }

  private rayOf(frame: XRFrame, source: XRInputSource, space: XRReferenceSpace): THREE.Ray | null {
    const pose = frame.getPose(source.targetRaySpace, space);
    if (!pose) return null;
    const { position, orientation } = pose.transform;
    this.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
    return new THREE.Ray(
      new THREE.Vector3(position.x, position.y, position.z),
      new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion),
    );
  }

  // --------------------------------------------------------------- lifecycle

  private teardown(requestedByApp: boolean): void {
    for (const off of this.unsubscribe.splice(0)) off();
    this.engine.setXrFrameHandler(null);
    this.hitSource?.cancel();
    this.hitSource = null;
    for (const slot of this.hands.values()) {
      slot.orders.update("lost", slot.pinch.point, null, 0);
      this.switchKind(slot, null);
    }
    this.twoHand = null;
    this.engine.exitTable();
    this.engine.previewMove(null);
    this.lessonKey = "";
    this.markers.group.removeFromParent();
    this.ui.group.removeFromParent();
    this.room.group.removeFromParent();
    this.lastFrameAt = 0;
    this.rig.showPlinth(false);
    this.table = null;
    // Quitting from the system menu ends the session while it is blurred: the
    // game it paused belongs to the 2D page again, which is in focus.
    this.setFocused(true);
    this.setState("off");
    this.hooks.onExit?.(requestedByApp);
  }

  private setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    this.hooks.onFocus?.(focused);
  }

  private setState(state: MixedRealityState): void {
    if (this.state === state) return;
    this.state = state;
    this.hooks.onStateChange?.(state);
  }
}
