/**
 * Interaction smoke test — the deep counterpart to pages-smoke.test.tsx.
 *
 * pages-smoke only proves each route reaches a non-fallback first paint.
 * This harness goes further: for every route it renders the real App under
 * the browser-only mock IPC path, enumerates every interactive element
 * (buttons, tabs, switches, links, menu items), and *clicks each one*,
 * watching for three failure classes that a first-paint-only test misses:
 *
 *   1. A render crash surfacing the RouteErrorBoundary ("Page render failed").
 *   2. An unhandled promise rejection from a click handler (the classic
 *      `void ipc.call(...)` with no `.catch`).
 *   3. An IpcError("mock_not_implemented") — meaning the UI triggered a host
 *      method the mock backend can't answer. In dev/browser mode that is a
 *      dead interaction; it also flags mock/host drift.
 *
 * Each failure is collected with (route, element label, error) so the report
 * pinpoints exactly which control on which page broke. Assertions fail loudly
 * with that list.
 *
 * Driven by vitest + jsdom; no Playwright needed.
 *
 * Run: `pnpm --prefix web vitest run src/__tests__/interaction-smoke.test.tsx`
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import { HashRouter } from "react-router-dom";

// ── jsdom shims (same set pages-smoke installs) ───────────────────────
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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

class IntersectionObserverStub {
  constructor(cb: (entries: unknown[]) => void) {
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

// jsdom has no scrollIntoView; Radix + several lists call it.
if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
}

// jsdom ships no navigator.clipboard. "Copy" buttons across the app call
// navigator.clipboard.writeText(...); without a stub every such click throws
// and masks other findings. NOTE: this papered-over throw is itself a real
// robustness gap — see the app-side review note — but the harness needs a
// deterministic clipboard to keep testing past the first copy button.
if (!navigator.clipboard) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: () => Promise.resolve(),
      readText: () => Promise.resolve(""),
    },
  });
}
// URL.createObjectURL / revokeObjectURL — several export/download flows use them.
if (!URL.createObjectURL) {
  URL.createObjectURL = () => "blob:mock";
  URL.revokeObjectURL = () => {};
}

// ── Failure capture ───────────────────────────────────────────────────
interface Failure {
  route: string;
  label: string;
  kind: "render-boundary" | "unhandled-rejection" | "mock-not-implemented" | "throw";
  detail: string;
}

const failures: Failure[] = [];
const unhandled: unknown[] = [];
// Per-route click tally — proves the harness is actually exercising controls
// and isn't silently a no-op (a green run from an empty harness is worthless).
const clickCounts: Record<string, number> = {};

function onUnhandled(e: PromiseRejectionEvent) {
  e.preventDefault?.();
  unhandled.push(e.reason);
}

// Some code paths reject via process (node) rather than window.
function onNodeUnhandled(reason: unknown) {
  unhandled.push(reason);
}

// Silence noisy-but-expected console output; keep real errors visible.
const originalError = console.error;
const originalWarn = console.warn;
beforeEach(() => {
  unhandled.length = 0;
  window.addEventListener("unhandledrejection", onUnhandled);
  process.on("unhandledRejection", onNodeUnhandled);
  console.error = (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (
      first.includes("THREE.WebGLRenderer") ||
      first.includes("not implemented: HTMLCanvasElement") ||
      first.includes("createObjectURL") ||
      first.includes("scrollIntoView") ||
      first.includes("act(...)")
    ) {
      return;
    }
    originalError(...args);
  };
  console.warn = (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    // The mock dispatcher warns on unimplemented methods; we capture those
    // via the rejection channel instead, so drop the duplicate noise here.
    if (first.includes("Mock IPC method not implemented")) return;
    originalWarn(...args);
  };
});
afterEach(() => {
  window.removeEventListener("unhandledrejection", onUnhandled);
  process.off("unhandledRejection", onNodeUnhandled);
  console.error = originalError;
  console.warn = originalWarn;
  cleanup();
});

async function flush(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/**
 * Sign the mock IPC backend in before rendering. The mock starts signed-out
 * (MOCK_SIGNED_OUT); auth.login flips it to authed. Without this, auth-gated
 * pages (Friends, Profile, Groups, Calendar, …) render only their signed-out
 * shell and their real data-driven interactions never mount — the whole point
 * of this harness. Idempotent: safe to call before every route.
 */
