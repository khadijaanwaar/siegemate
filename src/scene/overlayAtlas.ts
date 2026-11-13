import * as THREE from "three";

/** Pixel size of one picture going into an atlas. */
export interface AtlasSource {
  key: string;
  width: number;
  height: number;
}

/** Where a picture landed, in canvas pixels (y down), gutter excluded. */
export interface AtlasCell {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AtlasLayout {
  width: number;
  height: number;
  cells: Map<string, AtlasCell>;
}

/**
 * Offset and scale taking a quad's 0..1 UVs onto one cell: `[u0, v0, du, dv]`.
 * The atlas is uploaded with `flipY`, like every canvas texture, so v counts up
 * from the bottom of the canvas.
 */
export type UvRect = readonly [number, number, number, number];

/**
 * Shelf-packs pictures left to right, tallest first, each ringed by `gutter`
 * pixels so filtering and the first few mip levels never reach a neighbour.
 */
export function packAtlas(sources: readonly AtlasSource[], maxWidth: number, gutter: number): AtlasLayout {
  const order = [...sources].sort((a, b) => b.height - a.height || b.width - a.width);
  const cells = new Map<string, AtlasCell>();
  let x = 0;
  let y = 0;
  let shelf = 0;
  let width = 0;
  for (const source of order) {
    if (cells.has(source.key)) throw new Error(`atlas: duplicate key "${source.key}"`);
    const w = source.width + gutter * 2;
    const h = source.height + gutter * 2;
    if (w > maxWidth) throw new Error(`atlas: "${source.key}" is wider than ${maxWidth}px`);
    if (x + w > maxWidth) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    cells.set(source.key, { x: x + gutter, y: y + gutter, width: source.width, height: source.height });
    x += w;
    shelf = Math.max(shelf, h);
    width = Math.max(width, x);
  }
  return { width, height: y + shelf, cells };
}

export function cellUvRect(cell: AtlasCell, width: number, height: number): UvRect {
  return [cell.x / width, 1 - (cell.y + cell.height) / height, cell.width / width, cell.height / height];
}

export interface OverlayAtlas {
  texture: THREE.CanvasTexture;
  rects: Map<string, UvRect>;
}

/**
 * Paints canvases side by side into one sRGB texture, so overlays that used to
 * need a material each can share a single draw. Every cell's edge pixels are
 * smeared out into its gutter: sampling right at a cell's border then behaves
 * like the clamp-to-edge the separate textures had.
 */
export function buildOverlayAtlas(
  images: readonly { key: string; image: HTMLCanvasElement }[],
  maxWidth = 2048,
  gutter = 8,
): OverlayAtlas {
  const layout = packAtlas(
    images.map(({ key, image }) => ({ key, width: image.width, height: image.height })),
    maxWidth,
    gutter,
  );
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  // Nearest sampling: the gutter strips must be exact copies of the edge pixels.
  ctx.imageSmoothingEnabled = false;

  const rects = new Map<string, UvRect>();
  for (const { key, image } of images) {
    const cell = layout.cells.get(key);
    if (!cell) continue;
    const { x, y, width: w, height: h } = cell;
    const g = gutter;
    ctx.drawImage(image, x, y);
    ctx.drawImage(image, 0, 0, w, 1, x, y - g, w, g);
    ctx.drawImage(image, 0, h - 1, w, 1, x, y + h, w, g);
    ctx.drawImage(image, 0, 0, 1, h, x - g, y, g, h);
    ctx.drawImage(image, w - 1, 0, 1, h, x + w, y, g, h);
    ctx.drawImage(image, 0, 0, 1, 1, x - g, y - g, g, g);
    ctx.drawImage(image, w - 1, 0, 1, 1, x + w, y - g, g, g);
    ctx.drawImage(image, 0, h - 1, 1, 1, x - g, y + h, g, g);
    ctx.drawImage(image, w - 1, h - 1, 1, 1, x + w, y + h, g, g);
    rects.set(key, cellUvRect(cell, layout.width, layout.height));
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, rects };
}
