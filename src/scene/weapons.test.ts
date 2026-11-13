import * as THREE from "three";

import type { ArsenalId } from "../assets/generated";
import type { Faction, PieceKind } from "../core/types";
import { attachWeapons } from "./weapons";

const ARSENALS: ArsenalId[] = ["kingdom", "sun", "empire"];
const KINDS: PieceKind[] = ["k", "q", "b", "n", "r", "p"];
const COLORS: Faction[] = ["w", "b"];

/** Hand-held and towed props: each one is a `weapon_*` or `train_*` group. */
function propCount(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((node) => {
    if (/^(weapon|train)_/.test(node.name)) count += 1;
  });
  return count;
}

describe("attachWeapons (primitive arms)", () => {
  const cases = ARSENALS.flatMap((arsenal) => KINDS.map((kind) => [arsenal, kind] as const));

  it.each(cases)("%s %s: one draw per prop, one material per figure", (arsenal, kind) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const color of COLORS) {
      const root = new THREE.Group();
      const arms = attachWeapons(root, kind, color, 1, 0, arsenal);

      expect(arms.materials).toHaveLength(1);
      // The resting glow is per vertex; the material only carries the highlight.
      expect(arms.baseEmissive).toEqual([0]);
      expect(arms.meshes).toHaveLength(propCount(root));
      for (const mesh of arms.meshes) {
        expect(mesh.material).toBe(arms.materials[0]);
        const geometry = mesh.geometry;
        const vertices = geometry.getAttribute("position").count;
        expect(vertices).toBeGreaterThan(0);
        for (const name of ["normal", "color", "armSurface", "armGlow"]) {
          expect(geometry.getAttribute(name)?.count).toBe(vertices);
        }
      }
      for (const material of arms.materials) material.dispose();
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("shares one geometry per weapon and livery across figures", () => {
    const first = attachWeapons(new THREE.Group(), "p", "w", 1, 0, "kingdom");
    const second = attachWeapons(new THREE.Group(), "p", "w", 1, 0, "kingdom");
    const other = attachWeapons(new THREE.Group(), "p", "b", 1, 0, "kingdom");
    expect(second.meshes.map((mesh) => mesh.geometry)).toEqual(first.meshes.map((mesh) => mesh.geometry));
    expect(other.meshes[0].geometry).not.toBe(first.meshes[0].geometry);
    expect(second.materials[0]).not.toBe(first.materials[0]);
  });
});
