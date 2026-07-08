# VRCSM Agent Memory

Last updated: 2026-07-08

This is the repo-local handoff entrypoint. It exists because future agents should not have to rediscover the project state, document map, or the avatar/SteamVR decisions from chat history.

## Read First

1. `AGENTS.md` or `CLAUDE.md` — operating rules, architecture, build commands, safety constraints.
2. `docs/NEXT-AGENT-HANDOFF.md` — current repo state, last verified build, release checkpoint, and open follow-ups.
3. `docs/MD-INDEX.md` — all Markdown files and what each one is for.
4. `CHANGELOG.md` — release history and user-visible behavior.
5. Only then inspect code.

## Current Continuity Snapshot

- Current branch: `main`, **diverged from `origin/main` — 46 commits AHEAD, 12 BEHIND, and NOT yet pushed** (`git rev-list --left-right --count origin/main...main` = `12  46`; local HEAD `78e03d6`). The 12 behind are all Dependabot dependency/action bumps plus a "disable Dependabot" commit — inspect before any `git pull`; no source conflict expected but 46 local feature commits are unpushed.
- Working tree is **clean** apart from one intentionally-untracked scratch file at repo root (`2026-07-04-111708-...txt`, a local command transcript). Do NOT commit it.
- Development is **ACTIVE** (not paused). Recent sessions shipped a now-playing music module, synced lyrics with a host proxy, a system tray, a Database god-object split, full 7-locale i18n parity, the plugin.marketFeed permissions fix, and the VrcApi→HttpClient transport extraction. See "Recently completed" below.
- Current version: still `0.14.6` in `VERSION` and `web/package.json` — **un-bumped** despite the 46 new commits. A version bump + release cut is pending; keep `VERSION`, `web/package.json`, README artifact names, and release asset filenames in sync when bumped.
- Last release artifact `build\release\VRCSM_v0.14.6_x64_Installer.msi` **predates the current head** (music/lyrics/tray/i18n/Database-split all landed after it) and is NOT representative of current code. No new artifact has been cut.
- Current test baseline (re-confirm by running builds before claiming done): **C++ ctest 135/135, web 354/354 vitest (see below), Playwright UI smoke 54/54, tsc + build clean.** ctest rose from 128 → 135 in the 2026-07-08 session 2 (+3 PluginFeed, +4 crackUrl). The web vitest full run flakes ~25 fails under the default parallel runner (two heavy render suites contending); run `--no-file-parallelism` for the true 354/354 — see [[vitest-parallel-flakiness]]. This supersedes the older 100/104-test and 238/280 vitest / 27-smoke figures elsewhere in the docs.
- Reliability lesson: background workflows/subagents repeatedly hung on the inference gateway this session; **prefer foreground single-threaded execution for heavy C++ work.**

### Shipped this session

- **Now-playing music module.** `src/core/NowPlaying.{cpp,h}` reads the currently-playing system media via Windows GSMTC (C++/WinRT `GlobalSystemMediaTransportControls`), exposed over the `music.nowPlaying` IPC method (`src/host/bridges/MusicBridge.cpp`). Web consumes it via `web/src/lib/useNowPlaying.ts`; `{music.*}` OSC tokens (title/artist/album/status/position/duration/progressBar/percent/appName/marquee/lyrics/lyricsTranslated) render through `web/src/pages/osc/NowPlayingPanel.tsx` + presets. GSMTC async waits are bounded and progress is anchored to sample time.
- **Synced lyrics.** `{music.lyrics}` + `{music.lyricsTranslated}` tokens driven by `web/src/lib/lyrics.ts` with a multi-provider chain (LRCLIB exact → LRCLIB search → NetEase) and user-selectable source toggles. Requests route through a NEW C++ host proxy `src/core/LyricsProxy.{cpp,h}` via the `lyrics.fetch` IPC method (`src/host/bridges/LyricsBridge.cpp`) to bypass WebView2 CORS. The proxy has an SSRF rail (https-only; `IsBlockedProxyHost` refuses loopback/link-local/private-range literal hosts — 127/8, 10/8, 192.168/16, 172.16–31, IPv4-mapped IPv6, verified `LyricsProxy.cpp:108-162`).
- **System tray.** `src/host/MainWindow.cpp` adds a tray icon via `Shell_NotifyIconW` with minimize-to-tray and a self-healing NIM_MODIFY→NIM_ADD fallback; maximized-restore fixed.
- **Robustness/UX.** Game Log live-tail backfill of the existing log + precise empty states; FriendLog pagination; clickable notifications; per-subscriber gamelog seed; OSC text-wrap of unbroken strings.
- **i18n full parity** across all 7 locales (`en`, `zh-CN`, `ja`, `ko`, `ru`, `th`, `hi`), 0 placeholder mismatch; non-default locales lazy-loaded.
- **Database god-object split** into a thin `Database.cpp` + 9 domain translation units (`Database_Analytics/AssetCache/Avatars/Embeddings/Favorites/Friends/History/Recordings/Rules.cpp`) sharing `Database_internal.h`; friend analytics extracted into a pure, testable `src/core/FriendAnalytics.{cpp,h}`.

