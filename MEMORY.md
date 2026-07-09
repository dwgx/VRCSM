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

- Current branch: `main`, **1 commit ahead of `origin/main`, 0 behind** — HEAD `600440e` (OSC seek bar + rich presets), NOT yet pushed. Everything through `45668b0` IS pushed. (The old "60 ahead / Dependabot behind" backlog was resolved in the v0.15.0 release.)
- **v0.15.0 was released to GitHub** (tag `v0.15.0` + MSI/ZIP, 2026-07-09). **v0.15.1 is LOCAL** (`VERSION`/`web/package.json` = `0.15.1`; `vcpkg.json` still LAGS at `0.14.6` — bump on release), NOT pushed as a release. 0.15.1 bundles (in commit order): i18n language-persistence fix, QQ Music lyrics source, OSC progress/marquee sliders, factory-reset thumbnail fix, `{music.lyrics}` send fix, **Kugou 4th lyrics source + QQ title-only fallback (`77393a7`)**, gh-pages landing rewrite, and the **VRChat-safe OSC seek bar + 4 rich Now Playing presets (`600440e`)**. A local 0.15.1 MSI is installed + running on this machine.
- **Lyrics chain is now LRCLIB → NetEase → QQ → Kugou** (`web/src/lib/lyrics.ts`; `LyricsSource` union includes `"kugou"`), plus a QQ title-only fallback for obscure/uploaded tracks (title+artist misses them). OSC progress bar is a **seek bar** `━━━━━●────` (old `▬/▭` rendered as empty circles in the VRChat chatbox font); knob optional via `oscProgressBar(...,knob="")`.
- Working tree is **clean** apart from one intentionally-untracked scratch file at repo root (`2026-07-04-111708-...txt`, a local command transcript). Do NOT commit it.
- Release mechanics reminder: bump all of `VERSION`, `web/package.json`, README badge+artifact names together; **reconfigure the CMake preset after editing `VERSION`** (it's read at configure time — a plain rebuild says "ninja: no work to do"); the updater's fail-closed hash gate needs the `SHA256:` line in the GitHub release notes; **stop VRCSM before reinstalling** or the running WebView2 locks `web/` and the MSI silently keeps the stale bundle (a real trap hit this session).
- **Current test baseline (re-confirmed 2026-07-09 at 0.15.1): C++ ctest 151/151 (3 opt-in live probes DISABLED), web vitest 366/366, Playwright UI smoke 54/54, tsc + release build clean.** Run the full web vitest with `--no-file-parallelism` — the default parallel runner flakes ~25 fails in two heavy render suites (contention, see [[vitest-parallel-flakiness]]). Only 2 pre-existing compiler warnings remain (`PluginBridge.cpp:172` u8path C4996, `CommonTests.cpp` getenv C4996).
- Reliability lesson: background workflows/subagents can hang on the inference gateway; **prefer foreground single-threaded execution for heavy C++ work.** Read-only recon/audit workflows (no heavy compute) ARE reliable and were used heavily this session. `D:\Tool\debugger` (Frida/Ghidra/x64dbg/radare2/DIE/FLOSS + MCP bridges) is available for reverse-engineering; Frida 17 API uses `Process.findModuleByName(...).findExportByName(...)` (the old `Module.findExportByName` is gone).

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

### Post-0.15.0 local work (2026-07-09, unreleased — the 7 unpushed commits)

- `cccb5a6` **QQ Music lyrics** — chain is now LRCLIB → NetEase → QQ (`fromQQ` in `web/src/lib/lyrics.ts`: smartbox_new.fcg search → fcg_query_lyric_new.fcg, `nobase64=1` plaintext LRC, via the host `lyrics.fetch` proxy with a `y.qq.com` Referer; `c.y.qq.com` passes the SSRF rail). Per-source toggle in NowPlayingPanel; i18n in all 7 locales. Also added an OSC send/listen loopback round-trip test locking the B4 float fix.
- `42ad208` **i18n language reset** — saved `vrcsm.language` was ignored at launch (i18nReady read `resolvedLanguage` before the detector applied the stored value). Now awaits init + reads localStorage directly.
- `d7d484e` **OSC sliders** — progress-bar-width was a bare `<Input type=range>` (near-invisible in dark theme) → styled `Slider`; added a marquee-width slider (`marqueeWidth` was wired but had no UI control and wasn't passed into the render context).
- `4f60880` **factory-reset thumbnails** — the in-app reset couldn't delete `thumb-cache-files`/`preview-cache`/`screenshot-thumbs` (WebView2 renderer holds the image handles). Now `HandlePendingFactoryReset` (next-launch, before WebView2 re-inits) wipes them.
- `d1a4d4a` **{music.lyrics} sent empty** — OscTools' `musicExtras` omitted `musicLyricLine`, so the lyrics card rendered "" even when lyrics were found. Now computes the current line each tick and threads it in.
- `821f3b7` opt-in live QQ lyric probe (DISABLED gtest).

**Now-playing capture note (verified):** the existing GSMTC path already captures QQ Music / Spotify / NetEase / browsers — VRChat need not be running. Live-probe `VRCSM_LIVE_NOWPLAYING_TEST` reads the real session via `ReadNowPlaying()`. GSMTC uses `GetCurrentSession()` (one session); a future improvement is `GetSessions()` + smart pick when multiple players run.

**Open follow-ups (do these next, all lower-risk than they look):**
1. **Online lyric-source expansion — DONE (`77393a7`).** Kugou is now the 4th source (chain LRCLIB → NetEase → QQ → Kugou) and QQ has a title-only fallback for obscure/uploaded tracks (e.g. "恶口 1&2 / undaloop" that title+artist missed). Per-source toggle + i18n shipped; tests in `lyrics.test.ts`. If a track still has no lyrics after this, it's genuinely not in any public source → the local-cache route (#2) or manual-LRC entry are the only options.
2. **Local QQ `.qrc` cache decrypt — PARKED (hard).** QQ caches every played song's lyric at `%AppData%\Tencent\QQMusic\QQMusicCache\QQMusicLyricNew\*.qrc` (encrypted). Research got the network-qrc algorithm (modified "QQ-DES", keys `!@#)(*$%123ZXC!@!@#)(NHL`, D-E-D, skip-11, zlib — canonical `des.c` at SuJiKiNen/LyricDecoder / AMLL). BUT: compiling that exact des.c (self-test passes) and decrypting the LOCAL file does NOT yield zlib — the on-disk cache uses a DIFFERENT scheme than the network qrc. Frida-hooked QQMusic: the `.qrc` open goes through `std::_Fiopen` in QQMusic.exe and the decode is **statically inlined** (no exported inflate/uncompress hit); the decoded XML is transient (memory scan found only parsed-object structures). To pursue: locate the inlined decode fn in QQMusic.exe (32-bit, MSVC2017) via `D:\Tool\debugger` (Ghidra/x64dbg), or hook `ReadFile` on the .qrc handle + set a hardware bp on the buffer. Only worth it if online sources (#1) don't cover enough — recommend #1 first.
3. **world_visits mixed-timestamp dwell hours** (from the GUI-API audit) — `joined_at` DOT-local, some `left_at` ISO `+09:00`; julianday over both gives negative, left on 0.0. Needs offset-aware normalization at the ingest layer.
4. **Audit batches B10 (smoke coverage) + B11 (dead-code)** still open.

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
