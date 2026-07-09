# VRCSM Markdown Index

Last updated: 2026-07-09

This file maps the repo's Markdown documents so the next agent can start from the right source instead of scanning randomly.

> Note: **v0.15.0 released 2026-07-09; v0.15.1 is local-only (7 commits ahead of origin, unpushed)** — 0.15.1 adds QQ Music lyrics, OSC sliders, and the i18n-language / factory-reset-thumbnail / {music.lyrics}-send fixes. Several docs below labeled "plan" now describe work that has already shipped (OSC Studio, the now-playing music module). Current test baseline: ctest 151/151 (3 opt-in live network probes DISABLED), 363 vitest (run `--no-file-parallelism`), Playwright UI smoke 54/54. i18n is at full parity across all 7 locales. See `docs/review-2026-07/GUI-API-CONTRACT-AUDIT-2026-07-09.md` for the latest GUI↔API audit + remediation, and `MEMORY.md` "Post-0.15.0 local work" for the lyrics/OSC/RE follow-ups.

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
  - The `[Unreleased]` section currently records the three release-blocking regression fixes (shutdown async-IPC drain, unbounded `migrate.execute` timeout, MSI ONNX wasm inclusion) and still carries a "development is paused after v0.14.6" line that is now STALE — a major feature area (now-playing music + lyrics + tray) has since shipped on `main`.

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

