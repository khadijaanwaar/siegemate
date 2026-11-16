import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { squareToWorld, TILE } from "../scene/board";
import { BOARD_DEPTH_UNITS, TABLE_SCALE, TableRig } from "./tableRig";

describe("TableRig", () => {
  it("makes a tile about 5 cm wide", () => {
    expect(TILE * TABLE_SCALE).toBeGreaterThan(0.048);
    expect(TILE * TABLE_SCALE).toBeLessThan(0.052);
  });

  it("puts a1 on the near left of a board facing the player", () => {
    const rig = new TableRig();
    rig.setPose(new THREE.Vector3(0, 0.75, -0.45), 0);
    const world = rig.toWorld(squareToWorld("a1"), new THREE.Vector3());
    const half = 3.5 * TILE * TABLE_SCALE;
    // Tile tops sit one base depth above the surface the board stands on.
    const top = 0.75 + BOARD_DEPTH_UNITS * TABLE_SCALE;
    expect(world.x).toBeCloseTo(-half, 3);
    expect(world.y).toBeCloseTo(top, 3);
    expect(world.z).toBeCloseTo(-0.45 + half, 3);
  });

  it("turns with its yaw", () => {
    const rig = new TableRig();
    rig.setPose(new THREE.Vector3(0, 0, 0), Math.PI / 2);
    const world = rig.toWorld(squareToWorld("a1"), new THREE.Vector3());
    const half = 3.5 * TILE * TABLE_SCALE;
    // A quarter turn about +Y carries the near-left corner (-x, +z) to (+x, +z).
    expect(world.x).toBeCloseTo(half, 3);
    expect(world.z).toBeCloseTo(half, 3);
  });

  it("round-trips world and board coordinates", () => {
    const rig = new TableRig();
    rig.setPose(new THREE.Vector3(0.3, 0.8, -0.5), 0.7);
    rig.setScale(1.3);
    const local = new THREE.Vector3(1.2, 0.4, -2.5);
    const back = rig.toLocal(rig.toWorld(local, new THREE.Vector3()), new THREE.Vector3());
    expect(back.distanceTo(local)).toBeLessThan(1e-6);
  });

  it("tells how far along a ray the board's top is, and misses off its edge or pointing away", () => {
    const rig = new TableRig();
    rig.setPose(new THREE.Vector3(0, 0.75, -0.45), 0.4);
    const top = 0.75 + BOARD_DEPTH_UNITS * TABLE_SCALE;
    const down = new THREE.Vector3(0, -1, 0);
    const onBoard = rig.rayToBoard(new THREE.Ray(new THREE.Vector3(0.05, 1.2, -0.45), down), 4.92);
    expect(onBoard).toBeCloseTo(1.2 - top, 6);
    expect(rig.rayToBoard(new THREE.Ray(new THREE.Vector3(0.6, 1.2, -0.45), down), 4.92)).toBeNull();
    expect(rig.rayToBoard(new THREE.Ray(new THREE.Vector3(0, 1.2, -0.45), new THREE.Vector3(0, 1, 0)), 4.92)).toBeNull();
    expect(rig.rayToBoard(new THREE.Ray(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0, -1)), 4.92)).toBeNull();
  });

  it("clamps the size the player can pinch it to", () => {
    const rig = new TableRig();
    expect(rig.setScale(3)).toBe(1.6);
    expect(rig.setScale(0.2)).toBe(0.6);
    expect(rig.unitsToMeters).toBeCloseTo(TABLE_SCALE * 0.6, 8);
  });
});
