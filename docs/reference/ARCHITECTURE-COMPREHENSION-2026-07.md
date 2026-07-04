# VRCSM Architecture Comprehension (2026-07)

> Consolidated architecture map produced from a 7-domain parallel reading pass
> (core-db, core-vrchat-logic, core-realtime/integration, host-ipc,
> web-shell/state, web-feature-surface, build/packaging). Every claim below is
> traceable to one of those readers; file:line citations are theirs. This file
> is the single merged reference — prefer it over the individual domain notes.

## 1. System overview

VRCSM is a two-layer Windows desktop app: a **C++20 Win32 host** that embeds a
**WebView2** control and renders a **React 19 SPA**. The host is a thin shell —
it owns the window, the WebView2 environment, virtual-host folder mappings, and a
single JSON-RPC-style IPC bridge — while all VRChat-specific logic (cache
scanning, log parsing, SQLite persistence, the VRChat REST API, NTFS-junction
migration, realtime OSC/Discord/pipeline side-channels, and the in-process
UnityFS→glTF avatar-preview pipeline) lives in the platform-agnostic
`vrcsm_core` static library. The UI holds no platform logic; every VRChat/system
action crosses the boundary through `web/src/lib/ipc.ts` → WebView2
`postMessage` → `IpcBridge::DispatchFromOrigin` → a `bridges/*.cpp` handler →
`src/core`. Results return as `Result<T>` (a `variant<T, Error>`; no exceptions
in core), which the bridge converts to `{id, result}` or `{id, error:{code,...}}`.

```
┌───────────────────────────────────────────────────────────────┐
│  web/  (React 19 + Vite 6 + Tailwind 4 + shadcn/ui)            │  UI only, no platform logic
│  ~27 lazy pages over ~18 routes · TanStack Query · i18next     │  lib/ipc.ts is the ONLY boundary
├───────────────────────────────────────────────────────────────┤
│  src/host/  (Win32 window + WebView2 + IpcBridge)              │  thin shell; marshals JSON, threads work
│  main → App → MainWindow → WebViewHost → IpcBridge → 19 bridges│  origin-gated dispatch, thread pool
├───────────────────────────────────────────────────────────────┤
│  src/core/  (vrcsm_core static lib — all VRChat logic)         │  Result<T>, no exceptions, UTF-8 everywhere
│  DB · cache/log/API · realtime · avatar-preview · migration   │  trust boundary to user's live VRChat data
└───────────────────────────────────────────────────────────────┘
```

IPC envelope shapes:

```
Request:  { id: "uuid", method: "scan", params: {} }
Response: { id: "uuid", result: {...} }   |   { id: "uuid", error: { code, message[, httpStatus] } }
Event:    { event: "migrate.progress", data: {...} }    // unsolicited host→UI push, no id
```

---

## 2. Current working-tree state (CRITICAL — read first)

There are TWO distinct bodies of work in play; do not conflate them.

**Committed (safe to build on): the optimization pass `e5bfd8f..48c2015`.**
Recent HEAD commits include the i18n backfill (`48c2015` — 770 missing `en`
keys + a locale-coverage guard test), graph a11y (`cb8446b`), IPC response-shape
validation + monotonic stale-guard + batched `world.details` (`9df8857`), test
coverage for SafeDelete/Migrator (`1223c7a`), and the `tinygltf` dep drop
(`da5d444`). These are landed.

**RESOLVED (2026-07-04): the architecture refactor is now VERIFIED and COMMITTED.**
When this doc was first synthesized the god-object decomposition was uncommitted
and unverified (the prior session crashed on a context-full error before it could
build/test the split). It has since been verified green and committed:

- Build: `cmake --build --preset x64-debug` → rc=0, zero compile/link errors.
- Tests: `ctest` → **104/104 passed, 0 failed** (the invariant the split was
  designed around).
- Adversarial check: `Database.h` byte-frozen vs its pre-split state
  (`git diff` empty); 79 method definitions preserved across the 10 TUs with no
  duplicates or omissions.
- Commits: `1fe701f` (Database domain split) and `ecec96d` (IpcBridge decouple).

The original uncommitted state is described below for historical context.

**(historical) The refactor as it sat uncommitted:** the working tree carried a
god-object decomposition that had NOT been built or tested before the prior
session crashed:

- `src/core/Database.cpp` (was ~6059 lines) split by domain into **9 new
  `Database_*.cpp` translation units + `Database_internal.h`**
  (History / Avatars / Friends / Favorites / Analytics / AssetCache /
  Recordings / Rules / Embeddings). All 10 TUs are wired into
  `src/core/CMakeLists.txt:8-17`.
- `IpcBridge` decouple: modified `src/host/IpcBridge.{cpp,h}`,
  `src/host/bridges/LogsBridge.cpp`, `src/host/bridges/ShellBridge.cpp`,
  `src/core/Database.cpp`, `src/core/CMakeLists.txt`.
- Untracked at repo root: `2026-07-04-111708-...txt` (a large local command
  transcript, ~8000+ lines) that is NOT covered by `.gitignore` — do not
  accidentally commit it.

> **Status of this refactor: VERIFIED GREEN and COMMITTED (2026-07-04).**
> Build rc=0, `ctest` 104/104 pass, `Database.h` frozen (git-diff empty), 79
> method defs preserved with no duplicates. Committed as `1fe701f` + `ecec96d`.
> The static readers had already found the split *structurally* clean and
> complete (0 duplicate/missing public methods; all TUs include
> `Database_internal.h`; public `Database.h` API unchanged); the build+test run
> confirmed it.

> **Remote divergence (check before syncing):** local `main` is **10 ahead, 1
> behind** `origin/main`. The 1 behind is `05b4d1e ci: add dependabot for
> automated dependency updates` — a CI-only change with no source conflict against
> this work. A fresh agent should `git status`/inspect the remote before any
> `git pull` so the divergence is not a surprise.

The continuity docs disagree about this tree and are stale (see §7):
`docs/NEXT-AGENT-HANDOFF.md:8,13` claims "clean / paused", while
`MEMORY.md` (Wave-2 note, 2026-07-03) correctly says the tree is NOT clean.
Trust `git status`, not the handoff doc.

---

## 3. Subsystems

### 3.1 core-db — SQLite persistence (`src/core/Database*`)

**Purpose.** Single-connection SQLite store at
`%LocalAppData%\VRCSM\vrcsm.db` — the sole persistence layer for all
VRChat-derived local data: world visits, player events/encounters, avatar
history + benchmarks, friend logs/notes/presence, favorites, notifications,
sessions, online-entity caches, asset-metadata cache, avatar embeddings (vec0
kNN), event recordings, and the automation rules engine. It also computes
read-model analytics (unified feed, co-presence ego-network, online-window
prediction, activity heatmap, global search). One `Database` singleton, all
methods `Result<T>` (no exceptions), all thread-safe behind one `m_mutex`.

**Key files** (the just-completed domain split; `Database.h` is FROZEN):

