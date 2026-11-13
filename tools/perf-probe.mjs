import { chromium } from "playwright";
const url = process.argv[2];
// Usage: node tools/perf-probe.mjs <url> [spoofCores] [headed]
// spoofCores forces a preset through detection (2 → low, 4 → medium).
const cores = process.argv[3] ? Number(process.argv[3]) : null;
const headless = process.argv[4] !== "headed";
const browser = await chromium.launch({ channel: "chrome", headless, args: ["--enable-gpu", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { const t = m.text(); if (/\[scene\]|quality|preset|gpu/i.test(t)) logs.push(t.slice(0, 200)); });
await page.addInitScript((cores) => {
  if (cores) Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => cores });
  const w = (window.__perf = { draws: 0, frames: [], drawsPerFrame: [] });
  for (const proto of [WebGL2RenderingContext.prototype]) {
    for (const fn of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
      const orig = proto[fn];
      proto[fn] = function (...a) { w.draws++; return orig.apply(this, a); };
    }
  }
  let last = performance.now();
  const tick = (t) => { w.frames.push(t - last); w.drawsPerFrame.push(w.draws); w.draws = 0; last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}, cores);
await page.goto(url, { waitUntil: "load" });
const sample = async (label, seconds) => {
  await page.evaluate(() => { window.__perf.frames = []; window.__perf.drawsPerFrame = []; });
  await page.waitForTimeout(seconds * 1000);
  const r = await page.evaluate(() => {
    const f = window.__perf.frames.slice(1).sort((a, b) => a - b);
    const d = window.__perf.drawsPerFrame.slice(1).sort((a, b) => a - b);
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] ?? 0;
    return { n: f.length, fps: f.length ? (1000 / (f.reduce((s, x) => s + x, 0) / f.length)).toFixed(1) : 0,
      p50ms: q(f, 0.5).toFixed(1), p95ms: q(f, 0.95).toFixed(1), drawsP50: q(d, 0.5), drawsMax: d[d.length - 1] };
  });
  console.log(label.padEnd(26), JSON.stringify(r));
};
await page.waitForTimeout(6000);
await sample("menu (scene behind)", 8);
const preset = await page.evaluate(() => document.body.innerText.match(/Auto-detected on this device:\s*(\w+)/)?.[1] ?? "?");
await page.waitForTimeout(18000); // attract mode starts AI vs AI after ~30s idle
await sample("attract AI-vs-AI", 15);
await sample("attract AI-vs-AI later", 15);
console.log("logs:", logs.slice(0, 12).join(" | "));
await browser.close();
