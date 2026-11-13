#!/usr/bin/env node
/**
 * Asset budget, run before every `vite build`. Fails (exit 1) when:
 *   - any file in `src/` still points at the generator's CDN,
 *   - an asset named in `src/assets/generated.ts` is missing from `public/assets/`,
 *   - a sculpt draws more triangles than its ceiling (FIGURE_TRIANGLES per
 *     piece for the rigged figures and their stills, PROP_TRIANGLES for the
 *     weapons and rounds; see asset-catalog.mjs),
 *   - `public/assets/` as a whole is over 25 MiB.
 *
 * Dependency-free on purpose: triangle counts come from each GLB's JSON chunk,
 * so the check needs no decoder and runs in well under a second.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { countGlbTriangles, listAssets, PUBLIC_ASSETS, ROOT, triangleLimit } from "./asset-catalog.mjs";

const REMOTE_HOST = "r2-pub.rork.com";
const BUDGET_BYTES = 25 * 1024 * 1024;

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map((entry) => {
      const full = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(full) : [full];
    }),
  );
  return files.flat();
}

async function main() {
  const failures = [];

  for (const file of await listFiles(path.join(ROOT, "src"))) {
    const text = await readFile(file, "utf8");
    if (text.includes(REMOTE_HOST)) failures.push(`${path.relative(ROOT, file)} still references ${REMOTE_HOST}`);
  }

  const assets = await listAssets();
  let sculpts = 0;
  for (const asset of assets) {
    const file = path.join(PUBLIC_ASSETS, asset.kind, asset.file);
    const size = await stat(file).then(
      (info) => info.size,
      () => null,
    );
    if (size === null) {
      failures.push(`missing ${path.relative(ROOT, file)} (run node tools/optimize-assets.mjs)`);
      continue;
    }
    const limit = triangleLimit(asset);
    if (limit === null) continue;
    sculpts += 1;
    const triangles = countGlbTriangles(await readFile(file));
    if (triangles > limit) {
      failures.push(`${asset.file} (${asset.role}${asset.piece ? ` ${asset.piece}` : ""}) draws ${triangles} triangles, ceiling ${limit}`);
    }
  }

  let total = 0;
  for (const file of await listFiles(PUBLIC_ASSETS)) total += (await stat(file)).size;
  const mib = (bytes) => (bytes / 1024 / 1024).toFixed(2);
  if (total > BUDGET_BYTES) failures.push(`public/assets is ${mib(total)} MiB, budget ${mib(BUDGET_BYTES)} MiB`);

  if (failures.length > 0) {
    console.error(`check-assets: ${failures.length} problem(s)`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(
    `check-assets: ${assets.length} assets self-hosted, ${sculpts} sculpts within their triangle ceilings, ` +
      `public/assets ${mib(total)} / ${mib(BUDGET_BYTES)} MiB`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
