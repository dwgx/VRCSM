# Friends Page Optimization Plan

Last updated: 2026-06-23

This is the page-level execution guide for improving `web/src/pages/Friends.tsx`.
It narrows the broader relationship-system research into an implementable UI and
data-flow plan. The goal is not to clone VRCX; the goal is to build a denser,
faster, more source-aware Friends workspace that keeps reusable API calls and
view-model logic out of the page component.

## Verified Baseline

Current VRCSM evidence:

- `web/src/pages/Friends.tsx` owns the main list, localStorage cache, refresh
  state, Pipeline subscription, background polling, filters, grouping, rows,
  row expansion, action menu, and detail dialog state.
- `web/src/components/FriendDetailDialog.tsx` already has useful detail blocks:
  profile, world, current avatar, actions, recent activity, avatar history and
  local notes.
- `web/src/lib/useFriendsPipelineSync.ts` is already mounted from `App` and
  updates the TanStack Query cache from Pipeline events. This overlaps with the
  page-local Pipeline subscription in `Friends.tsx`.
- `web/src/lib/friends-pipeline.ts` is a pure reducer for Pipeline friend
  events and should be preserved.
- `web/src/lib/vrcFriends.ts` already has location parsing, trust rank helpers,
  status buckets, instance labels and relative-time helpers.
- `web/src/lib/vrchat-api.ts`, `web/src/lib/social.ts`, and
  `web/src/lib/shell-api.ts` already exist as the preferred API facade layer for
  new page code.
- `@tanstack/react-virtual` is already a dependency in `web/package.json`, so
  virtualized friend rows do not require a new frontend package.
- `ThumbImage` already provides lazy thumbnails, deterministic placeholders and
  eager priority support for above-fold rows.

VRCX reference baseline:

- Local reference clone: `D:\Reference\VRCX`.
- Current local commit and GitHub `master` both resolve to
  `e69d1e983ced794b791317e2b75ec3d23bdb8780`.
- Latest checked commit: `e69d1e98` (`Fix group moderation actions`,
  2026-06-09).
- `Version`: `2026.05.03`.
- Relevant VRCX files checked:
  - `src/views/FriendsLocations/FriendsLocations.vue`
  - `src/views/Sidebar/components/FriendsSidebar.vue`
  - `src/views/Sidebar/friendsSidebarUtils.js`
  - `src/views/FriendList/FriendList.vue`
  - `src/views/FriendList/columns.jsx`
  - `src/stores/charts.js`
  - `src/services/database/feed.js`
  - `src/services/database/gameLog.js`
  - `src/coordinators/friendRelationshipCoordinator.js`

## Current Problems To Fix

### 1. The page owns too many responsibilities

`Friends.tsx` currently combines transport calls, local cache persistence,
Pipeline event merge, polling, filtering, grouping, row rendering, action state,
expanded-row detail, and modal detail state. This makes every change risky.

Fix direction:

- Keep raw IPC and VRChat actions in `web/src/lib/social.ts`,
  `web/src/lib/vrchat-api.ts`, and `web/src/lib/shell-api.ts`.
- Move pure view-model logic into a testable module, for example
  `web/src/lib/friends-view-model.ts`.
- Move visual pieces into `web/src/components/friends/`.
- Keep `Friends.tsx` as composition: query state, selected view, selected
  friend, layout, and wiring.

### 2. Friend state has two competing owners

The page keeps its own `data` state and subscribes directly to Pipeline events.
The app-level `useFriendsPipelineSync()` also listens to Pipeline events and
updates the React Query cache. `TabFriends`, `Dashboard` and other surfaces use
query cache, while `Friends.tsx` uses page state. These can diverge.

Fix direction:

- Create one `useFriendsList({ includeOffline })` path backed by TanStack Query.
- Seed it from the current localStorage warm cache if needed, but do not keep a
  second authoritative page copy.
- Remove the page-local Pipeline subscription once the query-cache path handles
  the selected offline mode correctly.
- Track `lastFetchedAt` / `lastPipelineAt` in hook state or query metadata; do
  not attach ad-hoc fields such as `__polledAt` to `FriendsListResult`.

