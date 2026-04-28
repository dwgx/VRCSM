# VRCSM Next Agent Handoff

Last updated: 2026-04-29

## Current State

- Branch: `main`
- Working tree at handoff time: expected clean after this documentation commit.
- Latest implementation commit before this doc pass: `74e522a Harden preview cache and thumbnail loading`
- Remote: `origin https://github.com/dwgx/VRCSM.git`
- Current app version shown in UI / release artifacts: `0.14.3`
- Release metadata gate now has `scripts/verify-release-metadata.ps1` for
  CI/package drift checks. It covers pnpm lock usage, README network/signing
  claims, portable ZIP `.old` exclusions, and `VERSION` alignment with
  `web/package.json`, `vcpkg.json`, and README artifact names.

## What Was Just Stabilized

### World History Row Limit / Logged Players

- World history now defaults to 250 rows instead of an implicit 100 and exposes visible 100/250/500/1000/2000 presets plus a custom limit capped at 5000.
- `db.worldVisits.list` is clamped to 5000 rows server-side to avoid accidental unbounded SQLite reads.
- `Database::RecentWorldVisits()` returns `player_count`, `player_event_count`, and `last_player_seen_at` per visit by aggregating local `player_events` in the same `world_id + instance_id + visit time window`.
- UI wording is intentionally `logged players`, not live occupancy. These counts are local VRChat log evidence, not a remote VRChat API room population.

Important files:

- `src/core/Database.cpp`
- `src/host/bridges/DatabaseBridge.cpp`
- `web/src/pages/WorldHistory.tsx`
- `web/src/lib/ipc.ts`
- `tests/CommonTests.cpp`

### Global Quick Search v1

- `search.global` is now a local-only async IPC method backed by `Database::GlobalSearch()`.
- The search aggregator merges local favorites, world visits, player events, player encounters, and avatar history into evidence-first results.
- Remote VRChat API enrichment is intentionally disabled in v1. `includeRemote` is accepted, but diagnostics report no remote sources and `remoteSuppressedReason: "disabled"`.
- `Ctrl+K` / command palette calls `search.global` and renders evidence-backed world/user/avatar rows before the built-in command list.
- Historical avatar thumbnails keep the existing semantic guard: wearer/current-profile reference images are not promoted unless the resolved avatar id matches the logged avatar id.

Important files:

- `src/core/Database.cpp`
- `src/core/Database.h`
- `src/host/bridges/SearchBridge.cpp`
- `src/host/IpcBridge.cpp`
- `src/host/IpcBridge.h`
- `web/src/components/CommandPalette.tsx`
- `web/src/lib/ipc.ts`
- `web/src/lib/types.ts`
- `tests/CommonTests.cpp`
- `docs/GLOBAL-SEARCH-SPEC.md`

### Avatar Preview / Thumbnail Pipeline

- `thumbnails.fetch` supports host-side image caching and returns local `thumb.local` URLs when available.
- Avatar list rows now load thumbnails through visible-row gating and low-priority lookahead. Clicked/selected rows stay high priority.
- Broken `thumb.local` image URLs are invalidated and fall back instead of leaving a dead tile.
- Wearer profile/reference images are cached in VRCSM-owned cache, but they remain semantically marked as reference images unless verified.
- Historical log-only avatar rows must not pretend a current wearer profile image is the old avatar thumbnail.

Important files:

- `web/src/pages/Avatars.tsx`
- `web/src/lib/thumbnails.ts`
- `web/src/lib/image-cache.ts`
- `web/src/components/ThumbImage.tsx`
- `src/core/VrcApi.cpp`

### 3D Preview / Cache Safety

- Bundle download trust was tightened: `UnityFS` magic alone is not enough; the code validates UnityFS header, blocksInfo, block table, and node table.
- GLB output writes to `.part` and then renames to the final `.glb`.
- WebView-visible GLBs can be retained/released through IPC so LRU cleanup does not delete active preview files.
- Tests cover truncated magic-only bundles and LRU lease behavior.

