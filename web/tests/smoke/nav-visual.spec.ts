import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  ROUTES,
  PRIMARY_VIEWPORT,
  REVIEW_VIEWPORTS,
  routeSlug,
  viewportTag,
  bootWithTap,
  ensureSignedIn,
  gotoRoute,
  runOffsetHeuristics,
  readSmokeEvents,
  type OffsetReport,
  type ViewportSize,
  type SmokeIpcEvent,
} from "./helpers";
import { comparePixels, type PixelDiffEntry } from "./pixeldiff";
import { ARTIFACTS, ensureArtifactDirs, writePartial } from "./artifacts";

/**
 * nav-visual.spec — for every route (signed in): goto, wait, run offset
 * heuristics, screenshot (full-page + viewport) at every viewport, and gate on:
 *   - no console.error
 *   - no unhandled rejection
 *   - no ipc event with unimplemented=true
 *   - ZERO high-severity offset problems (HARD gate, 1280x820 only)
 * Screenshots at 1024x768 / 900x800 are captured for review (no hard gate).
 *
 * Each test writes a partial under .artifacts/partials/; global-teardown merges
 * them into offset-report.json, events.json, manifest.json, pixeldiff-report.json.
 * (Module-level accumulators are unreliable — Playwright recycles the worker on
 * failure.) Baselines are committed under tests/smoke/__screenshots__/.
 */

const SHOTS = path.join(ARTIFACTS, "screenshots");
const DIFFS = path.join(ARTIFACTS, "diffs");
const BASELINES = path.join(import.meta.dirname, "__screenshots__");

interface ManifestEntry {
  route: string;
  state: string;
  viewport: string;
  path: string;
}

test.beforeAll(() => {
  ensureArtifactDirs();
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(DIFFS, { recursive: true });
  fs.mkdirSync(BASELINES, { recursive: true });
});

async function captureViewport(
  page: import("@playwright/test").Page,
  route: string,
  vp: ViewportSize,
  sink: { offsets: OffsetReport[]; manifest: ManifestEntry[]; pixeldiffs: PixelDiffEntry[] },
  updateBaselines: boolean,
): Promise<{ high: number }> {
  const slug = routeSlug(route);
  const tag = viewportTag(vp);

  await page.setViewportSize(vp);
  await gotoRoute(page, route);

  // Offset heuristics.
  const report = await runOffsetHeuristics(page, route, vp);
  sink.offsets.push(report);

  // Screenshots: viewport-only + full-page.
  const viewportShot = path.join(SHOTS, `${slug}@${tag}.png`);
  const fullShot = path.join(SHOTS, `${slug}@${tag}-full.png`);
  await page.screenshot({ path: viewportShot, fullPage: false });
  await page.screenshot({ path: fullShot, fullPage: true });
  sink.manifest.push(
    { route, state: "viewport", viewport: tag, path: path.relative(ARTIFACTS, viewportShot) },
    { route, state: "full", viewport: tag, path: path.relative(ARTIFACTS, fullShot) },
  );

  // Soft pixel diff on the viewport screenshot (report-only, never a gate).
  sink.pixeldiffs.push(
    comparePixels({
      name: `${slug}@${tag}`,
      actualPath: viewportShot,
      baselineDir: BASELINES,
      diffDir: DIFFS,
      update: updateBaselines,
    }),
  );

  return { high: report.counts.high };
}

test.describe("nav-visual — every route renders on-screen at the host viewport", () => {
  for (const route of ROUTES) {
    test(`${route} @ ${viewportTag(PRIMARY_VIEWPORT)} has no offset/console/dead-ipc problems`, async ({
      page,
    }) => {
      const consoleErrors: string[] = [];
      const rejections: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => rejections.push(String(err)));

      const sink = {
        offsets: [] as OffsetReport[],
        manifest: [] as ManifestEntry[],
        pixeldiffs: [] as PixelDiffEntry[],
      };
      let events: SmokeIpcEvent[] = [];

      // `test:ui-smoke:update` → --update-snapshots → refresh baselines.
      const updateBaselines = test.info().config.updateSnapshots !== "missing" &&
        test.info().config.updateSnapshots !== "none";

      await bootWithTap(page);
      await ensureSignedIn(page);

      // Primary viewport = the hard gate.
      const { high } = await captureViewport(page, route, PRIMARY_VIEWPORT, sink, updateBaselines);

      // Review-only viewports: capture screenshots + offsets, NO hard gate.
      for (const vp of REVIEW_VIEWPORTS) {
        await captureViewport(page, route, vp, sink, updateBaselines);
      }

      // Collect the tap events for this route.
      events = await readSmokeEvents(page);
      const unimplemented = events.filter((e) => e.unimplemented).map((e) => e.method);

      // Persist this route's partial BEFORE asserting, so a failure still
      // records the route (Playwright recycles the worker on failure).
      writePartial("nav", routeSlug(route), {
        route,
        offsets: sink.offsets,
        events,
        manifest: sink.manifest,
        pixeldiffs: sink.pixeldiffs,
      });

      // Filter console errors down to real app errors — ignore known dev noise
      // (WebGL in headless, favicon, resource 404s from external CDNs the mock
      // points at). These are environmental, not app render bugs.
      const realConsoleErrors = consoleErrors.filter((t) => {
        return !(
          t.includes("THREE.WebGLRenderer") ||
          t.includes("WebGL") ||
          t.includes("Failed to load resource") ||
          t.includes("net::ERR") ||
          t.includes("favicon") ||
          t.includes("picsum.photos") ||
          t.includes("example.invalid") ||
          t.includes("[vite]") ||
          t.includes("Download the React DevTools")
        );
      });

      // ── Assertions ──
      // 1. No unhandled rejection.
      expect(rejections, `unhandled rejections on ${route}:\n${rejections.join("\n")}`).toEqual([]);
      // 2. No real console.error.
      expect(
        realConsoleErrors,
        `console.error on ${route}:\n${realConsoleErrors.join("\n")}`,
      ).toEqual([]);
      // 3. No dead interaction (mock-unimplemented ipc) surfaced during load.
      expect(
        unimplemented,
        `unimplemented ipc methods hit on ${route}: ${unimplemented.join(", ")}`,
      ).toEqual([]);
      // 4. HARD GATE: zero high-severity offset problems at 1280x820.
      const primaryReport = sink.offsets.find(
        (r) => r.viewport.width === PRIMARY_VIEWPORT.width,
      );
      const highProblems = primaryReport?.problems.filter((p) => p.severity === "high") ?? [];
      expect(
        high,
        `high-severity offset problems on ${route} @ 1280x820:\n` +
          highProblems.map((p) => `  [${p.kind}] ${p.selector ?? ""} ${p.detail}`).join("\n"),
      ).toBe(0);
    });
  }
});
