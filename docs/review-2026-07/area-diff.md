# Review — Working-Tree Diff (2026-07-01)

Scope: full uncommitted working tree (`git status` + `git diff`). ~8,687 insertions / 1,025 deletions across 70 tracked files plus a large untracked surface (new VRC+ media, ModelsHub, feed, presence, toast/TTS, relationship-graph features). Read-only review for regressions, weakened guards, broken invariants, dead/duplicated code, debug leftovers, secrets, and artifacts unsafe to commit.

Verification baseline: every line number was confirmed against current on-disk content via `git diff`, `grep -n`, `sed -n`, and `git check-ignore` at review time.

---

## CRITICAL

None found.

The high-risk core changes in this diff are net hardening, not regressions:
- `src/core/Migrator.cpp:72-86` and `:308-318` — fixes a real integer-overflow: `file_size()` returns `(uintmax_t)-1` on error and was previously folded into the byte total before clearing `ec`. Now only added on success. Verified correct.
- `src/core/Migrator.cpp:328-336` — verify step now compares file **count** in addition to byte total before the source→backup rename, closing a same-aggregate-size mismatch hole. Good.
- `src/core/updater/UpdatePackage.cpp:294-300` — SHA256 is now **fail-closed**: a release missing/empty `expectedSha256` is rejected (`update_hash`) instead of passing on size-only. Strengthens the installer-privilege trust boundary. Good.
- `src/core/CacheIndex.cpp:163-216` — persisted-entry load now validates `avtr_` id shape and confirms the bundle path stays within base (`ensureWithinBase`) and exists; `SavePersisted()` now snapshots `m_index`/`m_cwpDir` under lock instead of reading lock-free. Good.

---

## HIGH

None found.

Destructive online ops added this wave (`avatars.delete`, `prints.delete`, `files.delete`) route to `VrcApi::delete*` with the confirm gate in the UI (`src/host/bridges/ApiBridge.cpp:249-256`); the host validates only the id. That matches the existing pattern (confirm in UI, host validates), so not flagged. Note the host performs no second confirmation, so a future non-UI caller would delete without a gate — currently unreachable because plugins are restricted to `plugin.rpc` only (`src/host/IpcBridge.cpp:300-302`).

---

## MEDIUM

### M1 — `VrcApi::fetchInstance` injects raw `location` into the request path without percent-encoding
- File: `src/core/VrcApi.cpp:2355` — `fmt::format("/api/1/instances/{}?apiKey={}", location, kApiKey)`
- Problem: every other new endpoint in this diff percent-encodes its path segment (`percentEncode(userId)`, `percentEncode(avatarId)`, `percentEncode(printId)`, `percentEncode(fileId)`), but `fetchInstance` interpolates `location` verbatim. It is validated for the `wrld_…:` prefix and a `:` (`:2345-2350`), but the instance-id tail legitimately contains `~`, `(`, `)`, `,` from region/owner tags, which are not URL-safe in a path/query context.
- Impact: malformed requests or mis-parsed query for non-trivial instance ids; inconsistent with the sibling code added in the same change. Matches pre-tracked audit item M4 in `docs/ENHANCEMENT-ROADMAP.md`.
- Fix: split `location` into world id + instance segment and `percentEncode` each (or encode the tail after the `wrld_…:` boundary) like the neighboring handlers.

### M2 — `any` types introduced in `ipc.ts`, violating the locked TS standard
- File: `web/src/lib/ipc.ts` — 8 added lines use `any` (e.g. `:362` `{ data: any[]; totalCount?: number }`, `:367` `{ prints: any[] }`, returns at `:371`/`:381`/`:391`/`:403`/`:413`/`:447`).
- Problem: `CLAUDE.md` Coding Standards mandate strict TypeScript with **no `any`**. The new VRC+/prints/files/inventory/avatar-update wrappers return `any` instead of typed shapes.
- Impact: loses type safety across the entire new VRC+ media surface; downstream pages consume untyped data. Passes `tsc` (the compiler permits `any`), so it won't fail the build — a standards-compliance regression, not a break.
- Fix: define response interfaces in `web/src/lib/types.ts` (which already gained ~219 lines this wave) and replace each `any`.

---

## LOW

### L1 — Untracked scratch artifacts not gitignored; `git add .` would commit them
- Files (repo root): `_build_b.bat`, `avatars-zh-review.png`
- Verified via `git check-ignore`: only `probe_rsmb.obj` is ignored (`*.obj`); `_build_b.bat` and `avatars-zh-review.png` are **not** ignored.
- Problem: `_build_b.bat` is a personal force-rebuild launcher hardcoding a non-portable vcvars path (`D:\Software\Microsoft Visual Studio\18\...`) — the same class `.gitignore` already excludes (`build.bat`, `tools/build-*-force.bat`). `avatars-zh-review.png` (104 KB) is a one-off visual-review screenshot.
- Impact: a blanket `git add` stages non-portable scratch into the repo.
- Fix: delete both before committing, or add them (or `review-*.png` / root `*.bat`) to `.gitignore`. Do not `git add .` blindly. `probe_rsmb.obj` is safe (already ignored).

