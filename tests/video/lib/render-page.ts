// Renders a page shot (lib/pageshot.ts): the 2D page in a plain Chrome window (no emulator), its
// frames photographed and set on a dark backdrop at the film's size, no corner label (not emulator
// footage). Called by render.ts with the GPU lock held.
import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import { FILM_ORIGIN, serveAsSite } from "./boot.ts";
import { installFilmClock } from "./clock.ts";
import { openEncoder, probe } from "./encode.ts";
import type { FilmOptions } from "./options.ts";
import { filmInit } from "./page.ts";
import { PageContext, type PageShot } from "./pageshot.ts";
import { SIM_HZ } from "./shot.ts";

/** The film's backdrop behind a phone-sized page. */
export const PAGE_BACKDROP = "0x15171C";

export async function renderPageShot(shot: PageShot, o: FilmOptions, log: (line: string) => void): Promise<void> {
  const t0 = Date.now();
  const browser = await chromium.launch({ channel: "chrome", headless: !o.headed, args: ["--ignore-gpu-blocklist"] });
  const vp = shot.viewport;
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.scale,
    isMobile: vp.mobile ?? false,
    hasTouch: vp.mobile ?? false,
    serviceWorkers: "block",
  });
  await serveAsSite(context, o.baseUrl);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.addInitScript(installFilmClock, { epochMs: Date.parse("2026-11-18T10:00:00Z"), seed: 1 });
    await page.addInitScript(filmInit);
    await page.addInitScript((entries: Record<string, string>) => {
      const w = window as unknown as { __filmStored?: boolean };
      if (w.__filmStored) return;
      w.__filmStored = true;
      localStorage.clear();
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
    }, shot.storage ?? {});
    await page.goto(`${FILM_ORIGIN}${shot.path(FILM_ORIGIN)}`, { waitUntil: "load" });
    await page.waitForFunction(() => Boolean((window as unknown as { __scene?: { piece(s: string): unknown } }).__scene?.piece("e2")), null, { timeout: 120_000 });
    await page.evaluate(() => (window as unknown as { __vt: { pause(): void } }).__vt.pause());
    const ctx = new PageContext(page, SIM_HZ / o.fps);
    const data = await shot.setup(ctx);
    log(`${shot.name}: booted and set up in ${((Date.now() - t0) / 1000).toFixed(1)} s; recording`);
    const mp4 = path.join(o.outDir, `${shot.name}.mp4`);
    // The phone (or window) at 92% of the frame's height, centred on the backdrop, a faint edge round it.
    const h = Math.round(o.outHeight * 0.92 / 2) * 2;
    const prefilter = `scale=-2:${h}:flags=lanczos,pad=iw+4:ih+4:2:2:color=0x3a3f4a,pad=${o.outWidth}:${o.outHeight}:(ow-iw)/2:(oh-ih)/2:color=${PAGE_BACKDROP}`;
    const encoder = openEncoder({ file: mp4, fps: o.fps, format: "image/png", width: o.outWidth, height: o.outHeight, outWidth: o.outWidth, outHeight: o.outHeight, crf: o.crf, preset: o.preset, prefilter });
    const r0 = Date.now();
    ctx.startRecording(encoder);
    const audioFrom = (await page.evaluate(() => (window as unknown as { __filmAudioNow(): number | null }).__filmAudioNow())) as number | null;
    await shot.play(ctx, data);
    await encoder.close();
    if (audioFrom !== null) {
      const wav = (await page.evaluate(
        ([from, secs]) => (window as unknown as { __filmAudioRender(f: number, s: number): Promise<string | null> }).__filmAudioRender(from, secs),
        [audioFrom + 1 / SIM_HZ, ctx.time()] as const,
      )) as string | null;
      if (wav) fs.writeFileSync(path.join(o.outDir, `${shot.name}.wav`), Buffer.from(wav, "base64"));
    }
    const recordMs = Date.now() - r0;
    const file = probe(mp4);
    if (file.frames !== ctx.stats.captured) throw new Error(`${mp4} has ${file.frames} frames, ${ctx.stats.captured} were captured`);
    const seconds = ctx.time();
    const sidecar = {
      shot: shot.name,
      description: shot.description,
      quality: o.quality,
      page: vp,
      delivery: { width: o.outWidth, height: o.outHeight, fps: o.fps, frames: file.frames, seconds: Math.round(seconds * 1000) / 1000 },
      simulatedHz: SIM_HZ,
      label: null,
      events: ctx.events,
      timings: { recordSeconds: Math.round(recordMs / 100) / 10, secondsPerCapturedFrame: Math.round((recordMs / Math.max(1, file.frames)) * 10) / 10000, screenshotMs: Math.round(ctx.stats.shotMs / Math.max(1, ctx.stats.captured)) },
      pageErrors: errors.slice(0, 20),
    };
    fs.writeFileSync(path.join(o.outDir, `${shot.name}.json`), `${JSON.stringify(sidecar, null, 2)}\n`);
    log(`${shot.name}: ${file.frames} frames, ${seconds.toFixed(2)} s in ${(recordMs / 1000).toFixed(0)} s -> ${mp4}`);
  } catch (e) {
    await page.screenshot({ path: path.join(o.outDir, `${shot.name}-failure.png`) }).catch(() => undefined);
    throw e;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
