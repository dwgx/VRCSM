# UI Smoke Findings — 2026-07-04

Consolidated report from the VRCSM web UI smoke pass. Merges three evidence
streams (scaffold build result, headless Playwright run, per-route vision
review) and an adversarial verification pass over the raw artifacts.

## 1. Summary verdict

The smoke layer ran clean end-to-end except for **two genuine, gated defects**
on the primary host viewport (1280x820). Both were left intact (assertions not
weakened) and are reproducible from committed artifacts and source:

- **`/tools/osc` — horizontal layout overflow** (45 elements past the right edge). CONFIRMED.
- **`/worlds` — invalid nested `<button>` DOM** (React hydration-error warning). CONFIRMED.

Everything else is healthy: **0 dead/unimplemented IPC calls**, **0 IPC errors**
across 1000 load-phase + 74 interaction-phase calls, 37 distinct methods
exercised, and 25 of 27 routes fully clean at the gated viewport. Pixel-diff is
soft/report-only and shows only expected mock-data drift.

Run outcome: **52 passed, 2 failed** (Playwright 1.60.0, bundled chromium-1223,
single worker, 0 retries). `tsc -b`, `tsc --project tsconfig.smoke.json`, and
`pnpm build` all pass; the IPC tap is behind `window.__SMOKE_TAP__` so the
production bundle is unchanged.

### How to run the smoke layer

```bash
cd web
corepack pnpm run test:ui-smoke          # full headless suite; starts/reuses vite dev on 5173
corepack pnpm run test:ui-smoke:update   # re-bless committed pixel baselines
# or, if pnpm isn't on PATH:
npx playwright test
```

Notes: on this machine `pnpm` is not on PATH — use `corepack pnpm ...`. Plain
`npm install` fails against the pnpm-structured `node_modules`; install with
corepack pnpm. Chromium-1223 is already cached (no re-download); `@playwright/test`
is pinned to exactly `1.60.0` precisely because its bundled chromium revision is
v1223 (1.59→1217, 1.61→1228).

### Adversarial-verification method (read this)

The raster vision channel was **non-functional in this environment**: the image
Read tool returned no pixels even for the cited screenshots (the C-stream vision
agent hit the same wall). Additionally, full-page PNGs are clamped to the
viewport width, so content that overflows *past* the right edge cannot appear in
a raster capture regardless. I therefore verified against stronger evidence:

1. **DOM bounding-box data** in `offset-report.json` (each offending element's
   measured `right` edge vs `viewportWidth`), and
2. **the actual source** for the nested-button defect.

Both gated findings are confirmed by objective DOM geometry and code, not by
eyeballing. PNG IHDR checks confirmed all captures are the expected dimensions
(1280x820, 1024x768, 900x800).

---

## 2. CONFIRMED UI offset / layout bugs

| Route | Viewport | Gated? | Issue | Evidence | Severity |
|-------|----------|--------|-------|----------|----------|
| `/tools/osc` | 1280x820 | **YES (hard gate)** | 45 elements overflow the right edge. Outermost `div.grid.content-start` and its card reach **right=1298.5px** (19px past the 1280 viewport); `div.unity-panel-header.flex` and `div.grid.gap-3` reach 1297.5; ~40 inner grid rows (`div.grid.grid-cols-[84px_1fr]`, `span.min-w-0.truncate`, `div.grid.grid-cols-[1fr_92px_auto]`, `button.relative.inline-flex`) reach 1285-1288. `docScrollWidth==viewportWidth==1280`, so this is real intra-layout overflow, not a scrollbar artifact. | `screenshots/tools_osc@1280x820.png`; DOM rects in `offset-report.json` (45 high-severity entries, 0 low) | **High** |
| `/worlds` | 1280x820 | **YES (hard gate)** | Invalid DOM nesting: `WorldTile` renders an outer `<button type="button" onClick={onSelect}>` (`src/pages/Worlds.tsx:306`) wrapping `<WorldThumb>`, which itself renders an inner favorite-toggle `<button>` (`src/pages/Worlds.tsx:261`, title "Save to library"). React logs `console.error`: *"In HTML, `<button>` cannot be a descendant of `<button>`. This will cause a hydration error."* (44 lines). Confirmed by reading the source directly. | `screenshots/worlds@1280x820.png`; console records in `events.json` / test-results; source `src/pages/Worlds.tsx:306` (outer) + `:261` (inner) | **High** |

