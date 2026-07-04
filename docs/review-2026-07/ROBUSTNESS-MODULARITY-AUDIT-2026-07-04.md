# VRCSM Robustness + Modularity Audit — 2026-07-04

Post Database-split / IpcBridge-decouple. Full-stack (C++ core + host, React web, build/deps).
Read-only synthesis: no source edits, no build performed. All file:line citations verified by the reader/verifier passes.

## 1. Executive Verdict

Overall health: **B- / solid-and-improving.** The recent structural work landed cleanly and the
hardening baseline on the untrusted-input paths (UnityBundle / UnitySerialized / Junction / UTF-8)
is genuinely strong. What remains is a small set of real defects plus a broad, honest coverage and
modularization backlog — mostly latent risk, not active fires.

### What improved since the prior `AUDIT-VERDICT.md`
- **Database god-object split is real, not cosmetic at the seam.** Each public `Database::` method is
  defined exactly once across the 10 TUs; all cross-TU sharing routes through `Database_internal.h`
  (`StatementGuard`, `Bind*/Column*`, `RunOnce`). `Database.h` stayed sqlite-free (forward-declares
  `sqlite3`/`sqlite3_stmt`, `Database.h:16-17`); the heavy `SQLITE_CORE` include is isolated to
  `Database.cpp`. Schema/DDL is centralized in `Database.cpp::InitSchema` under one transaction.
- **IpcBridge decouple + async model verified**: `DispatchFromOrigin` is the single routing chokepoint
  with origin + plugin-method gates present and reading correct.
- **Three new risk tests are meaningful** (Migrator execute/junction/backup, stale-backup refusal,
  SafeDelete preserved-root markers) — not filler.
- Prior cleanups confirmed done: `tinygltf` fully removed from `vcpkg.json`; percent-encode fixes on
  `VrcApi` fetchInstance/fetchWorld; JunctionUtil reparse-buffer bounds; UnityBundle blocksInfo/2GiB caps.

### Top 3 remaining themes
1. **Untrusted-bundle parsing has one true crash bug.** `UnityMesh.cpp:601` integer-overflow bypasses a
   bounds check and reads from a wild pointer — a **segfault that `IpcBridge`'s `catch(...)` cannot
   contain**. Everything else in the Unity path degrades cleanly; this one does not. Highest-value fix.
2. **Irreversible + security-sensitive paths are correct but under-tested.** SafeDelete junction branch,
   ClearHistory/ClearTables bulk-DELETE, Migrator rollback, the DB migration ladder, and the three newest
   Database TUs (Recordings/Rules/Embeddings) all have zero direct coverage. The code reads sound; a moved
   binding or a ladder regression would only surface at runtime.
3. **The split moved code, not the god-objects that remain.** `VrcApi.cpp` (3609L/64 methods),
   `Avatars.tsx` (2392L), `ipc.ts` (3565L, 1632L inline mock switch), `LogParser::handleNormalLine`
   (~575L), and the single-mutex Database contention model are the next modularization targets.

## 2. Ranked Findings (most-severe first)

All verdicts CONFIRMED unless marked PLAUSIBLE. Sev = severity-adjusted. AF = auto-fixable + low-risk
(eligible for the self-fix work-list in §3).

