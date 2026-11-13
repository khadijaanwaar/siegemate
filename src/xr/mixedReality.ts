/// <reference types="webxr" />
import * as THREE from "three";

import type { GameController } from "../core/gameController";
import { ARENA_LOOKS, type ArenaTheme } from "../scene/arena";
import type { SceneEngine } from "../scene/sceneEngine";
import { palmFacesHead, palmNormal, PinchTracker } from "./hands";
import { Markers } from "./markers";
import { loadBoardSize, saveBoardSize, twoHandTransform, type TwoHandStart } from "./manipulate";
import { HandOrders } from "./orders";
import { Placement, type HeadPose, type SurfaceHit } from "./placement";
import { startTableSession, type TableSession } from "./session";
import { RoomStyler } from "./roomStyler";
import { nextArena, type BoardArea } from "./roomTheme";
import { TableRig } from "./tableRig";
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

/** Per-hand state that survives across frames (the hand's input source may come and go). */
interface HandSlot {
  pinch: PinchTracker;
  orders: HandOrders;
  /** This pinch started on a panel button: it belongs to the panel until it opens. */
  panelPinch: boolean;
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
      this.hands.set(handedness, { pinch: new PinchTracker(), orders: new HandOrders(engine), panelPinch: false });
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

    const onSelect = (event: XRInputSourceEvent): void => this.onControllerSelect(event);
    session.addEventListener("select", onSelect);
    this.unsubscribe.push(() => session.removeEventListener("select", onSelect));
    this.unsubscribe.push(
      this.table.onVisibility((visibility) => this.hooks.onFocus?.(visibility === "visible")),
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

  /** Tests: what the headset UI shows, and pressing one of its buttons. */
  debugUi(): ReturnType<TableUi["describe"]> {
    return this.ui.describe();
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

    if (this.state === "placing") this.updatePlacement(now, frame, space);
    this.updateHands(now, frame, space);
    this.styleRoom(now);
    this.samplePerf(now);
    this.ui.update(now, { mr: this.state, placement: this.placement.state }, this.head.position, this.head.yaw, this.rig);
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

  private updateHands(now: number, frame: XRFrame, space: XRReferenceSpace): void {
    const seen = new Set<XRHandedness>();
    let rayIndex: 0 | 1 = 0;
    let ordering = false;
    const reads: { slot: HandSlot; event: ReturnType<PinchTracker["update"]>; ray: THREE.Ray | null }[] = [];

    for (const source of this.table?.session.inputSources ?? []) {
      if (!source.hand) continue;
      const slot = this.hands.get(source.handedness);
      if (!slot) continue;
      seen.add(source.handedness);

      const thumb = this.joint(frame, source.hand, "thumb-tip", space, this.thumb);
      const index = this.joint(frame, source.hand, "index-finger-tip", space, this.index);
      const wrist = this.joint(frame, source.hand, "wrist", space, this.wrist);
      const indexBase = this.joint(frame, source.hand, "index-finger-metacarpal", space, this.indexBase);
      const pinkyBase = this.joint(frame, source.hand, "pinky-finger-metacarpal", space, this.pinkyBase);
      const systemGesture =
        wrist && indexBase && pinkyBase
          ? palmFacesHead(wrist, palmNormal(source.handedness, wrist, indexBase, pinkyBase), this.head.position)
          : false;

      const event = slot.pinch.update(thumb, index, now, { allowStart: !systemGesture });
      const ray = this.rayOf(frame, source, space);
      if (event === "start" && this.confirmPlacement()) continue;

      // Panels first: a fingertip on a panel pokes it, a pinch along a ray
      // that lands on a button presses it, and neither reaches the board.
      const poking = this.ui.poke(source.handedness, index ? this.fingertip.copy(index) : null);
      const target = ray ? this.ui.rayTarget(ray) : null;
      this.ui.hoverRay(target);
      if (event === "start" && target?.button) {
        this.ui.pressTarget(target);
        slot.panelPinch = true;
      }
      if (slot.panelPinch || poking) {
        if (event === "end" || event === "lost") slot.panelPinch = false;
        continue;
      }
      reads.push({ slot, event, ray });
    }

    // Both hands pinching, neither holding a figure: they hold the board instead.
    const left = this.hands.get("left");
    const right = this.hands.get("right");
    const bothFree =
      this.state === "playing" &&
      left !== undefined &&
      right !== undefined &&
      left.pinch.pinching &&
      right.pinch.pinching &&
      left.orders.mode !== "ordering" &&
      right.orders.mode !== "ordering";
    if (bothFree && left && right) {
      if (!this.twoHand) {
        left.orders.cancelAim();
        right.orders.cancelAim();
        this.twoHand = {
          left: left.pinch.point.clone(),
          right: right.pinch.point.clone(),
          position: this.rig.root.position.clone(),
          yaw: this.rig.root.rotation.y,
          scale: this.rig.scaleMultiplier,
          keepHeight: !this.rig.plinthVisible,
        };
      }
      const next = twoHandTransform(this.twoHand, { left: left.pinch.point, right: right.pinch.point });
      this.rig.setPose(next.position, next.yaw);
      this.rig.setScale(next.scale);
    } else if (this.twoHand) {
      this.twoHand = null;
      saveBoardSize(safeStorage(), this.rig.scaleMultiplier);
    }

    for (const { slot, event, ray } of reads) {
      if (this.state === "playing" && !this.twoHand) slot.orders.update(event, slot.pinch.point, ray);
      if (slot.orders.mode === "ordering") ordering = this.showOrder(slot) || ordering;
      if (rayIndex < 2) {
        this.markers.showRay(rayIndex, slot.orders.mode === "ordering" || this.twoHand ? null : ray);
        rayIndex = (rayIndex + 1) as 0 | 1;
      }
    }

    // A hand whose input source vanished still has to report `lost`.
    for (const [handedness, slot] of this.hands) {
      if (seen.has(handedness)) continue;
      const event = slot.pinch.update(null, null, now);
      if (event) slot.orders.update(event, slot.pinch.point, null);
    }
    for (; rayIndex < 2; rayIndex = (rayIndex + 1) as 0 | 1) this.markers.showRay(rayIndex, null);
    if (!ordering) {
      this.markers.showOrder(null, null, false);
      this.markers.showAim(null, false, 0);
    }
  }

  /** Draws the command line and the target ring for a hand giving an order. */
  private showOrder(slot: HandSlot): boolean {
    const from = this.engine.orderedSquare;
    if (!from) return false;
    this.engine.squareCenterWorld(from, this.figurePoint);
    this.figurePoint.y += 0.03;
    const aim = slot.orders.aimSquare;
    const legal = aim !== null && this.engine.isLegalTarget(aim);
    this.markers.showOrder(this.figurePoint, slot.pinch.point, legal);
    this.markers.showAim(aim ? this.engine.squareCenterWorld(aim, this.aimPoint) : null, legal, this.rig.root.rotation.y);
    return true;
  }

  private onControllerSelect(event: XRInputSourceEvent): void {
    // Hands are read from their joints; Quest also fires select for a hand pinch.
    if (event.inputSource.hand) return;
    const space = this.engine.xrRenderer.xr.getReferenceSpace();
    if (!space) return;
    if (this.confirmPlacement()) return;
    if (this.state !== "playing") return;
    const ray = this.rayOf(event.frame, event.inputSource, space);
    if (!ray) return;
    const target = this.ui.rayTarget(ray);
    if (target?.button) {
      this.ui.pressTarget(target);
      return;
    }
    const { square } = this.engine.pickWithRay(ray);
    if (square) this.engine.tapSquare(square);
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
      slot.pinch.reset();
      slot.orders.update("lost", slot.pinch.point, null);
    }
    this.engine.exitTable();
    this.engine.previewMove(null);
    this.lessonKey = "";
    this.markers.group.removeFromParent();
    this.ui.group.removeFromParent();
    this.room.group.removeFromParent();
    this.lastFrameAt = 0;
    this.rig.showPlinth(false);
    this.table = null;
    this.setState("off");
    this.hooks.onExit?.(requestedByApp);
  }

  private setState(state: MixedRealityState): void {
    if (this.state === state) return;
    this.state = state;
    this.hooks.onStateChange?.(state);
  }
}
