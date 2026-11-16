import { describe, expect, it } from "vitest";

import { qrMatrix } from "./qr";

/** The 7×7 finder pattern: a dark ring, a light ring and a 3×3 dark core. */
function isFinder(dark: boolean[][], top: number, left: number): boolean {
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      const ring = Math.max(Math.abs(y - 3), Math.abs(x - 3));
      if (dark[top + y][left + x] !== (ring !== 2)) return false;
    }
  }
  return true;
}

describe("qrMatrix", () => {
  it("makes a square symbol with the three finder patterns", () => {
    const { size, dark } = qrMatrix("https://siegemate.pages.dev/#r=1AAAA");
    expect(size).toBeGreaterThanOrEqual(21);
    expect((size - 17) % 4).toBe(0); // 4 × version + 17
    expect(dark).toHaveLength(size);
    for (const row of dark) expect(row).toHaveLength(size);
    expect(isFinder(dark, 0, 0)).toBe(true);
    expect(isFinder(dark, 0, size - 7)).toBe(true);
    expect(isFinder(dark, size - 7, 0)).toBe(true);
  });

  it("stays a small symbol for a full replay link (version 8 or under: 49 modules)", () => {
    const link = `https://siegemate.pages.dev/#r=1${"A".repeat(120)}`;
    expect(qrMatrix(link).size).toBeLessThanOrEqual(49);
  });

  it("is deterministic", () => {
    expect(qrMatrix("siegemate")).toEqual(qrMatrix("siegemate"));
  });
});
