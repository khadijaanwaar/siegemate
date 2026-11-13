import * as THREE from "three";

import { mergeStaticParts } from "./merge";

function meshesUnder(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) meshes.push(node as THREE.Mesh);
  });
  return meshes;
}

function worldBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root, true);
}

function expectSameBox(a: THREE.Box3, b: THREE.Box3): void {
  expect(a.min.distanceTo(b.min)).toBeLessThan(1e-5);
  expect(a.max.distanceTo(b.max)).toBeLessThan(1e-5);
}

/** Five boxes on one material and one on another, all under one transformed parent. */
function buildFixture(): { root: THREE.Group; parent: THREE.Group; shared: THREE.Material; other: THREE.Material } {
  const root = new THREE.Group();
  const parent = new THREE.Group();
  parent.position.set(1, 2, 3);
  parent.rotation.set(0.2, 0.7, -0.1);
  parent.scale.setScalar(1.5);
  root.add(parent);

  const shared = new THREE.MeshStandardMaterial();
  const other = new THREE.MeshStandardMaterial();
  for (let index = 0; index < 5; index += 1) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.2 + index * 0.05, 0.3, 0.4), shared);
    box.position.set(index * 0.5, index * 0.1, -index * 0.2);
    box.rotation.set(index * 0.3, index * 0.2, 0);
    parent.add(box);
  }
  const odd = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), other);
  odd.position.set(-2, 0, 0);
  parent.add(odd);
  return { root, parent, shared, other };
}

describe("mergeStaticParts", () => {
  it("merges meshes that share a parent and a material into one", () => {
    const { root, parent, shared, other } = buildFixture();
    const before = worldBox(root);

    const removed = mergeStaticParts(root);

    expect(removed).toBe(4);
    const meshes = meshesUnder(root);
    expect(meshes).toHaveLength(2);
    expect(meshes.every((mesh) => mesh.parent === parent)).toBe(true);
    expect(meshes.map((mesh) => mesh.material).sort((a, b) => (a === shared ? -1 : b === shared ? 1 : 0))).toEqual([
      shared,
      other,
    ]);
    expectSameBox(worldBox(root), before);
  });

  it("keeps the triangle count", () => {
    const { root } = buildFixture();
    const count = (): number =>
      meshesUnder(root).reduce((sum, mesh) => {
        const geometry = mesh.geometry;
        return sum + (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
      }, 0);
    const before = count();
    mergeStaticParts(root);
    expect(count()).toBe(before);
  });

  it("leaves skinned meshes, lone meshes and meshes with children alone", () => {
    const root = new THREE.Group();
    const material = new THREE.MeshBasicMaterial();
    const lone = new THREE.Mesh(new THREE.BoxGeometry(), material);
    root.add(lone);
    const holder = new THREE.Mesh(new THREE.BoxGeometry(), material);
    holder.add(new THREE.Object3D());
    root.add(holder);
    const bone = new THREE.Bone();
    const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(), material);
    skinned.add(bone);
    skinned.bind(new THREE.Skeleton([bone]));
    root.add(skinned);

    expect(mergeStaticParts(root)).toBe(0);
    expect(meshesUnder(root)).toHaveLength(3);
  });

  it("keeps a mirrored part facing outwards", () => {
    const root = new THREE.Group();
    const material = new THREE.MeshBasicMaterial();
    const plain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    const mirrored = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mirrored.scale.set(-1, 1, 1);
    mirrored.position.z = 2;
    root.add(plain, mirrored);

    expect(mergeStaticParts(root)).toBe(1);
    const [merged] = meshesUnder(root);
    const position = merged.geometry.getAttribute("position");
    const index = merged.geometry.index;
    // Every triangle still winds counter-clockwise seen from +Z.
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const triangles = (index ? index.count : position.count) / 3;
    for (let face = 0; face < triangles; face += 1) {
      const at = (corner: number): number => (index ? index.getX(face * 3 + corner) : face * 3 + corner);
      a.fromBufferAttribute(position, at(0));
      b.fromBufferAttribute(position, at(1));
      c.fromBufferAttribute(position, at(2));
      const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      expect(normal.z).toBeGreaterThan(0);
    }
  });
});
