import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";

import { GameController } from "../core/gameController";
import type { PieceKind } from "../core/types";
import { replayPosition, type ReplayGame } from "./replay";
import { ReplayDriver, type ReplayState } from "./replayDriver";

function fromSan(sans: string[]): ReplayGame["moves"] {
  const chess = new Chess();
  return sans.map((san) => {
    const move = chess.move(san);
    return { from: move.from, to: move.to, promotion: (move.promotion as PieceKind | undefined) ?? null };
  });
}

const foolsMate: ReplayGame = {
  mode: "ai",
  playerColor: "w",
  difficulty: "hard",
  blackDifficulty: "hard",
  armies: { w: "ivory", b: "sun" },
  arena: "frost",
  result: { winner: "b", reason: "checkmate" },
  date: "2026-11-16",
  moves: fromSan(["f3", "e5", "g4", "Qh4#"]),
};

function setup(game: ReplayGame = foolsMate): { controller: GameController; driver: ReplayDriver; states: ReplayState[] } {
  const controller = new GameController();
  const states: ReplayState[] = [];
  const driver = new ReplayDriver(controller, game, (state) => states.push(state), 0);
  return { controller, driver, states };
}

describe("ReplayDriver", () => {
  it("jumps to any ply without animation and lets nobody move", () => {
    const { controller, driver } = setup();
    expect(driver.seek(2)).toBe(true);
    const snapshot = controller.getSnapshot();
    expect(snapshot.fen).toBe(replayPosition(foolsMate, 2).fen());
    expect(snapshot.mode).toBe("hotseat");
    expect(snapshot.status).toBe("playing");
    expect(driver.state).toMatchObject({ ply: 2, total: 4, playing: false, busy: false });
    controller.dispose();
  });

  it("steps forward through the controller, so the scene animates the move", async () => {
    const { controller, driver } = setup();
    driver.seek(0);
    const moves: string[] = [];
    controller.on("move", (event) => moves.push(event.san));
    expect(await driver.stepForward()).toBe(true);
    expect(moves).toEqual(["f3"]);
    expect(driver.state.ply).toBe(1);
    controller.dispose();
  });

  it("plays to the end, where the board is over, and steps back out of it", async () => {
    const { controller, driver, states } = setup();
    driver.seek(0);
    await driver.play();
    expect(driver.atEnd).toBe(true);
    expect(controller.getSnapshot().status).toBe("over");
    expect(controller.getSnapshot().result).toEqual({ winner: "b", reason: "checkmate" });
    expect(states[states.length - 1]).toMatchObject({ ply: 4, playing: false, busy: false });
    expect(driver.canContinue()).toBe(false); // mate on the board

    expect(driver.stepBack()).toBe(true);
    expect(controller.getSnapshot().status).toBe("playing");
    expect(driver.state.ply).toBe(3);
    expect(driver.canContinue()).toBe(true);
    expect(driver.continueOptions()).toEqual({ mode: "ai", difficulty: "hard", playerColor: "b", clockMinutes: null });
    controller.dispose();
  });

  it("replays castling, en passant and an under-promotion to the recorded position", async () => {
    const game = { ...foolsMate, result: null, moves: fromSan(["e4", "d5", "e5", "f5", "exf6", "Nc6", "fxg7", "Bd7", "gxh8=N", "e6", "Nf3", "Qe7", "Bc4", "O-O-O", "O-O"]) };
    const { controller, driver } = setup(game);
    driver.seek(0);
    await driver.play();
    expect(controller.getSnapshot().fen).toBe(replayPosition(game).fen());
    controller.dispose();
  });

  it("a jump while playing stops the playback", async () => {
    const { controller, driver } = setup();
    driver.seek(0);
    const playing = driver.play();
    driver.seek(1);
    await playing;
    expect(driver.state).toMatchObject({ ply: 1, playing: false });
    controller.dispose();
  });
});
