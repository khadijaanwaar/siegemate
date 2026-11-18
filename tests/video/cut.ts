// The film's final cut (no GPU needed), from the edit list tests/video/cut.json and the rendered shots:
//
//   node --no-warnings tests/video/cut.ts                 # draft shots  -> film-out/960x540-30/siegemate.mp4
//   QUALITY=final node --no-warnings tests/video/cut.ts   # final shots  -> film-out/1920x1080-60/siegemate.mp4
//
// Segments are trimmed stretches of shots (or a card), hard cut in order, the first faded up from black and the last
// down. Captions (one per segment, a pill at the bottom), tags (short labels at a time, top right, e.g. "Network off")
// and the end card are drawn by Chromium with the game's own fonts (Inter, Cinzel) as transparent PNGs and laid over.
// Sound: each shot's own game mix under the cut, ducked under the narration (film-out/narration/*.wav, placed per
// line), the whole loudness-normalised to -14 LUFS, true peak -1 dB (two passes). Writes siegemate.json: every
// segment's place and every line's start and end in the film, and the measured loudness.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

import { probe, x264Args } from "./lib/encode.ts";
import { filmOptions } from "./lib/options.ts";
import { resolveShot } from "./shots/index.ts";

interface Line {
  id: string;
  /** Seconds after the segment's start. */
  at: number;
}
interface Segment {
  /** A shot (letter or name), or "card:end". */
  shot: string;
  /** Seconds into the shot's clip; `to` null for its end. */
  from?: number;
  to?: number | null;
  /** For a card: how long it holds. */
  seconds?: number;
  caption?: string;
  tags?: Array<{ text: string; at: number; until?: number }>;
  lines?: Line[];
  /** Lift (or cut) this segment's own game sound, dB: a stretch with no voice over it sits low otherwise. */
  gainDb?: number;
}
interface Cut {
  segments: Segment[];
  /** Game sound under the voice: level (dB) and how far it ducks while she speaks. */
  bedDb: number;
  /** Seconds of fade at the head and tail. */
  fadeIn: number;
  fadeOut: number;
}

const o = filmOptions();
const W = o.outWidth, H = o.outHeight, FPS = o.fps;
const s = H / 1080;
const cut = JSON.parse(fs.readFileSync(process.env.CUT ?? new URL("./cut.json", import.meta.url), "utf8")) as Cut;
const work = path.join(o.outDir, "cut");
fs.mkdirSync(work, { recursive: true });
const narrationDir = path.resolve(process.env.FILM_OUT ?? "film-out", "narration");
const ff = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
const hasAudio = (f: string) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", f], { encoding: "utf8" }).trim() !== "";
const dur = (f: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).trim());

// ---- the segments, measured.
type Placed = Segment & { clip: string | null; start: number; length: number; name: string };
const placed: Placed[] = [];
let t = 0;
for (const seg of cut.segments) {
  let clip: string | null = null;
  let length: number;
  let name = seg.shot;
  if (seg.shot.startsWith("card:")) {
    length = seg.seconds ?? 4;
  } else {
    name = resolveShot(seg.shot);
    clip = path.join(o.outDir, `${name}.mp4`);
    if (!fs.existsSync(clip)) throw new Error(`no ${name}.mp4 in ${o.outDir}: render the shots first`);
    const clipSeconds = probe(clip).frames / FPS;
    const from = seg.from ?? 0;
    const to = Math.min(seg.to ?? clipSeconds, clipSeconds);
    if (to <= from) throw new Error(`${name}: from ${from} is past the clip's end ${clipSeconds.toFixed(2)}`);
    length = to - from;
  }
  length = Math.round(length * FPS) / FPS;
  placed.push({ ...seg, clip, start: t, length, name });
  t += length;
}
const total = t;

