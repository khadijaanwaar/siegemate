/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks (window.__xr, __iwer) are untyped test globals */
// What a shot is, and the runtime that records one: an unrecorded setup that gets the game where the
// shot starts, then a recorded play() that moves the camera, the hands and the game on the 60 Hz
// frame clock. Modelled on Shadow Locks' tests/video/lib/shot.ts (same author family).
import type { Page } from "playwright";

import type { RoomSpec } from "./boot.ts";
import { CameraTrack, type Ease, fovyFor, minimumJerk, type Quat, type Sway, type View } from "./camera.ts";
import { HandTrack, type P3, rotate } from "./hands.ts";
import { filmCompose, filmFrame, type FrameArgs, type FrameResult, installTap } from "./page.ts";

export type Side = "left" | "right";

/** The game's simulation rate: always 60 Hz, whatever the capture rate, so drafts and finals time alike. */
export const SIM_HZ = 60;
export const EMULATOR_LABEL = "Emulator capture · simulated room";

export interface Shot<S = unknown> {
  name: string;
  /** One line on what the viewer sees. */
  description: string;
  /** About how long the shot runs, seconds (progress lines). */
  seconds: number;
  /** Set while the shot waits on work in another lane: what it needs. It still renders when named. */
  needs?: string;
  /** localStorage before the app loads (default: onboarded, so the first-move lesson is skipped). */
  storage?: Record<string, string>;
  /** Scripted computer replies, UCI (e.g. "e7e5"), in order; the real engine plays any after them. */
  replies?: string[];
  room?: RoomSpec;
  seed?: number;
  /** Corner label (default EMULATOR_LABEL; null for none). */
  label?: string | null;
  sway?: Sway;
  /** Unrecorded: get the game, hands and board where the shot starts. */
  setup(ctx: ShotContext): Promise<S>;
  /** The camera on the first recorded frame. */
  firstView(data: S): View;
  /** Recorded. */
  play(ctx: ShotContext, data: S): Promise<void>;
}

export const defineShot = <S>(shot: Shot<S>): Shot<S> => shot;

export interface ShotEvent {
  t: number;
  frame: number;
  type: string;
  [key: string]: unknown;
}

export interface Encoder {
  write(image: Buffer): Promise<void>;
}

export interface RecordOptions {
  width: number;
  height: number;
  /** Capture every `stride`-th simulated frame (60 / fps). */
  stride: number;
  hfovDeg: number;
  format: "image/png" | "image/jpeg";
  handLook: { fill: number; rim: number };
  log(line: string): void;
}

interface Calibration {
  /** Pinch point (thumb and index tips together, the point pose pinched) from the hand, at rest orientation. */
  pinch: P3;
  /** Index fingertip from the wrist in the point pose. */
  tip: P3;
}

/** Where a hand is parked when it should be out of view: low, at the side. */
const PARK: Record<Side, P3> = { left: [-0.45, 0.35, 0.1], right: [0.45, 0.35, 0.1] };