| File | Lines | Role |
|---|---|---|
| `Database.h` | 547 | FROZEN public interface — singleton decl, all Insert/Upsert param structs, private helper decls (`InitSchema`, `ExecSimple`, `UpsertAssetCacheLocked`, `RunOnce` template, `MakeError`×2). Forward-decls `sqlite3` only, no `sqlite3.h`. |
| `Database_internal.h` | 202 | Internal (not public). Includes `Database.h`+`sqlite3.h`. Defines `detail::` RAII `StatementGuard`, bind/column helpers, `JsonObjectInt`, `TrimAscii/LowerAscii`, `RollbackIfNeeded`, and the out-of-line `RunOnce` member template so every domain TU can instantiate it. `using namespace detail;` at namespace scope. **The linchpin** — the only place `RunOnce` is defined. |
| `Database.cpp` | 942 | Lifecycle + schema: `Instance` (`:59`), `Open` (`:72`; registers sqlite-vec auto-extension, WAL, busy_timeout), `Close` (`:175`), `IsOpen` (`:188`), `DefaultDbPath` (`:194`), `InitSchema` (all DDL + migrations v4..v18 in one txn), `ExecSimple`, `MakeError`. **Only** TU that includes `sqlite-vec.h` and Win32 headers. |
| `Database_History.cpp` | 560 | world_visits + player_events/encounters + log_events + notifications + sessions. Heaviest `RunOnce` user (10 sites). |
| `Database_Avatars.cpp` | 342 | owned_avatars + avatar_history + avatar_benchmark. |
| `Database_Friends.cpp` | 1162 | friend_log/notes + presence events + analytic read-models incl. `CoPresenceEgoNetwork` (`:390-697`) and `PredictFriendOnlineWindows` (`:700-955`). Two anon namespaces (ISO8601 `ParseTimestamp/_mkgmtime` `~:31-105`; presence-interval math). |
| `Database_Favorites.cpp` | 875 | local_favorites + notes + tags; BEGIN/COMMIT txns for tags + import. |
| `Database_Analytics.cpp` | 1232 | cross-cutting reads/deletes: `ClearHistory`, `TableCounts`, `ClearTables` (allowlist-guarded bulk delete), `ActivityHeatmap`, `StatsOverview`, `GlobalSearch`. TWO anon namespaces: search helpers, then `kUsageCountTables[16]`+`kClearable[19]`+`isClearableTable`. |
| `Database_AssetCache.cpp` | 551 | asset_cache; `UpsertAssetCacheLocked` confidence-ranked upsert. |
| `Database_Recordings.cpp` | 136 | event_recordings/attendees (FK CASCADE). Smallest TU. |
| `Database_Rules.cpp` | 193 | rules/rule_firings automation engine. |
| `Database_Embeddings.cpp` | 268 | avatar_embeddings_meta + vec0 avatar_embeddings_vec; BEGIN/COMMIT to keep meta+vec in sync by avatar_id. |

**Public surface** (unchanged by the split): `Instance / Open / Close / IsOpen /
DefaultDbPath`; world/player (`InsertWorldVisit`, `MarkVisitLeft`,
`CloseOpenWorldVisits`, `RecentWorldVisits`, `RecordPlayerEvent`,
`RecentPlayerEvents`, `EncountersForUser`); log/notify/session; avatars;
friends+analytics (`CoPresenceEgoNetwork`, `PredictFriendOnlineWindows`,
`UnifiedFeed`, notes); favorites (add/remove/note/tags/lists/items/export/
import); data-mgmt/stats (`ClearHistory`, `TableCounts`, `ClearTables`,
`ActivityHeatmap`, `StatsOverview`, `GlobalSearch`); asset cache; embeddings;
recordings; rules. See §2 map for exact per-file grouping.

**Data flow.** Writes enter from host bridges via `Database::Instance().<M>()`.
`DatabaseBridge.cpp` is the fan-in point (36 distinct methods);
`EventBridge`/`RuleBridge`/`VectorBridge`/`SearchBridge` route their own
domains, mirroring the new TU boundaries. Log-tailer callbacks in the host feed
`InsertWorldVisit`/`RecordPlayerEvent`/`RecordLogEvent`/
`RecordFriendPresenceEvent`. Each method takes `m_mutex`, then either
`RunOnce(sql, bindLambda)` (one-shot writes: prepare → `StatementGuard` → bind →
`SQLITE_DONE`) or manual `sqlite3_prepare_v2`+`StatementGuard` for multi-row
reads marshaled into `nlohmann::json`. Multi-statement writes wrap
`ExecSimple("BEGIN")…COMMIT` with `RollbackIfNeeded` on error.

**Dependencies.** sqlite3 (static, `SQLITE_CORE`), sqlite-vec (only in
`Database.cpp`), nlohmann::json, fmt, `Common.h` (`Result`/`Error`/appdata/utf8),
Win32 KnownFolders (only in `Database.cpp`), `Database_internal.h` (all 10 TUs).

**Invariants.** `Database.h` API frozen; single `sqlite3*` behind one `m_mutex`
(every public method locks, helpers documented "called with m_mutex held");
no exceptions (stable codes `db_open_failed`, `db_prepare_failed`,
`db_exec_failed`, `db_bind_failed`, `db_step_failed`, `db_not_open`,
`db_invalid_argument`); every statement owned by an RAII `StatementGuard`;
multi-statement writes transactional with rollback; `InitSchema` runs ALL
DDL+migrations in one txn; `WAL`/`foreign_keys` PRAGMAs run OUTSIDE that txn;
`ClearTables`/`TableCounts` validate names against `kClearable[19]`/
`kUsageCountTables[16]` before building SQL (no injection); asset upserts never
let lower-confidence overwrite higher-confidence; `Open` idempotent for same
normalized path, errors on a different path (no hot-swap); UTF-8 at the
`sqlite3_open_v2` boundary.

### 3.2 core-vrchat-logic — cache / logs / destructive ops / REST API / auth

**Purpose.** The platform-agnostic VRChat logic: discovers and stats on-disk
cache categories + bundle breakdowns, parses output logs (batch + live-tail),
performs guarded destructive ops (safe cache deletion, NTFS-junction migration)
behind containment/ProcessGuard/reparse protections, speaks the VRChat REST API
with DPAPI-encrypted session cookies, and maintains the realtime pipeline
WebSocket. This is the trust boundary between the UI and the user's live
VRChat data.

**Key files.**

| File | Lines | Role |
|---|---|---|
| `SafeDelete.cpp` | 351 | Guarded cache deletion: category allowlist, within-base containment, `__info`/`vrc-version` preservation, no-follow-reparse walk (`removeTreeNoFollow`), ProcessGuard gate. `Plan/ExecutePlan/ResolveTargets/Execute/DeleteWithinRoot` (`:169,207,254,271,306`). |
| `Migrator.cpp` | 456 | NTFS-junction migration: preflight blockers, copy+verify (file count AND byte total), atomic rename→backup→createJunction→verify→restore-on-failure→drop-backup; re-checks VRChat not running between preflight and execute (`:138,214,421,433`). |
| `JunctionUtil.cpp` | 314 | Raw FSCTL reparse create/read/remove; bounds-validates on-disk offset/length before slicing PathBuffer (`:74,81,129,202,215`). |
| `ProcessGuard.cpp` | 151 | Detects VRChat.exe / VRChat-Win64-Shipping.exe via toolhelp; 1s-poll watcher thread (`:77,53,84,133`). |
| `CacheScanner.cpp` | 192 | `categoryDefs()` — 12-entry array, 5th field = `safe_delete`; per-category stat + recursive scan via `std::async`; skips symlinks (`:155,32,93,121`). |
| `CacheIndex.cpp` | 331 | Singleton background scanner mapping `avtr_` ids → cache version-dir via `__info`; persisted `cache-index.json` (`:73,88,122,132`). |
| `BundleSniff.cpp` | 287 | Parallel per-hash-dir aggregation of Cache-WindowsPlayer; sorts by size; UnityFS-magic classifies top-16 only (`:148,256,139`). |
| `PathProbe.cpp` | 392 | Resolves baseDir/VRChat.exe/config.json/MelonLoader/SteamVR (running proc, registry, Steam VDF) (`:344`). |
| `LogAtoms.cpp` | 571 | Stateless ~35-regex atom parser: one log body → typed `LogAtom` (`:218,269,253`). |
| `LogParser.cpp` | 1320 | Batch parser: newest-20 logs oldest-first, stateful pairing chains, per-kind caps (2000). |
| `LogTailer.cpp` | 311 | Live tailer thread: latest `output_log_*`, seeks EOF on attach, shared read, 1MiB carryover cap (`:65,75`). |
| `LogEventClassifier.cpp` | 328 | One live `LogTailLine` → JSON event via `ParseVrchatLogAtom` (`:206`). |
| `Pipeline.cpp` | 486 | WinHTTP WebSocket to pipeline.vrchat.cloud; fetches short-lived `/auth` token per (re)connect; flat 5s reconnect; force-close on Stop (`:106,120,191`). |
| `VrcApi.cpp` | 3609 | HTTP client: percentEncode/base64, `buildBasicAuthHeader`, `httpRequest` (429 retry+backoff), Set-Cookie capture, login/2FA, **~60 endpoint methods**, trusted-host+magic download validation. |
| `AuthStore.cpp` | 276 | Singleton session store: DPAPI protect/unprotect of `{auth,twoFactorAuth}` to `session.dat`, secure-wipe, `BuildCookieHeader`. |
| `VrcConfig.cpp` | 197 | config.json read/write, .bak fallback, atomic tmp+rename, ProcessGuard gate on write. |
| `VrcSettings.cpp` | 1093 | `HKCU\Software\VRChat\VRChat` read/write/export; ProcessGuard gate on WriteOne. |
| `Common.cpp` | 216 | `ensureWithinBase` containment primitive (`:191`), utf8/path helpers, `secureClearString`. |

