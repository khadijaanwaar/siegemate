// A hand's path through a shot, as a function of shot time, like the camera's: eased moves of the
// wrist, turns, the pinch closing and opening, pose changes. Pure math; the recorder puts IWER's
// hand where the track says before each frame, so hands, head and game all move together.
import { EASE, type Ease, type Quat } from "./camera.ts";

export type P3 = [number, number, number];

interface Seg<T> {
  t0: number;
  t1: number;
  from: T;
  to: T;
  ease: Ease;
  path?: (k: number) => T;
}

/** Shortest-arc spherical interpolation of two unit quaternions. */
export function slerp(a: Quat, b: Quat, k: number): Quat {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (dot > 0.9995) {
    const q: Quat = [a[0] + (bx - a[0]) * k, a[1] + (by - a[1]) * k, a[2] + (bz - a[2]) * k, a[3] + (bw - a[3]) * k];
    const n = Math.hypot(...q);
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  }
  const th = Math.acos(dot);
  const s = Math.sin(th);
  const wa = Math.sin((1 - k) * th) / s;
  const wb = Math.sin(k * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

/** Rotate `v` by unit quaternion `q`. */
export function rotate(q: Quat, v: P3): P3 {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

/**
 * A hand's orientation from three turns, degrees, applied yaw (about up), then pitch (about the
 * hand's side axis), then roll (about the fingers). Zero is IWER's rest: palm down, fingers
 * pointing ahead (-Z). Positive yaw turns the fingers left, positive pitch raises them, positive
 * roll turns the thumb side up for a right hand.
 */
export function handTurn(yawDeg: number, pitchDeg = 0, rollDeg = 0): Quat {
  const r = Math.PI / 180;
  const qy: Quat = [0, Math.sin((yawDeg * r) / 2), 0, Math.cos((yawDeg * r) / 2)];
  const qx: Quat = [Math.sin((pitchDeg * r) / 2), 0, 0, Math.cos((pitchDeg * r) / 2)];
  const qz: Quat = [0, 0, Math.sin((rollDeg * r) / 2), Math.cos((rollDeg * r) / 2)];
  return mul(mul(qy, qx), qz);
}

export function mul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function at<T>(segs: Seg<T>[], start: T, t: number, mix: (a: T, b: T, k: number) => T): T {
  let s: Seg<T> | undefined;
  for (let i = segs.length - 1; i >= 0; i--) {
    if ((segs[i] as Seg<T>).t0 <= t) {
      s = segs[i];
      break;
    }
  }
  if (!s) return start;
  const k = t >= s.t1 ? 1 : EASE[s.ease]((t - s.t0) / Math.max(1e-9, s.t1 - s.t0));
  if (s.path) return s.path(k);
  return mix(s.from, s.to, k);
}

const lerp = (a: P3, b: P3, k: number): P3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** One hand's track: wrist position, orientation, pinch (0 open, 1 closed) and pose over time. */
export class HandTrack {
  private readonly pos: Seg<P3>[] = [];
  private readonly rot: Seg<Quat>[] = [];
  private readonly pin: Seg<number>[] = [];
  private readonly poses: Array<{ t: number; pose: string; ms: number }> = [];
  private readonly shows: Array<{ t: number; shown: boolean }> = [];
  private p0: P3;
  private q0: Quat;
  private pinch0: number;
  private pose0: string;

  constructor(p: P3, q: Quat, pose = "default", pinch = 0) {
    this.p0 = p;
    this.q0 = q;
    this.pose0 = pose;
    this.pinch0 = pinch;
  }

  position(t: number): P3 {
    return at(this.pos, this.p0, t, lerp);
  }
  quaternion(t: number): Quat {
    return at(this.rot, this.q0, t, slerp);
  }
  pinch(t: number): number {
    return at(this.pin, this.pinch0, t, (a, b, k) => a + (b - a) * k);
  }
  pose(t: number): string {
    let pose = this.pose0;
    for (const c of this.poses) if (c.t <= t) pose = c.pose;
    return pose;
  }
  /** How far the latest pose change has gone at `t` (1: done). */
  poseK(t: number): number {
    let k = 1;
    for (const c of this.poses) if (c.t <= t) k = c.ms <= 0 ? 1 : EASE["minimum-jerk"]((t - c.t) / (c.ms / 1000));
    return k;
  }
  shown(t: number): boolean {
    let shown = true;
    for (const c of this.shows) if (c.t <= t) shown = c.shown;
    return shown;
  }

  moveTo(t: number, p: P3, ms: number, ease: Ease = "minimum-jerk"): void {
    this.pos.push({ t0: t, t1: t + ms / 1000, from: this.position(t), to: p, ease });
  }
  /** Follow `path(k)` (k from 0 to 1, eased) over `ms`. */
  follow(t: number, path: (k: number) => P3, ms: number, ease: Ease = "minimum-jerk"): void {
    const end = path(1);
    this.pos.push({ t0: t, t1: t + ms / 1000, from: this.position(t), to: end, ease, path });
  }
  turnTo(t: number, q: Quat, ms: number, ease: Ease = "minimum-jerk"): void {
    this.rot.push({ t0: t, t1: t + ms / 1000, from: this.quaternion(t), to: q, ease });
  }
  pinchTo(t: number, value: number, ms: number): void {
    this.pin.push({ t0: t, t1: t + ms / 1000, from: this.pinch(t), to: value, ease: "minimum-jerk" });
  }
  setPose(t: number, pose: string, ms = 0): void {
    this.poses.push({ t, pose, ms });
  }
  show(t: number, shown: boolean): void {
    this.shows.push({ t, shown });
  }
  /** Start over at time 0 from where the hand is at `t` (setup hands over to play). */
  rebase(t: number): HandTrack {
    return new HandTrack(this.position(t), this.quaternion(t), this.pose(t), this.pinch(t));
  }
}
