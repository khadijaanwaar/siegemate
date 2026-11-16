// Offline play, end to end: load once online and let the service worker
// precache the game, then cut the network, reload, and play the computer.
//
//   node tests/e2e/offline.mjs
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

import { takeGpuLock } from "../../tools/gpu-lock.mjs";

await takeGpuLock();
const out = mkdtempSync(join(tmpdir(), "offline-"));
execFileSync("npx", ["vite", "build", "--mode", "test", "--outDir", out, "--emptyOutDir"], { stdio: "ignore" });
const port = 5200 + Math.floor(Math.random() * 300);
const server = spawn("npx", ["vite", "preview", "--outDir", out, "--port", String(port), "--strictPort"], { stdio: "ignore" });

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

try {
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
  const url = `http://localhost:${port}/?quality=low`;

  // ---- first visit, online: the service worker installs and precaches everything.
  await page.goto(url);
  await page.waitForFunction(() => window.__scene?.piece("e2"), null, { timeout: 90000 });
  // The worker is active once its precache is complete; wait until the count holds still too.
  const precached = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const counts = [];
    const deadline = Date.now() + 120000;
    for (;;) {
      let entries = 0;
      for (const name of await caches.keys()) entries += (await (await caches.open(name)).keys()).length;
      counts.push(entries);
      const settled = counts.length >= 4 && counts.slice(-4).every((count) => count === entries);
      if (settled || Date.now() > deadline) return { entries, state: registration.active?.state };
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  });
  check(precached.state === "activated" && precached.entries >= 190, "the first visit precaches the whole game", JSON.stringify(precached));
  // The first visit is not yet controlled by the worker: let its own background
  // downloads finish, so cutting the network does not cancel them mid-flight.
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => undefined);

  // ---- airplane mode.
  await context.setOffline(true);
  const failed = [];
  page.on("requestfailed", (request) => failed.push(request.url().replace(/^https?:\/\/[^/]+/, "")));
  await page.reload();
  await page.waitForFunction(() => window.__scene?.piece("e2") && window.__xr, null, { timeout: 90000 }).catch(() => undefined);
  const loaded = await page.evaluate(() => Boolean(window.__scene?.piece("e2")));
  check(loaded, "offline, the armies load from the cache");
  const fonts = await page.evaluate(() => ({ inter: document.fonts.check("600 16px Inter"), cinzel: document.fonts.check("600 32px Cinzel") }));
  check(fonts.inter && fonts.cinzel, "offline, the fonts are there", JSON.stringify(fonts));

  // ---- and the computer plays.
  await page.evaluate(() => window.__xr.startVsComputer("medium"));
  await page.waitForTimeout(1500);
  const played = await page.evaluate(() => window.__xr.move("e2", "e4"));
  check(played === true, "offline, the player's move is accepted");
  await page.waitForFunction(() => window.__xr.snapshot().turn === "w" && window.__xr.snapshot().sanList.length >= 2, null, { timeout: 20000 }).catch(() => undefined);
  const reply = await page.evaluate(() => window.__xr.snapshot().sanList);
  check(reply.length >= 2, "offline, the computer (Knight) answers", JSON.stringify(reply));

  check(failed.length === 0, "no request failed offline", failed.slice(0, 5).join(", "));
  check(errors.length === 0, "no page errors", errors.slice(0, 3).join(" | "));
  await browser.close();
} finally {
  server.kill();
  rmSync(out, { recursive: true, force: true }); // this run's own build, nothing else
}
process.exit(failures.length ? 1 : 0);