**Data flow.** *Cache read:* `PathProbe::Probe` → `CacheScanner::scanAll`
(one `std::async` per category) → `BundleSniff::scanCacheWindowsPlayer` (thread
pool per top-hash dir) → `Report.cpp` folds totals. `CacheIndex` runs an
independent thread reading `__info` (16KiB cap). *Delete:* `SafeDelete::Plan` →
UI → `Execute` re-validates each target (`ensureWithinBase` + category-child +
preserved check), refuses reparse points, `removeTreeNoFollow` unlinks (never
descends) junctions; gated by `ProcessGuard`. *Migrate:* preflight → copy →
verify file-count AND byte-total → rename source→`.vrcsm-bak` → createJunction →
verify → restore-on-failure / drop-backup. *Log batch:* `LogParser::parse`
newest-20 oldest-first, sticky timestamp + pairing state. *Log live:*
`LogTailer` polls 1s, `LogEventClassifier` types each line. *API:*
`getLoadedCookieHeader` (DPAPI) → rate-limited `httpRequest` (429 retry) with
percent-encoded path params. *Login:* Basic auth (percent-encode user:pass then
base64) → maybe `Requires2FA` → `verifyTwoFactor` stores twoFactorAuth cookie.
*Pipeline:* `fetchPipelineToken` → WebSocket `?auth=<token>`.

**Invariants.** Destructive local mutations MUST check
`ProcessGuard::IsVRChatRunning()` first (online API writes need not);
`__info`/`vrc-version` at Cache-WindowsPlayer ROOT preserved and never deleted;
targets must pass `ensureWithinBase` (absolute + lexically_normal, does NOT
resolve junctions) AND be a category child; never descend NTFS reparse
points (top-level refused, nested unlinked not recursed — `remove_all` avoided
because it follows junctions); migration verifies BOTH file count and byte
total before rename, aborts on leftover `.vrcsm-bak`, restores backup on any
post-rename failure; migrate/repair source must be one of
`cache_windows_player`/`http_cache`/`texture_cache`; `readJunctionTarget`
bounds-validates attacker-influenceable offsets; VrcApi path params
percent-encoded; session cookies only DPAPI-encrypted at rest, secure-wiped
from heap; only `api.vrchat.cloud`/`*.vrchat.cloud`/`assets.vrchat.com` https
trusted for image/bundle downloads (+UnityFS-magic structural validation);
UTF-8 everywhere.

**Single source of truth to remember:** `CacheScanner::categoryDefs()` (12
entries) is what `SafeDelete`, `Migrator`, and `JunctionUtil` all key off by
`def.key` string literal — adding/renaming a category ripples across all three.
`ensureWithinBase` deliberately uses `absolute()`+`lexically_normal()` (NOT
`weakly_canonical()`) so user-relocated cache dirs via junctions still pass
containment — which is exactly why `SafeDelete` needs the SEPARATE explicit
reparse-point refusal.

### 3.3 core-realtime/integration — OSC / Discord / toasts / VR diag / avatar-preview

**Purpose.** The core's outward-facing, best-effort surface: realtime side
channels (OSC UDP client+server, Discord Rich Presence over named pipe, Windows
toast + XSOverlay VR notifications), serialized child-process machinery
(`TaskQueue` + Job Object), integration/diagnostics (SteamVR vrsettings, VR link
repair with backup/restore, process-memory reader, screenshot watcher, PNG
metadata inject, rate limiter, full report aggregation), and the in-process
avatar-preview pipeline (UnityFS bundle → glTF `.glb`) + embeddings. Everything
here is deliberately decorative: integrations fail silently and never surface
hard errors.

**Key files.**

| File | Lines | Role |
|---|---|---|
| `OscBridge.cpp` | 459 | OSC 1.0 UDP client (`Send`) + server (`ListenLoop` thread); pure encode/parse helpers unit-tested. |
| `TaskQueue.cpp` | 308 | Single-worker serialized queue, per-key dedup/cancel + Job Object kill-on-close; `SpawnAndWait` polls 500ms honoring cancellation. |
| `DiscordRpc.cpp` | 435 | Named-pipe client; worker reconnects every 30s, `SET_ACTIVITY` on dirty; fire-and-forget. |
| `ToastNotifier.cpp` | 428 | Unpackaged-app WinRT Action Center toasts (AUMID + Start-menu `.lnk`); `FormatPipelineToast` is the shared untrusted-content validator/formatter. |
| `VrOverlayNotifier.cpp` | 127 | XSOverlay VR notification via UDP to 127.0.0.1:42069; reuses `FormatPipelineToast` so desktop + VR never drift. |
| `VrDiagnostics.cpp` | 2226 | Largest file in this domain. network/GPU/audio/SteamVR diagnostics + `RepairSteamLink` (dryRun default true) with backup/restore path allowlists. |
| `AvatarPreview.cpp` | 1375 | Preview orchestrator: source resolution (local/cache/download), GLB cache + LRU trim with lease/retain, bundle-index persistence, extractor invocation. |
| `UnityPreview.cpp` | 900 | `extractBundleToGlb`: full in-process UnityFS→Mesh→adaptive-filter→glTF pipeline (replaced the external PyInstaller extractor). |
| `UnityBundle.cpp` | 800 | UnityFS v6/7/8 parser + LZ4/LZMA block decompress; `validateUnityBundleStructure` for the download boundary. |
| `UnityMesh.cpp` | 700 | Hand-decoder for Unity Mesh class-43 payloads. |
| `UnitySerialized.cpp` | 530 | SerializedFile (CAB blob) metadata parser; TypeTree intentionally not parsed. |
| `SteamVrConfig.cpp` | 426 | steamvr.vrsettings read/merge-write, UTF-8 sanitize, atomic .tmp/.bak/rename; blocks writes while SteamVR running. |
| `ProcessMemoryReader.cpp` | 132 | Toolhelp32 attach + RPM pointer-chain reader; minimal rights to reduce anti-cheat flags. |
| `ScreenshotWatcher.cpp` | 230 | `ReadDirectoryChangesW` for VRChat PNGs; 10s dedup + 250ms flush; CancelIoEx+CloseHandle to stop. |
| `PngMetadata.cpp` | 286 | PNG tEXt inject/read with own CRC32; atomic `.vrcsm-part` write. |
| `RateLimiter.cpp` | 72 | Process-wide token bucket (15 req/60s) singleton; sleeps with lock released. |
| `Report.cpp` | 158 | `BuildFullReport` fans out CacheScanner/BundleSniff/AvatarData via `std::async`. |
| `AvatarIdHarvest.cpp` | 68 | Regex-scans `amplitude.cache` JSON-lines for `avtr_*` ids. |

**Data flow.** *OSC out:* `osc.send` → `HandleOscSend` (PipelineBridge.cpp:314)
validates address starts `/`, coerces args, `OscBridge::Send` opens a fresh UDP
socket per call, big-endian 4-byte-padded encode, sendto 127.0.0.1:9000. *OSC
in:* `osc.listen.start` → `ListenLoop` bound to :9001 → `ParseOscMessage` →
`PostEventToUi("osc.message")`. *Discord:* `SetActivity` stores JSON + dirty
flag; worker connects `\\.\pipe\discord-ipc-{0..9}`, handshakes, writes
`SET_ACTIVITY`. *Notifications:* VRChat pipeline events → `FormatPipelineToast`
(untrusted-data validation) shared by BOTH `ToastNotifier` (WinRT XML) and
`VrOverlayNotifier` (XSOverlay UDP). *Avatar preview:* `Request` →
`preparePreviewSource` (explicit bundlePath → LocalAvatarData/Cache-WindowsPlayer
by scanning `__info` for the `avtr_` id, cached in `bundleMapCache` + persisted
`bundle-index.json` → assetUrl download via VrcApi) → FNV-1a `sourceSig` → GLB
cache hit or `runNativeExtractor` → `extractBundleToGlb` → sidecar metadata JSON
+ LRU trim.

