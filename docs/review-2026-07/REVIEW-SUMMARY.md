# VRCSM Review 2026-07 — Master Summary

Date: 2026-07-01 (updated — cpp-core area added post-synthesis)
Synthesis of all 6 area reports under `docs/review-2026-07/`:
`area-cpp-core.md`, `area-cpp-host-ipc.md`, `area-web-lib.md`,
`area-web-pages.md`, `area-diff.md`, `area-build-docs.md`. All file:line
citations below are carried verbatim from those reports; no new locations were
invented. Read-only synthesis.

> Coverage note: `area-cpp-core.md` failed twice during the automated workflow
> and was produced afterward in a dedicated follow-up pass; its findings are now
> folded in below (see core H1 / M-core-1 / M-core-3). All six areas are now
> covered. The cpp-core pass read SafeDelete, CacheScanner, JunctionUtil,
> PathProbe, AuthStore, BundleSniff/UnityBundle in full and confirmed the
> destructive + credential surfaces are well-defended; the new findings are a
> radar-engine data race and reparse-point (junction) handling gaps.

---

## Executive Summary

**Overall health: good.** No CRITICAL findings in any area. The high-risk core
changes in this Wave-2 working tree are net **hardening, not regressions** —
three genuine audit fixes land here (Migrator integer-overflow on
`file_size()==-1`, Migrator count-verify before source→backup rename, and a
fail-closed updater SHA256 that rejects releases with empty `expectedSha256`),
plus CacheIndex id-shape/within-base validation and lock-snapshotting. Secret
scanning of added code found no credentials, tokens, or private connection info;
Discord RPC deliberately omits join secrets and ships dark by default. The
WebView2 worker→UI marshaling and the plugin origin gate (plugins confined to
`plugin.rpc`) are both sound.

**Biggest risks, in order:**

1. **Shutdown use-after-free (host H3).** `~IpcBridge` stops four background
   subsystems but never stops `m_logTailer`. Because `m_logTailer` is declared
   *before* the mutexes its callback locks, `~LogTailer`'s thread join happens
   *after* those mutexes/maps are destroyed — a non-deterministic crash on exit
   whenever VRChat is writing its log as the app closes. The prior pass
   mis-cleared this; the declaration order is the bug. This is the only
   memory-safety defect found and it is real.

2. **WebView2 containment is partially open (host H1, host H2).** No
   `NewWindowRequested`/`NavigationStarting` handlers means any script in the
   trusted frame (or a compromised plugin asset) can spawn popups to arbitrary
   origins or navigate the top frame away from `app.vrcsm` inside the app's own
   chrome. Separately, `shell.openUrl` is reachable by plugins via the broad
   `ipc:shell` token and turns `vrchat://launch` into an authenticated
   `inviteSelf` account action — a plugin can teleport the signed-in user
   between instances. Both touch the app's primary trust boundary.

3. **Long-session resource growth in the frontend (lib H1, H2, H3).** The
   long-running-method timeout exemption reopens the unbounded-pending-promise
   leak the timeout was meant to fix (no cancellation, no reaping on logout);
   the three image/thumbnail/asset caches use `FOREVER` TTL or uncapped Maps
   with no eviction; and overlapping `cacheImageUrls` batches can flap to
   fallback and re-fetch. All three degrade over the multi-hour sessions this
   app is built for.

4. **Concurrency + junction handling in core (core H1, M-core-1, M-core-3).**
   `VrcRadarEngine` is a single shared object with no lock, driven from both the
   IPC thread pool and the screenshot-watcher thread, racing on a kernel HANDLE
   (possible double-`CloseHandle` → process-wide corruption). Separately,
   reparse points are trusted lexically but never inspected: `JunctionUtil` can
   over-read on crafted offsets, and `SafeDelete`'s `remove_all` will follow a
   junction planted in a category and delete **outside** the cache root. The
   destructive/credential surfaces are otherwise well-defended (SafeDelete
   dry-run + `__info`/`vrc-version` preservation, AuthStore DPAPI, UnityFS bounds
   checks all verified sound).

**Cross-cutting themes:** (a) commit hygiene — two untracked scratch artifacts
would be swept in by a blanket `git add`; (b) i18n drift — hardcoded English
strings embedded in otherwise fully-translated surfaces; (c) `any` at the IPC
boundary violating the locked no-`any` standard; (d) continuity docs assert a
"clean/paused" tree that contradicts the large in-flight Wave-2 change set.

---

## Severity-Ranked Findings (de-duplicated)

