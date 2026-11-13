import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { LightBlendPass, toLightBlending } from "./lightBlend";

describe("light blending", () => {
  it("adds colour like AdditiveBlending but never writes alpha", () => {
    const material = new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending });
    toLightBlending(material);
    expect(material.blending).toBe(THREE.CustomBlending);
    expect(material.blendSrc).toBe(THREE.SrcAlphaFactor);
    expect(material.blendDst).toBe(THREE.OneFactor);
    expect(material.blendSrcAlpha).toBe(THREE.ZeroFactor);
    expect(material.blendDstAlpha).toBe(THREE.OneFactor);
  });

  it("converts the additive materials in a scene and leaves the others", () => {
    const scene = new THREE.Scene();
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending }));
    const solid = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    const fade = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ transparent: true }));
    scene.add(glow, solid, fade);
    new LightBlendPass().apply(scene);
    expect(glow.material.blending).toBe(THREE.CustomBlending);
    expect(solid.material.blending).toBe(THREE.NormalBlending);
    expect(fade.material.blending).toBe(THREE.NormalBlending);
  });
});
