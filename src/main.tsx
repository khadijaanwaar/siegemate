import { createRoot } from "react-dom/client";

import { registerSW } from "virtual:pwa-register";

import App from "./App.tsx";
import { whenIdle } from "./app/updateGate";
import { BUILD_ID } from "./brand";
import { GAME_READY_EVENT } from "./scene/sceneEngine";
import "./index.css";
import "./ui/fonts.css";

console.info(`[siegemate] build ${BUILD_ID}`);
(window as unknown as { __siegemateBuild: string }).__siegemateBuild = BUILD_ID;

/**
 * Offline cache and updates. A newer version found on the server is applied
 * straight away (the page reloads into it) unless a match is in progress, in
 * which case it waits for the match to end. The server is asked for a newer
 * version on every launch and hourly while the game stays open.
 */
function registerOffline(): void {
  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      whenIdle(() => void updateServiceWorker(true));
    },
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });
}

/**
 * The first visit has no cache: the worker's precache (the whole game) would
 * race the game's own first download, and on a headset that is the wait before
 * "Play on your table" appears. So it is registered once the board stands and
 * the main thread is idle, or after 30 s whatever happens. A returning visit
 * registers at once: the browser is already checking for a newer worker, and
 * registering late could miss that one installing.
 */
function afterGameReady(run: () => void): void {
  let started = false;
  const start = (): void => {
    if (started) return;
    started = true;
    if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 500);
  };
  window.addEventListener(GAME_READY_EVENT, start, { once: true });
  setTimeout(start, 30000);
}

if ("serviceWorker" in navigator && navigator.serviceWorker.controller) registerOffline();
else afterGameReady(registerOffline);

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
