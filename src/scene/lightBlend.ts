import * as THREE from "three";

/**
 * Additive light that leaves the framebuffer's alpha alone.
 *
 * Over passthrough the compositor shows `rgb + (1 - alpha) * room`. Three's
 * AdditiveBlending also adds to alpha, so every glow, spark and flash darkened
 * the real room behind it into a grey halo. Light must only add colour: the
 * same colour factors as AdditiveBlending, alpha kept as it was. On an opaque
 * desktop canvas the result is identical, so a converted material is never
 * converted back.
 */
export function toLightBlending(material: THREE.Material): void {
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = material.premultipliedAlpha ? THREE.OneFactor : THREE.SrcAlphaFactor;
  material.blendDst = THREE.OneFactor;
  material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrcAlpha = THREE.ZeroFactor;
  material.blendDstAlpha = THREE.OneFactor;
}

/**
 * Converts every additive material reachable from `root` (effects create theirs
 * on the fly, so this runs each frame on a table; each material only once).
 */
export class LightBlendPass {
  private readonly done = new WeakSet<THREE.Material>();

  apply(root: THREE.Object3D): void {
    root.traverseVisible((object) => {
      const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      for (const entry of Array.isArray(material) ? material : [material]) {
        if (this.done.has(entry)) continue;
        this.done.add(entry);
        if (entry.blending === THREE.AdditiveBlending) toLightBlending(entry);
      }
    });
  }
}
