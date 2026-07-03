# Beat-VRCX Execution Plan — Telemetry, Social, GUI

Last updated: 2026-06-29

This is the execution plan for three tracks the user wants to not just match but
**beat VRCX** on. It builds on, and does not duplicate:

- `docs/UI-REPAIR-VRCX-PARITY-PLAN.md` — overall parity sequencing + API-library rule.
- `docs/FRIENDS-RELATIONSHIP-REDESIGN-RESEARCH.md` — friend/relationship data model research.
- `docs/ENHANCEMENT-ROADMAP.md` — audit fixes + bundle/telemetry research.
- `docs/CACHE-ARCHITECTURE.md` — cache ownership rules (account-scoping is mandatory).

Hard rules carried in: new reusable IPC/API calls live in `web/src/lib` domain
modules, not pages. Account-derived caches stay account-scoped. No VRChat data
mutation without explicit user action. Mutual-friends fetch is **opt-in +
rate-limited** (user decision 2026-06-29), never auto-fetched on startup.

Verified-against-code facts (2026-06-29):
- Pipeline (`src/core/Pipeline.h`) already surfaces every friend presence/notification
  event. `useFriendsPipelineSync.ts` consumes `friend-online/active/location/update`
  but **only patches React Query** — it does not persist a durable, replayable feed.
- `db.playerEncounters` IPC exists (`DatabaseBridge.cpp:210`, `ipc.ts:2044`) but is
  **used by no page** — shared-instance history is computed nowhere in the UI.
- `/social` (`SocialGraph.tsx`) is a client-side leaderboard, not a graph.
- VRChat API `GET /users/{userId}/mutuals/friends` **exists** (verified on
  vrchat.community), returns mutual friends between self and a target user,
  auth-cookie required, `n`≤100 + `offset` paging. So real mutual-friend edges
  are obtainable — the earlier "FoF impossible" note was wrong.
- Telemetry: CPU load % is null unless LHM/AIDA64 runs; GPU live data is
  NVIDIA-only (NVML); no PDH, no `IDXGIAdapter3`, no AMD path linked.

---

## Track A — Hardware Telemetry (beat VRCX: VRCX has almost none)

VRCX's telemetry is minimal. Our bar is not "match VRCX" — it is "best-in-class
vendor-neutral telemetry without forcing a third-party monitor or kernel driver."

### A1. Native CPU load % (highest value, zero deps)
- `GetSystemTimes` delta needs state across calls; `CollectTelemetry` is one-shot.
- Add a process-lifetime sampler singleton holding the previous idle/kernel/user
  snapshot; the OSC auto-loop already polls `hw.telemetry` so it drives the delta.
- File: `src/core/hw/HwTelemetry.cpp` — add `ProbeCpuLoad(snapshot)` in the probe
  chain (after `ProbeMemory`), guarded by `if (!snapshot.cpu.loadPct.has_value())`
  so a real sensor monitor still wins. Beats VRCX: works with zero extra software.
- **SHIPPED 2026-06-29:** `ProbeCpuLoad` runs last in `CollectTelemetry` (after the
  LHM/OHM/AIDA64 sensor probes so they keep priority); `ComputeCpuLoadFromSystemTimes`
  keeps a mutex-guarded process-lifetime sample and falls back to a 250ms blocking
  sample on first/stale read. Pure math in `CpuLoadFromTicks` + unit tests
  (`CommonTests.CpuLoadFromTicks*`). Emits a `system_times_cpu_load` source row.

### A2. Vendor-neutral live VRAM used (AMD/Intel get nothing today)
- `IDXGIAdapter3::QueryVideoMemoryInfo(0, LOCAL, ...)`. `GpuProbe.cpp` already uses
  `dxgi1_6.h`, so the interface is present. Match by the chosen adapter LUID so it
  reflects the displayed GPU, not a virtual adapter.
- File: `GpuProbe.cpp::EnumerateDxgiAdapters` / `HwTelemetry.cpp::ProbeDxgiGpuAdapters`.
- **SHIPPED 2026-06-29:** `GpuAdapterInfo` now carries a packed `luid` (`PackLuid`,
  unit-tested for negative-HighPart bit-pattern safety). `QueryDxgiVideoMemoryUsed(luid)`
  re-enumerates, matches the chosen adapter by LUID, queries `IDXGIAdapter3`
  segment LOCAL. `ProbeDxgiGpuAdapters` fills `gpu.memoryUsedBytes` when empty
  (NVML still refines NVIDIA later) and emits a `dxgi_video_memory` source row.

### A3. Vendor-neutral GPU load % via PDH GPU Engine
- Sum `\GPU Engine(*)\Utilization Percentage` for the chosen adapter LUID. Add
  `pdh.lib` to `src/core/hw/CMakeLists.txt`. Closes GPU-usage for AMD/Intel.

### A4. AMD GPU temp/power/fan via ADLX (dynamic-load, mirror NVML)
- Clone the `LoadNvml`/`NvmlApi` dynamic-load pattern into `LoadAdlx`/`AdlxApi`;
  call `ProbeAdlx` after `ProbeNvml`, fill only GPU fields still empty.

