import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // The heavier page tests (jsdom + Radix + userEvent) drift past Vitest's 5s
    // default once the suite's files run in parallel and contend for CPU,
    // producing failures that move between runs rather than pointing at real
    // bugs. The worst offenders are Survey's submit tests, which click through
    // 13 Likert questions: ~5s alone, ~20s under full-suite contention. 30s
    // clears that with headroom while staying far below anything a genuinely
    // hung test would reach.
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // virtual:pwa-register/react is created by vite-plugin-pwa in
      // vite.config.ts, which this config does not load — so it has to be
      // stubbed or every test that reaches App.tsx fails to resolve the import.
      "virtual:pwa-register/react": path.resolve(__dirname, "./src/test/pwa-register-stub.ts"),
    },
  },
});
