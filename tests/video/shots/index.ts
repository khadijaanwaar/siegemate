// The film's shots, one file each, named for the order they were planned in (a to h). A shot is
// asked for by its full name or by its letter: `scripts/video.sh --shots a,b,c`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Shot } from "../lib/shot.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

export function shotNames(): string[] {
  return fs
    .readdirSync(here)
    .filter((f) => /^[a-z]-[a-z0-9-]+\.ts$/.test(f))
    .map((f) => f.replace(/\.ts$/, ""))
    .sort();
}

/** `b` or `b-first-move` to the shot's file name. */
export function resolveShot(name: string): string {
  const names = shotNames();
  const hit = names.find((n) => n === name) ?? names.find((n) => /^[a-z]$/.test(name) && n.startsWith(`${name}-`));
  if (!hit) throw new Error(`no shot "${name}" (have: ${names.join(", ")})`);
  return hit;
}

export async function findShot(name: string): Promise<Shot> {
  const file = resolveShot(name);
  const mod = (await import(path.join(here, `${file}.ts`))) as { default: Shot };
  if (mod.default.name !== file) throw new Error(`shots/${file}.ts names itself "${mod.default.name}"`);
  return mod.default;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // node tests/video/shots/index.ts a,b  ->  prints the resolved names (for scripts/video.sh)
  const ask = process.argv[2];
  console.log((ask && ask !== "all" ? ask.split(",").map((s) => resolveShot(s.trim())) : shotNames()).join(" "));
}
