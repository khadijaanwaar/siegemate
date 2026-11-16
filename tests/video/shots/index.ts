// The film's shots, one file each, named for the order they were planned in (a to h). A shot is
// asked for by its full name or by its letter: `scripts/video.sh --shots a,b,c`. Stills (README and
// Devpost images) live in ../stills/ and are asked for as `still:<name>` (`--stills hero,menu`).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PageShot } from "../lib/pageshot.ts";
import type { Shot } from "../lib/shot.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const stillsDir = path.join(here, "..", "stills");

export function shotNames(): string[] {
  return fs
    .readdirSync(here)
    .filter((f) => /^[a-z]-[a-z0-9-]+\.ts$/.test(f))
    .map((f) => f.replace(/\.ts$/, ""))
    .sort();
}

export function stillNames(): string[] {
  return fs
    .readdirSync(stillsDir)
    .filter((f) => /^[a-z0-9-]+\.ts$/.test(f) && !f.startsWith("_"))
    .map((f) => f.replace(/\.ts$/, ""))
    .sort();
}

/** `b` or `b-first-move` to the shot's file name; `still:hero` to `still:hero`. */
export function resolveShot(name: string): string {
  if (name.startsWith("still:")) {
    const still = name.slice(6);
    if (!stillNames().includes(still)) throw new Error(`no still "${still}" (have: ${stillNames().join(", ")})`);
    return name;
  }
  const names = shotNames();
  const hit = names.find((n) => n === name) ?? names.find((n) => /^[a-z]$/.test(name) && n.startsWith(`${name}-`));
  if (!hit) throw new Error(`no shot "${name}" (have: ${names.join(", ")})`);
  return hit;
}

export async function findShot(name: string): Promise<Shot | PageShot> {
  const file = resolveShot(name);
  const [dir, base] = file.startsWith("still:") ? [stillsDir, file.slice(6)] : [here, file];
  const mod = (await import(path.join(dir, `${base}.ts`))) as { default: Shot | PageShot };
  if (mod.default.name !== base) throw new Error(`${base}.ts names itself "${mod.default.name}"`);
  return mod.default;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // node tests/video/shots/index.ts a,b | all | stills:all | stills:hero,menu  ->  resolved names (for scripts/video.sh)
  const ask = process.argv[2] ?? "all";
  if (ask.startsWith("stills:")) {
    const list = ask.slice(7);
    console.log((list === "all" ? stillNames() : list.split(",").map((s) => s.trim())).map((s) => resolveShot(`still:${s}`)).join(" "));
  } else {
    console.log((ask !== "all" ? ask.split(",").map((s) => resolveShot(s.trim())) : shotNames()).join(" "));
  }
}
