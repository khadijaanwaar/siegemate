import * as THREE from "three";

import { audio } from "../../audio/audioManager";
import type { GameController } from "../../core/gameController";
import { loadStats, winRate } from "../../core/stats";
import type { Difficulty, Faction, GameSnapshot, PieceKind } from "../../core/types";
import { drawShareCard, SHARE_CARD } from "../../share/headsetShare";
import type { TableRig } from "../tableRig";
import { CanvasPanel, type PanelButton } from "./canvasPanel";
import { Coach, coachCopy, type CoachInput, type CoachStep, type Pointer } from "./coach";
import { MENU_PANEL, menuButtons, menuLines, type MenuState, PROMOTION_PANEL, promotionButtons, promotionKindOf, SLAB_PANEL, slabButtons } from "./layouts";
import { UI } from "./palette";
import { PokeTracker } from "./poke";

/** The board base's half width in game units, with its trim. */
const BOARD_HALF_UNITS = 4.92;
const ONBOARDED_KEY = "mr-chess:onboarded";
/** Exit waits this long for its second tap. */
const EXIT_CONFIRM_S = 3;
/** A button hovered again within this long of its last hover does not blip again. */
const HOVER_QUIET_S = 0.4;

export interface TableUiActions {
  newGame(config: { difficulty: Difficulty; playerColor: Faction }): void;
  undo(): void;
  replace(): void;
  exit(): void;
  cycleArena(): void;
  arenaLabel(): string;
  /** The side whose pawn waits for its crown, or null. */
  promotion(): Faction | null;
  promote(kind: PieceKind): void;
  /** Sound (everything) and music, as the 2D settings have them. */
  sound(): { sound: boolean; music: boolean };
  setSound(change: { sound?: boolean; music?: boolean }): void;
  /** The board's height above (or below) where it was placed, in metres. */
  height(): number;
  /** One step up (1) or down (-1). */
  nudgeHeight(direction: 1 | -1): void;
}

type PanelName = "coach" | "slab" | "menu" | "result" | "share" | "perf" | "promote";

/** `?debug` shows a frame-rate card beside the board (for testing on a device). */
const SHOW_PERF = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug");

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readFlag(key: string): boolean {
  try {
    return storage()?.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    storage()?.setItem(key, "1");
  } catch {
    // not remembered; harmless
  }
}

/**
 * Everything the player reads or presses in the headset, with as few words as
 * possible: a coach card (one hint at a time), a control slab on the table in
 * poke reach (status, Undo, Menu), a menu card (new game with strength and
 * side, battleground, sound, music, board height, re-place, how to play, exit),
 * a crown card when a pawn promotes and a result card at the end. All panels
 * are world-locked around the board and turn to face the player, without
 * roll, once as they appear. Every button blips on hover and press.
 */
export class TableUi {
  readonly group = new THREE.Group();
  private readonly panels: Record<PanelName, CanvasPanel>;
  private readonly coach = new Coach();
  private readonly pokes = new Map<XRHandedness, PokeTracker>([
    ["left", new PokeTracker()],
    ["right", new PokeTracker()],
  ]);
  private coachStep: CoachStep = "none";
  private pointer: Pointer = "hands";
  private menuOpen = false;
  private resultShown = false;
  private pendingResult = false;
  private onboarded = readFlag(ONBOARDED_KEY);
  private playerMoved = false;
  private statusKey = "";
  private strength: Difficulty = "medium";
  /** What the menu was last drawn with. */
  private menuKey = "";
  /** Exit was tapped once: a second tap before this time (seconds, performance clock) leaves. */
  private exitArmedUntil = 0;
  /** The button each panel last showed hovered (for the hover blip). */
  private readonly hovered = new Map<CanvasPanel, { id: string; at: number }>();
  /** The panel each hand's fingertip is hovering this frame: a poke outranks any ray on it. */
  private readonly pokeHover = new Map<XRHandedness, CanvasPanel | null>();
  /** Panels that face the player: their turn relative to the board, set once when they appear. */
  private readonly facing = new Map<CanvasPanel, THREE.Quaternion>();
  private side: Faction = "w";
  /** The side the promotion card is open for. */
  private promoting: Faction | null = null;
  private readonly unsubscribe: (() => void)[] = [];
  private readonly head = new THREE.Vector3();
  private headYaw = 0;
  private readonly scratch = new THREE.Vector3();

