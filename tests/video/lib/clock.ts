/**
 * The film's frame clock, installed as an init script (before the app loads).
 *
 * The page boots on real time (asset loads, fonts and the app's own timers need it). `__vt.pause()`
 * then stops time: `performance.now()`, `Date`, `requestAnimationFrame`, `setTimeout` and
 * `setInterval` all follow a virtual clock that only moves when the recorder calls `__vt.step(ms)`.
 * IWER drives the emulated XR frame loop from `requestAnimationFrame` and `performance.now()`, so a
 * step is exactly one frame of the game (systems, hands, the AI's think floor, the draw), however
 * long the GPU takes to draw it. Timers due inside a step fire first, in due order, then the frame.
 *
 * Adapted from Shadow Locks' `src/app/virtual-clock.ts` (same author family); timers are virtual here
 * as well, because Siegemate's think floor and match clock are timers.
 *
 * Self-contained on purpose: Playwright serializes this function into the page.
 */
export interface FilmClock {
  virtual: boolean;
  /** Virtual time, ms (what performance.now() returns while virtual). */
  now: number;
  /** Frames stepped since the clock went virtual. */
  frames: number;
  realNow(): number;
  realSetTimeout(fn: () => void, ms: number): number;
  /** Advance by `ms`: due timers in order, then one batch of frame callbacks. */
  step(ms: number): { ran: number; timers: number };
  /** Stop real time here: from now on only step() moves the clock. */
  pause(): void;
}

export function installFilmClock(o: { epochMs: number; seed: number }): void {
  const w = window as unknown as Record<string, unknown> & Window & typeof globalThis;
  if (w.__vt) return;
  const perf = w.performance;
  const realNow = perf.now.bind(perf);
  const realRaf = w.requestAnimationFrame.bind(w);
  const realCancelRaf = w.cancelAnimationFrame.bind(w);
  const realSetTimeout = w.setTimeout.bind(w);
  const realSetInterval = w.setInterval.bind(w);
  const realClearTimeout = w.clearTimeout.bind(w);
  const realClearInterval = w.clearInterval.bind(w);
  const RealDate = w.Date;
  const VIRTUAL_ID = 1_000_000_000;
  let nextId = VIRTUAL_ID;
  let frames: Array<{ id: number; cb: FrameRequestCallback }> = [];
  interface Timer {
    id: number;
    due: number;
    seq: number;
    every: number | null;
    fn: (...args: unknown[]) => void;
    args: unknown[];
  }
  let timers: Timer[] = [];
  let seq = 0;

  // Seeded Math.random (mulberry32): particles, shatter and idle sways land the same in every run.
  let seed = o.seed >>> 0;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const vt: FilmClock = {
    virtual: false,
    now: 0,
    frames: 0,
    realNow,
    realSetTimeout: (fn, ms) => realSetTimeout(fn, ms) as unknown as number,
    step(ms: number) {
      const target = vt.now + ms;
      let fired = 0;
      for (let guard = 0; guard < 10_000; guard++) {
        let next: Timer | null = null;
        for (const t of timers) if (t.due <= target && (!next || t.due < next.due || (t.due === next.due && t.seq < next.seq))) next = t;
        if (!next) break;
        vt.now = Math.max(vt.now, next.due);
        if (next.every === null) timers = timers.filter((t) => t !== next);
        else {
          next.due += next.every;
          next.seq = seq++;
        }
        fired++;
        try {
          next.fn(...next.args);
        } catch (err) {
          console.error("film clock: timer failed", err);
        }
      }
      vt.now = target;
      vt.frames++;
      const run = frames;
      frames = [];
      for (const e of run) {
        try {
          e.cb(vt.now);
        } catch (err) {
          console.error("film clock: frame callback failed", err);
        }
      }
      return { ran: run.length, timers: fired };
    },
    pause() {
      if (vt.virtual) return;
      vt.now = realNow();
      vt.virtual = true;
      // Frame callbacks already queued on real time move to the virtual queue.
    },
  };

  perf.now = () => (vt.virtual ? vt.now : realNow());
  const dateNow = () => (vt.virtual ? o.epochMs + vt.now : RealDate.now());
  function FilmDate(this: unknown, ...args: unknown[]): unknown {
    if (!new.target) return new RealDate(dateNow()).toString();
    return args.length ? Reflect.construct(RealDate, args) : new RealDate(dateNow());
  }
  FilmDate.prototype = RealDate.prototype;
  FilmDate.now = dateNow;
  FilmDate.parse = RealDate.parse;
  FilmDate.UTC = RealDate.UTC;
  w.Date = FilmDate as unknown as DateConstructor;

  const realIds = new Map<number, number>();
  w.requestAnimationFrame = (cb: FrameRequestCallback) => {
    if (!vt.virtual) {
      // A callback asked for on real time but due after the switch joins the virtual queue.
      const id = nextId++;
      const realId = realRaf((t) => {
        if (vt.virtual) frames.push({ id, cb });
        else cb(t);
      });
      realIds.set(id, realId);
      return id;
    }
    const id = nextId++;
    frames.push({ id, cb });
    return id;
  };
  w.cancelAnimationFrame = (id: number) => {
    const realId = realIds.get(id);
    if (realId !== undefined) {
      realCancelRaf(realId);
      realIds.delete(id);
    }
    frames = frames.filter((e) => e.id !== id);
  };

  const add = (fn: unknown, ms: unknown, args: unknown[], every: boolean): number => {
    const delay = Math.max(0, Number(ms) || 0);
    const id = nextId++;
    const call = typeof fn === "function" ? (fn as (...a: unknown[]) => void) : () => (0, eval)(String(fn));
    timers.push({ id, due: vt.now + delay, seq: seq++, every: every ? Math.max(1, delay) : null, fn: call, args });
    return id;
  };
  w.setTimeout = ((fn: unknown, ms?: unknown, ...args: unknown[]) =>
    vt.virtual ? add(fn, ms, args, false) : realSetTimeout(fn as TimerHandler, ms as number, ...args)) as typeof setTimeout;
  w.setInterval = ((fn: unknown, ms?: unknown, ...args: unknown[]) =>
    vt.virtual ? add(fn, ms, args, true) : realSetInterval(fn as TimerHandler, ms as number, ...args)) as typeof setInterval;
  const clear = (id: unknown, real: (id: number) => void) => {
    const n = Number(id);
    if (n >= VIRTUAL_ID) timers = timers.filter((t) => t.id !== n);
    else real(n);
  };
  w.clearTimeout = ((id?: unknown) => clear(id, realClearTimeout)) as typeof clearTimeout;
  w.clearInterval = ((id?: unknown) => clear(id, realClearInterval)) as typeof clearInterval;
  w.__vt = vt;
}
