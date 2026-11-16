// Mixed reality frame health, in Meta's WebXR emulator (IWER, Quest 3):
//   - shader programs compiled when the board appears on the table (should be
//     none: they are warmed behind the placement reticle),
//   - how long a capture fight holds the game on the table,
//   - programs compiled by a capture and by a battleground switch mid-session.
// Prints one JSON line at the end for the plan's numbers.
//
//   node tests/e2e/xr-perf.mjs [--headed] [--keys]
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

import { takeGpuLock } from "../../tools/gpu-lock.mjs";

await takeGpuLock();
const out = mkdtempSync(join(tmpdir(), "xr-perf-"));
execFileSync("npx", ["vite", "build", "--mode", "test", "--outDir", out, "--emptyOutDir"], { stdio: "ignore" });
const port = 5500 + Math.floor(Math.random() * 400);
const server = spawn("npx", ["vite", "preview", "--outDir", out, "--port", String(port), "--strictPort"], { stdio: "ignore" });

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};
const report = {};

try {
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed") });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" || /context lost/i.test(message.text())) errors.push(message.text().slice(0, 200));
  });

  await page.goto(`http://localhost:${port}/?emulate&quality=low`);
  await page.waitForFunction(() => window.__xr && window.__scene?.piece("e2"), null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  const programIds = () => page.evaluate(() => window.__scene.programs().map((program) => program.id));
  /** What the new programs are, shortened: the material type leads the cache key. */
  const describe = (ids) =>
    page.evaluate((wanted) => window.__scene.programs().filter((program) => wanted.includes(program.id)).map((program) => program.key.slice(0, 48)), ids);
  const fresh = (after, before) => after.filter((id) => !before.includes(id));
  const settle = () => page.waitForFunction(() => window.__scene.moving() === 0, null, { timeout: 30000 });

  // A gesture unlocks the mixer, so the table's audio path (table mix,
  // score prefetch, session visibility) runs too.
  await page.mouse.click(4, 4);
  await page.waitForTimeout(500);

  // ---- enter, two players at one table: the hotseat lets one script play both sides.
  const in2d = await programIds();
  await page.evaluate(() => window.__xr.enter({ mode: "hotseat" }));
  await page.waitForTimeout(2500);
  const placing = await page.evaluate(() => window.__xr.state());
  const beforeReveal = await programIds();
  await page.waitForFunction(() => window.__xr.state() === "playing", null, { timeout: 15000 });
  await page.waitForTimeout(2000);
  const afterReveal = await programIds();
  if (process.argv.includes("--keys")) console.log(`     reveal compiled: ${JSON.stringify(await describe(fresh(afterReveal, beforeReveal)))}`);
  report.programs = {
    in2d: in2d.length,
    compiledWhilePlacing: fresh(beforeReveal, in2d).length,
    compiledWhenTheBoardAppears: fresh(afterReveal, beforeReveal).length,
  };
  check(placing === "placing", "the board was still being placed when programs were counted", placing);
  check(report.programs.compiledWhenTheBoardAppears === 0, "no shader compiles when the board appears", JSON.stringify(report.programs));

  // ---- a capture: 1. e4 d5 2. exd5, then the queen takes back.
  for (const [from, to] of [["e2", "e4"], ["d7", "d5"]]) {
    await page.evaluate(([a, b]) => window.__xr.move(a, b), [from, to]);
    await page.waitForTimeout(100);
    await settle();
  }
  const captures = [];
  // Programs ever seen, by full cache key: a new id with a known key was
  // released (its last material disposed) and compiled again.
  const allKeys = () => page.evaluate(() => window.__scene.programs().map((program) => program.key));
  const seenKeys = new Set(await allKeys());
  for (const [from, to] of [["e4", "d5"], ["d8", "d5"]]) {
    const before = await programIds();
    const played = await page.evaluate(([a, b]) => window.__xr.move(a, b), [from, to]);
    await page.waitForTimeout(100);
    await settle();
    const beat = await page.evaluate(() => window.__scene.lastBeat());
    const compiled = fresh(await programIds(), before);
    const keys = await page.evaluate((wanted) => window.__scene.programs().filter((program) => wanted.includes(program.id)).map((program) => program.key), compiled);
    const recompiled = keys.filter((key) => seenKeys.has(key)).length;
    for (const key of await allKeys()) seenKeys.add(key);
    for (const key of keys) seenKeys.add(key);
    captures.push({ move: `${from}x${to}`, played, ...beat, programs: compiled.length, recompiled });
    if (process.argv.includes("--keys")) console.log(`     ${from}x${to} compiled: ${JSON.stringify(await describe(compiled))}`);
  }
  report.captures = captures;
  for (const capture of captures) {
    check(capture.played && capture.capture, `${capture.move} is a capture on the table`, JSON.stringify(capture));
  }

  // ---- a battleground switch mid-session.
  const beforeArena = await programIds();
  const arenaStart = Date.now();
  await page.evaluate(() => window.__xr.press("menu"));
  await page.evaluate(() => window.__xr.press("arena"));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__xr.press("menu"));
  report.arenaSwitch = { programs: fresh(await programIds(), beforeArena).length, room: await page.evaluate(() => window.__xr.room()), ms: Date.now() - arenaStart };
  check(report.arenaSwitch.programs === 0, "switching battleground on the table compiles nothing", JSON.stringify(report.arenaSwitch));

  // ---- leave: the hall comes back with the new battleground's probe.
  await page.evaluate(() => window.__xr.exit());
  await page.waitForFunction(() => window.__xr.state() === "off", null, { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ state: window.__xr.state(), calls: window.__scene.breakdown().calls }));
  check(after.state === "off" && after.calls > 0, "leaving the table draws the hall again", JSON.stringify(after));

  check(errors.length === 0, "no page errors", errors.slice(0, 3).join(" | "));
  console.log(JSON.stringify(report));
  await browser.close();
} finally {
  server.kill();
  rmSync(out, { recursive: true, force: true }); // this run's own build, nothing else
}
process.exit(failures.length ? 1 : 0);