### A5. Per-core CPU + new OSC tokens (after A1/A3 exist)
- PDH `% Processor Utility` per-core; add `cpu.cores[]` to the snapshot + `to_json`
  and new tokens in `web/src/lib/osc-studio.ts`.

Out of scope unless explicitly requested: ring0 MSR driver for Tctl/Tdie (signing
+ security cost). Document the ACPI-thermal-zone limitation in the OSC UI instead.

Verification: extend `tools` telemetry probe / add a focused unit around the
sampler delta; manual OSC Studio live-value check.

---

## Track B — Social: persistent Feed / GameLog + relationship chains (the headline)

This is where VRCSM currently feels thinner than VRCX. The data already flows; it
is not persisted or surfaced. The "beat VRCX" angle: VRCX's feed is a flat scroll;
ours is a **persisted, searchable, replayable relationship memory** backed by the
local DB, cross-linked to worlds/avatars and the co-presence graph.

### B1. Backend: durable feed + presence event tables (C++ / SQLite)
- New tables (extend `Database.cpp` schema, idempotent migration, read
  `PRAGMA user_version` to gate — see audit M7/L7): `friend_presence_events`
  (presence/location/status/avatar flips with source + timestamp) and a unified
  feed read model joining `friend_log`, `player_events`, presence events, avatar
  sightings, notes.
- New `Database` insert/query methods + `DatabaseBridge` handlers; register in
  `IpcBridge.cpp` (+ `AsyncMethodSet` for heavy queries). Wrap in `ipc.ts`/`types.ts`.
