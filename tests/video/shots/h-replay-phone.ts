// h. The shared link on a phone: a replay link opens in a phone-sized browser and plays the battle
// back with the same armies on the same battleground; to the end; Share brings up the battle card.
// Pure 2D Chrome (no emulator): no corner label.
import { SCHOLARS, token } from "../../e2e/replay-fixtures.mjs";
import { definePageShot } from "../lib/pageshot.ts";

export default definePageShot({
  kind: "page",
  name: "h-replay-phone",
  description: "A replay link on a phone: the battle plays back (Sun Empire against the Grande Armée, Frostfall), then Share shows the battle card.",
  seconds: 8,
  viewport: { width: 390, height: 844, scale: 3, mobile: true },
  path: () => `/?quality=medium#r=${token(SCHOLARS)}`,
  async setup({ waitFor, wait }) {
    await waitFor(() => Boolean(document.querySelector('[data-testid="replay-bar"]')), undefined, { maxMs: 20_000, label: "the replay bar" });
    // The board and armies standing, the camera settled, before the first frame.
    await wait(1200);
    return {};
  },
  async play({ wait, waitFor, click, clickText, mark, page }) {
    await wait(4600);
    const ply = await page.evaluate(() => (window as unknown as { __replay?: { state(): { ply: number } | null } }).__replay?.state()?.ply ?? null);
    mark("replay-playing", { ply });
    await click('[data-testid="replay-end"]');
    await waitFor(() => Boolean(document.querySelector('[data-testid="replay-result"]')), undefined, { maxMs: 6000, label: "the result" });
    mark("replay-result");
    await wait(1100);
    await clickText("Share");
    await waitFor(() => Boolean(document.querySelector('[data-testid="battle-card"]')), undefined, { maxMs: 8000, label: "the battle card" });
    mark("battle-card");
    await wait(2200);
  },
});
