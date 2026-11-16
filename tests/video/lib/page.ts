/**
 * Functions that run inside the page for film renders. Each one is serialized by Playwright, so it
 * must be self-contained: no imports, no outer variables.
 *
 * The approach follows Shadow Locks' tests/video/lib/page-video.ts (same author family): the room is
 * an equirectangular photograph drawn where the emulator draws its room, from the headset's pose,
 * and every frame waits for async work in flight before it is stepped. What differs here: Siegemate's
 * emulator has no synthetic environment module, so `installRoom` installs a small one of its own
 * (the photograph, plus a table top for hit tests), and the player's hands are drawn by the film,
 * not by the game (`composite`).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Init script (before the app loads):
 * - every WebGL context gets an alpha channel: the game's renderer asks for none, so the emulator's
 *   view of the board would be opaque black where the room should show through (on a headset the
 *   XR layer has alpha whatever the canvas has);
 * - async work in flight is counted (fetches and their bodies, image and audio decodes, worker
 *   replies), so each frame can wait for it (`__filmIdle`) and a lazily loaded figure lands on the
 *   same frame in every run;
 * - the search worker is replaced by a stand-in that plays the replies the shot scripts
 *   (`__filmReplies`, UCI moves) and falls back to the real worker when the script runs out;
 * - draws can be skipped (`__filmSkipDraw`) for undrawn setup frames: every system still runs.
 */
