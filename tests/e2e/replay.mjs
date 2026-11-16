// A shared replay link, end to end:
//   open /#r=… -> the shared armies and battleground come up and the game plays
//   back (a real, animated move) -> jump to the end: the final position and the
//   result line -> nothing of the viewer's own is touched -> Share draws the
//   battle card -> "Play your own game" -> a broken link lands on the menu
//   with a notice -> offline, a link still opens from the service-worker cache.
//
//   node tests/e2e/replay.mjs [--headed] [--shots]   (--shots writes docs/share/*.png)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { takeGpuLock } from "../../tools/gpu-lock.mjs";
import { OPERA, SCHOLARS, finalFen, token } from "./replay-fixtures.mjs";

const SHOTS = process.argv.includes("--shots");
const docs = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "share");

await takeGpuLock();
const out = mkdtempSync(join(tmpdir(), "replay-"));
execFileSync("npx", ["vite", "build", "--mode", "test", "--outDir", out, "--emptyOutDir"], { stdio: "ignore" });
const port = 5600 + Math.floor(Math.random() * 300);
const server = spawn("npx", ["vite", "preview", "--outDir", out, "--port", String(port), "--strictPort"], { stdio: "ignore" });

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

const SENTINEL = '{"version":1,"sentinel":true}';

try {
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed") });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 200));
  });
  const origin = `http://localhost:${port}`;

  // The viewer's own unfinished match and record: a replay must leave both alone.
  await page.goto(`${origin}/?quality=low`);
  await page.evaluate((sentinel) => localStorage.setItem("mr-chess:game", sentinel), SENTINEL);
  const statsBefore = await page.evaluate(() => localStorage.getItem("mr-chess:stats"));

  // ---- open the link.
  const link = `${origin}/?quality=low#r=${token(SCHOLARS)}`;
  console.log(`     link: ${link} (${link.length} chars)`);
  await page.goto(link);
  await page.waitForSelector('[data-testid="replay-bar"]', { timeout: 90000 });
  const opened = await page.evaluate(() => ({
    armies: window.__replay.armies(),
    arena: document.querySelector(".mc-root")?.getAttribute("data-arena"),
    mode: window.__xr.snapshot().mode,
  }));
  check(opened.armies?.w === "sun" && opened.armies?.b === "empire", "the shared armies take the field", JSON.stringify(opened.armies));
  check(opened.arena === "frost", "on the shared battleground", String(opened.arena));
  check(opened.mode === "hotseat", "played back on a board the viewer cannot touch", opened.mode);

  // ---- it plays back on its own, through real moves.
  await page.waitForFunction(() => (window.__replay.state()?.ply ?? 0) >= 2, null, { timeout: 30000 }).catch(() => undefined);
  const playing = await page.evaluate(() => ({ state: window.__replay.state(), sans: window.__xr.snapshot().sanList }));
  check(playing.state?.ply >= 2 && playing.sans[0] === "e4", "the game plays back move by move", JSON.stringify(playing));

  // ---- pause, then step back and forward.
  await page.click('[data-testid="replay-toggle"]');
  await page.waitForFunction(() => window.__replay.state() && !window.__replay.state().playing && !window.__replay.state().busy, null, { timeout: 15000 });
  const paused = await page.evaluate(() => window.__replay.state().ply);
  await page.click('button[aria-label="Back one move"]');
  const back = await page.evaluate(() => ({ ply: window.__replay.state().ply, plies: window.__xr.snapshot().sanList.length }));
  check(back.ply === paused - 1 && back.plies === paused - 1, "Back steps one move back", JSON.stringify({ paused, back }));
  await page.click('button[aria-label="Forward one move"]');
  await page.waitForFunction((ply) => window.__replay.state().ply === ply && !window.__replay.state().busy, paused, { timeout: 15000 }).catch(() => undefined);
  check((await page.evaluate(() => window.__replay.state().ply)) === paused, "Forward plays the next move", "");

  // ---- to the end: the final position and the result line.
  await page.click('[data-testid="replay-end"]');
  await page.waitForSelector('[data-testid="replay-result"]', { timeout: 10000 });
  const end = await page.evaluate(() => ({
    fen: window.__xr.snapshot().fen,
    ply: window.__replay.state().ply,
    result: document.querySelector('[data-testid="replay-result"]')?.textContent,
  }));
  check(end.fen === finalFen(SCHOLARS) && end.ply === SCHOLARS.moves.length, "To the end reaches the final position", JSON.stringify(end));
  check(end.result === "Sun Empire beat the Grande Armée in 4 moves · Checkmate", "the result line names the armies", String(end.result));
  // Step back from the mate and play it forward: the game ends on the board, still without the viewer's dialog.
  await page.click('button[aria-label="Back one move"]');
  await page.click('button[aria-label="Forward one move"]');
  await page.waitForFunction(() => window.__xr.snapshot().status === "over", null, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  const mated = await page.evaluate(() => ({
    status: window.__xr.snapshot().status,
    gameOverDialog: Boolean(document.querySelector(".mc-dialog-actions")),
    hud: Boolean(document.querySelector('[aria-label="Back to the menu"]')),
    save: localStorage.getItem("mr-chess:game"),
    stats: localStorage.getItem("mr-chess:stats"),
  }));
  check(mated.status === "over" && !mated.gameOverDialog, "the mate plays out without the viewer's own result dialog", JSON.stringify(mated.status));
  check(mated.save === SENTINEL && mated.stats === statsBefore, "the viewer's saved match and record are untouched", JSON.stringify({ save: mated.save, stats: mated.stats }));
  if (SHOTS) {
    mkdirSync(docs, { recursive: true });
    await page.screenshot({ path: join(docs, "replay-2d.png") });
  }

  // ---- share: the battle card.
  await page.click('button:has-text("Share")');
  await page.waitForSelector('[data-testid="battle-card"]', { timeout: 15000 });
  const card = await page.evaluate(async () => {
    const image = document.querySelector('[data-testid="battle-card"]');
    await image.decode();
    const blob = await (await fetch(image.src)).blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      type: blob.type,
      png: btoa(binary),
      link: document.querySelector(".mc-share-link")?.value,
    };
  });
  check(card.width === 1200 && card.height === 630 && card.type === "image/png", "Share draws a 1200×630 battle card", `${card.width}×${card.height} ${card.type}`);
  check(card.link === `${origin}/#r=${token(SCHOLARS)}`, "the share sheet offers the same replay link", String(card.link));
  if (SHOTS) {
    writeFileSync(join(docs, "battle-card.png"), Buffer.from(card.png, "base64"));
    await page.screenshot({ path: join(docs, "share-sheet-2d.png") });
  }
  // Where the platform has a share sheet that takes files (a phone): the card and the link go to it.
  await page.evaluate(() => {
    window.__shared = null;
    navigator.canShare = (data) => Array.isArray(data?.files) && data.files.length > 0;
    navigator.share = async (data) => {
      window.__shared = { url: data.url, text: data.text, files: (data.files ?? []).map((file) => `${file.name} ${file.type} ${file.size}`) };
    };
  });
  await page.click(".mc-share-actions button:first-child");
  await page.waitForFunction(() => window.__shared !== null, null, { timeout: 5000 }).catch(() => undefined);
  const shared = await page.evaluate(() => window.__shared);
  check(
    shared?.url === card.link && shared.files.length === 1 && /^siegemate-battle-.*\.png image\/png \d+$/.test(shared.files[0]) && shared.text.includes(card.link),
    "Share hands the card and the link to the platform's share sheet",
    JSON.stringify(shared),
  );
  // Where there is none (desktop): the card is saved and the link copied, with a confirmation.
  await page.evaluate(() => {
    navigator.share = undefined;
    navigator.canShare = undefined;
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const download = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
  await page.click(".mc-share-actions button:first-child");
  const saved = await download;
  await page.waitForSelector('.mc-share-status:has-text("link copied")', { timeout: 5000 }).catch(() => undefined);
  const confirmed = await page.evaluate(() => document.querySelector(".mc-share-status")?.textContent ?? "");
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  check(
    Boolean(saved) && clip === card.link && confirmed.includes("link copied"),
    "without a share sheet: the card is saved and the link copied, with a confirmation",
    `${saved?.suggestedFilename()} · ${confirmed} · ${clip.slice(0, 40)}`,
  );
  await page.click('button[aria-label="Close"]');

  // ---- play your own game.
  await page.click('[data-testid="replay-own-game"]');
  await page.waitForTimeout(800);
  const menu = await page.evaluate(() => ({ hash: location.hash, status: window.__xr.snapshot().status, active: window.__replay.active() }));
  check(menu.hash === "" && menu.status === "idle" && !menu.active, "Play your own game returns to the menu and drops the link", JSON.stringify(menu));
  const armiesBack = await page.waitForFunction(() => window.__replay.armies()?.w === "ivory", null, { timeout: 20000 }).then(() => true).catch(() => false);
  check(armiesBack, "the viewer's own armies come back", JSON.stringify(await page.evaluate(() => window.__replay.armies())));

  // ---- play on from the middle of a shared game, against the computer.
  await page.goto(`${origin}/?quality=low#r=${token(OPERA)}`);
  await page.waitForSelector('[data-testid="replay-bar"]', { timeout: 90000 });
  await page.waitForFunction(() => (window.__replay.state()?.ply ?? 0) >= 1, null, { timeout: 30000 }).catch(() => undefined);
  await page.click('[data-testid="replay-toggle"]');
  await page.waitForFunction(() => window.__replay.state() && !window.__replay.state().playing && !window.__replay.state().busy, null, { timeout: 15000 });
  const takeover = await page.evaluate(() => window.__xr.snapshot());
  await page.click('button:has-text("Play from here")');
  await page.waitForTimeout(500);
  const resumed = await page.evaluate(() => ({
    snapshot: window.__xr.snapshot(),
    bar: Boolean(document.querySelector('[data-testid="replay-bar"]')),
    hash: location.hash,
    active: window.__replay.active(),
  }));
  check(
    resumed.snapshot.mode === "ai" && resumed.snapshot.playerColor === takeover.turn && resumed.snapshot.fen === takeover.fen,
    "Play from here hands the side to move to the viewer against the computer",
    JSON.stringify({ mode: resumed.snapshot.mode, side: resumed.snapshot.playerColor, turn: takeover.turn }),
  );
  check(!resumed.bar && resumed.hash === "" && !resumed.active, "and the replay steps aside", JSON.stringify({ bar: resumed.bar, hash: resumed.hash }));

  // ---- a broken link.
  await page.goto(`${origin}/?quality=low#r=${token(OPERA).slice(0, -3)}xyz`);
  await page.waitForFunction(() => document.body.innerText.includes("replay link is broken"), null, { timeout: 90000 }).catch(() => undefined);
  const broken = await page.evaluate(() => ({ notice: document.body.innerText.includes("replay link is broken"), bar: Boolean(document.querySelector('[data-testid="replay-bar"]')), hash: location.hash }));
  check(broken.notice && !broken.bar && broken.hash === "", "a broken link lands on the menu with a notice", JSON.stringify(broken));

  // ---- offline: the worker has the game; the hash never reaches the network.
  await page.goto(`${origin}/?quality=low`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const deadline = Date.now() + 120000;
    let last = -1;
    for (;;) {
      let entries = 0;
      for (const name of await caches.keys()) entries += (await (await caches.open(name)).keys()).length;
      if ((entries === last && entries > 150) || Date.now() > deadline) return;
      last = entries;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  });
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => undefined);
  await context.setOffline(true);
  await page.goto(`${origin}/?quality=low#r=${token(OPERA)}`).catch(() => undefined);
  await page.waitForSelector('[data-testid="replay-bar"]', { timeout: 90000 }).catch(() => undefined);
  await page.click('[data-testid="replay-end"]').catch(() => undefined);
  await page.waitForTimeout(500);
  const offline = await page.evaluate(() => ({ fen: window.__xr?.snapshot().fen, armies: window.__replay?.armies() })).catch(() => ({}));
  check(offline.fen === finalFen(OPERA), "offline, a replay link opens from the cache and reaches the final position", JSON.stringify(offline));
  await context.setOffline(false);

  check(errors.length === 0, "no page errors", errors.slice(0, 3).join(" | "));
  await browser.close();
} finally {
  server.kill();
}
process.exit(failures.length ? 1 : 0);
