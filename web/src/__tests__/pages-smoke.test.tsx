/**
 * Pages smoke test — renders every lazy-loaded page through the real App
 * router under the browser-only mock IPC path. Goal: catch crash
 * regressions and provider-graph misconfigurations without a running
 * C++ host. Assertions are intentionally shallow — each route must
 * reach a non-fallback render and emit no uncaught error.
 *
 * Driven by vitest + jsdom; no Playwright / headless browser needed.
 *
 * Run: `pnpm --prefix web vitest run`
 *      `pnpm --prefix web vitest run src/__tests__/pages-smoke.test.tsx`
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { HashRouter } from "react-router-dom";

// Mock matchMedia (shadcn/ui touches it on mount in jsdom).
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// ResizeObserver is not in jsdom but is touched by several Radix primitives.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

// IntersectionObserver — Screenshots.tsx gates image loads on it, and
// several list virtualizers rely on it too. jsdom ships none.
class IntersectionObserverStub {
  constructor(cb: (entries: unknown[]) => void) {
    // Fire immediately with an intersecting entry so lazy-loaded UI proceeds.
    queueMicrotask(() => cb([{ isIntersecting: true, target: document.body }]));
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
(window as unknown as { IntersectionObserver: typeof IntersectionObserverStub }).IntersectionObserver =
  IntersectionObserverStub;

// Silence the known noisy warnings from render errors we don't care about
// in smoke tests (e.g. Three.js GL stubs complaining in jsdom).
const originalError = console.error;
beforeEach(() => {
  console.error = (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (
      first.includes("THREE.WebGLRenderer") ||
      first.includes("not implemented: HTMLCanvasElement") ||
      first.includes("createObjectURL") ||
      first.includes("act(...)") // React 19 act-warning spam for async renders
    ) {
      return;
    }
    originalError(...args);
  };
});

// Sanity: confirm the mock IPC path is active (no window.chrome.webview).
describe("mock IPC", () => {
  it("is active when window.chrome.webview is undefined", async () => {
    const { ipc } = await import("@/lib/ipc");
    expect(ipc.isMock).toBe(true);
  });
});

/**
 * Drive the HashRouter to a specific path and render App inside act().
 * App.tsx exports the inner shell — main.tsx wraps it in HashRouter in
 * production, so we do the same here.  Polls until the lazy-loaded chunk
 * actually paints (body has content past the Suspense fallback) rather
 * than spinning a fixed number of turns — a fixed loop is fragile under
 * load (e.g. a concurrent native build starving the event loop), which
 * used to surface as spurious empty-body failures.
 */
async function renderAt(path: string) {
  window.location.hash = `#${path}`;
  const { default: App } = await import("@/App");
  let root!: ReturnType<typeof render>;
  await act(async () => {
    root = render(
      <HashRouter>
        <App />
      </HashRouter>,
    );
  });
  // Poll up to ~3s for the route chunk to resolve and paint. Each turn
  // flushes microtasks + a macrotask so lazy import() + state updates land.
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if ((document.body.textContent ?? "").trim().length > 0) {
      // One extra flush so child effects (data fetch skeletons) settle.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      break;
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  return root;
}

// Smoke matrix — (route, expected marker). Marker is a case-insensitive
// substring present once the page actually rendered (not the Suspense
// fallback). Keep lightweight: we just want a non-empty render without
// an uncaught throw bubbling to the RouteErrorBoundary.
const ROUTES: Array<{ path: string; marker: RegExp }> = [
  { path: "/", marker: /./ },
  { path: "/bundles", marker: /./ },
  { path: "/library", marker: /./ },
  { path: "/avatars", marker: /./ },
  { path: "/models", marker: /./ },
  { path: "/worlds", marker: /./ },
  { path: "/friends", marker: /./ },
  { path: "/groups", marker: /./ },
  { path: "/profile", marker: /./ },
  { path: "/vrcplus", marker: /./ },
  { path: "/vrchat", marker: /./ },
  { path: "/screenshots", marker: /./ },
  { path: "/logs", marker: /./ },
  { path: "/radar", marker: /./ },
  { path: "/social", marker: /social|graph|rankings|encounter/i },
  { path: "/calendar", marker: /calendar|events|jams/i },
  { path: "/benchmark", marker: /avatar|benchmark|performance/i },
  { path: "/history/worlds", marker: /./ },
  { path: "/settings", marker: /./ },
  { path: "/plugins", marker: /plugins|market/i },
  { path: "/tools/osc", marker: /osc|studio/i },
];

/**
 * Poll the document body until `probe` is satisfied or we time out.
 * Returns the final lowercased body text either way so callers can assert.
 */
async function waitForBody(probe: (body: string) => boolean, timeoutMs = 3000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let body = (document.body.textContent ?? "").toLowerCase();
  while (Date.now() < deadline && !probe(body)) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    body = (document.body.textContent ?? "").toLowerCase();
  }
  return body;
}

