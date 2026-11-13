#!/usr/bin/env node
/**
 * Downloads every generated asset the game references and writes a
 * Quest-ready copy of it under `public/assets/{models,audio,cards}/`, keeping
 * the original file names (cards become `.webp`).
 *
 *   node tools/optimize-assets.mjs                  # build what is missing
 *   node tools/optimize-assets.mjs --force          # rebuild every output
 *   node tools/optimize-assets.mjs --only=<text>    # files whose name contains <text>
 *   node tools/optimize-assets.mjs --download-only  # fill .asset-cache/ and stop
 *
 * The list comes from `src/assets/generated.ts` (see `asset-catalog.mjs`).
 * Downloads are cached in `.asset-cache/`, so a re-run only re-optimizes, and
 * an output that already exists is skipped unless `--force` is given. A full
 * rebuild takes several minutes: every sculpt's texture is re-baked.
 *
 * Per role:
 *   figure  rigged sculpt: simplified to its piece's triangle ceiling with the
 *           texture re-baked onto fresh UVs (see rebake.mjs), 1024 px WebP,
 *           meshopt.
 *   still   the unrigged fallback of the same sculpt: same treatment.
 *   arm, shot  sculpted weapons and rounds: same, to the prop ceilings, with
 *           512 px textures (they are a fraction of a figure on screen).
 *   clip    skeletal clip: only nodes + the animation ship (the generator's
 *           clips carry no mesh). Keyframes are kept as sampled:
 *           `measureGaitCycle` in `scene/pieces.ts` assumes evenly spaced
 *           frames, which a resample would break. Meshopt filters store
 *           rotations as 16-bit quaternions.
 *   landmark   WebP + meshopt only.
 *   audio   copied unchanged.
 *   card    1024 px wide WebP.
 *
 * Positions are quantized only on skinned meshes. There the skin's inverse
 * bind matrices absorb the quantization transform, so the skinned vertex the
 * shaders see (`transformed`, which the dissolve reads) is unchanged. On a
 * static mesh the same transform would move the mesh's local space.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, quantize, reorder, textureCompress } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

import { countGlbTriangles, listAssets, PUBLIC_ASSETS, ROOT, triangleLimit } from "./asset-catalog.mjs";
import { rebakeReady, simplifyAndRebake } from "./rebake.mjs";

const CACHE = path.join(ROOT, ".asset-cache");
const TEXTURE_SIZE = { figure: 1024, still: 1024, arm: 512, shot: 512, landmark: 1024 };
const TEXTURE_QUALITY = 75;
const CARD_WIDTH = 1024;
const CARD_QUALITY = 80;

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const DOWNLOAD_ONLY = args.includes("--download-only");
const ONLY = args.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);

/** Cached download, retried with back-off; returns the cache path. */
async function download(asset) {
  const name = asset.remote.slice(asset.remote.lastIndexOf("/") + 1);
  const target = path.join(CACHE, asset.kind, name);
  if (existsSync(target)) return target;
  await mkdir(path.dirname(target), { recursive: true });
  let last;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(asset.remote);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      await writeAtomically(target, Buffer.from(await response.arrayBuffer()));
      return target;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw new Error(`download failed for ${asset.remote}: ${last}`);
}

async function mapLimit(items, limit, job) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await job(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

function createIO() {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });
}

function countTriangles(document) {
  let triangles = 0;
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4) continue;
      const indices = primitive.getIndices();
      triangles += (indices ? indices.getCount() : primitive.getAttribute("POSITION").getCount()) / 3;
    }
  }
  return triangles;
}

/** Drops everything a clip file does not need: it is read for its animation only. */
function stripToAnimation(document) {
  const root = document.getRoot();
  for (const node of root.listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
  }
  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const skin of root.listSkins()) skin.dispose();
  for (const material of root.listMaterials()) material.dispose();
  for (const texture of root.listTextures()) texture.dispose();
  for (const extension of root.listExtensionsUsed()) {
    if (extension.extensionName.startsWith("KHR_materials_")) extension.dispose();
  }
}

/** Simplifies to the ceiling, re-baking each primitive's texture (see rebake.mjs). */
async function simplifyModel(document, limit, textureSize) {
  const before = countTriangles(document);
  if (before <= limit) return;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4 || !primitive.getIndices()) continue;
      const share = Math.floor(((primitive.getIndices().getCount() / 3) * limit) / before);
      await simplifyAndRebake(document, primitive, share, textureSize);
    }
  }
  const after = countTriangles(document);
  if (after > limit) throw new Error(`could not simplify ${before} triangles under ${limit}`);
}

