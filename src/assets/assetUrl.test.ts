import { afterEach, describe, expect, it, vi } from "vitest";

import { assetUrl } from "./assetUrl";

describe("assetUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves from the site root when the app is built with base '/'", () => {
    vi.stubEnv("BASE_URL", "/");
    expect(assetUrl("models", "x.glb")).toBe("/assets/models/x.glb");
  });

  it("stays relative when the app is built with base './'", () => {
    vi.stubEnv("BASE_URL", "./");
    expect(assetUrl("models", "x.glb")).toBe("./assets/models/x.glb");
  });

  it("lives under a sub-path base", () => {
    vi.stubEnv("BASE_URL", "/chess/");
    expect(assetUrl("audio", "cry.mp3")).toBe("/chess/assets/audio/cry.mp3");
  });

  it("adds the separator a base without a trailing slash is missing", () => {
    vi.stubEnv("BASE_URL", "/chess");
    expect(assetUrl("cards", "dawn.webp")).toBe("/chess/assets/cards/dawn.webp");
  });
});
