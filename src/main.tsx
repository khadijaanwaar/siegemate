import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import "./index.css";
import "./ui/fonts.css";

/**
 * Dev and test builds only: `?emulate` installs Meta's WebXR emulator (IWER)
 * as a Quest 3, so the mixed reality path runs without a headset. The branch
 * is dead code in production builds, and the emulator is never bundled there.
 */
async function installEmulator(): Promise<void> {
  if (!(import.meta.env.DEV || import.meta.env.MODE === "test")) return;
  if (!new URLSearchParams(window.location.search).has("emulate")) return;
  const { XRDevice, metaQuest3 } = await import("iwer");
  const device = new XRDevice(metaQuest3);
  // Desktop Chrome has a native navigator.xr that refuses immersive-ar: `?emulate` means replace it.
  device.installRuntime({ forceInstall: true });
  (window as unknown as { __iwer: typeof device }).__iwer = device;
}

/**
 * Board labels and rank crests are painted into textures with these faces at
 * boot; give them a moment to arrive so the first paint is not in a fallback
 * serif. Never wait long: a slow font must not hold the game.
 */
async function awaitFonts(): Promise<void> {
  if (!("fonts" in document)) return;
  // Cinzel paints the board labels and crests; Inter the headset panels.
  const faces = ["600 32px Cinzel", "700 32px Cinzel", "600 32px Inter"].map((face) => document.fonts.load(face));
  await Promise.race([Promise.allSettled(faces), new Promise((resolve) => setTimeout(resolve, 1500))]);
}

void Promise.all([installEmulator(), awaitFonts()]).finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
