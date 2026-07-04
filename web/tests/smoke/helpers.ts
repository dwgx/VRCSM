import type { Page } from "@playwright/test";

/**
 * Shared helpers for the real-browser UI smoke suite.
 *
 * The app runs on MOCK IPC in a plain browser (no WebView2 host). These helpers
 * port the proven logic from the jsdom harness
 * (src/__tests__/interaction-smoke.test.tsx): the sign-in flow via mock
 * auth.login, the "<main> has real content" poll, and the control-scoping rules
 * (scope to <main> + open Radix layers, never the persistent shell).
 */

// Real host window size (src/host/MainWindow.cpp) — the primary viewport and
// hard gate for the offset heuristics.
export const PRIMARY_VIEWPORT = { width: 1280, height: 820 } as const;

// Extra viewports captured for responsive review only (no hard gate).
export const REVIEW_VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 900, height: 800 },
] as const;

export interface ViewportSize {
  width: number;
  height: number;
}

// Full route matrix — mirrors the jsdom harness ROUTES (App.tsx <Route path=>).
export const ROUTES = [
  "/",
  "/bundles",
  "/library",
  "/avatars",
  "/models",
  "/worlds",
  "/friends",
  "/groups",
  "/profile",
  "/vrcplus",
  "/vrchat",
  "/screenshots",
  "/logs",
  "/radar",
  "/social",
  "/calendar",
  "/events",
  "/benchmark",
  "/fbt",
  "/friend-log",
  "/history/worlds",
  "/rules",
  "/settings",
  "/plugins",
  "/plugins/installed",
  "/tools/osc",
  "/tools/memory-radar",
] as const;

export function routeSlug(route: string): string {
  const s = route.replace(/^\/+|\/+$/g, "").replace(/[/?=&:]+/g, "_");
  return s.length ? s : "root";
}

export function viewportTag(vp: ViewportSize): string {
  return `${vp.width}x${vp.height}`;
}

/**
 * Install the smoke tap flag BEFORE the app boots, then navigate to the app.
 * addInitScript runs on every navigation/document, so window.__SMOKE_TAP__ is
 * set before ipc.ts's IpcClient singleton is constructed and before any call.
 */
export async function bootWithTap(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __SMOKE_TAP__?: boolean }).__SMOKE_TAP__ = true;
    (window as unknown as { __SMOKE_EVENTS__?: unknown[] }).__SMOKE_EVENTS__ = [];
  });
}

/**
 * Sign the mock IPC backend in. The mock starts signed-out (MOCK_SIGNED_OUT);
 * calling auth.login flips auth.status to authed on the next poll — auth-gated
 * routes (Friends, Profile, Groups, …) only mount their data-driven UI once
 * signed in.
 *
 * We reach the singleton IpcClient by dynamically importing the same
 * Vite-served module the app imports (`@/lib/ipc` → `/src/lib/ipc.ts`). Vite's
 * dev module graph dedupes by resolved URL, so this returns the exact same
 * `ipc` instance the running app uses — no production code touched.
 */
export async function ensureSignedIn(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const candidates = ["/src/lib/ipc.ts", "/src/lib/ipc"];
    let mod: { ipc?: { call: (m: string, p?: unknown) => Promise<unknown> } } | null = null;
    for (const url of candidates) {
      try {
        mod = await import(/* @vite-ignore */ url);
        if (mod?.ipc) break;
      } catch {
        /* try next */
      }
    }
    const ipc = mod?.ipc;
    if (!ipc) throw new Error("smoke: could not import ipc singleton in page context");
    const status = (await ipc.call("auth.status")) as { authed?: boolean };
    if (!status?.authed) {
      await ipc.call("auth.login", { username: "mock_user", password: "mock_pass" });
    }
  });
  // Wait for the polled auth.status to flip authed so gated routes will mount.
  await page.waitForFunction(
    async () => {
      // Indirect specifier so TS/Vite don't try to statically resolve the app
      // module path from the test's own module graph.
      const url = "/src/lib/ipc.ts";
      const mod = (await import(/* @vite-ignore */ url).catch(() => null)) as
        | { ipc?: { call: (m: string) => Promise<unknown> } }
        | null;
      if (!mod?.ipc) return false;
      const s = (await mod.ipc.call("auth.status")) as { authed?: boolean };
      return !!s?.authed;
    },
    null,
    { timeout: 10_000 },
  );
}

/**
 * Navigate to a route (HashRouter → `/#<route>`) and wait until <main> holds
 * real interactive content, not just the shell skeleton. Mirrors the jsdom
 * harness poll: the mock resolves async (~180ms) so a data-driven page shows a
 * skeleton on first paint; enumerating then would find zero controls.
 */
