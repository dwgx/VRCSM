import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest-setup.ts",
    // Vitest owns the unit/component tests under src/. The Playwright UI-smoke
    // specs live in tests/smoke/*.spec.ts and must NOT be collected here — they
    // use the Playwright runner (pnpm test:ui-smoke), and vitest chokes on their
    // test.beforeAll(). Scope include to src and exclude the Playwright dir.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/**", "node_modules/**", "dist/**"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
