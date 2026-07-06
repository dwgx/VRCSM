# VRCSM Agent Memory

Last updated: 2026-07-07

This is the repo-local handoff entrypoint. It exists because future agents should not have to rediscover the project state, document map, or the avatar/SteamVR decisions from chat history.

## Read First

1. `AGENTS.md` or `CLAUDE.md` — operating rules, architecture, build commands, safety constraints.
2. `docs/NEXT-AGENT-HANDOFF.md` — current repo state, last verified build, release checkpoint, and open follow-ups.
3. `docs/MD-INDEX.md` — all Markdown files and what each one is for.
4. `CHANGELOG.md` — release history and user-visible behavior.
5. Only then inspect code.

## Current Continuity Snapshot

- Current branch: `main`.
- Release status: `v0.14.6` shipped on 2026-06-24. A large uncommitted **Wave-2** change set is in the working tree (new atoms/harvest/OSC/telemetry/social features + a whole-project security review). The "development paused / clean tree" wording from the v0.14.6 checkpoint is stale — the tree is NOT clean.
- Current user priority: repository hygiene, release stability, and critical fixes over speculative feature growth.
- Last verified release artifact: `build\release\VRCSM_v0.14.6_x64_Installer.msi`.
- Last verified runtime: `build\x64-release\src\host\VRCSM.exe`.
- Current version: `0.14.6`.

## Memories

- [session-persist-diagnosis](memory/session-persist-diagnosis.md) — "每次重登" 真凶是快捷方式指向 7/1 旧 release,持久化层本身正常

### 2026-07-03 review-remediation session

- A prior session ran a 6-area multi-agent review; reports are in `docs/review-2026-07/` (`REVIEW-SUMMARY.md` is the master). It was cut off at 100% context mid-fix.
- This session verified/finished all HIGH + security-MEDIUM fixes. Most had already landed; the remaining gaps closed here were **lib H2** (LRU `memoSet` cap added to `thumbnails.ts` + `assets-cache.ts`, matching `image-cache.ts`) and **build-docs H1** (`.gitignore` now covers `_build_*.bat`, `_tmp_*.bat`, `*-review.png`).
- Verified 2026-07-03: `pnpm build` clean, `pnpm test` 238/238, `test:smoke` 27/27, C++ release build up-to-date, `ctest` 100/100 (1 skipped: `RealLogClassificationTally`).
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
  `ort-wasm-simd-threaded.asyncify-*.wasm` file present.

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
