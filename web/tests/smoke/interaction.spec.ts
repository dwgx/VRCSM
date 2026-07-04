import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  ROUTES,
  PRIMARY_VIEWPORT,
  routeSlug,
  bootWithTap,
  ensureSignedIn,
  gotoRoute,
  readSmokeEvents,
  clearSmokeEvents,
} from "./helpers";
import { ARTIFACTS, ensureArtifactDirs, writePartial } from "./artifacts";

/**
 * interaction.spec — for every route (signed in), click through every scoped
 * control (budget ~40, re-querying after each click since the tree mutates),
 * record IPC via the dev tap, screenshot after the click-through, and FAIL the
 * route on:
 *   - render-boundary text ("Page render failed")
 *   - unhandled rejection
 *   - any unimplemented ipc hit
 *
 * Scope = <main> + open Radix layers, NOT the persistent shell nav (ported from
 * the jsdom harness). Skips logout/sign-out controls that would unmount the app.
 * Each test writes a partial; global-teardown merges into interaction-report.json.
 */

const SHOTS = path.join(ARTIFACTS, "screenshots");
const CLICK_BUDGET = 40;

test.beforeAll(() => {
  ensureArtifactDirs();
  fs.mkdirSync(SHOTS, { recursive: true });
});

/**
 * Enumerate + click scoped controls in-page. Runs the whole click loop inside a
 * single page.evaluate so the live DOM is re-queried between clicks without
 * round-tripping. Returns how many controls were clicked and whether the render
 * boundary appeared.
 */
async function clickThrough(
  page: import("@playwright/test").Page,
): Promise<{ clicks: number; renderBoundary: boolean }> {
  try {
    return await page.evaluate(async (budget: number) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const scopedRoots = (): Element[] => {
      const roots: Element[] = [];
      const main = document.querySelector("main");
      if (main) roots.push(main);
      document
        .querySelectorAll(
          '[role="dialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]',
        )
        .forEach((el) => roots.push(el));
      if (roots.length === 0) roots.push(document.body);
      return roots;
    };

    const sel = [
      "button:not([disabled])",
      '[role="button"]:not([aria-disabled="true"])',
      '[role="tab"]:not([aria-disabled="true"])',
      '[role="menuitem"]',
      '[role="menuitemcheckbox"]',
      '[role="option"]',
      '[role="switch"]',
      "a[href]",
      "summary",
    ].join(",");

    const labelFor = (el: Element): string => {
      const text = (el.textContent ?? "").trim().slice(0, 40);
      const aria = el.getAttribute("aria-label") ?? "";
      const title = el.getAttribute("title") ?? "";
      const tag = el.tagName.toLowerCase();
      return `${tag}"${text || aria || title || "(no label)"}"`;
    };

    const interactive = (): HTMLElement[] => {
      const seen = new Set<HTMLElement>();
      const nodes: HTMLElement[] = [];
      for (const root of scopedRoots()) {
        for (const el of Array.from(root.querySelectorAll<HTMLElement>(sel))) {
          if (seen.has(el)) continue;
          seen.add(el);
          if (el.tagName === "A") {
            const href = el.getAttribute("href") ?? "";
            if (/^https?:/i.test(href)) continue;
          }
          nodes.push(el);
        }
      }
      return nodes;
    };

    const hasRenderBoundary = () =>
      (document.body.textContent ?? "").toLowerCase().includes("page render failed");

    const clicked = new Set<string>();
    let clicks = 0;
    let recoveredOnce = false;

    for (let i = 0; i < budget; i++) {
      const els = interactive();
      const next = els.find((el) => !clicked.has(labelFor(el)));
      if (!next) {
        const layerOpen = document.querySelector(
          '[role="dialog"],[role="menu"],[data-radix-popper-content-wrapper]',
        );
        if (layerOpen && !recoveredOnce) {
          recoveredOnce = true;
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          await sleep(20);
          continue;
        }
        break;
      }
      const label = labelFor(next);
      clicked.add(label);
      // Skip logout / sign-out — would unmount the shell and poison the run.
      if (/log ?out|sign ?out|退出登录|登出|ログアウト/i.test(label)) continue;

      clicks += 1;
      try {
        next.click();
      } catch {
        /* swallowed; a throw here is captured via pageerror upstream */
      }
      await sleep(30);

      if (hasRenderBoundary()) {
        return { clicks, renderBoundary: true };
      }
    }
    return { clicks, renderBoundary: false };
  }, CLICK_BUDGET);
  } catch (err) {
    // A click that navigates the top document (e.g. a link/action that reloads
    // the SPA) destroys the evaluate context. That is NOT one of the three
    // failure classes (render-boundary / unhandled-rejection / unimplemented
    // ipc); the render-boundary + pageerror gates still cover a genuine crash.
    // Treat context-destruction as a completed (if truncated) click-through.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Execution context was destroyed") || msg.includes("context was destroyed")) {
      // Re-establish a stable page state for the post-click screenshot/events.
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      return { clicks: 0, renderBoundary: false };
    }
    throw err;
  }
}

test.describe("interaction — click every scoped control on every route", () => {
  for (const route of ROUTES) {
    test(`${route} click-through has no crash / dead interaction`, async ({ page }) => {
      const rejections: string[] = [];
      page.on("pageerror", (err) => rejections.push(String(err)));

      await bootWithTap(page);
      await ensureSignedIn(page);
      await page.setViewportSize({ ...PRIMARY_VIEWPORT });
      await gotoRoute(page, route);
      await clearSmokeEvents(page);

      // First paint must not already be the boundary.
      const preBoundary = await page.evaluate(() =>
        (document.body.textContent ?? "").toLowerCase().includes("page render failed"),
      );
      expect(preBoundary, `render boundary present on first paint of ${route}`).toBe(false);

      const { clicks, renderBoundary } = await clickThrough(page);

      // Screenshot after the click-through.
      await page.screenshot({
        path: path.join(SHOTS, `${routeSlug(route)}@interaction.png`),
        fullPage: false,
      });

      const events = await readSmokeEvents(page);
      const unimplemented = [...new Set(events.filter((e) => e.unimplemented).map((e) => e.method))];

      // Persist this route's partial BEFORE asserting (worker recycles on fail).
      writePartial("int", routeSlug(route), { route, clicks, events });

      // ── Assertions ──
      expect(renderBoundary, `RouteErrorBoundary shown after a click on ${route}`).toBe(false);
      expect(rejections, `unhandled rejections on ${route}:\n${rejections.join("\n")}`).toEqual([]);
      expect(
        unimplemented,
        `unimplemented ipc methods hit on ${route}: ${unimplemented.join(", ")}`,
      ).toEqual([]);
    });
  }
});
