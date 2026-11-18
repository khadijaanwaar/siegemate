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
import { renderPageShot } from "./lib/render-page.ts";
import { EMULATOR_LABEL, SIM_HZ, ShotContext } from "./lib/shot.ts";
import { LOUNGE, ROOM_VIEW, STORAGE } from "./lib/stage.ts";
import { findShot } from "./shots/index.ts";

const name = process.argv[2];
if (!name) throw new Error("usage: node tests/video/render.ts <shot>");
const shot = await findShot(name);
const o = filmOptions();
const still = "still" in shot ? shot.still : undefined;
if (still) {
  // A still is drawn at its own size whatever the clip settings.
  [o.width, o.height] = still.size;
  [o.outWidth, o.outHeight] = still.out;
}
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

if ("kind" in shot && (shot as { kind: string }).kind === "composite") {
  // A composite still (2D images laid out by the browser), no game frame of its own beyond what make() takes.
  try {
    await (shot as unknown as { make(o: typeof o, log: (l: string) => void): Promise<void> }).make(o, log);
  } catch (e) {
    console.error(`[film] ${shot.name} failed:`, e);
    process.exit(1);
  } finally {
    clearInterval(heartbeat);
  }
  process.exit(0);
}

if ("kind" in shot && shot.kind === "page") {
  // A page shot: the 2D page in a plain browser (lib/render-page.ts).
  try {
    await renderPageShot(shot, o, log);
  } catch (e) {
    console.error(`[film] ${shot.name} failed:`, e);
    process.exit(1);
  } finally {
    clearInterval(heartbeat);
  }
  process.exit(0);
}

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
// a few more tries, each a little later.
const b = await (async () => {
  for (let i = 1; ; i++) {
    try {
      return await bootOnce();
    } catch (e) {
      if (i >= 4) throw e;
      log(`${shot.name}: boot failed (${String(e).slice(0, 120)}); trying again (${i}/3)`);
      await new Promise((r) => setTimeout(r, 4000 * i));
    }
  }
})();
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

if (still) {
  // A still: everything undrawn up to the end of play(), then one drawn frame, saved as a JPEG.
  const ctx = new ShotContext(page, { width: o.width, height: o.height, stride: 1e9, hfovDeg: o.hfovDeg, format: "image/png", handLook: { fill: 0.78, rim: 0.75 }, log }, ROOM_VIEW, shot.sway ?? { mm: 0, deg: 0 });
  let last: Buffer | null = null;
  try {
    const data = await shot.setup(ctx);
    ctx.startPlay(shot.firstView(data), { write: async (img: Buffer) => void (last = img) }, shot.label === undefined ? EMULATOR_LABEL : shot.label);
    await shot.play(ctx, data);
    const burst = process.env.BURST_DIR;
    if (burst) {
      // Timing a still: a frame every BURST_EVERY ms for BURST_MS after play() (run with HIT_MS=0),
      // each saved as <dir>/<name>-<ms>.jpg, to pick the moment.
      const every = Math.max(1, Math.round((Number(process.env.BURST_EVERY ?? 100) * 60) / 1000));
      const frames = Math.round((Number(process.env.BURST_MS ?? 4000) * 60) / 1000);
      fs.mkdirSync(burst, { recursive: true });
      const { default: sharp } = await import("sharp");
      for (let i = 0; i <= frames; i++) {
        last = null;
        ctx.captureNext = i % every === 0;
        await ctx.step();
        if (last) {
          const ms = String(Math.round((i * 1000) / 60)).padStart(5, "0");
          await sharp(last).resize(960, Math.round((960 * o.height) / o.width)).jpeg({ quality: 80 }).toFile(path.join(burst, `${shot.name}-${ms}.jpg`));
        }
      }
      log(`${shot.name}: burst of ${Math.floor(frames / every) + 1} frames -> ${burst}`);
      clearInterval(heartbeat);
      await b.browser.close().catch(() => undefined);
      process.exit(0);
    }
    ctx.captureNext = true;
    await ctx.step();
    if (!last) throw new Error("no frame captured");
    const { default: sharp } = await import("sharp");
    const out = path.resolve(still.file);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (still.format === "png") {
      // Lossless, for a card drawn on top later (no size cap).
      const png = await sharp(last).resize(still.out[0], still.out[1], { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toBuffer();
      fs.writeFileSync(out, png);
      log(`${shot.name}: ${still.out[0]}x${still.out[1]} PNG, ${Math.round(png.length / 1024)} KB -> ${still.file}`);
      if (b.errors.length) log(`${shot.name}: page errors: ${b.errors.slice(0, 3).join(" | ")}`);
      clearInterval(heartbeat);
      await b.browser.close().catch(() => undefined);
      process.exit(0);
    }
    const maxBytes = (still.maxKb ?? 600) * 1024;
    let q = still.quality;
    let jpg: Buffer;
    for (;;) {
      jpg = await sharp(last).resize(still.out[0], still.out[1], { kernel: "lanczos3" }).jpeg({ quality: q, mozjpeg: true }).toBuffer();
      if (jpg.length <= maxBytes || q <= 70) break;
      q -= 3;
    }
    fs.writeFileSync(out, jpg);
    log(`${shot.name}: ${still.out[0]}x${still.out[1]} JPEG q${q}, ${Math.round(jpg.length / 1024)} KB -> ${still.file}`);
    if (b.errors.length) log(`${shot.name}: page errors: ${b.errors.slice(0, 3).join(" | ")}`);
  } catch (e) {
    console.error(`[film] ${shot.name} failed:`, e);
    await page.screenshot({ path: path.join(o.outDir, `${shot.name}-failure.png`) }).catch(() => undefined);
    clearInterval(heartbeat);
    await b.browser.close().catch(() => undefined);
    process.exit(1);
  }
  clearInterval(heartbeat);
  await b.browser.close().catch(() => undefined);
  process.exit(0);
}

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
  // Where the clip starts on the game's sound timeline (frame 0 is drawn one step later).
  const audioFrom = (await page.evaluate(() => (window as any).__filmAudioNow())) as number | null;
  await shot.play(ctx, data);
  const recordMs = Date.now() - r0;
  await encoder.close();
  // The game's own sound for exactly the recorded stretch, rendered offline (lib/page.ts).
  const wavPath = path.join(o.outDir, `${shot.name}.wav`);
  if (audioFrom !== null) {
    const wav = (await page.evaluate(([from, secs]) => (window as any).__filmAudioRender(from, secs), [audioFrom + 1 / SIM_HZ, ctx.time()] as const)) as string | null;
    if (wav) fs.writeFileSync(wavPath, Buffer.from(wav, "base64"));
  } else {
    log(`${shot.name}: the game made no AudioContext; no game sound`);
  }
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