// ---- overlays, drawn by Chromium with the game's fonts.
const fontUrl = (f: string) => `data:font/woff2;base64,${fs.readFileSync(path.join("public/fonts", f)).toString("base64")}`;
const css = `
@font-face { font-family: Inter; src: url(${fontUrl("inter-latin.woff2")}) format("woff2"); font-weight: 100 900; }
@font-face { font-family: Cinzel; src: url(${fontUrl("cinzel-latin.woff2")}) format("woff2"); font-weight: 400 900; }
html, body { margin: 0; background: transparent; }
.frame { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; }
.caption { position: absolute; left: 50%; bottom: ${Math.round(70 * s)}px; transform: translateX(-50%); white-space: nowrap;
  font: 600 ${Math.round(34 * s)}px/1.2 Inter, sans-serif; color: #fff6e8; letter-spacing: 0.01em;
  padding: ${Math.round(14 * s)}px ${Math.round(28 * s)}px; border-radius: ${Math.round(14 * s)}px;
  background: rgba(14, 15, 18, 0.72); box-shadow: 0 ${Math.round(6 * s)}px ${Math.round(30 * s)}px rgba(0,0,0,0.35); }
.caption b { color: #e8b75a; font-weight: 700; }
.tag { position: absolute; right: ${Math.round(48 * s)}px; top: ${Math.round(44 * s)}px; display: flex; align-items: center; gap: ${Math.round(12 * s)}px;
  font: 700 ${Math.round(30 * s)}px/1 Inter, sans-serif; color: #fff6e8; padding: ${Math.round(14 * s)}px ${Math.round(24 * s)}px;
  border-radius: 999px; background: rgba(150, 30, 30, 0.86); }
.tag i { width: ${Math.round(14 * s)}px; height: ${Math.round(14 * s)}px; border-radius: 50%; background: #ffd2c4; display: block; }
.end { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 45%, #232530 0%, #0e0f12 70%);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${Math.round(26 * s)}px; }
.end h1 { margin: 0; font: 700 ${Math.round(132 * s)}px/1 Cinzel, serif; letter-spacing: 0.08em; color: #e8b75a; }
.end p { margin: 0; font: 500 ${Math.round(36 * s)}px/1.3 Inter, sans-serif; color: #fff6e8; opacity: 0.9; }
.end .url { font-weight: 700; color: #fff6e8; opacity: 1; font-size: ${Math.round(44 * s)}px; margin-top: ${Math.round(10 * s)}px; }
.end .small { font-size: ${Math.round(24 * s)}px; opacity: 0.6; margin-top: ${Math.round(18 * s)}px; }
`;
const escape = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const caption = (text: string) => `<div class="caption">${escape(text).replace(/ · /g, " <b>·</b> ")}</div>`;
const overlays: Array<{ png: string; start: number; end: number; fade: number }> = [];
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  let n = 0;
  const draw = async (html: string) => {
    const png = path.join(work, `overlay-${String(n++).padStart(2, "0")}.png`);
    await page.setContent(`<!doctype html><style>${css}</style><div class="frame">${html}</div>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: png, omitBackground: true });
    return png;
  };
  for (const seg of placed) {
    if (seg.shot === "card:end") {
      overlays.push({
        png: await draw(`<div class="end"><h1>SIEGEMATE</h1><p>Living armies, on your table.</p><p class="url">siegemate.pages.dev</p><p class="small">Open in the Meta Quest browser · plays offline after the first visit</p></div>`),
        start: seg.start, end: seg.start + seg.length, fade: 0.5,
      });
      continue;
    }
    if (seg.caption) overlays.push({ png: await draw(caption(seg.caption)), start: seg.start + 0.35, end: seg.start + seg.length - 0.15, fade: 0.25 });
    for (const tag of seg.tags ?? []) {
      overlays.push({ png: await draw(`<div class="tag"><i></i>${escape(tag.text)}</div>`), start: seg.start + tag.at, end: seg.start + (tag.until ?? seg.length), fade: 0.2 });
    }
  }
} finally {
  await browser.close();
}

// ---- picture: the segments cut together, the overlays on top, faded at both ends.
const picture = path.join(work, "picture.mp4");
{
  const inputs: string[] = [];
  const chains: string[] = [];
  placed.forEach((seg, i) => {
    if (seg.clip) inputs.push("-ss", (seg.from ?? 0).toFixed(3), "-t", seg.length.toFixed(3), "-i", seg.clip);
    else inputs.push("-f", "lavfi", "-t", seg.length.toFixed(3), "-i", `color=c=0x0e0f12:s=${W}x${H}:r=${FPS}`);
    chains.push(`[${i}:v]scale=${W}:${H}:flags=lanczos,fps=${FPS},setsar=1,format=yuv420p,trim=duration=${seg.length.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
  });
  chains.push(`${placed.map((_, i) => `[v${i}]`).join("")}concat=n=${placed.length}:v=1:a=0[cat]`);
  let last = "cat";
  overlays.forEach((ov, k) => {
    const idx = placed.length + k;
    inputs.push("-loop", "1", "-framerate", String(FPS), "-t", total.toFixed(3), "-i", ov.png);
    const d = Math.max(0.05, ov.end - ov.start);
    chains.push(`[${idx}:v]format=rgba,fade=in:st=${ov.start.toFixed(3)}:d=${Math.min(ov.fade, d / 2).toFixed(3)}:alpha=1,fade=out:st=${(ov.end - Math.min(ov.fade, d / 2)).toFixed(3)}:d=${Math.min(ov.fade, d / 2).toFixed(3)}:alpha=1[o${k}]`);
    chains.push(`[${last}][o${k}]overlay=0:0:enable='between(t,${ov.start.toFixed(3)},${ov.end.toFixed(3)})':format=auto[c${k}]`);
    last = `c${k}`;
  });
  chains.push(`[${last}]fade=in:st=0:d=${cut.fadeIn},fade=out:st=${(total - cut.fadeOut).toFixed(3)}:d=${cut.fadeOut},format=yuv420p[v]`);
  ff([...inputs, "-filter_complex", chains.join(";"), "-map", "[v]", "-t", total.toFixed(3), ...x264Args({ crf: o.crf, preset: o.preset, fps: FPS }), "-an", picture]);
}