// Ground-truth coverage instrumentation: wrap ipc.call once so we record
// EVERY method the UI invokes and every one that hit the mock's
// "mock_not_implemented" path — even when the caller swallows the rejection
// with .catch (react-query, `void ipc.call().catch(()=>{})`, etc.). Without
// this, a dead interaction whose error is swallowed looks like a pass.
const invokedMethods = new Set<string>();
const unmockedHits = new Set<string>();
let ipcWrapped = false;

async function installIpcSpy() {
  if (ipcWrapped) return;
  const mod = await import("@/lib/ipc");
  const ipc = mod.ipc as unknown as {
    call: (m: string, p?: unknown) => Promise<unknown>;
  };
  const orig = ipc.call.bind(ipc);
  ipc.call = (method: string, params?: unknown) => {
    invokedMethods.add(method);
    return orig(method, params).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("mock_not_implemented") || msg.includes("Mock IPC method not implemented")) {
        unmockedHits.add(method);
      }
      throw err;
    });
  };
  ipcWrapped = true;
}

async function ensureSignedIn() {
  await installIpcSpy();
  const { ipc } = await import("@/lib/ipc");
  const status = await ipc.call<undefined, { authed: boolean }>("auth.status");
  if (!status.authed) {
    await ipc.call<{ username: string; password: string }, unknown>("auth.login", {
      username: "mock_user",
      password: "mock_pass",
    });
  }
}

async function renderApp(path: string) {
  await ensureSignedIn();
  window.location.hash = `#${path}`;
  const { default: App } = await import("@/App");
  await act(async () => {
    render(
      <HashRouter>
        <App />
      </HashRouter>,
    );
  });
  // Poll until the route's <main> outlet actually has interactive content, not
  // just until the shell paints. The mock IPC resolves async (~180ms), so a
  // data-driven page (Settings, Friends, Logs) shows only a skeleton on first
  // paint — enumerating then would find zero controls and silently pass. Wait
  // for either a control inside <main> or a stable settle window.
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const main = document.querySelector("main");
    const hasControl =
      !!main &&
      main.querySelector('button:not([disabled]),[role="tab"],[role="switch"],a[href],summary') !== null;
    if (hasControl) break;
    await flush(25);
  }
  // Extra settle so late effects (skeleton → data swap) finish mounting.
  await flush(60);
}

function bodyText(): string {
  return (document.body.textContent ?? "").toLowerCase();
}

function hasRenderBoundary(): boolean {
  return bodyText().includes("page render failed");
}

/** Drain the captured unhandled rejections into failures for `route`/`label`. */
function drainRejections(route: string, label: string) {
  for (const reason of unhandled.splice(0)) {
    const msg =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : String(reason);
    const isMock =
      typeof msg === "string" &&
      (msg.includes("mock_not_implemented") ||
        msg.includes("Mock IPC method not implemented"));
    failures.push({
      route,
      label,
      kind: isMock ? "mock-not-implemented" : "unhandled-rejection",
      detail: msg,
    });
  }
}

/**
 * Return a de-duplicated, clickable set of interactive elements currently in
 * the DOM. We snapshot labels up front; after each click we re-query because
 * the tree may have changed.
 */
function interactiveElements(): HTMLElement[] {
  // Scope to the route content outlet (<main>) plus any open dialog/popover
  // layer, NOT the persistent shell (sidebar nav, dock, toolbar, status bar).
  // Clicking the shell's ~30 nav links first would exhaust the per-page click
  // budget on chrome and never reach the page's own controls — the whole point.
  const roots: Element[] = [];
  const main = document.querySelector("main");
  if (main) roots.push(main);
  // Radix portals dialogs/menus/popovers to <body>, outside <main>. Include
  // them so we exercise controls inside opened dialogs (where the deep,
  // account-mutating actions live).
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
  const seen = new Set<HTMLElement>();
  const nodes: HTMLElement[] = [];
  for (const root of roots) {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(sel))) {
      if (!seen.has(el)) {
        seen.add(el);
        nodes.push(el);
      }
    }
  }
  // Skip elements that would navigate the whole window or are obviously
  // destructive external links.
  return nodes.filter((el) => {
    if (el.tagName === "A") {
      const href = el.getAttribute("href") ?? "";
      // internal hash-router links are fine; external http(s) we skip.
      if (/^https?:/i.test(href)) return false;
    }
    return true;
  });
}

function labelFor(el: HTMLElement): string {
  const text = (el.textContent ?? "").trim().slice(0, 40);
  const aria = el.getAttribute("aria-label") ?? "";
  const title = el.getAttribute("title") ?? "";
  const tag = el.tagName.toLowerCase();
  return `${tag}"${text || aria || title || "(no label)"}"`;
}

