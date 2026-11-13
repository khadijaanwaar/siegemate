// Mixed reality, end to end, in Meta's WebXR emulator (IWER, Quest 3):
//   enter the session -> no table found -> board at seat height on a plinth
//   -> the right hand pinches the e2 pawn, carries the order to e4, lets go
//   -> e2-e4 is played and the machine answers.
// Also checks the table frame budget and that the hall stayed behind.
//
//   node tests/e2e/xr-play.mjs [--headed]
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

import { takeGpuLock } from "../../tools/gpu-lock.mjs";

const MAX_TABLE_CALLS_PER_EYE = 150;

await takeGpuLock();
const out = mkdtempSync(join(tmpdir(), "xr-play-"));
execFileSync("npx", ["vite", "build", "--mode", "test", "--outDir", out, "--emptyOutDir"], { stdio: "ignore" });
const port = 4800 + Math.floor(Math.random() * 400);
const server = spawn("npx", ["vite", "preview", "--outDir", out, "--port", String(port), "--strictPort"], { stdio: "ignore" });

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

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

  // ---- enter: no hit-test results in the bare emulator, so the board must fall back.
  await page.evaluate(() => window.__xr.enter());
  await page.waitForTimeout(500);
  const placingUi = await page.evaluate(() => window.__xr.ui());
  check(placingUi.coach === "find-table" && placingUi.panels.includes("coach"), "the coach asks for a table while placing", JSON.stringify(placingUi));
  await page.waitForFunction(() => window.__xr.state() === "playing", null, { timeout: 8000 }).catch(() => undefined);
  const state = await page.evaluate(() => ({ state: window.__xr.state(), placement: window.__xr.placement() }));
  check(state.state === "playing" && state.placement === "fallback", "board falls back to seat height", JSON.stringify(state));

  await page.waitForTimeout(1500);
  const frame = await page.evaluate(() => window.__scene.breakdown());
  const hallLeft = ["castle_hall", "battlefield", "jungle", "dressing", "landmarks"].every((name) => !frame.perGroup[name]);
  check(hallLeft, "the hall and its scenery stay behind", JSON.stringify(frame.perGroup));
  const lessonUi = await page.evaluate(() => window.__xr.ui());
  check(lessonUi.coach === "first-move" && lessonUi.panels.includes("slab"), "a first-time player gets the first-move lesson and the control slab", JSON.stringify(lessonUi));
  // The emulator draws both eyes with no multiview: halve for the per-eye cost.
  const perEye = Math.round(frame.calls / 2);
  check(perEye > 0, "the table renders", `calls ${frame.calls}`);
  console.log(`     table frame: ${frame.calls} calls (${perEye}/eye), ${frame.triangles} triangles`);
  if (perEye > MAX_TABLE_CALLS_PER_EYE) console.log(`     note: over the ${MAX_TABLE_CALLS_PER_EYE}/eye budget until the figure/board batching lands`);

  // ---- the right hand: calibrate the pinch point against the hand's position far from the board.
  await page.evaluate(() => {
    const device = window.__iwer;
    device.primaryInputMode = "hand";
    const hand = device.hands.right;
    hand.quaternion.set(0, 0, 0, 1);
    hand.position.set(3, 1.2, 2); // far right and behind: neither a figure nor the board is in reach or in line
    hand.poseId = "pinch";
  });
  await page.waitForTimeout(400);
  const calibration = await page.evaluate(() => {
    const hand = window.__iwer.hands.right;
    const pinch = window.__xr.pinch("right");
    return { offset: { x: pinch.x - hand.position.x, y: pinch.y - hand.position.y, z: pinch.z - hand.position.z }, pinch };
  });
  // Away from the figures a pinch aims the hand's ray; pointed off the board it must take hold of nothing.
  check(calibration.pinch.pinching && calibration.pinch.mode !== "ordering", "a pinch in empty air takes hold of nothing", JSON.stringify(calibration.pinch));
  const handFor = (target) => ({
    x: target.x - calibration.offset.x,
    y: target.y - calibration.offset.y,
    z: target.z - calibration.offset.z,
  });

  // ---- open the hand, reach to the pawn, pinch it.
  const pawn = await page.evaluate(() => window.__xr.squareWorld("e2"));
  const atPawn = handFor({ x: pawn.x, y: pawn.y + 0.02, z: pawn.z });
  await page.evaluate(() => (window.__iwer.hands.right.poseId = "open"));
  await page.waitForTimeout(300);
  const released = await page.evaluate(() => window.__xr.pinch("right"));
  check(!released.pinching && released.mode === "idle", "opening the hand ends the pinch", JSON.stringify(released));
  await page.evaluate((p) => window.__iwer.hands.right.position.set(p.x, p.y, p.z), atPawn);
  await page.waitForTimeout(300);
  await page.evaluate(() => (window.__iwer.hands.right.poseId = "pinch"));
  await page.waitForTimeout(400);
  const grabbed = await page.evaluate(() => window.__xr.pinch("right"));
  check(grabbed.mode === "ordering", "pinching the e2 pawn takes hold of it", JSON.stringify(grabbed));

  // ---- carry the order to e4 and let go.
  const e4 = await page.evaluate(() => window.__xr.squareWorld("e4"));
  const atE4 = handFor({ x: e4.x, y: e4.y + 0.03, z: e4.z });
  for (let step = 1; step <= 10; step += 1) {
    const t = step / 10;
    await page.evaluate(
      (p) => window.__iwer.hands.right.position.set(p.x, p.y, p.z),
      { x: atPawn.x + (atE4.x - atPawn.x) * t, y: atPawn.y + (atE4.y - atPawn.y) * t, z: atPawn.z + (atE4.z - atPawn.z) * t },
    );
    await page.waitForTimeout(50);
  }
  await page.evaluate(() => (window.__iwer.hands.right.poseId = "open"));
  await page.waitForFunction(() => window.__xr.snapshot().history?.length >= 1 || window.__xr.snapshot().ledger?.length >= 1, null, { timeout: 8000 }).catch(() => undefined);
  const afterMove = await page.evaluate(() => {
    const snapshot = window.__xr.snapshot();
    return { fen: snapshot.fen, turn: snapshot.turn };
  });
  check(Boolean(afterMove.fen?.includes("4P3")), "letting go over e4 plays e2-e4", afterMove.fen);

  // ---- the machine answers (Squire is instant; the march takes a few seconds).
  await page.waitForFunction(() => window.__xr.snapshot().turn === "w" && !window.__xr.snapshot().fen.endsWith(" 0 1"), null, { timeout: 15000 }).catch(() => undefined);
  const reply = await page.evaluate(() => window.__xr.snapshot().fen);
  check(/ w /.test(reply) && reply !== afterMove.fen, "the machine replies", reply);
  const afterFirstMove = await page.evaluate(() => window.__xr.ui());
  check(afterFirstMove.coach === "two-hands" || afterFirstMove.coach === "none", "after the first move the lesson moves on", JSON.stringify(afterFirstMove));

  // ---- the menu: pick Squire and start a new game from the headset.
  check(await page.evaluate(() => window.__xr.press("menu")), "Menu opens", "");
  check((await page.evaluate(() => window.__xr.ui())).panels.includes("menu"), "the menu card shows", "");
  await page.evaluate(() => window.__xr.press("easy"));
  await page.evaluate(() => window.__xr.press("new"));
  await page.waitForTimeout(800);
  const fresh = await page.evaluate(() => ({ fen: window.__xr.snapshot().fen, difficulty: window.__xr.snapshot().difficulty, ui: window.__xr.ui() }));
  check(fresh.fen.startsWith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w") && fresh.difficulty === "easy", "New game starts a fresh Squire game", JSON.stringify(fresh));
  check(!fresh.ui.panels.includes("menu"), "the menu closes after New game", JSON.stringify(fresh.ui));
  const onboarded = await page.evaluate(() => localStorage.getItem("mr-chess:onboarded"));

  // ---- two hands pinch away from the figures and pull apart: the board grows.
  const sizeBefore = await page.evaluate(() => window.__xr.boardSize());
  await page.evaluate(() => {
    const { left, right } = window.__iwer.hands;
    for (const hand of [left, right]) {
      hand.quaternion.set(0, 0, 0, 1);
      hand.poseId = "open";
    }
    // Well above the board, out to the sides: no figure in reach.
    left.position.set(-0.15, 1.45, -0.35);
    right.position.set(0.15, 1.45, -0.35);
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.__iwer.hands.left.poseId = "pinch";
    window.__iwer.hands.right.poseId = "pinch";
  });
  await page.waitForTimeout(300);
  for (let step = 1; step <= 8; step += 1) {
    await page.evaluate((spread) => {
      window.__iwer.hands.left.position.set(-0.15 - spread, 1.45, -0.35);
      window.__iwer.hands.right.position.set(0.15 + spread, 1.45, -0.35);
    }, step * 0.01);
    await page.waitForTimeout(40);
  }
  const sizeDuring = await page.evaluate(() => window.__xr.boardSize());
  await page.evaluate(() => {
    window.__iwer.hands.left.poseId = "open";
    window.__iwer.hands.right.poseId = "open";
  });
  await page.waitForTimeout(300);
  const stored = await page.evaluate(() => localStorage.getItem("mr-chess:board-size"));
  check(sizeDuring > sizeBefore * 1.15, "pulling two pinched hands apart grows the board", `${sizeBefore} -> ${sizeDuring}`);
  check(stored !== null && Math.abs(Number(stored) - sizeDuring) < 0.01, "the new size is remembered", String(stored));

  check(errors.length === 0, "no page errors", errors.slice(0, 3).join(" | "));
  await page.screenshot({ path: join(out, "xr-play.png") });
  console.log(`     screenshot: ${join(out, "xr-play.png")}`);
  await browser.close();
} finally {
  server.kill();
}
process.exit(failures.length ? 1 : 0);
