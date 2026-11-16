// A new deploy reaches a returning player without closing any tabs:
// version 1 is served and cached, version 2 replaces it on the server,
// one reload later the page is running version 2 (at the menu).
//
//   node tests/e2e/update.mjs
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { chromium } from "playwright";

import { takeGpuLock } from "../../tools/gpu-lock.mjs";

await takeGpuLock();
const out = mkdtempSync(join(tmpdir(), "update-"));
const build = (id) =>
  execFileSync("npx", ["vite", "build", "--outDir", out, "--emptyOutDir"], { stdio: "ignore", env: { ...process.env, VITE_BUILD_ID: id } });

// A plain static server that reads the disk on every request (so a rebuild is
// live at once), with the same no-cache rule the real host uses for sw.js.
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const server = createServer((request, response) => {
  let path = decodeURIComponent(new URL(request.url, "http://x").pathname);
  if (path === "/") path = "/index.html";
  const file = join(out, path);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": types[extname(file)] ?? "application/octet-stream",
    "Cache-Control": path === "/sw.js" || path === "/index.html" ? "no-cache" : "public, max-age=60",
  });
  createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, resolve));
const url = `http://localhost:${server.address().port}/`;

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

try {
  build("v1");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.__siegemateBuild, null, { timeout: 60000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  check((await page.evaluate(() => window.__siegemateBuild)) === "v1", "version 1 is served and cached");
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => undefined);

  build("v2");
  await page.reload();
  // The cached v1 starts, finds v2 on the server, and switches to it by itself.
  await page.waitForFunction(() => window.__siegemateBuild === "v2", null, { timeout: 90000 }).catch(() => undefined);
  check((await page.evaluate(() => window.__siegemateBuild)) === "v2", "one reload later the page runs version 2, no tabs closed");
  await browser.close();
} finally {
  server.close();
  rmSync(out, { recursive: true, force: true }); // this run's own build, nothing else
}
process.exit(failures.length ? 1 : 0);
