# VRCSM Markdown Index

Last updated: 2026-06-24

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

- `docs/release-v0.14.6.md`
  - Shipped release summary for the paused `v0.14.6` checkpoint.
  - Use when checking the release URL, packaged artifacts, and user-facing notes for the latest published build.

## Planning / Research Docs

- `docs/GLOBAL-SEARCH-SPEC.md`
  - Implementation-backed spec for Global Quick Search + Timeline evidence model.
  - Defines shipped local-only `search.global` v1, the evidence-first result schema, local-first ranking, disabled remote API policy for v1, and 1-month / 3-month follow-up rollout.

- `docs/VRCSM-PLAN.md`
  - Older but still useful product roadmap: VRCX comparison, auth layer plan, social/avatar/world/history feature mapping, and explicit non-goals.
  - Treat as strategic context, not a current implementation contract.

- `docs/UI-REPAIR-VRCX-PARITY-PLAN.md`
  - Current execution plan for fixing visible UI issues, sequencing VRCX-parity work, and keeping new frontend API/IPC calls centralized in `web/src/lib` domain modules.
  - Read before adding Notification Center, Quick Search, My Avatars, social analytics, table behavior, or other VRCX-inspired UI features.

- `docs/FRIENDS-RELATIONSHIP-REDESIGN-RESEARCH.md`
  - Current 2026-06-23 research baseline for rebuilding Friends into a VRCX-class social/relationship workspace.
  - Maps VRCX Friends Locations, Friend List, mutual graph, relationship feed, local stats, public VRChat API boundaries, proposed Social/Relationship modules, data model, UI target, and phased implementation order.

- `docs/FRIENDS-PAGE-OPTIMIZATION-PLAN.md`
  - Focused execution plan for improving `web/src/pages/Friends.tsx` without turning the page into a large mixed-responsibility component.
  - Defines the target Friends workspace layout, state/data-flow cleanup, virtualized list strategy, smart groups, inspector extraction, VRCX-inspired view modes, phased implementation order, and acceptance tests.

- `docs/OSC-STUDIO-PLAN.md`
  - Current 2026-06-23 execution plan for turning the raw OSC sender/listener into a modular OSC Studio.
  - Defines draggable card composition, template variables, hardware/system telemetry cards, Chatbox safety rules, existing OSC bridge boundaries, first-slice implementation and future sensor backends.

- `docs/v0.2.0-auth-findings.md`
  - Auth sprint decision log.
  - Covers VRChat registry persistence, Steam ticket login, and auth/security decisions.

- `docs/v0.5.0-3d-preview-research.md`
  - Real 3D avatar preview research.
  - Relevant when touching UnityFS parsing, bundle decoding, GLB generation, or preview cache.
  - Older R&D note; re-check against `docs/AVATAR-PREVIEW-UNPACKING-RESEARCH.md` before assuming an external extractor CLI is still the preferred path.

- `docs/AVATAR-PREVIEW-UNPACKING-RESEARCH.md`
  - Current 2026-06-23 research refresh for local VRChat bundle unpacking and preview.
  - Maps current native UnityFS/Mesh-only pipeline, `vrchat-il2cpp-re` cache/log learnings, VRCX cache behavior, external parser options, and the modular implementation slices for full preview work.

- `docs/unity-ide-skeleton.md`
  - UI shell design note for a Unity-like IDE layout.
  - Useful for visual/interaction direction, not a must-follow implementation spec.

- `docs/vrc-settings-keys.md`
  - Large reference for VRChat PlayerPrefs / registry settings.
  - Use when implementing settings UI or deciding which keys are safe/live/startup-only.

## Current Handoff

- `docs/NEXT-AGENT-HANDOFF.md`
  - Current branch, latest commits, verification commands, sensitive decisions, likely next work.
  - Read before changing avatar thumbnails, global search, VRLink repair, plugin permissions, cache deletion, downloads, or release packaging.

## Plugin Docs

- `plugins/vrc-auto-uploader/README.md`
  - Auto-Uploader plugin documentation.
  - Covers install/usage/roadmap for the bundled `dev.vrcsm.autouploader` panel plugin.

## Generated / Ignored Markdown

No generated Markdown should be treated as source of truth unless it is checked in and listed above. Ignore `build/`, `tmp/`, `node_modules/`, `third_party/`, and `.git/`.
