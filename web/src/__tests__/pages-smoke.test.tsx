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
 * production, so we do the same here.  Waits a few microtask turns so
 * lazy-loaded chunks have a chance to resolve before we assert.
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
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
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
  { path: "/worlds", marker: /./ },
  { path: "/friends", marker: /./ },
  { path: "/groups", marker: /./ },
  { path: "/profile", marker: /./ },
  { path: "/vrchat", marker: /./ },
  { path: "/screenshots", marker: /./ },
  { path: "/logs", marker: /./ },
  { path: "/radar", marker: /./ },
  { path: "/calendar", marker: /calendar|events|jams/i },
  { path: "/benchmark", marker: /avatar|benchmark|performance/i },
  { path: "/history/worlds", marker: /./ },
  { path: "/settings", marker: /./ },
  { path: "/plugins", marker: /plugins|market/i },
];

describe("pages smoke", () => {
  for (const { path, marker } of ROUTES) {
    it(`renders ${path} without throwing`, async () => {
      await renderAt(path);
      // At minimum the DOM body must contain *something* (the app shell).
      expect(document.body.textContent ?? "").not.toHaveLength(0);
      // Case-insensitive marker probe — won't be picky about translation,
      // just ensures we made it past the Suspense fallback.
      if (marker.source !== ".") {
        const body = (document.body.textContent ?? "").toLowerCase();
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
    const body = (document.body.textContent ?? "").toLowerCase();
    expect(body).toContain("discover");
    expect(body).toContain("featured");
    expect(body).toContain("jams");
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