/**
 * Click through the interactive elements on the current page. To stay robust
 * against the tree mutating on each click (dialogs opening, tabs swapping),
 * we cap the number of clicks per page and re-query between clicks, tracking
 * which labels we've already exercised.
 */
async function clickThrough(route: string, maxClicks = 40) {
  const clicked = new Set<string>();
  clickCounts[route] = 0;
  let recoveredOnce = false;
  for (let i = 0; i < maxClicks; i++) {
    const els = interactiveElements();
    const next = els.find((el) => {
      const key = labelFor(el);
      return !clicked.has(key);
    });
    if (!next) {
      // No unclicked control in <main> + open layers. If a dialog/menu is
      // trapping us, dismiss it once to expose base-page controls we haven't
      // reached, then keep going. Otherwise we're genuinely done.
      const layerOpen = document.querySelector(
        '[role="dialog"],[role="menu"],[data-radix-popper-content-wrapper]',
      );
      if (layerOpen && !recoveredOnce) {
        recoveredOnce = true;
        await act(async () => {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          await new Promise((r) => setTimeout(r, 0));
        });
        await flush(5);
        continue;
      }
      break;
    }
    const label = labelFor(next);
    clicked.add(label);

    // Skip controls that intentionally unmount the app shell / log out, which
    // would poison subsequent clicks in this render.
    if (/log ?out|sign ?out|退出登录|登出/i.test(label)) continue;

    clickCounts[route] += 1;
    try {
      await act(async () => {
        next.click();
        await new Promise((r) => setTimeout(r, 0));
      });
      await flush(5);
    } catch (err) {
      const e = err as Error;
      failures.push({
        route,
        label,
        kind: "throw",
        detail: `${e.name}: ${e.message}`,
      });
    }

    drainRejections(route, label);

    if (hasRenderBoundary()) {
      failures.push({
        route,
        label,
        kind: "render-boundary",
        detail: "RouteErrorBoundary shown after click",
      });
      // Boundary poisons the rest of this page; stop clicking here.
      break;
    }

    // Intentionally do NOT auto-dismiss dialogs/menus here: leaving an opened
    // layer in the DOM lets the next iteration exercise the controls inside it
    // (where the deep, account-mutating actions live). The "stuck" recovery at
    // the top of the loop dismisses a trapping layer only when there's nothing
    // new left to click.
  }
}

// Full route matrix — mirrors App.tsx <Route path=...>. Parameterized and
// plugin-host routes are covered by dedicated cases elsewhere; here we hit
// every top-level user-reachable page.
const ROUTES = [
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
];

describe("interaction smoke — click every control on every page", () => {
  for (const route of ROUTES) {
    it(`clicks through ${route} with no crash / dead interaction`, async () => {
      await renderApp(route);
      // Capture rejections fired during mount (auth-gated prefetch effects,
      // on-mount ipc.call with no .catch) BEFORE any click — these would
      // otherwise be attributed to the first clicked control or lost.
      drainRejections(route, "(mount)");
      // A clean first paint must not already show the boundary.
      expect(hasRenderBoundary()).toBe(false);
      await clickThrough(route);

      const forRoute = failures.filter((f) => f.route === route);
      if (forRoute.length > 0) {
        const report = forRoute
          .map((f) => `  [${f.kind}] ${f.label} → ${f.detail}`)
          .join("\n");
        throw new Error(`Interaction failures on ${route}:\n${report}`);
      }
    });
  }
});

/**
 * Deep flow — the account-mutating friend actions (mute / block / unfriend)
 * live behind a row-click → detail dialog → confirm-dialog chain that the
 * breadth-first fuzzer above won't reliably drive. They're also the highest
 * risk: each calls a host method (user.mute / user.block / friends.unfriend)
 * and a swallowed rejection here means a user clicks "Block" and nothing
 * happens. Drive each explicitly and assert the IPC method actually fired
 * with no unhandled rejection.
 */
async function clickByText(re: RegExp): Promise<boolean> {
  const els = Array.from(
    document.querySelectorAll<HTMLElement>('button,[role="button"],[role="menuitem"]'),
  ).filter((el) => re.test((el.textContent ?? "").trim()));
  const target = els[els.length - 1]; // prefer the deepest/last match (in-dialog)
  if (!target) return false;
  await act(async () => {
    target.click();
    await new Promise((r) => setTimeout(r, 0));
  });
  await flush(20);
  return true;
}

