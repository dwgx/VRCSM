import { defineConfig, devices } from "@playwright/test";

/**
 * Real-browser UI smoke layer for the VRCSM React SPA.
 *
 * The app auto-enables MOCK IPC in a plain browser (ipc.ts: `this.bridge =
 * window.chrome?.webview ?? null` → null → mockCall), so `vite dev` in headless
 * chromium runs the whole app on mock data with NO WebView2 host needed.
 *
 * PRIMARY viewport = 1280x820, the real host window size
 * (src/host/MainWindow.cpp) — this is the hard gate for the offset heuristics.
 * Responsive screenshots at 1024x768 / 900x800 are captured for review only
 * (no hard gate) inside the specs themselves.
 */
export default defineConfig({
  testDir: "tests/smoke",
  // Merge per-test artifact partials into the consolidated reports after the
  // whole run — robust to worker recycling on failure.
  globalTeardown: "./tests/smoke/global-teardown.ts",
  // Determinism over speed: one worker, no parallelism, no retries. A flaky
  // offset finding should surface as a real failure, not be masked by a retry.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never", outputFolder: "tests/smoke/.artifacts/playwright-report" }]],
  outputDir: "tests/smoke/.artifacts/test-results",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:5173",
    // The cached build is chromium v1223; use the bundled browser (no channel)
    // so we hit the already-downloaded ms-playwright/chromium-1223.
    ...devices["Desktop Chrome"],
    channel: undefined,
    // PRIMARY viewport = the real host window size (spread after Desktop Chrome
    // so it wins).
    viewport: { width: 1280, height: 820 },
    screenshot: "off",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-1280x820",
      use: { viewport: { width: 1280, height: 820 } },
    },
  ],
  webServer: {
    // Use npx to launch the locally-installed vite binary — robust whether or
    // not pnpm is on PATH in the spawned shell. reuseExistingServer means a
    // dev server already on 5173 is reused instead of spawning a second one.
    command: "npx vite --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