async function compressGeometry(document) {
  const root = document.getRoot();
  if (root.listMeshes().length > 0) {
    const skinned = root.listNodes().some((node) => node.getSkin() && node.getMesh());
    await document.transform(
      reorder({ encoder: MeshoptEncoder, target: "size" }),
      quantize({
        pattern: skinned ? /^(POSITION|TEXCOORD|JOINTS|WEIGHTS|COLOR)(_\d+)?$/ : /^(TEXCOORD|JOINTS|WEIGHTS|COLOR)(_\d+)?$/,
        patternTargets: /^(TEXCOORD|COLOR)(_\d+)?$/,
        quantizeNormal: 8,
      }),
    );
  }
  document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
}

async function optimizeModel(asset, input, output) {
  const io = createIO();
  const document = await io.read(input);
  document.setLogger({ debug() {}, info() {}, warn: (message) => console.warn(`  ${asset.file}: ${message}`), error: console.error });

  if (asset.role === "clip") stripToAnimation(document);
  await document.transform(prune({ keepLeaves: true, keepAttributes: false }), dedup());

  const limit = triangleLimit(asset);
  const textureSize = TEXTURE_SIZE[asset.role] ?? 1024;
  if (limit !== null) {
    try {
      await simplifyModel(document, limit, textureSize);
    } catch (error) {
      throw new Error(`${asset.file}: ${error.message}`);
    }
  }
  if (document.getRoot().listTextures().length > 0) {
    await document.transform(
      textureCompress({
        encoder: sharp,
        targetFormat: "webp",
        resize: [textureSize, textureSize],
        quality: TEXTURE_QUALITY,
        effort: 100,
      }),
    );
  }
  await compressGeometry(document);
  await document.transform(prune({ keepLeaves: true }));
  await writeAtomically(output, await io.writeBinary(document));
}

async function optimizeCard(input, output) {
  const webp = await sharp(input)
    .resize({ width: CARD_WIDTH, withoutEnlargement: true })
    .webp({ quality: CARD_QUALITY, effort: 6 })
    .toBuffer();
  await writeAtomically(output, webp);
}

async function writeAtomically(target, bytes) {
  await mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.part`;
  await writeFile(partial, bytes);
  await rename(partial, target);
}

async function main() {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, rebakeReady()]);
  const assets = (await listAssets()).filter((asset) => !ONLY || asset.file.includes(ONLY));
  console.log(`${assets.length} assets referenced by src/assets/generated.ts`);

  const sources = await mapLimit(assets, 6, download);
  if (DOWNLOAD_ONLY) return;

  const rows = [];
  await mapLimit(
    assets.map((asset, index) => ({ asset, input: sources[index] })),
    4,
    async ({ asset, input }) => {
      const output = path.join(PUBLIC_ASSETS, asset.kind, asset.file);
      if (FORCE || !existsSync(output)) {
        if (asset.kind === "models") await optimizeModel(asset, input, output);
        else if (asset.kind === "cards") await optimizeCard(input, output);
        else await writeAtomically(output, await readFile(input));
      }
      const before = (await stat(input)).size;
      const after = (await stat(output)).size;
      const triangles =
        asset.kind === "models" ? [countGlbTriangles(await readFile(input)), countGlbTriangles(await readFile(output))] : null;
      rows.push({ asset, before, after, triangles });
    },
  );

  rows.sort((a, b) => `${a.asset.role}/${a.asset.file}`.localeCompare(`${b.asset.role}/${b.asset.file}`));
  const mib = (bytes) => (bytes / 1024 / 1024).toFixed(2);
  for (const { asset, before, after, triangles } of rows) {
    const tris = triangles && triangles[0] > 0 ? `  ${triangles[0]} -> ${triangles[1]} tris` : "";
    console.log(`${asset.role.padEnd(8)} ${asset.piece ?? " "} ${mib(before).padStart(6)} -> ${mib(after).padStart(6)} MiB${tris}  ${asset.file}`);
  }
  const totals = new Map();
  for (const { asset, before, after } of rows) {
    const total = totals.get(asset.kind) ?? { before: 0, after: 0, count: 0 };
    total.before += before;
    total.after += after;
    total.count += 1;
    totals.set(asset.kind, total);
  }
  const all = { before: 0, after: 0 };
  for (const [kind, total] of totals) {
    console.log(`${kind}: ${total.count} files, ${mib(total.before)} MiB -> ${mib(total.after)} MiB`);
    all.before += total.before;
    all.after += total.after;
  }
  console.log(`total: ${mib(all.before)} MiB -> ${mib(all.after)} MiB`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
