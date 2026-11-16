// Devpost 08: a 2D composite on the dark #15171C: the 1200x630 battle card (docs/share/battle-card.png) at about 60%
// of the width on the left, and on the right a phone capture of the replay page playing the same game (Scholar's mate,
// Sun Empire against the Grande Armée on Frostfall), captured here at 390x844 CSS pixels and device scale 3. Small
// Inter captions under each: "Battle card" and "Replay on a phone". No emulator label (not emulator footage).
import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import { SCHOLARS, token } from "../../e2e/replay-fixtures.mjs";
import { FILM_ORIGIN, serveAsSite } from "../lib/boot.ts";
import { installFilmClock } from "../lib/clock.ts";
import type { FilmOptions } from "../lib/options.ts";
import { filmInit } from "../lib/page.ts";
import { GALLERY } from "./_common.ts";

const OUT = GALLERY("08-the-replay-anywhere");

async function phoneCapture(o: FilmOptions): Promise<Buffer> {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist"] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    await serveAsSite(context, o.baseUrl);
    const page = await context.newPage();
    await page.addInitScript(installFilmClock, { epochMs: Date.parse("2026-11-18T10:00:00Z"), seed: 1 });
    await page.addInitScript(filmInit);
    await page.goto(`${FILM_ORIGIN}/?quality=medium#r=${token(SCHOLARS)}`, { waitUntil: "load" });
    await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="replay-bar"]')), null, { timeout: 120_000 });
    await page.evaluate(() => (window as unknown as { __vt: { pause(): void } }).__vt.pause());
    // Play on until the replay is a few moves in.
    for (let i = 0; i < 60 * 12; i++) {
      const ply = await page.evaluate(async () => {
        const w = window as unknown as { __filmIdle(): Promise<boolean>; __vt: { step(ms: number): unknown }; __replay?: { state(): { ply: number; busy: boolean } | null } };
        await w.__filmIdle();
        w.__vt.step(1000 / 60);
        const s = w.__replay?.state();
        return s && !s.busy ? s.ply : -1;
      });
      if (ply >= 5) break;
    }
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

export default {
  kind: "composite" as const,
  name: "08-the-replay-anywhere",
  description: "Battle card and a phone replaying the same game, side by side.",
  still: OUT,
  async make(o: FilmOptions, log: (line: string) => void): Promise<void> {
    const phone = await phoneCapture(o);
    const card = fs.readFileSync(path.resolve("docs/share/battle-card.png"));
    const font = fs.readFileSync(path.resolve("public/fonts/inter-latin.woff2"));
    const b64 = (b: Buffer) => b.toString("base64");
    const html = `<!doctype html><html><head><style>
@font-face { font-family: Inter; src: url(data:font/woff2;base64,${b64(font)}) format("woff2"); font-weight: 100 900; }
html, body { margin: 0; width: 2160px; height: 1440px; background: #15171c; font-family: Inter, sans-serif; }
.row { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 120px; }
figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 28px; }
.card { width: 1296px; border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,.55); }
.phone { height: 1180px; border-radius: 44px; border: 3px solid #3a3f4a; box-shadow: 0 30px 80px rgba(0,0,0,.55); }
figcaption { color: rgba(255,246,232,.72); font-size: 30px; font-weight: 600; letter-spacing: .01em; }
</style></head><body><div class="row">
<figure><img class="card" src="data:image/png;base64,${b64(card)}"><figcaption>Battle card</figcaption></figure>
<figure><img class="phone" src="data:image/png;base64,${b64(phone)}"><figcaption>Replay on a phone</figcaption></figure>
</div></body></html>`;
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 2160, height: 1440 }, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const png = await page.screenshot({ type: "png" });
      const { default: sharp } = await import("sharp");
      let q = OUT.quality;
      let jpg = await sharp(png).jpeg({ quality: q, mozjpeg: true }).toBuffer();
      while (jpg.length > 600 * 1024 && q > 70) {
        q -= 3;
        jpg = await sharp(png).jpeg({ quality: q, mozjpeg: true }).toBuffer();
      }
      fs.mkdirSync(path.dirname(path.resolve(OUT.file)), { recursive: true });
      fs.writeFileSync(path.resolve(OUT.file), jpg);
      log(`${this.name}: 2160x1440 JPEG q${q}, ${Math.round(jpg.length / 1024)} KB -> ${OUT.file}`);
    } finally {
      await browser.close();
    }
  },
};
