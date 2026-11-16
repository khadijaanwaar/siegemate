import { describe, expect, it } from "vitest";

import { AudioManager, loadSoundPrefs, saveSoundPrefs } from "./audioManager";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

describe("sound prefs", () => {
  it("default to sound and music on", () => {
    expect(loadSoundPrefs(memoryStorage())).toEqual({ muted: false, music: true });
    expect(loadSoundPrefs(null)).toEqual({ muted: false, music: true });
  });

  it("remember mute and music separately", () => {
    const storage = memoryStorage();
    saveSoundPrefs({ muted: false, music: false }, storage);
    expect(loadSoundPrefs(storage)).toEqual({ muted: false, music: false });
    saveSoundPrefs({ muted: true, music: true }, storage);
    expect(loadSoundPrefs(storage)).toEqual({ muted: true, music: true });
  });

  it("survive a corrupt entry", () => {
    const storage = memoryStorage();
    storage.setItem("mr-chess:sound", "{nope");
    expect(loadSoundPrefs(storage)).toEqual({ muted: false, music: true });
  });
});

describe("AudioManager before unlock", () => {
  it("takes the headset's switches without a mixer", () => {
    const mixer = new AudioManager();
    expect(() => {
      mixer.setTableMode(true);
      mixer.setMusicEnabled(false);
      mixer.setMuted(true);
      mixer.setSessionVisibility("hidden");
      mixer.prefetchScore("dusk");
      mixer.setTableMode(false);
    }).not.toThrow();
    expect(mixer.isMuted).toBe(true);
    expect(mixer.isMusicEnabled).toBe(false);
  });
});
