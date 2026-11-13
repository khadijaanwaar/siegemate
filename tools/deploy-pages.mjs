// Uploads a built site to Cloudflare Pages' asset store (the Direct Upload flow)
// and writes the manifest the deployment is created from.
//
//   CF_PAGES_JWT=<upload token> node tools/deploy-pages.mjs dist .perf/pages-manifest.json
//
// The upload token is short-lived and scoped to one Pages project; it comes from
// GET /accounts/{id}/pages/projects/{name}/upload-token (we fetch it through the
// Cloudflare MCP connection, which then also creates the deployment from the
// manifest: see docs/deploy.md). Nothing secret is written to disk.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { extname, join, relative, sep } from "node:path";

const API = "https://api.cloudflare.com/client/v4";
const [dist = "dist", manifestOut = ".perf/pages-manifest.json"] = process.argv.slice(2);
const jwt = process.env.CF_PAGES_JWT;
if (!jwt) {
  console.error("CF_PAGES_JWT is not set");
  process.exit(2);
}

/** Pages reads these as deployment settings, not as files to serve. */
const CONTROL_FILES = new Set(["_headers", "_redirects", "_routes.json"]);
const MAX_BUCKET_BYTES = 40 * 1024 * 1024;
const MAX_BUCKET_FILES = 1000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const TYPES = {
  ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".xml": "application/xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".ktx2": "image/ktx2",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4",
  ".woff2": "font/woff2", ".woff": "font/woff", ".wasm": "application/wasm",
};

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

async function api(path, body) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success) {
    throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(json?.errors ?? json).slice(0, 300)}`);
  }
  return json.result;
}

const files = walk(dist)
  .filter((path) => !CONTROL_FILES.has(relative(dist, path)) && !path.endsWith(".DS_Store"))
  .map((path) => {
    const bytes = readFileSync(path);
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`${path} is over Pages' 25 MiB file limit`);
    const base64 = bytes.toString("base64");
    const extension = extname(path).toLowerCase();
    // Content-addressed key (32 hex chars, the shape Pages uses), over content + extension.
    const hash = createHash("sha256").update(base64 + extension.slice(1)).digest("hex").slice(0, 32);
    const url = `/${relative(dist, path).split(sep).join("/")}`;
    return { url, hash, base64, size: bytes.length, contentType: TYPES[extension] ?? "application/octet-stream" };
  });

const missing = new Set(await api("/pages/assets/check-missing", { hashes: [...new Set(files.map((file) => file.hash))] }));
const toUpload = [...new Map(files.filter((file) => missing.has(file.hash)).map((file) => [file.hash, file])).values()];

let bucket = [];
let bucketBytes = 0;
let uploaded = 0;
const flush = async () => {
  if (bucket.length === 0) return;
  await api(
    "/pages/assets/upload",
    bucket.map((file) => ({ key: file.hash, value: file.base64, metadata: { contentType: file.contentType }, base64: true })),
  );
  uploaded += bucket.length;
  console.log(`  uploaded ${uploaded}/${toUpload.length}`);
  bucket = [];
  bucketBytes = 0;
};
for (const file of toUpload) {
  if (bucket.length >= MAX_BUCKET_FILES || bucketBytes + file.base64.length > MAX_BUCKET_BYTES) await flush();
  bucket.push(file);
  bucketBytes += file.base64.length;
}
await flush();
await api("/pages/assets/upsert-hashes", { hashes: files.map((file) => file.hash) });

const manifest = Object.fromEntries(files.map((file) => [file.url, file.hash]));
writeFileSync(manifestOut, JSON.stringify(manifest));
// Gzipped + base64 for handing to the deployment call (the MCP sandbox can gunzip it).
writeFileSync(`${manifestOut}.gz.b64`, gzipSync(JSON.stringify(manifest), { level: 9 }).toString("base64"));
const total = files.reduce((sum, file) => sum + file.size, 0);
console.log(`${files.length} files (${(total / 1e6).toFixed(1)} MB), ${toUpload.length} uploaded, manifest -> ${manifestOut}`);