  constructor(
    private readonly controller: GameController,
    private readonly actions: TableUiActions,
  ) {
    this.group.name = "xr_ui";
    this.panels = {
      // Read from ~0.75 m: 16 mm type keeps Meta's ~0.9 degree minimum.
      coach: new CanvasPanel(0.42, 0.08),
      slab: new CanvasPanel(SLAB_PANEL.width, SLAB_PANEL.height),
      menu: new CanvasPanel(MENU_PANEL.width, MENU_PANEL.height),
      result: new CanvasPanel(0.28, 0.17),
      share: new CanvasPanel(SHARE_CARD.width, SHARE_CARD.height),
      perf: new CanvasPanel(0.17, 0.05),
      promote: new CanvasPanel(PROMOTION_PANEL.width, PROMOTION_PANEL.height),
    };
    for (const panel of Object.values(this.panels)) {
      panel.visible = false;
      this.group.add(panel.mesh);
    }
    this.unsubscribe.push(
      controller.on("move", () => {
        const snapshot = controller.getSnapshot();
        // A move by the player's side (the machine moves the other one).
        if (snapshot.mode !== "ai" || snapshot.turn !== snapshot.playerColor) this.playerMoved = true;
      }),
      controller.on("gameover", () => {
        this.pendingResult = true;
      }),
      controller.on("reset", () => {
        this.resultShown = false;
        this.pendingResult = false;
        this.panels.result.visible = false;
        this.panels.share.visible = false;
      }),
    );
  }

  /** Called every headset frame. `headYaw` is where the player faces (0 = -Z). */
  update(
    now: number,
    input: Omit<CoachInput, "onboarded" | "playerMoved" | "now"> & { pointer?: Pointer },
    head: THREE.Vector3,
    headYaw: number,
    rig: TableRig,
  ): void {
    this.head.copy(head);
    this.headYaw = headYaw;
    const step = this.coach.step({ ...input, onboarded: this.onboarded, playerMoved: this.playerMoved, now });
    if (this.coach.finished && !this.onboarded) {
      this.onboarded = true;
      writeFlag(ONBOARDED_KEY);
    }
    const pointer = input.pointer ?? "hands";
    if (step !== this.coachStep || pointer !== this.pointer) this.showCoach(step, pointer);

    const playing = input.mr === "playing";
    if (this.exitArmedUntil > 0 && performance.now() / 1000 > this.exitArmedUntil) this.disarmExit();
    if (this.menuOpen && this.menuState().key !== this.menuKey) this.showMenu();
    this.panels.slab.visible = playing;
    if (playing) this.refreshStatus();
    if (this.pendingResult && playing) {
      this.pendingResult = false;
      this.showResult();
    }
    const promoting = playing ? this.actions.promotion() : null;
    if (promoting !== this.promoting) this.showPromotion(promoting);
    if (!playing) {
      this.panels.menu.visible = false;
      this.panels.result.visible = false;
      this.panels.share.visible = false;
    }
    this.layout(rig, input.mr);
    for (const panel of Object.values(this.panels)) panel.update(now);
  }

  /** `?debug`: frame rate, worst frame and draw calls over the last half second. */
  showPerf(stats: { fps: number; worstMs: number; calls: number }): void {
    if (!SHOW_PERF) return;
    const panel = this.panels.perf;
    panel.visible = true;
    const color = stats.fps >= 70 ? UI.azure : stats.fps >= 60 ? UI.gold : UI.danger;
    this.setPanel(panel, {
      lines: [
        { text: `${Math.round(stats.fps)} fps`, size: 0.014, y: 0.018, color },
        { text: `worst ${stats.worstMs.toFixed(1)} ms · ${stats.calls} draws`, size: 0.008, y: 0.038, color: UI.muted },
      ],
      buttons: [],
    });
  }

  /** The first move to light for the lesson, or null (white opens e2-e4, black answers e7-e5). */
  get lessonMove(): { from: string; to: string } | null {
    if (this.coachStep !== "first-move") return null;
    const snapshot = this.controller.getSnapshot();
    if (snapshot.status !== "playing" || snapshot.turn !== snapshot.playerColor) return null;
    return snapshot.playerColor === "w" ? { from: "e2", to: "e4" } : { from: "e7", to: "e5" };
  }

