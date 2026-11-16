// Frames go straight from the page into one ffmpeg encode (no frame files: they would take
// gigabytes per final shot). Drawn at the render size, scaled down (Lanczos) when the delivery is
// smaller, converted to BT.709 limited range 4:2:0 for players and YouTube.
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";

import type { Encoder } from "./shot.ts";

export interface EncodeSpec {
  file: string;
  fps: number;
  format: "image/png" | "image/jpeg";
  width: number;
  height: number;
  outWidth: number;
  outHeight: number;
  crf: number;
  preset: string;
}

export interface OpenEncoder extends Encoder {
  frames: number;
  close(): Promise<void>;
}

export function videoFilter(s: { width: number; height: number; outWidth: number; outHeight: number }): string {
  const scale = s.outWidth !== s.width || s.outHeight !== s.height ? `:w=${s.outWidth}:h=${s.outHeight}:flags=lanczos+accurate_rnd+full_chroma_int` : ":flags=accurate_rnd+full_chroma_int";
  return `scale=out_color_matrix=bt709:out_range=tv${scale},format=yuv420p`;
}

export function x264Args(s: { crf: number; preset: string; fps: number }): string[] {
  return [
    "-c:v", "libx264", "-preset", s.preset, "-crf", String(s.crf), "-tune", "film",
    "-x264-params", `keyint=${s.fps * 2}:min-keyint=${s.fps}`,
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-movflags", "+faststart",
  ];
}

export function openEncoder(s: EncodeSpec): OpenEncoder {
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(s.fps), "-c:v", s.format === "image/png" ? "png" : "mjpeg", "-i", "-",
    "-vf", videoFilter(s),
    ...x264Args(s),
    "-an", s.file,
  ];
  const ff = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "pipe"] });
  let err = "";
  ff.stderr.on("data", (d) => (err += String(d)));
  const exited = new Promise<number>((resolve) => ff.on("close", (code) => resolve(code ?? 1)));
  const enc: OpenEncoder = {
    frames: 0,
    async write(image: Buffer) {
      enc.frames++;
      if (!ff.stdin.write(image)) await new Promise<void>((resolve) => ff.stdin.once("drain", () => resolve()));
    },
    async close() {
      ff.stdin.end();
      const code = await exited;
      if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${err.slice(-800)}`);
    },
  };
  return enc;
}

/** Frames, size and rate of a video file, from ffprobe. */
export function probe(file: string): { frames: number; width: number; height: number; fps: string; seconds: number } {
  const out = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,width,height,r_frame_rate:format=duration", "-of", "json", file], { encoding: "utf8" });
  const j = JSON.parse(out) as { streams: Array<{ nb_read_frames: string; width: number; height: number; r_frame_rate: string }>; format: { duration: string } };
  const st = j.streams[0]!;
  return { frames: Number(st.nb_read_frames), width: st.width, height: st.height, fps: st.r_frame_rate, seconds: Number(j.format.duration) };
}