| Severity | Area | file:line | Issue | Fix |
|---|---|---|---|---|
| **CRITICAL** | — | — | None found in any area. | — |
| **HIGH** | cpp-core (H1) | `src/core/VrcRadarEngine.cpp:231-334`; `src/core/ProcessMemoryReader.cpp:49-55`; owner `src/host/IpcBridge.h:349` | **[concurrency: shared kernel HANDLE]** Single shared `m_radarEngine` has no mutex, but `PollOnce()` is reached concurrently from the IPC thread pool (`radar.poll` async, `RadarBridge.cpp:35`) and the ScreenshotWatcher callback thread (`PipelineBridge.cpp:424`). One thread's `Detach()`/`CloseHandle` can race another's `Attach`/`ReadProcessMemory` → data-race UB and possible double-`CloseHandle` of an OS-reused handle (process-wide corruption). Radar is read-only vs VRChat so user data is safe. | Serialize the attach→scan→detach sequence under one `std::mutex`, or give the engine a single poll thread + double-buffered published snapshot read under lock. |
| **HIGH** | host-ipc (H3) | `src/host/IpcBridge.cpp:387-417`; `IpcBridge.h:322`; `src/host/bridges/LogsBridge.cpp:170-360` | **[safety: ProcessGuard-adjacent shutdown]** `~IpcBridge` never calls `m_logTailer->Stop()`; tailer declared before the mutexes (`:355`,`:362`) its guard-less callback locks → `~LogTailer` join runs after those mutexes/maps are destroyed → shutdown use-after-free when VRChat is actively logging. | Add `if (m_logTailer) m_logTailer->Stop();` early in dtor (by `ProcessGuard::StopWatcher()` at `:394`); add early `if (!*m_alive) return;` at top of tailer callback (`LogsBridge.cpp:172`). |
| **HIGH** | host-ipc (H1) | `src/host/WebViewHost.cpp:228-366` | **[safety: WebView2 origins]** No `NewWindowRequested`/`NavigationStarting` handlers — scripts/plugin assets can `window.open` to arbitrary origins or navigate the top frame off `app.vrcsm` inside app chrome (phishing/takeover surface). | Add `add_NewWindowRequested` → `put_Handled(TRUE)` routing external URLs through the `shell.openUrl` allow-list (`ShellBridge.cpp:151-158`); add `add_NavigationStarting` (+ frame variant) → `put_Cancel(TRUE)` for any non-`app.vrcsm`/non-plugin-host top-level nav. |
| **HIGH** | host-ipc (H2) | `src/host/bridges/ShellBridge.cpp:143-214`; `src/core/plugins/PluginRegistry.cpp:43,49` | **[safety: account-scoping / account mutation]** `shell.openUrl` accepts `vrchat://launch` → `VrcApi::inviteSelf(location)` (authenticated teleport) and `ShellExecuteW` arbitrary `http(s)`/`vrchat` URLs; reachable by plugins via the broad `ipc:shell` token. | Split the `vrchat://launch`→`inviteSelf` branch into a dedicated narrowly-gated method or restrict it to the `app.vrcsm` SPA; drop `shell.openUrl` from the broad `ipc:shell` token so only `ipc:shell:openUrl` enables it. |
| **HIGH** | web-lib (H1) | `web/src/lib/ipc.ts:291-307`, `:501-524` | In-flight IPC promises for `LONG_RUNNING_METHODS` disable the 60s timeout (`timerId` stays null); if the host never replies, the pending slot + awaiting Promise/spinner leaks for the window's lifetime. No caller cancellation despite the comment. | Give long-running methods a finite ceiling (10–15 min) or expose an `AbortSignal`; at minimum add `cancelAll()` invoked on auth-expired/logout to reap stale slots. |
| **HIGH** | web-lib (H2) | `web/src/lib/image-cache.ts:21-23,79-84,118-124`; `thumbnails.ts:48,138,242`; `assets-cache.ts:42` | Image/thumbnail/asset memo Maps store entries at `FOREVER` (POSITIVE_INFINITY) TTL with no size cap or LRU; grow monotonically across a long browsing session until logout → unbounded heap growth in a hours-long WebView2 process. | Add a max-entry ceiling (~2–4k) with insertion-order/LRU eviction, or attach a long finite TTL so stale keys fall out of `isFresh`. Apply to all three caches. |
| **HIGH** | web-lib (H3) | `web/src/lib/image-cache.ts:147-158,162-201` | Overlapping `cacheImageUrls` batches: an id awaiting a prior batch's derived promise resolves to `null` if that batch rejects (negative not recorded) → thumbnail flicker to fallback and re-fetch on concurrent list+detail mounts. | After `await hit.promise`, re-read `memo.get(key)` and prefer a freshly-resolved entry; in the shared `catch`, only delete keys still pending for *this* batch. |
| **HIGH** | build-docs (H1) *(= diff L1)* | repo root: `_build_b.bat`, `avatars-zh-review.png` | **[commit hygiene]** Neither is gitignored (`git check-ignore` → exit 1); a blanket `git add .` commits a non-portable hardcoded-VS-path launcher and a throwaway 106 KB review screenshot. *(diff rated this LOW; build-docs HIGH — flagged at the higher severity because the release flow tends toward `git add .`.)* | Add `_build*.bat` and `*-review.png` (or `tmp/`) to `.gitignore`; verify with `git check-ignore`. Stage files explicitly, never `git add .`. |
| **HIGH** | build-docs (H2) | `src/core/LogAtoms.cpp:90,541-543`; `src/core/LogParser.h:363` | `UdonException` is the only one of 17 new Wave-2 log atoms with **no** golden-line test (`grep udon` matches header field only); its regex + `udon_exceptions` aggregation can regress silently. | Add a `ParseVrchatLogAtom` golden-line case asserting `kind==UdonException` + captured message, plus a report-level `udon_exceptions` assertion mirroring `SessionModeAndDiagnostics` (`tests/CommonTests.cpp:2043`). |
| **MEDIUM** | host-ipc (M1) | `src/host/IpcBridge.cpp:306-313`, `:555-558` | Non-string `id` makes `ExtractId` throw `type_error` → caught as `invalid_request` with **no id** in the reply → frontend promise (keyed by id) never settles (self-inflicted hang). | In `ExtractId`, coerce/stringify non-string ids; ensure catch-all salvages any id for the error echo. |
| **MEDIUM** | host-ipc (M2) | `src/host/bridges/ShellBridge.cpp:216-322`; `PluginRegistry.cpp:44` | **[safety: plugin filesystem reach]** `fs.listDir` enumerates all logical drives and lists any caller-supplied dir with no base containment; granted to plugins via `ipc:fs:listDir` → filesystem reconnaissance (paths, usernames, installed apps). | Confine to an allow-listed root set (appDataRoot, VRChat dirs, user-picked folder) via `ensureWithinBase`, as `fs.appDataDir` does (`ShellBridge.cpp:421-429`), or gate behind explicit install-time consent. |
| **MEDIUM** | host-ipc (M3) | `src/host/bridges/ShellBridge.cpp:330-398`; `PluginRegistry.cpp:45` | **[safety: plugin filesystem reach]** `fs.writePlan` writes fixed-name `.vrcsm-upload-plan.json` (JSON-validated, ≤1MB) into any caller-supplied existing dir, no base confinement; granted to plugins. Bounded write primitive into arbitrary dirs. | Confine writes under an allow-listed base (user-picked upload folder or appDataRoot) via `ensureWithinBase`. |
| **MEDIUM** | diff (M1) | `src/core/VrcApi.cpp:2355` | `fetchInstance` interpolates raw `location` into the request path without `percentEncode` — every sibling new endpoint encodes; instance-id tails legitimately contain `~ ( ) ,` → malformed/mis-parsed requests. Matches tracked roadmap M4. | Split `location` into world id + instance segment and `percentEncode` each, like the neighboring handlers. |
| **MEDIUM** | web-lib (M3) *(= diff M2)* | `web/src/lib/ipc.ts:362,367,371,381,391,403,413,447,2055,2063,2177,2238,2243,2267,2461,2483,2497,2517,2753,2761`; `types.ts:385,393` | New VRC+/prints/files/inventory wrappers return `{ items: any[] }` etc. and `writeConfig`/`writeSteamVrConfig` take `any`; `SteamVrConfig` has `[key:string]:any` — violates the locked no-`any` TS standard, loses type safety at the IPC boundary. | Define DTO interfaces in `types.ts` (already grew ~219 lines this wave) and wire them in; replace `any` index signatures with explicit fields or `unknown`+narrowing. Leave the documented `avatar-embedding.ts:103 as any`. |
| **MEDIUM** | web-lib (M4) | `web/src/lib/cache-ownership.ts:11-18`; `web/src/pages/Friends.tsx:957-973` | **[safety: account-scoping]** `vrcsm.friends.cache.v1` key is duplicated as a literal in two places (no shared constant) and the cache is written from a *page* (against the lib-layering rule); a rename in one spot silently breaks account-scoped clearing → friend data from account A persisting into account B. | Export `FRIENDS_CACHE_KEY` from a lib module and import in `Friends.tsx`; move read/write helpers into `web/src/lib`. |
| **MEDIUM** | web-lib (M1) | `web/src/lib/auth-context.tsx:172-198,200-225`; `ipc.ts:523` | No live leak today (verified no `console.*` of params), but `login`/`verifyTwoFactor` pass plaintext password/2FA code through `call()`→`JSON.stringify`→`postMessage`; a future one-line debug log would dump credentials. | Add a redaction guard for an `AUTH_METHODS` set if any request logging is introduced; add a lint/unit assertion that `call()` never stringifies params to console. |
| **MEDIUM** | web-lib (M2) | `web/src/lib/thumbnails.ts:273-300`; `assets-cache.ts:239-259` | Low-priority prefetch `setTimeout` pumps are module-global, re-arm while queue non-empty, and only cleared on account reset — keep firing IPC after the consuming page unmounts. Bounded/self-terminating, not a true leak. | Gate the pump on ≥1 mounted listener (`listeners.size>0`). |
| **MEDIUM** | web-pages (M6) | `web/src/pages/Friends.tsx:1147-1152`; `web/src/lib/friends-pipeline.ts:36-39` | **[real-time correctness]** Live-poll stale-guard keeps `prev` only if `prev.__polledAt > started`, but `__polledAt` is stamped only on poll results — pipeline events carry none, so a pipeline presence update merged mid-poll is reverted by the older in-flight poll. Inline comment claims this is handled; it is not. Self-heals on next event. | Track `lastMergeAtRef` in the pipeline effect and discard polls with `started < lastMergeAtRef.current`, or carry a monotonic version on every merge. |
| **MEDIUM** | web-pages (M7) | `web/src/pages/radar/InstanceRoster.tsx:89`; `web/src/lib/pipeline-events.ts:75` | `usePipelineEvent("user-location", inline arrow)` with a fresh handler each render on a hot, frequently-re-rendering component → subscribe/unsubscribe churn (no event loss). | Wrap handler in `useCallback` (only dep `setLivePlayers` is stable). |
| **MEDIUM** | web-pages (M8) | `web/src/pages/SocialGraph.tsx:93-96` | Entire fetch wrapped in `try{...}catch{}` (empty) — DB/IPC failures are indistinguishable from "no data yet"; no error UI/retry. Contrast `WorldHistory.tsx:195-201`. | Add an `error` state + small banner; reserve empty-state copy for genuinely empty. |
| **MEDIUM** | web-pages (M1) | `web/src/pages/Logs.tsx:658-670,1393` | `FILTER_LABELS` is literal English rendered directly (no `t()`); this change extends it to 11 buckets (incl. new `notifications`/`session`/`diagnostic`) without localizing → English filter row in zh-CN. | Replace with `t("logs.filter.<key>")`; add 11 entries to both `en.json`/`zh-CN.json`. |
| **MEDIUM** | web-pages (M2) | `web/src/components/FriendDetailDialog.tsx:150-159,839` | `eventDescription()` returns literal English ("Became friends", "Avatar → …") rendered inside an otherwise `t()`-localized dialog → mixed-language output for zh-CN. | Route each branch through `t("friendDetail.event.<type>", {old,new})` with interpolation; add keys to both locales. |
| **MEDIUM** | web-pages (M4) | `web/src/components/ActivityHeatmap.tsx:40` | Returns `null` while `isLoading` then pops in — layout shift/flash on WorldHistory while siblings render a card frame immediately. Cosmetic. | Render the `Card` shell with a fixed-height placeholder grid during load. |
| **MEDIUM** | web-pages (M5) | `web/src/components/RelationshipGraph.tsx:197,200-203`; `SocialGraph.tsx:165` | Nodes bind `onSelect` with `role="button"`+`cursor:pointer`+aria-label, but the only caller passes no `onSelect` → focusable button-looking nodes that do nothing (a11y/affordance mismatch). | Pass an `onSelect` opening the user popup, or drop `role="button"`/`cursor-pointer` when no handler. |
| **MEDIUM** | web-pages (M3) | `web/src/i18n/locales/en.json:826` | `statusBar.onlineCount` (`"{{count}} friends online"`) has no `_one` form → "1 friends online". (Not a missing-key bug — `friends.totalCount` plurals resolve fine.) | Add `statusBar.onlineCount_one`/`_other` (zh-CN count-invariant). |
| **MEDIUM** | build-docs (M5) | `MEMORY.md:18-22`; `docs/NEXT-AGENT-HANDOFF.md:8` | **[continuity drift]** Both assert "paused"/"clean tree after v0.14.6" while 60+ modified files + new C++ + 17 log atoms + workspace refactor are uncommitted — a fresh agent would assume no in-flight work and could clobber it. | Refresh both docs to record in-progress Wave 2; update "Last updated" stamps (currently `2026-06-24`/`2026-06-25`). |
| **MEDIUM** | build-docs (M4) | `docs/MD-INDEX.md:55,59,63` | MD-INDEX references `BEAT-VRCX-PLAN.md`, `CACHE-ARCHITECTURE.md`, `ENHANCEMENT-ROADMAP.md` as checked-in, but all are **untracked** (`??`); two new planning docs (`SURPASS-VRCX-MASTER-PLAN.md`, `WAVE2-SPEC.md`) and `wave2-research/` are absent from the index. | Commit those docs (preferred — MEMORY treats them as continuity surface) or remove dangling entries; add the new docs once tracking is decided. |
| **MEDIUM** | build-docs (M2) | `web/src/__tests__/pages-smoke.test.tsx:129-149` | Smoke table (20 entries) omits 6 live routes: `/fbt`, `/rules`, `/events`, `/friend-log`, `/tools/memory-radar`, `/migrate` → crash-on-mount regressions in those pages pass CI. | Add the 6 routes to the smoke `routes` array with permissive `/./` markers. |
| **MEDIUM** | build-docs (M3) | `web/src/lib/` (`thumbnails.ts`, `seenThumbnails.ts`, `library.ts`, `experimental.ts`, `ui-prefs.ts`, `vrcFriends.ts`, `useDiscordPresence.ts`, `useFriendsPipelineSync.ts`) | Modules touched this wave with no `__tests__` (23 others have them) → pure-logic caching/dedupe/prefs can regress silently. | Add focused vitest specs for the pure-logic ones (`seenThumbnails`, `library`, `ui-prefs`). |
| **MEDIUM** | build-docs (M1) | `CLAUDE.md:59`; `AGENTS.md:59` | "React SPA with 10 lazy-loaded pages" — actual is 27 `lazy()` imports / 31 routes. | Change to "~27 lazy-loaded pages" or drop the hard count. |
| **MEDIUM** | cpp-core (M-core-1) | `src/core/JunctionUtil.cpp:106-112` | **[safety: untrusted reparse data]** `SubstituteNameOffset`/`SubstituteNameLength` (on-disk WORDs) slice a `std::wstring` from the 16 KiB ioctl buffer with no bounds check → a crafted mount-point can over-read ~49 KiB. | Validate offset+length against `ReparseDataLength`/bytes-returned before slicing. |
| **MEDIUM** | cpp-core (M-core-3) | `src/core/SafeDelete.cpp:166` (lexical-only `ensureWithinBase`) | **[safety: data deletion]** MSVC `remove_all` recurses through mount-point junctions, so a junction planted inside a safe-delete category passes the lexical within-base check yet deletes data **outside** `baseDir`. | Reject `FILE_ATTRIBUTE_REPARSE_POINT` targets before `remove_all` (don't follow junctions during delete). |
| **MEDIUM** | cpp-core (M-core-2) | `src/core/UnityBundle.cpp` (`uncompressedInfoSize`) | Untrusted-binary parse bounds-checks reads and caps block/node counts + 2 GiB data, but the `uncompressedInfoSize` allocation has no cap → a crafted header can request a large allocation before any payload is read. | Cap `uncompressedInfoSize` to a sane max (mirror the 2 GiB data cap / block-count cap) before allocating. |
| **LOW** | host-ipc (L1) | `src/host/WebViewHost.cpp:246-249,273-320` | **[safety: WebView2 origins]** `app.vrcsm` and the four asset hosts mapped `ALLOW` (cross-origin) rather than `DENY_CORS`; real exposure limited because plugin frames are `DENY_CORS`. | Use `DENY_CORS` for `preview.local`/`thumb.local`/`screenshots.local`/`screenshot-thumbs.local`. |
| **LOW** | host-ipc (L2) | `src/host/IpcBridge.cpp:486,525,548` | `handler_error` replies echo `ex.what()` to the renderer; many handlers (`fs.listDir`/`fs.writePlan`) embed absolute paths → path disclosure to untrusted frames. | Map exceptions to generic messages for untrusted/plugin frames; keep detail in logs. |
| **LOW** | host-ipc (L3) | `src/core/plugins/PluginRegistry.cpp` (`SanitiseForHostLabel`) | Plugin host-label reverse lookup returns the first label match, not exact id; two ids differing only by `.`/`-` collide → message could be evaluated against the wrong permission set. Narrow precondition. | Forbid colliding ids at install time, or carry the real plugin id in the frame mapping. |
| **LOW** | cpp-core (L-core-1) | `src/core/UnityBundle.cpp` (size accumulation) | Cosmetic signed-overflow UB on a size accumulation that the validate-side path already handles correctly; no exploit path given the upstream caps. | Use unsigned/checked arithmetic to match the validate path. |
| **LOW** | diff (L2) | `src/host/IpcBridge.cpp:202,229` | `"db.coPresenceGraph"` listed twice in the `AsyncMethodSet()` literal (set dedups; harmless) — copy-paste residue from the Track-4 merge. | Remove the duplicate at `:229`. |
| **LOW** | diff (L3) | `src/core/VrcApi.cpp:104` | `kApiKey` is the well-known **public** VRChat client apiKey (pre-existing, reused) — informational, not a secret leak. | None. |
| **LOW** | diff (L4) | `src/core/AvatarIdHarvest.{h,cpp}`; `web/src/lib/experimental.ts:34-40` | New reader of VRChat's Amplitude analytics cache; strictly read-only, no network/mutation, default-OFF behind `vrcsm:experimental:amplitudeHarvest`. Behavior matches contract — not a defect, flagged for awareness. | None. |
| **LOW** | web-lib (L1) | `web/src/lib/status-presets.ts:87` | `addPreset` id `sp_${Date.now()}_${existing.length}` can collide on sub-ms double-add → duplicate React key / wrong-row delete. | Use `crypto.randomUUID()` (already used at `ipc.ts:332`). |
| **LOW** | web-lib (L2) | `web/src/lib/status-presets.ts:107-116,123-142` | `useStatusPresets` re-parses JSON every render and `subscribe` fires on every storage/ui-pref event regardless of key (unlike `notifications.ts`). Minor waste. | Filter `subscribe` by `STORAGE_KEY`; memoize `parsePresets(raw)`. |
| **LOW** | web-lib (L3) | `web/src/lib/vrchat-server-status.ts:78` | `setStatus((prev)=>prev)` on fetch failure is a no-op write. Cosmetic. | Drop the line. |
| **LOW** | web-lib (L4) | `web/src/lib/image-cache.ts:147-158` | Per-item loop awaits each pending hit sequentially before the batch `need` collection → latency on big mixed batches. Correctness fine. | Collect pending hits and `Promise.all` after the loop. |
| **LOW** | web-pages (L1) | `web/src/components/RelationshipGraph.tsx:131,154` | `svgRef` created/attached but never read — dead code. | Remove the ref. |
| **LOW** | web-pages (L2) | `FriendDetailDialog.tsx:503,787,876,905`; `ProfileCard.tsx:532,569,608` | Index-based React keys on lists that reorder/dedupe (avatar history filtered for uniqueness) → potential stale DOM. | Use a stable id (`ev.new_value`, `entry.name`, url string). |
| **LOW** | web-pages (L6) | `web/src/components/RelationshipGraph.tsx:189-192` | `graph.edges.some(...)` inside the node `.map` for the hover `dim` flag → O(nodes×edges) per hover; layout is memoized but this scan is not → hover jank at the ~60-node cap. | `useMemo` an adjacency map (`user_id → Set<neighbor>`) and look up in render. |
| **LOW** | web-pages (L7) | `web/src/pages/radar/InstanceRoster.tsx:60,99-108` | Hardcoded English `title="Click to change limit"`; `livePlayers` never seeded from the current instance and never evicts non-terminal leavers → starts empty, accumulates stale entries over a long session. | Use `t()` for the tooltip; seed from `dbPlayerEvents` join/leave pairing and prune on world change. |
| **LOW** | web-pages (L4) | `web/src/components/NotificationsInbox.tsx:198-205` | Mark-seen effect deliberately omits `items` from deps (fire-once-on-open); a notification arriving while the drawer is open isn't marked until reopen. Acceptable trade-off, documented. | None required. |
| **LOW** | build-docs (L1) | `CHANGELOG.md:1-2` | `[Unreleased]` says development paused; omits the 17 new atoms / harvest / OSC changes on disk. | Add Wave-2 entries as work lands. |
| **LOW** | build-docs (L2) | `CMakePresets.json` | No `testPresets`; `ctest --preset` unavailable, baseline hardcodes the build dir path. | Add a `testPresets` block bound to `x64-release`/`x64-debug`. |
| **LOW** | build-docs (L3) | `package_release.ps1:79-94,100` | The `SHA256:` release-notes paste is a manual step gated only by a `Write-Host` reminder; if skipped, the fail-closed in-app updater can't install. | Have the `gh release edit --notes-file` step consume `release-notes.txt` automatically. |

---

## Prioritized Top-10 Action List

1. **Stop `m_logTailer` in `~IpcBridge` + add `*m_alive` guard in the tailer
   callback** (host H3) — the only memory-safety defect; small, high-value fix.
   `IpcBridge.cpp:387-417`, `LogsBridge.cpp:172`.
2. **Add `NewWindowRequested` + `NavigationStarting` gating** (host H1) — closes
   the WebView2 popup/top-frame containment hole. `WebViewHost.cpp:228-366`.
3. **Decouple `vrchat://launch`→`inviteSelf` from `shell.openUrl` and drop it
   from the broad `ipc:shell` token** (host H2) — removes plugin-driven
   authenticated account teleport. `ShellBridge.cpp:143-214`,
   `PluginRegistry.cpp:43,49`.
4. **Bound long-running IPC promises + add `cancelAll()` on logout/auth-expiry**
   (lib H1) — stops permanent spinner/promise leaks. `ipc.ts:291-307,501-524`.
5. **Add LRU/size cap to the image/thumbnail/asset caches** (lib H2) — bounds
   heap growth in hours-long sessions. `image-cache.ts`, `thumbnails.ts`,
   `assets-cache.ts`.
6. **Serialize `VrcRadarEngine.PollOnce()` under a mutex** (core H1) — removes
   the cross-thread race on the process HANDLE (IPC pool vs screenshot-watcher),
   avoiding a possible double-`CloseHandle`. `VrcRadarEngine.cpp:231-334`.
7. **Reject reparse points in `SafeDelete` before `remove_all` + bounds-check
   `JunctionUtil` offsets** (core M-core-3 / M-core-1) — stops a junction-escape
   delete outside the cache root and a crafted-mount-point over-read.
   `SafeDelete.cpp:166`, `JunctionUtil.cpp:106-112`.
8. **gitignore `_build_b.bat` + `*-review.png` before any commit** (build-docs
   H1) — prevents accidental non-portable/scratch commit. `.gitignore`.
9. **Add a `UdonException` golden-line test** (build-docs H2) — last uncovered
   Wave-2 atom. `tests/CommonTests.cpp`.
10. **Confine `fs.listDir` / `fs.writePlan` to allow-listed roots** (host M2/M3)
   — closes plugin filesystem recon + arbitrary-dir write. `ShellBridge.cpp`.

Carry-overs worth doing next (were 9–10): fix the overlapping-batch race in
`cacheImageUrls` (lib H3, `image-cache.ts:147-201`); percent-encode
`fetchInstance` location (diff M1, `VrcApi.cpp:2355`); fix the Friends live-poll
vs pipeline presence revert (pages M6, `Friends.tsx:1147-1152`); replace the new
`any` IPC return types (lib M3 / diff M2, `ipc.ts`/`types.ts`).

---

## Safety-Critical Constraint Map

Findings that touch the project's hard guardrails (data deletion, ProcessGuard,
account-scoping, WebView2 origins):

