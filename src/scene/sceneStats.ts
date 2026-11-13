import type * as THREE from "three";

export interface DrawableInfo {
  name: string;
  type: string;
  materials: number;
  triangles: number;
  skinned: boolean;
  instances: number;
}

export interface SceneBreakdown {
  /** Draw calls of the last rendered frame, as three.js counted them. */
  calls: number;
  triangles: number;
  /** Visible drawables (one per material) per top-level group, by name (inside `game_world` too). */
  perGroup: Record<string, number>;
}

function trianglesOf(object: THREE.Mesh | THREE.Points | THREE.Line): number {
  const geometry = object.geometry;
  const count = geometry.index ? geometry.index.count : (geometry.attributes.position?.count ?? 0);
  const instanced = (object as THREE.InstancedMesh).isInstancedMesh ? (object as THREE.InstancedMesh).count : 1;
  return (count / 3) * instanced;
}

function isDrawable(object: THREE.Object3D): object is THREE.Mesh | THREE.Points | THREE.Line {
  const candidate = object as Partial<THREE.Mesh & THREE.Points & THREE.Line & THREE.Sprite>;
  return Boolean(candidate.isMesh || candidate.isPoints || candidate.isLine || candidate.isSprite);
}

/**
 * Materials the renderer will actually draw with. A `visible: false` material
 * (the figures' pick boxes) is skipped by three.js before it ever becomes a call.
 */
function materialCount(object: THREE.Mesh | THREE.Points | THREE.Line): number {
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.filter((material) => material?.visible !== false).length;
}

/** Visible drawables under `root`, one row each — for finding what a frame is made of. */
export function listDrawables(root: THREE.Object3D): DrawableInfo[] {
  const rows: DrawableInfo[] = [];
  root.traverseVisible((object) => {
    if (!isDrawable(object)) return;
    const materials = materialCount(object);
    if (materials === 0) return;
    rows.push({
      name: object.name || object.parent?.name || "(unnamed)",
      type: object.type,
      materials,
      triangles: Math.round(trianglesOf(object)),
      skinned: Boolean((object as THREE.SkinnedMesh).isSkinnedMesh),
      instances: (object as THREE.InstancedMesh).isInstancedMesh ? (object as THREE.InstancedMesh).count : 1,
    });
  });
  return rows;
}

export function sceneBreakdown(scene: THREE.Scene, renderer: THREE.WebGLRenderer): SceneBreakdown {
  const perGroup: Record<string, number> = {};
  // The game's own group is a container: report what is inside it by name.
  const groups = scene.children.flatMap((child) => (child.name === "game_world" ? child.children : [child]));
  for (const child of groups) {
    const name = child.name || child.type;
    const drawables = listDrawables(child).reduce((sum, row) => sum + row.materials, 0);
    perGroup[name] = (perGroup[name] ?? 0) + drawables;
  }
  return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, perGroup };
}
