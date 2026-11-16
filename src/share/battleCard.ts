import type { Faction, PieceKind } from "../core/types";
import { ARENA_LOOKS } from "../scene/arena";
import { replayPosition, type ReplayGame } from "./replay";
import { arenaName, battleCompany, battleDate, battleHeadline, battleReason, sideName } from "./story";

/** Link-preview size (1.91:1), what chat apps and social cards expect. */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const SITE_LABEL = "siegemate.pages.dev";

/** The 2D interface's palette (src/ui/medieval.css): never pure black or white. */
const INK = {
  panel: "#15171C",
  surface: "#1E2128",
  line: "#2E323B",
  text: "#EEE8DA",
  muted: "#A9A396",
  gold: "#E0B75A",
  azure: "#6EA8FF",
  ember: "#FF6A55",
  danger: "#E5574B",
  ivory: "#EEE8DA",
  obsidian: "#1D1E24",
};
const DISPLAY = "Cinzel, Georgia, serif";
const UI_FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const BOARD_X = 48;
const BOARD_Y = 51;
const SQUARE = 66;
const TEXT_X = 648;
const TEXT_WIDTH = CARD_WIDTH - TEXT_X - 56;

/**
 * The battle card: the final position as a clean board diagram, the result in
 * words, both armies, the battleground and the site. A pure function of the
 * replay, so it draws the same after a headset session, from a bare link or in
 * a test, and never depends on where the 3D camera happened to be.
 */
export async function renderBattleCard(game: ReplayGame, canvas: HTMLCanvasElement = document.createElement("canvas")): Promise<HTMLCanvasElement> {
  await fontsReady();
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  drawCard(ctx, game);
  return canvas;
}

/** The card as a PNG file, ready for `navigator.share({ files })` or a download. */
export async function battleCardFile(game: ReplayGame): Promise<File> {
  const canvas = await renderBattleCard(game);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("could not encode the card"))), "image/png"),
  );
  return new File([blob], `siegemate-battle-${game.date}.png`, { type: "image/png" });
}

async function fontsReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`700 40px ${DISPLAY}`),
        document.fonts.load(`600 20px ${UI_FONT}`),
        document.fonts.load(`500 20px ${UI_FONT}`),
      ]),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    // The fallback faces are fine; the card still draws.
  }
}

function drawCard(ctx: CanvasRenderingContext2D, game: ReplayGame): void {
  const look = ARENA_LOOKS[game.arena];
  // Ground: the panel colour with a faint glow of the battleground's sky.
  ctx.fillStyle = INK.panel;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const glow = ctx.createRadialGradient(BOARD_X + SQUARE * 4, BOARD_Y + SQUARE * 4, 60, BOARD_X + SQUARE * 4, BOARD_Y + SQUARE * 4, 520);
  glow.addColorStop(0, withAlpha(hex(look.sky.horizon), 0.22));
  glow.addColorStop(1, withAlpha(hex(look.sky.horizon), 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  drawBoard(ctx, game);
  drawStory(ctx, game);
}

// ---------------------------------------------------------------- the board

function drawBoard(ctx: CanvasRenderingContext2D, game: ReplayGame): void {
  const look = ARENA_LOOKS[game.arena];
  const chess = replayPosition(game);
  const flipped = game.mode === "ai" && game.playerColor === "b";
  const size = SQUARE * 8;
  const last = game.moves[game.moves.length - 1] ?? null;
  const fallenKing = game.result?.reason === "checkmate" ? (chess.turn() as Faction) : null;

  // Frame in the battleground's border colour.
  ctx.fillStyle = hex(look.board.base);
  roundRect(ctx, BOARD_X - 12, BOARD_Y - 12, size + 24, size + 24, 10);
  ctx.fill();
  ctx.strokeStyle = hex(look.board.border);
  ctx.lineWidth = 2;
  roundRect(ctx, BOARD_X - 5, BOARD_Y - 5, size + 10, size + 10, 4);
  ctx.stroke();

  const board = chess.board();
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      // Screen cell → board square.
      const rank = flipped ? row : 7 - row; // 0 = rank 1
      const file = flipped ? 7 - column : column;
      const x = BOARD_X + column * SQUARE;
      const y = BOARD_Y + row * SQUARE;
      const light = (rank + file) % 2 === 1;
      ctx.fillStyle = hex(light ? look.board.light : look.board.dark);
      ctx.fillRect(x, y, SQUARE, SQUARE);

      const name = "abcdefgh"[file] + String(rank + 1);
      if (last && (last.from === name || last.to === name)) {
        ctx.fillStyle = withAlpha(INK.gold, 0.42);
        ctx.fillRect(x, y, SQUARE, SQUARE);
      }

      const piece = board[7 - rank][file];
      if (piece && fallenKing && piece.type === "k" && piece.color === fallenKing) {
        const halo = ctx.createRadialGradient(x + SQUARE / 2, y + SQUARE / 2, 4, x + SQUARE / 2, y + SQUARE / 2, SQUARE * 0.62);
        halo.addColorStop(0, withAlpha(INK.danger, 0.85));
        halo.addColorStop(1, withAlpha(INK.danger, 0));
        ctx.fillStyle = halo;
        ctx.fillRect(x, y, SQUARE, SQUARE);
      }

      // Coordinates on the edge squares, in the opposite square colour.
      ctx.fillStyle = hex(light ? look.board.dark : look.board.light);
      ctx.font = `600 12px ${UI_FONT}`;
      if (row === 7) {
        ctx.textAlign = "right";
        ctx.textBaseline = "alphabetic";
        ctx.fillText("abcdefgh"[file], x + SQUARE - 4, y + SQUARE - 4);
      }
      if (column === 0) {
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(String(rank + 1), x + 4, y + 4);
      }

      if (piece) drawFigure(ctx, piece.type as PieceKind, piece.color as Faction, x, y, SQUARE);
    }
  }
}

