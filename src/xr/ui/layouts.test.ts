import { describe, expect, it } from "vitest";

import { layoutProblems, PROMOTION_PANEL, promotionButtons, promotionKindOf } from "./layouts";

describe("layoutProblems", () => {
  it("flags small targets, tight gaps and buttons off the card", () => {
    const card = { width: 0.2, height: 0.1 };
    expect(
      layoutProblems(
        [
          { id: "a", rect: [0.01, 0.01, 0.05, 0.03], label: "A" },
          { id: "b", rect: [0.07, 0.01, 0.05, 0.03], label: "B" },
          { id: "c", rect: [0.15, 0.08, 0.02, 0.03], label: "C" },
        ],
        card,
      ),
    ).toEqual(["c is 20x30 mm", "c leaves the card", "a and b are 10.0 mm apart"]);
    expect(layoutProblems([{ id: "a", rect: [0.01, 0.01, 0.05, 0.03], label: "A" }, { id: "b", rect: [0.072, 0.01, 0.05, 0.03], label: "B" }], card)).toEqual([]);
  });
});

describe("promotion card", () => {
  it("offers queen, rook, bishop and knight as large, well spaced buttons", () => {
    const buttons = promotionButtons();
    expect(buttons.map((button) => promotionKindOf(button.id))).toEqual(["q", "r", "b", "n"]);
    expect(layoutProblems(buttons, PROMOTION_PANEL)).toEqual([]);
  });

  it("reads only promotion buttons as a crown", () => {
    expect(promotionKindOf("promote-q")).toBe("q");
    expect(promotionKindOf("promote-k")).toBeNull();
    expect(promotionKindOf("menu")).toBeNull();
  });
});
