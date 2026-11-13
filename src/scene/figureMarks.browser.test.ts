import * as THREE from "three";

import { FigureMarks } from "./figureMarks";

/** The layer mesh for one kind of mark, if it has been built. */
function layer(marks: FigureMarks, name: string): THREE.InstancedMesh | undefined {
  return marks.group.children.find((child) => child.name === `marks_${name}`) as THREE.InstancedMesh | undefined;
}

/** Instances the layer will actually draw this frame. */
function drawn(marks: FigureMarks, name: string): number {
  const mesh = layer(marks, name);
  return mesh && mesh.visible ? mesh.count : 0;
}

function setup(): { scene: THREE.Scene; marks: FigureMarks; figure: THREE.Group } {
  const scene = new THREE.Scene();
  const marks = new FigureMarks();
  scene.add(marks.group);
  const figure = new THREE.Group();
  figure.position.set(2, 0, -3);
  figure.scale.setScalar(0.55);
  scene.add(figure);
  return { scene, marks, figure };
}

describe("FigureMarks", () => {
  it("draws every kind of mark in one instanced layer, wherever its anchor is", () => {
    const { scene, marks, figure } = setup();
    const ring = marks.addRing("band", 0x5fb0ff, 0.3);
    ring.anchor.rotation.x = -Math.PI / 2;
    ring.anchor.position.y = 0.012;
    figure.add(ring.anchor);
    const crest = marks.addCrest("q", "b", 0.7);
    crest.anchor.position.y = 1.3;
    figure.add(crest.anchor);

    const other = new THREE.Group();
    other.position.set(-1, 0, 1);
    scene.add(other);
    const second = marks.addRing("sunburst", 0xff5230, 0.3);
    other.add(second.anchor);

    scene.updateMatrixWorld();

    expect(drawn(marks, "ring")).toBe(2);
    expect(drawn(marks, "crest")).toBe(1);
    const mesh = layer(marks, "ring");
    const matrix = new THREE.Matrix4();
    const placed = [0, 1].map((index) => {
      mesh?.getMatrixAt(index, matrix);
      return new THREE.Vector3().setFromMatrixPosition(matrix);
    });
    const expected = ring.anchor.getWorldPosition(new THREE.Vector3());
    expect(placed.some((position) => position.distanceTo(expected) < 1e-6)).toBe(true);
    marks.dispose();
  });

  it("follows visibility up the hierarchy, opacity and membership of the scene", () => {
    const { scene, marks, figure } = setup();
    const shadow = marks.addShadow(0.55);
    figure.add(shadow.anchor);
    scene.updateMatrixWorld();
    expect(drawn(marks, "shadow")).toBe(1);

    shadow.anchor.visible = false;
    scene.updateMatrixWorld();
    expect(drawn(marks, "shadow")).toBe(0);

    shadow.anchor.visible = true;
    figure.visible = false;
    scene.updateMatrixWorld();
    expect(drawn(marks, "shadow")).toBe(0);

    figure.visible = true;
    shadow.opacity = 0;
    scene.updateMatrixWorld();
    expect(drawn(marks, "shadow")).toBe(0);

    shadow.opacity = 0.55;
    figure.removeFromParent();
    scene.updateMatrixWorld();
    expect(drawn(marks, "shadow")).toBe(0);

    scene.add(figure);
    marks.remove(shadow);
    scene.updateMatrixWorld();
    expect(drawn(marks, "shadow")).toBe(0);
    marks.dispose();
  });

  it("places marks correctly when the layers hang under a scaled, moved root", () => {
    const { scene, marks, figure } = setup();
    const table = new THREE.Group();
    table.position.set(0.3, 0.8, -0.5);
    table.rotation.y = 0.7;
    table.scale.setScalar(0.049);
    scene.add(table);
    table.add(marks.group);
    table.add(figure);
    const token = marks.addToken("n", "w", 1);
    token.anchor.position.y = 0.055;
    figure.add(token.anchor);

    scene.updateMatrixWorld();

    const mesh = layer(marks, "token");
    expect(mesh?.count).toBe(1);
    const instance = new THREE.Matrix4();
    mesh?.getMatrixAt(0, instance);
    const world = new THREE.Matrix4().multiplyMatrices(mesh?.matrixWorld ?? new THREE.Matrix4(), instance);
    const position = new THREE.Vector3().setFromMatrixPosition(world);
    expect(position.distanceTo(token.anchor.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-6);
    marks.dispose();
  });

  it("grows past its first capacity and paints crests far to near", () => {
    const { scene, marks } = setup();
    const crests = Array.from({ length: 60 }, (_, index) => {
      const crest = marks.addCrest("p", index % 2 === 0 ? "w" : "b", 0.72);
      crest.anchor.position.set(0, 1, index);
      scene.add(crest.anchor);
      return crest;
    });
    scene.updateMatrixWorld();
    expect(drawn(marks, "crest")).toBe(crests.length);

    // Seen from the origin, the farthest crest goes down first.
    const mesh = layer(marks, "crest");
    const first = new THREE.Matrix4();
    const last = new THREE.Matrix4();
    mesh?.getMatrixAt(0, first);
    mesh?.getMatrixAt(crests.length - 1, last);
    expect(new THREE.Vector3().setFromMatrixPosition(first).z).toBe(crests.length - 1);
    expect(new THREE.Vector3().setFromMatrixPosition(last).z).toBe(0);
    marks.dispose();
  });
});
