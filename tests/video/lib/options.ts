// Render options, from the environment (scripts/video.sh sets them).
import path from "node:path";

export type Quality = "draft" | "final";

export interface FilmOptions {
  quality: Quality;
  /** Render size (the emulator's canvas). */
  width: number;
  height: number;
  /** Delivery size: frames drawn at the render size are scaled down (Lanczos) in the one encode. */
  outWidth: number;
  outHeight: number;
  /** Delivery frame rate (the game always runs at 60 Hz; a 30 fps draft keeps every other frame). */
  fps: number;
  hfovDeg: number;
  crf: number;
  preset: string;
  /** Game quality preset, pinned. */
  gameQuality: string;
  baseUrl: string;
  /** Where clips, stills and logs go: film-out/<W>x<H>-<fps>/. */
  outDir: string;
  headed: boolean;
}

const QUALITY: Record<Quality, { width: number; height: number; fps: number; crf: number; preset: string }> = {
  draft: { width: 960, height: 540, fps: 30, crf: 23, preset: "veryfast" },
  final: { width: 1920, height: 1080, fps: 60, crf: 16, preset: "slow" },
};

const size = (v: string, name: string): [number, number] => {
  const m = /^(\d+)x(\d+)$/.exec(v);
  if (!m) throw new Error(`${name} is WxH, not ${v}`);
  const w = Number(m[1]), h = Number(m[2]);
  if (w % 2 || h % 2) throw new Error(`${name} must be even: ${v}`);
  return [w, h];
};

export function filmOptions(env: Record<string, string | undefined> = process.env, root = process.cwd()): FilmOptions {
  const quality = (env.QUALITY ?? "draft") as Quality;
  const q = QUALITY[quality];
  if (!q) throw new Error(`QUALITY is draft or final, not ${env.QUALITY}`);
  let [width, height] = [q.width, q.height];
  if (env.SIZE) [width, height] = size(env.SIZE, "SIZE");
  let [outWidth, outHeight] = [width, height];
  if (env.OUT_SIZE) {
    [outWidth, outHeight] = size(env.OUT_SIZE, "OUT_SIZE");
    if (outWidth > width || outHeight > height) throw new Error(`OUT_SIZE ${env.OUT_SIZE} is larger than the render size ${width}x${height}`);
  }
  const fps = Number(env.FPS ?? q.fps);
  if (![60, 30, 20, 15].includes(fps)) throw new Error(`FPS must divide 60 (60, 30, 20 or 15), not ${env.FPS}`);
  return {
    quality,
    width,
    height,
    outWidth,
    outHeight,
    fps,
    hfovDeg: Number(env.HFOV ?? 90),
    crf: Number(env.CRF ?? q.crf),
    preset: env.PRESET ?? q.preset,
    gameQuality: env.GAME_QUALITY ?? "high",
    baseUrl: env.BASE_URL ?? "http://localhost:4977",
    outDir: path.resolve(root, env.FILM_OUT ?? "film-out", `${outWidth}x${outHeight}-${fps}`),
    headed: env.HEADED === "1",
  };
}