### Recently completed (2026-07-08 session 2) — all DONE + committed

All three formerly-parked items are done and committed on `main` (unpushed).
No open work remains from this list. Next agent: version-bump + push + release
is the outstanding non-code step (still `0.14.6`, `main` 46 ahead of origin).

- **VrcApi transport extraction — DONE (`7112f56`).** The WinHTTP transport is now `src/core/HttpClient.{h,cpp}` (`vrcsm::core::http`): `crackUrl`, `requestOnce`/`request`/`get`, `HttpResponse`, rate-limit + 429 retry/backoff, Set-Cookie capture — moved verbatim. `VrcApi.cpp` (now 3380 lines) keeps all VRChat semantics and delegates through thin wrappers; **`VrcApi.h` is byte-frozen** (no public API change). Locked by 4 `HttpClientCrackUrl` tests + an opt-in live `/api/1/config` probe (`HttpClientLive`, gated on `VRCSM_LIVE_VRCAPI_TEST`).
- **`plugin.marketFeed` permissions — FIXED (`133c3af`).** `MarketEntry` (`PluginFeed.h:59`) now has a `permissions` vector, `ParseFeed` reads the entry's optional `permissions` array, and `MarketEntryToJson` (`PluginBridge.cpp:78`) emits it; `docs/gh-pages/plugins.json` carries per-entry permissions matching each manifest. The pre-install consent dialog now shows real scopes instead of "none". No TS change. Locked by 3 `PluginFeedTests`.
- **NetEase Chinese-lyrics — VERIFIED (`45978e5`).** No production code changed; the shipped path already worked. Added opt-in live gtest probes (`LyricsProxyLive.*`, DISABLED, gated on `VRCSM_LIVE_LYRICS_TEST`) that hit `music.163.com` through the exact `lyrics.fetch` transport — confirmed 200 + raw-UTF-8 Chinese LRC with timestamps. Only the GUI render itself is left (needs a human with a music player + VRChat running).

## Memories

- [session-persist-diagnosis](memory/session-persist-diagnosis.md) — "每次重登" 真凶是快捷方式指向 7/1 旧 release,持久化层本身正常

### 2026-07-03 review-remediation session

- A prior session ran a 6-area multi-agent review; reports are in `docs/review-2026-07/` (`REVIEW-SUMMARY.md` is the master). It was cut off at 100% context mid-fix.
- This session verified/finished all HIGH + security-MEDIUM fixes. Most had already landed; the remaining gaps closed here were **lib H2** (LRU `memoSet` cap added to `thumbnails.ts` + `assets-cache.ts`, matching `image-cache.ts`) and **build-docs H1** (`.gitignore` now covers `_build_*.bat`, `_tmp_*.bat`, `*-review.png`).
- Verified 2026-07-03: `pnpm build` clean, `pnpm test` 238/238, `test:smoke` 27/27, C++ release build up-to-date, `ctest` 100/100 (1 skipped: `RealLogClassificationTally`). (Superseded by the current baseline in the snapshot above: ctest 128/128, ~347 vitest, UI smoke 54/54.)
- See `docs/review-2026-07/REVIEW-SUMMARY.md` → "Remediation Status" for the per-finding evidence table and remaining non-security carry-overs.