### 3. The current list is not virtualized

The page renders grouped rows directly and uses a fixed `max-h-[600px]`. A large
friend list with offline friends, expanded rows, thumbnails and per-row world
queries will not scale well.

Fix direction:

- Build flat virtual row models: section header, friend row, location header,
  empty row.
- Use `@tanstack/react-virtual` for the center list and table.
- Keep row heights predictable. Expanded detail should move to the right
  inspector instead of changing row height in the main list.
- Persist collapsed section state separately from row render state.

### 4. Per-row world details can become N+1

`FriendRow` calls `world.details` for each visible friend with a world location.
React Query dedupes identical world IDs, but the component still creates many
queries and offscreen rows can request work if the full list is rendered.

Fix direction:

- In Phase 1, fetch world names only for visible virtual rows and the selected
  inspector.
- Group location rows by `worldId` / instance first so one world name serves the
  group header.
- In Phase 2, add a backend or facade-level batch enrichment only if profiling
  shows the visible-row approach is still too chatty.

### 5. The default information architecture is too flat

The current page is a single status-bucketed list plus a modal detail dialog.
Same-instance friends, local favorites, joinable friends and offline friends are
available only as secondary details or in other workspace tabs.

Fix direction:

- Make `Locations` the default operational view.
- Add compact view modes: `Locations`, `List`, `Table`, `Timeline`, `Mutuals`,
  `Requests`.
- Put smart groups on the left: `Me`, `Same Instance`, `Favorites`, `Joinable`,
  `Online`, `Active`, `Offline`, `Has Notes`, `Recent Changes`.
- Put the selected friend inspector on the right for desktop.
- Keep the modal/dialog path only for narrow layouts or deep links.

### 6. Actions need a stricter capability model

Current row action state treats `canJoin` and `canRequestInvite` almost the same:
both are true for any parsed world location. That is too coarse for private,
invite-only, invite-plus, group and traveling/offline cases.

Fix direction:

- Add a pure `getFriendActionState(friend, selfLocation)` helper.
- Return explicit booleans and reason strings:
  `canJoin`, `canSelfInvite`, `canRequestInvite`, `canInviteToMe`,
  `canOpenProfile`, `joinDisabledReason`, `inviteDisabledReason`.
- Keep action execution in API facade functions.
- Use the same helper in row menu, inspector, workspace friend tab and command
  palette actions.
- Record recent successful actions in local UI state so repeated invite/request
  actions show feedback.

2026-06-23 first pass:

- `Friends.tsx` row context menu and three-dot menu now expose a larger
  VRCX-inspired action set using existing facades only:
  - friend detail
  - open VRChat profile
  - join room
  - self-invite to the friend's room
  - request invite
  - invite friend to the user's current room
  - open world page
  - copy display name, user ID, location, world ID and current avatar ID
- Destructive relationship actions remain in `FriendDetailDialog`, where the
  current confirmation flow already exists.
- A remaining follow-up is to replace the inline action booleans with a shared
  `getFriendActionState()` helper so row menu, inspector and workspace widgets
  cannot drift.

2026-06-23 second pass:

- `Friends.tsx` now has smart view chips above the list:
  - all
  - local favorites
  - same instance
  - joinable
  - online
  - offline
  - has current avatar data
- The main list row click now selects a friend instead of expanding the row.
  The old expansion stays behind the row's left chevron.
- A desktop quick inspector was added on the right side. It shows selected
  friend identity, trust, platform, status text, location, world ID and current
  avatar, plus direct actions:
  - join room
  - self-invite to the selected friend's room
  - invite the friend to the user's current room
  - add/remove local favorite
  - open full friend detail
  - open VRChat profile
- Main list avatars now use `ThumbImage` instead of direct `ImageZoom`, so row
  thumbnails get deterministic placeholders and lazy image loading.
- The inspector uses existing local favorite APIs through `library.ts`; no new
  backend endpoint was added.

### 7. Thumbnails and profile images need list discipline

Tiny list avatars currently use `ImageZoom` directly. `ImageZoom` is useful for
detail surfaces, but list rows should prioritize fast paint, deterministic
fallbacks and lazy loading.