export async function gotoRoute(page: Page, route: string): Promise<void> {
  await page.goto(`/#${route}`, { waitUntil: "domcontentloaded" });
  // Ensure the SPA actually processes the hash change (goto to same document
  // with only a hash change does not always reload).
  await page.evaluate((r) => {
    if (window.location.hash !== `#${r}`) window.location.hash = `#${r}`;
  }, route);
  await page.waitForSelector("main", { timeout: 15_000 });
  await page
    .waitForFunction(
      () => {
        const main = document.querySelector("main");
        if (!main) return false;
        return (
          main.querySelector(
            'button:not([disabled]),[role="tab"],[role="switch"],a[href],summary,input,select,textarea',
          ) !== null
        );
      },
      null,
      { timeout: 8_000 },
    )
    .catch(() => {
      /* Some routes legitimately render an empty/quiet state — proceed and let
         the offset + console-error gates judge them rather than hard-failing
         on "no controls". */
    });
  // Settle window for late effects (skeleton → data swap).
  await page.waitForTimeout(250);
}

// ── Offset / layout heuristics ─────────────────────────────────────────────

export interface OffsetProblem {
  kind:
    | "horizontal-overflow"
    | "out-of-viewport"
    | "content-under-header"
    | "zero-size"
    | "offscreen-layer";
  severity: "high" | "low";
  detail: string;
  selector?: string;
  rect?: { top: number; left: number; right: number; bottom: number; width: number; height: number };
}

export interface OffsetReport {
  route: string;
  viewport: ViewportSize;
  problems: OffsetProblem[];
  // Numeric summary (numbers, not booleans) per the spec.
  counts: {
    horizontalOverflow: number;
    outOfViewport: number;
    contentUnderHeader: number;
    zeroSize: number;
    offscreenLayer: number;
    high: number;
    low: number;
  };
  docScrollWidth: number;
  viewportWidth: number;
}

/**
 * Run the offset heuristics in-page and return structured, numeric findings.
 * All checks return counts, never booleans. High-severity findings are the
 * hard gate at 1280x820; low-severity are advisory.
 */
