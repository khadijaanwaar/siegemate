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
  await page.waitForFunction(() => window.__xr.state() === "playing", null, { timeout: 14000 }).catch(() => undefined);
  const state = await page.evaluate(() => ({ state: window.__xr.state(), placement: window.__xr.placement() }));
  check(state.state === "playing" && state.placement === "fallback", "board falls back to seat height", JSON.stringify(state));
  // The frame must be drawn from the headset, not from the desktop camera metres away.
  const presenting = await page.evaluate(() => window.__xr.sizes());
  check(presenting?.xrEnabled === true && presenting?.presenting === true, "three draws the session from the headset's own eyes", JSON.stringify(presenting));

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

  // ---- the room takes on the battleground, and the menu can change it.
  const roomBefore = await page.evaluate(() => window.__xr.room());
  check(roomBefore?.theme === "jungle", "the room takes on the battleground (Sun Temple)", JSON.stringify(roomBefore));
  await page.evaluate(() => window.__xr.press("menu"));
  await page.evaluate(() => window.__xr.press("arena"));
  await page.waitForTimeout(600);
  const roomAfter = await page.evaluate(() => window.__xr.room());
  check(roomAfter?.theme === "dawn", "Battleground in the headset menu moves to the next map", JSON.stringify(roomAfter));
  await page.evaluate(() => window.__xr.press("arena")); // dawn -> sands
  await page.evaluate(() => window.__xr.press("arena")); // sands -> frost: snow in the room
  await page.waitForTimeout(2000);
  const snowy = await page.evaluate(() => window.__scene.breakdown());
  check(Math.round(snowy.calls / 2) <= 150, "with snow falling the table still fits the frame budget", `${Math.round(snowy.calls / 2)} calls per eye`);
  await page.evaluate(() => window.__xr.press("menu")); // close

  // ---- the menu: pick Squire and start a new game from the headset.
  check(await page.evaluate(() => window.__xr.press("menu")), "Menu opens", "");
  const menuUi = await page.evaluate(() => window.__xr.ui());
  check(menuUi.panels.includes("menu"), "the menu card shows", "");
  check(menuUi.menu?.strength === "easy" && menuUi.menu?.side === "w", "the menu opens on the game's own strength and side", JSON.stringify(menuUi.menu));
  await page.evaluate(() => window.__xr.press("easy"));
  await page.evaluate(() => window.__xr.press("new"));
  await page.waitForTimeout(800);
  const fresh = await page.evaluate(() => ({ fen: window.__xr.snapshot().fen, difficulty: window.__xr.snapshot().difficulty, ui: window.__xr.ui() }));
  check(fresh.fen.startsWith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w") && fresh.difficulty === "easy", "New game starts a fresh Squire game", JSON.stringify(fresh));
  check(!fresh.ui.panels.includes("menu"), "the menu closes after New game", JSON.stringify(fresh.ui));
  const onboarded = await page.evaluate(() => localStorage.getItem("mr-chess:onboarded"));

  // ---- two hands pinch beside the board, together, and pull apart: the board grows.
  // Pinched high above it they are not a grab (a pinch has to close within 10 cm of the board).
  const sizeBefore = await page.evaluate(() => window.__xr.boardSize());
  await page.evaluate(() => {
    const left = window.__iwer.hands.left;
    left.quaternion.set(0, 0, 0, 1);
    left.position.set(-3, 1.2, 2);
    left.poseId = "pinch";
  });
  await page.waitForTimeout(400);
  const leftOffset = await page.evaluate(() => {
    const hand = window.__iwer.hands.left.position;
    const pinch = window.__xr.pinch("left");
    return { x: pinch.x - hand.x, y: pinch.y - hand.y, z: pinch.z - hand.z };
  });
  const offsets = { left: leftOffset, right: calibration.offset };
  const edges = await page.evaluate(() => {
    const mid = (a, b) => {
      const p = window.__xr.squareWorld(a);
      const q = window.__xr.squareWorld(b);
      return { x: (p.x + q.x) / 2, y: p.y, z: (p.z + q.z) / 2 };
    };
    return { a: mid("a4", "a5"), h: mid("h4", "h5") };
  });
  // About 2.5 cm outside the a and h edges, 3 cm above the tiles: no figure in reach, the rays off the board.
  const pinchAt = (side, x, y, z) => ({ x: x - offsets[side].x, y: y - offsets[side].y, z: z - offsets[side].z });
  const twoHandSpread = async (lift, steps, each) => {
    await page.evaluate(() => {
      for (const hand of [window.__iwer.hands.left, window.__iwer.hands.right]) {
        hand.quaternion.set(0, 0, 0, 1);
        hand.poseId = "open";
      }
    });
    const place = (spread) =>
      page.evaluate(
        ({ l, r }) => {
          window.__iwer.hands.left.position.set(l.x, l.y, l.z);
          window.__iwer.hands.right.position.set(r.x, r.y, r.z);
        },
        {
          l: pinchAt("left", edges.a.x - 0.1 - spread, edges.a.y + lift, edges.a.z),
          r: pinchAt("right", edges.h.x + 0.1 + spread, edges.h.y + lift, edges.h.z),
        },
      );
    await place(0);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.__iwer.hands.left.poseId = "pinch";
      window.__iwer.hands.right.poseId = "pinch";
    });
    await page.waitForTimeout(300);
    for (let step = 1; step <= steps; step += 1) {
      await place(step * each);
      await page.waitForTimeout(40);
    }
    const size = await page.evaluate(() => window.__xr.boardSize());
    await page.evaluate(() => {
      window.__iwer.hands.left.poseId = "open";
      window.__iwer.hands.right.poseId = "open";
    });
    await page.waitForTimeout(300);
    return size;
  };
  const sizeHigh = await twoHandSpread(0.5, 10, 0.015);
  check(sizeHigh === sizeBefore, "two pinches high above the board do not resize it", `${sizeBefore} -> ${sizeHigh}`);
  const sizeDuring = await twoHandSpread(0.03, 10, 0.015);
  const stored = await page.evaluate(() => localStorage.getItem("mr-chess:board-size"));
  check(sizeDuring > sizeBefore * 1.15, "pulling two pinched hands apart grows the board", `${sizeBefore} -> ${sizeDuring}`);
  check(stored !== null && Math.abs(Number(stored) - sizeDuring) < 0.01, "the new size is remembered", String(stored));

  // ---- a new game as black from the headset: black's army is the near one.
  const nearest = () =>
    page.evaluate(() => {
      const head = window.__xr.sizes().head;
      const reach = (square) => {
        const p = window.__xr.squareWorld(square);
        return Math.hypot(p.x - head[0], p.z - head[2]);
      };
      return { e2: reach("e2"), e7: reach("e7") };
    });
  const asWhite = await nearest();
  check(asWhite.e2 < asWhite.e7, "playing white, white's army is the near one", JSON.stringify(asWhite));
  await page.evaluate(() => window.__xr.press("menu"));
  await page.evaluate(() => window.__xr.press("side-b"));
  await page.evaluate(() => window.__xr.press("new"));
  await page.waitForTimeout(800);
  const asBlack = await nearest();
  const blackGame = await page.evaluate(() => window.__xr.snapshot().playerColor);
  check(blackGame === "b" && asBlack.e7 < asBlack.e2, "playing black, the board turns so black's army is the near one", JSON.stringify({ blackGame, ...asBlack }));

  // ---- the player turns and steps aside, then recentres (the Meta button): the world's
  // origin jumps to them, and the board must keep its place relative to them.
  await page.evaluate(() => {
    const device = window.__iwer;
    device.position.set(device.position.x + 0.4, device.position.y, device.position.z + 0.2);
    device.quaternion.set(0, Math.sin(Math.PI / 12), 0, Math.cos(Math.PI / 12)); // 30 degrees to the left
  });
  await page.waitForTimeout(300);
  const flat = (s) => Math.hypot(s.rigAt[0] - s.head[0], s.rigAt[2] - s.head[2]);
  const beforeRecenter = await page.evaluate(() => window.__xr.sizes());
  await page.evaluate(() => window.__iwer.recenter());
  await page.waitForTimeout(400);
  const afterRecenter = await page.evaluate(() => window.__xr.sizes());
  check(
    Math.abs(flat(afterRecenter) - flat(beforeRecenter)) < 0.03 && afterRecenter.rigAt[2] < afterRecenter.head[2] && afterRecenter.rigVisible,
    "after a recentre the board stays where it was relative to the player",
    JSON.stringify({ before: [beforeRecenter.head, beforeRecenter.rigAt], after: [afterRecenter.head, afterRecenter.rigAt] }),
  );

  // ---- quitting through the Quest menu: the menu blurs the session (the match pauses),
  // then the system ends it. The 2D game must carry on, not stay paused for good.
  await page.evaluate(() => window.__iwer.updateVisibilityState("visible-blurred"));
  await page.waitForFunction(() => window.__xr.snapshot().paused, null, { timeout: 3000 }).catch(() => undefined);
  check(await page.evaluate(() => window.__xr.snapshot().paused), "the system menu pauses the match", "");
  await page.evaluate(() => window.__iwer.activeSession.end());
  await page.waitForFunction(() => window.__xr.state() === "off", null, { timeout: 5000 }).catch(() => undefined);
  const quit = await page.evaluate(() => ({ state: window.__xr.state(), paused: window.__xr.snapshot().paused, status: window.__xr.snapshot().status }));
  check(quit.state === "off" && quit.paused === false && quit.status === "playing", "quitting through the system menu hands back a running 2D game", JSON.stringify(quit));

  check(errors.length === 0, "no page errors", errors.slice(0, 3).join(" | "));
  await page.screenshot({ path: join(out, "xr-play.png") });
  console.log(`     screenshot: ${join(out, "xr-play.png")}`);
  await browser.close();
} finally {
  server.kill();
}
process.exit(failures.length ? 1 : 0);