Fix direction:

- Use `ThumbImage` for list avatars and same-instance chips.
- Use `ImageZoom` only in inspector/detail surfaces.
- Mark only the first visible rows as `priority="eager"`.
- Avoid loading large profile images in offscreen rows.

### 8. Search and filters are useful but shallow

Current search covers name, status description, bio, user ID, trust label, world
ID and avatar name. It does not expose filter chips for favorite groups, same
instance, joinability, local notes, platform, source or recent changes.

Fix direction:

- Keep one fast text search box.
- Add filter chips or a compact filter popover:
  - Online / Active / Offline
  - Same Instance
  - Joinable
  - Favorites / local groups
  - Has Note
  - Platform
  - Trust rank
  - Location privacy class
- Normalize text once per friend in the view model. Include display name, user
  ID, status text, bio, note, world name, world ID, avatar name and previous
  names when available.
- Cache normalized search fields by friend ID plus revision fields.

### 9. The detail dialog should become an inspector

`FriendDetailDialog` contains many valuable sections, but a modal interrupts
list exploration and duplicates row expansion data.

Fix direction:

- Extract a reusable `FriendInspectorContent` from `FriendDetailDialog`.
- Desktop: render it in a right-side inspector panel.
- Narrow layout: keep the existing dialog/drawer behavior.
- Use tabs inside the inspector:
  - Overview
  - Activity
  - Avatars
  - Notes
  - Mutuals
- Keep destructive actions behind confirmation.

### 10. Degraded states are not distinct enough

The page should visually distinguish:

- Not logged in
- Auth expired
- API error
- Rate limited
- Cached/stale snapshot
- Pipeline connected/disconnected
- VRChat not running
- No offline friends loaded
- Empty filter result

Fix direction:

- Add a compact sync/status strip near the toolbar.
- Show the data source and age: `REST snapshot`, `Pipeline live`, `cached`,
  `polling off`, `last updated`.
- Do not let `auth_expired` silently look like an empty friend list.

## Target Layout

### Desktop

Use a three-region workspace:

- Top toolbar:
  - search input
  - view segmented control
  - filter chips / filter popover
  - offline toggle
  - refresh button
  - live state indicator
- Left rail:
  - smart groups and saved filters
  - remote favorite groups when available
  - local favorite groups from existing local favorites
- Center:
  - virtualized `Locations`, `List`, `Table`, `Timeline`, `Mutuals` or
    `Requests` content
- Right inspector:
  - selected friend profile, location, avatar, actions, notes, history and
    stats

Use `react-resizable-panels` only if the existing layout already needs resizable
behavior. Otherwise start with fixed responsive columns and avoid adding
panel-state complexity in the first slice.

### Narrow Layout

- Hide the left rail behind a filter/group sheet.
- Make the right inspector a dialog or drawer.
- Keep the virtualized center list as the primary screen.
- Preserve the same action menu and view model as desktop.

## View Modes

### Locations

Default view for day-to-day VRChat usage.

Rows:

- Same-instance group, pinned when present.
- Favorite groups.
- Instance/world groups.
- Joinable friends.
- Active/private/offline summaries.

Behavior:

- Group by exact `location` when possible.
- Show world name in group header, not repeated on every row.
- Show instance type, region and privacy class in the header.
- Show friend rows as compact identity + status + platform + action icons.
- Keep private/offline/traveling states privacy-preserving; do not infer hidden
  world names.

### List

Dense, virtualized row list for fast scanning.

Rows:

- Status section headers.
- Friend rows with avatar, name, trust color, status, world/location, platform,
  note marker, favorite marker and action menu.

Behavior:

- No row expansion.
- Click selects friend in inspector.
- Double-click or primary action can join only when action state allows it.

### Table

VRCX-style power table.

Phase 1 columns from current data:

- Avatar
- Display name
- Status
- Location
- Trust
- Platform
- Status text
- Current avatar
- Last login/activity
- Local favorite
- Note indicator

Later columns after persistence/stat work:

- Mutual count
- Mutual opt-out / not fetched / failed state
- Seen together count
- Total co-presence time
- Last same instance
- Shared worlds
- Relationship age
- Display-name changes
- Avatar changes