- `docs/BEAT-VRCX-PLAN.md`
  - 2026-06-29 execution plan to beat (not just match) VRCX on three tracks: hardware telemetry (vendor-neutral CPU/GPU/VRAM), persistent searchable Feed/GameLog, and relationship chains + GUI click-convenience.
  - Carries verified-against-code facts (Pipeline already emits all events but doesn't persist a feed; `db.playerEncounters` is unused by any page; VRChat `GET /users/{userId}/mutuals/friends` DOES exist so real mutual-friend edges are obtainable). Mutual-friends fetch is opt-in + rate-limited. Read before starting telemetry/social/GUI feature slices.

- `docs/CACHE-ARCHITECTURE.md`
  - Cache ownership and registry for SQLite, `%LocalAppData%\VRCSM`, WebView2, React Query, localStorage, thumbnails, previews, updates, and plugin data.
  - Read before changing cache behavior, adding prefetch, changing invalidation, or touching account-scoped warm caches.

- `docs/ENHANCEMENT-ROADMAP.md`
  - Consolidated audit-fix + deep-research plan (2026-06-29): bundle inspection/preview boundary, hardware telemetry, VRCX parity gaps, relationship-graph + GUI click-convenience design, and the remaining open audit findings (M3/M4/M5/M7/M8/H2/L5).
  - Read before resuming feature work on cache/bundle/telemetry/social tracks; it carries the legal boundary (inspection only, no avatar-export-for-redistribution) and a suggested execution order.

- `docs/FRIENDS-RELATIONSHIP-REDESIGN-RESEARCH.md`
  - Current 2026-06-23 research baseline for rebuilding Friends into a VRCX-class social/relationship workspace.
  - Maps VRCX Friends Locations, Friend List, mutual graph, relationship feed, local stats, public VRChat API boundaries, proposed Social/Relationship modules, data model, UI target, and phased implementation order.

- `docs/FRIENDS-PAGE-OPTIMIZATION-PLAN.md`
  - Focused execution plan for improving `web/src/pages/Friends.tsx` without turning the page into a large mixed-responsibility component.
  - Defines the target Friends workspace layout, state/data-flow cleanup, virtualized list strategy, smart groups, inspector extraction, VRCX-inspired view modes, phased implementation order, and acceptance tests.

- `docs/OSC-STUDIO-PLAN.md`
  - 2026-06-23 execution plan for turning the raw OSC sender/listener into a modular OSC Studio. **Largely shipped:** draggable card composition, template variables, hardware/system telemetry cards, and Chatbox safety rules are implemented. Since extended by the now-playing music module (see `docs/NOW-PLAYING-OSC-PLAN.md`).
  - Read as historical design context; the live surface is `web/src/pages/OscTools.tsx` + `web/src/pages/osc/`.

- `docs/NOW-PLAYING-OSC-PLAN.md`
  - Design doc for the shipped now-playing music → VRChat OSC chatbox module.
  - Data source is GSMTC via `src/core/NowPlaying.{h,cpp}` + `music.nowPlaying` IPC (`src/host/bridges/MusicBridge.cpp`); web `{music.*}` tokens + OSC Studio `NowPlayingPanel.tsx` + presets. Covers synced lyrics (`{music.lyrics}` / `{music.lyricsTranslated}`) via `web/src/lib/lyrics.ts` (LRCLIB + NetEase) routed through the `src/core/LyricsProxy` + `lyrics.fetch` host proxy with its SSRF rail.

- `docs/SURPASS-VRCX-MASTER-PLAN.md`
  - 2026-06-29 research-synthesis roadmap consolidating four research streams into a plan to surpass (not just match) VRCX. Strategic context.

- `docs/SURPASS-VRCX-WAVE2-SPEC.md`
  - Implementation-ready Wave-2 spec. Source of truth is the four verified reports in `docs/wave2-research/`. Read before starting Wave-2 feature slices.

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

## Internal Reference Documentation

- `docs/reference/` (start at `docs/reference/README.md`)
  - Evidence-backed internal technical reference for the whole codebase, in Chinese with `path:line` citations.
  - Index + nav tree, architecture/layer model, per-subsystem C++ core docs, host + IPC bridge method catalog, web frontend, three cross-cutting flow chapters (IPC round-trip / data & cache lifecycle / plugin security model), and build & release.
  - Aligned with (does not contradict) `CLAUDE.md` and `docs/CACHE-ARCHITECTURE.md`. Read the relevant subsystem page before changing cache, avatar preview, SteamVR repair, plugin IPC, or packaging behavior.
- `docs/reference/ARCHITECTURE-COMPREHENSION-2026-07.md`
  - Adversarially-verified full architecture-comprehension reference (commit `a4350d2`). Best single-doc system model — start here.
- `docs/reference/UI-SMOKE-FINDINGS-2026-07-04.md`
  - Playwright UI-smoke findings (54/54 baseline): real-browser screenshot + DOM-offset checks over all routes on mock IPC.
- `docs/reference/MAINTENANCE.md`
  - Reference maintenance guide: linkage-update map, known code/doc contradiction tracking table, and the refresh procedure for keeping `docs/reference/` accurate.

## Code Review & Audit

- `docs/review-2026-07/` — 2026-07 multi-area review + audit set.
  - `GUI-API-CONTRACT-AUDIT-2026-07-09.md` — **latest.** Full read-only GUI↔API (IPC) contract audit: 185 handlers × 128 call sites, fanned out per bridge domain + adversarially verified, grade B-. A 9-batch foreground remediation sweep landed most findings (SSRF, `{error}`-envelopes, auth transient-error, OSC float, destructive-op guards, updater tiering, batch chunking, analytics DOT-timestamps, error-code consistency, plugin sandbox) — see the 2026-07-09 block in `NEXT-AGENT-HANDOFF.md` for the commit map. Batches B10 (smoke-coverage) + B11 (dead-code) remain.
  - `REVIEW-SUMMARY.md` — master summary with the per-finding remediation status table. Start here.
  - `IPC-CONTRACT-DRIFT-2026-07.md` — IPC contract-drift sweep (99/101 clean). The `plugin.marketFeed` `permissions` omission it flagged is now FIXED (commit `133c3af`: `MarketEntry` carries permissions, `ParseFeed` reads them, `MarketEntryToJson` emits them).
  - `ROBUSTNESS-MODULARITY-AUDIT-2026-07-04.md` — full-stack robustness + modularity audit.
  - `area-build-docs.md`, `area-cpp-core.md`, `area-cpp-host-ipc.md`, `area-diff.md`, `area-web-lib.md`, `area-web-pages.md` — the six per-area review shards.
  - `deep/AUDIT-VERDICT.md` — 9-axis quality audit, overall C+.

## Research Reports

- `docs/wave2-research/` — verified research reports backing the SURPASS specs.
  - Wave-2 sources: `vrchat-api.md`, `vrcx-features.md`, `vrcsm-gaps.md`, `log-max-coverage.md`, `own-overlap-algorithm-design.md`, `vrcx-quickwins.md`, `vrcx-smallfeatures-verified.md`.
  - Wave-3 set: `wave3-discord-ipc.md`, `wave3-file-upload.md`, `wave3-impl-facts.md`, `wave3-log-signatures.md`, `wave3-win-toast.md`.

## Plugin Docs

- `plugins/vrc-auto-uploader/README.md`
  - Auto-Uploader plugin documentation.
  - Covers install/usage/roadmap for the bundled `dev.vrcsm.autouploader` panel plugin.

## Generated / Ignored Markdown

No generated Markdown should be treated as source of truth unless it is checked in and listed above. Ignore `build/`, `tmp/`, `node_modules/`, `third_party/`, and `.git/`.
