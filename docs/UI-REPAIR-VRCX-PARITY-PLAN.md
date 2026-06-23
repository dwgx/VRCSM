# UI Repair And VRCX Parity Plan

Last updated: 2026-06-23

This plan is the current execution guide for repairing visible UI problems and
then adding VRCX-parity features without scattering one-off IPC calls across
pages.

## Sources Checked

- Current VRCSM route surface: `web/src/App.tsx`, `web/src/components/Sidebar.tsx`.
- Current host IPC surface: `src/host/IpcBridge.cpp`.
- Current frontend API style: `web/src/lib/ipc.ts`, `web/src/lib/update.ts`,
  `web/src/lib/library.ts`, `web/src/lib/auth-context.tsx`.
- Current verification baseline: `docs/NEXT-AGENT-HANDOFF.md`.
- VRCX current public baseline: GitHub repo `vrcx-team/VRCX`, local reference
  clone at `D:\Reference\VRCX`, `master` commit
  `e69d1e983ced794b791317e2b75ec3d23bdb8780` (`Fix group moderation
  actions`, 2026-06-09), `Version` file `2026.05.03`.
- Local unpacking reference checked: `D:\Project\vrchat-il2cpp-re`. It is useful
  for cache/log correlation ideas, but it is not a complete Unity/VRChat avatar
  model unpacker.

## VRCX Local Source Audit - Friends And Avatars

VRCX is useful as a product and module-boundary reference, not as code to copy.
Its current social/avatar implementation is split into:

- API wrappers: `src/api/friend.js`, `src/api/notification.js`,
  `src/api/favorite.js`, `src/api/group.js`, `src/api/avatar.js`, and
  `src/api/avatarModeration.js`.
- Stores: `src/stores/friend.js`, `src/stores/favorite.js`,
  `src/stores/notification/index.js`, `src/stores/avatar.js`, and
  `src/stores/avatarProvider.js`.
- Coordinators: `src/coordinators/friendSyncCoordinator.js`,
  `src/coordinators/friendPresenceCoordinator.js`,
  `src/coordinators/friendRelationshipCoordinator.js`,
  `src/coordinators/favoriteCoordinator.js`,
  `src/coordinators/avatarCoordinator.js`,
  `src/coordinators/groupCoordinator.js`, and
  `src/coordinators/searchIndexCoordinator.js`.
- Local persistence: `src/services/database/avatarFavorites.js`,
  `src/services/database/friendFavorites.js`,
  `src/services/database/notifications.js`, and
  `src/services/database/moderation.js`.
- Local host/cache boundary: `src/coordinators/cacheCoordinator.js`,
  `Dotnet/AssetBundleManager.cs`, and
  `Dotnet/AppApi/Common/LocalPlayerModerations.cs`.

Important social patterns to adapt:

- Keep friend relationship changes, friend presence/location changes, and
  initial friend-list sync as separate flows. VRCX uses separate coordinators
  for relationship events, presence updates, and bootstrap refresh; VRCSM
  should avoid putting all friend state mutation into page components.
- Treat remote VRChat favorites and local favorites as different products.
  VRCX has remote favorite groups and local favorite groups for friends,
  worlds, and avatars. VRCSM should expose this difference in both API names
  and UI copy so users know what syncs to VRChat.
- Notification Center should normalize legacy and v2 notification shapes into
  one local table/list before UI categorization. Pages should consume a stable
  `NotificationEntry`, not raw IPC variants.
- Search should be index-backed where possible. VRCX syncs friends and avatars
  into a quick-search index; VRCSM should prefer local DB/search IPC before
  adding new network calls.

Important avatar/model patterns to adapt:

- VRCX's safe core is official API usage: list/get avatars, select avatar,
  select fallback avatar, save own avatar metadata/release status, delete own
  avatar, image/gallery upload, favorite groups, and impostor enqueue/delete.
- My Avatars is a real management surface, not only a search result list:
  table/grid mode, search, release-status filter, platform filter, tags,
  context actions, and persistent table state.
- Avatar details should combine remote API data, local avatar history, favorite
  state, platform/package analysis, local cache status, and time-spent history
  into one dialog/view model.
- VRCX can optionally query an external avatar database provider
  (`https://api.avtrdb.com/v3/avatar/search/vrcx`) when the advanced setting is
  enabled. VRCSM should not enable third-party avatar lookup by default; if
  added later, put it behind an explicit setting and a dedicated provider
  module, not the normal VRChat API facade.
- Cache operations must remain guarded. VRCX checks/deletes VRChat asset-bundle
  cache entries via its host layer; VRCSM should continue using its own cache
  scanner/deletion constraints, preserve required cache metadata, and block
  destructive cache edits while VRChat is running.

Avatar/moderation safety boundary:

- Official avatar moderation endpoints (`auth/user/avatarmoderations`) are
  candidates for a future `vrchat-api.ts` wrapper if the UI clearly explains
  the action.