Requirements:

- Column visibility persistence.
- Stable sort state.
- Virtualized rows.
- No network call per cell.

### Timeline

Local evidence feed.

Sources:

- Pipeline friend events.
- `friend_log`.
- Local VRChat logs / player events.
- Notes.
- Avatar history.
- Future normalized social event tables.

Each event should show the source: `Pipeline`, `Friends Poll`, `VRChat Log`,
`Manual Note`, or `Imported`.

### Mutuals

Manual and opt-in only.

Start with:

- Fetch mutuals for the selected friend.
- Cache result and error metadata.
- Show `not fetched`, `hidden`, `failed`, `0`, and count as different states.

Later:

- Full friend graph job.
- Rate limit.
- Backoff on 429.
- Progress.
- Cancel.
- Resume/cached snapshot.

Do not auto-fetch the full mutual graph on startup.

### Requests

Unify visible social action queues:

- Friend requests.
- Invites.
- Request-invite responses.
- Notification actions.

This should consume normalized notification data from `social.ts`, not raw
notification IPC shapes inside the page.

## Proposed Module Split

Frontend pure view model:

- `web/src/lib/friends-view-model.ts`
  - `buildFriendSearchIndex(friend, extras)`
  - `filterFriends(friends, filters)`
  - `buildStatusSections(friends)`
  - `buildLocationGroups(friends, selfLocation, favoriteGroups)`
  - `buildVirtualRows(model)`
  - `getFriendActionState(friend, selfLocation)`
  - `sortFriendsForList(friends, mode)`

Frontend API/domain facade:

- `web/src/lib/social.ts`
  - friend notes
  - local friend groups
  - notification wrappers
  - social stats wrappers
  - future mutual job wrappers
- `web/src/lib/vrchat-api.ts`
  - raw VRChat user/friend/invite/profile actions already present
- `web/src/lib/shell-api.ts`
  - VRChat launch/profile/world URL helpers already present

Frontend components:

- `web/src/components/friends/FriendAvatar.tsx`
- `web/src/components/friends/FriendActionMenu.tsx`
- `web/src/components/friends/FriendListRow.tsx`
- `web/src/components/friends/FriendLocationGroup.tsx`
- `web/src/components/friends/FriendToolbar.tsx`
- `web/src/components/friends/FriendSmartGroups.tsx`
- `web/src/components/friends/FriendInspector.tsx`
- `web/src/components/friends/FriendTable.tsx`

Page:

- `web/src/pages/Friends.tsx`
  - route composition only
  - selected view/filter/friend state
  - calls hooks/components

## Implementation Phases

### Phase 0 - Do not refactor on a broken base

The current tree has many pending fixes around updater packaging, migration,
avatar preview, log atoms and API facades. Do not start the large Friends UI
rewrite until the baseline still passes the verification set in
`docs/UI-REPAIR-VRCX-PARITY-PLAN.md`.

### Phase 1 - Single source of truth and pure view model

Scope:

- Add `friends-view-model.ts` with tests.
- Add a `useFriendsList({ includeOffline })` hook or equivalent query wrapper.
- Remove page-local Pipeline subscription after query-cache update behavior is
  confirmed.
- Replace ad-hoc polling timestamp mutation with typed metadata.
- Keep the visible page layout mostly unchanged.

Verification:

- Unit tests for filtering, status sections, location groups and action state.
- Existing page smoke tests still pass.
- Manual check: Pipeline event changes update Friends page and workspace friend
  widgets consistently.

### Phase 2 - Virtualized list and desktop inspector

Scope:

- Extract friend row/avatar/menu components.
- Replace row expansion with selected friend inspector.
- Use `ThumbImage` in list rows.
- Use `@tanstack/react-virtual` for the center list.
- Keep `FriendDetailDialog` as narrow-layout fallback by reusing inspector
  content.

Verification:

- Mock 1,000 friends in tests or story-like fixtures and assert the rendered DOM
  stays bounded.
- Check keyboard selection, context menu and action buttons.
- Check long names/statuses do not overlap.

