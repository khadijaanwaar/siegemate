import { describe, expect, it } from "vitest";

import { GameController } from "./gameController";
import { clearSavedGame, loadSavedGame, SAVE_KEY, saveGame, type SavedGame } from "./persist";

/** The search Worker cannot run here; these tests never need a reply. */
class SilentWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
}
(globalThis as unknown as { Worker: unknown }).Worker = SilentWorker;

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

describe("GameController save and resume", () => {
  it("resumes a position with the same side to move and the same clocks", async () => {
    const played = new GameController();
    played.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: 5 });
    expect(await played.tryMove("e2", "e4")).toBe(true);
    expect(await played.tryMove("e7", "e5")).toBe(true);
    expect(await played.tryMove("g1", "f3")).toBe(true);
    const save = played.exportSave();
    played.dispose();

    const resumed = new GameController();
    let resets = 0;
    resumed.on("reset", () => {
      resets += 1;
    });
    expect(resumed.resume(save)).toBe(true);
    const snapshot = resumed.getSnapshot();
    expect(snapshot.fen).toBe(save.fen);
    expect(snapshot.turn).toBe("b");
    expect(snapshot.status).toBe("playing");
    expect(snapshot.clock.whiteMs).toBe(save.clock.whiteMs);
    expect(snapshot.clock.blackMs).toBe(save.clock.blackMs);
    expect(snapshot.history.length).toBe(2);
    expect(resets).toBe(1);
    resumed.dispose();
  });

  it("refuses a save whose moves do not replay", () => {
    const controller = new GameController();
    const broken: SavedGame = {
      version: 1,
      options: { mode: "ai", difficulty: "easy", playerColor: "w", clockMinutes: null },
      pgn: "1. e4 e5 2. Ke7",
      fen: "x",
      clock: { whiteMs: 0, blackMs: 0 },
      savedAt: 0,
    };
    expect(controller.resume(broken)).toBe(false);
    expect(controller.getSnapshot().status).toBe("idle");
    controller.dispose();
  });
});

describe("saved game storage", () => {
  const save: SavedGame = {
    version: 1,
    options: { mode: "ai", difficulty: "medium", playerColor: "b", clockMinutes: null },
    pgn: "1. d4",
    fen: "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1",
    clock: { whiteMs: 0, blackMs: 0 },
    savedAt: 1_700_000_000_000,
  };

  it("round-trips a save", () => {
    const storage = new MemoryStorage();
    saveGame(storage, save);
    expect(loadSavedGame(storage)).toEqual(save);
  });

  it("treats a corrupt or foreign entry as no save", () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, "{not json");
    expect(loadSavedGame(storage)).toBeNull();
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 99 }));
    expect(loadSavedGame(storage)).toBeNull();
  });

  it("clears", () => {
    const storage = new MemoryStorage();
    saveGame(storage, save);
    clearSavedGame(storage);
    expect(loadSavedGame(storage)).toBeNull();
  });

  it("survives storage that throws (private mode, quota)", () => {
    const hostile = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => saveGame(hostile, save)).not.toThrow();
    expect(loadSavedGame(hostile)).toBeNull();
    expect(() => clearSavedGame(hostile)).not.toThrow();
  });
});