- Direct local edits to VRChat `LocalPlayerModerations/*.vrcset` are a higher
  risk boundary. Start with read-only display if needed. Do not write those
  files while VRChat is running or without an explicit user action and recovery
  path.
- Do not implement private-avatar copying, asset URL bypasses, client bypasses,
  game injection, or any feature that depends on bypassing VRChat access
  checks.

## Local Unpacking Reference Audit

`D:\Project\vrchat-il2cpp-re` should not be treated as the canonical model
extractor for VRCSM. The useful reference there is `tools/load_cached_worlds.py`:
it inventories `Cache-WindowsPlayer/<top>/<sub>/__info` and `__data`, records
timestamps and sizes, and correlates cached assets with log lines such as
destination changes and `AssetBundleDownloadManager` unpacking messages.

No complete UnityFS/CAB/LZ4/LZMA/Texture2D/SkinnedMeshRenderer-to-GLB export
pipeline was found in that repository. Its Frida and IL2CPP runtime scripts are
research tooling, not a safe default dependency for this desktop app. VRCSM
should keep model preview extraction in its own guarded native parser and only
port low-risk cache/log correlation patterns.

## Working Tree Rule

There are local fixes pending for migration IPC, database dedupe, update IPC,
update package validation, release asset filename syncing, avatar preview
diagnostics, frontend API facades, packaging scripts, and `.codegraph/` ignore.
Do not start broad UI refactors until that patch remains buildable and the new
updater package files stay included in the patch.

## Execution Order

### Phase 0 - Baseline Lock

Goal: make the current local fixes a safe base before UI work.

1. Confirm `src/core/updater/UpdatePackage.{h,cpp}` are included in the patch.
2. Run C++ tests and `ctest`.
3. Run frontend TypeScript and page smoke tests.
4. Keep pnpm dependency build-script approvals project-local in
   `web/pnpm-workspace.yaml`.
5. Keep `.codegraph/`, `build/`, `web/node_modules/`, MSI artifacts, and
   generated frontend output out of Git.

Current Phase 0 status on 2026-06-23:

- `UpdatePackage.{h,cpp}` are present in the patch.
- `web/pnpm-workspace.yaml` records approvals for `esbuild`,
  `onnxruntime-node`, `protobufjs`, and `sharp`, so `pnpm build` is no longer
  blocked by ignored dependency build scripts.
- Debug and release C++ tests, TypeScript, page smoke, full frontend build,
  package generation, and startup smoke have all passed locally.

### Phase 1 - Visible UI Repair

Goal: fix display problems before adding new features.

Priority pages:

1. `Dashboard` - empty DB, stale scan, missing log history, current session,
   update banner, and card overflow states.
2. `Friends` and `VrchatWorkspace` - online state, location labels, detail
   panes, context actions, long names, and auth-expired behavior.
3. `Avatars` and `AvatarBenchmark` - thumbnail fallbacks, log-only avatars,
   wearer reference images, pagination, and long avatar names.
4. `Worlds` and `WorldHistory` - world card layout, instance labels, history
   table readability, and launch/open actions.
5. `Radar` and `Logs` - multi-subscriber log stream state, empty log folder,
   live event rendering, and local history clarity.
6. `Settings` - Registry, SteamVR, Hardware, General, and dangerous-operation
   disabled states.

Required verification for each touched page:

- Existing route still passes `pages-smoke`.
- Add or strengthen route-specific assertions when a display bug is fixed.
- Run TypeScript after any public type or API-wrapper change.
- Use screenshots or a browser smoke pass for layout-sensitive changes when a
  page could overflow or hide content.

### Phase 2 - Use Existing Backends Before New Backends

Goal: expose the value already present in VRCSM before adding new host APIs.

High-value areas already backed by current IPC:

1. Notification Center: `notifications.*`.
2. Quick Search improvements: `search.global`.
3. My Avatars and avatar history: `avatar.details`, `avatar.search`,
   `avatar.select`, `db.avatarHistory.*`.
4. Activity and social analytics: `db.playerEvents.list`, `friendLog.recent`,
   `db.stats.*`.
5. Favorites and local library: `favorites.*`, `friendNote.*`.
6. Screenshots and metadata: `screenshots.*`.

### Phase 3 - VRCX Parity Features

VRCX `v2026.05.03` added or improved these feature groups. VRCSM should copy
the useful product shape, not the implementation style.

1. Customizable dashboard panels.
2. Status bar with VRChat status, session tracking, and clock.
3. My Avatars grid/table.
4. Social status presets.
5. Activity statistics and overlap data.
6. Hot Worlds discovery.
7. Sidebar/global Quick Search.
8. Notification Center.
9. Local favorite friend groups.
10. Context menus and action bars.
11. Table sort state, column visibility, column order, and independent
    pagination.

Do not implement private-avatar copying, client bypasses, game injection, or
anything that depends on violating VRChat server-side access checks.

