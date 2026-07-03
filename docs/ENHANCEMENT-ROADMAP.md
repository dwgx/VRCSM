# VRCSM Enhancement Roadmap

Last updated: 2026-06-29

This is the consolidated research + planning surface produced from a full audit and
deep-research pass over the codebase, the live VRChat cache, the VRCX reference, and
current Windows telemetry APIs. It is a plan, not a record of shipped work. Each
section ends with concrete file-level next steps.

Scope decisions baked in:
- **Bundle work stays on the inspection/preview side.** Local metadata, mesh stats,
  and bounded preview thumbnails for the user's own cache are legitimate. A full
  avatar mesh/texture **export-for-redistribution** pipeline (GLB/FBX of other
  people's avatars) is "model ripping" — against VRChat ToS and community norms —
  and is intentionally out of scope. Encrypted bundles stay walled off (no
  decryption attempts).
- Project is in a release-checkpoint posture (`v0.14.6`). Treat these as planned
  feature tracks to resume deliberately, not an open-ended rewrite.

---

## Track 0 — Audit fixes (status: partially shipped this pass)

Done and verified (build + 54/54 tests pass):
- **Migrator integer-overflow** (`src/core/Migrator.cpp` `sizeOf` + copy loop): `file_size()`
  returns `(uintmax_t)-1` on error; now only folded into the running total when the
  call succeeds. Prevents corrupted free-space/verify accounting.
- **Migration verify beyond byte total** (`Migrator.cpp` verify step): now compares
  file count AND byte total before renaming the source to backup.
- **MSI hash mandatory / fail-closed** (`src/core/updater/UpdatePackage.cpp`):
  `ValidateDownloadedPackage` now rejects a missing/empty SHA256 with `update_hash`
  instead of passing on size-only. `package_release.ps1` now always emits a
  `SHA256:` release-notes snippet so legitimate releases keep working. New tests:
  `UpdatePackageValidationRejectsMissingSha256`, `...RejectsWrongSha256`.

Still open from the audit (not yet fixed):
- **M3** SafeDelete lacks a reparse-point guard before `remove_all` (SteamVR path has one).
- **M4** VrcApi interpolates unencoded IDs into URL paths; reachable by plugins with
  `ipc:vrc:api`. Percent-encode path segments or validate ID patterns.
- **M5/M6** Plugin `ipc:fs:listDir` (whole-disk enumeration) and `ipc:fs:writePlan`
  (arbitrary-dir write) lack base containment; `.`/`-` plugin host-label collision.
- **M7** `CacheIndex::LoadPersisted` now does per-entry filesystem I/O synchronously
  under the lock at startup — move validation into the background `ScanWorker`.
- **M8** `asset_cache` grows unbounded; add TTL/LRU prune (index already exists).
- **H2** Frontend account-switch leak: Friends/Avatars hold account data in `useState`
  that survives an in-place A→B switch (`cache-ownership.ts` can't touch component state).
- **L5** Handler `ex.what()` (often absolute paths) returned verbatim to plugin iframes.

---

## Track 1 — Unity bundle inspection & preview (legitimate)

**Live cache reality (sampled ~200 bundles): ~96% are encrypted** (flag `0x4c0`,
Unity `6000.0.60f1-DWR`) and unparseable by anyone including AssetRipper. Only ~4%
plaintext (older `2022.3.x`). This reframes the whole track: most value is in clear
inventory/metadata UX and honest "this avatar is protected" states, not deeper decode.

Current capability is solid: UnityFS v6-8 header, LZ4/LZ4HC/LZMA blocks, SerializedFile
v17-22, Mesh (class 43) decode, hand-rolled GLB writer (positions/normals/UV0 only, no
materials/textures, capped at 12 meshes — keep it bounded as anti-ripping posture).
Encryption correctly detected and rejected.

Prioritized next steps (value/effort), all additive:
1. **Asset inventory API** — new `src/core/UnityInventory.{h,cpp}`: iterate
   `SerializedFile::objects`, map classId→name, read `m_Name`, parse AssetBundle
   (class 142) `m_Container` for logical paths. Reuses existing parsers. Biggest win.
2. **Per-mesh statistics** — extend `PreviewExtractSummary` (`UnityPreview.h`) with
   per-mesh verts/tris/submeshes/bones/AABB; data already computed in `computeMetrics`,
   just stop discarding it.
3. **Harden encryption detection** — widen `kCustomEncryption` check to `flags & 0x1400`
   (UnityPy shows the bit migrating upstream); emit a real `typetree_unsupported`
   instead of silently skipping at `UnitySerialized.cpp` typetree path.
4. **Texture2D preview decode (opt-in, bounded)** — new `src/core/UnityTexture.{h,cpp}`:
   parse class-28, CPU BC1/BC3/BC7 decode, **downscale to ≤512px thumbnail**, never
   emit source-resolution texture next to the GLB.
5. **Tests** against the 8 plaintext bundles still in the local cache.

---

## Track 2 — Hardware telemetry deep enhancement (OSC Studio)

Biggest current gap: **CPU load % is null on nearly every machine** (only filled if
LHM/OHM/AIDA64 is running). GPU usage/temp/VRAM-used are NVIDIA-only (NVML). AMD/Intel
users get almost nothing live. No PDH, no `IDXGIAdapter3`, no MSR/driver linked.

Roadmap (value÷effort), mirror the existing dynamic-load NVML pattern:
1. **Native CPU load %** — `GetSystemTimes` delta. Needs a process-lifetime sampler
   (CollectTelemetry is currently one-shot; OSC auto-loop can hold it). Zero new deps.
2. **Vendor-neutral live VRAM used** — `IDXGIAdapter3::QueryVideoMemoryInfo` (GpuProbe
   already uses `dxgi1_6.h`). Fills AMD/Intel VRAM-used.
3. **Vendor-neutral GPU load %** — PDH `\GPU Engine(*)\Utilization Percentage` summed
   per chosen adapter LUID; add `pdh.lib`.
4. **ADLX (AMD)** GPU temp/power/fan — clone the `LoadNvml`/`NvmlApi` dynamic-load.
5. Per-core CPU via PDH `% Processor Utility` (needs new tokens + snapshot field).
6. (Optional, gated) ring0 driver for accurate CPU Tctl/Tdie — high effort + signing
   cost; otherwise document the flat-ACPI-temp limitation in the OSC Studio UI.

Extension points: `src/core/hw/HwTelemetry.cpp` (`CollectTelemetry`, probe chain),
`GpuProbe.cpp` (`EnumerateDxgiAdapters`), `src/host/bridges/HwBridge.cpp` (`hw.telemetry`),
`web/src/lib/osc-studio.ts` (tokens already exist for load/temp/VRAM).

---

## Track 3 — VRCX parity catch-up

VRCSM is already *ahead* of VRCX on: radar (process-memory player positions), FBT
monitor, Unity bundle 3D preview, SteamVR repair, NTFS cache migration, hardware
presets, plugin marketplace, OSC tooling, embedding avatar search. The honest gaps —
where VRCSM feels thinner than VRCX — cluster in the social-companion surface:

P0 (biggest perceived gaps):
- **Persistent real-time Feed widget** — VRCSM has the pipeline + log tailer but no
  always-on, scrollable, filterable Online/Offline/GPS/Status/Avatar feed (VRCX's
  signature dashboard). Surface what already flows through `Pipeline` + `LogTailer`.
- **Live GameLog widget** — `LogEventClassifier` + `logs.stream` exist; not surfaced.

P1:
- **Real relationship chains** (see Track 4 — SocialGraph is currently a leaderboard).
- **Mutual / shared-instance view** in `FriendDetailDialog` (`db.playerEncounters`
  already exists per user but is unused by any page).
- **Desktop tray toast notifications** (no WinToast code today).
- **In-VR overlay notifications** (VRCX ships an OpenVR overlay; VRCSM has none).
- **Friendship rollups** — how-we-met / time-together / anniversary.
- **Community avatar DB search** — VRCSM `searchAvatars` hits official API only.

P2: fallback avatar select, avatar tags/styles editor, auto-restart/rejoin, boop, richer
new-instance dialog, friends-locations map, trust-rank coloring.

---

## Track 4 — Relationship graph + GUI click-convenience

**Data truth caveat:** VRChat API only returns the *local user's* friends. A true
friend-of-friend graph using confirmed friendship edges is impossible. The honest,
computable graph is **co-presence based**: nodes = people, edges = "seen together in
the same instance," weighted by frequency. Only self→friend edges are confirmed
friendships; any FoF must be labeled "based on co-presence," never as confirmed.

Data already in SQLite: `player_events` (raw co-presence timeline → edges),
`player_encounters` (pre-aggregated per-user/world → node weights + shared worlds),
`world_visits` (my instance windows), `friend_log` (friendship lifecycle),
`friend_notes`. No graph/viz lib in `web/package.json` (has `three`/r3f); prefer a
dependency-free SVG/Canvas ego-network renderer.

Phased design:
- **Phase 1 (frontend-only):** unified `EntityLink` component so every user/world/avatar
  mention is click-through to its detail; add `AvatarPopupBadge` for parity with
  `UserPopupBadge`/`WorldPopupBadge`; universal entity context menu; shared-worlds list
  in `FriendDetailDialog` (uses existing `db.playerEncounters`).
- **Phase 2 (new IPC):** compute edges in C++ core (SQLite join is cheap there) — new
  `Database` methods + `DatabaseBridge` handlers for ego-network nodes/edges and a
  BFS "how you're connected" shortest co-presence path. Register in `IpcBridge.cpp`
  (+ `AsyncMethodSet`), wrap in `ipc.ts`/`types.ts`.
- **Phase 3:** interactive ego-network graph view (tabs on the existing `/social` page),
  connection-path dialog, lightweight back/breadcrumb nav across stacked dialogs.

File targets are enumerated in the design notes; key edits: `web/src/pages/SocialGraph.tsx`
(replace leaderboard with graph + keep stats as a tab), new `EntityLink.tsx`,
`RelationshipGraph.tsx`, `social-graph.ts`, and the `Database`/`DatabaseBridge`/`ipc.ts`
chain for Phase 2.

---

## Suggested execution order

1. Finish Track 0 security fixes (M3/M4/M5/M7/H2) — small, high safety value.
2. Track 4 Phase 1 (EntityLink + shared-worlds + AvatarPopupBadge) — pure frontend,
   immediate "click-convenient GUI" win the user asked for.
3. Track 2 step 1-2 (native CPU load %, DXGI VRAM-used) — closes the most-felt
   telemetry gap with low effort.
4. Track 3 P0 Feed/GameLog widget — surfaces data that already flows.
5. Track 4 Phase 2-3 (real relationship graph) — the headline social feature.
6. Track 1 inventory/stats — bundle inspection depth.