export async function runOffsetHeuristics(
  page: Page,
  route: string,
  viewport: ViewportSize,
): Promise<OffsetReport> {
  const problems = await page.evaluate((vp: ViewportSize) => {
    const out: Array<{
      kind: string;
      severity: string;
      detail: string;
      selector?: string;
      rect?: { top: number; left: number; right: number; bottom: number; width: number; height: number };
    }> = [];

    const describe = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : "";
      const cls =
        typeof (el as HTMLElement).className === "string" && (el as HTMLElement).className
          ? "." + (el as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join(".")
          : "";
      return `${tag}${id}${cls}`.slice(0, 80);
    };

    const isVisible = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      return true;
    };

    // (a) document/body horizontal overflow.
    const docSW = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    if (docSW > vp.width + 2) {
      out.push({
        kind: "horizontal-overflow",
        severity: "high",
        detail: `document scrollWidth ${docSW} > viewport width ${vp.width}`,
      });
    }

    // Determine header height for the content-under-header check. TitleBar is
    // the top <header>; compute its bottom edge.
    const header = document.querySelector("header");
    const headerRect = header?.getBoundingClientRect();
    const headerBottom = headerRect ? headerRect.bottom : 0;

    // (c) main content top under the fixed header.
    const main = document.querySelector("main");
    if (main && headerBottom > 0) {
      const mr = main.getBoundingClientRect();
      // Only a problem if main visibly starts ABOVE the header bottom (i.e.
      // the header overlaps the content region). Allow a 2px tolerance.
      if (mr.top < headerBottom - 2 && mr.height > 0) {
        out.push({
          kind: "content-under-header",
          severity: "high",
          detail: `main top ${Math.round(mr.top)} is above header bottom ${Math.round(headerBottom)}`,
          selector: "main",
          rect: { top: mr.top, left: mr.left, right: mr.right, bottom: mr.bottom, width: mr.width, height: mr.height },
        });
      }
    }

    // Scope element-level checks to <main> + open layers to avoid flagging
    // intentionally off-canvas shell chrome (drawers, toasts parked off-screen).
    const roots: Element[] = [];
    if (main) roots.push(main);
    document
      .querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]')
      .forEach((el) => roots.push(el));

    const seen = new Set<Element>();
    for (const root of roots) {
      const all = [root, ...Array.from(root.querySelectorAll("*"))];
      for (const el of all) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (!isVisible(el)) continue;
        const r = el.getBoundingClientRect();
        // Ignore elements with no layout box at all (r.width===0 && height===0
        // handled by zero-size below only when it "should" have size).
        const rectObj = { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };

        // (b) out of viewport — only flag elements that actually have size,
        // otherwise every collapsed helper span trips it.
        if (r.width > 0 && r.height > 0) {
          if (r.right > vp.width + 2) {
            out.push({
              kind: "out-of-viewport",
              severity: "high",
              detail: `right edge ${Math.round(r.right)} exceeds viewport width ${vp.width}`,
              selector: describe(el),
              rect: rectObj,
            });
          } else if (r.left < -2) {
            out.push({
              kind: "out-of-viewport",
              severity: "high",
              detail: `left edge ${Math.round(r.left)} < 0`,
              selector: describe(el),
              rect: rectObj,
            });
          }
        }

        // (d) zero/NaN-size elements that should have a box. Restrict to
        // "leaf" interactive/media controls that are visible in the flow but
        // collapsed — a real symptom of a broken layout. Low severity: some
        // controls legitimately render empty (icon-only w/ CSS bg, etc.).
        const tag = el.tagName.toLowerCase();
        const shouldHaveSize =
          tag === "button" ||
          tag === "img" ||
          (el.getAttribute("role") === "button" && (el.textContent ?? "").trim().length > 0);
        if (shouldHaveSize && isVisible(el)) {
          const zero = r.width === 0 || r.height === 0 || Number.isNaN(r.width) || Number.isNaN(r.height);
          // A button with text content that collapses to 0 is suspect.
          const hasText = (el.textContent ?? "").trim().length > 0;
          if (zero && (tag === "img" || hasText)) {
            out.push({
              kind: "zero-size",
              severity: "low",
              detail: `${tag} has zero/NaN size (${r.width}x${r.height}) but should render a box`,
              selector: describe(el),
              rect: rectObj,
            });
          }
        }
      }
    }

    // (e) open dialogs/popovers positioned off-screen. High severity: an open
    // layer the user can't see is a real bug.
    document
      .querySelectorAll('[role="dialog"],[data-radix-popper-content-wrapper],[role="menu"]:not([hidden])')
      .forEach((layer) => {
        if (!isVisible(layer)) return;
        const r = layer.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return; // not actually laid out / closed
        const fullyRight = r.left >= vp.width;
        const fullyLeft = r.right <= 0;
        const fullyBelow = r.top >= vp.height;
        const fullyAbove = r.bottom <= 0;
        if (fullyRight || fullyLeft || fullyBelow || fullyAbove) {
          out.push({
            kind: "offscreen-layer",
            severity: "high",
            detail: `open layer rendered fully off-screen (rect ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}; viewport ${vp.width}x${vp.height})`,
            selector: describe(layer),
            rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
          });
        }
      });

    return out;
  }, viewport);

  const docScrollWidth = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
  );

  const typed = problems as OffsetProblem[];
  const counts = {
    horizontalOverflow: typed.filter((p) => p.kind === "horizontal-overflow").length,
    outOfViewport: typed.filter((p) => p.kind === "out-of-viewport").length,
    contentUnderHeader: typed.filter((p) => p.kind === "content-under-header").length,
    zeroSize: typed.filter((p) => p.kind === "zero-size").length,
    offscreenLayer: typed.filter((p) => p.kind === "offscreen-layer").length,
    high: typed.filter((p) => p.severity === "high").length,
    low: typed.filter((p) => p.severity === "low").length,
  };

  return {
    route,
    viewport,
    problems: typed,
    counts,
    docScrollWidth,
    viewportWidth: viewport.width,
  };
}

// ── Interactive element collector (ported scoping) ──────────────────────────

/**
 * Count the scoped, clickable interactive elements currently in the DOM.
 * Scope = <main> + open Radix layers, NOT the persistent shell nav (which would
 * exhaust the click budget on chrome). Returns a count for reporting; the
 * click-through in interaction.spec re-queries handles live in the page.
 */
export async function countInteractive(page: Page): Promise<number> {
  return page.evaluate(() => {
    const roots: Element[] = [];
    const main = document.querySelector("main");
    if (main) roots.push(main);
    document
      .querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]')
      .forEach((el) => roots.push(el));
    if (roots.length === 0) roots.push(document.body);
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
    const seen = new Set<Element>();
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll(sel))) {
        if (el.tagName === "A") {
          const href = el.getAttribute("href") ?? "";
          if (/^https?:/i.test(href)) continue;
        }
        seen.add(el);
      }
    }
    return seen.size;
  });
}

export interface SmokeIpcEvent {
  method: string;
  params: unknown;
  ok: boolean;
  error?: string;
  isMock: boolean;
  unimplemented: boolean;
  ts: number;
}

/** Read back the tap events accumulated on window.__SMOKE_EVENTS__. */
export async function readSmokeEvents(page: Page): Promise<SmokeIpcEvent[]> {
  return page.evaluate(
    () => ((window as unknown as { __SMOKE_EVENTS__?: SmokeIpcEvent[] }).__SMOKE_EVENTS__ ?? []) as SmokeIpcEvent[],
  );
}

/** Clear the tap event sink (call between routes to scope events per-route). */
export async function clearSmokeEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __SMOKE_EVENTS__?: SmokeIpcEvent[] }).__SMOKE_EVENTS__ = [];
  });
}



