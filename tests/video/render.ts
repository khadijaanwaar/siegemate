/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks (window.__xr, __iwer) are untyped test globals */
// Renders one film shot: node tests/video/render.ts <shot>   (scripts/video.sh runs it per shot).
// One process per shot: it takes the machine's GPU lock (tools/gpu-lock.mjs) for as long as the
// shot draws, keeps it fresh, and lets it go when it exits, so other GPU tests get the GPU between
// shots. Writes <out>/<shot>.mp4 (frames piped straight into ffmpeg) and <shot>.json (event log).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { takeGpuLock } from "../../tools/gpu-lock.mjs";
import { boot } from "./lib/boot.ts";
import { openEncoder, probe } from "./lib/encode.ts";
import { filmOptions } from "./lib/options.ts";
import { EMULATOR_LABEL, SIM_HZ, ShotContext } from "./lib/shot.ts";
import { LOUNGE, ROOM_VIEW, STORAGE } from "./lib/stage.ts";
import { findShot } from "./shots/index.ts";

const name = process.argv[2];
if (!name) throw new Error("usage: node tests/video/render.ts <shot>");
const shot = await findShot(name);
const o = filmOptions();
const log = (line: string) => console.log(`[film ${new Date().toISOString().slice(11, 19)}] ${line}`);
fs.mkdirSync(o.outDir, { recursive: true });

log(`${shot.name}: waiting for the GPU lock`);
await takeGpuLock();
// The lock counts as abandoned after five minutes untouched: keep it fresh while this shot draws.
const lockDir = path.join(os.tmpdir(), "quest-gpu-test.lock");
const heartbeat = setInterval(() => {
  try {
    const now = new Date();
    fs.utimesSync(lockDir, now, now);
  } catch {
    // gone: the exit handler is about to remove it anyway
  }
}, 30_000);
const t0 = Date.now();
log(`${shot.name}: GPU lock held; ${o.width}x${o.height} -> ${o.outWidth}x${o.outHeight} at ${o.fps} fps (${o.quality})`);

const bootOnce = () =>
  boot({
    baseUrl: o.baseUrl,
    width: o.width,
    height: o.height,
    quality: o.gameQuality,
    room: shot.room ?? LOUNGE,
    storage: { ...STORAGE, ...(shot.storage ?? {}) },
    seed: shot.seed ?? 1,
    epochMs: Date.parse("2026-11-18T10:00:00Z"),
    headed: o.headed,
  });
// Right after another GPU test the browser can come up without a WebGL2 context for the room:
// one more try a few seconds later.
const b = await bootOnce().catch(async (e: unknown) => {
  log(`${shot.name}: boot failed (${String(e).slice(0, 120)}); trying again`);
  await new Promise((r) => setTimeout(r, 4000));
  return bootOnce();
});
const { page } = b;
const bootMs = Date.now() - t0;
log(`${shot.name}: booted in ${(bootMs / 1000).toFixed(1)} s on ${b.gpu}`);
await page.evaluate(() => {
  const w = window as any;
  w.__vt.pause();
  w.__iwer.ipd = 0;
  w.__iwer.primaryInputMode = "hand";
});
if (shot.replies?.length) await page.evaluate((m) => void (window as any).__filmReplies.push(...m), shot.replies);