  /** Poke input from one hand's index fingertip (world space, or null when untracked). True while the finger is on a panel. */
  poke(hand: XRHandedness, fingertip: THREE.Vector3 | null): boolean {
    const tracker = this.pokes.get(hand);
    if (!tracker) return false;
    let best: { panel: CanvasPanel; depth: number; id: string | null } | null = null;
    if (fingertip) {
      for (const panel of this.interactive()) {
        const local = panel.localPoint(fingertip);
        const inside = local.x >= 0 && local.x <= panel.width && local.y >= 0 && local.y <= panel.height;
        if (!inside || local.depth < -0.03 || local.depth > 0.06) continue;
        if (!best || Math.abs(local.depth) < Math.abs(best.depth)) {
          best = { panel, depth: local.depth, id: panel.buttonAt(local.x, local.y)?.id ?? null };
        }
      }
    }
    const pressed = tracker.update(best ? best.depth : null, best?.id ?? null);
    this.pokeHover.set(hand, best?.panel ?? null);
    if (best) this.setHover(best.panel, tracker.hovered);
    if (pressed && best) this.press(best.panel, pressed);
    return best !== null && best.depth < 0.04;
  }

  /** The panel button a ray points at, for hover and pinch-to-press. */
  rayTarget(ray: THREE.Ray): { panel: CanvasPanel; button: PanelButton | null; distance: number } | null {
    let best: { panel: CanvasPanel; button: PanelButton | null; distance: number } | null = null;
    const plane = new THREE.Plane();
    const normal = new THREE.Vector3();
    for (const panel of this.interactive()) {
      panel.mesh.updateWorldMatrix(true, false);
      normal.set(0, 0, 1).transformDirection(panel.mesh.matrixWorld);
      plane.setFromNormalAndCoplanarPoint(normal, panel.mesh.getWorldPosition(this.scratch));
      const hit = ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) continue;
      const local = panel.localPoint(hit);
      if (local.x < 0 || local.x > panel.width || local.y < 0 || local.y > panel.height) continue;
      const distance = hit.distanceTo(ray.origin);
      if (!best || distance < best.distance) best = { panel, button: panel.buttonAt(local.x, local.y), distance };
    }
    return best;
  }

  /** Hover feedback for a ray (call with null to clear). */
  hoverRay(target: { panel: CanvasPanel; button: PanelButton | null } | null): void {
    const poked = new Set(this.pokeHover.values());
    for (const panel of this.interactive()) {
      if (poked.has(panel)) continue;
      this.setHover(panel, target && target.panel === panel ? (target.button?.id ?? null) : null);
    }
  }

  pressTarget(target: { panel: CanvasPanel; button: PanelButton | null }): void {
    if (target.button) this.press(target.panel, target.button.id);
  }

  /** A controller's A / X: the same as pressing Menu on the slab. */
  toggleMenu(): void {
    if (this.panels.slab.visible) this.press(this.panels.slab, "menu");
  }

  /** Tests: press a visible button by id. */
  pressById(id: string): boolean {
    for (const panel of this.interactive()) {
      const found = this.buttonsOf(panel).find((button) => button.id === id && !button.disabled);
      if (found) {
        this.press(panel, id);
        return true;
      }
    }
    return false;
  }

  /** Tests and diagnostics: what is on show, and what the menu would start. */
  describe(): { coach: CoachStep; panels: PanelName[]; pointer: Pointer; menu: { strength: Difficulty; side: Faction } } {
    const panels = (Object.keys(this.panels) as PanelName[]).filter((name) => this.panels[name].visible);
    return { coach: this.coachStep, panels, pointer: this.pointer, menu: { strength: this.strength, side: this.side } };
  }

  /** Tests: the world-space centre of a visible button, or null. */
  buttonWorld(id: string): THREE.Vector3 | null {
    for (const panel of this.interactive()) {
      const button = this.buttonsOf(panel).find((candidate) => candidate.id === id);
      if (!button) continue;
      const [x, y, width, height] = button.rect;
      panel.mesh.updateWorldMatrix(true, false);
      return panel.mesh.localToWorld(new THREE.Vector3(x + width / 2 - panel.width / 2, panel.height / 2 - (y + height / 2), 0));
    }
    return null;
  }

  /** Look-dev: every visible panel as a PNG data URL. */
  snapshots(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, panel] of Object.entries(this.panels)) if (panel.visible) out[name] = panel.snapshot();
    return out;
  }

  dispose(): void {
    for (const off of this.unsubscribe.splice(0)) off();
    for (const panel of Object.values(this.panels)) panel.dispose();
    this.group.removeFromParent();
  }

  // ------------------------------------------------------------------ inner

  private interactive(): CanvasPanel[] {
    return (Object.values(this.panels) as CanvasPanel[]).filter((panel) => panel.visible);
  }

  private readonly buttonCache = new WeakMap<CanvasPanel, PanelButton[]>();

  private buttonsOf(panel: CanvasPanel): PanelButton[] {
    return this.buttonCache.get(panel) ?? [];
  }

  private setPanel(panel: CanvasPanel, content: Parameters<CanvasPanel["set"]>[0], animate = false): void {
    this.buttonCache.set(panel, content.buttons);
    panel.set(content, animate);
  }

  /** Hover on a panel's button, with a soft blip as it moves onto a new one. */
  private setHover(panel: CanvasPanel, id: string | null): void {
    if (id !== null) {
      // Once per button reached: a hover that flickers off and back for a
      // frame or two (a fingertip at the edge of the poke volume) stays quiet.
      const now = performance.now() / 1000;
      const last = this.hovered.get(panel);
      if (!last || last.id !== id || now - last.at > HOVER_QUIET_S) audio.blip("hover");
      this.hovered.set(panel, { id, at: now });
    }
    panel.setHover(id);
  }

  private press(panel: CanvasPanel, id: string): void {
    panel.flash(id);
    const crown = promotionKindOf(id);
    if (crown) {
      // The engine sounds the choice itself.
      this.actions.promote(crown);
      return;
    }
    audio.blip("press");
    if (id !== "exit" && this.exitArmedUntil > 0) this.disarmExit();
    switch (id) {
      case "skip":
        this.coach.skip();
        break;
      case "undo":
        this.actions.undo();
        break;
      case "menu":
        this.menuOpen = !this.menuOpen;
        if (this.menuOpen) this.seedMenu();
        this.showMenu();
        break;
      case "close":
        this.menuOpen = false;
        this.showMenu();
        break;
      case "easy":
      case "medium":
      case "hard":
        this.strength = id;
        this.showMenu();
        break;
      case "side-w":
      case "side-b":
        this.side = id === "side-w" ? "w" : "b";
        this.showMenu();
        break;
      case "new":
      case "rematch":
        // A rematch is the game just played again, whatever the menu last showed.
        if (id === "rematch") this.seedMenu();
        this.menuOpen = false;
        this.showMenu();
        this.panels.result.visible = false;
        this.panels.share.visible = false;
        this.playerMoved = false;
        this.actions.newGame({ difficulty: this.strength, playerColor: this.side });
        break;
      case "arena":
        // The label follows once the shell has applied the new map (see update).
        this.actions.cycleArena();
        break;
      case "replace":
        this.menuOpen = false;
        this.showMenu();
        this.actions.replace();
        break;
      case "howto":
        this.menuOpen = false;
        this.showMenu();
        this.playerMoved = false;
        this.coach.replay();
        break;
      case "sound":
        this.actions.setSound({ sound: !this.actions.sound().sound });
        break;
      case "music":
        this.actions.setSound({ music: !this.actions.sound().music });
        break;
      case "raise":
      case "lower":
        this.actions.nudgeHeight(id === "raise" ? 1 : -1);
        break;
      case "exit":
        // Leaving is one tap too easy to make by accident: the second tap, within 3 s, leaves.
        if (performance.now() / 1000 <= this.exitArmedUntil) {
          this.exitArmedUntil = 0;
          this.actions.exit();
        } else {
          this.exitArmedUntil = performance.now() / 1000 + EXIT_CONFIRM_S;
          this.redrawExit();
        }
        break;
      case "share":
        this.showShare();
        break;
      case "share-back":
        this.panels.share.visible = false;
        this.panels.result.visible = true;
        break;
      default:
        break;
    }
  }

  private showCoach(step: CoachStep, pointer: Pointer): void {
    this.coachStep = step;
    this.pointer = pointer;
    const panel = this.panels.coach;
    panel.visible = step !== "none";
    if (step === "none") return;
    const lesson = step === "first-move" || step === "two-hands";
    const buttons: PanelButton[] = lesson
      ? [{ id: "skip", rect: [panel.width - 0.064, panel.height / 2 - 0.017, 0.052, 0.034], label: "Skip" }]
      : [];
    this.setPanel(
      panel,
      {
        lines: [{ text: coachCopy(step, pointer), size: 0.016, y: panel.height / 2, align: "left" }],
        buttons,
        draw: (ctx, time) => drawGesture(ctx, step, pointer, time, panel.width - (lesson ? 0.095 : 0.045), panel.height / 2),
      },
      true,
    );
  }

  private refreshStatus(): void {
    const snapshot = this.controller.getSnapshot();
    const key = [snapshot.status, snapshot.turn, snapshot.thinking, snapshot.inCheck, snapshot.canUndo, this.menuOpen, this.promoting].join("|");
    if (key === this.statusKey) return;
    this.statusKey = key;
    const panel = this.panels.slab;
    const status = statusText(snapshot);
    this.setPanel(panel, {
      lines: [{ text: status.text, size: 0.012, y: 0.02, color: status.color }],
      buttons: slabButtons({ canUndo: snapshot.canUndo && this.promoting === null, menuOpen: this.menuOpen }),
    });
  }

  /** The menu opens on the game being played: its strength and the player's side. */
  private seedMenu(): void {
    const snapshot = this.controller.getSnapshot();
    if (snapshot.mode !== "ai") return;
    this.strength = snapshot.difficulty;
    this.side = snapshot.playerColor;
  }

  private showMenu(): void {
    const panel = this.panels.menu;
    panel.visible = this.menuOpen;
    this.statusKey = ""; // the Menu button shows its state
    if (!this.menuOpen) return;
    const { state, key } = this.menuState();
    this.menuKey = key;
    this.setPanel(panel, {
      lines: menuLines(state).map((line) => ({ ...line, color: line.color ?? UI.muted })),
      buttons: menuButtons(state),
    });
  }

  /** What the menu shows now, and a key that changes whenever any of it does. */
  private menuState(): { state: MenuState; key: string } {
    const sound = this.actions.sound();
    const state: MenuState = {
      strength: this.strength,
      side: this.side,
      arena: this.actions.arenaLabel(),
      sound: sound.sound,
      music: sound.music,
      heightCm: Math.round(this.actions.height() * 100),
      exitArmed: this.exitArmedUntil > 0,
    };
    return { state, key: Object.values(state).join("|") };
  }

  private disarmExit(): void {
    this.exitArmedUntil = 0;
    this.redrawExit();
  }

  /** Exit's label changed: redraw the cards that carry it. */
  private redrawExit(): void {
    if (this.menuOpen) this.showMenu();
    if (this.resultShown && this.panels.result.visible) this.showResult();
  }

  /** The crown card: shown while a pawn of `color` waits on the last rank, hidden at null. */
  private showPromotion(color: Faction | null): void {
    this.promoting = color;
    this.statusKey = ""; // Undo waits for the choice
    const panel = this.panels.promote;
    panel.visible = color !== null;
    if (color === null) return;
    this.setPanel(panel, {
      lines: [{ text: "Promote your pawn to", size: 0.011, y: 0.017, color: color === "w" ? UI.azure : UI.ember }],
      buttons: promotionButtons(),
    });
  }

  private showResult(): void {
    const snapshot = this.controller.getSnapshot();
    if (!snapshot.result) return;
    const panel = this.panels.result;
    const won = snapshot.mode === "ai" && snapshot.result.winner === snapshot.playerColor;
    const headline = snapshot.result.winner === null ? "Draw" : snapshot.mode !== "ai" ? "Checkmate" : won ? "Victory" : "Defeat";
    const stats = storage() ? loadStats(storage() as Storage) : null;
    const record =
      stats && snapshot.mode === "ai"
        ? `${stats.total.wins}W · ${stats.total.losses}L · ${stats.total.draws}D${
            stats.streak > 1 ? ` · ${stats.streak} in a row` : ""
          }${winRate(stats.total) !== null ? ` · ${winRate(stats.total)}%` : ""}`
        : "";
    this.setPanel(panel, {
      lines: [
        { text: headline.toUpperCase(), size: 0.022, y: 0.03, font: "display", color: won ? UI.gold : UI.text },
        { text: record, size: 0.01, y: 0.061, color: UI.muted },
      ],
      buttons: [
        { id: "rematch", rect: [0.016, 0.08, 0.12, 0.036], label: "Rematch", tone: "primary" },
        { id: "exit", rect: [0.148, 0.08, 0.12, 0.036], label: this.exitArmedUntil > 0 ? "Really exit?" : "Exit" },
        { id: "share", rect: [0.016, 0.128, 0.252, 0.032], label: "Share this battle" },
      ],
    });
    panel.visible = true;
    this.resultShown = true;
  }

  /** The replay link as a QR code a phone can scan, in place of the result card. */
  private showShare(): void {
    const panel = this.panels.share;
    const content = drawShareCard();
    if (!content) return;
    this.setPanel(panel, content);
    this.panels.result.visible = false;
    panel.visible = true;
  }

  /**
   * Puts each panel around the board. A card for reading turns to face the
   * player once, as it appears, then stays put with the board (it does not
   * swim after the head); the slab lies tilted on the table.
   */
  private layout(rig: TableRig, mr: CoachInput["mr"]): void {
    const half = BOARD_HALF_UNITS * rig.unitsToMeters;
    rig.root.updateMatrixWorld(true);
    for (const panel of this.facing.keys()) if (!panel.visible || mr === "placing") this.facing.delete(panel);
    const place = (panel: CanvasPanel, local: THREE.Vector3, face: "player" | "tilt"): void => {
      const world = local.applyMatrix4(rig.root.matrixWorld);
      panel.mesh.position.copy(world);
      if (face === "player") {
        let turn = this.facing.get(panel);
        if (!turn && panel.visible) {
          // Face the eyes, upright: yaw and pitch, never roll. Kept relative to
          // the board, so carrying or turning the board carries the card.
          panel.mesh.lookAt(this.head);
          turn = rig.root.quaternion.clone().invert().multiply(panel.mesh.quaternion);
          this.facing.set(panel, turn);
        }
        if (turn) panel.mesh.quaternion.multiplyQuaternions(rig.root.quaternion, turn);
      } else {
        panel.mesh.rotation.set(-0.9, rig.root.rotation.y, 0, "YXZ");
      }
    };

    if (mr === "placing") {
      // No board yet: the card tags along 70 cm ahead, a little below the eyes,
      // easing after the gaze rather than glued to it (never head-locked).
      const target = this.scratch.set(-Math.sin(this.headYaw) * 0.7, -0.12, -Math.cos(this.headYaw) * 0.7).add(this.head);
      const coach = this.panels.coach.mesh;
      if (coach.position.lengthSq() === 0) coach.position.copy(target);
      else coach.position.lerp(target, 0.06);
      coach.lookAt(this.head);
      return;
    }
    place(this.panels.coach, new THREE.Vector3(0, 0.11, -half - 0.03), "player");
    place(this.panels.slab, new THREE.Vector3(half + 0.11, 0.02, half - 0.06), "tilt");
    place(this.panels.perf, new THREE.Vector3(-half - 0.11, 0.02, half - 0.06), "tilt");
    // Behind and above the slab, so the open card never stands between the eyes (or a ray) and the slab's Menu button.
    place(this.panels.menu, new THREE.Vector3(half + 0.15, 0.22, half - 0.2), "player");
    place(this.panels.result, new THREE.Vector3(0, 0.16, 0), "player");
    // On the player's edge of the board, low: in poke reach, clear of the far rank where the pawn stands.
    place(this.panels.promote, new THREE.Vector3(0, 0.07, half + 0.05), "player");
    place(this.panels.share, new THREE.Vector3(0, 0.2, 0), "player");
  }
}