- **WebView2 origins / containment:** host **H1** (no nav/popup gating,
  `WebViewHost.cpp:228-366`) and host **L1** (`ALLOW` vs `DENY_CORS` on asset
  hosts, `WebViewHost.cpp:246-249,273-320`).
- **Account-scoping / account mutation:** host **H2** (`shell.openUrl` →
  `inviteSelf` reachable by plugins, `ShellBridge.cpp:143-214`) and web-lib
  **M4** (`friends.cache.v1` duplicate literal risks cross-account cache bleed,
  `cache-ownership.ts:11-18` / `Friends.tsx:957-973`).
- **Plugin filesystem reach (data confidentiality/integrity):** host **M2**
  (`fs.listDir` whole-disk enumeration) and **M3** (`fs.writePlan` arbitrary-dir
  write), `ShellBridge.cpp:216-322,330-398`.
- **Shutdown safety / ProcessGuard-adjacent:** host **H3** — note ProcessGuard
  and Pipeline *are* correctly stopped in the dtor (`StopWatcher` at `:394`,
  `m_pipeline->Stop()` at `:402`); `m_logTailer` is the one missed teardown.
- **Data deletion (verified OK, no finding):** the new `avatars.delete` /
  `prints.delete` / `files.delete` route through `VrcApi::delete*` with the
  confirm gate in the UI and id-validation in the host (`ApiBridge.cpp:249-256`);
  the host performs no second confirmation but this is currently unreachable by
  plugins (confined to `plugin.rpc`, `IpcBridge.cpp:300-302`). Worth a host-side
  gate if a non-UI caller is ever added.
