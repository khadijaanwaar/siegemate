import * as THREE from "three";

const LEGAL = 0x7dffb0;
const NEUTRAL = 0xd8c49a;

/**
 * The few things the XR layer draws itself: the command line from a figure to
 * the hand giving it an order, the ring on the square it would march to, a
 * pointer ray per hand or controller, and the placement ring. Five draws at
 * most, all unlit, none casting or receiving anything.
 */
export class Markers {
  readonly group = new THREE.Group();
  private readonly orderLine: THREE.Line;
  private readonly aimRing: THREE.Mesh;
  private readonly rays: THREE.Line[];
  private readonly placeRing: THREE.Mesh;

  constructor() {
    this.group.name = "xr_markers";

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.orderLine = new THREE.Line(
      lineGeometry,
      new THREE.LineBasicMaterial({ color: LEGAL, transparent: true, opacity: 0.85, depthTest: false }),
    );
    this.orderLine.renderOrder = 10;
    this.orderLine.frustumCulled = false;

    this.aimRing = new THREE.Mesh(
      new THREE.RingGeometry(0.017, 0.022, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: LEGAL, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.aimRing.renderOrder = 10;

    this.rays = [0, 1].map(() => {
      const ray = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }),
      );
      ray.frustumCulled = false;
      return ray;
    });

    this.placeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.255, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.8, depthWrite: false }),
    );

    this.group.add(this.orderLine, this.aimRing, ...this.rays, this.placeRing);
    this.hideAll();
  }

  hideAll(): void {
    for (const child of this.group.children) child.visible = false;
  }

  showOrder(from: THREE.Vector3 | null, to: THREE.Vector3 | null, legal: boolean): void {
    this.orderLine.visible = from !== null && to !== null;
    if (from && to) {
      const position = this.orderLine.geometry.getAttribute("position") as THREE.BufferAttribute;
      position.setXYZ(0, from.x, from.y, from.z);
      position.setXYZ(1, to.x, to.y, to.z);
      position.needsUpdate = true;
      (this.orderLine.material as THREE.LineBasicMaterial).color.setHex(legal ? LEGAL : NEUTRAL);
    }
  }

  /** `at` is the centre of the square's top face, world space. */
  showAim(at: THREE.Vector3 | null, legal: boolean, yaw: number): void {
    this.aimRing.visible = at !== null;
    if (!at) return;
    this.aimRing.position.copy(at).setY(at.y + 0.002);
    this.aimRing.rotation.y = yaw;
    (this.aimRing.material as THREE.MeshBasicMaterial).color.setHex(legal ? LEGAL : NEUTRAL);
  }

  /** `length` in metres; null hides that hand's ray. */
  showRay(index: 0 | 1, ray: THREE.Ray | null, length = 0.6): void {
    const line = this.rays[index];
    line.visible = ray !== null;
    if (!ray) return;
    const position = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const end = ray.at(length, new THREE.Vector3());
    position.setXYZ(0, ray.origin.x, ray.origin.y, ray.origin.z);
    position.setXYZ(1, end.x, end.y, end.z);
    position.needsUpdate = true;
  }

  showPlacement(at: THREE.Vector3 | null): void {
    this.placeRing.visible = at !== null;
    if (at) this.placeRing.position.copy(at).setY(at.y + 0.003);
  }

  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    });
    this.group.removeFromParent();
  }
}
