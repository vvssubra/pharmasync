import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";


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
    VitePWA({
      // "prompt", never "autoUpdate": a pharmacist must not be reloaded out from
      // under a half-filled antibiotic form. skipWaiting/clientsClaim stay off
      // for the same reason — the new worker only takes over when the user
      // accepts the toast in src/components/PwaUpdatePrompt.tsx.
      registerType: "prompt",
      // No registerSW.js asset is emitted; registration is bundled into the
      // content-hashed entry chunk instead, which is one fewer un-hashed file for
      // nginx to cache wrongly.
      injectRegister: null,
      manifest: {
        id: "/",
        name: "PharmaSync — Klinik Kesihatan Kempas",
        short_name: "PharmaSync",
        description:
          "Digital Bin Card System for Klinik Kesihatan Kempas pharmacy inventory management.",
        // "/" is deliberate and role-aware: RoleRedirect in src/App.tsx sends fms
        // to /fms, mo to /mo, and everyone else to the dashboard. Do not "improve"
        // this to a concrete route.
        start_url: "/",
        scope: "/",
        display: "standalone",
        // Not portrait-locked: the KEW.PS-3 stock card is 16 columns and is
        // materially more usable in landscape.
        orientation: "any",
        theme_color: "#0f6148",
        // Matches --background, hsl(150 24% 98%) in src/index.css.
        background_color: "#f9fbfa",
        lang: "en-MY",
        dir: "ltr",
        categories: ["medical", "productivity", "business"],
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
        // Install shell only. Supabase is a different origin and no route matches
        // it, so every data request goes straight to the network.
        //
        // Do not add a runtime cache here. This app reports live stock levels and
        // controlled-drug quota balances; serving either from a cache would show a
        // pharmacist a number that is no longer true, with no indication it is
        // stale. Offline must fail visibly instead.
        runtimeCaching: [],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
      },
      // If a bad worker ever ships, set this to true and release once: it emits a
      // worker that unregisters itself and clears its caches. Reverting the PWA
      // commit alone does not help — the old worker stays live on every device
      // that already installed it.
      selfDestroying: false,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
