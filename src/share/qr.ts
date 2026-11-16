import { encode } from "./vendor/uqr.mjs";

/** A QR symbol's dark modules, without its quiet zone. */
export interface QrMatrix {
  /** Modules per side. */
  size: number;
  /** `dark[y][x]`. */
  dark: boolean[][];
}

/** Modules of light margin a reader needs around the symbol. */
export const QR_QUIET_ZONE = 4;

/**
 * The QR code for `text`, made locally (no network): error correction M,
 * raised to the strongest level that still fits the same size.
 */
export function qrMatrix(text: string): QrMatrix {
  const result = encode(text, { ecc: "M", boostEcc: true, border: 0 });
  return { size: result.size, dark: result.data };
}

/**
 * Draws a QR code dark-on-light, as a reader expects, inside a square of
 * `width` canvas pixels at (`x`, `y`), quiet zone included. Modules are whole
 * pixels so no edge is smeared; the leftover is shared out as extra margin.
 * The light plate is cream, never pure white, and the code is never inverted.
 * Returns the square actually covered by the plate.
 */
export function drawQr(
  ctx: CanvasRenderingContext2D,
  matrix: QrMatrix,
  x: number,
  y: number,
  width: number,
  colors: { dark: string; light: string } = { dark: "#15171C", light: "#EEE8DA" },
): { x: number; y: number; width: number; module: number } {
  const span = matrix.size + QR_QUIET_ZONE * 2;
  const module = Math.max(1, Math.floor(width / span));
  const plate = module * span;
  const left = Math.round(x + (width - plate) / 2);
  const top = Math.round(y + (width - plate) / 2);
  ctx.save();
  ctx.fillStyle = colors.light;
  ctx.fillRect(left, top, plate, plate);
  ctx.fillStyle = colors.dark;
  const origin = QR_QUIET_ZONE * module;
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.dark[row][column]) ctx.fillRect(left + origin + column * module, top + origin + row * module, module, module);
    }
  }
  ctx.restore();
  return { x: left, y: top, width: plate, module };
}
