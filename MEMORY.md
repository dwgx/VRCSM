# VRCSM Agent Memory

Last updated: 2026-04-29

This is the repo-local handoff entrypoint. It exists because future agents should not have to rediscover the project state, document map, or the avatar/SteamVR decisions from chat history.

## Read First

1. `AGENTS.md` or `CLAUDE.md` — operating rules, architecture, build commands, safety constraints.
2. `docs/NEXT-AGENT-HANDOFF.md` — current repo state, last verified build, recent commits, open seams.
3. `docs/MD-INDEX.md` — all Markdown files and what each one is for.
4. `CHANGELOG.md` — release history and user-visible behavior.
5. Only then inspect code.

## Current Continuity Snapshot

- Current branch: `main`.
- Latest known pushed commit: `74e522a Harden preview cache and thumbnail loading`.
- Current user priority: stability and correctness over speculative UI. When a feature is still uncertain, keep the UI honest instead of pretending it is verified.
- Last verified release artifact: `build\msi\VRCSM-0.14.3-x64.msi`.
- Last verified runtime: `build\x64-release\src\host\VRCSM.exe`.

## High-Value Context

- Avatar rows derived only from VRChat logs do not contain a trustworthy historical thumbnail URL.
- A wearer profile image is the wearer's current public image. It may be useful as a clearly labeled reference, but it must not be shown as a verified historical avatar thumbnail unless the avatar name/current avatar match is verified.
- Successful wearer/reference image lookups are cached by VRCSM, but bulk-loading the entire avatar list made the UI laggy. Keep visible rows fast, lookahead low-priority, and clicked rows highest priority.
- Steam Link / Quest repairs must always be backup-first. Do not delete SteamVR/Steam config directly; move/archive and record what happened.
- Plugin IPC is intentionally permission-scoped. Do not re-expand `ipc:shell` into filesystem access.

## Verification Baseline

Use this sequence before claiming a release-facing change is done:

```powershell
pnpm --prefix web build
pnpm --prefix web test:smoke
cmd.exe /s /c '"D:\Software\MS\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-release'
ctest --test-dir build\x64-release --output-on-failure
scripts\build-msi.bat
Start-Process -FilePath "D:\Project\VRCSM\build\x64-release\src\host\VRCSM.exe"
```

If `VRCSM.exe` is already running, stop it before the C++ release build or the linker may fail with file lock / access denied.

## Do Not Lose These Constraints

- Do not mutate VRChat user data during tests; use temp directories.
- Destructive operations stay dry-run first.
- Preserve `__info` and `vrc-version` in `Cache-WindowsPlayer`.
- Keep project docs and release notes aligned with actual shipped behavior.
- Do not update global Codex memory files from inside this repo. This file is the repo-local memory artifact.
