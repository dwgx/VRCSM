# Review 2026-07 — Area: build / test / config / docs

Reviewer scope: CMake/presets, packaging/installer, web build+test config, test-coverage gaps for new C++ atoms and web modules, doc accuracy vs code, .gitignore gaps. All line numbers verified against on-disk files in working-tree state (uncommitted changes present).

Verification baseline: `git status` shows a large dirty tree (Wave 2 work in progress, not yet committed). Findings reflect current disk state, not `HEAD`.

---

## CRITICAL

None found. New C++ source (`AvatarIdHarvest.cpp`) is correctly wired into `src/core/CMakeLists.txt:13` and referenced by host (`src/host/bridges/ApiBridge.cpp:1298`) and tests (`tests/CommonTests.cpp:2136`). Deleted web modules (`useMemoryRadar.ts`, `workspace/TabAvatars.tsx`, `workspace/TabVrcPlus.tsx`) have **zero** dangling imports — verified via repo-wide grep, so the frontend build will not break on missing modules. Routes `/avatars` and `/vrcplus` resolve to live components (`web/src/App.tsx:531,537`), not the deleted tab files.

---

## HIGH

### H1. Untracked build/scratch artifacts are NOT gitignored and will be committed accidentally
- Files: `_build_b.bat` (repo root), `avatars-zh-review.png` (repo root, 106 KB screenshot)
- `git check-ignore _build_b.bat avatars-zh-review.png` returns exit 1 (neither ignored). They show as `??` in `git status`.
- Problem: `.gitignore` (lines 46-59) already ignores `build.bat`, `tools/build-*-force.bat`, and dev scratch scripts, but `_build_b.bat` (a hardcoded-VS-path force-rebuild helper, identical class to the already-ignored `build.bat`) and review screenshots are not covered. There is **no `*.png` ignore rule** anywhere in `.gitignore`.
- Impact: A future `git add .` (which the release workflow tends toward) commits a non-portable local launcher with a hardcoded `D:\Software\Microsoft Visual Studio\18` path and a throwaway review image into the repo. `_build_b.bat` is exactly the kind of machine-specific helper the project already deliberately ignores.
- Fix: Add to `.gitignore`: `_build*.bat` under the "One-off force-rebuild helpers" block, and a review-asset rule such as `*-review.png` (or move review screenshots under the already-ignored `tmp/`). Confirm with `git check-ignore`.

### H2. UdonException log atom has no test coverage
- File: parser implemented at `src/core/LogAtoms.cpp:90` (`kUdonExceptionRe`), `:541-543`; report field exists at `src/core/LogParser.h:363` (`udon_exceptions`).
- Problem: Of the 17 new Wave-2 atoms added in `src/core/LogAtoms.h:32-49`, every one has at least one golden-line assertion **except `UdonException`**. Verified: `grep "UdonVMException"` in `tests/CommonTests.cpp` returns nothing; `grep "udon"` matches only the header field, no test. Sibling diagnostics atoms `OscFail`/`InstanceReset` ARE covered at `tests/CommonTests.cpp:2056-2067`; `ShaderKeyword`/`AudioDevice` are covered via the batch report test at `tests/CommonTests.cpp:2104-2126`.
- Impact: The Udon-exception regex (`VRC\.Udon\.VM\.UdonVMException: (.+?)$`) and its `udon_exceptions` aggregation can silently regress with no failing test — a real golden-line gap for a newly-shipped atom.
- Fix: Add a `ParseVrchatLogAtom` golden-line case asserting `kind == UdonException` plus the captured message, and ideally one report-level assertion that `report.udon_exceptions` populates, mirroring `SessionModeAndDiagnostics` at `tests/CommonTests.cpp:2043`.

---

## MEDIUM