Important files:

- `src/core/UnityBundle.cpp`
- `src/core/UnityBundle.h`
- `src/core/UnityPreview.cpp`
- `src/core/AvatarPreview.cpp`
- `src/core/AvatarPreview.h`
- `src/host/IpcBridge.cpp`
- `tests/CommonTests.cpp`

### Steam Link / Quest Repair

- SteamVR / Quest diagnostics are user-facing in Settings.
- Repair is backup-first and split into safer actions: pairing reset, full VRLink reset, stable branch validation, safe streaming parameters.
- Restore path validation was already hardened before the latest implementation pass; tests now cover malicious metadata escapes.

Important files:

- `src/core/VrDiagnostics.cpp`
- `web/src/pages/Settings.tsx`
- `tests/CommonTests.cpp`

### Plugin IPC / Auto-Uploader

- Plugin iframe calls now go directly through `chrome.webview.postMessage` / `plugin.rpc`.
- Permission split exists: `ipc:shell`, `ipc:fs:listDir`, `ipc:fs:writePlan` are not one broad bucket.
- Tests cover that `ipc:shell` does not grant filesystem methods.

Important files:

- `src/core/plugins/PluginRegistry.cpp`
- `src/core/plugins/PluginRegistry.h`
- `web/src/pages/PluginHost.tsx`
- `plugins/vrc-auto-uploader/`
- `tests/CommonTests.cpp`

## Last Verified Commands

The last implementation pass verified:

```powershell
pnpm --prefix web build
pnpm --prefix web test
pnpm --prefix web test:smoke
cmd.exe /s /c '"D:\Software\MS\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-release'
ctest --test-dir build\x64-release --output-on-failure
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-release-metadata.ps1
```

Observed results:

- Web build: passed.
- Web tests: 78/78 passed.
- Web smoke: 22/22 passed.
- C++ release build: passed.
- CTest: 39 total; 38 passed and `DeleteExecuteRejectsPreservedCwpRootTargets` skipped because VRChat was running.
- Release metadata gate: passed, `version=0.14.3`.
- MSI and release-exe launch were not rerun for the global-search feature cut.

## Known Watch Points

- `rg.exe` may fail in this desktop environment with Access denied from the WindowsApps Codex bundle. Use PowerShell `Select-String` / `Get-ChildItem` fallback when needed.
- `tmp\pyi-temp\...` may throw access-denied during recursive scans. Exclude `tmp/`.
- Stop running `VRCSM.exe` before building release, otherwise the linker may fail.
- Do not commit generated `web/dist`, `build/`, or MSI artifacts unless the user explicitly asks.
- Some docs are historical; prefer `MEMORY.md`, this handoff, `AGENTS.md`, and `CHANGELOG.md` for current behavior.
- Global search v1 is local-only by design. Do not add live remote fanout to keystroke search without a debounce/cache/rate-limit plan and tests.
- World history `player_count` is local-log evidence only. Keep the UI copy distinct from remote `occupants` / capacity fields.

## If The User Says "Continue"

1. Run `git status --short`.
2. Read `MEMORY.md` and this file.
3. Inspect the exact feature area before changing code.
4. For release-facing fixes, run the full verification baseline and build MSI.
5. If the user asks to upload, commit and push to `origin/main` after tests pass.

## Do Not Regress These Decisions

- Keep avatar thumbnail semantics honest:
  - Verified model thumbnail: okay as row thumbnail.
  - Wearer current profile/current avatar image: reference only unless verified as matching the logged avatar.
- Keep thumbnail prefetch bounded:
  - Visible rows first.
  - Small delayed lookahead.
  - User click / selected row always wins.
- Keep SteamVR repairs reversible and backup-first.
- Keep plugin filesystem permissions split and explicit.
- Keep downloaded bundle validation structural, not magic-only.
