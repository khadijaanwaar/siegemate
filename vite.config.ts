import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    // Offline play: the first visit installs a service worker that precaches
    // the whole game (code, the search worker, fonts, every army and
    // battleground), so after that it plays in airplane mode, in the browser
    // and in the installed Quest app.
    VitePWA({
      // Registered from src/main.tsx: a new deploy is applied at once at the
      // menu, and held while a match is being played (src/app/updateGate.ts).
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "Siegemate",
        short_name: "Siegemate",
        description: "Mixed reality chess: living armies fight on your real table. Play the computer, even offline.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#15171c",
        theme_color: "#15171c",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,png,webp,svg,glb,mp3,txt,webmanifest}"],
        // Share card, the 2.5 MB source icon and the placeholder are never needed offline.
        globIgnores: ["banner.jpg", "icon.png", "placeholder.svg", "robots.txt"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    // Hashed code goes under /build (cached forever); /assets is the
    // self-hosted media, whose names are stable and must stay revalidated.
    assetsDir: "build",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Expose both VITE_* (Vite default) and EXPO_PUBLIC_* (Rork's cross-platform
  // public-env convention, written by tools like getOrCreateAuthConfig).
  envPrefix: ["VITE_", "EXPO_PUBLIC_"],
}));