/**
 * A Staunton silhouette in a 100-unit box: drawn, not typed, so no phone
 * swaps a chess glyph for an emoji. Ivory figures are cream on a dark
 * outline, obsidian ones dark on a light one, each standing on its side's
 * azure or ember band — the same colour code as the 3D board.
 */
function drawFigure(ctx: CanvasRenderingContext2D, kind: PieceKind, color: Faction, x: number, y: number, size: number): void {
  ctx.save();
  ctx.translate(x + size * 0.07, y + size * 0.06);
  ctx.scale((size * 0.86) / 100, (size * 0.86) / 100);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const fill = color === "w" ? INK.ivory : INK.obsidian;
  const edge = color === "w" ? "#2A2620" : "#D9CFB8";

  // Soft shadow so a figure reads on either square colour.
  ctx.shadowColor = "rgba(10, 10, 12, 0.45)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;

  const path = new Path2D();
  switch (kind) {
    case "p":
      path.moveTo(36, 82);
      path.quadraticCurveTo(38, 60, 44, 50);
      path.lineTo(56, 50);
      path.quadraticCurveTo(62, 60, 64, 82);
      path.closePath();
      path.moveTo(64, 49);
      path.ellipse(50, 49, 14, 4.5, 0, 0, Math.PI * 2);
      path.moveTo(63, 34);
      path.arc(50, 34, 13, 0, Math.PI * 2);
      break;
    case "r":
      path.moveTo(34, 82);
      path.lineTo(36, 44);
      path.lineTo(64, 44);
      path.lineTo(66, 82);
      path.closePath();
      path.moveTo(28, 44);
      path.lineTo(28, 20);
      path.lineTo(37, 20);
      path.lineTo(37, 28);
      path.lineTo(45, 28);
      path.lineTo(45, 20);
      path.lineTo(55, 20);
      path.lineTo(55, 28);
      path.lineTo(63, 28);
      path.lineTo(63, 20);
      path.lineTo(72, 20);
      path.lineTo(72, 44);
      path.closePath();
      break;
    case "n":
      path.moveTo(30, 82);
      path.lineTo(72, 82);
      path.bezierCurveTo(74, 66, 74, 50, 70, 38);
      path.bezierCurveTo(66, 24, 58, 18, 52, 17);
      path.lineTo(50, 8);
      path.lineTo(44, 18);
      path.bezierCurveTo(34, 24, 24, 38, 21, 48);
      path.bezierCurveTo(19, 55, 26, 60, 31, 56);
      path.lineTo(42, 50);
      path.bezierCurveTo(46, 56, 36, 66, 30, 82);
      path.closePath();
      break;
    case "b":
      path.moveTo(36, 82);
      path.quadraticCurveTo(40, 62, 44, 54);
      path.lineTo(56, 54);
      path.quadraticCurveTo(60, 62, 64, 82);
      path.closePath();
      path.moveTo(64, 53);
      path.ellipse(50, 53, 14, 4.5, 0, 0, Math.PI * 2);
      path.moveTo(50, 14);
      path.bezierCurveTo(67, 26, 66, 44, 50, 50);
      path.bezierCurveTo(34, 44, 33, 26, 50, 14);
      path.closePath();
      path.moveTo(54, 10);
      path.arc(50, 10, 4, 0, Math.PI * 2);
      break;
    case "q":
      path.moveTo(35, 82);
      path.quadraticCurveTo(40, 66, 38, 56);
      path.lineTo(62, 56);
      path.quadraticCurveTo(60, 66, 65, 82);
      path.closePath();
      path.moveTo(36, 58);
      path.lineTo(24, 26);
      path.lineTo(38, 42);
      path.lineTo(42, 20);
      path.lineTo(50, 40);
      path.lineTo(58, 20);
      path.lineTo(62, 42);
      path.lineTo(76, 26);
      path.lineTo(64, 58);
      path.closePath();
      for (const [cx, cy] of [
        [24, 24],
        [42, 18],
        [58, 18],
        [76, 24],
      ]) {
        path.moveTo(cx + 4.5, cy);
        path.arc(cx, cy, 4.5, 0, Math.PI * 2);
      }
      break;
    case "k":
      path.moveTo(35, 82);
      path.quadraticCurveTo(40, 66, 38, 56);
      path.lineTo(62, 56);
      path.quadraticCurveTo(60, 66, 65, 82);
      path.closePath();
      path.moveTo(32, 58);
      path.bezierCurveTo(26, 44, 30, 30, 50, 30);
      path.bezierCurveTo(70, 30, 74, 44, 68, 58);
      path.closePath();
      path.rect(46.5, 8, 7, 22);
      path.rect(41, 13, 18, 6.5);
      break;
  }
  // Base, shared by every rank.
  path.rect(24, 81, 52, 10);

  ctx.fillStyle = fill;
  ctx.fill(path, "nonzero");
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 3;
  ctx.strokeStyle = edge;
  ctx.stroke(path);

  if (kind === "n") {
    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.arc(46, 31, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (kind === "b") {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(45, 36);
    ctx.lineTo(56, 26);
    ctx.stroke();
  }

  // The side's band on the base.
  ctx.fillStyle = color === "w" ? INK.azure : INK.ember;
  ctx.fillRect(27, 84, 46, 4);
  ctx.restore();
}

// ----------------------------------------------------------------- the words

function drawStory(ctx: CanvasRenderingContext2D, game: ReplayGame): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Wordmark.
  ctx.fillStyle = INK.gold;
  ctx.font = `700 26px ${DISPLAY}`;
  spaced(ctx, "SIEGEMATE", TEXT_X, 92, 5);

  // Reason, as an eyebrow.
  const winner = game.result?.winner ?? null;
  ctx.fillStyle = INK.muted;
  ctx.font = `600 17px ${UI_FONT}`;
  spaced(ctx, battleReason(game).toUpperCase(), TEXT_X, 158, 2.4);

  // The result line: as large as fits in three lines.
  const headline = battleHeadline(game);
  let size = 44;
  let lines = wrap(ctx, headline, TEXT_WIDTH, `700 ${size}px ${DISPLAY}`);
  while (lines.length > 3 && size > 30) {
    size -= 2;
    lines = wrap(ctx, headline, TEXT_WIDTH, `700 ${size}px ${DISPLAY}`);
  }
  ctx.fillStyle = INK.text;
  ctx.font = `700 ${size}px ${DISPLAY}`;
  const lineHeight = Math.round(size * 1.22);
  let y = 158 + 18 + lineHeight;
  for (const line of lines) {
    ctx.fillText(line, TEXT_X, y);
    y += lineHeight;
  }

  // Both armies, the winner's crest lit.
  y += 18;
  for (const side of ["w", "b"] as const) {
    drawCrest(ctx, side, TEXT_X, y - 26, winner === side);
    ctx.fillStyle = winner === side ? INK.text : INK.muted;
    ctx.font = `600 21px ${UI_FONT}`;
    ctx.fillText(sideName(game, side), TEXT_X + 44, y);
    y += 44;
  }

  // Battleground, company and date.
  ctx.fillStyle = INK.muted;
  ctx.font = `500 18px ${UI_FONT}`;
  ctx.fillText(`${arenaName(game.arena)} · ${battleCompany(game)}`, TEXT_X, Math.max(y + 10, 500));
  ctx.fillText(battleDate(game.date), TEXT_X, Math.max(y + 38, 528));

  // The site, bottom right, with a gold rule.
  ctx.fillStyle = INK.line;
  ctx.fillRect(TEXT_X, 556, TEXT_WIDTH, 1);
  ctx.fillStyle = INK.gold;
  ctx.font = `600 20px ${UI_FONT}`;
  ctx.fillText(SITE_LABEL, TEXT_X, 590);
  ctx.fillStyle = INK.muted;
  ctx.font = `500 16px ${UI_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("Mixed reality chess", TEXT_X + TEXT_WIDTH, 590);
  ctx.textAlign = "left";
}

/** The faction shield from the 2D interface (Heraldry.tsx), in its 40×46 box. */
function drawCrest(ctx: CanvasRenderingContext2D, side: Faction, x: number, y: number, lit: boolean): void {
  const field = side === "w" ? "#E9DFC8" : "#1D1E24";
  const charge = side === "w" ? "#2F6DC4" : "#D4402A";
  const trim = side === "w" ? (lit ? "#A8D6FF" : "#5A8CC8") : lit ? "#FFB083" : "#B0563A";
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(0.72, 0.72);
  ctx.fillStyle = field;
  ctx.strokeStyle = trim;
  ctx.lineWidth = 2.4;
  const shield = new Path2D("M20 2 L37 7 V22 C37 32 29 40 20 44 C11 40 3 32 3 22 V7 Z");
  ctx.fill(shield);
  ctx.stroke(shield);
  ctx.fillStyle = charge;
  ctx.fill(new Path2D("M20 12 c-3 0-5 2-5 5 0 2 1 3 2 4 l-3 6 h4 l2-4 2 4 h4 l-3-6 c1-1 2-2 2-4 0-3-2-5-5-5z"));
  ctx.restore();
}

function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number): void {
  let cursor = x;
  for (const char of text) {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + tracking;
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, font: string): string[] {
  ctx.font = font;
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hex(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function withAlpha(color: string, alpha: number): string {
  const value = parseInt(color.slice(1), 16);
  return `rgba(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}, ${alpha})`;
}