Both failures are on the only hard-gate project (chromium 1280x820). They are
data-backed and were not masked.

---

## 3. PLAUSIBLE / needs-human-look

| Route | Viewport | Gated? | Issue | Why not CONFIRMED-gated | Severity |
|-------|----------|--------|-------|--------------------------|----------|
| `/logs` | 1024x768 | No (report-only vp) | Log-toolbar row overflows: `div.flex.items-center` right=1148 (124px over), two `button.flex.items-center` at 1048/1148, `span.size-2.rounded-full` at 1073. 4 high-severity. | These narrower viewports are captured for review only; not a gate. `/logs` is **clean at 1280x820**. Same toolbar row is the offender at both narrow sizes. | Medium |
| `/logs` | 900x800 | No (report-only vp) | Same toolbar row, worse: `div.flex.items-center` right=1129 (229px over), buttons at 951/1030/1129, dots at 976/1055. 6 high-severity. | As above — report-only viewport. | Medium |
| `/tools/osc` | 1024x768, 900x800 | No | **No overflow** at these sizes (0 problems). Included here only to note the osc overflow is specific to 1280-wide. | n/a — clean. | — |

Vision-stream note: the C-stream flagged `/tools/osc` at low severity but
explicitly stated it was pixel-analysis, not eyeballed (its vision channel was
also non-functional). Because the DOM data independently and strongly confirms
the osc overflow, that route is promoted to **CONFIRMED** in section 2; no
separate plausible entry is needed for it.

No other route x viewport combination (the remaining ~74 of 81) reported any
offset problem.

---

## 4. Dead interactions / IPC drift

**None found.** No method hit `mock_not_implemented`; no rejected/errored IPC in
either phase.

- **Load phase** (`events.json`, keyed route → call records): 27 routes,
  **1000 IPC calls**, **37 distinct methods**, `unimplemented=0`, `errors=0`
  (all `ok=true`, `isMock=true`).
- **Interaction phase** (`interaction-report.json`, `{clickTally, interactionEvents}`):
  **220 control clicks** across routes triggered **74 IPC calls**, **26 distinct
  methods**, `unimplemented=0`, `errors=0`.
- **Coverage gap (not a bug):** `/tools/memory-radar` is the only route with
  **0 clicks** in `clickTally` — the harness found no clickable control to
  exercise there. Worth a human glance to confirm the page is meant to be
  display-only, but no dead interaction was observed.

---

## 5. Data-flow coverage

- Distinct IPC methods exercised: **37 on load**, **26 via interaction** (union
  spans app data-fetch + user-triggered mutations).
- **0 errors** and **0 unimplemented** across all 1074 observed calls — the mock
  IPC surface fully covers what the UI requests during load and basic
  interaction. No mock drift detected.
- The IPC tap is dev-only (`window.__SMOKE_TAP__` in `src/lib/ipc.ts`); sign-in
  reaches the singleton `IpcClient` by dynamically importing the same
  Vite-served `/src/lib/ipc.ts` module in page context (Vite dedupes by resolved
  URL). No production code path and no test-only export were added.

---

## 6. Pixel-diff report (soft — never gates)

All 81 entries have `blessed=false` and nothing gates on pixels. Nonzero diffs
are expected: mock data carries time-based content (ISO timestamps) and random
picsum seeds.