**Invariants.** UTF-8 in core; integrations are fire-and-forget and never raise;
DiscordRpc refuses empty client_id; `RepairSteamLink` defaults `dryRun=true`
(destructive execute needs `dryRun=false`; `backupOnly` forces all destructive
flags off); `SteamVrConfig::Write` refuses while SteamVR running, merge
semantics, atomic .tmp/.bak/rename, shared `sanitizeUtf8`; `TaskQueue`
concurrency == 1, Submit with existing key cancels the older, Job Object
`KILL_ON_JOB_CLOSE`; preview cache keys deterministic (`preview-v5` + avatarId +
`sourceSig` embedding size+mtime), LRU trim skips leased/retained paths;
SteamLink restore/backup gated by `IsSteamLinkRestoreTargetAllowed` /
`IsSteamLinkBackupSourceAllowed`; OSC/XSOverlay only ever SEND to loopback, OSC
listener binds 127.0.0.1 only; VR overlay + desktop toast MUST notify on
identical events (both through `FormatPipelineToast` — do not fork gating);
`~IpcBridge` shutdown order is deliberate (stop log tailer before locked members
are destroyed).

### 3.4 host-ipc — Win32 + WebView2 + the IpcBridge dispatch hub (`src/host`)

**Purpose.** The Win32 exe (`VRCSM.exe`) hosting embedded WebView2 that renders
the SPA, routing every UI→native request through one JSON-RPC-style `IpcBridge`.
Thin shell: owns window lifecycle, WebView2 environment/controller, virtual-host
folder mappings, URL-protocol registration (`vrcsm://`, `vrcx://`), and
dispatches all VRChat logic into `src/core`.

**Key files.** `main.cpp` (77 — wWinMain: DPI, OleInitialize STA,
`RegisterProtocolHandlers`, `ToastNotifier::EnsureSetup`, `App::Run`) →
`App.cpp` (88 — message loop + logging; `HandlePendingFactoryReset` wipes
WebView2 user-data dir via marker) → `MainWindow.cpp` (234 — borderless Mica
window; WndProc: WM_CREATE, WM_SIZE, 3 custom WM_APP messages) →
`WebViewHost.cpp` (682 — virtual-host mappings, top-frame + plugin-iframe
`WebMessageReceived` handlers, origin extraction, `PostMessageToWeb` UI-thread
marshaling, navigation/popup containment, plugin frame tracking) →
`IpcBridge.cpp` (965 — the dispatch hub: `DispatchFromOrigin` origin-gate,
`RegisterHandlers` ~160 methods, `AsyncMethodSet`, `IpcThreadPool` 2-8 workers,
`PostResult/PostError/PostEventToUi`, EnqueueAsync drain, ctor opens
DB/AuthStore/CacheIndex/ProcessGuard). `IpcBridge.h` (393) owns all core members
(LogTailer, Pipeline, DiscordRpc, OscBridge, ScreenshotWatcher, TaskQueue,
VrcRadarEngine) + concurrency state. `bridges/BridgeCommon.h` (51 —
`unwrapResult`, `JsonStringField`, `ParamInt`). Support: `ScreenshotThumbs.cpp`
(399 — 2-worker WIC JPEG pool, MTA COM per worker), `VrchatPaths.cpp` (219),
`UrlProtocol.cpp` (165), `StringUtil.cpp` (78 — strict Utf8↔Wide).

**The 19 bridges** (all in `src/host/bridges/`, wired in
`src/host/CMakeLists.txt`): `AuthBridge` (191), `ApiBridge` (1320 — ~50 VRChat
REST handlers, largest), `CacheBridge` (191), `HwBridge` (224),
`SettingsBridge` (113), `MigrateBridge`, `ScreenshotBridge` (307),
`SearchBridge`, `ShellBridge` (650), `LogsBridge` (563), `RadarBridge`,
`DatabaseBridge` (1090 — the DB fan-in), `PluginBridge` (353),
`UpdateBridge` (405), `PipelineBridge` (540), `VectorBridge`, `VrDiagBridge`,
`RuleBridge`, `EventBridge`. Bridges are NOT self-registering — `IpcBridge::
RegisterHandlers()` (`:623-869`) emplaces lambdas forwarding to member `Handle*`
functions compiled in the separate bridge TUs. The decouple is purely a
header/compile-time split: heavy core types are forward-declared/`unique_ptr`'d
in `IpcBridge.h` so the bridge TUs don't recompile against Pipeline/LogTailer.
`plugin.*` handlers live in a separate `m_pluginHandlers` map (extra
`callerPluginId` arg).

**Data flow.** Inbound: React `chrome.webview.postMessage(JSON)` → WebViewHost
`add_WebMessageReceived` (main frame) or `ICoreWebView2Frame2` handler (plugin
iframes, via `add_FrameCreated`) fires on the UI thread → reads
`args->get_Source()` for `originUri` → `IpcBridge::DispatchFromOrigin(originUri,
json)` (`:458`). Dispatch parses `{id, method, params}`, classifies origin
(`PluginRegistry::PluginIdFromOrigin` → `callerPluginId`; else
`HostFromOrigin` must equal `app.vrcsm` or reject with `forbidden_origin`).
Plugin origins may only reach `PluginReachableMethods` (just `plugin.rpc`).
Method lookup: `m_pluginHandlers` (`plugin.*` — always async) then `m_handlers`.
If `method ∈ AsyncMethodSet()` → queued on the shared `IpcThreadPool`
(`hardware_concurrency` clamped 2..8); else runs inline on the UI thread.
Handler returns json → `PostResult`; throws `IpcException` (carries
`core::Error`) → `PostError` preserving code; throws `std::exception` →
`PostError("handler_error")`. Outbound: `PostResult/PostError/PostEventToUi`
build the envelope and call `WebViewHost::PostMessageToWeb`, which ALWAYS
marshals through `PostMessageW(WM_APP_POST_WEB_MESSAGE)` with a heap
`WebPostPayload{json,targetPluginId}`; `MainWindow::HandleMessage` →
`DeliverWebMessage` on the UI thread routes to the plugin iframe
(`ICoreWebView2Frame2::PostWebMessageAsString`) when `targetPluginId` is set,
else the main frame. Pushed events (no `id`): `process.vrcStatusChanged`,
`logs.stream(.event)`, `pipeline.event`/`state`, `osc.message`,
`screenshots.new`, `migrate.progress`/`done`, `avatar.preview.progress`,
`update.progress`, `auth.loginCompleted` (~14 distinct names).

**Invariants.** Only `https://app.vrcsm/` may reach the full `m_handlers`; every
other origin rejected unless a recognized `plugin.<id>.vrcsm`; plugin iframes may
ONLY call `plugin.rpc` (all else tunneled so `PluginRegistry::CanInvoke` sees the
real caller; `plugin.*` recursion and `vrchat://` opens hard-blocked inside);
`PostMessageToWeb` must marshal onto the UI thread; plugin responses must target
the specific `ICoreWebView2Frame2`; async handlers touch bridge state only
through the alive `shared_ptr` guard — `~IpcBridge` sets `*m_alive=false`, drains
active tasks (5s bounded), then stops LogTailer BEFORE the mutex members it
locks are destroyed (member declaration order matters); `data.clear` accepts
only allowlisted target keys (key selects a compile-time path/table list, never
a path segment); filesystem-exposing handlers (`bundle.preview`, `screenshots.*`,
`fs.appDataDir`) must `ensureWithinBase`; `factoryReset` must NOT delete install
artifacts; top-frame navigation gated to app.vrcsm, `NewWindowRequested` always
suppressed; every credential local scrubbed via `secureClearString` on all
return paths.

**Network posture.** All WebView2 virtual hosts are local-folder mappings, not
sockets: `app.vrcsm` (ALLOW), `preview.local`/`thumb.local`/`screenshots.local`/
`screenshot-thumbs.local` (ALLOW), per-plugin `plugin.<id>.vrcsm` (DENY_CORS,
isolating plugins). The only listening socket is the OSC UDP listener
(`osc.listen.start`, default :9001) with **NO authentication** — any local
process can send OSC datagrams. There is no inbound HTTP server; the IPC surface
is reachable only from inside WebView2, gated by origin classification, NOT a
network ACL.