function statusText(snapshot: GameSnapshot): { text: string; color: string } {
  if (snapshot.status === "over") return { text: "Game over", color: UI.muted };
  if (snapshot.inCheck && snapshot.turn === snapshot.playerColor) return { text: "Check!", color: UI.danger };
  if (snapshot.mode === "ai" && snapshot.turn !== snapshot.playerColor) return { text: snapshot.thinking ? "Thinking…" : "Their move", color: UI.muted };
  return { text: "Your move", color: snapshot.turn === "w" ? UI.azure : UI.ember };
}

/**
 * The gesture glyph beside a hint: a thumb and finger closing (pinch) or a
 * controller's trigger pulling, a looking eye, or two hands (or two
 * controllers) spreading. Drawn with lines; show, don't tell.
 */
function drawGesture(ctx: CanvasRenderingContext2D, step: CoachStep, pointer: Pointer, time: number, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = UI.gold;
  ctx.fillStyle = UI.gold;
  ctx.lineCap = "round";
  ctx.lineWidth = 0.0022;
  const cycle = (Math.sin(time * 3) + 1) / 2;
  if (step === "find-table") {
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.014, 0.008, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 0.0035 + cycle * 0.0012, 0, Math.PI * 2);
    ctx.fill();
  } else if (step === "two-hands") {
    const spread = 0.008 + cycle * 0.006;
    for (const side of [-1, 1]) {
      if (pointer === "controllers") drawController(ctx, side * spread, 0, 1, side, "grip");
      else drawPinch(ctx, side * spread, 0, 0.6, side);
    }
    ctx.beginPath();
    ctx.moveTo(-spread + 0.004, 0.012);
    ctx.lineTo(spread - 0.004, 0.012);
    ctx.stroke();
  } else if (pointer === "controllers") {
    drawController(ctx, 0, 0, cycle, 1, "trigger");
  } else {
    drawPinch(ctx, 0, 0, cycle, 1);
  }
  ctx.restore();
}