export function filmInit(): void {
  const w = window as any;
  if (w.__filmInit) return;
  w.__filmInit = true;
  // The film clock (installed first) virtualises setTimeout; the film's own waits need real ones.
  const realSetTimeout = w.__vt?.realSetTimeout ?? w.setTimeout.bind(w);

  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, attrs?: any) {
    const gl = type === "webgl2" || type === "webgl";
    if (gl && !w.__filmOpaque) attrs = { ...(attrs ?? {}), alpha: true, premultipliedAlpha: true };
    const ctx = (getContext as any).call(this, type, attrs);
    if (gl && ctx && !w.__filmOpaque) (w.__filmGlCanvases ||= new Set()).add(this);
    return ctx;
  } as any;

  for (const Ctx of [w.WebGL2RenderingContext, w.WebGLRenderingContext]) {
    if (!Ctx) continue;
    for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced", "drawRangeElements"]) {
      const real = Ctx.prototype[name];
      if (!real) continue;
      Ctx.prototype[name] = function (this: unknown, ...a: unknown[]) {
        if (w.__filmSkipDraw) return;
        return real.apply(this, a);
      };
    }
  }

  let pending = 0;
  const waiters: Array<() => void> = [];
  const settle = () => {
    if (pending > 0) return;
    for (const f of waiters.splice(0)) f();
  };
  const track = <T,>(p: Promise<T>): Promise<T> => {
    pending++;
    const done = () => {
      pending--;
      settle();
    };
    p.then(done, done);
    return p;
  };
  const realFetch = w.fetch.bind(w);
  w.fetch = (...a: unknown[]) => track(realFetch(...a));
  // Which file each decoded sound came from, so the event log can name the sounds the game plays
  // (for laying the game's own sound under the film later).
  const bodyUrl = new WeakMap<object, string>();
  const soundUrl = new WeakMap<object, string>();
  w.__filmSounds = [] as Array<Record<string, unknown>>;
  for (const m of ["arrayBuffer", "blob", "json", "text"]) {
    const body = w.Response.prototype[m];
    w.Response.prototype[m] = function (this: Response, ...a: unknown[]) {
      const p = body.apply(this, a) as Promise<unknown>;
      if (m === "arrayBuffer") void p.then((buf) => buf && bodyUrl.set(buf as object, this.url), () => undefined);
      return track(p);
    };
  }
  const realBitmap = w.createImageBitmap.bind(w);
  w.createImageBitmap = (...a: unknown[]) => track(realBitmap(...a));
  const Audio = w.BaseAudioContext ?? w.AudioContext;
  if (Audio?.prototype?.decodeAudioData) {
    const decode = Audio.prototype.decodeAudioData;
    Audio.prototype.decodeAudioData = function (this: unknown, ...a: unknown[]) {
      const url = a[0] ? bodyUrl.get(a[0] as object) : undefined;
      const p = decode.apply(this, a) as Promise<AudioBuffer>;
      if (url) void p.then((buffer) => buffer && soundUrl.set(buffer, new URL(url).pathname), () => undefined);
      return track(p);
    };
  }
  const Source = w.AudioBufferSourceNode;
  if (Source?.prototype?.start) {
    const start = Source.prototype.start;
    Source.prototype.start = function (this: AudioBufferSourceNode, ...a: number[]) {
      const buffer = this.buffer;
      if (buffer && w.__vt?.virtual) {
        w.__filmSounds.push({ type: "sound", file: soundUrl.get(buffer) ?? null, offset: a[1] ?? 0, seconds: a[2] ?? buffer.duration, rate: this.playbackRate.value, loop: this.loop });
      }
      return start.apply(this, a);
    };
  }
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    ...srcDesc,
    set(this: HTMLImageElement, value: string) {
      if (value && !value.startsWith("data:")) {
        track(
          new Promise<void>((resolve) => {
            this.addEventListener("load", () => resolve(), { once: true });
            this.addEventListener("error", () => resolve(), { once: true });
          }),
        );
      }
      srcDesc.set!.call(this, value);
    },
  });

  // The search worker: scripted replies first, then the real engine.
  w.__filmReplies = [] as string[];
  w.__filmEngineLog = [] as Array<{ fen: string; reply: string; scripted: boolean }>;
  const RealWorker = w.Worker;
  class FilmEngine extends EventTarget {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    private real: Worker | null = null;
    private readonly url: string | URL;
    private readonly options?: WorkerOptions;
    constructor(url: string | URL, options?: WorkerOptions) {
      super();
      this.url = url;
      this.options = options;
    }
    private deliver(data: unknown): void {
      const event = new MessageEvent("message", { data });
      this.onmessage?.(event);
      this.dispatchEvent(event);
    }
    postMessage(msg: { id: number; fen: string; difficulty: string }): void {
      const reply = (w.__filmReplies as string[]).shift();
      if (reply) {
        w.__filmEngineLog.push({ fen: msg.fen, reply, scripted: true });
        const data = { id: msg.id, from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] ?? null, score: 0, depth: 1 };
        track(new Promise<void>((resolve) => realSetTimeout(() => (this.deliver(data), resolve()), 0)));
        return;
      }
      if (!this.real) {
        this.real = new RealWorker(this.url, this.options) as Worker;
        this.real.onmessage = (e: MessageEvent) => {
          w.__filmEngineLog.push({ fen: "?", reply: e.data ? `${e.data.from}${e.data.to}${e.data.promotion ?? ""}` : "none", scripted: false });
          inflight?.();
          inflight = null;
          this.deliver(e.data);
        };
      }
      console.warn("film: no scripted reply left; the real (random) engine answers");
      let inflight: (() => void) | null = null;
      track(new Promise<void>((resolve) => (inflight = resolve)));
      this.real.postMessage(msg);
    }
    terminate(): void {
      this.real?.terminate();
    }
  }
  w.Worker = function (url: string | URL, options?: WorkerOptions) {
    if (String(url).includes("engine.worker")) return new FilmEngine(url, options);
    return new RealWorker(url, options);
  } as any;

  /** Resolves once nothing is in flight, or after `maxMs` of real time. */
  w.__filmIdle = (maxMs = 5000): Promise<boolean> => {
    if (pending <= 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = realSetTimeout(() => {
        console.warn(`film: still ${pending} async operations after ${maxMs} ms; stepping anyway`);
        resolve(false);
      }, maxMs);
      waiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  };
  w.__filmPending = () => pending;
  w.__filmContextLost = 0;
  document.addEventListener(
    "webglcontextlost",
    () => {
      w.__filmContextLost++;
    },
    true,
  );
}

