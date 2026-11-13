import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";

import type { SquareId } from "../core/types";
import { ARENA_LOOKS } from "./arena";
import { BoardView, type HighlightKind, squareToWorld } from "./board";
import { listDrawables } from "./sceneStats";

const FILES = "abcdefgh";
const SQUARES: SquareId[] = [];
for (let rank = 1; rank <= 8; rank += 1) for (const file of FILES) SQUARES.push(`${file}${rank}`);
const KINDS: HighlightKind[] = [
  "select",
  "move",
  "capture",
  "castle",
  "promote",
  "last",
  "check",
  "hint",
  "premove",
  "queued",
  "queuedTarget",
];

/** Drawables as `perGroup.board` counts them: one per material of each visible mesh or sprite. */
function drawables(board: BoardView): number {
  return listDrawables(board.group).reduce((sum, row) => sum + row.materials, 0);
}

function batch(board: BoardView, name: string): THREE.InstancedMesh {
  const mesh = board.group.getObjectByName(name);
  if (!(mesh instanceof THREE.InstancedMesh)) throw new Error(`no batch ${name}`);
  return mesh;
}

function run(board: BoardView, seconds: number, step = 1 / 60): void {
  for (let t = 0; t < seconds; t += step) board.update(step);
}

describe("BoardView draw budget", () => {
  let board: BoardView;
  afterEach(() => board.dispose());

  it("stands still in five draws: two tile batches, the base (stone + inlay), the trim", () => {
    board = new BoardView();
    run(board, 0.1);
    expect(drawables(board)).toBe(5);
  });

  it("stays within ten with every overlay the game can show lit at once", () => {
    board = new BoardView();
    SQUARES.forEach((square, i) => board.setHighlight(square, KINDS[i % KINDS.length], i % 2 === 0, (i % 5) * 0.03));
    board.setShroud(["e2", "e3", "e4"], "e2");
    board.setPremoveLinks([
      { from: "e2", to: "e4" },
      { from: "g1", to: "f3" },
      { from: "f1", to: "c4" },
      { from: "d2", to: "d4" },
      { from: "b1", to: "c3" },
    ]);
    board.setPremoveOrders(["e4", "f3", "c4", "d4", "c3"]);
    board.setPremoveCancel("c3");
    board.setHover("d5");
    for (const square of ["a1", "b2", "c3", "d4"] as SquareId[]) board.impact(square);
    for (const square of ["e5", "f6", "g7", "h8", "a8"] as SquareId[]) board.land(square);
    run(board, 0.12);

    expect(drawables(board)).toBe(8);
    expect(drawables(board)).toBeLessThanOrEqual(10);
    // 61 veiled squares (64 minus the three left lit) still closing in, and a glow per square.
    expect(batch(board, "board-floor").count).toBeGreaterThan(64);
    expect(batch(board, "board-marks").count).toBeGreaterThan(64);
    expect(batch(board, "board-xray").count).toBeGreaterThan(5);

    for (const look of Object.values(ARENA_LOOKS)) {
      board.applyArena(look);
      run(board, 0.05);
      expect(drawables(board)).toBeLessThanOrEqual(10);
    }
  });

  it("drops the x-ray batch while muted, then lets every draw go once cleared", () => {
    board = new BoardView();
    board.setHighlight("e4", "move");
    board.setPremoveCancel("e4");
    run(board, 0.4);
    expect(batch(board, "board-xray").visible).toBe(true);

    board.setOverlaysMuted(true);
    run(board, 0.05);
    expect(batch(board, "board-xray").visible).toBe(false);
    board.setOverlaysMuted(false);

    board.clearHighlights();
    board.setHover(null);
    run(board, 1);
    expect(drawables(board)).toBe(5);
  });

  it("matches the old visibility rules: a last-move square is a glow only", () => {
    board = new BoardView();
    board.setHighlight("e2", "last");
    board.setHighlight("e4", "last");
    run(board, 0.4);
    expect(batch(board, "board-floor").count).toBe(2);
    expect(batch(board, "board-marks").visible).toBe(false);
    expect(batch(board, "board-xray").visible).toBe(false);
    expect(drawables(board)).toBe(6);
  });

  it("waits out a highlight's stagger before drawing it", () => {
    board = new BoardView();
    board.setHighlight("e4", "move", false, 0.2);
    run(board, 0.1);
    expect(batch(board, "board-floor").visible).toBe(false);
    run(board, 0.2);
    expect(batch(board, "board-floor").count).toBe(1);
  });
});

describe("BoardView picking and motion", () => {
  let board: BoardView;
  afterEach(() => board.dispose());

  it("still answers a ray on the stone with the square under it", () => {
    board = new BoardView();
    board.group.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    for (const square of ["a1", "e4", "h8", "d5"] as SquareId[]) {
      const centre = squareToWorld(square);
      raycaster.set(new THREE.Vector3(centre.x + 0.1, 5, centre.z - 0.1), new THREE.Vector3(0, -1, 0));
      const hit = raycaster.intersectObjects(board.tiles, false)[0];
      expect(hit?.object.userData.square).toBe(square);
    }
  });

  it("hands out the coin as a ray target only while it hangs", () => {
    board = new BoardView();
    expect(board.premoveCancelHandle()).toBeNull();
    board.setPremoveCancel("e4");
    run(board, 0.3);
    const handle = board.premoveCancelHandle();
    expect(handle).not.toBeNull();
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    camera.position.set(0, 6.4, 8.6);
    const target = squareToWorld("e4");
    camera.lookAt(handle?.position ?? target);
    camera.updateMatrixWorld(true);
    board.group.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    expect(handle ? raycaster.intersectObject(handle, false).length : 0).toBeGreaterThan(0);
    board.setPremoveCancel(null);
    expect(board.premoveCancelHandle()).toBeNull();
  });

  it("jolts the struck tile's instance and settles it back home", () => {
    board = new BoardView();
    const tiles = [batch(board, "board-tiles-light"), batch(board, "board-tiles-dark")];
    const snapshot = (): number[] => tiles.flatMap((mesh) => Array.from(mesh.instanceMatrix.array));
    const home = snapshot();
    board.impact("e4", 0xff6a3c, 1);
    run(board, 0.08);
    expect(snapshot()).not.toEqual(home);
    run(board, 2);
    const settled = snapshot();
    home.forEach((value, i) => expect(settled[i]).toBeCloseTo(value, 5));
  });
});