/**
 * A Touch controller in profile: the tracking ring on top, the handle below,
 * and the button the hint is about (trigger in front, grip behind) lit as
 * it is pressed.
 */
function drawController(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pressed: number,
  side: number,
  button: "trigger" | "grip",
): void {
  ctx.beginPath();
  ctx.ellipse(x, y - 0.009, 0.007, 0.005, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 0.0035 * side, y - 0.005);
  ctx.quadraticCurveTo(x - 0.004 * side, y + 0.008, x - 0.001 * side, y + 0.016);
  ctx.moveTo(x + 0.0035 * side, y - 0.005);
  ctx.quadraticCurveTo(x + 0.0045 * side, y + 0.008, x + 0.002 * side, y + 0.016);
  ctx.stroke();
  // The button: a short stroke that sinks into the body as it is pressed.
  const front = button === "trigger" ? 1 : -1;
  const travel = 0.0025 * (1 - pressed);
  ctx.beginPath();
  ctx.moveTo(x + front * (0.0045 + travel) * side, y - 0.001);
  ctx.lineTo(x + front * (0.0045 + travel) * side, y + 0.004);
  ctx.globalAlpha = 0.4 + 0.6 * pressed;
  ctx.lineWidth = 0.003;
  ctx.stroke();
  ctx.lineWidth = 0.0022;
  ctx.globalAlpha = 1;
}

function drawPinch(ctx: CanvasRenderingContext2D, x: number, y: number, closed: number, side: number): void {
  const gap = 0.008 * (1 - closed) + 0.0015;
  ctx.beginPath();
  // index finger, from the knuckle down to the tip
  ctx.moveTo(x - 0.004 * side, y - 0.016);
  ctx.quadraticCurveTo(x + 0.006 * side, y - 0.012, x + 0.004 * side, y - gap);
  // thumb, from below up to its tip
  ctx.moveTo(x - 0.006 * side, y + 0.014);
  ctx.quadraticCurveTo(x + 0.006 * side, y + 0.012, x + 0.004 * side, y + gap);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + 0.004 * side, y, 0.0016 + (1 - closed) * 0.0004, 0, Math.PI * 2);
  ctx.globalAlpha = closed;
  ctx.fill();
  ctx.globalAlpha = 1;
}