export interface TableTop {
  /** Height of the table top, metres (floor-level space). */
  y: number;
  /** Extent of the top: x from x0 to x1, z from z0 to z1. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * A synthetic environment module for IWER (its `installSEM` hook), standing in for the room:
 * - `render` draws the photograph (equirectangular, at infinity) from the headset's pose and lens,
 *   on its own canvas behind the game's, turned `yawDeg` (the photograph's column 0.5 + yaw / 360
 *   straight ahead, as ffmpeg's v360);
 * - hit tests land on `table` (a level top, so the reticle finds it), else nothing;
 * - no planes, meshes or depth.
 * Call before entering mixed reality: the session takes hit testing from it.
 */
export async function installRoom(o: { jpegBase64: string; yawDeg: number; table: TableTop }): Promise<{ ok: boolean; why?: string; size?: [number, number] }> {
  const w = window as any;
  const d = w.__iwer;
  if (!d) return { ok: false, why: "no emulator (window.__iwer)" };
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  w.__filmOpaque = true;
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
  w.__filmOpaque = false;
  if (!gl) return { ok: false, why: "no WebGL2 for the room canvas" };
  const bin = atob(o.jpegBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }), { colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "none" });
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type) as WebGLShader;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`room shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const prog = gl.createProgram() as WebGLProgram;
  gl.attachShader(
    prog,
    compile(
      gl.VERTEX_SHADER,
      `#version 300 es
out vec2 ndc;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  ndc = p;
  gl_Position = vec4(p, 0.0, 1.0);
}`,
    ),
  );
  // From Shadow Locks: sampled with gradients worked out from the view, so the seam at the
  // photograph's edge and the mip levels stay smooth.
  gl.attachShader(
    prog,
    compile(
      gl.FRAGMENT_SHADER,
      `#version 300 es
