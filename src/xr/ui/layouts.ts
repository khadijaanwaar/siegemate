import type { Difficulty, Faction, PieceKind } from "../../core/types";
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

/** The control slab beside the board: status over Undo and Menu. */
export const SLAB_PANEL = { width: 0.17, height: 0.085 } as const;

export function slabButtons(state: { canUndo: boolean; menuOpen: boolean }): PanelButton[] {
  const width = (SLAB_PANEL.width - 2 * 0.012 - MIN_GAP_M) / 2;
  return [
    { id: "undo", rect: [0.012, 0.04, width, 0.034], label: "Undo", disabled: !state.canUndo },
    { id: "menu", rect: [0.012 + width + MIN_GAP_M, 0.04, width, 0.034], label: "Menu", tone: state.menuOpen ? "selected" : "plain" },
  ];
}

const STRENGTHS: { id: Difficulty; label: string }[] = [
  { id: "easy", label: "Squire" },
  { id: "medium", label: "Knight" },
  { id: "hard", label: "Warlord" },
];

/** What the menu shows: the next game's settings, sound, the board's height and whether Exit waits for its second tap. */
export interface MenuState {
  strength: Difficulty;
  side: Faction;
  /** The battleground's name. */
  arena: string;
  sound: boolean;
  music: boolean;
  /** The board's height above (or below) where it was placed, in whole centimetres. */
  heightCm: number;
  exitArmed: boolean;
}

const MENU_WIDTH = 0.3;
const ROW_H = 0.028;
const ROW_PITCH = ROW_H + MIN_GAP_M;
const MENU_TOP = 0.026;
const rowY = (row: number): number => MENU_TOP + row * ROW_PITCH;
/** The New game row stands a little taller than the rest. */
const NEW_GAME_H = 0.032;

/** The menu card: seven rows of buttons, 28 mm tall and 12 mm apart. */
export const MENU_PANEL = { width: MENU_WIDTH, height: rowY(6) + (NEW_GAME_H - ROW_H) + ROW_H + MARGIN_M } as const;

/** Splits a row into `count` equal buttons with the standard gap. */
function columns(count: number): { x: number; width: number }[] {
  const width = (MENU_WIDTH - 2 * MARGIN_M - (count - 1) * MIN_GAP_M) / count;
  return Array.from({ length: count }, (_, index) => ({ x: MARGIN_M + index * (width + MIN_GAP_M), width }));
}

export function menuButtons(state: MenuState): PanelButton[] {
  const thirds = columns(3);
  const halves = columns(2);
  const full = columns(1)[0];
  const tone = (on: boolean) => (on ? ("selected" as const) : ("plain" as const));
  const arrow = 0.05;
  const lastY = rowY(6) + (NEW_GAME_H - ROW_H);
  return [
    ...STRENGTHS.map((strength, index) => ({
      id: strength.id,
      rect: [thirds[index].x, rowY(0), thirds[index].width, ROW_H] as Rect,
      label: strength.label,
      tone: tone(state.strength === strength.id),
    })),
    { id: "side-w", rect: [halves[0].x, rowY(1), halves[0].width, ROW_H], label: "Play white", tone: tone(state.side === "w") },
    { id: "side-b", rect: [halves[1].x, rowY(1), halves[1].width, ROW_H], label: "Play black", tone: tone(state.side === "b") },
    { id: "arena", rect: [full.x, rowY(2), full.width, ROW_H], label: `Battleground · ${state.arena}` },
    { id: "sound", rect: [halves[0].x, rowY(3), halves[0].width, ROW_H], label: state.sound ? "Sound on" : "Sound off", tone: tone(state.sound) },
    { id: "music", rect: [halves[1].x, rowY(3), halves[1].width, ROW_H], label: state.music ? "Music on" : "Music off", tone: tone(state.music) },
    { id: "lower", rect: [MARGIN_M, rowY(4), arrow, ROW_H], label: "▼" },
    { id: "raise", rect: [MENU_WIDTH - MARGIN_M - arrow, rowY(4), arrow, ROW_H], label: "▲" },
    { id: "new", rect: [full.x, rowY(5), full.width, NEW_GAME_H], label: "New game", tone: "primary" },
    { id: "replace", rect: [thirds[0].x, lastY, thirds[0].width, ROW_H], label: "Re-place" },
    { id: "howto", rect: [thirds[1].x, lastY, thirds[1].width, ROW_H], label: "How to" },
    { id: "exit", rect: [thirds[2].x, lastY, thirds[2].width, ROW_H], label: state.exitArmed ? "Really exit?" : "Exit", tone: "danger" },
  ];
}

/** The menu's words between its buttons: the strength heading and the board's height between ▼ and ▲. */
export function menuLines(state: MenuState): { text: string; size: number; y: number; color?: string }[] {
  const height = state.heightCm === 0 ? "Board height" : `Board height ${state.heightCm > 0 ? "+" : "−"}${Math.abs(state.heightCm)} cm`;
  return [
    { text: "Strength", size: 0.009, y: 0.015 },
    { text: height, size: 0.01, y: rowY(4) + ROW_H / 2 },
  ];
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
