# VRCSM Markdown Index

Last updated: 2026-04-29

This file maps the repo's Markdown documents so the next agent can start from the right source instead of scanning randomly.

## Required Startup Order

1. `MEMORY.md` — repo-local continuity summary and current verification baseline.
2. `AGENTS.md` / `CLAUDE.md` — build rules, architecture, safety constraints.
3. `docs/NEXT-AGENT-HANDOFF.md` — current state and last known release verification.
4. `CHANGELOG.md` — current user-visible behavior and release history.
5. Target-specific docs below.

## Root Docs

- `AGENTS.md`
  - Primary Codex/agent operating instructions for this repository.
  - Contains build commands, architecture, IPC protocol, safety constraints, code style, tech stack lock, and VRChat data paths.

- `CLAUDE.md`
  - Same role as `AGENTS.md`, kept for Claude-style agents.
  - Keep it synchronized when changing agent-facing rules.

- `MEMORY.md`
  - Repo-local memory entrypoint.
  - Records current continuation state, high-value context, and verification baseline.

- `README.md`
  - Public project overview in Chinese, English, and Japanese.
  - User-facing feature list, installation, build-from-source, license notes.

- `CHANGELOG.md`
  - Release history.
  - The `[Unreleased]` section currently carries avatar thumbnail semantics, Steam Link / Quest repair, plugin fixes, and preview/cache notes.

## Planning / Research Docs

- `docs/VRCSM-PLAN.md`
  - Older but still useful product roadmap: VRCX comparison, auth layer plan, social/avatar/world/history feature mapping, and explicit non-goals.
  - Treat as strategic context, not a current implementation contract.

- `docs/v0.2.0-auth-findings.md`
  - Auth sprint decision log.
  - Covers VRChat registry persistence, Steam ticket login, and auth/security decisions.

- `docs/v0.5.0-3d-preview-research.md`
  - Real 3D avatar preview research.
  - Relevant when touching UnityFS parsing, bundle decoding, GLB generation, or preview cache.

- `docs/unity-ide-skeleton.md`
  - UI shell design note for a Unity-like IDE layout.
  - Useful for visual/interaction direction, not a must-follow implementation spec.

- `docs/vrc-settings-keys.md`
  - Large reference for VRChat PlayerPrefs / registry settings.
  - Use when implementing settings UI or deciding which keys are safe/live/startup-only.

## Current Handoff

- `docs/NEXT-AGENT-HANDOFF.md`
  - Current branch, latest commits, verification commands, sensitive decisions, likely next work.
  - Read before changing avatar thumbnails, VRLink repair, plugin permissions, cache deletion, downloads, or release packaging.

## Plugin Docs

- `plugins/vrc-auto-uploader/README.md`
  - Auto-Uploader plugin documentation.
  - Covers install/usage/roadmap for the bundled `dev.vrcsm.autouploader` panel plugin.

## Generated / Ignored Markdown

No generated Markdown should be treated as source of truth unless it is checked in and listed above. Ignore `build/`, `tmp/`, `node_modules/`, `third_party/`, and `.git/`.