## API Library Rule

New frontend API calls must not be introduced directly inside pages or visual
components unless they are tiny one-off shell actions. Put reusable calls in
domain modules under `web/src/lib`, then import those domain functions from
pages.

Preferred pattern:

```ts
// web/src/lib/social.ts
import { ipc } from "@/lib/ipc";
import type { NotificationListResult } from "@/lib/types";

export async function listNotifications(): Promise<NotificationListResult> {
  return ipc.call<undefined, NotificationListResult>("notifications.list", undefined);
}
```

Then page code should call the library method:

```ts
import { listNotifications } from "@/lib/social";

const notifications = await listNotifications();
```

Do this for new features:

- `web/src/lib/social.ts` - notifications, friend notes, local friend groups,
  activity summaries.
- `web/src/lib/vrchat-api.ts` - VRChat user, avatar, world, group, moderation,
  invite, and status actions.
- `web/src/lib/history-api.ts` - local DB visits, player events, avatar
  history, heatmaps, and global search.
- `web/src/lib/media-api.ts` - screenshots, screenshot metadata, uploads,
  image cache helpers.
- `web/src/lib/shell-api.ts` - external URLs, VRChat launch URLs, opening
  folders, app actions.

Existing modules stay valid:

- `web/src/lib/update.ts` remains the update API facade.
- `web/src/lib/library.ts` remains the favorites/library facade.
- `web/src/lib/auth-context.tsx` remains the auth state provider.
- `web/src/lib/ipc.ts` remains the low-level transport and typed fallback
  methods.

Do not perform a large mechanical rewrite just to move old calls. Wrap old raw
`ipc.call` usage only when touching that feature area or when a new feature
would otherwise duplicate the same call.

## Good Code Rules For New API Wrappers

- Keep request and response types in `web/src/lib/types.ts` when reused by more
  than one module.
- Keep private page-only view models next to the page, but do not put IPC
  response types there if another page will reuse them.
- Wrapper names should describe product intent, not the IPC wire name:
  `listNotifications()` is better than `notificationsList()`.
- Normalize backend aliases in the wrapper when the backend must support old
  fields. Pages should get one stable shape.
- Throw normal `IpcError` paths through `ipc.call`; do not convert failures into
  `{ ok: false }` unless the host method intentionally returns a non-exception
  business result.
- Keep optimistic UI updates in hooks or page state, not in the raw API module.
- Prefer TanStack Query hooks near feature modules for cached server state, but
  keep mutation functions in the API module.
- Add mock IPC data or wrapper tests when the feature affects route smoke,
  notifications, search, avatars, friends, worlds, or update flow.

## First Implementation Batch

After Phase 0 is clean, implement in this order:

1. Add missing or stronger smoke assertions for Dashboard, Friends, Avatars,
   Worlds, Radar, Settings, and Plugins.
2. Create the first API facade modules only as features need them; start with
   `social.ts`, `history-api.ts`, and `shell-api.ts`.
3. Move new Notification Center calls into `social.ts`.
4. Move new Quick Search helpers into `history-api.ts`.
5. Move repeated `shell.openUrl` and `vrchat://launch` helpers into
   `shell-api.ts`.
6. Fix display problems discovered during route-by-route audit.
7. Add VRCX-parity feature slices only after the display baseline is stable.

Current first-batch progress on 2026-06-23:

- Update flow now carries the real GitHub release asset filename through
  `update.check`, `update.download`, and `update.install`, so the app no longer
  assumes a hard-coded `VRCSM-<version>.msi` name.
- `UpdatePackage` validates install requests against the updater-managed
  directory, expected filename, optional size, and optional SHA-256.
- Frontend update mock IPC includes update, Discord clear, and screenshot
  watcher methods required by route smoke tests.
- Avatar preview failures preserve specific native parser error codes such as
  `bundle_invalid`, `typetree_unsupported`, `no_meshes`, and `encrypted`.
- `vrchat-api.ts`, `social.ts`, `history-api.ts`, and `shell-api.ts` are the
  preferred facades for new page code; profile and friend action call sites have
  started moving off raw `ipc.call`.

## Verification Checklist

Minimum before reporting a completed UI/API batch:

```powershell
web\node_modules\.bin\tsc.cmd -b web\tsconfig.json --pretty false
web\node_modules\.bin\vitest.cmd run src/__tests__/pages-smoke.test.tsx
git diff --check
```

For C++ or IPC changes also run:

```powershell
cmake --build --preset x64-debug --target VRCSM_Tests
ctest --test-dir build\x64-debug --output-on-failure
cmake --build --preset x64-debug --target vrcsm
```

Do not claim `pnpm build` passed until pnpm dependency build-script approvals
are intentionally handled. Current approvals are intentionally handled in
`web/pnpm-workspace.yaml`; re-check this only when dependencies change or pnpm
asks for new approvals.