### 3.5 web-shell/state — IPC client + React Query + contexts (`web/src/lib`)

**Purpose.** The SPA shell and global-state plumbing: the JSON-RPC IPC client to
the host, the TanStack React Query cache, four nested context providers (Auth,
VrcProcess, Report, PluginRegistry) + RightDock, hash-router lazy pages, and
app-shell hooks bridging the VRChat pipeline WebSocket into query cache, toasts,
Discord presence, and the screenshot watcher. Owns all cross-page global state
and the single source of truth for auth/session, VRChat process status, and the
cache-scan report.

**Key files.** `main.tsx` (63 — createRoot under StrictMode + **HashRouter**,
splash fade). `App.tsx` (632 — provider tree + AppContent). `lib/ipc.ts` (3492 —
`IpcClient`, `IpcError`, pending-promise map with per-method timeouts, opt-in
result-shape validators, `cancelAll` on session reset, and the entire browser-dev
mock switchboard). `lib/auth-context.tsx` (336 — login/verify2FA/logout/refresh,
30s visibility-gated poll, pipeline lifecycle follow, account-scoped cache reset).
`lib/report-context.tsx` (100 — single cache-scan report, in-flight dedup).
`lib/vrc-context.tsx` (54). `lib/plugin-context.tsx` (61). `lib/queryClient.ts`
(12 — staleTime/gcTime 5min, retry 1, refetchOnWindowFocus off). `lib/
query-keys.ts` (71 — typed `qk` factory, root keys for bulk invalidation).
`hooks/useIpcQuery.ts` (16 — `useQuery` keyed `[method, params]`).
`lib/pipeline-events.ts` (77). `lib/friends-pipeline.ts` (117 —
`applyFriendPipelineEvent` reducer, stamps `__touchedAt`). `lib/
useFriendsPipelineSync.ts` (198 — bridges friend-* events into friends.list
cache + persists diffs). `lib/cache-ownership.ts` (76 —
`resetAccountScopedCaches`). `lib/useStrangerAlert.ts` (157). `lib/
useDiscordPresence.ts` (222 — privacy gate). `lib/useOscStudio.ts` (673). `lib/
types.ts` (720 — DTOs incl. `FriendsListResult.__touchedAt`).

**Data flow.** Outbound: `ipc.call(method, params)` (ipc.ts:657) → uuid +
`{id,method,params}`, registers a `Pending` with a timeout (60s default, 15min
for `LONG_RUNNING_METHODS`), `bridge.postMessage(JSON)`. Inbound: `IpcClient.
handle` (`:592`) parses each frame; `event` frames dispatch on an internal
EventTarget (consumed by `ipc.on`/`subscribePipelineEvent`); `id` frames look up
the Pending slot, clear its timer, and either reject with `IpcError` (also firing
`vrcsm:auth-expired` when `isAuthExpired`), or run `checkResultShape(method,
result)` and reject on `shape_mismatch` else resolve. Browser-dev (no
`window.chrome.webview`): `call()` routes to `mockCall` (`:709`). State fan-out:
pipeline `friend-*` → `useFriendsPipelineSync` → `applyFriendPipelineEvent` →
`qc.setQueriesData` on `qk.friends.root` (also persists diffs via more
`ipc.call`). Auth transitions in `commitStatus` (`:136`) call
`resetAccountScopedCaches` (cancel in-flight IPC, clear localStorage,
`removeQueries` on account-scoped roots).

**Invariants.** Every pending call has a finite timeout (no Pending leak);
result-shape validation is OPT-IN and incremental (registered: `auth.status`,
`auth.user`, `friends.list`, `scan`, `db.stats.overview`) — unregistered methods
keep cast-only behavior; **`db.stats.overview` validator MUST check
`total_world_visits`** (the real `Database::StatsOverview` alias), NOT
`total_visits` (an earlier draft used `total_visits`, which rejects every real
host response — ipc.ts:459-465); `FriendsListResult.__touchedAt` is a
CLIENT-ONLY monotonic `Date.now()` marker never sent by the host, re-stamped on
every local mutation; the friends live-poll discards its own response when
`prev.__touchedAt > started` so a slow full-fetch can't clobber a newer pipeline
merge (Friends.tsx:1190); friends cache keyed `['friends.list', undefined]`,
sync writes via `qc.setQueriesData({queryKey: qk.friends.root})`; account-scoped
cache reset runs on logout/auth-expired/account-switch but NOT login; pipeline
WebSocket lifecycle strictly follows `status.authed`; provider nesting order is
load-bearing (`Auth > VrcProcess > Report > PluginRegistry > RightDock`);
routing is HashRouter (`#/path`), host passes initial route via `?initialRoute=`
consumed once then scrubbed.

### 3.6 web-feature-surface — pages, routes, i18n (`web/src/pages`, `components`, `i18n`)

**Purpose.** The presentation layer: ~33 page-module files across **~18
routable screens** (many `pages/*.tsx` are actually panels/tabs consumed by a
parent, so the file count overstates routes), all lazy-loaded and coordinated by
`App.tsx`. UI only — every action goes through `lib/ipc.ts`.

**Route table** (App.tsx:527-559, single source of truth for navigation):
`/`→Dashboard; `/bundles`→Bundles; `/library`→Library; `/avatars`→ModelsHub;
`/models`→redirect `/avatars?tab=owned`; `/worlds`→Worlds; `/friends`→Friends;
`/groups`→Groups; `/profile`→Profile; `/vrcplus`→redirect
`/vrchat?tab=vrcplus`; `/vrchat`→VrchatWorkspace; `/screenshots`→Screenshots;
`/friend-log`→redirect `/radar`; `/history/worlds`→WorldHistory;
`/calendar`→Calendar; `/rules`→Rules; `/events`→EventRecorder;
`/social`→SocialGraph; `/benchmark`→AvatarBenchmark; `/fbt`→FbtMonitor;
`/logs`→Logs; `/radar`→Radar; `/migrate`→Migrate; `/settings`→Settings;
`/tools/memory-radar`→MemoryRadar; `/tools/osc`→OscTools;
`/plugins`→PluginsMarket; `/plugins/installed`→PluginInstalled;
`/plugins/:id`→PluginDetail; `/p/:pluginId/*`→PluginHost (sandboxed iframe);
`*`→redirect `/`.

**Composition to remember.** Several files are sub-tabs/panels, not routes:
`FriendLog/Feed/GameLog` → Radar; `Avatars/ModelDb` → ModelsHub; `workspace/*`
→ VrchatWorkspace; `Settings/*` tabs → Settings; `osc/*` (8 subcomponents) →
OscTools. Redirect aliases: `/models`→`/avatars?tab=owned`,
`/vrcplus`→`/vrchat?tab=vrcplus`, `/friend-log`→`/radar`. Right dock only
renders on `/`, `/bundles`, `/settings` (`routeAllowsRightDock`, App.tsx:449);
other pages contribute panels via `RightDockProvider`.

**Recently changed (committed).** `Friends.tsx` (~1060 lines): a per-row
`world.details` query (N+1) was eliminated — worldIds are now collected once and
batched via `useQueries` (dedup by `['world.details',{id}]`).
`RelationshipGraph.tsx`: a11y — `sr-only aria-live=polite` focus announcements,
`role=img`+aria-label, keyboard-reachable nodes (`role=button`, `tabIndex=0`,
Enter/Space) mirroring the `Avatars.tsx` pattern; has a dedicated test.
`i18n/index.ts`: 7 locales (en, ja, ko, ru, th, hi, zh-CN), en fallback; `en.json`
backfilled 770 keys; `locale-coverage.test.ts` guards drift.

**Invariants.** `web/` is UI-only (all actions via `lib/ipc.ts`); the App.tsx
route table is the single nav source (new page = `lazy()` import + `<Route>` +
routeMeta breadcrumb/title); every page `React.lazy`-loaded behind Suspense; all
user-facing strings via i18next `t()` with `en.json` as the coverage baseline
(coverage test must stay green); a11y pattern for interactive non-button
elements is `role=button`+`tabIndex=0`+Enter/Space; Friends world resolution must
stay batched (`useQueries`), not per-row; TS strict, no `any`, function
components only.

### 3.7 build/packaging — CMake + vcpkg + Vite + WiX (root, `cmake/`, `installer/`, `scripts/`)