### M1. CLAUDE.md / AGENTS.md claim "10 lazy-loaded pages" — actual count is 27
- Files: `CLAUDE.md:59`, `AGENTS.md:59` (identical text).
- Problem: Architecture doc says "React SPA with 10 lazy-loaded pages." `web/src/App.tsx:48-74` declares **27** `lazy(() => import(...))` page modules (verified `grep -c "lazy(" = 27`). The route table at `web/src/App.tsx:528-558` defines 31 `path=` entries.
- Impact: Stale claim understates the app ~2.7x; a new agent sizing the frontend or auditing route coverage gets a wrong model. Both agent-facing docs carry the error identically.
- Fix: Update both files to "~27 lazy-loaded pages" or drop the hard count (counts drift; the phrase without a number is lower-maintenance).

### M2. pages-smoke test does not cover 6 live routes
- File: `web/src/__tests__/pages-smoke.test.tsx:129-149` (the `routes` table, 20 entries).
- Problem: `web/src/App.tsx` defines routes for `/fbt`, `/rules`, `/events`, `/friend-log`, `/tools/memory-radar`, and `/migrate` that are **not** in the smoke table (verified each: "NOT in smoke"). FbtMonitor, Rules, EventRecorder, and MemoryRadar are real lazy pages (`web/src/App.tsx:62,70,71,74`).
- Impact: A crash-on-mount regression in any of those 6 pages passes CI. The smoke suite is the project's primary "every page renders" guard (per `MEMORY.md` notes), so the gap is meaningful.
- Fix: Add the 6 missing routes to the smoke `routes` array with permissive `/./` markers (already the pattern for most pages).

### M3. Several modified/new web lib modules lack dedicated unit tests
- Dir: `web/src/lib/` — modules touched in this dirty tree with NO `__tests__` file: `thumbnails.ts`, `seenThumbnails.ts`, `library.ts`, `experimental.ts`, `ui-prefs.ts`, `vrcFriends.ts`, `useDiscordPresence.ts`, `useFriendsPipelineSync.ts` (each verified "NO TEST").
- Problem: 23 lib modules already have `__tests__` (e.g. `feed-recorder`, `assets-cache`, `image-cache`, `osc-studio`), but the above — several modified in this Wave-2 pass per `git status` — have only indirect smoke coverage.
- Impact: Pure-logic helpers (caching/dedupe/prefs) regress silently. Lower severity for the thin React hooks (better covered by integration), but `library.ts`, `seenThumbnails.ts`, and `ui-prefs.ts` are testable pure logic.
- Fix: Add focused vitest specs for at least the pure-logic modules (`seenThumbnails`, `library`, `ui-prefs`), following the existing `web/src/lib/__tests__/*.test.ts` pattern.

### M4. MD-INDEX.md lists docs that exist but are untracked, and omits new Wave-2 docs
- File: `docs/MD-INDEX.md:55` lists `docs/BEAT-VRCX-PLAN.md`; `:59` lists `docs/CACHE-ARCHITECTURE.md`; `:63` lists `docs/ENHANCEMENT-ROADMAP.md`.
- Problem: `git ls-files --error-unmatch` confirms `docs/BEAT-VRCX-PLAN.md`, `docs/CACHE-ARCHITECTURE.md`, `docs/ENHANCEMENT-ROADMAP.md`, `docs/SURPASS-VRCX-MASTER-PLAN.md`, and `docs/SURPASS-VRCX-WAVE2-SPEC.md` are all **UNTRACKED** (`??` in `git status`). MD-INDEX references the first three as if they were checked-in source-of-truth, and does not list `SURPASS-VRCX-MASTER-PLAN.md` or `SURPASS-VRCX-WAVE2-SPEC.md` at all (nor the new `docs/wave2-research/` dir).
- Impact: The index — which the project mandates as the doc-map entry point — points to files that are not in version control, so a fresh clone is missing them while the index claims they exist. Conversely two new planning docs are undiscoverable via the index.
- Fix: Either commit those docs (preferred, since MEMORY.md treats them as continuity surface) or remove the dangling MD-INDEX entries. Add `SURPASS-VRCX-*` and `wave2-research/` to the index once their tracking status is decided.