precision highp float;
in vec2 ndc;
uniform sampler2D pano;
uniform mat3 rot;
uniform vec2 tanHalf;
uniform vec2 px;
uniform float yaw;
out vec4 color;
const float PI = 3.141592653589793;
vec2 uvOf(vec2 n) {
  vec3 d = normalize(rot * vec3(n.x * tanHalf.x, n.y * tanHalf.y, -1.0));
  float lon = atan(d.x, -d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  return vec2(0.5 + (lon + yaw) / (2.0 * PI), 0.5 - lat / PI);
}
void main() {
  vec2 uv = uvOf(ndc);
  vec2 ux = uvOf(ndc + vec2(px.x, 0.0)) - uv;
  vec2 uy = uvOf(ndc + vec2(0.0, px.y)) - uv;
  ux.x -= floor(ux.x + 0.5);
  uy.x -= floor(uy.x + 0.5);
  color = vec4(textureGrad(pano, uv, ux, uy).rgb, 1.0);
}`,
    ),
  );
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { ok: false, why: `room program: ${gl.getProgramInfoLog(prog)}` };
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const ext = gl.getExtension("EXT_texture_filter_anisotropic");
  if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  const size: [number, number] = [bmp.width, bmp.height];
  bmp.close();
  const vao = gl.createVertexArray();
  const at = (n: string) => gl.getUniformLocation(prog, n);
  const uPano = at("pano"), uRot = at("rot"), uTan = at("tanHalf"), uPx = at("px"), uYaw = at("yaw");
  const rot = new Float32Array(9);
  const table = o.table;

  class FilmRoom {
    environmentCanvas = canvas;
    trackedPlanes = new Set();
    trackedMeshes = new Set();
    render(): void {
      if (w.__filmSkipDraw) return;
      this.draw(window.innerWidth, window.innerHeight);
    }
    /** The photograph from the headset's pose and lens, at `cw` x `ch`. */
    draw(cw: number, ch: number): void {
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      const q = d.quaternion;
      const { x, y, z } = q, qw = q.w;
      rot[0] = 1 - 2 * (y * y + z * z);
      rot[1] = 2 * (x * y + z * qw);
      rot[2] = 2 * (x * z - y * qw);
      rot[3] = 2 * (x * y - z * qw);
      rot[4] = 1 - 2 * (x * x + z * z);
      rot[5] = 2 * (y * z + x * qw);
      rot[6] = 2 * (x * z + y * qw);
      rot[7] = 2 * (y * z - x * qw);
      rot[8] = 1 - 2 * (x * x + y * y);
      const ty = Math.tan((d.fovy as number) / 2);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      gl!.viewport(0, 0, cw, ch);
      gl!.useProgram(prog);
      gl!.bindVertexArray(vao);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, tex);
      gl!.uniform1i(uPano, 0);
      gl!.uniformMatrix3fv(uRot, false, rot);
      gl!.uniform2f(uTan, ty * (cw / ch), ty);
      gl!.uniform2f(uPx, 2 / cw, 2 / ch);
      gl!.uniform1f(uYaw, (o.yawDeg * Math.PI) / 180);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    }
    /** `ray`: the ray's pose in the global space (column major); it points down its -Z. */
    computeHitTestResults(ray: Float32Array): Float32Array[] {
      const ox = ray[12], oy = ray[13], oz = ray[14];
      const dx = -ray[8], dy = -ray[9], dz = -ray[10];
      if (dy >= -1e-6) return [];
      const t = (table.y - oy) / dy;
      if (t <= 0) return [];
      const hx = ox + dx * t, hz = oz + dz * t;
      if (hx < table.x0 || hx > table.x1 || hz < table.z0 || hz > table.z1) return [];
      const m = new Float32Array(16);
      m[0] = m[5] = m[10] = m[15] = 1;
      m[12] = hx;
      m[13] = table.y;
      m[14] = hz;
      return [m];
    }
  }
  d.installSEM(FilmRoom);
  w.__filmRoomCanvas = canvas;
  // Before mixed reality (no session draws it): the room for a frame of the 2D page's window.
  w.__filmDrawRoom = (cw: number, ch: number) => d.sem.draw(cw, ch);
  return { ok: true, size };
}

/**
 * Once the session is presenting: a frame callback of the film's own reads the headset's view
 * (projection and view matrix) and both hands' joints every frame, in the game's floor-level space,
 * for the drawn hands and for calibrating where a hand pinches.
 */
export async function installTap(): Promise<boolean> {
  const w = window as any;
  const s = w.__iwer?.activeSession;
  if (!s) return false;
  const ref = await s.requestReferenceSpace("local-floor");
  w.__filmHands = {};
  const loop = (_t: number, frame: any) => {
    s.requestAnimationFrame(loop);
    const pose = frame.getViewerPose(ref);
    const view = pose?.views?.[0];
    if (view) w.__filmView = { proj: Array.from(view.projectionMatrix), inv: Array.from(view.transform.inverse.matrix) };
    const hands: Record<string, Record<string, number[]>> = {};
    for (const src of s.inputSources) {
      if (!src.hand) continue;
      const joints: Record<string, number[]> = {};
      for (const [name, space] of src.hand) {
        const jp = frame.getJointPose(space, ref);
        if (jp) joints[name] = [jp.transform.position.x, jp.transform.position.y, jp.transform.position.z, jp.radius];
      }
      hands[src.handedness] = joints;
    }
    w.__filmHands = hands;
  };
  s.requestAnimationFrame(loop);
  return true;
}

export interface HandPose {
  p: [number, number, number];
  q: [number, number, number, number];
  /** 0 open to 1 closed (IWER's pinch: thumb and index only). */
  pinch: number;
  /** IWER hand pose id ("default", "point", ...). */
  pose: string;
  /** Progress of the change into `pose` (1: done). */
  poseK: number;
  /** Draw this hand (default true); hidden hands are parked out of view anyway. */
  shown?: boolean;
}

export interface FrameArgs {
  dt: number;
  head: { p: [number, number, number]; q: [number, number, number, number]; fovy: number };
  hands: Record<string, HandPose>;
  /** Draw and capture this frame (false: an undrawn setup frame). */
  capture: boolean;
  /** "image/png" or "image/jpeg". */
  format: string;
  label: string | null;
  /** Hand look: fill and outline strength (0 hides). */
  handLook: { fill: number; rim: number };
  /** Output size while no session draws (the 2D page's window frames). */
  size?: [number, number];
  /** The 2D page as a floating window (its image from `__filmPanelImage`), corners in world metres. */
  panel?: { tl: number[]; tr: number[]; bl: number[]; alpha: number } | null;
  cursor?: { at: number[]; alpha: number; pressed: boolean } | null;
  /** Step only: the composite comes from a later `filmCompose` (after a page screenshot). */
  composeLater?: boolean;
}

/** Composite the frame already stepped (no step): room, window, cursor, label. */
export function filmCompose(a: FrameArgs): string {
  return (window as any).__filmComposite(a);
}

export interface FrameResult {
  img: string | null;
  now: number;
  events: Array<Record<string, unknown>>;
  idleMs: number;
  stepMs: number;
  captureMs: number;
  contextLost: number;
  /** A session is presenting. */
  xr: boolean;
}

/**
 * One frame: wait for async work in flight, pose the headset and hands, step the clock one frame,
 * note what changed in the game, and (when capturing) composite room + game + hands + label.
 */
export async function filmFrame(a: FrameArgs): Promise<FrameResult> {
  const w = window as any;
  const vt = w.__vt;
  const d = w.__iwer;
  const i0 = vt.realNow();
  await w.__filmIdle();
  const idleMs = vt.realNow() - i0;
  d.position.set(a.head.p[0], a.head.p[1], a.head.p[2]);
  d.quaternion.set(a.head.q[0], a.head.q[1], a.head.q[2], a.head.q[3]);
  if (Math.abs(d.fovy - a.head.fovy) > 1e-9) d.fovy = a.head.fovy;
  for (const side of ["left", "right"]) {
    const h = d.hands?.[side];
    const want = a.hands[side];
    if (!h || !want) continue;
    h.position.set(want.p[0], want.p[1], want.p[2]);
    h.quaternion.set(want.q[0], want.q[1], want.q[2], want.q[3]);
    if (h.poseId !== want.pose) h.beginPoseTransition(want.pose);
    if (h.poseTransitionProgress !== null || want.poseK < 1) h.poseTransitionProgress = want.poseK >= 1 ? null : want.poseK;
    if (Math.abs(h.pinchValue - want.pinch) > 1e-4) h.updatePinchValue(Math.min(1, Math.max(0, want.pinch)));
  }
  w.__filmSkipDraw = !a.capture;
  const s0 = vt.realNow();
  try {
    vt.step(a.dt);
  } finally {
    w.__filmSkipDraw = false;
  }
  const stepMs = vt.realNow() - s0;
  const events = (w.__filmWatch ? w.__filmWatch() : []) as Array<Record<string, unknown>>;

  let img: string | null = null;
  let captureMs = 0;
  if (a.capture && !a.composeLater) {
    const c0 = vt.realNow();
    img = w.__filmComposite(a);
    captureMs = vt.realNow() - c0;
  }
  return { img, now: vt.now, events, idleMs, stepMs, captureMs, contextLost: w.__filmContextLost, xr: Boolean(d.activeSession) };
}

/**
 * Installs `__filmWatch()` (what changed in the game since the last call, as events) and
 * `__filmComposite(args)` (the frame as a data URL: room, game, drawn hands, corner label).
 */
export function installFrameTools(): void {
  const w = window as any;
  let last: Record<string, string> = {};
  w.__filmWatch = (): Array<Record<string, unknown>> => {
    const x = w.__xr;
    if (!x) return [];
    const snap = x.snapshot();
    const ui = x.ui();
    const now: Record<string, string> = {
      mr: String(x.state()),
      placement: String(x.placement()),
      coach: String(ui?.coach ?? ""),
      panels: (ui?.panels ?? []).join(","),
      theme: String(x.room()?.theme ?? ""),
      status: String(snap.status),
      result: snap.result ? JSON.stringify(snap.result) : "",
      thinking: String(snap.thinking),
      busy: String(snap.busy),
      check: String(snap.inCheck),
      moves: String(snap.sanList.length),
      right: String(x.pinch("right")?.mode ?? ""),
      left: String(x.pinch("left")?.mode ?? ""),
    };
    const out: Array<Record<string, unknown>> = [];
    for (const key of Object.keys(now)) {
      if (last[key] === now[key]) continue;
      if (key === "moves" && last.moves !== undefined) {
        const san = snap.sanList[snap.sanList.length - 1] ?? "";
        const by = snap.sanList.length % 2 === 1 ? "w" : "b";
        out.push({
          type: "move",
          san,
          by,
          from: snap.lastMove?.from,
          to: snap.lastMove?.to,
          capture: san.includes("x"),
          promotion: san.includes("="),
          check: san.endsWith("+"),
          mate: san.endsWith("#"),
          fen: snap.fen,
        });
      } else {
        out.push({ type: key, from: last[key] ?? null, to: now[key] });
      }
    }
    last = now;
    out.push(...(w.__filmSounds as Array<Record<string, unknown>>).splice(0));
    return out;
  };

  const HAND = [
    ["wrist", "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"],
    ["wrist", "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip"],
    ["wrist", "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip"],
    ["wrist", "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip"],
    ["wrist", "pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip"],
  ];
  const PALM = ["wrist", "thumb-metacarpal", "index-finger-phalanx-proximal", "middle-finger-phalanx-proximal", "ring-finger-phalanx-proximal", "pinky-finger-phalanx-proximal", "pinky-finger-metacarpal"];
  const out = document.createElement("canvas");
  const layer = document.createElement("canvas");
  const rim = document.createElement("canvas");
  const lines = document.createElement("canvas");

  const project = (v: { proj: number[]; inv: number[] }, p: number[], W: number, H: number) => {
    const m = v.inv, P = v.proj;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    const cw = -z;
    if (cw <= 0.01) return null;
    const cx = P[0] * x + P[8] * z;
    const cy = P[5] * y + P[9] * z;
    return { x: ((cx / cw) * 0.5 + 0.5) * W, y: (1 - ((cy / cw) * 0.5 + 0.5)) * H, r: ((p[3] ?? 0.01) * P[5] * H) / 2 / cw };
  };

  /** The headset's own view (ipd 0: the eye is the head), for frames without a session. */
  const deviceView = (W: number, H: number) => {
    const d = w.__iwer;
    const { x, y, z, w: qw } = d.quaternion;
    const p = d.position;
    // The head's rotation (column major), transposed for the inverse, then the translation.
    const r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * qw), 2 * (x * z - y * qw), 2 * (x * y - z * qw), 1 - 2 * (x * x + z * z), 2 * (y * z + x * qw), 2 * (x * z + y * qw), 2 * (y * z - x * qw), 1 - 2 * (x * x + y * y)];
    const inv = [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, 0, 0, 0, 1];
    inv[12] = -(inv[0] * p.x + inv[4] * p.y + inv[8] * p.z);
    inv[13] = -(inv[1] * p.x + inv[5] * p.y + inv[9] * p.z);
    inv[14] = -(inv[2] * p.x + inv[6] * p.y + inv[10] * p.z);
    const f = 1 / Math.tan(d.fovy / 2);
    const proj = [f / (W / H), 0, 0, 0, 0, f, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0];
    return { proj, inv };
  };

  /** The 2D page's window, from the last screenshot (base64 PNG), or none. */
  w.__filmPanelImage = async (b64: string | null) => {
    w.__filmPanelBitmap?.close?.();
    w.__filmPanelBitmap = null;
    if (!b64) return;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    w.__filmPanelBitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  };

  w.__filmComposite = (a: {
    format: string;
    label: string | null;
    hands: Record<string, { shown?: boolean }>;
    handLook: { fill: number; rim: number };
    /** Output size while no session draws (the 2D page's frames); default the game canvas. */
    size?: [number, number];
    /** The 2D page as a floating browser window: its corners top-left, top-right, bottom-left (world). */
    panel?: { tl: number[]; tr: number[]; bl: number[]; alpha: number } | null;
    /** A pointer's cursor dot, world point. */
    cursor?: { at: number[]; alpha: number; pressed: boolean } | null;
  }): string => {
    const xr = Boolean(w.__iwer?.activeSession);
    let gameCanvas: HTMLCanvasElement | null = null;
    for (const c of (w.__filmGlCanvases ?? []) as Set<HTMLCanvasElement>) {
      if (c.isConnected && (!gameCanvas || c.width * c.height > gameCanvas.width * gameCanvas.height)) gameCanvas = c;
    }
    if (!gameCanvas) throw new Error("film: no game canvas");
    const [W, H] = !xr && a.size ? a.size : [gameCanvas.width, gameCanvas.height];
    for (const c of [out, layer, rim, lines]) {
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
    }
    const ctx = out.getContext("2d")!;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (!xr) w.__filmDrawRoom(W, H);
    const room = w.__filmRoomCanvas as HTMLCanvasElement | undefined;
    if (room && room.width) ctx.drawImage(room, 0, 0, W, H);
    if (xr) ctx.drawImage(gameCanvas, 0, 0, W, H);
    const view = xr && w.__filmView ? w.__filmView : deviceView(W, H);

    // The browser window: the page's screenshot on a quad facing the eye, soft shadow, round corners.
    const bmp = w.__filmPanelBitmap as ImageBitmap | null;
    if (a.panel && bmp && a.panel.alpha > 0) {
      const tl = project(view, a.panel.tl, W, H), tr = project(view, a.panel.tr, W, H), bl = project(view, a.panel.bl, W, H);
      if (tl && tr && bl) {
        ctx.save();
        ctx.globalAlpha = a.panel.alpha;
        ctx.setTransform((tr.x - tl.x) / bmp.width, (tr.y - tl.y) / bmp.width, (bl.x - tl.x) / bmp.height, (bl.y - tl.y) / bmp.height, tl.x, tl.y);
        ctx.shadowColor = "rgba(0,0,0,0.45)";
        ctx.shadowBlur = 40;
        ctx.beginPath();
        (ctx as any).roundRect(0, 0, bmp.width, bmp.height, 14 * (bmp.width / 1280));
        ctx.fillStyle = "#111";
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.clip();
        ctx.drawImage(bmp, 0, 0);
        ctx.restore();
      }
    }
    if (a.cursor && a.cursor.alpha > 0) {
      const c = project(view, a.cursor.at, W, H);
      if (c) {
        const s = H / 1080;
        ctx.save();
        ctx.globalAlpha = a.cursor.alpha;
        ctx.beginPath();
        ctx.arc(c.x, c.y, (a.cursor.pressed ? 7 : 9) * s, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 8 * s;
        ctx.fill();
        ctx.restore();
      }
    }

    // The player's hands: a smoky see-through fill with a thin warm rim, fading out past the wrist,
    // in the spirit of the Quest system hand. Drawn over the game: a hand at the board is nearer
    // the eye than anything it reaches for.
    if (xr && a.handLook.fill + a.handLook.rim > 0) {
      for (const side of ["left", "right"]) {
        if (a.hands[side]?.shown === false) continue;
        const joints = w.__filmHands?.[side];
        if (!joints?.wrist) continue;
        const pts: Record<string, { x: number; y: number; r: number }> = {};
        let ok = true;
        for (const name of Object.keys(joints)) {
          const p = project(view, joints[name], W, H);
          if (!p) ok = false;
          else pts[name] = p;
        }
        if (!ok) continue;
        const l = layer.getContext("2d")!;
        l.globalCompositeOperation = "source-over";
        l.clearRect(0, 0, W, H);
        l.fillStyle = "#fff";
        l.strokeStyle = "#fff";
        l.lineCap = "round";
        l.lineJoin = "round";
        l.beginPath();
        PALM.forEach((n, i) => (i ? l.lineTo(pts[n].x, pts[n].y) : l.moveTo(pts[n].x, pts[n].y)));
        l.closePath();
        l.fill();
        for (const chain of HAND) {
          for (let i = 1; i < chain.length; i++) {
            const p0 = pts[chain[i - 1]], p1 = pts[chain[i]];
            if (!p0 || !p1) continue;
            l.lineWidth = Math.max(2, 2 * Math.min(p0.r, p1.r) * 0.92);
            l.beginPath();
            l.moveTo(p0.x, p0.y);
            l.lineTo(p1.x, p1.y);
            l.stroke();
          }
          const tip = pts[chain[chain.length - 1]];
          if (tip) {
            l.beginPath();
            l.arc(tip.x, tip.y, Math.max(1, tip.r), 0, Math.PI * 2);
            l.fill();
          }
        }
        // The whole hand, fading out just past the wrist (no forearm).
        const wr = pts.wrist, mid = pts["middle-finger-phalanx-proximal"];
        if (wr && mid) {
          const g = l.createLinearGradient(wr.x - (mid.x - wr.x) * 0.45, wr.y - (mid.y - wr.y) * 0.45, wr.x + (mid.x - wr.x) * 0.2, wr.y + (mid.y - wr.y) * 0.2);
          g.addColorStop(0, "rgba(0,0,0,0)");
          g.addColorStop(1, "rgba(0,0,0,1)");
          l.globalCompositeOperation = "destination-in";
          l.fillStyle = g;
          l.fillRect(0, 0, W, H);
        }
        // Rim: the silhouette grown by a pixel or two, minus the silhouette.
        const t = Math.max(1, Math.round(H / 640));
        const r = rim.getContext("2d")!;
        r.globalCompositeOperation = "source-over";
        r.clearRect(0, 0, W, H);
        for (const [ox, oy] of [[t, 0], [-t, 0], [0, t], [0, -t], [t, t], [-t, -t], [t, -t], [-t, t]]) r.drawImage(layer, ox, oy);
        r.globalCompositeOperation = "destination-out";
        r.drawImage(layer, 0, 0);
        r.globalCompositeOperation = "source-in";
        r.fillStyle = "#fff6e8";
        r.fillRect(0, 0, W, H);
        // Each finger traced faintly from the knuckle (inside the silhouette), so a closed hand still
        // reads as fingers.
        const f = lines.getContext("2d")!;
        f.globalCompositeOperation = "source-over";
        f.clearRect(0, 0, W, H);
        f.strokeStyle = "rgba(255,246,232,0.5)";
        f.lineWidth = Math.max(1, t * 0.8);
        f.lineCap = "round";
        f.lineJoin = "round";
        for (const chain of HAND) {
          f.beginPath();
          chain.slice(2).forEach((n, i) => (pts[n] ? (i ? f.lineTo(pts[n].x, pts[n].y) : f.moveTo(pts[n].x, pts[n].y)) : undefined));
          f.stroke();
        }
        f.globalCompositeOperation = "destination-in";
        f.drawImage(layer, 0, 0);
        // Fill: the silhouette tinted a smoky warm grey.
        l.globalCompositeOperation = "source-in";
        l.fillStyle = "#8c857c";
        l.fillRect(0, 0, W, H);
        ctx.globalAlpha = a.handLook.fill;
        ctx.drawImage(layer, 0, 0);
        ctx.globalAlpha = a.handLook.rim;
        ctx.drawImage(rim, 0, 0);
        ctx.drawImage(lines, 0, 0);
        // The pinch: a small ring between thumb and index tips that closes to a dot as they meet,
        // like the headset's own pinch cursor, so the viewer sees each pinch land.
        const th = joints["thumb-tip"], ix = joints["index-finger-tip"];
        const pinchAt = th && ix ? project(view, [(th[0] + ix[0]) / 2, (th[1] + ix[1]) / 2, (th[2] + ix[2]) / 2, 0.006], W, H) : null;
        if (pinchAt) {
          const gap = Math.hypot(th[0] - ix[0], th[1] - ix[1], th[2] - ix[2]);
          const k = Math.min(1, Math.max(0, (gap - 0.012) / 0.05));
          const s = H / 1080;
          ctx.globalAlpha = a.handLook.rim * (0.95 - 0.35 * k);
          ctx.strokeStyle = "#fff6e8";
          ctx.fillStyle = "#fff6e8";
          ctx.lineWidth = 2 * s;
          ctx.beginPath();
          ctx.arc(pinchAt.x, pinchAt.y, (3 + 9 * k) * s, 0, Math.PI * 2);
          if (k < 0.05) ctx.fill();
          else ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    if (a.label) {
      const s = H / 1080;
      ctx.font = `600 ${Math.round(22 * s)}px Inter, system-ui, sans-serif`;
      ctx.textBaseline = "alphabetic";
      const x = Math.round(36 * s), y = H - Math.round(34 * s);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      const tw = ctx.measureText(a.label).width;
      const pad = Math.round(10 * s);
      ctx.beginPath();
      (ctx as any).roundRect(x - pad, y - Math.round(24 * s), tw + pad * 2, Math.round(34 * s), Math.round(8 * s));
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      ctx.fillText(a.label, x, y);
    }
    return out.toDataURL(a.format, a.format === "image/jpeg" ? 0.93 : undefined);
  };
}
