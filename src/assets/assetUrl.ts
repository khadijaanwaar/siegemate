/**
 * Where the self-hosted assets are served from.
 *
 * Every model, sound and painted card ships in `public/assets/<kind>/` (built
 * by `tools/optimize-assets.mjs`), so the game has no runtime dependency on
 * any other host. The URL follows Vite's `base`, which keeps the same build
 * working from a site root (`/`), a sub-path, or a packaged app (`./`).
 */

export type AssetKind = "models" | "audio" | "cards";

export function assetUrl(kind: AssetKind, file: string): string {
  const base = import.meta.env.BASE_URL;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}assets/${kind}/${file}`;
}
