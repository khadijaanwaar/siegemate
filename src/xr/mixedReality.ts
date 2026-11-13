/// <reference types="webxr" />
import * as THREE from "three";

import type { SceneEngine } from "../scene/sceneEngine";
import { palmFacesHead, palmNormal, PinchTracker } from "./hands";
import { Markers } from "./markers";
import { HandOrders } from "./orders";
import { Placement, type HeadPose, type SurfaceHit } from "./placement";
import { startTableSession, type TableSession } from "./session";
import { TableRig } from "./tableRig";

export type MixedRealityState = "off" | "starting" | "placing" | "playing";

export interface MixedRealityHooks {
  /** The session is over (the player left, or the system ended it); the 2D game takes back over. */
  onExit?: (requestedByApp: boolean) => void;
  onStateChange?: (state: MixedRealityState) => void;
  /** System menu up / headset off (`false`), or back (`true`). */
  onFocus?: (focused: boolean) => void;
}

const HANDS: XRHandedness[] = ["left", "right"];
const UP = new THREE.Vector3(0, 1, 0);

/** Per-hand state that survives across frames (the hand's input source may come and go). */
interface HandSlot {
  pinch: PinchTracker;
  orders: HandOrders;
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

  constructor(
    private readonly engine: SceneEngine,
    private readonly hooks: MixedRealityHooks = {},
  ) {
    for (const handedness of HANDS) {
      this.hands.set(handedness, { pinch: new PinchTracker(), orders: new HandOrders(engine) });
    }
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
      if (this.state === "playing") slot.orders.update(event, slot.pinch.point, ray);

      if (slot.orders.mode === "ordering") ordering = this.showOrder(slot) || ordering;
      if (rayIndex < 2) {
        this.markers.showRay(rayIndex, slot.orders.mode === "ordering" ? null : ray);
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
    this.markers.group.removeFromParent();
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
