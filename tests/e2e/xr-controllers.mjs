// Mixed reality with Touch controllers, end to end, in Meta's WebXR emulator (IWER, Quest 3):
//   the coach speaks of triggers -> the right controller's ray presses the e2 pawn, drags to e4,
//   lets go -> e2-e4 -> click d2, click d4 -> d2-d4 -> the ray opens and closes the menu
//   -> both grips pull apart and the board grows -> putting the controllers down hands over to hands.
//
//   node tests/e2e/xr-controllers.mjs [--headed]
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Chess } from "chess.js";
import { chromium } from "playwright";

import { takeGpuLock } from "../../tools/gpu-lock.mjs";

await takeGpuLock();
const out = mkdtempSync(join(tmpdir(), "xr-controllers-"));
execFileSync("npx", ["vite", "build", "--mode", "test", "--outDir", out, "--emptyOutDir"], { stdio: "ignore" });
const port = 4800 + Math.floor(Math.random() * 400);
const server = spawn("npx", ["vite", "preview", "--outDir", out, "--port", String(port), "--strictPort"], { stdio: "ignore" });

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

/** Quaternion turning the controller's forward (-Z) toward `to` from `from` (x, y, z, w). */
function aimQuaternion(from, to) {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  let dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  dx /= length;
  dy /= length;
  dz /= length;
  // a = (0, 0, -1): q = [a x d, 1 + a . d] = [(dy, -dx, 0), 1 - dz], normalised.
  const cx = dy;
  const cy = -dx;
  const cz = 0;
  const w = 1 - dz;
  const n = Math.hypot(cx, cy, cz, w);
  return { x: cx / n, y: cy / n, z: cz / n, w: w / n };
}

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
  await page.waitForFunction(() => window.__xr && window.__scene?.piece("e2") && window.__iwer, null, { timeout: 60000 });
  await page.evaluate(() => (window.__iwer.primaryInputMode = "controller"));

  await page.evaluate(() => window.__xr.enter());
  await page.waitForFunction(() => window.__xr.state() === "playing", null, { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(600);
  const ui = await page.evaluate(() => window.__xr.ui());
  check(ui?.pointer === "controllers" && ui.coach === "first-move", "with controllers in hand the coach speaks of the trigger", JSON.stringify(ui));
  const side = await page.evaluate(() => window.__xr.pointer("right"));
  check(side?.kind === "controller", "the right side is read as a controller", JSON.stringify(side));

  const aim = async (hand, from, to) => {
    const q = aimQuaternion(from, to);
    await page.evaluate(
      ({ hand, from, q }) => {
        const controller = window.__iwer.controllers[hand];
        controller.position.set(from.x, from.y, from.z);
        controller.quaternion.set(q.x, q.y, q.z, q.w);
      },
      { hand, from, q },
    );
  };
  const trigger = (value) => page.evaluate((v) => window.__iwer.controllers.right.updateButtonValue("trigger", v), value);
  const squareTop = async (square, lift = 0) => {
    const p = await page.evaluate((s) => window.__xr.squareWorld(s), square);
    return { x: p.x, y: p.y + lift, z: p.z };
  };
  // Held where a seated player points from: a hand's width right of centre, well above the board's near edge.
  const boardTop = await squareTop("e2");
  const from = { x: 0.12, y: boardTop.y + 0.42, z: boardTop.z + 0.15 };

  // ---- press the e2 pawn along the ray, drag to e4, let go.
  await aim("right", from, await squareTop("e2", 0.02));
  await page.waitForTimeout(250);
  await trigger(1);
  await page.waitForTimeout(250);
  const ordering = await page.evaluate(() => window.__xr.pointer("right"));
  check(ordering?.mode === "ordering" && ordering.byRay, "pulling the trigger on the e2 pawn takes hold of it along the ray", JSON.stringify(ordering));
  const e2 = await squareTop("e2", 0.02);
  const e4 = await squareTop("e4");
  for (let step = 1; step <= 8; step += 1) {
    const t = step / 8;
    await aim("right", from, { x: e2.x + (e4.x - e2.x) * t, y: e2.y + (e4.y - e2.y) * t, z: e2.z + (e4.z - e2.z) * t });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(150);
  await trigger(0);
  await page.waitForFunction(() => window.__xr.snapshot().fen.includes("4P3"), null, { timeout: 5000 }).catch(() => undefined);
  const afterDrag = await page.evaluate(() => window.__xr.snapshot().fen);
  check(afterDrag.includes("4P3"), "letting the trigger go over e4 plays e2-e4", afterDrag);

  // ---- the machine replies; then click d2, click d4.
  await page.waitForFunction(() => / w /.test(window.__xr.snapshot().fen), null, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(3500); // the march and the reply
  const click = async (square) => {
    await aim("right", from, await squareTop(square, square === "d2" ? 0.02 : 0));
    await page.waitForTimeout(200);
    await trigger(1);
    await page.waitForTimeout(150);
    await trigger(0);
    await page.waitForTimeout(250);
  };
  await click("d2");
  await click("d4");
  await page.waitForFunction(() => window.__xr.snapshot().fen.split(" ")[0].split("/")[4] === "3PP3", null, { timeout: 5000 }).catch(() => undefined);
  const afterClicks = await page.evaluate(() => window.__xr.snapshot().fen);
  check(afterClicks.split(" ")[0].split("/")[4] === "3PP3", "click d2, then click d4, plays d2-d4", afterClicks);

  // ---- the ray presses panel buttons: open the menu, close it.
  const pressAlongRay = async (id) => {
    const at = await page.evaluate((b) => window.__xr.buttonWorld(b), id);
    if (!at) return false;
    await aim("right", from, at);
    await page.waitForTimeout(200);
    await trigger(1);
    await page.waitForTimeout(150);
    await trigger(0);
    await page.waitForTimeout(300);
    return true;
  };
  await pressAlongRay("menu");
  const menuOpen = await page.evaluate(() => window.__xr.ui());
  check(menuOpen?.panels.includes("menu"), "the trigger along the ray opens the menu", JSON.stringify(menuOpen));
  const fenBeforeClose = await page.evaluate(() => window.__xr.snapshot().fen);
  await pressAlongRay("menu"); // the same button closes it
  const menuClosed = await page.evaluate(() => ({ ui: window.__xr.ui(), fen: window.__xr.snapshot().fen }));
  check(!menuClosed.ui?.panels.includes("menu"), "and closes it", JSON.stringify(menuClosed.ui));
  check(menuClosed.fen === fenBeforeClose, "a press on a panel never reaches the board behind it", menuClosed.fen);

  // ---- A opens the menu, and A again closes it.
  const pressA = async () => {
    await page.evaluate(() => window.__iwer.controllers.right.updateButtonValue("a-button", 1));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__iwer.controllers.right.updateButtonValue("a-button", 0));
    await page.waitForTimeout(200);
  };
  await pressA();
  check((await page.evaluate(() => window.__xr.ui()))?.panels.includes("menu"), "A opens the menu", "");
  await pressA();
  check(!(await page.evaluate(() => window.__xr.ui()))?.panels.includes("menu"), "A again closes it", "");

  // ---- promotion: a pawn on b7, b8 empty. Click b7, click b8: the crown card shows in the
  // headset (no picker hangs in front of the desktop camera); its Knight button, pressed along
  // the ray, crowns a knight and the game goes on.
  const promo = new Chess();
  for (const san of ["a4", "b5", "axb5", "a6", "bxa6", "Bb7", "axb7", "Nc6"]) promo.move(san);
  const save = {
    version: 1,
    options: { mode: "ai", difficulty: "easy", playerColor: "w", clockMinutes: null },
    pgn: promo.pgn(),
    fen: promo.fen(),
    clock: { whiteMs: 0, blackMs: 0 },
    savedAt: Date.now(),
  };
  // Let the machine's reply to d4 land (and its march finish) before the board is swapped.
  await page.waitForFunction(() => / w /.test(window.__xr.snapshot().fen) && !window.__xr.snapshot().thinking, null, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
  check(await page.evaluate((s) => window.__xr.resume(s), save), "a position one step from the crown stands up", promo.fen());
  await page.waitForTimeout(2500); // the board rebuilds
  await click("b7");
  const picked = await page.evaluate(() => window.__xr.pointer("right"));
  await click("b8");
  if (!(await page.evaluate(() => window.__xr.ui()))?.panels.includes("promote")) console.log(`     b7 click left: ${JSON.stringify(picked)}`);
  await page.waitForTimeout(400);
  const asking = await page.evaluate(() => ({ ui: window.__xr.ui(), fen: window.__xr.snapshot().fen }));
  check(asking.ui?.panels.includes("promote"), "reaching the last rank shows the crown card in the headset", JSON.stringify(asking.ui));
  check(asking.fen === promo.fen(), "the pawn waits for the choice", asking.fen);
  await pressAlongRay("promote-n");
  await page.waitForFunction(() => window.__xr.snapshot().fen.startsWith("rN1qkbnr"), null, { timeout: 5000 }).catch(() => undefined);
  const crowned = await page.evaluate(() => ({ ui: window.__xr.ui(), fen: window.__xr.snapshot().fen }));
  check(crowned.fen.startsWith("rN1qkbnr"), "pressing Knight on the card crowns a knight on b8", crowned.fen);
  check(!crowned.ui?.panels.includes("promote"), "and the card goes away", JSON.stringify(crowned.ui));
  await page.waitForFunction(() => / w /.test(window.__xr.snapshot().fen), null, { timeout: 15000 }).catch(() => undefined);
  check(/ w /.test(await page.evaluate(() => window.__xr.snapshot().fen)), "the machine replies after the crown", "");
  await page.waitForTimeout(3000); // let the reply's march finish

  // ---- both grips close beside the board and pull apart: the board grows and the size is kept.
  const sizeBefore = await page.evaluate(() => window.__xr.boardSize());
  const edges = await page.evaluate(() => {
    const mid = (a, b) => {
      const p = window.__xr.squareWorld(a);
      const q = window.__xr.squareWorld(b);
      return { x: (p.x + q.x) / 2, y: p.y, z: (p.z + q.z) / 2 };
    };
    return { a: mid("a4", "a5"), h: mid("h4", "h5") };
  });
  // About 2.5 cm outside the a and h edges, 3 cm above the tiles (a grab must close within 10 cm of the board).
  const placeGrips = (spread) =>
    page.evaluate(
      ({ edges, spread }) => {
        const { left, right } = window.__iwer.controllers;
        left.position.set(edges.a.x - 0.1 - spread, edges.a.y + 0.03, edges.a.z);
        right.position.set(edges.h.x + 0.1 + spread, edges.h.y + 0.03, edges.h.z);
      },
      { edges, spread },
    );
  await page.evaluate(() => {
    for (const controller of [window.__iwer.controllers.left, window.__iwer.controllers.right]) controller.quaternion.set(0, 0, 0, 1);
  });
  await placeGrips(0);
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.__iwer.controllers.left.updateButtonValue("squeeze", 1);
    window.__iwer.controllers.right.updateButtonValue("squeeze", 1);
  });
  await page.waitForTimeout(250);
  for (let step = 1; step <= 10; step += 1) {
    await placeGrips(step * 0.015);
    await page.waitForTimeout(40);
  }
  const sizeDuring = await page.evaluate(() => window.__xr.boardSize());
  await page.evaluate(() => {
    window.__iwer.controllers.left.updateButtonValue("squeeze", 0);
    window.__iwer.controllers.right.updateButtonValue("squeeze", 0);
  });
  await page.waitForTimeout(250);
  const stored = await page.evaluate(() => localStorage.getItem("mr-chess:board-size"));
  check(sizeDuring > sizeBefore * 1.15, "pulling both grips apart grows the board", `${sizeBefore} -> ${sizeDuring}`);
  check(stored !== null && Math.abs(Number(stored) - sizeDuring) < 0.01, "the new size is remembered", String(stored));

  // ---- put the controllers down: hands take over, and the coach would speak of pinches again.
  await page.evaluate(() => (window.__iwer.primaryInputMode = "hand"));
  await page.waitForTimeout(400);
  const handsAgain = await page.evaluate(() => ({ side: window.__xr.pointer("right"), ui: window.__xr.ui() }));
  check(handsAgain.side?.kind === "hand" && handsAgain.ui?.pointer === "hands", "putting the controllers down hands over to hand tracking", JSON.stringify(handsAgain));

  // ---- the thumbstick raises and lowers the board, a step per push.
  await page.evaluate(() => (window.__iwer.primaryInputMode = "controller"));
  await page.waitForTimeout(400);
  const stick = async (y) => {
    await page.evaluate((v) => window.__iwer.controllers.right.updateAxes("thumbstick", 0, v), y);
    await page.waitForTimeout(120);
    await page.evaluate(() => window.__iwer.controllers.right.updateAxes("thumbstick", 0, 0));
    await page.waitForTimeout(120);
  };
  const heightBefore = await page.evaluate(() => window.__xr.boardHeight());
  await stick(-1);
  await stick(-1);
  const stickUp = await page.evaluate(() => window.__xr.boardHeight());
  await stick(1);
  await stick(1);
  const stickDown = await page.evaluate(() => window.__xr.boardHeight());
  check(Math.abs(stickUp - heightBefore - 0.04) < 1e-6 && Math.abs(stickDown - heightBefore) < 1e-6, "thumbstick up raises the board 2 cm a push, down lowers it", JSON.stringify({ heightBefore, stickUp, stickDown }));

  // ---- Exit asks first: one tap arms it, it disarms after 3 s, and two taps leave.
  await page.evaluate(() => window.__xr.press("menu"));
  await page.evaluate(() => window.__xr.press("exit"));
  await page.waitForTimeout(300);
  check((await page.evaluate(() => window.__xr.state())) === "playing", "one tap on Exit does not leave", "");
  await page.waitForTimeout(3200);
  await page.evaluate(() => window.__xr.press("exit"));
  await page.waitForTimeout(300);
  check((await page.evaluate(() => window.__xr.state())) === "playing", "a tap after the confirm window lapsed only arms it again", "");
  await page.evaluate(() => window.__xr.press("exit"));
  await page.waitForFunction(() => window.__xr.state() === "off", null, { timeout: 5000 }).catch(() => undefined);
  check((await page.evaluate(() => window.__xr.state())) === "off", "a second tap within 3 s leaves", "");

  check(errors.length === 0, "no page errors", errors.slice(0, 3).join(" | "));
  await page.screenshot({ path: join(out, "xr-controllers.png") });
  await browser.close();
} finally {
  server.kill();
  rmSync(out, { recursive: true, force: true }); // this run's own build, nothing else
}
process.exit(failures.length ? 1 : 0);