| Screenshot | Diff % | Diff px / total |
|------------|--------|-----------------|
| `screenshots@1024x768` | **17.88%** | 140643 / 786432 |
| `bundles@1280x820` | 0.89% | 9318 / 1049600 |
| `bundles@900x800` | 0.69% | 4974 / 720000 |
| `bundles@1024x768` | 0.63% | 4967 / 786432 |
| `tools_memory-radar@1024x768` | 0.30% | 2358 / 786432 |
| `tools_memory-radar@900x800` | 0.29% | 2113 / 720000 |
| `tools_memory-radar@1280x820` | 0.20% | 2109 / 1049600 |

The `screenshots` route outlier is random gallery images, not a regression. The
remaining 74 entries diff <0.1% (e.g. `avatars@1280x820` = 0.0275%). Diff PNGs
are in the diffs dir (81 files).

---

## 7. How the smoke layer works (for future agents)

- **Stack:** Playwright `@playwright/test@1.60.0` (pinned for chromium-1223),
  `pixelmatch@7.2.0`, `pngjs@7.0.0`. Config: `web/playwright.config.ts`. Test
  files typecheck via `web/tsconfig.smoke.json` (kept out of the app build graph
  so out-of-src tests don't pollute `tsc -b`).
- **Two specs:**
  - `web/tests/smoke/nav-visual.spec.ts` — visits every route across 3 viewports
    (1280x820 primary + 1024x768 + 900x800 review), captures viewport + full-page
    screenshots, runs the offset heuristic and pixel diff, records console errors.
  - `web/tests/smoke/interaction.spec.ts` — clicks every control on every route
    and taps IPC to detect dead interactions / unimplemented methods / rejections.
- **Gating:** Only the **1280x820** project is a hard gate. Hard-gate failure
  classes are (a) high-severity out-of-viewport offsets, (b) `console.error` /
  `pageerror` (render-boundary). Pixel diff and the 1024/900 viewports are
  **report-only**. `clickThrough` tolerates context-destruction from navigation
  (navigation is not one of the declared failure classes) so a nav-triggering
  control doesn't false-fail — the render-boundary + pageerror gates still catch
  real crashes.
- **Report robustness:** Playwright recycles the worker after a failure, wiping
  module-level accumulators. Each test writes a per-test partial under
  `.artifacts/partials/`; `global-teardown.ts` merges them, so consolidated JSON
  is complete (81 offset entries, 162 manifest entries) even with failures present.
- **Baselines:** 81 committed baseline PNGs live in
  `web/tests/smoke/__screenshots__/` (NOT gitignored). Refresh with
  `test:ui-smoke:update`. `web/tests/smoke/.artifacts/` IS gitignored.

### Artifact paths (real, from this run)

```
D:/Project/VRCSM/web/tests/smoke/.artifacts/events.json               # load-phase IPC, route -> calls
D:/Project/VRCSM/web/tests/smoke/.artifacts/interaction-report.json   # {clickTally, interactionEvents}
D:/Project/VRCSM/web/tests/smoke/.artifacts/offset-report.json        # 81 entries, DOM out-of-viewport rects
D:/Project/VRCSM/web/tests/smoke/.artifacts/pixeldiff-report.json     # 81 entries, soft diffs
D:/Project/VRCSM/web/tests/smoke/.artifacts/manifest.json             # 162 screenshot entries
D:/Project/VRCSM/web/tests/smoke/.artifacts/screenshots/              # 189 PNGs
D:/Project/VRCSM/web/tests/smoke/.artifacts/diffs/                    # 81 diff PNGs
D:/Project/VRCSM/web/tests/smoke/.artifacts/playwright-report/index.html
D:/Project/VRCSM/web/tests/smoke/.artifacts/run-fresh.log             # this run's stdout
```

Key evidence screenshots: `screenshots/tools_osc@1280x820.png`,
`screenshots/worlds@1280x820.png`, `screenshots/logs@1024x768.png`,
`screenshots/logs@900x800.png`.

---

## Fix-first recommendation

**Fix `/worlds` first.** The nested `<button>` (`src/pages/Worlds.tsx:306`
outer, `:261` inner) is invalid DOM that React warns will break hydration — it's
a correctness/accessibility defect affecting a primary route, and the fix is
small (make the outer container a non-button element, e.g. a `div`/`article` with
a click handler and role, or hoist the favorite toggle out of the tile button).
The `/tools/osc` 19px overflow is real but lower-blast-radius and a
pure-CSS width/grid fix.

---

## Resolution (2026-07-04)

Both gated defects are fixed. Full smoke suite now **54 passed / 0 failed**
(was 52 passed / 2 failed). `tsc -b` and `pnpm build` both green. Assertions
were **not** weakened — the same 1280x820 hard gate (high-severity offsets +
`console.error`/`pageerror`) is unchanged; the routes now pass it on merit.

### Fix 1 — `/worlds` nested `<button>` (correctness/accessibility)

`WorldTile` was an outer real `<button>` wrapping `WorldThumb`, which contains
its own "Save to library" `<button>` — invalid HTML that React warns breaks
hydration. Replaced the outer `<button>` with a `role="button"` `<div>` and
restored keyboard access via `tabIndex={0}` + Enter/Space `onKeyDown`, plus a
`focus-visible` ring and `cursor-pointer`. The inner favorite-toggle `<button>`
is untouched, so no button is nested in a button.

`src/pages/Worlds.tsx` (~line 306):

```diff
-    <button
-      type="button"
+    <div
+      role="button"
+      tabIndex={0}
       onClick={onSelect}
+      onKeyDown={(e) => {
+        if (e.key === "Enter" || e.key === " ") {
+          e.preventDefault();
+          onSelect();
+        }
+      }}
       className={
-        "group relative flex flex-col overflow-hidden rounded-[var(--radius-sm)] border text-left transition-colors " +
+        "group relative flex flex-col cursor-pointer overflow-hidden rounded-[var(--radius-sm)] border text-left transition-colors " +
+        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary)/0.6)] " +
         ...
       }
-    </button>
+    </div>
```

- Before: `console.error` (44 lines) "`<button>` cannot be a descendant of
  `<button>`" fired on render; route failed the render-boundary gate.
- After: 0 console errors on `/worlds`; `high==0` at 1280.

### Fix 2 — `/tools/osc` horizontal overflow (layout)

The three-column grid used min column widths
(`minmax(300px,340px)_minmax(420px,1fr)_minmax(320px,380px)`) whose minimums
plus gaps exceeded the 1280 content box, pushing the card and ~40 inner rows
to `right≈1298.5px` (19px past the viewport). Reduced the column minimums to
`minmax(240px,320px)_minmax(360px,1fr)_minmax(260px,340px)`.

`src/pages/OscTools.tsx` (line 182):

```diff
-      <section className="grid gap-3 xl:grid-cols-[minmax(300px,340px)_minmax(420px,1fr)_minmax(320px,380px)]">
+      <section className="grid gap-3 xl:grid-cols-[minmax(240px,320px)_minmax(360px,1fr)_minmax(260px,340px)]">
```

- Before: 45 high-severity out-of-viewport elements; outermost card
  `right=1298.5` (19px over `viewportWidth=1280`).
- After: `high==0` at 1280 (`docScrollWidth==viewportWidth==1280`, 0 problems).
  The route was already clean at 1024/900; still clean there.

### Verification numbers (this run)

| Check | Before | After |
|-------|--------|-------|
| Full smoke suite | 52 passed / 2 failed | **54 passed / 0 failed** |
| `/tools/osc` high @1280 | 45 | **0** |
| `/worlds` high @1280 | 1 (console.error gate) | **0** |
| Routes with high>0 @1280 | 2 | **0** (all 27 routes clean) |
| IPC load phase | 1000 calls, 0 unimpl, 0 err | 1008 calls, **0 unimpl, 0 err**, 37 methods |
| `tsc -b` | green | **green** |
| `pnpm build` | green | **green** |

No route regressed. The offset heuristic, gate list, and viewport projects are
unchanged from the original findings above.
