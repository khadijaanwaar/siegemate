import * as THREE from "three";

import type { GameController } from "../../core/gameController";
import { loadStats, winRate } from "../../core/stats";
import type { Difficulty, Faction, GameSnapshot } from "../../core/types";
import type { TableRig } from "../tableRig";
import { CanvasPanel, type PanelButton } from "./canvasPanel";
import { Coach, type CoachInput, type CoachStep } from "./coach";
import { UI } from "./palette";
import { PokeTracker } from "./poke";

/** The board base's half width in game units, with its trim. */
const BOARD_HALF_UNITS = 4.92;
const ONBOARDED_KEY = "mr-chess:onboarded";
const STRENGTHS: { id: Difficulty; label: string }[] = [
  { id: "easy", label: "Squire" },
  { id: "medium", label: "Knight" },
  { id: "hard", label: "Warlord" },
];

export interface TableUiActions {
  newGame(config: { difficulty: Difficulty; playerColor: Faction }): void;
  undo(): void;
  replace(): void;
  exit(): void;
  cycleArena(): void;
  arenaLabel(): string;
}

type PanelName = "coach" | "slab" | "menu" | "result" | "perf";

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
 * side, re-place, how to play, exit) and a result card at the end. All panels
 * are world-locked around the board and face the player without roll.
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
  private menuOpen = false;
  private resultShown = false;
  private pendingResult = false;
  private onboarded = readFlag(ONBOARDED_KEY);
  private playerMoved = false;
  private statusKey = "";
  private strength: Difficulty = "medium";
  /** The battleground name the menu was last drawn with. */
  private menuArena = "";
  private side: Faction = "w";
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
      slab: new CanvasPanel(0.17, 0.085),
      menu: new CanvasPanel(0.26, 0.236),
      result: new CanvasPanel(0.28, 0.13),
      perf: new CanvasPanel(0.17, 0.05),
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
      }),
    );
  }

  /** Called every headset frame. `headYaw` is where the player faces (0 = -Z). */
  update(
    now: number,
    input: Omit<CoachInput, "onboarded" | "playerMoved" | "now">,
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
    if (step !== this.coachStep) this.showCoach(step);

    const playing = input.mr === "playing";
    if (this.menuOpen && this.actions.arenaLabel() !== this.menuArena) this.showMenu();
    this.panels.slab.visible = playing;
    if (playing) this.refreshStatus();
    if (this.pendingResult && playing) {
      this.pendingResult = false;
      this.showResult();
    }
    if (!playing) {
      this.panels.menu.visible = false;
      this.panels.result.visible = false;
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
    if (best) best.panel.setHover(tracker.hovered);
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
    for (const panel of this.interactive()) panel.setHover(target && target.panel === panel ? (target.button?.id ?? null) : null);
  }

  pressTarget(target: { panel: CanvasPanel; button: PanelButton | null }): void {
    if (target.button) this.press(target.panel, target.button.id);
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

  /** Tests and diagnostics: what is on show. */
  describe(): { coach: CoachStep; panels: PanelName[] } {
    const panels = (Object.keys(this.panels) as PanelName[]).filter((name) => this.panels[name].visible);
    return { coach: this.coachStep, panels };
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

  private press(panel: CanvasPanel, id: string): void {
    panel.flash(id);
    switch (id) {
      case "skip":
        this.coach.skip();
        break;
      case "undo":
        this.actions.undo();
        break;
      case "menu":
        this.menuOpen = !this.menuOpen;
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
        this.menuOpen = false;
        this.showMenu();
        this.panels.result.visible = false;
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
      case "exit":
        this.actions.exit();
        break;
      default:
        break;
    }
  }

  private showCoach(step: CoachStep): void {
    this.coachStep = step;
    const panel = this.panels.coach;
    panel.visible = step !== "none";
    if (step === "none") return;
    const copy: Record<Exclude<CoachStep, "none">, string> = {
      "find-table": "Look at your table",
      place: "Pinch to place",
      "first-move": "Pinch a soldier, drop on a glow",
      "two-hands": "Two hands: move · resize",
    };
    const lesson = step === "first-move" || step === "two-hands";
    const buttons: PanelButton[] = lesson
      ? [{ id: "skip", rect: [panel.width - 0.064, panel.height / 2 - 0.017, 0.052, 0.034], label: "Skip" }]
      : [];
    this.setPanel(
      panel,
      {
        lines: [{ text: copy[step], size: 0.016, y: panel.height / 2, align: "left" }],
        buttons,
        draw: (ctx, time) => drawGesture(ctx, step, time, panel.width - (lesson ? 0.095 : 0.045), panel.height / 2),
      },
      true,
    );
  }

  private refreshStatus(): void {
    const snapshot = this.controller.getSnapshot();
    const key = [snapshot.status, snapshot.turn, snapshot.thinking, snapshot.inCheck, snapshot.canUndo, this.menuOpen].join("|");
    if (key === this.statusKey) return;
    this.statusKey = key;
    const panel = this.panels.slab;
    const status = statusText(snapshot);
    this.setPanel(panel, {
      lines: [{ text: status.text, size: 0.012, y: 0.02, color: status.color }],
      buttons: [
        { id: "undo", rect: [0.012, 0.04, 0.068, 0.034], label: "Undo", disabled: !snapshot.canUndo },
        { id: "menu", rect: [0.09, 0.04, 0.068, 0.034], label: "Menu", tone: this.menuOpen ? "selected" : "plain" },
      ],
    });
  }

  private showMenu(): void {
    const panel = this.panels.menu;
    panel.visible = this.menuOpen;
    this.statusKey = ""; // the Menu button shows its state
    if (!this.menuOpen) return;
    this.menuArena = this.actions.arenaLabel();
    const third = (panel.width - 0.04) / 3;
    const buttons: PanelButton[] = [
      ...STRENGTHS.map((strength, index) => ({
        id: strength.id,
        rect: [0.014 + index * (third + 0.006), 0.034, third, 0.03] as [number, number, number, number],
        label: strength.label,
        tone: this.strength === strength.id ? ("selected" as const) : ("plain" as const),
      })),
      { id: "side-w", rect: [0.014, 0.072, 0.11, 0.03], label: "Play white", tone: this.side === "w" ? "selected" : "plain" },
      { id: "side-b", rect: [0.136, 0.072, 0.11, 0.03], label: "Play black", tone: this.side === "b" ? "selected" : "plain" },
      { id: "arena", rect: [0.014, 0.11, panel.width - 0.028, 0.03], label: `Battleground · ${this.actions.arenaLabel()}` },
      { id: "new", rect: [0.014, 0.148, panel.width - 0.028, 0.034], label: "New game", tone: "primary" },
      { id: "replace", rect: [0.014, 0.19, 0.072, 0.03], label: "Re-place" },
      { id: "howto", rect: [0.094, 0.19, 0.072, 0.03], label: "How to" },
      { id: "exit", rect: [0.174, 0.19, 0.072, 0.03], label: "Exit", tone: "danger" },
    ];
    this.setPanel(panel, {
      lines: [{ text: "Strength", size: 0.009, y: 0.02, color: UI.muted }],
      buttons,
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
        { id: "exit", rect: [0.144, 0.08, 0.12, 0.036], label: "Exit" },
      ],
    });
    panel.visible = true;
    this.resultShown = true;
  }

  /** Puts each panel around the board, facing the player. */
  private layout(rig: TableRig, mr: CoachInput["mr"]): void {
    const half = BOARD_HALF_UNITS * rig.unitsToMeters;
    rig.root.updateMatrixWorld(true);
    const place = (panel: CanvasPanel, local: THREE.Vector3, face: "player" | "tilt"): void => {
      const world = local.applyMatrix4(rig.root.matrixWorld);
      panel.mesh.position.copy(world);
      if (face === "player") {
        // Face the eyes, upright: yaw and pitch, never roll.
        panel.mesh.lookAt(this.head);
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
    place(this.panels.menu, new THREE.Vector3(half + 0.13, 0.16, half - 0.12), "player");
    place(this.panels.result, new THREE.Vector3(0, 0.16, 0), "player");
  }
}

function statusText(snapshot: GameSnapshot): { text: string; color: string } {
  if (snapshot.status === "over") return { text: "Game over", color: UI.muted };
  if (snapshot.inCheck && snapshot.turn === snapshot.playerColor) return { text: "Check!", color: UI.danger };
  if (snapshot.mode === "ai" && snapshot.turn !== snapshot.playerColor) return { text: snapshot.thinking ? "Thinking…" : "Their move", color: UI.muted };
  return { text: "Your move", color: snapshot.turn === "w" ? UI.azure : UI.ember };
}

/**
 * The gesture glyph beside a hint: a thumb and finger closing (pinch), a
 * looking eye, or two hands spreading. Drawn with lines; show, don't tell.
 */
function drawGesture(ctx: CanvasRenderingContext2D, step: CoachStep, time: number, x: number, y: number): void {
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
    for (const side of [-1, 1]) drawPinch(ctx, side * spread, 0, 0.6, side);
    ctx.beginPath();
    ctx.moveTo(-spread + 0.004, 0.012);
    ctx.lineTo(spread - 0.004, 0.012);
    ctx.stroke();
  } else {
    drawPinch(ctx, 0, 0, cycle, 1);
  }
  ctx.restore();
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
