import { describe, expect, it } from "vitest";

import { type AtlasCell, cellUvRect, packAtlas } from "./overlayAtlas";

const GUTTER = 8;

function padded(cell: AtlasCell): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: cell.x - GUTTER, y0: cell.y - GUTTER, x1: cell.x + cell.width + GUTTER, y1: cell.y + cell.height + GUTTER };
}

describe("packAtlas", () => {
  const sources = [
    ...Array.from({ length: 13 }, (_, i) => ({ key: `big${i}`, width: 256, height: 256 })),
    ...Array.from({ length: 7 }, (_, i) => ({ key: `small${i}`, width: 128, height: 128 })),
    { key: "thread", width: 256, height: 64 },
    { key: "column", width: 64, height: 64 },
  ];
  const layout = packAtlas(sources, 2048, GUTTER);

  it("places every picture, gutter included, inside the canvas", () => {
    expect(layout.cells.size).toBe(sources.length);
    for (const source of sources) {
      const cell = layout.cells.get(source.key);
      expect(cell).toBeDefined();
      if (!cell) continue;
      expect(cell.width).toBe(source.width);
      expect(cell.height).toBe(source.height);
      const box = padded(cell);
      expect(box.x0).toBeGreaterThanOrEqual(0);
      expect(box.y0).toBeGreaterThanOrEqual(0);
      expect(box.x1).toBeLessThanOrEqual(layout.width);
      expect(box.y1).toBeLessThanOrEqual(layout.height);
    }
    expect(layout.width).toBeLessThanOrEqual(2048);
  });

  it("never lets two padded cells overlap", () => {
    const boxes = [...layout.cells.values()].map(padded);
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const p = boxes[a];
        const q = boxes[b];
        const overlap = p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
        expect(overlap).toBe(false);
      }
    }
  });

  it("rejects duplicate keys and pictures wider than the atlas", () => {
    expect(() => packAtlas([{ key: "a", width: 4, height: 4 }, { key: "a", width: 4, height: 4 }], 64, 1)).toThrow();
    expect(() => packAtlas([{ key: "wide", width: 100, height: 4 }], 64, 1)).toThrow();
  });
});

describe("cellUvRect", () => {
  it("maps a quad's 0..1 UVs onto the cell of a flipY texture", () => {
    // A 10x20 cell whose top-left canvas pixel is (30, 40) in a 100x200 atlas.
    const [u0, v0, du, dv] = cellUvRect({ x: 30, y: 40, width: 10, height: 20 }, 100, 200);
    expect(u0).toBeCloseTo(0.3);
    expect(du).toBeCloseTo(0.1);
    expect(dv).toBeCloseTo(0.1);
    // flipY: v = 1 is the canvas's top row, so the cell's bottom (y = 60) sits at v0.
    expect(v0).toBeCloseTo(1 - 60 / 200);
    expect(v0 + dv).toBeCloseTo(1 - 40 / 200);
  });
});
