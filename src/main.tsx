import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import "./index.css";

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

void installEmulator().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
