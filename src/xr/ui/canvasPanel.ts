import * as THREE from "three";

import { UI } from "./palette";

/** Pixels per metre of panel: 0.9 cm type at arm's length comes out ~27 px tall. */
const PX_PER_M = 3000;
/** Meta's hands minimum hit target. */
export const MIN_TARGET_M = 0.022;
/**
 * Moving glyphs are redrawn at most this often. Every redraw re-uploads the
 * whole canvas (the coach strip is 1260x240), and at 72-90 Hz that upload was
 * a steady cost on the headset for a hand gesture that reads fine at 15.
 */
const ANIMATE_HZ = 15;

export interface PanelButton {
  id: string;
  /** In panel metres from the top-left corner: x, y, width, height. */
  rect: [number, number, number, number];
  label: string;
  /** Optional glyph drawn left of the label ("" for none). */
  icon?: string;
  tone?: "primary" | "plain" | "danger" | "selected";
  disabled?: boolean;
}

export interface PanelContent {
  /** Short lines drawn above the buttons: [text, size in metres, colour]. */
  lines: { text: string; size: number; color?: string; y: number; font?: "ui" | "display"; align?: "center" | "left" }[];
  buttons: PanelButton[];
  /** Custom drawing (glyphs, crests) in panel metres; ctx is already scaled to metres. */
  draw?: (ctx: CanvasRenderingContext2D, time: number) => void;
}

/**
 * A flat panel in the room, drawn with Canvas 2D into one texture: one draw
 * call, crisp text, and redrawn only when its content or hover state changes
 * (or every frame while it animates). Buttons are rectangles in panel metres;
 * {@link CanvasPanel.buttonAt} resolves a local point for both poke and ray.
 */
export class CanvasPanel {
  readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private content: PanelContent = { lines: [], buttons: [] };
  private hover: string | null = null;
  private pressedId: string | null = null;
  private pressedUntil = 0;
  private animated = false;
  private drawnAt = -Infinity;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.round(width * PX_PER_M);
    this.canvas.height = Math.round(height * PX_PER_M);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    // Drawn near 1:1 at arm's length (PX_PER_M): no mip chain to rebuild on
    // every upload, and no anisotropic taps.
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    this.mesh.renderOrder = 20;
    this.mesh.name = "xr_panel";
  }

  /** Replaces what the panel shows. `animate` redraws every frame (for moving glyphs). */
  set(content: PanelContent, animate = false): void {
    if (import.meta.env.DEV) {
      for (const button of content.buttons) {
        if (button.rect[2] < MIN_TARGET_M || button.rect[3] < MIN_TARGET_M) {
          console.warn(`[xr] panel button "${button.id}" is under Meta's 22 mm minimum`);
        }
      }
    }
    this.content = content;
    this.animated = animate;
    this.redraw(performance.now() / 1000);
  }

  /** Tests and look-dev: the panel as a PNG data URL. */
  snapshot(): string {
    return this.canvas.toDataURL("image/png");
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  set visible(value: boolean) {
    this.mesh.visible = value;
  }

  /** The enabled button under a point in panel metres (origin top-left), if any. */
  buttonAt(x: number, y: number): PanelButton | null {
    for (const button of this.content.buttons) {
      const [bx, by, bw, bh] = button.rect;
      if (!button.disabled && x >= bx && x <= bx + bw && y >= by && y <= by + bh) return button;
    }
    return null;
  }

  /** A world point on (or near) the panel → panel metres from the top-left, and signed distance in front. */
  localPoint(world: THREE.Vector3): { x: number; y: number; depth: number } {
    const local = this.mesh.worldToLocal(world.clone());
    return { x: local.x + this.width / 2, y: this.height / 2 - local.y, depth: local.z };
  }

  setHover(id: string | null): void {
    if (id === this.hover) return;
    this.hover = id;
    this.redraw(performance.now() / 1000);
  }

  /** Flash a button as pressed for a moment (the press itself is handled by the owner). */
  flash(id: string): void {
    this.pressedId = id;
    this.pressedUntil = performance.now() / 1000 + 0.18;
    this.redraw(performance.now() / 1000);
  }

  update(now: number): void {
    if (this.pressedId && now >= this.pressedUntil) {
      this.pressedId = null;
      if (this.mesh.visible) this.redraw(now);
    } else if (this.animated && this.mesh.visible && now - this.drawnAt >= 1 / ANIMATE_HZ) {
      this.redraw(now);
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }

  private redraw(now: number): void {
    this.drawnAt = now;
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(PX_PER_M, PX_PER_M);

    roundRect(ctx, 0.002, 0.002, this.width - 0.004, this.height - 0.004, 0.012);
    ctx.fillStyle = UI.glass;
    ctx.fill();
    ctx.lineWidth = 0.0012;
    ctx.strokeStyle = UI.line;
    ctx.stroke();

    for (const line of this.content.lines) {
      this.text(line.text, line.align === "left" ? 0.014 : this.width / 2, line.y, line.size, line.color ?? UI.text, {
        weight: line.font === "display" ? 700 : 600,
        family: line.font === "display" ? UI.display : UI.font,
        align: line.align ?? "center",
      });
    }

    for (const button of this.content.buttons) this.drawButton(button);
    this.content.draw?.(ctx, now);
    this.texture.needsUpdate = true;
  }

  private drawButton(button: PanelButton): void {
    const { ctx } = this;
    const [x, y, w, h] = button.rect;
    const tone = button.tone ?? "plain";
    const hovered = this.hover === button.id;
    const pressed = this.pressedId === button.id;
    const inset = pressed ? 0.0015 : 0;
    roundRect(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, Math.min(0.008, h / 3));
    ctx.fillStyle = button.disabled
      ? UI.surface
      : tone === "primary"
        ? UI.gold
        : tone === "danger"
          ? UI.danger
          : tone === "selected"
            ? UI.surfaceHover
            : hovered
              ? UI.surfaceHover
              : UI.surface;
    ctx.globalAlpha = button.disabled ? 0.45 : 1;
    ctx.fill();
    if (hovered || tone === "selected") {
      ctx.lineWidth = 0.0016;
      ctx.strokeStyle = UI.gold;
      ctx.stroke();
    }
    this.text(button.label, x + w / 2, y + h / 2, Math.min(0.011, h * 0.42), tone === "primary" ? UI.goldText : UI.text, {
      weight: 600,
      family: UI.font,
      align: "center",
    });
    ctx.globalAlpha = 1;
  }

  /**
   * Text in real pixels, centred on its ink: drawn into the metre-scaled
   * context, sizes under a pixel are dropped silently by Chrome's canvas.
   */
  private text(
    value: string,
    x: number,
    y: number,
    size: number,
    color: string,
    style: { weight: number; family: string; align: CanvasTextAlign },
  ): void {
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${style.weight} ${Math.round(size * PX_PER_M)}px ${style.family}`;
    ctx.fillStyle = color;
    ctx.textAlign = style.align;
    ctx.textBaseline = "alphabetic";
    const metrics = ctx.measureText(value);
    const inkMiddle = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
    ctx.fillText(value, x * PX_PER_M, y * PX_PER_M + inkMiddle);
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
