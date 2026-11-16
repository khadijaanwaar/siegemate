import * as THREE from "three";

type Drawable = THREE.Mesh | THREE.Points | THREE.Sprite | THREE.Line;

function isDrawable(object: THREE.Object3D): object is Drawable {
  const candidate = object as Partial<THREE.Mesh & THREE.Points & THREE.Sprite & THREE.Line>;
  return Boolean(candidate.isMesh || candidate.isPoints || candidate.isSprite || candidate.isLine);
}

/**
 * A bare object of the same kind as `object`, sharing its geometry, drawn with
 * `material`. Built by hand rather than with `clone()`, which deep-copies
 * `userData` (some pieces keep circular references there) and children.
 * Only the parts that pick a program are copied: the object's kind, the
 * geometry's attributes and whether instances carry a colour.
 */
function standInFor(object: Drawable, material: THREE.Material): Drawable | null {
  const instanced = object as THREE.InstancedMesh;
  if (instanced.isInstancedMesh) {
    const copy = new THREE.InstancedMesh(instanced.geometry, material, 1);
    if (instanced.instanceColor) copy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
    return copy;
  }
  if ((object as THREE.Points).isPoints) return new THREE.Points((object as THREE.Points).geometry, material);
  if ((object as THREE.Sprite).isSprite) return new THREE.Sprite(material as THREE.SpriteMaterial);
  if ((object as THREE.Line).isLine) {
    const line = object as THREE.Line;
    if ((line as THREE.LineSegments).isLineSegments) return new THREE.LineSegments(line.geometry, material);
    return new THREE.Line(line.geometry, material);
  }
  if ((object as THREE.Mesh).isMesh) return new THREE.Mesh((object as THREE.Mesh).geometry, material);
  return null;
}

/** Cache keys of every program three.js has built for `material` (one per light set, side, ...). */
function programKeysOf(renderer: THREE.WebGLRenderer, material: THREE.Material): string[] {
  const programs = (renderer.properties.get(material) as { programs?: Map<string, unknown> }).programs;
  return programs ? [...programs.keys()] : [];
}

/** The shader program three.js last drew `material` with, if any. */
function programOf(renderer: THREE.WebGLRenderer, material: THREE.Material): { cacheKey: string } | undefined {
  return (renderer.properties.get(material) as { currentProgram?: { cacheKey: string } }).currentProgram;
}

type Seeds = { objects: THREE.Object3D[]; resources: Array<THREE.BufferGeometry | THREE.Texture> };

/**
 * Keeps the shader programs of throwaway materials alive.
 *
 * A fight builds its sparks, flashes, rings and debris with fresh materials
 * and disposes them when the effect ends. Disposing the last material that
 * uses a program deletes the program, so every fight compiled the same
 * shaders again, a hitch the player felt on the headset at the moment of the
 * blow. The keeper holds one stand-in per program: a copy of the material on
 * a bare object of the same kind, in a group that is never drawn. Nothing
 * about the effects themselves changes.
 *
 * Stand-ins come from two places: {@link seed} (the materials a fight makes,
 * added before the first fight so the table's warm-up
 * compiles them behind the placement reticle) and {@link learn}, which adopts
 * any material it sees drawn with a program not yet held.
 */
export class ProgramKeeper {
  /** Never drawn. Its materials are still compiled by the table warm-up. */
  readonly group = new THREE.Group();
  private readonly seen = new WeakSet<THREE.Material>();
  private readonly held = new Set<string>();
  /** Geometries and textures the seeds own (learned stand-ins borrow theirs). */
  private readonly seedResources: Array<THREE.BufferGeometry | THREE.Texture> = [];

  /** @param compile Compiles an object for the frame being drawn. */
  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly compile: (object: THREE.Object3D) => void,
  ) {
    this.group.name = "program_keepers";
    this.group.visible = false;
  }

  /** Adds stand-ins for the materials a fight will make. */
  seed(seeds: Seeds): void {
    for (const object of seeds.objects) {
      object.frustumCulled = false;
      this.group.add(object);
    }
    this.seedResources.push(...seeds.resources);
  }

  /** Program keys currently held, for the perf spec. */
  get size(): number {
    return this.held.size;
  }

  /**
   * After a frame: adopt every material under `root` drawn with a program
   * nobody keeps yet. Must run while the frame's render target is still bound
   * (the stand-in is compiled in the same state, so it lands on the same
   * program instead of building another).
   */
  learn(root: THREE.Object3D): void {
    root.traverseVisible((object) => {
      if (!isDrawable(object) || (object as THREE.SkinnedMesh).isSkinnedMesh) return;
      const material = object.material as THREE.Material | THREE.Material[];
      for (const entry of Array.isArray(material) ? material : [material]) {
        if (this.seen.has(entry)) continue;
        const program = programOf(this.renderer, entry);
        if (!program) continue; // not drawn yet: look again next time
        this.seen.add(entry);
        if (this.held.has(program.cacheKey)) continue;
        this.adopt(object, entry, program.cacheKey);
      }
    });
  }

  /** Marks every program the stand-ins were compiled with as held. */
  noteSeeds(): void {
    this.group.traverse((object) => {
      if (!isDrawable(object)) return;
      const material = object.material as THREE.Material | THREE.Material[];
      for (const entry of Array.isArray(material) ? material : [material]) {
        for (const key of programKeysOf(this.renderer, entry)) this.held.add(key);
      }
    });
  }

  private adopt(object: Drawable, material: THREE.Material, key: string): void {
    const twin = material.clone();
    // Shader patches live in functions, which clone() does not carry.
    twin.onBeforeCompile = material.onBeforeCompile;
    twin.customProgramCacheKey = material.customProgramCacheKey;
    const standIn = standInFor(object, twin);
    if (!standIn) {
      twin.dispose();
      return;
    }
    standIn.frustumCulled = false;
    this.group.add(standIn);
    this.compile(standIn);
    const keys = programKeysOf(this.renderer, twin);
    if (keys.includes(key)) {
      for (const held of keys) this.held.add(held);
      return;
    }
    // The copy came out different (it would hold the wrong program): drop it.
    standIn.removeFromParent();
    twin.dispose();
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (!isDrawable(object)) return;
      const material = object.material as THREE.Material | THREE.Material[];
      for (const entry of Array.isArray(material) ? material : [material]) entry.dispose();
    });
    for (const resource of this.seedResources) resource.dispose();
    this.seedResources.length = 0;
    this.group.clear();
    this.group.removeFromParent();
    this.held.clear();
  }
}