| # | Sev | Dim | File:Line | Problem | Fix | Risk | Effort | AF |
|---|-----|-----|-----------|---------|-----|------|--------|----|
| 1 | MED | cpp-correctness | `src/core/UnityMesh.cpp:601` | `streamOffset(u64)+streamSize(u32) > n` wraps; `vertexBytes.assign(p+streamOffset,…)` reads wild pointer → **segfault, not caught by `IpcBridge.cpp:556 catch(...)`** | Use in-repo underflow-safe idiom (`streamOffset > n \|\| streamSize > n - streamOffset`) | low | XS | ✅ |
| 2 | MED | cpp-correctness | `src/core/Database_Rules.cpp:60` | `UpdateRule` concatenates `name`/`description`/`dsl_yaml` into SQL unescaped; a `'` breaks any update; injection-shaped. Reached via `RuleBridge.cpp:41` (`rules.update`) | Mirror `InsertRule` (`:37-45`) `sqlite3_bind_text` | low | S | ✅ |
| 3 | MED | build-config | `scripts/deploy-host.ps1:1-6` | `param()` is not the first statement (`$ErrorActionPreference` at L1) → whole script fails at parse; deploy body unreachable | Move `param()` to line 1 | low | XS | ✅ |
| 4 | MED | cpp-modularity | `src/core/Database.h:542` | Single `m_mutex`+`m_db` serializes all R/W; CoPresence/Predict/GlobalSearch hold lock through O(n²) pure compute; WAL concurrency defeated | Release lock after SELECT / add read pool | med | L | ❌ |
| 5 | MED | cpp-modularity | `src/core/VrcApi.cpp:1` | Next god-object: 3609L, 64 methods, embedded WinHTTP transport | Extract transport + split by domain | med | L | ❌ |
| 6 | MED | web-modularity | `web/src/pages/Friends.tsx:988` | Second parallel friends store (`useState`+localStorage+own Pipeline merge) duplicates `useFriendsPipelineSync`+React Query; initial-fetch key differs (`{offline}` vs `undefined`) → transient disagreement | Collapse onto shared `useIpcQuery` cache | med | M | ❌ |
| 7 | MED | web-modularity | `web/src/pages/Dashboard.tsx:239` | One-shot raw `ipc.call('friends.list')` inlines online filter, never reads RQ cache; card is a mount-time snapshot despite App.tsx comment claiming parity | Swap to `useIpcQuery` + `countOnlineFriends` (`vrcFriends.ts:360`) | low | S | ✅ |
| 8 | MED | web-modularity | `web/src/pages/Avatars.tsx:1833` | 2392L god-component: 3 heavy resolution effects + hand-mirrored refs + 5 subcomponents in-file | Extract thumbnail-resolution hook + subcomponents | med | L | ❌ |
| 9 | MED | deps-build | `web/src/i18n/index.ts:5-11` | All 7 locales statically imported into `resources`; `index` chunk 1120KB carries ~870KB of locale, 6/7 dead per user | Lazy `import()` per active locale | med | M | ❌ |
| 10 | MED | deps-build | `web/package.json:21` | `@huggingface/transformers ^4.1.0` transitively pins `onnxruntime-web 1.26.0-dev.20260410-…` (nightly); `^` can drift on lockfile-ignoring install | Pin exact transformers version / override onnx pin | med | M | ❌ |
| 11 | MED | testing | `src/host/IpcBridge.cpp:458` | `DispatchFromOrigin` (origin + plugin-method + async + exception gates) unreachable by tests: `tests/CMakeLists.txt:19-22` links `vrcsm_core` only, not `src/host` | Link host or extract gate logic to core-testable unit | med | M | ❌ |
| 12 | MED | testing | `src/core/SafeDelete.cpp:116` | Nested-junction unlink branch (`:116-122`) + `DeleteWithinRoot` reparse guard (`:335`) never exercised; only ExecutePlan test plants plain files | Add test planting a junction inside a deletable entry | low | S | ✅ |
| 13 | MED | testing | `src/core/Database_Analytics.cpp:387` | `ClearHistory`(`:387`) + `ClearTables`(`:520`, allowlisted bulk DELETE) irreversible, zero coverage | Add seed→clear→assert-empty + unknown-table-rejected tests | low | S | ✅ |
| 14 | MED | testing | `src/core/Database.cpp:847` | Migration ladder only fresh-open→final tested; v18 backfill + incremental upgrade + idempotency unverified | Test forcing intermediate `PRAGMA user_version`, re-open, assert backfill | low | M | ✅ |
| 15 | MED | testing | `src/core/Migrator.cpp:358` | rename→junction-fail→restore + junction-unreadable→restore (`:355-394`) explicitly unasserted (`CommonTests.cpp:2513-2515`) | Needs injectable junction-create seam in `execute()` first | med | M | ❌ |
| 16 | MED | testing | `src/core/Database_Rules.cpp:56` | Recordings/Rules/Embeddings TUs (post-split) have zero method coverage; moved binding would only fail at runtime | Round-trip test per TU | low | M | ✅ |
| 17 | LOW | cpp-correctness | `src/core/UnityMesh.cpp:665` | `streamBase[c.stream]`/`streamStride[c.stream]` (size-8 `std::array`) indexed w/o `c.stream<8` guard the sibling stride loop (`:618-624`) already has → OOB stack read (bounded, feeds bounds-checked decode) | Add `c.stream < streamStride.size()` guard | low | XS | ✅ |
| 18 | LOW | cpp-correctness | `src/core/UnityMesh.cpp:663` | `vertexCount` raw `u32` uncapped (unlike submesh/channel caps) → `bad_alloc` on near-UINT32_MAX (caught at `IpcBridge.cpp:552`, degrades cleanly) | Add sanity cap like sibling count fields | low | XS | ✅ |
| 19 | LOW | cpp-modularity | `src/core/Database_Analytics.cpp:7` | All 10 Database TUs include `Windows.h`+`ShlObj.h`+`KnownFolders.h`; 0 Win32 symbols used → dead includes, contradict src/core "zero Win32" contract | Remove the 3-line block from all 10 TUs | low | S | ✅ |
| 20 | LOW | cpp-modularity | `src/core/Database_internal.h:170` | `using namespace detail;` at namespace scope in a header hoists all `detail` symbols into `vrcsm::core` for every includer | Qualify uses / drop the directive | low | S | ❌ |
| 21 | LOW | cpp-modularity | `src/core/Database_Analytics.cpp:387` | Weak cohesion: data-mgmt + dashboard stats + GlobalSearch in one 1232L TU | Split by concern | low | M | ❌ |
| 22 | LOW | cpp-modularity | `src/core/Database_Friends.cpp:475` | CoPresence/Predict/GlobalSearch are pure algorithms welded to `Database` under `m_mutex`; untestable without live SQLite | Extract free functions (pairs with #4) | low | M | ❌ |
| 23 | LOW | cpp-modularity | `src/core/LogParser.cpp:538` | `handleNormalLine` ~575L god-function dispatching every log-line variant | Extract into `LogAtoms`/`LogEventClassifier` (siblings exist) | low | M | ❌ |
| 24 | LOW | testing | `src/core/Pipeline.cpp:429` | Frame→(type,content) unwrap (`:429-478`) untested; only `FormatPipelineToast` covered. Failure = dropped events (non-destructive) | Extract + test envelope-unwrap | low | S | ❌ |
| 25 | LOW | web-typesafety | `web/src/lib/ipc.ts:483` | Result-shape validator registered for 5/61 methods (~7%); unregistered path is silent `as TResult` (`:754`) | Deliberate opt-in rollout; expand registrations incrementally | low | M | ❌ |
| 26 | LOW | web-typesafety | `web/src/lib/ipc.ts:685` | `on<T>()` casts `ce.detail` to `T`; events get zero shape validation (validator guards responses only) | Add event validators for state-bearing events | low | M | ❌ |
| 27 | LOW | web-modularity | `web/src/lib/ipc.ts:783` | 3565L god-module: 1632L inline `mockCall` switch (182 cases) + 20 DTO interfaces in the client | Move mock switch + DTOs out | med | L | ❌ |
| 28 | LOW | web-typesafety | `web/src/lib/ipc.ts:2613` | `any` not eliminated: `types.ts:385,393` index-sig + ~21 in ipc.ts (readConfig/writeConfig/writeSteamVrConfig + `any[]` returns) | Replace with `Record<string,unknown>` (already repo pattern) | low | S | ✅ |
| 29 | LOW | web-modularity | `web/src/pages/Worlds.tsx:112` | `hashString` byte-identical (Avatars/Worlds); `shortenId` 3 diverging copies render same id differently; `parseLogTime` diverges (Worlds guards `'T'`, Dashboard doesn't) | Consolidate w/ chosen unified semantics | low | M | ❌ |
| 30 | LOW | web-security | `web/src/pages/Avatars.tsx:214` | PLAUSIBLE. `trustedVrchatImageUrl` allowlist page-private; FriendDetailDialog/Worlds render API image URLs via bare `<img>` w/o trust check. URLs originate from trusted core → theoretical, defense-in-depth only | Move allowlist to shared lib, apply at render sites | low | M | ❌ |
| 31 | LOW | web-modularity | `web/src/components/FriendDetailDialog.tsx:172` | 7 `useIpcQuery` + derived shaping interleaved w/ JSX in 1341L file (cohesive — all one friend) | Extract `useFriendDetail` data hook | low | M | ❌ |
| 32 | LOW | deps-build | `web/package.json:29` | `@radix-ui/react-tooltip` declared, zero usages in web/src, no `ui/tooltip.*` | Remove dependency | low | XS | ✅ |
| 33 | LOW | build-config | `scripts/build-host-local.bat:11` | Hardcoded `D:\Software\MS\…\vcvars64.bat`; fails on any other machine (`build-host.bat` has vswhere autodetect) | Delegate to `build-host.bat` detection | low | XS | ✅ |
| 34 | LOW | build-config | `scripts/build-msi.bat:37` | Hint says `wix --version 6.*` but schema is WiX v4 ns / stack locked v7; EULA block only special-cases 7/8 | Change hint to `7.*` | low | XS | ✅ |
| 35 | LOW | deps-build | `web/package.json:1-17` | No `packageManager`/`engines` pin despite pnpm-only; allows divergent lockfile via npm/yarn | Add `packageManager: pnpm@<ver>` + `engines` | low | XS | ✅ |
| 36 | NIT | web-typesafety | `web/src/lib/ipc.ts:753` | `pending.set(id,…)` no `has(id)` precheck; dup id overwrites in-flight slot (uuid collision effectively impossible) | Add `has()` guard | low | XS | ✅ |
| 37 | NIT | web-typesafety | `web/src/components/AvatarPreview3D.tsx:57` | 4 `any` for THREE controls (`:57,541,545,746`) violate no-any | Import OrbitControls type | low | XS | ✅ |
| 38 | NIT | deps-build | `web/vite.config.ts:21-35` | `chunkSizeWarningLimit` unset; 3 chunks >500KB (index/three-vendor/transformers; latter two lazy = noise) | Set limit / accept post-#9 | low | XS | ✅ |
| 39 | NIT | deps-build | `web/postcss.config.js:1-5` | PLAUSIBLE. `autoprefixer` runs alongside Tailwind-4 Vite plugin; near-moot for single-Chromium WebView2. Redundancy likely but unprovable without a diff build | Verify then remove | low | S | ❌ |

## 3. Auto-fixable Low-Risk Subset (self-fix work-list)

Only findings with `autoFixable=true` AND `riskToFix=low`. Ordered. Two independent build groups —
run each group's build once at the end, do not interleave C++ and web.

### Group A — C++ core (one `cmake --build --preset x64-debug`, then `ctest`)

Do these in order; they touch different files so no conflict.

A1. **`src/core/UnityMesh.cpp:601`** (finding #1 — highest value). Replace the wrapping
   `streamOffset + streamSize > n` with the underflow-safe idiom already used in `UnityBundle.cpp`:
   `if (streamOffset > n || streamSize > n - streamOffset) return error/false;` before the
   `vertexBytes.assign` at `:607`.
   *Verify:* builds green; existing Unity tests still pass; ideally add a fuzz case with
   `streamOffset = UINT64_MAX-1`, `streamSize = 3` and assert clean error (not crash).

A2. **`src/core/UnityMesh.cpp:665`** (#17). Add `c.stream < streamStride.size()` (== `< 8`) to the
   decode-loop guard, matching the stride loop at `:618-624`. *Verify:* build; Unity tests pass.

A3. **`src/core/UnityMesh.cpp:663`** (#18). Cap `vertexCount` after the raw `u32` read at `:516`
   (mirror submesh cap `>0x10000` / channel cap `>64`); return error above cap before the
   `std::vector<float> buf(...)` allocation. *Verify:* build; add a case with near-`UINT32_MAX`
   vertexCount asserting error response.

A4. **`src/core/Database_Rules.cpp:60`** (#2). Rewrite `UpdateRule` to use `sqlite3_bind_text` for
   `name`/`description`/`dsl_yaml` exactly as `InsertRule` (`:37-45`) does, replacing the string-
   concatenated `ExecSimple`. *Verify:* build; add round-trip test with a name containing `'`
   (e.g. `Ksana's rule`) asserting the update succeeds and reads back intact.

A5. **Remove dead Win32 includes from all 10 Database TUs** (#19): delete the identical
   `Windows.h`/`ShlObj.h`/`KnownFolders.h` block at `Database.cpp:12-14` and the nine
   `Database_*.cpp:7-9`. *Verify:* clean `x64-debug` build proves zero symbols were used.

A6. **New tests (no production change; pure additions)** — batch, then one `ctest`:
   - #12 SafeDelete: plant a junction inside a deletable `Cache-WindowsPlayer` entry and assert the
     reparse branch (`SafeDelete.cpp:116-122`) unlinks without recursing (guard with
     junction-unsupported `GTEST_SKIP`).
   - #13 seed history/tables → `ClearHistory`/`ClearTables` → assert empty; assert unknown table name
     hard-errors (`Database_Analytics.cpp:534-537`) and preserved-root skip.
   - #14 open DB, force `PRAGMA user_version` to a pre-v18 value with a legacy
     `local_favorites` row, re-open, assert the `source='official'` backfill (`Database.cpp:830-866`)
     touched only legacy rows and is idempotent on a second re-open.
   - #16 round-trip one method each in Recordings / Rules / Embeddings TUs to smoke the moved bindings.
   *Verify:* `ctest` count rises from the current 104; all green.

### Group B — Web (one `pnpm build` in `web/`, plus `pnpm test`)

B1. **`web/src/pages/Dashboard.tsx:239`** (#7). Replace the one-shot `ipc.call('friends.list')`
   effect + inline filter with `useIpcQuery('friends.list', undefined)` (matching `App.tsx:122-131`)
   and `countOnlineFriends` from `vrcFriends.ts:360`. *Verify:* `tsc -b` clean; Playwright smoke on
   `/` still renders the online card.

B2. **`web/src/components/AvatarPreview3D.tsx`** (#37). Import the OrbitControls type and replace the
   4 `any` at `:57,541,545,746`. *Verify:* `tsc -b` clean (watch three/examples vs drei typing align).

B3. **`web/src/lib/ipc.ts` + `web/src/types.ts`** (#28). Replace `any` with `Record<string,unknown>`
   at `types.ts:385,393` and the ipc.ts positions (`:2613,2617,2625` + the `any[]` returns), following
   the existing `Record<string,unknown>` pattern (`types.ts:431-432`). *Verify:* `tsc -b` clean.

B4. **`web/src/lib/ipc.ts:753`** (#36). Add `if (this.pending.has(id)) { /* reject dup */ }` guard
   before `this.pending.set`. *Verify:* `tsc -b`; validator test still green.

B5. **Remove `@radix-ui/react-tooltip`** (#32) from `web/package.json:29`; `pnpm install` to update
   lockfile. *Verify:* `pnpm build` clean (zero import sites confirmed by grep).

B6. **Add `packageManager` + `engines`** (#35) to `web/package.json`. *Verify:* `pnpm install`
   still resolves; corepack honors the pin.

B7. **`web/vite.config.ts`** (#38). Optional: set `chunkSizeWarningLimit` (or leave to #9). *Verify:*
   `pnpm build` warning count.

### Group C — Scripts (no build; syntax check only)

C1. **`scripts/deploy-host.ps1`** (#3). Move `param()` block to line 1, above
   `$ErrorActionPreference`. *Verify:* `powershell -NoProfile -File scripts/deploy-host.ps1 -Preset x64-release`
   parses (reaches the deploy body instead of the `param not recognized` error).

C2. **`scripts/build-host-local.bat:11`** (#33). Replace the hardcoded vcvars64 path with a call into
   `build-host.bat`'s vswhere detection (or delete the helper). *Verify:* runs on a machine without
   `D:\Software\MS\...`.

C3. **`scripts/build-msi.bat:37`** (#34). Change the hint from `wix --version 6.*` to `7.*`.
   *Verify:* text matches the v4 schema / v7 stack + the EULA block's 7/8 special-case.

## 4. Needs Approval / Higher-Risk

These change behavior, structure across many files, or a concurrency/security boundary. Do not self-fix.

- **#4 Database single-mutex contention** (`Database.h:542`). Releasing `m_mutex` after the SELECT (so
  CoPresence/Predict/GlobalSearch run their O(n²) compute lock-free) or moving to a read-connection pool
  unlocks the WAL concurrency the async workers were built for. *Trade-off:* correctness-critical —
  snapshot semantics and interaction with in-flight writers must be reasoned through; pairs naturally with
  #22 (extract the algorithms as free functions operating on already-fetched vectors, which also makes
  them unit-testable without live SQLite).
- **#5 VrcApi god-object** (`VrcApi.cpp`, 3609L/64 methods). Extract the WinHTTP transport
  (`httpRequestOnce:568`, `httpRequest:727`) into its own unit, then split endpoints by domain.
  *Trade-off:* large surface, high regression risk without the HTTP-layer tests that don't yet exist;
  sequence transport-extraction first so the domain split rides a stable seam.
- **#8 Avatars.tsx god-component** / **#27 ipc.ts god-module** / **#31 FriendDetailDialog** /
  **#23 handleNormalLine** / **#21 Database_Analytics cohesion**. Pure modularization. *Trade-off:*
  each is a multi-hundred-line move with real diff risk and little functional upside; schedule
  deliberately, one at a time, behind the existing Playwright/ctest smoke.
- **#6 Friends.tsx dual store** / **#7 is the low-risk half**. Collapsing the second store onto the
  shared cache removes drift but touches the page's live subscription model. *Trade-off:* behavior
  change to the friends list; verify Pipeline events still reconcile counts/locations.
- **#9 i18n eager bundling** (`i18n/index.ts:5-11`). Lazy per-locale `import()` cuts ~870KB from the
  1120KB index chunk. *Trade-off:* i18next init becomes async; needs a loading path and a fallback for
  the initial render.
- **#10 onnxruntime-web dev-prerelease pin** (`package.json:21`). Pin transformers exactly or add an
  onnx `overrides`/`pnpm.overrides`. *Trade-off:* the CLIP embedding feature (`avatar-embedding.ts:45`)
  must be re-smoke-tested against whatever stable onnx you pin to.
- **#11 IpcBridge testability** (`IpcBridge.cpp:458`). Either link `src/host` into the test target or
  extract the origin/plugin gate into a core-testable function. *Trade-off:* linking host pulls WebView2/
  Win32 into tests; extraction is cleaner but is a real refactor of the security chokepoint.
- **#15 Migrator rollback coverage** (`Migrator.cpp:358`). Requires adding an injectable junction-create
  seam to production `execute()` — not a pure test add. *Trade-off:* touching irreversible recovery code
  to make it testable; weigh the seam's risk against the coverage gained.
- **#20 header `using namespace detail`**, **#24 Pipeline unwrap test**, **#25/#26 validator coverage
  expansion**, **#29 helper consolidation**, **#30 image-URL allowlist to shared lib**, **#39 postcss
  removal**. Low individual risk but each needs a judgment call (unified semantics, security boundary,
  or a diff-build to prove redundancy) — not mechanical.

## 5. Already Solid / Verified Strong

- **C++ modularity (split seam):** each `Database::` method defined once; sharing only via
  `Database_internal.h`; `Database.h` sqlite-free (`:16-17`); `RunOnce` template hoisted cleanly
  (`Database_internal.h:172`); schema centralized in `Database.cpp::InitSchema` under one transaction;
  pure algorithm helpers kept in per-TU anonymous namespaces.
- **Untrusted-input hardening:** `UnityBundle.cpp` (blocks/node caps `0x10000`, 2GiB uncompressed cap,
  underflow-safe offset checks, per-block cursor bounds, final node-extent validation, LZ4/LZMA result
  checks); `UnitySerialized.cpp` (type/object/external caps, version-gated layout, final per-object
  extent validation, fail-closed `ByteReader`); `JunctionUtil::readJunctionTarget` (reparse
  offset/length validated against returned bytes + WCHAR alignment, `:114-121`); `Common.cpp`
  UTF-8/wide (explicit lengths, `CP_UTF8`, empty/zero handling) and `ensureWithinBase`
  (absolute+lexically_normal, component-wise case-insensitive); `VrcApi` `parseJsonBody` + guarded
  `value()`/`is_string()`; `AvatarData::readParameters` (id-shape + `ensureWithinBase` + try/catch);
  `PngMetadata` (signature/IHDR/per-chunk bounds, 64KiB tEXt cap).
- **C++ tests that exist are high quality:** the three new risk tests (Migrator junction/backup, stale-
  backup refusal, SafeDelete preserved markers) are real; both DB tests (pre-index dedupe, owned-avatar
  composite-key round-trip) are thorough; irreversible paths correctly use `GTEST_SKIP` guards; strong
  coverage on `ensureWithinBase`, SafeDelete containment, update-package SHA256/path, SteamVR repair-root
  allowlist, plugin FS-permission split.
- **Web IPC type-safety:** pending-promise lifecycle is leak-free (finite timeouts incl. `LONG_RUNNING_METHODS`,
  self-deleting timers, late-response `if(!slot)return`); `cancelAll` wired at `cache-ownership.ts:71`;
  centralized 401/auth-expired interceptor; `IpcError` carries `code`+`httpStatus`; validator design sound
  where applied (verified against real C++ shape); `handle()` defensive at the transport edge; mock data
  builders already code-split.
- **Web component modularity:** all four contexts use `useMemo`/`useCallback` with precise deps and narrow
  scope (no god-context); `osc-studio.ts` is exemplary React-free domain logic; `useIpcQuery` standardizes
  server state; `App.tsx` lazy-loads all 33 pages + Three.js; the `lib/*` api layer is genuinely separated
  from UI.
- **Deps/build/config:** all 10 Database TUs + `Database_internal.h` correctly wired in
  `src/core/CMakeLists.txt:8-17`, no orphans; vendored `sqlite-vec.c` compiled `SQLITE_CORE=1` with scoped
  `/w`; MSI wasm exclusion (`vrcsm.wxs:57`); `sync-web-dist`/`sync-plugins` no-op safely and purge stale
  dest; `build-host.bat` has portable VS discovery + locked-exe rollback; heavy web deps lazy-loaded;
  `tinygltf` fully gone from `vcpkg.json`; no secrets/credentials in any config.

## 6. Appendix — REFUTED / ALREADY-FIXED (checked, not missed)

- **Sentinel finding `t` / `a:1`** — REFUTED. Placeholder entry (title `t`, problem `p`, fix `f`); no such
  file, non-substantive. Excluded from the plan.
- **Verified-present prior fixes (not re-reported as gaps):** percent-encode on `VrcApi` fetchInstance/
  fetchWorld (`VrcApi.cpp:2335/2359`); reparse-buffer bounds (`JunctionUtil.cpp:114-121`); UnityBundle
  blocksInfo/`totalUncompressed` 2GiB caps; `cancelAll` cross-account stale-slot fix
  (`cache-ownership.ts:71`); bounded IPC timeouts + `registerResultValidator` infra; `tinygltf` removal
  from `vcpkg.json`.
- **Severity down-adjustments (reported honestly, not dropped):** several web findings the source rated
  MED were adjusted to LOW because they are deliberate incomplete rollouts, not regressions — #25 (7%
  validator coverage, opt-in by design), #26 (event validation gap, symmetric deliberate gap), #27 (ipc.ts
  size, org smell). #30 (image-URL allowlist) down from HIGH-ish to LOW: `image-cache.ts:57`
  `isAlreadyLocalImageUrl` is a cache-skip optimization, not a security allowlist, so the "overlapping host
  set" framing conflated two different-purpose functions; the URLs originate from VRChat's own API via the
  trusted core, making the untrusted-origin vuln theoretical.

---
*Read-only synthesis. No source files edited, no build run. Counts: 30 CONFIRMED + 2 PLAUSIBLE actionable
findings (1 sentinel REFUTED). 19 auto-fixable low-risk (Groups A/B/C in §3). 8+ needs-approval items in §4.*