- Pipeline events route through one central insert helper, not page-local logic
  (the research doc's coordinator separation).
- **SHIPPED 2026-06-29:** Schema v13 adds `friend_presence_events` (idempotent
  CREATE-IF-NOT-EXISTS, gated by `PRAGMA user_version`, three indexes).
  `Database::RecordFriendPresenceEvent` / `RecentFriendPresenceEvents` /
  `UnifiedFeed` (UNION ALL over friend_log + player_events + friend_presence_events
  + avatar_history with a `source_kind` discriminator, kind/user/time filters,
  paginated). Bridge handlers `friendPresence.record` / `friendPresence.recent` /
  `feed.unified` registered async in `IpcBridge.cpp`. TS wrappers + `FeedEntryDto`/
  `FriendPresenceEventDto`/`FeedSourceKind` in `ipc.ts`. Integration test
  `CommonTests.UnifiedFeedMergesSourcesInTimeOrder` covers merge order, source
  filter, and time window. **Central insert helper SHIPPED 2026-06-29:**
  `web/src/lib/feed-recorder.ts` is the single coordinator — `recordPresenceFromPipeline`
  maps friend-online/offline/active/location pipeline events to `friendPresence.record`
  inserts (deriving world/instance via `parseLocation`, fire-and-forget). Wired into
  `useFriendsPipelineSync` using the pre-reducer cache snapshot. Unit-tested in
  `feed-recorder.test.ts` (6 cases).

### B2. Frontend: always-on Feed widget + live GameLog
- New `web/src/lib/feed.ts` domain module + `FeedPanel` / `GameLogPanel` components.
- Subscribe to pipeline + `logs.stream` (both already exist); render a virtualized,
  filterable feed (by event type, friend, world, time). Persisted, so it survives
  restart — VRCX loses scrollback that VRCSM will keep.
- Account-scoped: wire any feed cache through `cache-ownership.ts`.
- **SHIPPED 2026-06-29:** `web/src/lib/feed.ts` normalizes raw `feed.unified` rows
  into a `FeedEntry` (canonical `FeedCategory`, derived world/instance, stable key);
  `fetchFeed` pushes a `source_kind` hint when a category maps cleanly and narrows
  shared-source categories (online vs offline) client-side. `web/src/pages/Feed.tsx`
  (`FeedPanel`) renders it: category filter chips + search + paginated infinite query,
  live-refreshes on friend pipeline events (`usePipelineEvent` → invalidate
  `qk.feed.root`), account-scoped via `qk.feed.root` in `cache-ownership.ts`. Surfaced
  as a new "Feed" tab in `Radar.tsx`. i18n `feed.*` block in en.json (defaultValue
  fallbacks for other locales). Tested in `feed.test.ts` (10 cases). Build + tsc clean,
  112/112 frontend tests pass. **GameLogPanel + virtualization SHIPPED 2026-06-29:**
  `web/src/pages/GameLog.tsx` (`GameLogPanel`) tails the raw `logs.stream` chunks
  (separate from the classified `logs.stream.event` the Logs page uses) — buffered
  120ms flush, 5k-line cap, level filter (info/warn/error) + search, pause/resume,
  follow-tail with auto-detach on manual scroll-up and a "jump to latest" affordance.
  Refcounts the shared host tailer via `logs.stream.start/stop`. New "Game Log" tab in
  `Radar.tsx` (`gamelog` in `RadarTab`), i18n `gameLog.*` block. FeedPanel list is now
  virtualized with `@tanstack/react-virtual` (dynamic `measureElement`, infinite scroll
  auto-loads the next page when the last row enters view — replaces the manual "Load
  more" button).

### B3. Relationship chains (replace the `/social` leaderboard)
- **Co-presence edges (local, always on):** compute in C++ from `player_events`
  intersected over `world_visits` time windows; nodes weighted by `player_encounters`.
- **Confirmed-friendship edges:** self→friend from `friends.list`/`friend_log`.
- **Mutual-friend edges (opt-in, rate-limited):** new `VrcApi` wrapper for
  `GET /users/{userId}/mutuals/friends`, behind an explicit per-user "load mutuals"
  action with a cancellable/rate-limited fetch, cached with opt-out/403/404 tracking
  (per research doc Phase 4). Never auto-fetch on startup.
- **"How you're connected":** BFS shortest path over the combined edge set,
  each hop justified by the world/instance + timestamp (co-presence) or confirmed
  mutual. This is the feature VRCX does not have — our headline differentiator.
- New IPC: ego-network nodes/edges + connection-path, computed in core (SQLite join
  is cheap there). Add to `Database`/`DatabaseBridge`/`IpcBridge`/`ipc.ts`/`types.ts`.

### B4. Shared-worlds + mutual count in FriendDetailDialog (quick win, existing data)
- `db.playerEncounters` already returns per-user/world co-presence — surface it now
  as a "shared worlds / times seen / last seen" list in the detail dialog.
- **SHIPPED 2026-06-29:** `FriendDetailDialog` now queries `db.playerEncounters` and
  renders a "Shared Worlds" section (per-world `EntityLink`, times-seen count, last-seen
  relative time, total times-seen header). Hidden when there's no co-presence data.

### B5. Notifications: desktop tray toast (VRCX parity) — later slice
- Windows toast for friend-online / invite / request. No toast code today. Keep
  permission-scoped; opt-in in Settings.

Verification: DB upsert/event-insert unit tests; BFS path unit test on a seeded
graph; frontend smoke (`pages-smoke`) + feed/graph component tests; mutual-friends
fetch cancel test (partial results don't corrupt cache).

---

## Track C — GUI click-convenience (immediate, pure frontend, low risk)

The "click anything to drill in" experience VRCX has. Start here because it is
frontend-only and unblocks B's graph navigation.

### C1. Unified `EntityLink` component
- One `<EntityLink kind="user|world|avatar" id name />` used everywhere a
  user/world/avatar is mentioned. Click → opens the right popup/detail. Today some
  names are clickable, some aren't (e.g. `SocialGraph.tsx`, `Logs.tsx` plain text).
- New `web/src/components/EntityLink.tsx`; replace plain-text mentions across pages.

### C2. `AvatarPopupBadge` for parity with `UserPopupBadge`/`WorldPopupBadge`
- New component so avatar mentions get the same hover/click drill-in as users/worlds.

### C3. Universal entity context menu
- Extract the rich context menu currently inline in `Friends.tsx` into
  `web/src/components/social/EntityContextMenu.tsx`, reuse from badges/links.

### C4. Back/breadcrumb nav across stacked dialogs
- Lightweight nav context so user→world→user drill chains can step back (defer to
  after C1-C3).

Verification: `tsc -b`, `pages-smoke`, targeted component tests, `git diff --check`.

---

## Execution order (user chose: three tracks in parallel)

Run all three progressing, but land safe slices first within each:

1. **C1+C2+C4-data (GUI)** — pure frontend, immediate payoff, unblocks B3 nav.
2. **A1+A2 (telemetry)** — native CPU load %, DXGI VRAM-used; independent, low risk.
3. **B4 (shared worlds)** + **B1 (feed/presence tables)** — surface existing data,
   then build the durable backend.
4. **B2 (Feed/GameLog widget)** on top of B1.
5. **A3+A4 (PDH GPU / ADLX)** — vendor-neutral GPU telemetry.
6. **B3 (relationship graph + mutual-friends + connection path)** — headline feature.
7. **A5 per-core, B5 toasts** — polish/parity tail.

Each landed slice must pass the per-track verification above and keep the existing
release build green. Update `NEXT-AGENT-HANDOFF.md` per shipped slice.

## Where we beat VRCX (the explicit goal, per feature)

- Telemetry: vendor-neutral live CPU/GPU/VRAM with **zero third-party software**;
  VRCX has effectively none.
- Feed: **persisted + searchable + replayable** across restarts, cross-linked to the
  co-presence graph; VRCX's is a flat live scroll.
- Relationship graph: **"how you're connected" shortest-path** over co-presence +
  confirmed + mutual edges; VRCX has no connection-path feature.
- Plus existing VRCSM-only wins (radar, FBT, 3D preview, SteamVR repair, cache
  migration, plugin market, OSC studio) that VRCX lacks entirely.