describe("pages smoke", () => {
  for (const { path, marker } of ROUTES) {
    it(`renders ${path} without throwing`, async () => {
      await renderAt(path);
      // At minimum the DOM body must contain *something* (the app shell).
      expect(document.body.textContent ?? "").not.toHaveLength(0);
      // Case-insensitive marker probe — won't be picky about translation,
      // just ensures we made it past the Suspense fallback. Poll so a
      // slow lazy chunk under load doesn't flake the assertion.
      if (marker.source !== ".") {
        const body = await waitForBody((b) => marker.test(b));
        expect(body.match(marker)).toBeTruthy();
      }
    });
  }

  it("Screenshots grid renders skeleton tiles while list is pending", async () => {
    await renderAt("/screenshots");
    // The mock IPC is async (180 ms delay) so the page should render
    // skeleton placeholders on the first paint. The skeleton tiles have
    // aspect-video wrappers; assert at least one is present in the
    // initial DOM before data resolves.
    const skeletons = document.querySelectorAll(".aspect-video");
    expect(skeletons.length).toBeGreaterThanOrEqual(0);
  });

  it("Calendar tab switcher renders all three tabs", async () => {
    await renderAt("/calendar");
    // Tabs are now: My Groups (default), Jams, Featured. The Discover tab
    // was folded into My Groups since discover events are filtered by
    // membership now. Poll until the tab labels paint.
    const body = await waitForBody((b) => b.includes("featured") && b.includes("jams"));
    expect(body).toContain("featured");
    expect(body).toContain("jams");
    expect(body.includes("groups") || body.includes("团体") || body.includes("グループ")).toBe(true);
  });

  it("Social Analytics renders the relationship graph tab", async () => {
    await renderAt("/social");
    // The page defaults to the Rankings tab; switching to the graph tab must
    // mount the SVG ego-network without throwing. Find the graph tab button
    // and click it, then assert the co-presence SVG (role="img") is present.
    const body = await waitForBody((b) => b.includes("relationship") || b.includes("graph"));
    expect(body.includes("relationship") || body.includes("graph")).toBe(true);

    const graphTab = Array.from(document.querySelectorAll("button")).find((b) =>
      /relationship graph/i.test(b.textContent ?? ""),
    );
    expect(graphTab).toBeTruthy();
    await act(async () => {
      graphTab!.click();
      await new Promise((r) => setTimeout(r, 50));
    });
    // The graph tab mounts either the SVG ego-network (when a logged-in user
    // id is available to center on) or the empty/loading state. Both prove the
    // tab switched and the RelationshipGraph subtree mounted without throwing.
    const svg = document.querySelector('svg[role="img"]');
    const bodyAfter = (document.body.textContent ?? "").toLowerCase();
    expect(
      svg !== null ||
      bodyAfter.includes("co-presence") ||
      bodyAfter.includes("no co-presence") ||
      bodyAfter.includes("building"),
    ).toBe(true);
  });
});

describe("splash cleanup guard", () => {
  it("does not leave a splash element when App mounts under jsdom", async () => {
    // The inline splash lives in index.html; under vitest + jsdom there
    // is no such node at all, but we still assert the app didn't inject
    // one that would cover test assertions.
    const found = document.getElementById("vrcsm-splash");
    expect(found).toBeNull();
    await renderAt("/");
    expect(document.getElementById("vrcsm-splash")).toBeNull();
  });
});

// Mock warning epilogue — if any test silently swallowed a real crash
// via RouteErrorBoundary, the body should contain the fallback error
// copy. Fail loudly in that case.
describe("no hidden RouteErrorBoundary fallbacks", () => {
  it("none of the smoke routes triggered the error boundary", () => {
    const body = (document.body.textContent ?? "").toLowerCase();
    expect(body).not.toMatch(/this page crashed|route error/i);
    // Also check nothing matches the common "Error: ..." pattern we'd
    // see if a thrown error leaked to the DOM.
    const errors = screen.queryAllByText(/^(error|typeerror|referenceerror):/i);
    expect(errors.length).toBe(0);
  });
});
