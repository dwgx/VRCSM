# VRCSM Agent Memory

Last updated: 2026-07-09

This is the repo-local handoff entrypoint. It exists because future agents should not have to rediscover the project state, document map, or the avatar/SteamVR decisions from chat history.

## Read First

1. `AGENTS.md` or `CLAUDE.md` — operating rules, architecture, build commands, safety constraints.
2. `docs/NEXT-AGENT-HANDOFF.md` — current repo state, last verified build, release checkpoint, and open follow-ups.
3. `docs/MD-INDEX.md` — all Markdown files and what each one is for.
4. `CHANGELOG.md` — release history and user-visible behavior.
5. Only then inspect code.

## Current Continuity Snapshot

- Current branch: `main`, **fully synced with `origin/main` (0 ahead / 0 behind)** — HEAD `5a3e661`, pushed. Tag `v0.15.0` pushed; GitHub release `v0.15.0` published with the MSI + ZIP.
- Working tree is **clean** apart from one intentionally-untracked scratch file at repo root (`2026-07-04-111708-...txt`, a local command transcript). Do NOT commit it.
- Development is **ACTIVE**. **v0.15.0 was released 2026-07-09** — it cut the now-playing music/lyrics/tray feature area, the Database split + HttpClient extraction, full 7-locale i18n parity, the pending Dependabot integration, and the 2026-07-09 GUI↔API audit remediation sweep. See "GUI↔API remediation (2026-07-09)" below.
- Current version: **`0.15.0`** in `VERSION` and `web/package.json` (bumped + released). README badge + artifact filenames updated. Next release: bump all of `VERSION`, `web/package.json`, README artifact names, and keep the release asset filenames in sync; reconfigure the CMake preset after editing `VERSION` (it is read at configure time — a plain rebuild says "ninja: no work to do").
- Released artifacts (`build\release\VRCSM_v0.15.0_x64_Installer.msi` + `.zip`) match the published GitHub release. MSI SHA256 `7280f357bc63d127394817145d583599b13c2d2ad4bc258b2384f8c2c6f70a47`; the release notes carry the `SHA256:` line the updater's fail-closed hash gate requires.
- **Current test baseline (re-confirmed 2026-07-09 at 0.15.0 by a full re-run): C++ ctest 150/150, web vitest 359/359, Playwright UI smoke 54/54, tsc + release build clean.** The web vitest full run flakes ~25 fails under the default parallel runner (two heavy render suites contending); run `--no-file-parallelism` for the true 359/359 — see [[vitest-parallel-flakiness]]. Only 2 pre-existing compiler warnings remain (`PluginBridge.cpp:172` u8path C4996, `CommonTests.cpp` getenv C4996).
- Reliability lesson: background workflows/subagents can hang on the inference gateway; **prefer foreground single-threaded execution for heavy C++ work.** Read-only recon/audit workflows (no heavy compute) ARE reliable and were used effectively this session.

### GUI↔API remediation (2026-07-09) — DONE + released in v0.15.0

A full read-only GUI↔API (IPC) contract audit (`docs/review-2026-07/GUI-API-CONTRACT-AUDIT-2026-07-09.md`, 185 handlers × 128 call sites, fanned out per bridge domain + adversarially verified, grade B-) was followed by a 9-batch foreground remediation sweep. Each batch was built + tested + committed independently; every behavior change is locked by a new test. Commits (oldest→newest):

- `1e59f52` **updater self-replace race** — `UpdateApplier::Apply` now launches a detached cmd bootstrap (wait-for-exit → msiexec in-place → relaunch) instead of racing msiexec against our own shutdown. Real-machine hot-update 0.14.6→0.14.7 verified.
- `b3c01d5` **LyricsProxy SSRF** (CRITICAL) — per-hop redirect refusal (`REDIRECT_POLICY_NEVER`, 3xx = error), DNS-resolution guard (`ResolvesToBlockedAddress`), referer CRLF reject. Live NetEase probe still 200 + UTF-8 LRC.
- `ca665fb` **{error}-as-success** — `settings.readAll/writeOne/exportReg` + `config.read` rethrow the `{error}` envelope as `IpcException` (fixes the Registry-tab white-screen); `rethrowIfErrorEnvelope` helper in `BridgeCommon.h`.
- `835ce0a` **auth transient-error** — `auth.status/user`, `friends.list`, `moderations.list` only swallow `auth_expired`; transient (429/500/network) now throws. FE `auth-context` preserves prior authed state on transient errors (kills the logout-flap + cache-wipe loop). Dropped the redundant currentUser probe (N+1).
- `2fafd7d` **OSC float wire fidelity** — tagged-arg wire form `{t,v}` so whole-number floats keep the `,f` tag (VRChat drops `,i` floats). `OscArgumentsFromJson` honors it; FE `coerceOscValue` emits it.
- `0ff7ed4` **destructive-op guards** — `junction.repair` now checks `ProcessGuard::IsVRChatRunning()` (its siblings did); `vr.audio.switch` checks HRESULTs (was always ok:true). NOTE: the audit's "vr.audio.switch ignores role / hijacks 3 ERoles" framing was WRONG — the 3-ERole loop is correct Windows "set default device" behavior; only the HRESULT-swallow was a real bug.
- `3fd3f9c` **update.download tiering** — added to `LONG_RUNNING_METHODS` (was on the 60s default → spurious timeout on slow MSI download); `UpdateDownloader` now requires https.
- `d8c5b0c` **batch chunking** — `images.cache` (host caps at 64) and `thumbnails.fetch` (60s tier) now chunk on the FE so items past the cap aren't silently dropped / the call doesn't time out.
- `6ddef8f` **analytics DOT timestamps** (HIGH, audit-underrated) — `player_events/log_events/world_visits` store `YYYY.MM.DD HH:MM:SS`, but `FriendAnalytics::parsePresenceInstant` only parsed ISO → co-presence graph returned empty for ALL real data + activity heatmap grouped everything under NULL. Parser now accepts both shapes; heatmap SQL normalizes dots→dashes inline. Verified against the real db.
- `760bbeb` **error-code consistency** — 7 ApiBridge + 12 PipelineBridge `runtime_error`→`IpcException{missing_field/not_found}`; `ParamInt64` for 9 rowid params (was 32-bit truncation); `sqlite3_changes()==0 → not_found` on rules.delete/setEnabled + event.stop/delete; `event.addAttendee` INSERT-OR-IGNORE → plain INSERT with UNIQUE(dedupe)/FK(not_found) branch.
- `30e2dcf` **plugin sandbox 1** — `path.probe` moved out of `FreeMethods` (was zero-permission filesystem-layout leak) behind `ipc:vrc:cache`; `screenshots.inject/readMetadata` now `ensureWithinBase` the screenshots root.
- `c488d66` **plugin sandbox 2** — `auth.user`/`user.me` results redacted for plugin callers via `PluginRegistry::RedactUserForPlugin` (strips steamId/oculusId/email/friends); the SPA still gets the full doc (it bypasses plugin.rpc).