// ---- sound: the game bed (each segment's own mix, or silence), the narration over it, ducked, then -14 LUFS.
const voiceLines: Array<{ id: string; start: number; end: number; text?: string }> = [];
const mix = path.join(work, "mix.wav");
{
  const inputs: string[] = [];
  const chains: string[] = [];
  placed.forEach((seg, i) => {
    if (seg.clip && hasAudio(seg.clip)) inputs.push("-ss", (seg.from ?? 0).toFixed(3), "-t", seg.length.toFixed(3), "-i", seg.clip);
    else inputs.push("-f", "lavfi", "-t", seg.length.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
    chains.push(`[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=${seg.length.toFixed(3)},apad=whole_dur=${seg.length.toFixed(3)},asetpts=PTS-STARTPTS${seg.gainDb ? `,volume=${seg.gainDb}dB` : ""}[a${i}]`);
  });
  chains.push(`${placed.map((_, i) => `[a${i}]`).join("")}concat=n=${placed.length}:v=0:a=1,volume=${cut.bedDb}dB[bed]`);
  const known = fs.existsSync(path.join(narrationDir, "lines.json")) ? (JSON.parse(fs.readFileSync(path.join(narrationDir, "lines.json"), "utf8")) as Array<{ id: string; text: string }>) : [];
  const voices: string[] = [];
  for (const seg of placed) {
    for (const line of seg.lines ?? []) {
      const wav = path.join(narrationDir, `${line.id}.wav`);
      if (!fs.existsSync(wav)) {
        console.warn(`[cut] no narration ${line.id}.wav yet: left out`);
        continue;
      }
      const start = seg.start + line.at;
      const idx = placed.length + voices.length;
      inputs.push("-i", wav);
      chains.push(`[${idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(start * 1000)}:all=1[n${voices.length}]`);
      voices.push(`[n${voices.length}]`);
      voiceLines.push({ id: line.id, start: Math.round(start * 100) / 100, end: Math.round((start + dur(wav)) * 100) / 100, text: known.find((k) => k.id === line.id)?.text });
    }
  }
  if (voices.length) {
    chains.push(`${voices.join("")}amix=inputs=${voices.length}:normalize=0:duration=longest,apad=whole_dur=${total.toFixed(3)},atrim=duration=${total.toFixed(3)},asplit=2[voice][key]`);
    chains.push(`[bed][key]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=450:makeup=1[ducked]`);
    chains.push(`[ducked][voice]amix=inputs=2:normalize=0:duration=first,afade=t=out:st=${(total - cut.fadeOut).toFixed(3)}:d=${cut.fadeOut}[out]`);
  } else {
    chains.push(`[bed]afade=t=out:st=${(total - cut.fadeOut).toFixed(3)}:d=${cut.fadeOut}[out]`);
  }
  ff([...inputs, "-filter_complex", chains.join(";"), "-map", "[out]", "-t", total.toFixed(3), "-c:a", "pcm_s24le", mix]);
}
// Overlapping lines would talk over each other: say so.
voiceLines.sort((a, b) => a.start - b.start).forEach((l, i, all) => {
  const next = all[i + 1];
  if (next && next.start < l.end + 0.15) console.warn(`[cut] ${l.id} runs into ${next.id} (${l.end.toFixed(2)} > ${next.start.toFixed(2)})`);
});

const loudness = (file: string) => {
  const r = execFileSync("sh", ["-c", `ffmpeg -hide_banner -i "${file}" -af loudnorm=I=-14:TP=-1:print_format=json -f null - 2>&1`], { encoding: "utf8" });
  const j = JSON.parse(r.slice(r.lastIndexOf("{"), r.lastIndexOf("}") + 1)) as Record<string, string>;
  return { i: Number(j.input_i), tp: Number(j.input_tp) };
};
// The gain that brings the mix to -14 LUFS, then an oversampled limiter a little under -1 dB. The limiter takes some
// loudness off the fights' peaks, so measure again and add what is missing (a few rounds).
const leveled = path.join(work, "leveled.wav");
let gain = -14 - loudness(mix).i;
for (let round = 0; round < 5; round++) {
  ff(["-i", mix, "-af", `volume=${gain.toFixed(2)}dB,aresample=192000,alimiter=limit=0.7:attack=2:release=60:level=disabled,aresample=48000`, "-c:a", "pcm_s24le", leveled]);
  const got = loudness(leveled).i;
  if (Math.abs(got + 14) < 0.3) break;
  gain += -14 - got;
}
const out = path.join(o.outDir, "siegemate.mp4");
ff(["-i", picture, "-i", leveled, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-t", total.toFixed(3), out]);
const final = loudness(out);
fs.writeFileSync(
  path.join(o.outDir, "siegemate.json"),
  `${JSON.stringify({ seconds: Math.round(total * 1000) / 1000, size: `${W}x${H}`, fps: FPS, loudness: { lufs: final.i, truePeak: final.tp, gainDb: Math.round(gain * 100) / 100 }, segments: placed.map((p) => ({ shot: p.name, from: p.from ?? 0, start: Math.round(p.start * 1000) / 1000, seconds: p.length, caption: p.caption })), lines: voiceLines }, null, 2)}\n`,
);
console.log(`[cut] ${placed.length} segments, ${total.toFixed(1)} s, ${voiceLines.length} narration lines, ${final.i} LUFS / ${final.tp} dBTP -> ${out}`);
