# VRCSM Agent Memory

Last updated: 2026-06-24

This is the repo-local handoff entrypoint. It exists because future agents should not have to rediscover the project state, document map, or the avatar/SteamVR decisions from chat history.

## Read First

1. `AGENTS.md` or `CLAUDE.md` — operating rules, architecture, build commands, safety constraints.
2. `docs/NEXT-AGENT-HANDOFF.md` — current repo state, last verified build, release checkpoint, and open follow-ups.
3. `docs/MD-INDEX.md` — all Markdown files and what each one is for.
4. `CHANGELOG.md` — release history and user-visible behavior.
5. Only then inspect code.

## Current Continuity Snapshot

- Current branch: `main`.
- Release status: `v0.14.6` shipped on 2026-06-24; active development is paused after this checkpoint unless the user explicitly resumes feature work.
- Current user priority: repository hygiene, release stability, and critical fixes over speculative feature growth.
- Last verified release artifact: `build\release\VRCSM_v0.14.6_x64_Installer.msi`.
- Last verified runtime: `build\x64-release\src\host\VRCSM.exe`.
- Current version: `0.14.6` (release checkpoint on 2026-06-24; development paused after this version unless a critical fix is explicitly requested).

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
