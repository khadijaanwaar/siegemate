/* eslint-disable @typescript-eslint/no-explicit-any -- the page hooks (window.__xr) are untyped test globals */
// i. Offline: the 2D page in a laptop-sized browser; the network is cut for real (the browser context goes offline),
// then the player plays e4 and the computer answers from the page's own engine. The film's edit labels the moment
// "Network off". That the whole game also reloads from the cache offline is tests/e2e/offline.mjs's job, not this
// shot's (the film's frame clock needs service workers blocked). Pure 2D Chrome: no corner label.
import { definePageShot } from "../lib/pageshot.ts";

export default definePageShot({
  kind: "page",
  name: "i-offline",
  description: "The 2D page, network cut: e4, and the computer answers with no connection.",
  seconds: 7,
  viewport: { width: 1280, height: 720, scale: process.env.QUALITY === "final" ? 1.5 : 0.75 },
  path: () => "/?quality=medium",
  async setup({ waitFor, wait, page }) {
    await waitFor(() => Boolean((window as any).__scene?.piece("e2") && (window as any).__xr), undefined, { maxMs: 40_000, label: "the armies" });
    await page.evaluate(() => (window as any).__xr.startVsComputer("medium"));
    // The board settled and the engine warmed, before the first frame.
    await wait(2500);
    return {};
  },
  async play({ wait, waitFor, mark, page }) {
    await wait(900);
    // Every request from here fails at once, as with no network (the newest route wins over the film's own
    // site route); then the browser goes offline too, so the page sees navigator.onLine false.
    await page.context().route("**/*", (route) => route.abort("internetdisconnected"));
    await page.context().setOffline(true);
    mark("network-off");
    await wait(900);
    await page.evaluate(() => (window as any).__xr.move("e2", "e4"));
    mark("move", { san: "e4" });
    await waitFor(() => (window as any).__xr.snapshot().sanList.length >= 2, undefined, { maxMs: 15_000, label: "the computer's reply" });
    mark("reply", { san: await page.evaluate(() => (window as any).__xr.snapshot().sanList[1]) });
    await wait(2200);
  },
});
