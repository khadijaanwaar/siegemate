import { describe, expect, it } from "vitest";

import { classifyGpu, nextPresetForFps } from "./quality";

const desktop = { cores: 8, memory: 8, touch: false };

describe("classifyGpu", () => {
  it("puts Intel Iris Plus (the owner's laptop) on low", () => {
    const renderer =
      "angle (intel, angle metal renderer: intel(r) iris(tm) plus graphics, unspecified version)";
    expect(classifyGpu({ renderer, ...desktop })).toBe("low");
  });

  it("puts Intel UHD integrated graphics on low", () => {
    const renderer = "angle (intel, intel(r) uhd graphics 630 (0x00003e9b) direct3d11 vs_5_0 ps_5_0, d3d11)";
    expect(classifyGpu({ renderer, ...desktop })).toBe("low");
  });

  it("puts Apple silicon with enough cores and memory on ultra", () => {
    const renderer = "angle (apple, angle metal renderer: apple m2, unspecified version)";
    expect(classifyGpu({ renderer, ...desktop })).toBe("ultra");
  });

  it("puts the Quest's Adreno on low even without a touch screen", () => {
    const renderer = "adreno (tm) 740";
    expect(classifyGpu({ renderer, ...desktop })).toBe("low");
  });

  it("keeps an unknown discrete-class desktop on high", () => {
    expect(classifyGpu({ renderer: "", ...desktop })).toBe("high");
  });

  it("keeps software rasterisers on low", () => {
    expect(classifyGpu({ renderer: "google swiftshader", ...desktop })).toBe("low");
  });
});

describe("nextPresetForFps", () => {
  it("steps down one level when the average is under 45 fps", () => {
    expect(nextPresetForFps("high", 39)).toBe("medium");
    expect(nextPresetForFps("medium", 44.9)).toBe("low");
  });

  it("keeps the preset when the frame rate is healthy", () => {
    expect(nextPresetForFps("medium", 50)).toBeNull();
  });

  it("has nowhere to go below low", () => {
    expect(nextPresetForFps("low", 30)).toBeNull();
  });
});
