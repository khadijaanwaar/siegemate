import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { describe, expect, it } from "vitest";

import {
  BLEND_ADD,
  BLEND_OVER,
  Decal,
  type DecalStyle,
  OverlayBatch,
  createOverlayMaterial,
  groupFacesByMaterial,
  writePlacement,
} from "./overlayBatch";

const RECT = [0.25, 0.5, 0.125, 0.25] as const;

function quad(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
}

describe("writePlacement", () => {
  it("matches three's compose(position, Ry(spin), scale)", () => {
    const out = new Float32Array(32);
    writePlacement(out, 16, 1.5, -0.25, 3, 0.7, 2, 0.5, 1.25);
    const expected = new THREE.Matrix4().compose(
      new THREE.Vector3(1.5, -0.25, 3),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7),
      new THREE.Vector3(2, 0.5, 1.25),
    );
    const written = Array.from(out.subarray(16));
    expected.elements.forEach((value, i) => expect(written[i]).toBeCloseTo(value, 5));
  });

  it("turns a quad laid flat exactly as rotation.x = -π/2 then rotation.z = spin did", () => {
    const out = new Float32Array(16);
    writePlacement(out, 0, 0, 0, 0, 0.9, 1, 1, 1);
    const flat = new THREE.Matrix4().fromArray(out).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    const old = new THREE.Object3D();
    old.rotation.set(-Math.PI / 2, 0, 0.9);
    old.updateMatrix();
    old.matrix.elements.forEach((value, i) => expect(flat.elements[i]).toBeCloseTo(value, 5));
  });
});

describe("OverlayBatch", () => {
  const style: DecalStyle = { size: 2, rect: RECT, blend: BLEND_OVER, alpha: 0.5 };

  function decal(opacity: number, visible = true): Decal {
    const d = new Decal();
    d.position.set(1, 2, 3);
    d.scale.setScalar(0.5);
    d.color.setRGB(0.25, 0.5, 0.75);
    d.opacity = opacity;
    d.visible = visible;
    return d;
  }

  it("packs only what is lit and hides the draw when nothing is", () => {
    const batch = new OverlayBatch("test", quad(), new THREE.MeshBasicMaterial(), 4, 2);
    batch.begin();
    batch.push(decal(0.8), style);
    batch.push(decal(0), style);
    batch.push(decal(0.8, false), style);
    batch.push(decal(0.4), { ...style, blend: BLEND_ADD, billboard: true, part: 1 });
    batch.end();
    expect(batch.count).toBe(2);
    expect(batch.mesh.count).toBe(2);
    expect(batch.mesh.visible).toBe(true);

    const tint = batch.mesh.geometry.getAttribute("aTint").array;
    expect(Array.from(tint.slice(0, 3))).toEqual([0.25, 0.5, 0.75]);
    expect(tint[3]).toBeCloseTo(0.4);
    expect(tint[7]).toBeCloseTo(0.2);
    const mode = batch.mesh.geometry.getAttribute("aMode").array;
    expect(Array.from(mode.slice(0, 8))).toEqual([BLEND_OVER, 0, 0, 0, BLEND_ADD, 1, 1, 0]);
    expect(Array.from(batch.mesh.geometry.getAttribute("aUvRect").array.slice(0, 4))).toEqual([...RECT]);

    const matrix = new THREE.Matrix4();
    batch.mesh.getMatrixAt(0, matrix);
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    matrix.decompose(position, new THREE.Quaternion(), scale);
    expect(position.toArray()).toEqual([1, 2, 3]);
    expect(scale.toArray()).toEqual([1, 1, 1]);

    batch.begin();
    batch.end();
    expect(batch.mesh.visible).toBe(false);
    batch.dispose();
  });

  it("drops overlays past capacity instead of overrunning the buffers", () => {
    const batch = new OverlayBatch("test", quad(), new THREE.MeshBasicMaterial(), 2, 2);
    batch.begin();
    for (let i = 0; i < 5; i += 1) batch.push(decal(1), style);
    batch.end();
    expect(batch.count).toBe(2);
    expect(batch.mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 32 }]);
    batch.dispose();
  });
});

describe("createOverlayMaterial", () => {
  function compile(material: THREE.Material): { vertexShader: string; fragmentShader: string } {
    const shader = {
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
      uniforms: {},
    };
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    return shader;
  }

  it("patches every chunk it relies on in this three.js build", () => {
    const map = new THREE.Texture();
    const material = createOverlayMaterial({ map, blend: "mixed", depthTest: false, billboards: true, parts: true });
    const shader = compile(material);
    expect(shader.vertexShader).toContain("attribute vec4 aTint;");
    expect(shader.vertexShader).toContain("attribute float aPart;");
    expect(shader.vertexShader).toContain("vMapUv = aUvRect.xy + vMapUv * aUvRect.zw;");
    expect(shader.vertexShader).toContain("transformed = vec3( 0.0 )");
    expect(shader.vertexShader).toContain("spriteScale");
    expect(shader.vertexShader).not.toContain("#include <project_vertex>");
    expect(shader.fragmentShader).toContain("diffuseColor *= vOverlayTint;");
    expect(shader.fragmentShader).toContain("gl_FragColor.a *= vOverlayBlend;");
    expect(material.premultipliedAlpha).toBe(true);
    expect(material.blending).toBe(THREE.NormalBlending);
    expect(material.depthTest).toBe(false);
  });

  it("keeps plain additive batches additive and gives each variant its own program", () => {
    const map = new THREE.Texture();
    const additive = createOverlayMaterial({ map, blend: "additive", depthTest: true });
    const shader = compile(additive);
    expect(shader.fragmentShader).not.toContain("vOverlayBlend;\n\tgl_FragColor");
    expect(shader.vertexShader).toContain("#include <project_vertex>");
    expect(additive.blending).toBe(THREE.AdditiveBlending);
    expect(additive.premultipliedAlpha).toBe(false);
    expect(additive.forceSinglePass).toBe(true);
    const mixed = createOverlayMaterial({ map, blend: "mixed", depthTest: true });
    expect(additive.customProgramCacheKey()).not.toBe(mixed.customProgramCacheKey());
  });
});

describe("groupFacesByMaterial", () => {
  it("draws a box's five stone faces as one range and its top as another", () => {
    const geometry = new RoundedBoxGeometry(9.66, 0.62, 9.66, 4, 0.09);
    const before = geometry.groups.map((group) => ({ ...group }));
    const vertices = geometry.getAttribute("position").count;
    groupFacesByMaterial(geometry, [0, 0, 1, 0, 0, 0]);

    expect(geometry.groups).toHaveLength(2);
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1]);
    const index = geometry.getIndex();
    expect(index).not.toBeNull();
    if (!index) return;
    expect(index.count).toBe(vertices);
    // Every vertex is drawn exactly once.
    const seen = new Set<number>();
    for (let i = 0; i < index.count; i += 1) seen.add(index.getX(i));
    expect(seen.size).toBe(vertices);
    // The top range holds exactly the old top face.
    const top = geometry.groups[1];
    const oldTop = before[2];
    expect(top.count).toBe(oldTop.count);
    for (let i = 0; i < top.count; i += 1) expect(index.getX(top.start + i)).toBe(oldTop.start + i);
  });
});
