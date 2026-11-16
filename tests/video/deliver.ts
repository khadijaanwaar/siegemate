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
} else if (cmd === "rough") {
  const names = (arg ?? "").split(",").filter(Boolean).map(resolveShot);
  const clips = names.map((n) => path.join(o.outDir, `${n}.mp4`)).filter((f) => fs.existsSync(f));
  if (clips.length === 0) throw new Error(`no rendered shots of ${names.join(", ")} in ${o.outDir}`);
  const out = path.join(o.outDir, "rough.mp4");
  const inputs = clips.flatMap((c) => ["-i", c]);
  const filter = `${clips.map((_, i) => `[${i}:v]`).join("")}concat=n=${clips.length}:v=1:a=0,format=yuv420p[v]`;
  ff([...inputs, "-filter_complex", filter, "-map", "[v]", ...x264Args({ crf: o.crf, preset: o.preset, fps: o.fps }), "-an", out]);
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
