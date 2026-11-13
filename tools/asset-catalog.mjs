/**
 * The game's generated assets, as named in `src/assets/generated.ts`.
 *
 * Shared by `optimize-assets.mjs` (which builds `public/assets/`) and
 * `check-assets.mjs` (which guards it in `npm run build`), so both agree on
 * what each file is and how many triangles it may carry.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const GENERATED_TS = path.join(ROOT, "src/assets/generated.ts");
export const PUBLIC_ASSETS = path.join(ROOT, "public/assets");

/** Where each kind of asset lives on the generator's CDN (build-time only). */
export const REMOTE = {
  models: "https://r2-pub.rork.com/generated-3d-models/g9111r67kl6tq85g540sd/",
  audio: "https://r2-pub.rork.com/generated-audio/g9111r67kl6tq85g540sd/",
  cards: "https://r2-pub.rork.com/projects/g9111r67kl6tq85g540sd/assets/",
};

/**
 * Triangle ceiling per figure sculpt, by chess piece. 32 figures at these
 * numbers stay inside the Quest frame budget (250k triangles for everything).
 */
export const FIGURE_TRIANGLES = { p: 3500, k: 7000, q: 7000, b: 5500, n: 5500, r: 5500 };

/**
 * Triangle ceiling for the props: the sculpted weapons ride in every hand of
 * the Grande Armée (eight muskets alone were 28k triangles), and a round in
 * flight is a few pixels across.
 */
export const PROP_TRIANGLES = { arm: 1500, shot: 600 };

/**
 * What one generated file is for, read off the declaration it sits in:
 *   figure   rigged sculpt (ANIMATED_MODELS ...-rigged.glb)
 *   clip     skeletal clip (ANIMATED_MODELS ...-anim-*.glb)
 *   still    unrigged fallback sculpt (STILL_MODELS)
 *   arm      sculpted weapon (ARM_SCULPTS)
 *   shot     sculpted round (SHOT_MODELS)
 *   landmark battleground landmark (ARENA_LANDMARKS)
 *   audio / card
 */
function roleOf(kind, declaration, file) {
  if (kind === "audio") return "audio";
  if (kind === "cards") return "card";
  if (declaration === "ANIMATED_MODELS") return file.includes("-anim-") ? "clip" : "figure";
  if (declaration === "STILL_MODELS") return "still";
  if (declaration === "ARM_SCULPTS") return "arm";
  if (declaration === "SHOT_MODELS") return "shot";
  if (declaration === "ARENA_LANDMARKS") return "landmark";
  throw new Error(`no role for ${kind}/${file} declared in ${declaration}`);
}

function kindOfRemote(url) {
  if (url.startsWith(REMOTE.models)) return "models";
  if (url.startsWith(REMOTE.audio)) return "audio";
  if (url.startsWith(REMOTE.cards)) return "cards";
  throw new Error(`unrecognised asset location: ${url}`);
}

/** Last match of `pattern` (global, multiline) that starts before `index`. */
function lastBefore(text, pattern, index) {
  let found = null;
  for (const match of text.matchAll(pattern)) {
    if (match.index >= index) break;
    found = match;
  }
  return found;
}

/**
 * Every asset named in generated.ts, in either of its two shapes: the
 * original remote URLs (`${MODEL_BASE}/x.glb`, full `https://r2-pub...`
 * strings) or the self-hosted references (`assetUrl("models", "x.glb")`).
 *
 * @returns `{ kind, file, remote, role, piece }[]`, where `file` is the local
 *   name (cards end in `.webp`), `remote` the CDN source and `piece` the chess
 *   piece letter for figures, clips and stills.
 */
export async function listAssets(sourcePath = GENERATED_TS) {
  const raw = await readFile(sourcePath, "utf8");
  // Original shape: expand `${MODEL_BASE}` from `const MODEL_BASE = "https://..."`.
  const bases = new Map();
  for (const match of raw.matchAll(/const\s+(\w+)\s*=\s*"(https:\/\/[^"]+)"/g)) bases.set(match[1], match[2]);
  const text = raw.replace(/\$\{(\w+)\}/g, (whole, name) => bases.get(name) ?? whole);

  const references = [];
  for (const match of text.matchAll(/https:\/\/r2-pub\.rork\.com\/[^"'`\s)]+\.(?:glb|mp3|png)/g)) {
    const url = match[0];
    const kind = kindOfRemote(url);
    const name = url.slice(url.lastIndexOf("/") + 1);
    references.push({ index: match.index, kind, file: kind === "cards" ? name.replace(/\.png$/, ".webp") : name, remote: url });
  }
  for (const match of text.matchAll(/assetUrl\(\s*"(models|audio|cards)"\s*,\s*"([^"]+)"\s*\)/g)) {
    const [, kind, file] = match;
    const remoteName = kind === "cards" ? file.replace(/\.webp$/, ".png") : file;
    references.push({ index: match.index, kind, file, remote: REMOTE[kind] + remoteName });
  }

  const found = new Map();
  for (const reference of references) {
    const declaration = lastBefore(text, /^(?:export\s+)?const\s+(\w+)/gm, reference.index)?.[1] ?? "";
    const role = roleOf(reference.kind, declaration, reference.file);
    const piece =
      role === "figure" || role === "clip" || role === "still"
        ? lastBefore(text, /^\s+([kqbnrp]):/gm, reference.index)?.[1]
        : undefined;
    const key = `${reference.kind}/${reference.file}`;
    const previous = found.get(key);
    if (previous && previous.piece !== piece) throw new Error(`${key} is used as two different pieces`);
    found.set(key, { kind: reference.kind, file: reference.file, remote: reference.remote, role, piece });
  }
  return [...found.values()].sort((a, b) => `${a.kind}/${a.file}`.localeCompare(`${b.kind}/${b.file}`));
}

/** Triangle ceiling for a model, or null when it has none. */
export function triangleLimit(asset) {
  if ((asset.role === "figure" || asset.role === "still") && asset.piece) return FIGURE_TRIANGLES[asset.piece];
  if (asset.role === "arm" || asset.role === "shot") return PROP_TRIANGLES[asset.role];
  return null;
}

/**
 * Triangles a GLB draws, read from its JSON chunk alone: accessor counts are
 * stored in the clear even when the buffers are meshopt-compressed.
 */
export function countGlbTriangles(glb) {
  const json = readGlbJson(glb);
  const meshes = json.meshes ?? [];
  const accessors = json.accessors ?? [];
  let triangles = 0;
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    for (const primitive of meshes[node.mesh].primitives) {
      if ((primitive.mode ?? 4) !== 4) continue;
      const count =
        primitive.indices !== undefined ? accessors[primitive.indices].count : accessors[primitive.attributes.POSITION].count;
      triangles += count / 3;
    }
  }
  return triangles;
}

export function readGlbJson(glb) {
  if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  const length = glb.readUInt32LE(12);
  if (glb.readUInt32LE(16) !== 0x4e4f534a) throw new Error("GLB without a JSON chunk");
  return JSON.parse(glb.subarray(20, 20 + length).toString("utf8"));
}