### 2026-07-07 review-remediation session

- Fixed the async IPC shutdown regression from the bounded-drain optimization:
  `~IpcBridge` now waits for active queued/running async handlers to finish
  before destroying tailer/pipeline/DB state.
- `migrate.execute` is no longer subject to the frontend's 15-minute response
  timeout; the UI keeps the pending migration request until the host replies or
  the session is reset.
- MSI packaging again includes `ort-wasm*.wasm` because experimental avatar
  visual search loads onnxruntime-web assets from the installed `web` tree.
- Verified targeted IPC vitest 9/9, `corepack pnpm --dir web build`, release
  host build target `vrcsm`, release `ctest` 0 failures out of 104 tests with
  5 skipped, `package_release.ps1`, and MSI decompile showing the
  `ort-wasm-simd-threaded.asyncify-*.wasm` file present. (Superseded by the current baseline in the snapshot above: ctest 128/128, ~347 vitest, UI smoke 54/54.)

## Release Workflow

```powershell
# 1. Full build
pnpm --prefix web build
cmd.exe /s /c '"D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-release'
ctest --test-dir build\x64-release --output-on-failure
# 2. Package MSI + ZIP
powershell -NoProfile -ExecutionPolicy Bypass -File .\package_release.ps1
# 3. Upload to GitHub
gh release upload v0.14.6 "build\release\VRCSM_v0.14.6_x64_Installer.msi" "build\release\VRCSM_v0.14.6_x64.zip" --clobber
```

Note: VS2026 path is `D:\Software\Microsoft Visual Studio\18` (not `D:\Software\MS`).

## High-Value Context

- Avatar rows derived only from VRChat logs do not contain a trustworthy historical thumbnail URL.
- A wearer profile image is the wearer's current public image. It may be useful as a clearly labeled reference, but it must not be shown as a verified historical avatar thumbnail unless the avatar name/current avatar match is verified.
- Successful wearer/reference image lookups are cached by VRCSM, but bulk-loading the entire avatar list made the UI laggy. Keep visible rows fast, lookahead low-priority, and clicked rows highest priority.
- Steam Link / Quest repairs must always be backup-first. Do not delete SteamVR/Steam config directly; move/archive and record what happened.
- Plugin IPC is intentionally permission-scoped. Do not re-expand `ipc:shell` into filesystem access.
- **Log backfill now runs every startup (not just when DB is empty).** `INSERT OR IGNORE` + `UNIQUE` constraint on `world_visits` prevent duplicates. If data is stale, check that VRChat log directory is being probed correctly.
- **Non-friend player names** are cleaned of VRChat's hex hash suffix by `stripUnresolvedHashSuffix()` in both LogParser and LogEventClassifier.
- **`vrchat://launch` URLs** are intercepted in ShellBridge when VRChat is running — uses REST API instead of ShellExecute to avoid spawning a second VRChat.exe.
- **BoopCard** is now emoji-only (no message type tabs, no slot buttons).
- **Hardware recommendations** (Settings → Hardware) use WMI detection + built-in GPU/CPU score tables.

## Verification Baseline

Use this sequence before claiming a release-facing change is done:

```powershell
pnpm --prefix web build
pnpm --prefix web test:smoke
cmd.exe /s /c '"D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-release'
ctest --test-dir build\x64-release --output-on-failure
powershell -NoProfile -ExecutionPolicy Bypass -File .\package_release.ps1
```

If `VRCSM.exe` is already running, stop it before the C++ release build or the linker may fail with file lock / access denied.

## Do Not Lose These Constraints

- Do not mutate VRChat user data during tests; use temp directories.
- Destructive operations stay dry-run first.
- Preserve `__info` and `vrc-version` in `Cache-WindowsPlayer`.
- Keep project docs and release notes aligned with actual shipped behavior.
- Do not update global Codex memory files from inside this repo. This file is the repo-local memory artifact.
- VERSION, `web/package.json`, README artifact names, and release asset filenames must stay in sync.