/** A hand as a shot drives it: moves are scheduled on its track and recorded as they run. */
export class ShotHand {
  readonly side: Side;
  private readonly ctx: ShotContext;
  constructor(side: Side, ctx: ShotContext) {
    this.side = side;
    this.ctx = ctx;
  }
  private get track(): HandTrack {
    return this.ctx.tracks[this.side];
  }
  private now(): number {
    return this.ctx.time();
  }
  /** The wrist position that puts the hand's `anchor` on `target` with orientation `q`. */
  wristFor(target: P3, q: Quat, anchor: "pinch" | "tip" = "pinch"): P3 {
    const cal = this.ctx.calibration[this.side];
    if (!cal) throw new Error("hands are not calibrated yet (enter mixed reality first)");
    const off = rotate(q, anchor === "pinch" ? cal.pinch : cal.tip);
    return [target[0] - off[0], target[1] - off[1], target[2] - off[2]];
  }
  /** Where the anchor is now. */
  anchorAt(anchor: "pinch" | "tip" = "pinch"): P3 {
    const cal = this.ctx.calibration[this.side]!;
    const t = this.now();
    const off = rotate(this.track.quaternion(t), anchor === "pinch" ? cal.pinch : cal.tip);
    const p = this.track.position(t);
    return [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
  }
  /** Jump (no frames): the anchor to `target`, or the wrist out of view. */
  place(target: P3 | "parked", q: Quat = [0, 0, 0, 1], anchor: "pinch" | "tip" = "pinch"): void {
    const t = this.now();
    const p = target === "parked" ? PARK[this.side] : this.wristFor(target, q, anchor);
    this.track.moveTo(t, p, 0);
    this.track.turnTo(t, q, 0);
  }
  /** Start an eased move of the anchor to `target` (and a turn to `q`); returns at once. */
  moveTo(target: P3, ms: number, o: { q?: Quat; anchor?: "pinch" | "tip"; ease?: Ease } = {}): void {
    const t = this.now();
    const q = o.q ?? this.track.quaternion(t);
    this.track.moveTo(t, this.wristFor(target, q, o.anchor), ms, o.ease);
    if (o.q) this.track.turnTo(t, o.q, ms, o.ease);
  }
  /** Move the anchor to `target` over `ms` and wait for it. */
  async glide(target: P3, ms: number, o: { q?: Quat; anchor?: "pinch" | "tip"; ease?: Ease } = {}): Promise<void> {
    this.moveTo(target, ms, o);
    await this.ctx.wait(ms);
  }
  /** Carry the anchor along `path(k)` (k 0..1, eased) over `ms`, orientation held. */
  async follow(path: (k: number) => P3, ms: number, anchor: "pinch" | "tip" = "pinch"): Promise<void> {
    const t = this.now();
    const q = this.track.quaternion(t);
    this.track.follow(t, (k) => this.wristFor(path(k), q, anchor), ms);
    await this.ctx.wait(ms);
  }
  /** An arc from the anchor's place now to `to`, `lift` metres above the straight line at its middle. */
  async arc(to: P3, ms: number, lift = 0.04, anchor: "pinch" | "tip" = "pinch"): Promise<void> {
    const from = this.anchorAt(anchor);
    await this.follow((k) => [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k + lift * 4 * k * (1 - k), from[2] + (to[2] - from[2]) * k], ms, anchor);
  }
  async turn(q: Quat, ms: number): Promise<void> {
    this.track.turnTo(this.now(), q, ms);
    await this.ctx.wait(ms);
  }
  /** Close thumb and index over `ms`. */
  async pinch(ms = 180): Promise<void> {
    this.track.pinchTo(this.now(), 1, ms);
    await this.ctx.wait(ms);
  }
  /** Open them again. */
  async open(ms = 200): Promise<void> {
    this.track.pinchTo(this.now(), 0, ms);
    await this.ctx.wait(ms);
  }
  /** Change pose (IWER pose id) over `ms`, without waiting. */
  pose(pose: string, ms = 220): void {
    this.track.setPose(this.now(), pose, ms);
  }
  show(shown: boolean): void {
    this.track.show(this.now(), shown);
  }
  /**
   * Poke a headset button with the index fingertip: point, come in to 6 cm in front of it, press
   * through and back out. The button's face is taken to look at the eye.
   */
  async poke(id: string, o: { q?: Quat; approachMs?: number } = {}): Promise<void> {
    const at = await this.ctx.game.button(id);
    if (!at) throw new Error(`no headset button "${id}" on show`);
    const eye = this.ctx.camera.view().from;
    const n = norm([eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]]);
    const along = (k: number): P3 => [at[0] + n[0] * k, at[1] + n[1] * k, at[2] + n[2] * k];
    this.pose("point", 200);
    await this.glide(along(0.06), o.approachMs ?? 700, { q: o.q, anchor: "tip" });
    this.ctx.mark("poke", { button: id });
    await this.glide(along(-0.012), 220, { anchor: "tip" });
    await this.glide(along(0.06), 260, { anchor: "tip" });
  }
}

