// Sharing from the headset, in Meta's WebXR emulator (IWER, Quest 3):
//   a game ends on the table -> the result card offers "Share this battle"
//   -> the card shows the replay link as a QR code that decodes back to the
//   link (and is at least 12 cm across) -> leaving the session, the 2D page is
//   waiting with the battle card and the share buttons.
//
//   node tests/e2e/xr-share.mjs [--headed] [--shots]   (--shots writes docs/share/*.png)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { takeGpuLock } from "../../tools/gpu-lock.mjs";

const SHOTS = process.argv.includes("--shots");
const docs = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "share");
/** Canvas pixels per metre of headset panel (src/xr/ui/canvasPanel.ts). */
const PX_PER_M = 3000;

await takeGpuLock();
const out = mkdtempSync(join(tmpdir(), "xr-share-"));
execFileSync("npx", ["vite", "build", "--mode", "test", "--outDir", out, "--emptyOutDir"], { stdio: "ignore" });
const port = 5900 + Math.floor(Math.random() * 300);
const server = spawn("npx", ["vite", "preview", "--outDir", out, "--port", String(port), "--strictPort"], { stdio: "ignore" });

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

try {
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed") });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" || /context lost/i.test(message.text())) errors.push(message.text().slice(0, 200));
  });

  await page.goto(`http://localhost:${port}/?emulate&quality=low`);
  await page.waitForFunction(() => window.__xr && window.__scene?.piece("e2"), null, { timeout: 60000 });

  // ---- a two-player game on the table, ended by the quickest mate there is.
  await page.evaluate(() => window.__xr.enter({ mode: "hotseat" }));
  await page.waitForFunction(() => window.__xr.state() === "playing", null, { timeout: 15000 }).catch(() => undefined);
  check((await page.evaluate(() => window.__xr.state())) === "playing", "the board stands on the table", "");
  for (const [from, to] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]]) {
    const played = await page.evaluate(([a, b]) => window.__xr.move(a, b), [from, to]);
    if (!played) check(false, `move ${from}-${to} is played`);
  }
  await page.waitForFunction(() => window.__xr.ui().panels.includes("result"), null, { timeout: 15000 }).catch(() => undefined);
  const result = await page.evaluate(() => ({ status: window.__xr.snapshot().status, ui: window.__xr.ui(), share: window.__xr.buttonWorld("share") }));
  check(result.status === "over" && result.ui.panels.includes("result"), "the result card comes up", JSON.stringify(result.ui));
  check(result.share !== null, "the result card offers Share this battle", JSON.stringify(result.share));

  // ---- the QR card.
  check(await page.evaluate(() => window.__xr.press("share")), "Share this battle can be pressed", "");
  await page.waitForTimeout(300);
  const shown = await page.evaluate(() => window.__xr.ui().panels);
  check(shown.includes("share") && !shown.includes("result"), "the QR card replaces the result card", JSON.stringify(shown));

  const link = await page.evaluate(() => window.__share.link());
  check(typeof link === "string" && link.includes("#r=1"), "a replay link is on offer", String(link));
  const png = await page.evaluate(() => window.__xr.panels().share);
  if (SHOTS) {
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(docs, "headset-qr-card.png"), Buffer.from(png.split(",")[1], "base64"));
  }

  // Decode it: the platform's barcode reader where there is one, else read every module back.
  const decoded = await page.evaluate(async ({ png, link, pxPerM }) => {
    const image = new Image();
    image.src = png;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    let detector = null;
    if ("BarcodeDetector" in window) {
      try {
        const found = await new window.BarcodeDetector({ formats: ["qr_code"] }).detect(canvas);
        detector = found.map((code) => code.rawValue);
      } catch (error) {
        detector = `unavailable: ${error}`;
      }
    }
    // Geometry from src/share/headsetShare.ts + qr.ts.
    const matrix = window.__share.qr(link);
    const span = matrix.size + 8;
    const width = (0.2 - 0.03) * pxPerM;
    const module = Math.floor(width / span);
    const plate = module * span;
    const left = Math.round(0.015 * pxPerM + (width - plate) / 2);
    const top = Math.round(0.036 * pxPerM + (width - plate) / 2);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let wrong = 0;
    for (let y = -4; y < matrix.size + 4; y += 1) {
      for (let x = -4; x < matrix.size + 4; x += 1) {
        const px = left + (x + 4) * module + module / 2;
        const py = top + (y + 4) * module + module / 2;
        const at = (Math.floor(py) * canvas.width + Math.floor(px)) * 4;
        const dark = pixels[at] + pixels[at + 1] + pixels[at + 2] < 3 * 128;
        const want = x >= 0 && y >= 0 && x < matrix.size && y < matrix.size ? matrix.dark[y][x] : false;
        if (dark !== want) wrong += 1;
      }
    }
    return { detector, wrong, modules: matrix.size, codeMeters: (module * matrix.size) / pxPerM };
  }, { png, link, pxPerM: PX_PER_M });
  if (Array.isArray(decoded.detector)) {
    check(decoded.detector.includes(link), "a QR reader decodes the card back to the replay link", JSON.stringify(decoded.detector));
  } else {
    console.log(`     note: no BarcodeDetector here (${decoded.detector ?? "absent"}); reading the modules instead`);
  }
  check(decoded.wrong === 0, "every module of the QR code (and its quiet zone) is drawn as encoded", JSON.stringify({ wrong: decoded.wrong, modules: decoded.modules }));
  check(decoded.codeMeters >= 0.12, "the code is at least 12 cm across in the room", `${(decoded.codeMeters * 100).toFixed(1)} cm`);

  // ---- Back returns to the result card.
  await page.evaluate(() => window.__xr.press("share-back"));
  await page.waitForTimeout(200);
  const back = await page.evaluate(() => window.__xr.ui().panels);
  check(back.includes("result") && !back.includes("share"), "Back returns to the result card", JSON.stringify(back));
  if (SHOTS) await page.screenshot({ path: join(docs, "headset-result-emulator.png") });

  // ---- leaving the headset: the 2D page waits with the battle card and the buttons.
  await page.evaluate(() => window.__xr.exit());
  await page.waitForFunction(() => window.__xr.state() === "off", null, { timeout: 10000 }).catch(() => undefined);
  await page.waitForSelector('[data-testid="battle-card"]', { timeout: 15000 }).catch(() => undefined);
  const after = await page.evaluate(() => ({
    state: window.__xr.state(),
    sheet: Boolean(document.querySelector('[data-testid="share-sheet"]')),
    card: document.querySelector('[data-testid="battle-card"]')?.naturalWidth ?? 0,
    link: document.querySelector(".mc-share-link")?.value,
    modalShare: [...document.querySelectorAll(".mc-dialog-actions button")].some((button) => button.textContent.includes("Share")),
  }));
  check(after.state === "off" && after.sheet && after.card === 1200, "after the session the 2D page shows the battle card and the share buttons", JSON.stringify(after));
  check(after.link === link, "with the same link the QR code carried", String(after.link));
  check(after.modalShare, "the 2D result dialog has Share too", "");
  if (SHOTS) await page.screenshot({ path: join(docs, "after-headset-2d.png") });

  check(errors.length === 0, "no page errors", errors.slice(0, 3).join(" | "));
  await browser.close();
} finally {
  server.kill();
  rmSync(out, { recursive: true, force: true }); // this run's own build, nothing else
}
process.exit(failures.length ? 1 : 0);