### Phase 3 - Locations view and smart groups

Scope:

- Add `Locations` and `List` segmented views.
- Build same-instance, favorite, joinable, online, active and offline groups.
- Fetch world details only for visible group headers and selected inspector.
- Persist collapsed smart groups.

Verification:

- Same-instance group appears when multiple friends share location.
- Favorite/local group filters do not duplicate rows.
- Private/offline/traveling users do not expose guessed location details.

### Phase 4 - Dense table from existing data

Scope:

- Add `Table` view with columns available from current friend data, notes and
  local favorites.
- Persist sort, column visibility and column order.
- Avoid per-cell network calls.

Verification:

- Sort/filter/column persistence tests.
- Page smoke with table mode selected.

### Phase 5 - Local stats and timeline

Scope:

- Add local-only stats from existing DB evidence before adding new API traffic:
  seen together count, total co-presence, last same instance, shared worlds,
  recent profile/status/avatar changes.
- Add Timeline view using existing `friend_log`, avatar history and local logs.

Verification:

- Database fixtures for stats.
- Timeline source labels are visible.
- Empty stats show as `not enough local data`, not zero.

### Phase 6 - Mutual graph and requests

Scope:

- Add manual mutual fetch for selected friend.
- Add opt-in full graph job later with progress/cancel/rate-limit/backoff.
- Add Requests view from normalized notification wrappers.

Verification:

- Mutual states: not fetched, hidden, failed, zero, count.
- Full graph job never starts without explicit user action.
- Cancel leaves previous cached graph intact.

## First Code Slice Recommendation

The first PR should be intentionally small:

1. Add `friends-view-model.ts` and unit tests.
2. Add `getFriendActionState()`.
3. Move search/filter/status grouping out of `Friends.tsx`.
4. Change tiny row avatars from direct `ImageZoom` to `ThumbImage`.
5. Replace the raw expanded-row `shell.openUrl` call with
   `openVrchatLocation()` from `shell-api.ts`.
6. Leave the layout visually close to the current page.

This produces immediate maintainability and performance wins without mixing in
table, mutual graph, DB migrations or new backend endpoints.

## Acceptance Criteria

Before calling the Friends page upgrade complete:

- Page data has one authoritative owner.
- No reusable raw `ipc.call(...)` remains in `Friends.tsx`.
- Large lists use virtualized rows.
- Tiny row thumbnails use lazy `ThumbImage`.
- Desktop has a persistent inspector; modal detail remains only for narrow
  layouts or explicit open-in-dialog behavior.
- Same-instance and favorites are first-class filters/groups.
- Join/request-invite/invite actions use one shared capability helper.
- World detail enrichment does not create offscreen N+1 work.
- Search handles names, IDs, notes, status text, world names/IDs, avatar names
  and trust labels.
- Auth expired, cached stale data, API failure and empty filters are visually
  distinct.
- Mutual graph fetch is opt-in, rate-limited and cancelable before full-graph
  support ships.
- Tests cover view-model grouping/filtering/action-state behavior.

Minimum verification after implementation:

```powershell
web\node_modules\.bin\tsc.cmd -b web\tsconfig.json --pretty false
web\node_modules\.bin\vitest.cmd run src/__tests__/pages-smoke.test.tsx
web\node_modules\.bin\vitest.cmd run src/__tests__\friends-view-model.test.ts
git diff --check
```

For layout-sensitive batches, also run a browser/Electron smoke and capture
desktop plus narrow screenshots of:

- signed out
- loading
- cached stale snapshot
- normal online list
- same-instance group
- table mode
- selected friend inspector
- API error

## Do Not Do

- Do not copy VRCX source code into VRCSM.
- Do not auto-fetch the full mutual graph.
- Do not infer private world or hidden instance details.
- Do not add raw new IPC calls directly inside `Friends.tsx`.
- Do not put table metrics, mutual graph jobs and notification requests into
  the first visual refactor.
- Do not add another frontend state owner for the friend list.
- Do not expand the page with nested cards inside cards.
- Do not turn `FriendDetailDialog` into another copy of the same UI; extract
  shared inspector content instead.
