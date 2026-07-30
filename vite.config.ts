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
      // Custom worker (src/sw.ts) instead of a generated one — generateSW cannot
      // host the Web Push handlers. src/sw.ts reproduces everything the
      // generated worker did (precache, SPA fallback, prompt updates, no runtime
      // caching) and documents the invariants; read it before changing strategy.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
      },
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
      // The former `workbox:` generateSW options (runtimeCaching: [] — never
      // cache Supabase; navigateFallback; cleanupOutdatedCaches; no
      // skipWaiting/clientsClaim) now live as code in src/sw.ts.
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
