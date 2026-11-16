import type { PanelContent } from "../xr/ui/canvasPanel";
import { UI } from "../xr/ui/palette";
import { drawQr, qrMatrix } from "./qr";
import { getShareable, queueShare, shareableUrl } from "./shareStore";

/**
 * The headset's share card: the replay link as a QR code, big enough for a
 * phone held up to the lenses' cast or a recording (the code itself is at
 * least 12 cm across), with the site under it. Asking for it also queues
 * the 2D share sheet for when the player leaves the session.
 */
export const SHARE_CARD = { width: 0.2, height: 0.275 } as const;

const QR_LEFT = 0.015;
const QR_TOP = 0.036;
const QR_WIDTH = SHARE_CARD.width - QR_LEFT * 2;

/** Panel content for the share card, or null when there is no battle to share. */
export function drawShareCard(): PanelContent | null {
  const url = shareableUrl(getShareable());
  if (!url) return null;
  const matrix = qrMatrix(url);
  queueShare();
  return {
    lines: [
      { text: "Scan to replay", size: 0.013, y: 0.021, color: UI.text },
      { text: "siegemate.pages.dev", size: 0.011, y: 0.222, color: UI.muted },
    ],
    buttons: [{ id: "share-back", rect: [0.05, 0.237, 0.1, 0.03], label: "Back" }],
    draw: (ctx) => {
      // Whole canvas pixels, not panel metres: every module lands on the pixel grid.
      const scale = ctx.getTransform().a;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawQr(ctx, matrix, QR_LEFT * scale, QR_TOP * scale, QR_WIDTH * scale, { dark: UI.goldText, light: UI.text });
      ctx.restore();
    },
  };
}
