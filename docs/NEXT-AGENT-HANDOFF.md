# VRCSM Next Agent Handoff

Last updated: 2026-05-09

## Current State

- Branch: `main`
- Working tree at handoff time: docs + version bump commit pending.
- Latest implementation commit: `d0b16c9` (Add VRChat visits API, fix stale log backfill, add unique DB constraint).
- Remote: `origin https://github.com/dwgx/VRCSM.git`
- Current app version: `0.14.5`
- VS2026 path: `D:\Software\Microsoft\Microsoft Visual Studio\18` (note: "Microsoft" is in the path, unlike the old CLAUDE.md).

## What Changed Since 0.14.3

### Critical Bug Fixes

- **Log backfill always-on (was: only when DB empty).** `LogsBridge.cpp` used to skip historical log import once the tables had any data. That meant sessions after day 1 never appeared in world history / player events / friend log. Now always scans the 20 newest log files on startup with `INSERT OR IGNORE`.
- **Non-friend player names cleaned.** VRChat appends hex hashes to display names of unresolved players (`Alice_f76f94e9_542d`). `stripUnresolvedHashSuffix()` removes them in both batch LogParser and live LogEventClassifier.
- **vrchat://launch no longer spawns second VRChat.exe.** `ShellBridge::HandleShellOpenUrl` intercepts `vrchat://launch` when VRChat is running and uses `VrcApi::inviteSelf` REST API instead.
- **Friends list polling race condition.** Background poll used `setData(result)` which could overwrite WebSocket pipeline event merges. Now uses functional updater + timestamp guard.

### New Features

- **VRChat recently encountered players API.** `visits.list` IPC → `GET /api/1/visits`. Frontend `ipc.visitsList()` available.
- **Hardware recommendation tab.** Settings → Hardware: WMI GPU/CPU/RAM/HMD detection, hardware score, recommended SteamVR parameters. GPU table covers RTX 50-series, AMD RX 9000/7000/6000, Intel Arc.
- **Plugin market hero SVG.** `PluginHero.tsx` — widescreen banner with robot mascot and floating plugin cards.
- **Plugin install dialog.** shadcn Dialog replaces `window.confirm()`, shows manifest permissions.
- **BoopCard emoji-only.** No more message type tabs or slot buttons — just emoji wheel + send.
- **Calendar & Bundles moved to Lab** sidebar.

### Data Changes

- `world_visits` now has `CREATE UNIQUE INDEX uq_world_visits ON world_visits(world_id, instance_id, joined_at)`. If a DB from ≤0.14.4 has duplicates, the unique index creation will fail. Handle migration by deleting duplicates first.
- Log scan limits raised: `kMaxLogFiles` 5→20, `kMaxEventsPerKind` 500→2000.

## Last Verified Build (2026-05-09)

- Web build: passed (tsc -b + vite build).
- Web smoke: passed (22/22).
- C++ release build: passed (MSVC 2026, Ninja).
- CTest: 39/39 passed (100%).
- MSI + ZIP: built at `build\release\VRCSM_v0.14.5_x64_*`.
- GitHub release v0.14.5 created with artifacts.

## Release Workflow (corrected)

```powershell
# 1. Build frontend
pnpm --prefix web build
pnpm --prefix web test:smoke
# 2. Build C++ (VS2026)
cmd.exe /s /c '"D:\Software\Microsoft\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-release'
ctest --test-dir build\x64-release --output-on-failure
# 3. Package MSI + ZIP
powershell -NoProfile -ExecutionPolicy Bypass -File .\package_release.ps1
# 4. Tag + Release
git tag -a v0.14.5 -m "VRCSM v0.14.5"
git push origin main --tags
gh release create v0.14.5 --title "VRCSM v0.14.5" --notes-file CHANGELOG.md
gh release upload v0.14.5 "build\release\VRCSM_v0.14.5_x64_Installer.msi" "build\release\VRCSM_v0.14.5_x64.zip" --clobber
```

## Known Watch Points

- Stop `VRCSM.exe` before C++ build or linker may fail with file lock.
- `D:\Software\Microsoft\Microsoft Visual Studio\18` is the correct VS path (CLAUDE.md has the old `D:\Software\MS` path which is wrong).
- Ninja and cmake may need reinstall after system updates (use `pip install ninja cmake`).
- `react-router-dom` must stay at v6 (v7 breaks the app); `pnpm-lock.yaml` was updated.
- Do not commit `web/dist`, `build/`, or MSI artifacts.
- `stripUnresolvedHashSuffix()` uses regex `_[0-9a-f]{4,}$` — legitimate names ending in 4+ hex chars after underscore will be incorrectly trimmed. This is a known tradeoff.

## If The User Says "Continue"

1. `git status --short`
2. Read `MEMORY.md` and this file.
3. Inspect the feature area before changing code.
4. Full verification baseline + MSI before claiming done.
5. Commit, push, tag, release with artifacts.

## Do Not Regress These Decisions

- Log backfill must run every startup (not only when DB is empty).
- `vrchat://launch` must use REST API when VRChat is running.
- Non-friend player names must be cleaned of hex hash suffix.
- Avatar thumbnail semantics: wearer profile images are reference only.
- SteamVR repairs must be backup-first.
- Plugin permissions must stay split and explicit.
- BoopCard should stay simple (emoji wheel only, no message type tabs).