- **Data deletion / junction escape (core M-core-3 — NEW):** `SafeDelete`'s
  `ensureWithinBase` is lexical-only, but MSVC `remove_all` follows mount-point
  junctions, so a junction planted inside a safe-delete category passes the
  within-base check yet deletes **outside** `baseDir` (`SafeDelete.cpp:166`).
  The dry-run default, `__info`/`vrc-version` preservation, and ProcessGuard
  gating are otherwise verified sound — this reparse-point gap is the one real
  hole in the delete path. Related: `JunctionUtil` over-read (M-core-1).
- **Migration / cache deletion (verified hardened, no finding):** Migrator
  overflow + count-verify fixes (`Migrator.cpp:72-86,308-318,328-336`),
  CacheIndex within-base validation (`CacheIndex.cpp:163-216`), and fail-closed
  updater hash (`UpdatePackage.cpp:294-300`) are all net improvements this wave.

---

## Notes on De-duplication

- The **`any`-at-the-IPC-boundary** finding was raised independently by web-lib
  (M3) and diff (M2); merged into a single MEDIUM row with both line sets.
- The **untracked scratch artifacts** finding was raised by build-docs (H1, as
  HIGH) and diff (L1, as LOW); merged at HIGH with the severity disagreement
  noted inline.
- The **"clean/paused tree" doc drift** appears in build-docs M5; the
  underlying fact (large uncommitted Wave-2 tree) is corroborated by every area
  reviewer's verification baseline.
