/**
 * Static-mesh merging: one draw per (parent, material) instead of one per part.
 *
 * Generated and procedural figures are often assembled from many small meshes
 * that share a material and never move relative to each other — a head, a torso
 * and two arms in one stone. Each of those costs a draw call every frame (and
 * again in every shadow pass) for no visual reason, so they are folded into one
 * geometry with each part's transform baked in.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Attribute layout, so only geometries `mergeGeometries` accepts are grouped. */
function attributeSignature(geometry: THREE.BufferGeometry): string {
  return Object.keys(geometry.attributes)
    .sort()
    .map((name) => {
      const attribute = geometry.getAttribute(name);
      const array = (attribute as THREE.BufferAttribute).array;
      return `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}:${array?.constructor.name ?? "?"}`;
    })
    .join(",");
}

/** A plain, childless, single-material mesh whose geometry can be baked. */
function isMergeable(node: THREE.Object3D, root: THREE.Object3D): node is THREE.Mesh {
  const mesh = node as THREE.Mesh;
  if (!mesh.isMesh || node === root || !node.parent) return false;
  const special = node as Partial<THREE.SkinnedMesh & THREE.InstancedMesh & THREE.BatchedMesh>;
  if (special.isSkinnedMesh || special.isInstancedMesh || special.isBatchedMesh) return false;
  // Merging a mesh away would orphan whatever hangs off it.
  if (node.children.length > 0) return false;
  if (Array.isArray(mesh.material)) return false;
  const geometry = mesh.geometry;
  if (!geometry?.getAttribute("position")) return false;
  if (Object.keys(geometry.morphAttributes).length > 0) return false;
  if (geometry.drawRange.start !== 0 || Number.isFinite(geometry.drawRange.count)) return false;
  return true;
}

/** Everything that would render differently if two meshes became one. */
function groupKey(mesh: THREE.Mesh): string {
  const material = mesh.material as THREE.Material;
  return [
    mesh.parent?.id,
    material.uuid,
    attributeSignature(mesh.geometry),
    mesh.castShadow,
    mesh.receiveShadow,
    mesh.visible,
    mesh.renderOrder,
    mesh.layers.mask,
    mesh.frustumCulled,
  ].join("|");
}

/**
 * Reverses every triangle. A mirrored part (negative determinant) is drawn with
 * flipped culling by three.js; once its matrix is baked into the vertices that
 * flip has to be in the winding instead, or the part renders inside out.
 */
function flipWinding(geometry: THREE.BufferGeometry): void {
  const index = geometry.index;
  if (index) {
    for (let corner = 0; corner + 2 < index.count; corner += 3) {
      const b = index.getX(corner + 1);
      index.setX(corner + 1, index.getX(corner + 2));
      index.setX(corner + 2, b);
    }
    index.needsUpdate = true;
    return;
  }
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
    const size = attribute.itemSize;
    const array = attribute.array;
    for (let vertex = 0; vertex + 2 < attribute.count; vertex += 3) {
      for (let component = 0; component < size; component += 1) {
        const b = (vertex + 1) * size + component;
        const c = (vertex + 2) * size + component;
        const swap = array[b];
        array[b] = array[c];
        array[c] = swap;
      }
    }
    attribute.needsUpdate = true;
  }
}

/** One mesh's geometry, transformed into its parent's space. */
function bakedGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  if (mesh.matrixAutoUpdate) mesh.updateMatrix();
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrix);
  if (mesh.matrix.determinant() < 0) flipWinding(geometry);
  return geometry;
}

/**
 * Merges static (non-skinned) meshes that share a parent and a material into
 * one mesh per (parent, material), baking each part's transform relative to the
 * parent. Skinned, instanced and morphing meshes, meshes with children and
 * multi-material meshes are left alone, as is any group of one.
 *
 * Source geometries no longer used anywhere under `root` are disposed; the
 * materials are reused as they are.
 *
 * @returns the number of meshes removed
 */
export function mergeStaticParts(root: THREE.Object3D): number {
  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse((node) => {
    if (!isMergeable(node, root)) return;
    const key = groupKey(node);
    const list = groups.get(key);
    if (list) list.push(node);
    else groups.set(key, [node]);
  });

  let removed = 0;
  const released = new Set<THREE.BufferGeometry>();
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const first = meshes[0];
    const parent = first.parent;
    if (!parent) continue;

    let parts = meshes.map(bakedGeometry);
    // mergeGeometries refuses a mix of indexed and non-indexed input.
    const indexed = parts.filter((geometry) => geometry.index !== null).length;
    if (indexed > 0 && indexed < parts.length) {
      parts = parts.map((geometry) => {
        if (!geometry.index) return geometry;
        const flat = geometry.toNonIndexed();
        geometry.dispose();
        return flat;
      });
    }
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) continue;

    const mesh = new THREE.Mesh(merged, first.material);
    mesh.name = first.name;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.visible = first.visible;
    mesh.renderOrder = first.renderOrder;
    mesh.layers.mask = first.layers.mask;
    mesh.frustumCulled = first.frustumCulled;
    mesh.userData = { ...first.userData };

    // Take the first part's place among its siblings, so traversal order holds.
    const slot = parent.children.indexOf(first);
    for (const part of meshes) {
      released.add(part.geometry);
      part.removeFromParent();
    }
    parent.add(mesh);
    parent.children.splice(parent.children.indexOf(mesh), 1);
    parent.children.splice(Math.min(slot, parent.children.length), 0, mesh);
    removed += meshes.length - 1;
  }

  if (released.size > 0) {
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) released.delete(mesh.geometry);
    });
    for (const geometry of released) geometry.dispose();
  }
  return removed;
}
