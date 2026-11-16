// Mixed reality frame health, in Meta's WebXR emulator (IWER, Quest 3):
//   - shader programs compiled when the board appears on the table (should be
//     none: they are warmed behind the placement reticle),
//   - how long a capture fight holds the game on the table,
//   - programs compiled by each capture of a full fight (should be none) and
//     by a battleground switch mid-session.
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

  // ---- a fight with every rank on both sides (and three checks):
  //   1. e4 d5 2. exd5 Qxd5 3. Nc3 Qd8 4. Nb5 c6 5. Nxa7 Rxa7 6. Bc4 b5
  //   7. Bxf7+ Kxf7 8. Qh5+ g6 9. Qxg6+ hxg6
  // Program ids only grow, so the highest id seen (polled through each beat,
  // since an effect can compile a program and release it before the beat
  // ends) counts every compile, released or not.
  const topId = async () => Math.max(-1, ...(await programIds()));
  let quietCompiles = 0;
  /** Plays `sequence` (from-to pairs) and returns what each capture compiled. */
  const playFight = async (sequence) => {
    const captures = [];
    for (const move of sequence) {
      const [from, to] = [move.slice(0, 2), move.slice(2, 4)];
      const before = await topId();
      const owners = {};
      const played = await page.evaluate(([a, b]) => window.__xr.move(a, b), [from, to]);
      let top = before;
      await page.waitForTimeout(60);
      for (;;) {
        const sample = await page.evaluate(() => ({ moving: window.__scene.moving(), owners: window.__scene.programOwners() }));
        for (const [id, owner] of Object.entries(sample.owners)) {
          if (Number(id) > before) {
            owners[id] = owner;
            top = Math.max(top, Number(id));
          }
        }
        if (sample.moving === 0) break;
        await page.waitForTimeout(100);
      }
      top = Math.max(top, await topId());
      const beat = await page.evaluate(() => window.__scene.lastBeat());
      const compiled = top - before;
      if (!beat?.capture) {
        quietCompiles += compiled;
        continue;
      }
      captures.push({ move: `${from}x${to}`, played, wallMs: Math.round(beat.wallMs), engineS: Number(beat.engineS.toFixed(2)), programs: compiled });
      if (process.argv.includes("--keys") && compiled > 0) {
        console.log(`     ${from}x${to} compiled ${compiled}: ${JSON.stringify(Object.values(owners))}`);
        // What changed: each new program's key against the closest older one.
        const programs = await page.evaluate(() => window.__scene.programs());
        const older = programs.filter((program) => program.id <= before).map((program) => program.key.split(","));
        for (const program of programs.filter((entry) => entry.id > before)) {
          const fields = program.key.split(",");
          let best = [];
          for (const key of older) {
            if (key[0] !== fields[0] || key.length !== fields.length) continue;
            const diff = fields.flatMap((field, i) => (field === key[i] ? [] : [`#${i} ${key[i].slice(0, 24)}→${field.slice(0, 24)}`]));
            if (best.length === 0 || diff.length < best.length) best = diff;
          }
          console.log(`       ${fields[0].slice(0, 24)}: ${best.length ? best.join("; ") : "no older program of this kind"}`);
        }
      }
    }
    return captures;
  };
  const captures = await playFight(["e2e4", "d7d5", "e4d5", "d8d5", "b1c3", "d5d8", "c3b5", "c7c6", "b5a7", "a8a7", "f1c4", "b7b5", "c4f7", "e8f7", "d1h5", "g7g6", "h5g6", "h7g6"]);
  report.captures = captures;
  report.compilesInQuietMoves = quietCompiles;
  report.keptPrograms = await page.evaluate(() => window.__scene.keptPrograms());
  if (process.argv.includes("--keys")) {
    for (const keeper of await page.evaluate(() => window.__scene.keepers())) console.log(`     keeper: ${keeper}`);
  }
  check(captures.length === 8, "eight captures were played on the table", captures.map((capture) => capture.move).join(" "));
  for (const capture of captures) {
    check(capture.programs === 0, `${capture.move} compiles no shaders`, JSON.stringify(capture));
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

  // ---- a second game on the same table (the board is rebuilt, every figure
  // new): 1. e4 f6 2. Qh5+ g6 3. Qxg6+ hxg6, its first capture under check.
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const save = { version: 1, options: { mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null }, pgn: "", fen: START, clock: { whiteMs: 0, blackMs: 0 }, savedAt: Date.now() };
  const beforeRebuild = await topId();
  check(await page.evaluate((s) => window.__xr.resume(s), save), "a second game stands up on the table", "");
  await page.waitForTimeout(2500); // the board rebuilds
  report.rebuildPrograms = (await topId()) - beforeRebuild;
  const rematch = await playFight(["e2e4", "f7f6", "d1h5", "g7g6", "h5g6", "h7g6"]);
  report.secondGame = rematch;
  check(rematch.length === 2, "two captures were played in the second game", rematch.map((capture) => capture.move).join(" "));
  for (const capture of rematch) {
    check(capture.programs === 0, `second game: ${capture.move} compiles no shaders`, JSON.stringify(capture));
  }

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
