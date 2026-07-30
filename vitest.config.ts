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