### M5. MEMORY.md / NEXT-AGENT-HANDOFF.md assert "clean working tree" / "paused development" while a large Wave-2 change set is uncommitted
- Files: `MEMORY.md:18-22` ("active development is paused after this checkpoint"); `docs/NEXT-AGENT-HANDOFF.md:8` ("Working tree expectation: clean after the v0.14.6 release checkpoint").
- Problem: `git status` shows 60+ modified files plus new C++ (`AvatarIdHarvest.cpp`), 17 new log atoms (`src/core/LogAtoms.h:32-49`), VRC+/avatar workspace refactors, and 5 new untracked planning docs. This is substantial feature work, contradicting both the "paused" and "clean tree" claims.
- Impact: Continuity docs no longer describe reality. A new agent reading them would assume no in-flight work and could clobber or misattribute the Wave-2 change set.
- Fix: Refresh `MEMORY.md` and `NEXT-AGENT-HANDOFF.md` to record the in-progress Wave 2 (log-atom expansion, avatar-id harvest, workspace refactor) and update the "Last updated" stamps (currently `2026-06-24` / `2026-06-25`).

---

## LOW

### L1. CHANGELOG `[Unreleased]` does not mention the in-flight Wave-2 work
- File: `CHANGELOG.md:1-2` — `[Unreleased]` only says development is paused; lists no new behavior.
- Problem: 17 new log atoms, avatar-id harvest, and OSC/telemetry changes are on disk but absent from the changelog.
- Impact: When the next release is cut, the changelog will be missing user-visible additions unless someone reconstructs them from git history.
- Fix: Add Wave-2 entries to `[Unreleased]` as the work lands.

### L2. CMakePresets has no dedicated test/CI preset; ctest relies on manual build-dir path
- Files: `CMakePresets.json` (only `x64-debug`/`x64-release` configure+build presets; no `testPresets`); `MEMORY.md:30,60` invoke `ctest --test-dir build\x64-release`.
- Problem: Tests are wired correctly (`CMakeLists.txt:48-49` `enable_testing()` + `add_subdirectory(tests)`; `tests/CMakeLists.txt:24` `gtest_discover_tests`), but there is no `testPresets` entry, so `ctest --preset` is unavailable and the verification baseline hardcodes the build path.
- Impact: Minor — works today, but a path-based ctest invocation is more fragile than a named preset and is undiscoverable from `cmake --list-presets`.
- Fix: Add a `testPresets` block bound to `x64-release` (and `x64-debug`) so `ctest --preset x64-release` works.

### L3. package_release.ps1 SHA256 release-notes step is manual and easy to skip
- File: `package_release.ps1:79-94` emits `VRCSM_v<ver>_release-notes.txt` with the `SHA256:` line, but pasting it into the GitHub release notes is a manual step (`:100`).
- Problem: `UpdatePackage.cpp` refuses to install an MSI whose hash does not match the `SHA256:` line in release notes (documented in the script comment at `:80-83`). If the human forgets to paste it, the in-app updater silently can't install.
- Impact: Low (release-time human error, not a code defect), but it is a known foot-gun gated only by a `Write-Host` reminder.
- Fix: Consider having the GitHub upload step (`gh release edit --notes-file`) consume `release-notes.txt` automatically so the hash line is never dropped.

---

## Area health summary

- **Build wiring is sound.** New C++ (`AvatarIdHarvest`) and removed web modules are correctly reflected in CMake/imports with no dangling references; version is synced at `0.14.6` across `VERSION`, `web/package.json`, README artifact names, and `package_release.ps1`; the WiX installer harvests host + `web/**` + `plugins/**` correctly.
- **Test coverage is strong but has targeted gaps.** 16 of 17 new log atoms have golden-line tests; only `UdonException` (H2) is uncovered. The pages-smoke suite misses 6 live routes (M2) and several touched lib modules lack unit tests (M3).
- **Docs have drifted from the live tree.** Multiple continuity/architecture claims are stale: "10 pages" vs 27 (M1), "clean/paused tree" vs a large Wave-2 change set (M5), and MD-INDEX referencing untracked docs (M4). Plus two un-ignored scratch artifacts risk an accidental commit (H1).