**Deliberately NOT changed (documented judgment calls):**
- `fs.listDir`/`fs.writePlan` stay unrestricted for plugin callers — the bundled auto-uploader's core feature is browsing to + uploading from an arbitrary user-chosen folder under an explicitly-granted permission. Scoping them would break it, and they'd need re-plumbing into the plugin-aware handler path.
- **world_visits mixed-format dwell time (FOLLOW-UP, task open):** `world_visits` stores MIXED formats in one column — `joined_at` is DOT-local, some `left_at` rows are ISO with a `+09:00` offset (7/119). `total_hours_in_world` julianday math over both yields NEGATIVE intervals, so it was left on the prior 0.0 behavior rather than shipping a negative number. Needs offset-aware normalization (likely at the log-parse/ingest layer — investigate why left_at differs from joined_at). See `docs/review-2026-07/GUI-API-CONTRACT-AUDIT-2026-07-09.md`.

**Remaining audit batches NOT yet done:** B10 (smoke-coverage holes — add `/migrate` + plugin routes to the matrices, deep-flow tests for avatar delete / 2FA verify / SteamVR repair / data-clear dialogs, shape validators for destructive methods) and B11 (dead-code cleanup of the ~15 confirmed dead handlers/facades). These are lower-severity; the audit report has the full list.

### Shipped earlier (2026-07-08) — DONE + committed

- **Now-playing music module.** `src/core/NowPlaying.{cpp,h}` reads the currently-playing system media via Windows GSMTC (C++/WinRT `GlobalSystemMediaTransportControls`), exposed over the `music.nowPlaying` IPC method (`src/host/bridges/MusicBridge.cpp`). Web consumes it via `web/src/lib/useNowPlaying.ts`; `{music.*}` OSC tokens (title/artist/album/status/position/duration/progressBar/percent/appName/marquee/lyrics/lyricsTranslated) render through `web/src/pages/osc/NowPlayingPanel.tsx` + presets. GSMTC async waits are bounded and progress is anchored to sample time.
- **Synced lyrics.** `{music.lyrics}` + `{music.lyricsTranslated}` tokens driven by `web/src/lib/lyrics.ts` with a multi-provider chain (LRCLIB exact → LRCLIB search → NetEase) and user-selectable source toggles. Requests route through a NEW C++ host proxy `src/core/LyricsProxy.{cpp,h}` via the `lyrics.fetch` IPC method (`src/host/bridges/LyricsBridge.cpp`) to bypass WebView2 CORS. The proxy has an SSRF rail (https-only; `IsBlockedProxyHost` refuses loopback/link-local/private-range literal hosts — 127/8, 10/8, 192.168/16, 172.16–31, IPv4-mapped IPv6, verified `LyricsProxy.cpp:108-162`).
- **System tray.** `src/host/MainWindow.cpp` adds a tray icon via `Shell_NotifyIconW` with minimize-to-tray and a self-healing NIM_MODIFY→NIM_ADD fallback; maximized-restore fixed.
- **Robustness/UX.** Game Log live-tail backfill of the existing log + precise empty states; FriendLog pagination; clickable notifications; per-subscriber gamelog seed; OSC text-wrap of unbroken strings.
- **i18n full parity** across all 7 locales (`en`, `zh-CN`, `ja`, `ko`, `ru`, `th`, `hi`), 0 placeholder mismatch; non-default locales lazy-loaded.
- **Database god-object split** into a thin `Database.cpp` + 9 domain translation units (`Database_Analytics/AssetCache/Avatars/Embeddings/Favorites/Friends/History/Recordings/Rules.cpp`) sharing `Database_internal.h`; friend analytics extracted into a pure, testable `src/core/FriendAnalytics.{cpp,h}`.

### Recently completed (2026-07-08 session 2) — all DONE + committed

All three formerly-parked items are done and committed. These shipped as part
of **v0.15.0** (released 2026-07-09) — the version bump + push + release that
was pending at the time is now complete.

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
