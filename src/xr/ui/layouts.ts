import type { PieceKind } from "../../core/types";
import { MIN_TARGET_M, type PanelButton } from "./canvasPanel";

/** Meta's spacing between hand targets: a fingertip meant for one never lands on its neighbour. */
export const MIN_GAP_M = 0.012;
/** Inside margin of every card. */
const MARGIN_M = 0.014;

type Rect = [number, number, number, number];

/** The crown choices, in the order a chess player reads them. */
export const PROMOTION_CHOICES: readonly { kind: PieceKind; label: string }[] = [
  { kind: "q", label: "Queen" },
  { kind: "r", label: "Rook" },
  { kind: "b", label: "Bishop" },
  { kind: "n", label: "Knight" },
];

const PROMOTE_BUTTON = { width: 0.052, height: 0.04 } as const;
const PROMOTE_TITLE_M = 0.03;

/** The promotion card: a title over four large buttons in a row. */
export const PROMOTION_PANEL = {
  width: MARGIN_M * 2 + PROMOTE_BUTTON.width * 4 + MIN_GAP_M * 3,
  height: PROMOTE_TITLE_M + PROMOTE_BUTTON.height + MARGIN_M,
} as const;

export function promotionButtons(): PanelButton[] {
  return PROMOTION_CHOICES.map(({ kind, label }, index) => ({
    id: `promote-${kind}`,
    rect: [MARGIN_M + index * (PROMOTE_BUTTON.width + MIN_GAP_M), PROMOTE_TITLE_M, PROMOTE_BUTTON.width, PROMOTE_BUTTON.height] as Rect,
    label,
    tone: kind === "q" ? ("primary" as const) : ("plain" as const),
  }));
}

/** The piece a promotion button stands for, or null for any other button. */
export function promotionKindOf(id: string): PieceKind | null {
  const kind = id.startsWith("promote-") ? id.slice("promote-".length) : "";
  return PROMOTION_CHOICES.some((choice) => choice.kind === kind) ? (kind as PieceKind) : null;
}

/**
 * Layout problems on a card: buttons under Meta's 22 mm target, closer than
 * 12 mm to a neighbour, or poking out of the card. Empty when the card is fine.
 */
export function layoutProblems(buttons: PanelButton[], panel: { width: number; height: number }): string[] {
  const problems: string[] = [];
  const epsilon = 1e-6;
  for (const { id, rect } of buttons) {
    const [x, y, w, h] = rect;
    if (w < MIN_TARGET_M - epsilon || h < MIN_TARGET_M - epsilon) problems.push(`${id} is ${w * 1000}x${h * 1000} mm`);
    if (x < -epsilon || y < -epsilon || x + w > panel.width + epsilon || y + h > panel.height + epsilon) problems.push(`${id} leaves the card`);
  }
  for (let i = 0; i < buttons.length; i += 1) {
    for (let j = i + 1; j < buttons.length; j += 1) {
      const [ax, ay, aw, ah] = buttons[i].rect;
      const [bx, by, bw, bh] = buttons[j].rect;
      const gapX = Math.max(bx - (ax + aw), ax - (bx + bw));
      const gapY = Math.max(by - (ay + ah), ay - (by + bh));
      // Apart along either axis by the full gap is fine; diagonal neighbours count by their larger gap.
      if (Math.max(gapX, gapY) < MIN_GAP_M - epsilon) {
        problems.push(`${buttons[i].id} and ${buttons[j].id} are ${(Math.max(gapX, gapY) * 1000).toFixed(1)} mm apart`);
      }
    }
  }
  return problems;
}