const format = o.quality === "final" ? "image/png" : "image/jpeg";
const ctx = new ShotContext(page, { width: o.width, height: o.height, stride: SIM_HZ / o.fps, hfovDeg: o.hfovDeg, format, handLook: { fill: 0.78, rim: 0.75 }, log }, ROOM_VIEW, shot.sway);
const mp4 = path.join(o.outDir, `${shot.name}.mp4`);
const s0 = Date.now();
let failed: unknown = null;
let encoder: ReturnType<typeof openEncoder> | null = null;
try {
  const data = await shot.setup(ctx);
  const setupMs = Date.now() - s0;
  log(`${shot.name}: set up in ${(setupMs / 1000).toFixed(1)} s (${ctx.n} undrawn frames); recording`);
  encoder = openEncoder({ file: mp4, fps: o.fps, format, width: o.width, height: o.height, outWidth: o.outWidth, outHeight: o.outHeight, crf: o.crf, preset: o.preset });
  const r0 = Date.now();
  const before = { ...ctx.stats };
  ctx.startPlay(shot.firstView(data), encoder, shot.label === undefined ? EMULATOR_LABEL : shot.label);
  await shot.play(ctx, data);
  const recordMs = Date.now() - r0;
  await encoder.close();
  const preset = await page.evaluate(() => (window as any).__scene.preset());
  if (preset !== o.gameQuality) throw new Error(`the game's quality preset moved from ${o.gameQuality} to ${preset} during the shot`);
  const captured = ctx.stats.captured;
  const file = probe(mp4);
  if (file.frames !== captured) throw new Error(`${mp4} has ${file.frames} frames, ${captured} were captured`);
  const seconds = ctx.time();
  const sidecar = {
    shot: shot.name,
    description: shot.description,
    needs: shot.needs ?? null,
    quality: o.quality,
    render: { width: o.width, height: o.height },
    delivery: { width: o.outWidth, height: o.outHeight, fps: o.fps, frames: file.frames, seconds: Math.round(seconds * 1000) / 1000 },
    simulatedHz: SIM_HZ,
    gameQuality: o.gameQuality,
    gpu: b.gpu,
    hfovDeg: o.hfovDeg,
    label: shot.label === undefined ? EMULATOR_LABEL : shot.label,
    events: ctx.events,
    engine: await page.evaluate(() => (window as any).__filmEngineLog),
    timings: {
      bootSeconds: Math.round(bootMs / 100) / 10,
      setupSeconds: Math.round(setupMs / 100) / 10,
      recordSeconds: Math.round(recordMs / 100) / 10,
      secondsPerCapturedFrame: Math.round((recordMs / Math.max(1, captured)) * 10) / 10000,
      renderSecondsPerVideoSecond: Math.round((recordMs / 1000 / Math.max(0.001, seconds)) * 10) / 10,
      perCapturedFrameMs: {
        step: Math.round((ctx.stats.stepMs - before.stepMs) / Math.max(1, ctx.stats.frames - before.frames)),
        capture: Math.round(ctx.stats.captureMs / Math.max(1, captured)),
        transfer: Math.round(ctx.stats.transferMs / Math.max(1, captured)),
        encodeWait: Math.round(ctx.stats.encodeMs / Math.max(1, captured)),
      },
    },
    pageErrors: b.errors.slice(0, 20),
    warnings: b.console.filter((l) => /^warning: film|engine answers/.test(l)).slice(0, 20),
  };
  fs.writeFileSync(path.join(o.outDir, `${shot.name}.json`), `${JSON.stringify(sidecar, null, 2)}\n`);
  log(
    `${shot.name}: ${file.frames} frames, ${seconds.toFixed(2)} s in ${(recordMs / 1000).toFixed(0)} s ` +
      `(${sidecar.timings.secondsPerCapturedFrame} s per frame, ${sidecar.timings.renderSecondsPerVideoSecond} s per video second) -> ${mp4}`,
  );
  if (b.errors.length) log(`${shot.name}: page errors: ${b.errors.slice(0, 3).join(" | ")}`);
} catch (e) {
  failed = e;
  try {
    const png = await page.screenshot();
    fs.writeFileSync(path.join(o.outDir, `${shot.name}-failure.png`), png);
  } catch {
    // no picture of it
  }
  try {
    await encoder?.close();
  } catch {
    // the encode died with the shot
  }
} finally {
  clearInterval(heartbeat);
  await b.browser.close().catch(() => undefined);
}
if (failed) {
  console.error(`[film] ${shot.name} failed:`, failed);
  console.error(b.console.slice(-15).join("\n"));
  process.exit(1);
}
process.exit(0);