### L2 — Duplicate entry in `AsyncMethodSet()` initializer
- File: `src/host/IpcBridge.cpp:202` and `:229` — `"db.coPresenceGraph"` appears twice in the same `std::unordered_set<std::string>` literal (container confirmed at `:100`).
- Problem: dead/duplicated literal. Harmless at runtime (set dedups), but signals a copy-paste during the Track-4 co-presence merge.
- Fix: remove the second occurrence at `:229`.

### L3 — `kApiKey` hardcoded literal (informational, not a leak)
- File: `src/core/VrcApi.cpp:104`
- Note: this is the well-known **public** VRChat client apiKey, present before this diff; the new endpoints just reuse it. No user secret introduced. Secret scan of added lines found no credentials, tokens, or private connection info. Discord RPC changes (`src/core/DiscordRpc.cpp:108-138`) explicitly avoid leaking instance id / join secret (`BuildSetActivityPayload` sets no party/secret). The default Discord client id is an empty placeholder (`kDiscordPlaceholderClientId = ""`, `src/core/DiscordRpc.h:26`), so presence stays dark until the user supplies an id (`PipelineBridge.cpp` `EffectiveDiscordClientId`).

### L4 — `AvatarIdHarvest` reads VRChat's Amplitude analytics cache (privacy-adjacent, gated, read-only)
- Files: `src/core/AvatarIdHarvest.{h,cpp}`, gated by experimental flag `vrcsm:experimental:amplitudeHarvest` (`web/src/lib/experimental.ts:34-40`, default OFF).
- Note: the header documents it as strictly read-only — no network, no mutation, no upload; only `avtr_` ids are extracted and the raw analytics content is treated as DATA. Default-OFF gating is correct. Flagged only so reviewers are aware a new local-analytics-cache reader exists; behavior matches its stated contract. Not a defect.

---

## Verified clean (no findings)

- Deleted `web/src/pages/workspace/TabAvatars.tsx`, `TabVrcPlus.tsx`, and `web/src/lib/hooks/useMemoryRadar.ts` — confirmed **zero** remaining references (`grep` across `web/src`). VRC+ functionality is re-homed: `VrchatWorkspace.tsx` now lazy-loads the full `VrcPlus` manager into the `vrcplus` tab (`:30-32`, `:167`), and `/vrcplus` redirects to `/vrchat?tab=vrcplus` (`App.tsx:534`). Old Avatars tab folded into `ModelsHub` (`App.tsx:51`, `:531`; `ModelsHub.tsx:93-94` renders `<Avatars embedded />` + `<ModelDb embedded />`). No lost functionality found.
- New core `.cpp` files are wired into the build (`src/core/CMakeLists.txt:13,31-32`) with the required `RuntimeObject`/`Propsys` WinRT libs added for `ToastNotifier`.
- No command execution (`system`/`popen`/`ShellExecute`/`CreateProcess`) in new native code (`GpuProbe`, `HwTelemetry`, `ToastNotifier`, `VrOverlayNotifier`, `AvatarIdHarvest`).
- No SQL string concatenation in `Database.cpp` new code — all statements use `sqlite3_prepare_v2` + bind helpers (`:61-67`, `:363-384`, migration via `ExecSimple` on fixed literals `:451-470`).
- No `eval`/`innerHTML`/`dangerouslySetInnerHTML`/`Function()` in added TS; no `console.log`/`debugger`/`TODO`/`FIXME` debug leftovers in changed/untracked TS.
- Tests not weakened: `pages-smoke.test.tsx` change replaces a fixed 5-turn loop with a polling `waitForBody` (more robust under CPU starvation) and **adds** routes (`/models`, `/vrcplus`, `/social`); no assertions removed or skipped. No `.only`/`.skip`/`xit` in new test files. `tests/CommonTests.cpp` is +1159 lines, additive.
- `auth-context.tsx` cache-ownership refactor (`resetAccountScopedCaches`) correctly tightens behavior: clears account-scoped localStorage + query caches on logout / auth-expiry / account-switch, with `suppressCacheReset` to avoid double-clearing on the direct status push. `query-keys.ts` root keys (`favorites.listsRoot`/`itemsRoot`) align with the `["favorites.lists"]` literals they replace in `library.ts`.

---

## Area health

- Core C++ changes are the strongest part of this wave: three genuine audit fixes (Migrator overflow, count-verify, updater fail-closed hash) plus CacheIndex validation/locking hardening, all consistent with `docs/ENHANCEMENT-ROADMAP.md`. No regressions or weakened guards detected.
- Two follow-ups worth doing before merge: percent-encode the instance `location` in `VrcApi::fetchInstance` (M1, matches tracked audit M4) and replace the 8 `any` types in the new VRC+ `ipc.ts` wrappers (M2) to honor the no-`any` standard.
- Commit hygiene is the main risk: `_build_b.bat` and `avatars-zh-review.png` are not gitignored and would be swept in by a blanket `git add`. Stage files explicitly or ignore those two; the large deletions (TabAvatars/TabVrcPlus/useMemoryRadar) are safely re-homed with no dangling references.