**Purpose.** The CMake+vcpkg graph producing `vrcsm_core` (static),
`VRCSM.exe` (WebView2 host), tools, and tests; the separate pnpm/Vite frontend
build whose `dist/` is copied into host output by POST_BUILD scripts; and the
WiX v7 MSI / `package_release.ps1` pipeline.

**Key files.** `CMakeLists.txt` (50 — reads root `VERSION` as single version
truth → project version, C++20, `/utf-8 /W4 /permissive-`, finds
nlohmann_json/fmt/spdlog, adds src/ + 6 tools gated by `VRCSM_BUILD_TOOLS=ON` +
tests). `CMakePresets.json` (43 — only `x64-debug`/`x64-release` configure+build,
Ninja+vcpkg+x64-windows; **no testPresets** — ctest is run by explicit
`--test-dir`). `src/core/CMakeLists.txt` (139 — `vrcsm_core` STATIC; now lists 9
`Database_*.cpp` + `Database.cpp` at lines 8-17; vendored `sqlite-vec.c`
`SQLITE_CORE=1`; links sqlite3/lz4/LibLZMA + updater + hw + WinRT). `src/host/
CMakeLists.txt` (123 — `vrcsm` WIN32 exe; 19 bridge .cpp; three POST_BUILD:
sync-web-dist, icon, sync-plugins; install RUNTIME DESTINATION .).
`cmake/sync-web-dist.cmake` (28 — POST_BUILD, no-op if `web/dist` missing else
REMOVE_RECURSE dest + `file(COPY)`; web/dist is NOT a CMake output).
`cmake/sync-plugins.cmake` (25). `installer/vrcsm.wxs` (98 — WiX v7 perUser to
LocalAppData\VRCSM; groups HostFiles/WebFiles(exclude `ort-wasm*.wasm`)/
BundledPlugins/Shortcuts; MajorUpgrade AllowSameVersionUpgrades).
`scripts/build-msi.bat` (60). `package_release.ps1` (end-to-end packager; the
`SHA256:` release-notes line is a hard updater constraint). `vcpkg.json` (14 —
v0.14.6; `tinygltf` dropped). `web/package.json` (63 — v0.14.6; build =
`tsc -b && vite build`; includes `@huggingface/transformers` →
onnxruntime-web/ort-wasm). `web/vite.config.ts` (40 — `base './'`,
`__VRCSM_ASSET_REV__` timestamp, manualChunks, target esnext).