const norm = (v: P3): P3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Game hooks (window.__xr, test builds), as the shots use them. */
export class Game {
  private readonly ctx: ShotContext;
  constructor(ctx: ShotContext) {
    this.ctx = ctx;
  }
  private get page(): Page {
    return this.ctx.page;
  }
  snapshot(): Promise<{ fen: string; sanList: string[]; busy: boolean; thinking: boolean; turn: string; status: string; result: unknown }> {
    return this.page.evaluate(() => (window as any).__xr.snapshot());
  }
  ui(): Promise<{ coach: string; panels: string[] }> {
    return this.page.evaluate(() => (window as any).__xr.ui());
  }
  state(): Promise<string> {
    return this.page.evaluate(() => String((window as any).__xr.state()));
  }
  /** A square's centre on the board, world metres, `lift` above it. */
  async square(square: string, lift = 0): Promise<P3> {
    const p = await this.page.evaluate((s) => (window as any).__xr.squareWorld(s), square);
    if (!p) throw new Error(`no square ${square}`);
    return [p.x, p.y + lift, p.z];
  }
  async button(id: string): Promise<P3 | null> {
    const p = await this.page.evaluate((b) => (window as any).__xr.buttonWorld(b), id);
    return p ? [p.x, p.y, p.z] : null;
  }
  /** Press a headset button without a hand (setup). */
  press(id: string): Promise<boolean> {
    return this.page.evaluate((b) => Boolean((window as any).__xr.press(b)), id);
  }
  /** Queue scripted computer replies (UCI). */
  reply(...uci: string[]): Promise<void> {
    return this.page.evaluate((m) => void (window as any).__filmReplies.push(...m), uci);
  }
  /** Wait until no move is animating and the computer is not thinking. */
  async settle(maxMs = 20_000): Promise<void> {
    await this.ctx.waitFor(() => {
      const s = (window as any).__xr.snapshot();
      return !s.busy && !s.thinking;
    }, undefined, { maxMs, label: "the board at rest" });
  }
  /**
   * Play `uci` for the player through the game's own move path (no hand; setup), then let the
   * scripted reply (if `reply` is given) land and everything settle.
   */
  async play(uci: string, reply?: string): Promise<void> {
    if (reply) await this.reply(reply);
    const before = (await this.snapshot()).sanList.length;
    await this.page.evaluate((m) => void (window as any).__xr.move(m.slice(0, 2), m.slice(2, 4)), uci);
    const want = before + (reply ? 2 : 1);
    await this.ctx.waitFor((n) => (window as any).__xr.snapshot().sanList.length >= n, want, { maxMs: 30_000, label: `${uci} ${reply ?? ""} played` });
    await this.settle();
  }
  /**
   * Enter mixed reality (the game's own enter), on the frame clock, and get ready to film: the
   * film's frame tap and the hands' calibration. The head should look away from the table (no
   * reticle yet) unless `place` follows at once.
   */
  async enter(): Promise<void> {
    await this.page.evaluate(() => {
      const w = window as any;
      w.__filmEntering = w.__xr.enter().catch((e: unknown) => (w.__filmEnterError = String(e)));
    });
    await this.entered();
  }
  /** The menu's own "Play on your table" button, as a player taps it. */
  async enterFromMenu(): Promise<void> {
    const ok = await this.page.evaluate(() => {
      const b = document.querySelector<HTMLButtonElement>(".mc-menu-xr");
      b?.click();
      return Boolean(b);
    });
    if (!ok) throw new Error('no "Play on your table" button on the menu (is mixed reality offered?)');
    await this.entered();
  }
  /** Where the menu's mixed reality button is on the page, CSS pixels (its centre). */
  menuButton(): Promise<{ x: number; y: number } | null> {
    return this.page.evaluate(() => {
      const r = document.querySelector(".mc-menu-xr")?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
  }
  private async entered(): Promise<void> {
    await this.ctx.waitFor(() => (window as any).__xr.state() !== "starting" && (window as any).__xr.state() !== "off", undefined, { maxMs: 10_000, label: "mixed reality started" });
    if (!(await this.page.evaluate(installTap))) throw new Error("no XR session to tap");
    await this.ctx.calibrate();
  }
  /**
   * Setup: look at the table until the reticle finds it, pinch to put the board down, wait until it
   * stands. `view` is where the head looks meanwhile.
   */
  async place(view: View): Promise<void> {
    this.ctx.camera.cut(view);
    await this.ctx.waitFor(() => (window as any).__xr.placement() === "aiming", undefined, { maxMs: 3500, label: "the reticle on the table" });
    const right = this.ctx.right;
    right.place([0.2, 0.75, -0.3]);
    await right.pinch(120);
    await this.ctx.waitFor(() => (window as any).__xr.state() === "playing", undefined, { maxMs: 2000, label: "the board placed" });
    await right.open(120);
    right.place("parked");
    await this.ctx.wait(100);
  }
}

/** Everything a shot's setup and play get. */
export class ShotContext {
  readonly page: Page;
  readonly o: RecordOptions;
  readonly events: ShotEvent[] = [];
  readonly setupEvents: ShotEvent[] = [];
  phase: "setup" | "play" = "setup";
  /** Simulated frames in this phase. */
  n = 0;
  camera: { cut(view: View): void; move(view: View, ms: number, ease?: Ease): void; view(): View };
  tracks: Record<Side, HandTrack>;
  calibration: Partial<Record<Side, Calibration>> = {};
  readonly right: ShotHand;
  readonly left: ShotHand;
  readonly game: Game;
  encoder: Encoder | null = null;
  label: string | null = null;
  readonly stats = { frames: 0, captured: 0, idleMs: 0, stepMs: 0, captureMs: 0, transferMs: 0, encodeMs: 0 };
  private track: CameraTrack;

  constructor(page: Page, o: RecordOptions, view: View, sway?: Sway) {
    this.page = page;
    this.o = o;
    this.track = new CameraTrack(view, { mm: 0, deg: 0 }, o.hfovDeg);
    this.tracks = { left: new HandTrack(PARK.left, [0, 0, 0, 1], "point"), right: new HandTrack(PARK.right, [0, 0, 0, 1], "point") };
    this.camera = this.cameraApi();
    this.right = new ShotHand("right", this);
    this.left = new ShotHand("left", this);
    this.game = new Game(this);
    this.sway = sway;
    // Shots destructure these from the context.
    this.wait = this.wait.bind(this);
    this.until = this.until.bind(this);
    this.waitFor = this.waitFor.bind(this);
    this.mark = this.mark.bind(this);
    this.time = this.time.bind(this);
    this.hand = this.hand.bind(this);
  }
  private sway?: Sway;

  private cameraApi() {
    return {
      cut: (view: View) => this.track.cut(this.time(), view),
      move: (view: View, ms: number, ease?: Ease) => this.track.move(this.time(), view, ms, ease),
      view: () => this.track.viewAt(this.time()),
    };
  }

  /** Shot time of the next frame, seconds. */
  time(): number {
    return this.n / SIM_HZ;
  }

  hand(side: Side): ShotHand {
    return side === "right" ? this.right : this.left;
  }

  /** A session is presenting (as of the last frame). */
  xr = false;
  /** The 2D page as a floating browser window (before mixed reality), with a pointer's cursor. */
  window: WindowState | null = null;

  /**
   * Show the 2D page as a browser window floating in the room, `width` metres wide, centred at
   * `center`, facing +Z; it fades in over `fadeMs`. The page is photographed every captured frame
   * until a session starts, then the last photograph stays (for a fade out).
   */
  showWindow(center: P3, width: number, fadeMs = 0): void {
    const h = (width * this.o.height) / this.o.width;
    const t = this.time();
    this.window = {
      tl: [center[0] - width / 2, center[1] + h / 2, center[2]],
      tr: [center[0] + width / 2, center[1] + h / 2, center[2]],
      bl: [center[0] - width / 2, center[1] - h / 2, center[2]],
      alpha: [{ t0: t, t1: t + fadeMs / 1000, from: fadeMs ? 0 : 1, to: 1 }],
      cursor: null,
    };
  }
  /** Fade the window out over `ms`. */
  hideWindow(ms: number): void {
    const win = this.window!;
    const t = this.time();
    win.alpha.push({ t0: t, t1: t + ms / 1000, from: at1(win.alpha, t, 0), to: 0 });
    if (win.cursor) win.cursor.alpha.push({ t0: t, t1: t + Math.min(ms, 150) / 1000, from: at1(win.cursor.alpha, t, 0), to: 0 });
  }
  /** A point on the window: `x`, `y` in page pixels. */
  windowPoint(x: number, y: number): P3 {
    const w = this.window!;
    const u = x / this.o.width, v = y / this.o.height;
    return [0, 1, 2].map((i) => w.tl[i]! + (w.tr[i]! - w.tl[i]!) * u + (w.bl[i]! - w.tl[i]!) * v) as P3;
  }
  /** Move the pointer's cursor on the window to `to` over `ms` (it appears where it starts). */
  cursorTo(to: P3, ms: number): void {
    const win = this.window!;
    const t = this.time();
    if (!win.cursor) {
      win.cursor = { path: [], alpha: [{ t0: t, t1: t + 0.15, from: 0, to: 1 }], pressed: [], at: (tt) => pathAt(win.cursor!.path, tt, to) };
      win.cursor.path.push({ t0: t, t1: t, from: to, to });
      return;
    }
    const from = win.cursor.at(t);
    win.cursor.path.push({ t0: t, t1: t + ms / 1000, from, to });
  }
  /** Press (true) or release the pointer, as drawn. */
  cursorPress(down: boolean): void {
    const c = this.window?.cursor;
    if (!c) return;
    const t = this.time();
    c.pressed.push({ t0: t, t1: t, from: down ? 1 : 0, to: down ? 1 : 0 });
  }

  /** From setup to recording: time restarts at 0 on `view`, hands carry on from where they are. */
  startPlay(view: View, encoder: Encoder, label: string | null): void {
    const t = this.time();
    this.tracks = { left: this.tracks.left.rebase(t), right: this.tracks.right.rebase(t) };
    this.track = new CameraTrack(view, this.sway ?? { mm: 1.5, deg: 0.12 }, this.o.hfovDeg);
    this.camera = this.cameraApi();
    this.phase = "play";
    this.n = 0;
    this.encoder = encoder;
    this.label = label;
  }

  /** Note a beat for the narration (also logged automatically: moves, captures, panels, pinches). */
  mark(type: string, data: Record<string, unknown> = {}): void {
    const e = { t: round(this.time()), frame: this.n, type, ...data };
    (this.phase === "play" ? this.events : this.setupEvents).push(e);
  }

  /** One simulated frame (recorded and captured when due). */
  async step(): Promise<FrameResult> {
    const t = this.time();
    const pose = this.track.poseAt(t);
    const hands: FrameArgs["hands"] = {};
    for (const side of ["left", "right"] as const) {
      const tr = this.tracks[side];
      hands[side] = { p: tr.position(t), q: tr.quaternion(t), pinch: tr.pinch(t), pose: tr.pose(t), poseK: tr.poseK(t), shown: tr.shown(t) };
    }
    const capture = this.phase === "play" && this.n % this.o.stride === 0;
    const win = this.window;
    // The 2D page in its window, live: step, photograph the page, then composite it over the room.
    const live = Boolean(capture && win && !this.xr);
    const args: FrameArgs = {
      dt: 1000 / SIM_HZ,
      head: { p: pose.position, q: pose.quaternion, fovy: fovyFor(this.track.hfovAt(t), this.o.width, this.o.height) },
      hands,
      capture,
      format: this.o.format,
      label: this.label,
      handLook: this.o.handLook,
      size: [this.o.width, this.o.height],
      panel: win ? { tl: win.tl, tr: win.tr, bl: win.bl, alpha: at1(win.alpha, t, 0) } : null,
      cursor: win?.cursor ? { at: win.cursor.at(t), alpha: at1(win.cursor.alpha, t, 0), pressed: at1(win.cursor.pressed, t, 0) > 0.5 } : null,
      composeLater: live,
    };
    const r0 = Date.now();
    const r = await this.page.evaluate(filmFrame, args);
    this.xr = r.xr;
    if (live) {
      const png = await this.page.screenshot({ type: "png" });
      await this.page.evaluate((b64) => (window as any).__filmPanelImage(b64), png.toString("base64"));
      const c0 = Date.now();
      r.img = await this.page.evaluate(filmCompose, args);
      r.captureMs = Date.now() - c0;
    }
    const roundTrip = Date.now() - r0;
    if (r.contextLost) throw new Error("the WebGL context was lost (another GPU test running?)");
    this.stats.frames++;
    this.stats.idleMs += r.idleMs;
    this.stats.stepMs += r.stepMs;
    for (const e of r.events) {
      const ev = { t: round(t), frame: this.n, ...e } as ShotEvent;
      (this.phase === "play" ? this.events : this.setupEvents).push(ev);
    }
    if (capture && r.img && this.encoder) {
      this.stats.captured++;
      this.stats.captureMs += r.captureMs;
      this.stats.transferMs += roundTrip - r.idleMs - r.stepMs - r.captureMs;
      const e0 = Date.now();
      await this.encoder.write(Buffer.from(r.img.slice(r.img.indexOf(",") + 1), "base64"));
      this.stats.encodeMs += Date.now() - e0;
    }
    this.n++;
    if (this.phase === "play" && this.n % (SIM_HZ * 2) === 0) this.o.log(`  ${this.time().toFixed(1)} s`);
    return r;
  }

  /** Record frames for `ms` of shot time. */
  async wait(ms: number): Promise<void> {
    const frames = Math.max(0, Math.round((ms / 1000) * SIM_HZ));
    for (let i = 0; i < frames; i++) await this.step();
  }

  /** Record frames until shot time `seconds`. */
  async until(seconds: number): Promise<void> {
    while (this.time() < seconds - 1e-9) await this.step();
  }

  /** Step frames until the page predicate holds (checked before each frame). */
  async waitFor<A>(pred: (arg: A) => boolean, arg: A, o: { maxMs: number; label: string }): Promise<void> {
    const frames = Math.ceil((o.maxMs / 1000) * SIM_HZ);
    for (let i = 0; i <= frames; i++) {
      if (await this.page.evaluate(pred as (a: unknown) => boolean, arg)) return;
      await this.step();
    }
    const state = await this.page.evaluate(() => {
      const x = (window as any).__xr;
      return JSON.stringify({ mr: x.state(), placement: x.placement(), ui: x.ui(), moves: x.snapshot().sanList, busy: x.snapshot().busy, err: (window as any).__filmEnterError });
    });
    throw new Error(`waited ${o.maxMs} ms of shot time for ${o.label}; ${state}`);
  }

  /**
   * Where each hand pinches and points, measured from IWER's own joints: the wrist at rest
   * orientation, pinched (thumb and index tips meet), then pointing (index tip). Undrawn frames.
   */
  async calibrate(): Promise<void> {
    const t = this.time();
    const saved = { left: this.tracks.left.rebase(t), right: this.tracks.right.rebase(t) };
    const base: Record<Side, P3> = { left: [-0.3, 2.2, 0.3], right: [0.3, 2.2, 0.3] };
    for (const side of ["left", "right"] as const) {
      this.tracks[side] = new HandTrack(base[side], [0, 0, 0, 1], "point", 1);
    }
    await this.wait(80);
    const pinched = await this.page.evaluate(() => (window as any).__filmHands);
    for (const side of ["left", "right"] as const) {
      this.tracks[side] = new HandTrack(base[side], [0, 0, 0, 1], "point", 0);
    }
    await this.wait(80);
    const pointing = await this.page.evaluate(() => (window as any).__filmHands);
    for (const side of ["left", "right"] as const) {
      const j = pinched?.[side], k = pointing?.[side];
      if (!j?.["thumb-tip"] || !k?.["index-finger-tip"]) throw new Error(`no ${side} hand joints to calibrate from`);
      const b = base[side];
      const mid: P3 = [(j["thumb-tip"][0] + j["index-finger-tip"][0]) / 2, (j["thumb-tip"][1] + j["index-finger-tip"][1]) / 2, (j["thumb-tip"][2] + j["index-finger-tip"][2]) / 2];
      this.calibration[side] = {
        pinch: [mid[0] - b[0], mid[1] - b[1], mid[2] - b[2]],
        tip: [k["index-finger-tip"][0] - b[0], k["index-finger-tip"][1] - b[1], k["index-finger-tip"][2] - b[2]],
      };
    }
    this.tracks = saved;
    await this.wait(50);
  }
}

const round = (t: number) => Math.round(t * 1000) / 1000;

interface Lin<T> {
  t0: number;
  t1: number;
  from: T;
  to: T;
}

interface WindowState {
  tl: P3;
  tr: P3;
  bl: P3;
  alpha: Lin<number>[];
  cursor: { path: Lin<P3>[]; alpha: Lin<number>[]; pressed: Lin<number>[]; at(t: number): P3 } | null;
}

/** The value at `t` of a list of eased segments (the last one started wins). */
function at1(segs: Lin<number>[], t: number, fallback: number): number {
  let s: Lin<number> | undefined;
  for (const x of segs) if (x.t0 <= t) s = x;
  if (!s) return fallback;
  const k = s.t1 <= s.t0 ? 1 : minimumJerk((t - s.t0) / (s.t1 - s.t0));
  return s.from + (s.to - s.from) * k;
}

function pathAt(segs: Lin<P3>[], t: number, fallback: P3): P3 {
  let s: Lin<P3> | undefined;
  for (const x of segs) if (x.t0 <= t) s = x;
  if (!s) return fallback;
  const k = s.t1 <= s.t0 ? 1 : minimumJerk((t - s.t0) / (s.t1 - s.t0));
  return [0, 1, 2].map((i) => s!.from[i]! + (s!.to[i]! - s!.from[i]!) * k) as P3;
}
