// After the shots are rendered (no GPU needed):
//   node tests/video/deliver.ts stills <shot>       three full-size stills and a 12-frame contact sheet
//   node tests/video/deliver.ts rough <a,b,c>       the shots cut together in order (hard cuts) as
//                                                   rough.mp4, with rough.json: each shot's place in
//                                                   the cut and every event at its time in the cut
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { probe, x264Args } from "./lib/encode.ts";
import { filmOptions } from "./lib/options.ts";
import { resolveShot } from "./shots/index.ts";

const o = filmOptions();
const [cmd, arg] = process.argv.slice(2);
const ff = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });

if (cmd === "stills") {
  const name = resolveShot(arg ?? "");
  const mp4 = path.join(o.outDir, `${name}.mp4`);
  const info = probe(mp4);
  [0.25, 0.5, 0.75].forEach((k, i) => {
    const frame = Math.min(info.frames - 1, Math.round(info.frames * k));
    ff(["-i", mp4, "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", "-update", "1", path.join(o.outDir, `${name}-still-${i + 1}.png`)]);
  });
  const every = Math.max(1, Math.floor(info.frames / 12));
  ff(["-i", mp4, "-vf", `select=not(mod(n\\,${every})),scale=480:-2,tile=4x3:padding=4:color=black`, "-frames:v", "1", "-update", "1", path.join(o.outDir, `${name}-contact.png`)]);
  console.log(`[film] ${name}: stills and contact sheet in ${o.outDir}`);
} else if (cmd === "sound") {
  // A rough track of the game's own sound: every sample the game started during the shot (from the
  // event log), laid in at its time from the built game's files. The game's synthesized sounds
  // (oscillator blips and thumps) and its mixing levels are not in it; long samples (the score)
  // go in quieter. Muxed into <shot>.mp4 as AAC; the picture is copied.
  const name = resolveShot(arg ?? "");
  const mp4 = path.join(o.outDir, `${name}.mp4`);
  const side = JSON.parse(fs.readFileSync(path.join(o.outDir, `${name}.json`), "utf8")) as { delivery: { seconds: number }; events: Array<{ t: number; type: string; file?: string | null; offset?: number; seconds?: number; loop?: boolean; rate?: number }> };
  const total = side.delivery.seconds;
  const sounds = side.events.filter((e) => e.type === "sound" && e.file && fs.existsSync(path.join("film-out/.build", e.file)));
  if (sounds.length === 0) {
    console.log(`[film] ${name}: no game samples to lay in`);
  } else {
    const files = [...new Set(sounds.map((s) => s.file!))];
    const inputs = files.flatMap((f) => ["-i", path.join("film-out/.build", f)]);
    const parts: string[] = [];
    files.forEach((_, i) => parts.push(`[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=${sounds.filter((s) => s.file === files[i]).length}${sounds.filter((s) => s.file === files[i]).map((__, k) => `[f${i}_${k}]`).join("")}`));
    const used = new Map<string, number>();
    sounds.forEach((s, n) => {
      const i = files.indexOf(s.file!);
      const k = used.get(s.file!) ?? 0;
      used.set(s.file!, k + 1);
      const left = Math.max(0.05, total - s.t);
      const long = (s.seconds ?? 0) > 8 || s.loop;
      const src = s.loop ? `[f${i}_${k}]aloop=loop=-1:size=2147483647,` : `[f${i}_${k}]`;
      const dur = Math.min(left, s.loop ? left : (s.seconds ?? left));
      parts.push(`${src}atrim=start=${(s.offset ?? 0).toFixed(3)}:duration=${dur.toFixed(3)},asetpts=PTS-STARTPTS,volume=${long ? 0.35 : 0.8},adelay=${Math.round(s.t * 1000)}:all=1[s${n}]`);
    });
    parts.push(`${sounds.map((_, n) => `[s${n}]`).join("")}amix=inputs=${sounds.length}:normalize=0:duration=longest,apad,atrim=duration=${total.toFixed(3)},alimiter=limit=0.89[mix]`);
    const tmp = mp4.replace(/\.mp4$/, ".sound.mp4");
    ff(["-i", mp4, ...inputs, "-filter_complex", parts.join(";"), "-map", "0:v", "-map", "[mix]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", tmp]);
    fs.renameSync(tmp, mp4);
    console.log(`[film] ${name}: ${sounds.length} game samples laid in (rough; synthesized sounds are not in it)`);
  }
} else if (cmd === "rough") {
  const names = (arg ?? "").split(",").filter(Boolean).map(resolveShot);
  const clips = names.map((n) => path.join(o.outDir, `${n}.mp4`)).filter((f) => fs.existsSync(f));
  if (clips.length === 0) throw new Error(`no rendered shots of ${names.join(", ")} in ${o.outDir}`);
  const out = path.join(o.outDir, "rough.mp4");
  const inputs = clips.flatMap((c) => ["-i", c]);
  // With the game's sound in every clip the cut keeps it; otherwise it is silent.
  const sound = clips.every((c) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", c], { encoding: "utf8" }).trim() !== "");
  const filter = sound
    ? `${clips.map((_, i) => `[${i}:v][${i}:a]`).join("")}concat=n=${clips.length}:v=1:a=1[cv][a];[cv]format=yuv420p[v]`
    : `${clips.map((_, i) => `[${i}:v]`).join("")}concat=n=${clips.length}:v=1:a=0,format=yuv420p[v]`;
  const audio = sound ? ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] : ["-an"];
  ff([...inputs, "-filter_complex", filter, "-map", "[v]", ...x264Args({ crf: o.crf, preset: o.preset, fps: o.fps }), ...audio, out]);
  let at = 0;
  const cut: Array<{ shot: string; start: number; seconds: number }> = [];
  const events: Array<Record<string, unknown>> = [];
  for (const clip of clips) {
    const shot = path.basename(clip, ".mp4");
    const seconds = probe(clip).frames / o.fps;
    cut.push({ shot, start: Math.round(at * 1000) / 1000, seconds: Math.round(seconds * 1000) / 1000 });
    const json = path.join(o.outDir, `${shot}.json`);
    if (fs.existsSync(json)) {
      const side = JSON.parse(fs.readFileSync(json, "utf8")) as { events: Array<{ t: number } & Record<string, unknown>> };
      for (const e of side.events) events.push({ ...e, shot, t: Math.round((at + e.t) * 1000) / 1000, shotT: e.t });
    }
    at += seconds;
  }
  fs.writeFileSync(path.join(o.outDir, "rough.json"), `${JSON.stringify({ seconds: Math.round(at * 1000) / 1000, cut, events }, null, 2)}\n`);
  console.log(`[film] rough cut of ${cut.length} shots, ${at.toFixed(1)} s -> ${out}`);
} else {
  console.error("usage: node tests/video/deliver.ts stills <shot> | rough <a,b,c>");
  process.exit(2);
}