- web-pages **M3** is explicitly *not* the `friends.totalCount` bug it might
  look like (plurals resolve correctly) — the real sub-issue is the
  `statusBar.onlineCount` missing `_one` form; recorded as such.

---

## Remediation Status (2026-07-03)

All HIGH findings and the security-critical MEDIUMs are now resolved in the
working tree. Verified against code this session:

| Finding | Status | Evidence |
|---|---|---|
| host H3 (logTailer shutdown UAF) | **Fixed** | `IpcBridge.cpp:406-408` stops `m_logTailer` early in dtor; `LogsBridge.cpp:172-177` captures `alive` and guards the callback. |
| host H1 (WebView2 nav/popup gating) | **Fixed** | `WebViewHost.cpp:495` `add_NewWindowRequested`→`put_Handled(TRUE)`; `:521` `add_NavigationStarting`→`put_Cancel(TRUE)` for non-`app.vrcsm`. |
| host H2 (plugin `vrchat://` teleport) | **Fixed** | `PluginBridge.cpp:338-348` rejects `vrchat://` via `plugin.rpc`; `PluginRegistry.cpp:49` broad `ipc:shell` no longer grants filesystem surfaces. |
| core H1 (radar HANDLE race) | **Fixed** | `VrcRadarEngine.cpp:101,320` serialize Detach/PollOnce under `pollMutex_`. |
| core M-core-3 / M-core-1 (junction escape / over-read) | **Fixed** | `SafeDelete.cpp:191` rejects reparse points before `remove_all`; `JunctionUtil.cpp:114-121` bounds-checks reparse offsets. |
| lib H1 (unbounded pending promise) | **Fixed** | `ipc.ts:294,511` finite `LONG_RUNNING_IPC_TIMEOUT_MS`; `:543` `cancelAll()`. |
| lib H2 (unbounded caches) | **Fixed** | `image-cache.ts:32` + `thumbnails.ts` + `assets-cache.ts` all route sets through a `memoSet` LRU cap (`MAX_ENTRIES = 4_000`). |
| lib H3 (overlapping batch clobber) | **Fixed** | `image-cache.ts:240` `ownPending` guard. |
| UnityBundle (blocksInfo alloc) | **Fixed** | `UnityBundle.cpp:393,650` cap `uncompressedInfoSize` at both read sites (`kMaxBlocksInfoSize`). |
| build-docs H1 (scratch artifacts) | **Fixed** | `.gitignore` now covers `_build_*.bat`, `_tmp_*.bat`, `*-review.png`. |

**Verification (2026-07-03):** `pnpm build` clean; `pnpm test` 238/238; `pnpm
test:smoke` 27/27; C++ release build up to date; `ctest` 100/100 (1 skipped —
`RealLogClassificationTally`, needs local log data).

Carry-overs not yet done (non-security MEDIUM/LOW): build-docs H2
(`UdonException` golden-line test), diff M1 (`fetchInstance` percent-encode),
pages M6 (Friends live-poll presence revert), lib M3/diff M2 (`any` IPC types),
host M2/M3 (`fs.listDir`/`fs.writePlan` root confinement).
