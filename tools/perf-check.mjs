// Builds the game in test mode, serves it, lets the attract duel run, and checks
// the frame against draw-call / triangle budgets. Exit code 1 on any breach.
//
//   node tools/perf-check.mjs [--max-calls N] [--max-tris N] [--max-piece-draws N]
//                             [--max-board N] [--wait ms] [--spoof-cores N] [--json]
//
// Uses the real GPU through Chrome (channel "chrome"). `window.__scene` comes
// from SceneEngine.exposeStats(), which only exists in dev/test builds.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const budgets = {
  calls: opt("max-calls", Infinity),
  triangles: opt("max-tris", Infinity),
  pieceDraws: opt("max-piece-draws", Infinity),
  board: opt("max-board", Infinity),
};
const wait = opt("wait", 40000);
const spoofCores = opt("spoof-cores", 0);
const port = 4300 + Math.floor(Math.random() * 500);

const out = mkdtempSync(join(tmpdir(), "perf-check-"));
execFileSync("npx", ["vite", "build", "--mode", "test", "--outDir", out, "--emptyOutDir"], { stdio: "ignore" });
const server = spawn("npx", ["vite", "preview", "--outDir", out, "--port", String(port), "--strictPort"], { stdio: "ignore" });

let failed = false;
try {
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 820 }, deviceScaleFactor: 2 })).newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  if (spoofCores) {
    await page.addInitScript((cores) => Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => cores }), spoofCores);
  }
  await page.goto(`http://localhost:${port}/`);
  await page.waitForTimeout(wait);
  const result = await page.evaluate(() => {
    const stats = window.__scene;
    const breakdown = stats.breakdown();
    const pieceGroups = Object.entries(breakdown.perGroup).filter(([name]) => name.startsWith("piece_"));
    const pieces = pieceGroups.reduce((sum, [, n]) => sum + n, 0);
    // perGroup sums every figure sharing a template name; count figures on the board.
    const files = "abcdefgh";
    let figures = 0;
    for (const f of files) for (let r = 1; r <= 8; r += 1) if (stats.piece(`${f}${r}`)) figures += 1;
    return { preset: stats.preset(), ...breakdown, figures, pieceDrawsPerFigure: figures ? pieces / figures : 0 };
  });
  await browser.close();

  const checks = [
    ["calls", result.calls, budgets.calls],
    ["triangles", result.triangles, budgets.triangles],
    ["pieceDrawsPerFigure", result.pieceDrawsPerFigure, budgets.pieceDraws],
    ["board", result.perGroup.board ?? 0, budgets.board],
  ];
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 1));
  console.log(`preset ${result.preset} · ${result.figures} figures · calls ${result.calls} · tris ${result.triangles}`);
  for (const [name, value, max] of checks) {
    const ok = value <= max;
    if (!ok) failed = true;
    console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(20)} ${Number(value.toFixed?.(2) ?? value)}${Number.isFinite(max) ? ` (max ${max})` : ""}`);
  }
  if (errors.length) {
    failed = true;
    console.log(`FAIL page errors:\n  ${errors.slice(0, 5).join("\n  ")}`);
  }
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