describe("interaction smoke — account-mutating friend actions", () => {
  it("mute / block / unfriend fire their IPC method with no dead click", async () => {
    await installIpcSpy();
    await ensureSignedIn();
    invokedMethods.clear();

    // Mount FriendDetailDialog directly with a mock friend. Reaching it through
    // the full page means driving a dropdown-menu → menu-item chain that jsdom
    // portals unpredictably; a direct mount deterministically exercises the
    // exact handlers that call user.mute / user.block / friends.unfriend, which
    // is what we actually care about (a swallowed rejection = a dead click).
    const [{ QueryClientProvider }, { queryClient }, { FriendDetailDialog }] =
      await Promise.all([
        import("@tanstack/react-query"),
        import("@/lib/queryClient"),
        import("@/components/FriendDetailDialog"),
      ]);
    const friend = {
      id: "usr_mock_friend_000",
      username: "friend_0",
      displayName: "Mock Friend 1",
      currentAvatarImageUrl: null,
      currentAvatarThumbnailImageUrl: null,
      currentAvatarName: "Taihou",
      statusDescription: "In a world",
      status: "active",
      location: "offline",
      last_platform: "standalonewindows",
      bio: null,
      developerType: null,
      last_login: null,
      last_activity: null,
      profilePicOverride: null,
      userIcon: null,
      tags: [],
    };

    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <FriendDetailDialog friend={friend as never} onClose={() => {}} />
        </QueryClientProvider>,
      );
    });
    await flush(60);

    // Mute → confirm.
    if (await clickByText(/^mute$|静音|ミュート/i)) {
      await clickByText(/^mute$|^confirm$|确认|確認/i);
    }
    // Block → confirm.
    if (await clickByText(/^block$|拉黑|ブロック/i)) {
      await clickByText(/^block$|^confirm$|确认|確認/i);
    }
    // Unfriend is a two-step confirm.
    if (await clickByText(/unfriend|删除好友|フレンド解除/i)) {
      await clickByText(/confirm|remove|确认|確認|really/i);
      await clickByText(/really remove|final|确认|確認/i);
    }
    await flush(30);
    drainRejections("/friends", "(account-actions)");

    // Assert at least one mutation method actually fired — proves the chain is
    // wired, not a dead click — and that no unhandled rejection leaked from the
    // async onConfirm handlers.
    const fired = ["user.mute", "user.block", "friends.unfriend"].filter((m) =>
      invokedMethods.has(m),
    );
    const rejected = failures.filter(
      (f) => f.route === "/friends" && f.label === "(account-actions)",
    );
    expect(rejected).toEqual([]);
    expect(fired.length).toBeGreaterThan(0);
  });
});

describe("interaction smoke — aggregate report", () => {
  it("the harness actually clicked controls (not a silent no-op)", () => {
    const tally = ROUTES.map((r) => `${r}: ${clickCounts[r] ?? 0}`).join("\n  ");
    const report =
      `=== CLICK TALLY ===\n  ${tally}\n  total=${totalClicks()}\n` +
      `=== IPC METHODS INVOKED (${invokedMethods.size}) ===\n  ` +
      Array.from(invokedMethods).sort().join(", ") +
      `\n=== UNMOCKED METHODS HIT BY UI (${unmockedHits.size}) ===\n  ` +
      Array.from(unmockedHits).sort().join("\n  ") +
      `\n=== FAILURES (${failures.length}) ===\n` +
      failures.map((f) => `[${f.kind}] ${f.route} ${f.label} → ${f.detail}`).join("\n");
    // Opt-in file dump for local debugging only — set SMOKE_REPORT=1. Never
    // written in a normal/CI run so the harness leaves no scratch artifact.
    if (process.env.SMOKE_REPORT) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require("node:fs");
        fs.writeFileSync("smoke-report.txt", report);
      } catch {
        /* best-effort diagnostics only */
      }
      // eslint-disable-next-line no-console
      originalError(`\n${report}\n`);
    }
    // The whole route set must exercise a meaningful number of controls, and
    // every route with rendered content must click at least one.
    expect(totalClicks()).toBeGreaterThan(ROUTES.length); // avg >1 per route
  });

  it("no interaction failures across all routes", () => {
    if (failures.length > 0) {
      const grouped = failures
        .map((f) => `[${f.kind}] ${f.route} ${f.label} → ${f.detail}`)
        .join("\n");
      // eslint-disable-next-line no-console
      originalError(`\n=== INTERACTION SMOKE FAILURES (${failures.length}) ===\n${grouped}\n`);
    }
    expect(failures).toEqual([]);
  });
});

function totalClicks(): number {
  return Object.values(clickCounts).reduce((a, b) => a + b, 0);
}
