import { describe, expect, it } from "vitest";

import {
  layoutProblems,
  MENU_PANEL,
  menuButtons,
  menuLines,
  type MenuState,
  PROMOTION_PANEL,
  promotionButtons,
  promotionKindOf,
  SLAB_PANEL,
  slabButtons,
} from "./layouts";

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

describe("menu card", () => {
  const state: MenuState = {
    strength: "medium",
    side: "w",
    arena: "Sun Temple",
    sound: true,
    music: true,
    heightCm: 0,
    exitArmed: false,
  };

  it("keeps every button at 22 mm or more and 12 mm from its neighbours", () => {
    expect(layoutProblems(menuButtons(state), MENU_PANEL)).toEqual([]);
  });

  it("offers strength, side, battleground, sound, music, height, new game, re-place, how to and exit", () => {
    expect(menuButtons(state).map((button) => button.id)).toEqual([
      "easy",
      "medium",
      "hard",
      "side-w",
      "side-b",
      "arena",
      "sound",
      "music",
      "lower",
      "raise",
      "new",
      "replace",
      "howto",
      "exit",
    ]);
  });

  it("shows what is on, the board's height and an exit waiting for its second tap", () => {
    const buttons = menuButtons({ ...state, sound: false, music: true, heightCm: 4, exitArmed: true });
    const byId = (id: string) => buttons.find((button) => button.id === id);
    expect(byId("sound")?.label).toBe("Sound off");
    expect(byId("music")?.label).toBe("Music on");
    expect(byId("music")?.tone).toBe("selected");
    expect(byId("exit")?.label).toBe("Really exit?");
    expect(menuLines({ ...state, heightCm: 4 }).map((line) => line.text)).toContain("Board height +4 cm");
    expect(menuLines({ ...state, heightCm: -6 }).map((line) => line.text)).toContain("Board height −6 cm");
    expect(menuLines(state).map((line) => line.text)).toContain("Board height");
  });
});

describe("control slab", () => {
  it("keeps Undo and Menu 12 mm apart", () => {
    expect(layoutProblems(slabButtons({ canUndo: true, menuOpen: false }), SLAB_PANEL)).toEqual([]);
  });
});