**Data/build flow.** Version flows from root `VERSION` into three consumers
(`CMakeLists.txt` → app.rc; `vcpkg.json`; `web/package.json` — all `0.14.6`).
Build order: `pnpm build` in `web/` emits `web/dist` → `cmake --build` produces
`VRCSM.exe` and its POST_BUILD steps copy web/dist, icon, plugins/ next to the
exe. **web/dist is deliberately NOT a CMake artifact**, so the frontend must be
rebuilt before the host or a stale/no-op copy results (a known operational
gotcha — `ninja: no work to do` skips the sync; the handoff notes repeatedly had
to re-run `cmake -P sync-web-dist.cmake` manually). Packaging:
`package_release.ps1`/`build-msi.bat` reads VERSION, verifies `VRCSM.exe` +
`web/index.html` exist, `wix build` on `installer/vrcsm.wxs` harvesting
host+web/**+plugins/**, computes SHA256 into release-notes; the in-app updater
(`UpdatePackage.cpp`) fails-closed unless a matching `SHA256:` line is present.

**Invariants.** Version single-sourced from `VERSION` (VERSION, vcpkg.json,
web/package.json all `0.14.6`); `web/dist` must be rebuilt BEFORE the host build;
sync-web-dist/sync-plugins purge (REMOVE_RECURSE) the destination first to
prevent stale-chunk leakage; MSI must exclude `ort-wasm*.wasm` (~23.5MB,
default-off CLIP feature, ~80% installer bloat); `package_release.ps1`'s
`SHA256:` line is a hard fail-closed updater constraint; tech stack is locked
(C++20 + WebView2 + React 19 + Vite 6 + Tailwind 4 + shadcn + WiX v7;
Qt/Electron/Tauri/WPF/etc forbidden); MSVC runtime is MultiThreadedDLL,
`gtest_force_shared_crt ON` must match.

---

## 4. IPC protocol spec

**Envelope.** Request `{id, method, params}`; response `{id, result}` or
`{id, error:{code, message[, httpStatus]}}`; event `{event, data}` (no `id`,
unsolicited host→UI push).

**Dispatch** (`IpcBridge::DispatchFromOrigin(originUri, jsonText)`,
IpcBridge.cpp:458 — the single entry every WebView2 message hits;
`IpcBridge::Dispatch(json)` at IpcBridge.h:59 is a legacy/test shim that assumes
the `https://app.vrcsm/` origin):

1. Parse `{id, method, params}`.
2. Classify origin: `PluginRegistry::PluginIdFromOrigin` → `callerPluginId`;
   else `HostFromOrigin` must equal `app.vrcsm` or reject `forbidden_origin`.
   Plugin origins may reach only `PluginReachableMethods` (just `plugin.rpc`).
3. Look up `m_pluginHandlers` (`plugin.*`, extra `callerPluginId` arg — always
   async) then `m_handlers`.
4. **`AsyncMethodSet()`**: if `method ∈` this hand-maintained string set, the
   handler is queued on the shared `IpcThreadPool` (`hardware_concurrency`
   clamped 2..8 — NOT a per-call detached thread, contrary to CLAUDE.md); else it
   runs inline on the UI thread. A method registered but omitted from the set
   silently runs on the UI thread (blocking risk). Known defect: a duplicate
   `db.coPresenceGraph` entry (IpcBridge.cpp:210,240).
5. Handler returns `nlohmann::json` → `PostResult`. Throws `IpcException`
   (carries `core::Error`) → `PostError` with the stable code+httpStatus
   preserved. Throws other `std::exception` → `PostError("handler_error",
   what())`.

**Result<T> → JSON error.** Core returns `Result<T> = variant<T, Error>` (no
exceptions). Bridges call `unwrapResult()` (BridgeCommon.h) or throw
`IpcException(Error)` to preserve the machine-readable code. Frontend receives
`{id, error:{code, message[, httpStatus]}}` as an `IpcError` (ipc.ts:383) with a
`.isAuthExpired` getter that fires a window-level `vrcsm:auth-expired`
CustomEvent so pages don't each need auth-check logic.

**Event push.** `PostEventToUi(event, data, targetPluginId)` →
`WebViewHost::PostMessageToWeb` → ALWAYS marshaled through
`PostMessageW(WM_APP_POST_WEB_MESSAGE)` (worker threads must not call
`PostWebMessageAsString` directly) → `DeliverWebMessage` on the UI thread routes
to a specific `ICoreWebView2Frame2` when `targetPluginId` set, else the main
frame. ~14 pushed event names: `process.vrcStatusChanged`, `logs.stream(.event)`,
`pipeline.event`, `pipeline.state`, `osc.message`, `screenshots.new`,
`migrate.progress`, `migrate.done`, `avatar.preview.progress`, `update.progress`,
`auth.loginCompleted`.

**Bridge inventory (19 + BridgeCommon.h).** Method groups (all found, grouped):

- **app/shell** — `app.version`, `app.factoryReset`, `path.probe`,
  `process.vrcRunning`, `autoStart.get/set`, `shell.pickFolder`, `shell.openUrl`,
  `fs.listDir/writePlan/appDataDir`.
- **cache** — `scan`, `bundle.preview`, `delete.dryRun/execute`.
- **settings** — `settings.readAll/writeOne/exportReg`, `config.read/write`.
- **steamvr** — `steamvr.read/write`, `steamvr.link.diagnose/repair/backups/
  restore`.
- **migration** — `migrate.preflight/execute`, `junction.repair`.
- **vr/hw** — `vr.diagnose`, `vr.audio.switch`, `hw.detect/recommend/
  applyPreset/telemetry`, `memory.status`, `radar.poll`.
- **auth** — `auth.status/login/verify2FA/logout/user`.
- **thumbnails/assets** — `thumbnails.fetch`, `images.cache`,
  `assets.resolve/prefetch/invalidate`.
- **vrchat-api (~50, ApiBridge)** — `friends.list/unfriend/request`,
  `groups.list/setRepresented`, `moderations.list`,
  `calendar.list/discover/featured`, `jams.list/detail`,
  `avatar.details/parameters.local/select/search`, `avatar.bundle.download`,
  `world.details`, `instance.details`, `worlds.search`, `users.boop`,
  `inventory.list`, `prints.list/get/upload/delete`,
  `files.list/uploadImage/delete`,
  `avatars.updateImage/listOwned/harvestIds/update/delete`,
  `user.invite/inviteTo/requestInvite/getSavedMessages/mute/unmute/block/unblock/
  me/search/getProfile/updateProfile`, `visits.list`.
- **avatar-preview** — `avatar.preview(.status/.prefetch/.abort/.retain/
  .release)`.
- **events/rules** — `event.start/stop/list/attendees/addAttendee/delete`,
  `rules.list/get/create/update/delete/setEnabled/history`.
- **screenshots** — `screenshots.list/open/folder/delete/watcher.start/
  watcher.stop/injectMetadata/readMetadata`.
- **logs** — `logs.stream.start/stop`, `logs.files.clear`.
- **pipeline/notif/social** — `pipeline.start/stop`,
  `notifications.list/accept/respond/see/hide/clear`, `message.send`,
  `notify.setPrefs`.
- **discord** — `discord.setActivity/clearActivity/status`.
- **osc** — `osc.send/listen.start/listen.stop`.
- **update** — `update.check/download/install/skipVersion/unskipVersion/
  getState`.
- **db** — `db.worldVisits.list`, `db.playerEvents.list`, `db.playerEncounters`,
  `db.coPresenceGraph`, `db.avatarHistory.list/count/record/resolve`,
  `db.avatarBenchmarks.list`, `db.stats.heatmap/overview`, `db.history.clear`.
- **data** — `data.usage/clear`, `search.global`.
- **favorites** — `favorites.lists/items/add/remove/note.set/tags.set/
  syncOfficial/export/import`.
- **friend\*** — `friendLog.insert/recent/forUser`, `friendNote.get/all/set`,
  `friendPresence.record/recent/predict`, `feed.unified`.
- **vector** — `vector.upsertEmbedding/search/getUnindexed/removeEmbedding`.
- **plugin** — `plugin.list/install/uninstall/enable/disable/marketFeed/rpc`.

---

## 5. Invariants & gotchas (consolidated — the load-bearing rules)

**Data & schema**
- **`Database.h` public API is FROZEN.** The domain split changed no signatures;
  every declared public method is implemented exactly once across the 10 TUs
  (`RunOnce` is a header-inline template; `MakeError` has 2 legit overloads in
  `Database.cpp`). Do not add methods to the header casually.
- One `sqlite3*` behind one `m_mutex`; every public method locks, helpers are
  "called with m_mutex held". No exceptions in core — stable `Result<T>` codes.
- `InitSchema` runs ALL DDL + v4..v18 migrations in one transaction;
  `WAL`/`foreign_keys` PRAGMAs run OUTSIDE it. Multi-statement writes are
  transactional with `RollbackIfNeeded`.
- **`db.stats.overview` contract: `total_world_visits`, not `total_visits`.**
  This is the real `Database::StatsOverview` alias; the frontend validator and
  any consumer must use it (an earlier `total_visits` draft rejected every real
  host response — ipc.ts:459-465).

**UTF-8 boundary**
- UTF-8 everywhere in core and web; `wchar_t` only at the Win32 API boundary,
  converted immediately via `toUtf8`/`toWide`/`utf8Path` (core) and `StringUtil`
  strict invalid-char conversion (host). Never let locale bytes reach
  `nlohmann::json::dump`.

**Destructive operations**
- Every destructive local-file op checks `ProcessGuard::IsVRChatRunning()` first
  (`SafeDelete::ExecutePlan`, `Migrator::execute` re-checks after preflight,
  `VrcConfig::WriteJson`, `VrcSettings::WriteOne`). Online API writes need not.
- Preserve `__info` and `vrc-version` at the Cache-WindowsPlayer ROOT — never
  deleted.
- Targets must pass `ensureWithinBase` (absolute + lexically_normal, does NOT
  resolve junctions) AND be a category child; never descend NTFS reparse points
  (`removeTreeNoFollow`, not `remove_all`).
- `RepairSteamLink` defaults `dryRun=true`; destructive execute needs
  `dryRun=false` explicitly; `backupOnly` forces destructive flags off.
- `data.clear`/`ClearTables` accept only allowlisted keys/table names
  (`kClearable[19]`/`kUsageCountTables[16]`) — the key selects a compile-time
  path/table list, never contributes a path segment. There is NO dry-run at the
  DB layer (dry-run lives in `SafeDelete` for the filesystem, not the DB).
- `factoryReset` must NOT delete install artifacts (.exe/.dll/web/WebView2);
  the WebView2 dir is wiped on next launch via a marker.

**Concurrency / lifecycle**
- **C++ single-build-dir, no-concurrency rule:** there is only one build output
  tree per preset; the frontend `web/dist` must be rebuilt (`pnpm build`) BEFORE
  the C++ host build or the POST_BUILD copy no-ops / ships a stale bundle. Do not
  run two builds against the same build dir concurrently.
- `~IpcBridge` shutdown order is deliberate: set `*m_alive=false`, drain async
  tasks (5s bounded — does NOT force-kill wedged workers), then stop LogTailer
  BEFORE the mutex members it locks are destroyed. Member declaration order
  matters.
- `PostMessageToWeb` must marshal onto the UI thread; plugin responses must
  target the specific frame.
- `FriendsListResult.__touchedAt` is a CLIENT-ONLY monotonic marker, never sent
  by the host — re-stamp on every local mutation or the stale-guard breaks.

**Process / policy**
- **Main-agent-commits rule:** never push directly to `main`; only create commits
  when explicitly asked. (Repo policy + git-safety.) Adding a page = `lazy()`
  import + `<Route>` + routeMeta entry (App.tsx is the single nav source).
- Tech stack is locked (see §3.7). Version single-sourced from `VERSION`.
- Plugin iframes may ONLY call `plugin.rpc`; only `https://app.vrcsm/` reaches
  the full handler map. The OSC UDP listener (:9001) has NO auth — any local
  process can send it datagrams.

---

## 6. Risks / tech debt (ranked)

1. **Untested irreversible paths (HIGH).** The DB bulk-delete paths
   (`ClearTables`/`ClearHistory`/`ClearFavoritesBySource`) are guarded only by an
   allowlist with no dry-run at that layer; `RepairSteamLink`/
   `RestoreSteamLinkBackup` move/delete SteamVR config files (execute path,
   `dryRun=false`, is the deep-audit's flagged untested-irreversible hazard); the
   `Migrator` rename→junction window can leave the cache at `.vrcsm-bak` with no
   junction on an OS kill (manually recoverable, no per-file hash — only
   count/byte verify). Per MEMORY deep-audit, irreversible paths are historically
   under-tested.
2. **God-objects (HIGH, being addressed).** `VrcApi.cpp` (3609 lines — HTTP core
   + ~60 endpoints + login/2FA + uploads + trust validation in one TU),
   `VrDiagnostics.cpp` (2226 — diagnostics + irreversible SteamVR moves),
   `LogParser.cpp` (1320 — large stateful `ParseState`), `IpcBridge` (~160
   handlers + all realtime members + 8 mutexes/atomics — the single coupling
   point). `Database.cpp` decomposition is the in-flight fix but even post-split
   `Database_Friends.cpp` (1162) and `Database_Analytics.cpp` (1232) retain
   god-functions (`CoPresenceEgoNetwork` ~300 lines, `PredictFriendOnlineWindows`
   ~255 lines) that resisted the split and remain hardest to test.
   `Friends.tsx` (~1060) and `App.tsx AppContent` (~600) are the web analogues.
3. **Shutdown / hang surface (MEDIUM).** The 5s async drain does not force-kill
   wedged workers — a truly stuck worker leaks past shutdown (no longer hangs it).
   `DiscordRpc::Stop` closes the pipe handle from the Stop thread while the worker
   may be blocked in a synchronous `ReadFrame` (`m_pipe` is a plain `void*` with
   no mutex — a data race / potential use-after-close, DiscordRpc.cpp:204-303,
   385-431); the handshake/activity path has no read timeout, bounded only by app
   shutdown.
4. **Plugin sandbox gaps (MEDIUM).** `PluginHost.tsx` renders arbitrary plugin
   content at `/p/:pluginId/*`; per-plugin `plugin.<id>.vrcsm` hosts are DENY_CORS
   isolated and plugins can reach host methods only by tunneling through
   `plugin.rpc` behind `CanInvoke` — but `fs.writePlan` is a general-ish write
   surface reachable by a permission-granted plugin (ShellBridge.cpp:335). Treat
   plugin-supplied content as untrusted.
5. **Frontend contract-drift bugs (MEDIUM).** `ipc.ts` mock switchboard (~150
   methods) drifts from the real host contract (the `db.stats.overview`
   `total_visits` regression is the canonical example). `useStrangerAlert` reads
   friends via a hardcoded `['friends.list']` literal, not `qk.friends.list()`
   (useStrangerAlert.ts:81). Two parallel friends caches coexist (Friends.tsx
   local `useState` vs the React Query cache). `useFriendsPipelineSync` fires
   unbounded fire-and-forget `ipc.call` side-effects per friend-update event.
6. **Lower-severity smells.** `AsyncMethodSet` is hand-maintained and must stay
   in sync with `RegisterHandlers` (has a duplicate `db.coPresenceGraph`); OSC
   `Send` opens+closes a socket per call; `LogTailer` seeks EOF on attach (a gap
   window vs batch parser; >1MiB carryover silently dropped);
   `ProcessMemoryReader.ReadString` emits unvalidated UTF-8; `[session-diag]`
   spdlog::warn traces in `AuthStore` log encrypted-blob byte counts;
   copy-paste `samePathLexical` across Migrator/JunctionUtil/SafeDelete; the WiX
   `web\**` glob is a denylist (one `ort-wasm*` Exclude) so future large
   default-off assets get swept into the MSI.

---

## 7. Doc drift to fix

The readers found the following stale claims. None are fixed by this document —
they need edits in the cited docs (respecting the main-agent-commits rule).

- **CLAUDE.md:59 (and AGENTS.md:59, identical text): "React SPA with 10
  lazy-loaded pages".** Actual: `web/src/App.tsx:48-74` declares ~27 top-level
  `lazy()` page imports across ~18 routable screens (~2.7× understated). Fix to
  "~27 lazy-loaded pages" or drop the count. The stale string is duplicated
  across both primary agent-facing docs.
- **CLAUDE.md "Error Handling" / architecture describes `Database.cpp`
  monolithically** and documents `IpcBridge::Dispatch()` as the router. Reality:
  `Database.cpp` is now split into 10 TUs + `Database_internal.h` (uncommitted),
  and production dispatch is `DispatchFromOrigin(originUri, json)` — `Dispatch()`
  is a legacy/test shim (IpcBridge.h:59).
- **CLAUDE.md async-dispatch note: "spawn a detached worker thread".** Actual: a
  fixed shared `IpcThreadPool` clamped 2..8 (IpcBridge.cpp:39-99).
- **CLAUDE.md IPC event example lists only `migrate.progress`** — there are ~14
  distinct pushed event names (§4).
- **`Database.h` header comment (lines 22-38)** frames schema as "CREATE TABLE IF
  NOT EXISTS + user_version, without a full migration framework" — `InitSchema`
  now carries a full v4..v18 migration ladder with `ALTER TABLE` adds and a
  de-dupe DELETE.
- **MEMORY `codebase-load-bearing-facts` references a 6059-line
  `Database.cpp`** — now split into ~7010 lines across 11 files. The allowlist
  fact still holds. MEMORY.md / `docs/NEXT-AGENT-HANDOFF.md` should record the
  split per the handoff rule for cache/DB behavior changes.
- **`docs/NEXT-AGENT-HANDOFF.md:8,13`: "working tree clean / active development
  paused".** Reality: uncommitted Database split + IpcBridge/LogsBridge/
  ShellBridge changes; development ongoing. This directly conflicts with
  `MEMORY.md`'s Wave-2 note ("working tree NOT clean", 2026-07-03) — the two
  continuity docs disagree.
- **`docs/MD-INDEX.md` and `NEXT-AGENT-HANDOFF.md` "Last updated: 2026-06-25"** —
  both predate the 2026-07-04 i18n commit and the Database-split work; both
  indexes are behind current reality.
- **`docs/reference/04-build-release.md:52-58` i18n key table is STALE** (post
  `48c2015`). Doc says `en.json`=1833 keys with zh-CN a +770 superset (en behind
  Chinese). Verified on disk: `en.json`=2603 leaf keys, zh-CN=2603 (parity; en is
  now the canonical superset with zero CJK). The doc's "zh-CN is the de-facto
  superset / en lags" narrative is INVERTED. The ja/ko/ru/hi (1548) and th (1567)
  deficit numbers ("295/297 missing") are also wrong — real gaps are ~1055 /
  ~1036 against the 2603-key en.
- **`docs/reference/04-build-release.md:60-63,106` "no build/test i18n gate;
  only manual `pnpm i18n:check`".** False — `48c2015` added
  `web/src/i18n/__tests__/locale-coverage.test.ts` (a vitest asserting en ⊇
  zh-CN). An automated coverage guard now exists.
- **`docs/reference/04-build-release.md:75` "VRCSM_Tests = CommonTests.cpp (84
  TEST/TEST_F) + PluginManifestTests.cpp (15)".** Point-in-time count; Wave-2
  atoms/tests (AvatarIdHarvest, 17 new log atoms, SafeDelete/Migrator coverage)
  have since landed, so treat "84" as approximate/low. (This is the "ctest-104"
  suite being verified in §2.)
- **`docs/reference/04-build-release.md:83-84` smoke-route counts (21
  pages-smoke / 27 interaction-smoke)** disagree with the review's ~20-entry
  pages-smoke table (missing `/fbt`, `/rules`, `/events`, `/friend-log`,
  `/tools/memory-radar`, `/migrate`); neither reflects the ~31 route entries in
  App.tsx.
- **`Pipeline.cpp` header comment (lines 29-31): reconnect backoff "5s→10s→30s→
  60s cap".** Actual `WorkerLoop` uses a FLAT 5s wait (Pipeline.cpp:211-216) — the
  design note contradicts the code.
- **`docs/reference/core/realtime-integrations.md:61: "dryRun default true
  (:1579)"** generalized to the SafeDelete/Migrator local-cache layer, which has
  NO boolean `dryRun` default — safety there is structural (Plan vs Execute,
  allowlist, ProcessGuard). The `dryRun=true` default is real only for
  `RepairSteamLink`.
- **`docs/VRCSM-PLAN.md:41: IPC registry "16 methods".** The VrcApi surface alone
  (`VrcApi.h`) exposes ~60 endpoint methods; the host IPC surface is ~160. Badly
  out of date.
- **`AvatarPreview.h:43-49` error-code taxonomy lists AssetRipper/fbx2gltf codes
  (`extractor_missing`, `converter_missing`, `converter_failed`)** — the pipeline
  is now fully in-process (`UnityPreview`); `runNativeExtractor` only emits
  `encrypted`/`bundle_invalid`/`typetree_unsupported`/`no_meshes`/`preview_failed`/
  `cancelled` (AvatarPreview.cpp:1028-1038). The AssetRipper-era codes and the
  "AssetRipper + fbx2gltf" docstring (`:36-37`) are dead/misleading.
- **`TaskQueue.h:63-64` references a `SpawnInJob()` method that does not exist**
  (actual API is `SpawnAndWait`).
- **`DiscordRpc.h:51-52` says fallback pipes are "-1..-9"** — code iterates
  `discord-ipc-0..9` (DiscordRpc.cpp:222).
- **`UnitySerialized.h:28` error code "sf_typetree_unsupported" vs
  AvatarPreview expecting "typetree_unsupported" (no `sf_` prefix)** — verify the
  actual emitted string matches what `runNativeExtractor` checks.
- **`docs/reference/04-build-release.md:69` flags a hardcoded default API key
  literal committed in `web/scripts/i18n-translate.mjs:29`** — key-hygiene smell
  to scrub.


