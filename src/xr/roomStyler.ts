import * as THREE from "three";

import type { ArenaTheme } from "../scene/arena";
import { toLightBlending } from "../scene/lightBlend";
import { ROOM_THEMES, spawnParticle, stepParticle, type BoardArea, type RoomWeather } from "./roomTheme";

/** Most particles any theme asks for (the pool is built once). */
const POOL = 500;
/** Seconds a theme change takes to settle. */
const FADE_S = 1.5;

/** A soft round dot, white with a falling-off edge, for snow, sand, pollen and embers. */
function dotTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.45, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The real room, restyled by the battleground: a veil that dims and tints the
 * passthrough, weather falling in the room around the player, and the board's
 * light pooling on the table under it. Three draws, no lights, no shadows.
 */
export class RoomStyler {
  readonly group = new THREE.Group();
  private readonly veil: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly glow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly dots: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly streaks: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly positions = Array.from({ length: POOL }, () => new THREE.Vector3());
  private readonly phases = new Float32Array(POOL);
  private theme: ArenaTheme | null = null;
  private kind: RoomWeather = "none";
  private count = 0;
  private fade = 1;
  private readonly from = { alpha: 0, color: new THREE.Color(), glow: 0, glowColor: new THREE.Color(), weather: 0 };
  private readonly random = Math.random;
  /** Scratch for the per-frame colour fades: the headset loop allocates nothing. */
  private readonly toColor = new THREE.Color();

  constructor() {
    this.group.name = "xr_room";

    this.veil = new THREE.Mesh(
      new THREE.SphereGeometry(2.5, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false, toneMapped: false }),
    );
    // Drawn first and never over anything: it only ever darkens the room behind the game.
    this.veil.renderOrder = -10;
    this.veil.frustumCulled = false;

    const glowTexture = dotTexture();
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: glowTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    // Light pooling on the table adds to the room; it never darkens it (see lightBlend.ts).
    toLightBlending(this.glow.material);
    this.glow.renderOrder = -5;

    const dotGeometry = new THREE.BufferGeometry();
    dotGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(POOL * 3), 3));
    this.dots = new THREE.Points(
      dotGeometry,
      new THREE.PointsMaterial({ size: 0.012, map: glowTexture, transparent: true, depthWrite: false, opacity: 0, toneMapped: false }),
    );
    this.dots.frustumCulled = false;

    const streakGeometry = new THREE.BufferGeometry();
    streakGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(POOL * 6), 3));
    this.streaks = new THREE.LineSegments(
      streakGeometry,
      new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, opacity: 0, toneMapped: false }),
    );
    this.streaks.frustumCulled = false;

    for (let i = 0; i < POOL; i += 1) this.phases[i] = Math.random() * Math.PI * 2;
    this.group.add(this.veil, this.glow, this.dots, this.streaks);
  }

  get current(): ArenaTheme | null {
    return this.theme;
  }

  /** Switches the room to a battleground, crossfading from the last one. `headYaw`: where the player faces. */
  setTheme(theme: ArenaTheme, head: THREE.Vector3, board: BoardArea | null, headYaw: number | null = null): void {
    if (theme === this.theme) return;
    this.from.alpha = this.veil.material.opacity;
    this.from.color.copy(this.veil.material.color);
    this.from.glow = this.glow.material.opacity;
    this.from.glowColor.copy(this.glow.material.color);
    this.theme = theme;
    this.fade = 0;

    const { weather } = ROOM_THEMES[theme];
    this.kind = weather.kind;
    this.count = Math.min(POOL, weather.count);
    for (let i = 0; i < this.count; i += 1) spawnParticle(this.kind, head, board, this.random, this.positions[i], true, headYaw);
    const dotsMaterial = this.dots.material;
    dotsMaterial.color.setHex(weather.color);
    // Embers and pollen glow: light that adds to the room. Set here rather than
    // left to the engine's per-frame pass, which converts each material once
    // and would never see this one flipped back to plain additive, which
    // darkens passthrough.
    if (this.kind === "embers" || this.kind === "pollen") toLightBlending(dotsMaterial);
    else dotsMaterial.blending = THREE.NormalBlending;
    dotsMaterial.size = this.kind === "sand" ? 0.006 : this.kind === "embers" ? 0.01 : 0.014;
    dotsMaterial.needsUpdate = true;
    this.streaks.material.color.setHex(weather.color);
    this.dots.visible = this.kind !== "none" && this.kind !== "rain";
    this.streaks.visible = this.kind === "rain";
    this.dots.geometry.setDrawRange(0, this.count);
    this.streaks.geometry.setDrawRange(0, this.count * 2);
  }

  /**
   * Every headset frame. `board` keeps the weather off the pieces and is where
   * the glow lies; `headYaw` keeps it out of the player's face (without it the
   * board's direction stands in for the gaze).
   */
  update(dt: number, head: THREE.Vector3, board: BoardArea | null, tableYaw: number, headYaw: number | null = null): void {
    if (!this.theme) return;
    const theme = ROOM_THEMES[this.theme];
    this.fade = Math.min(1, this.fade + dt / FADE_S);
    const t = this.fade * this.fade * (3 - 2 * this.fade);

    this.veil.position.copy(head);
    this.veil.material.opacity = THREE.MathUtils.lerp(this.from.alpha, theme.veil.alpha, t);
    this.veil.material.color.copy(this.from.color).lerp(this.toColor.setHex(theme.veil.color), t);
    this.veil.visible = this.veil.material.opacity > 0.002;

    if (board) {
      this.glow.visible = true;
      this.glow.position.set(board.center.x, board.center.y + 0.002, board.center.z);
      this.glow.rotation.y = tableYaw;
      this.glow.scale.setScalar(board.half * 2 * 1.9);
      this.glow.material.opacity = THREE.MathUtils.lerp(this.from.glow, theme.glow.intensity, t);
      this.glow.material.color.copy(this.from.glowColor).lerp(this.toColor.setHex(theme.glow.color), t);
    } else {
      this.glow.visible = false;
    }

    const weatherOpacity = theme.weather.opacity * t;
    this.dots.material.opacity = weatherOpacity;
    this.streaks.material.opacity = weatherOpacity;
    if (this.kind === "none") return;

    const dotArray = this.dots.geometry.getAttribute("position") as THREE.BufferAttribute;
    const streakArray = this.streaks.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < this.count; i += 1) {
      this.phases[i] += dt;
      const point = this.positions[i];
      stepParticle(this.kind, point, dt, this.phases[i], head, board, this.random, headYaw);
      if (this.kind === "rain") {
        streakArray.setXYZ(i * 2, point.x, point.y, point.z);
        streakArray.setXYZ(i * 2 + 1, point.x - 0.012, point.y + 0.09, point.z);
      } else {
        dotArray.setXYZ(i, point.x, point.y, point.z);
      }
    }
    if (this.kind === "rain") streakArray.needsUpdate = true;
    else dotArray.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.veil.geometry.dispose();
    this.veil.material.dispose();
    this.glow.geometry.dispose();
    this.glow.material.map?.dispose();
    this.glow.material.dispose();
    this.dots.geometry.dispose();
    this.dots.material.dispose();
    this.streaks.geometry.dispose();
    this.streaks.material.dispose();
  }
}
