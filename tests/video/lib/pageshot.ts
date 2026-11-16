// A page shot: the game's 2D page in a plain browser (no emulator, no room, no hands), on the same
// frame clock, photographed every captured frame. For the phone and laptop cuts of the film.
import type { Page } from "playwright";

import type { Encoder, ShotEvent } from "./shot.ts";
import { SIM_HZ } from "./shot.ts";

export interface PageShot<S = unknown> {
  kind: "page";
  name: string;
  description: string;
  seconds: number;
  /** CSS size of the page and its device pixel ratio (the frames are width x scale by height x scale). */
  viewport: { width: number; height: number; scale: number; mobile?: boolean };
  /** Page path and query after the origin, e.g. "/?quality=high#r=…". */
  path(origin: string): string;
  storage?: Record<string, string>;
  /** Unrecorded. */
  setup(ctx: PageContext): Promise<S>;
  /** Recorded. */
  play(ctx: PageContext, data: S): Promise<void>;
}

export const definePageShot = <S>(shot: PageShot<S>): PageShot<S> => shot;

export class PageContext {
  readonly page: Page;
  readonly events: ShotEvent[] = [];
  n = 0;
  recording = false;
  encoder: Encoder | null = null;
  private readonly stride: number;
  readonly stats = { frames: 0, captured: 0, shotMs: 0 };

  constructor(page: Page, stride: number) {
    this.page = page;
    this.stride = stride;
    this.wait = this.wait.bind(this);
    this.waitFor = this.waitFor.bind(this);
    this.mark = this.mark.bind(this);
    this.click = this.click.bind(this);
    this.clickText = this.clickText.bind(this);
  }

  time(): number {
    return this.n / SIM_HZ;
  }

  mark(type: string, data: Record<string, unknown> = {}): void {
    if (this.recording) this.events.push({ t: Math.round(this.time() * 1000) / 1000, frame: this.n, type, ...data });
  }

  /** One frame of the page: wait for async work, step the clock, photograph it when due. */
  async step(): Promise<void> {
    await this.page.evaluate(async (dt) => {
      const w = window as unknown as { __filmIdle(): Promise<boolean>; __vt: { step(ms: number): unknown } };
      await w.__filmIdle();
      w.__vt.step(dt);
    }, 1000 / SIM_HZ);
    this.stats.frames++;
    if (this.recording && this.encoder && this.n % this.stride === 0) {
      const s0 = Date.now();
      const png = await this.page.screenshot({ type: "png" });
      this.stats.shotMs += Date.now() - s0;
      this.stats.captured++;
      await this.encoder.write(png);
    }
    this.n++;
  }

  async wait(ms: number): Promise<void> {
    const frames = Math.max(0, Math.round((ms / 1000) * SIM_HZ));
    for (let i = 0; i < frames; i++) await this.step();
  }

  async waitFor<A>(pred: (arg: A) => boolean, arg: A, o: { maxMs: number; label: string }): Promise<void> {
    const frames = Math.ceil((o.maxMs / 1000) * SIM_HZ);
    for (let i = 0; i <= frames; i++) {
      if (await this.page.evaluate(pred as (a: unknown) => boolean, arg)) return;
      await this.step();
    }
    throw new Error(`waited ${o.maxMs} ms of shot time for ${o.label}`);
  }

  /** Click an element the way a tap lands (the element's own click; no pointer travel to film). */
  async click(selector: string): Promise<void> {
    const ok = await this.page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel);
      el?.click();
      return Boolean(el);
    }, selector);
    if (!ok) throw new Error(`nothing to click at ${selector}`);
    this.mark("tap", { target: selector });
  }

  /** Click the button whose text is `text`. */
  async clickText(text: string): Promise<void> {
    const ok = await this.page.evaluate((t) => {
      const el = [...document.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent?.trim() === t && b.offsetParent !== null);
      el?.click();
      return Boolean(el);
    }, text);
    if (!ok) throw new Error(`no button "${text}" on show`);
    this.mark("tap", { target: text });
  }

  startRecording(encoder: Encoder): void {
    this.recording = true;
    this.encoder = encoder;
    this.n = 0;
  }
}
