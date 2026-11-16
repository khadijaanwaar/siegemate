// Boot the built game in headless Chrome with Meta's emulator, the film clock and the film room.
import fs from "node:fs";
import path from "node:path";

import { type Browser, type BrowserContext, chromium, type Page } from "playwright";

import { installFilmClock } from "./clock.ts";
import { filmInit, installFrameTools, installRoom, type TableTop } from "./page.ts";

export interface RoomSpec {
  /** Equirectangular JPEG, from the repo root. */
  file: string;
  /** The photograph's column 0.5 + yawDeg / 360 straight ahead (-Z). */
  yawDeg: number;
  /** Where hit tests find the table top. */
  table: TableTop;
}

export interface BootOptions {
  baseUrl: string;
  width: number;
  height: number;
  /** Quality preset, pinned (the laptop's GPU would otherwise pick "low"). */
  quality: string;
  room: RoomSpec;
  /** localStorage before the app loads (onboarding, board size). */
  storage: Record<string, string>;
  seed: number;
  epochMs: number;
  headed?: boolean;
}

export interface Booted {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  errors: string[];
  console: string[];
  gpu: string;
}

export async function boot(o: BootOptions): Promise<Booted> {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: !o.headed,
    args: ["--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({
    viewport: { width: o.width, height: o.height },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const lines: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    lines.push(`${m.type()}: ${m.text()}`);
    if (m.type() === "error" || /context lost/i.test(m.text())) errors.push(m.text().slice(0, 300));
  });
  await page.addInitScript(installFilmClock, { epochMs: o.epochMs, seed: o.seed });
  await page.addInitScript(filmInit);
  await page.addInitScript((entries: Record<string, string>) => {
    if ((window as unknown as { __filmStored?: boolean }).__filmStored) return;
    (window as unknown as { __filmStored?: boolean }).__filmStored = true;
    localStorage.clear();
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
  }, o.storage);
  await page.goto(`${o.baseUrl}/?emulate&quality=${encodeURIComponent(o.quality)}`, { waitUntil: "load" });
  await page.waitForFunction(() => {
    const w = window as unknown as { __xr?: unknown; __iwer?: unknown; __scene?: { piece(s: string): unknown } };
    return Boolean(w.__xr && w.__iwer && w.__scene?.piece("e2"));
  }, null, { timeout: 120_000 });
  await page.evaluate(installFrameTools);
  const jpeg = fs.readFileSync(path.resolve(o.room.file)).toString("base64");
  const room = await page.evaluate(installRoom, { jpegBase64: jpeg, yawDeg: o.room.yawDeg, table: o.room.table });
  if (!room.ok) {
    await browser.close().catch(() => undefined);
    throw new Error(`room: ${room.why}`);
  }
  const gpu = await page.evaluate(() => {
    const c = document.createElement("canvas").getContext("webgl2");
    const ext = c?.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(c!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
  });
  return { browser, context, page, errors, console: lines, gpu };
}
