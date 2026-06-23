# Friends Relationship Redesign Research

Last updated: 2026-06-23

本文是 VRCSM 好友/关系系统改版的研究基线。目标不是照搬 VRCX，而是在尊重 VRChat API、隐私和限流边界的前提下，把 VRCSM 的好友功能做成更清晰、更可查、更可维护的本地关系系统。

## Executive Summary

VRCSM 当前已经具备好友列表、Pipeline 实时事件、好友日志、好友备注、请求邀请、邀请、静音、拉黑、取消好友、本地收藏等基础能力，但这些能力分散在页面、IPC 包装和局部 DB 表里，还没有形成统一的 Social/Relationship domain。

VRCX 的优势不是某一个 UI 控件，而是完整闭环：

- 好友位置视图把 online、favorite、same-instance、active、offline 拆成可切换分段，并支持搜索、远程收藏组、本地收藏组、虚拟滚动和同实例分组。
- Friend List 是强表格：头像、名称、信任等级、状态、语言、bio link、相遇次数、共处时长、最后遇见、互相关系数、最后活动、最后登录、加入日期、取消好友。
- 互相关系图使用可取消、限速、可缓存的批量抓取流程，并显式记录 opt-out/403/404。
- 好友关系、状态、位置、bio、头像、上下线等变化被写入本地数据库和 feed，可搜索、可过滤、可回放。
- 从游戏日志计算 joinCount、timeTogether、lastSeen，用本地证据补足 API 只能给当前快照的问题。

VRCSM 应该采用同样的数据闭环，但模块边界要比 VRCX 更硬：`VrcApi` 只做原始端点包装，`SocialService` 做同步和事件归一，`Database` 做持久化，`web/src/lib/social.ts` 做前端 domain API，页面只消费 view model。

## Sources Checked

Local source evidence:

- VRCSM current repo: `D:\Project\VRCSM`.
- VRCX local reference: `D:\Reference\VRCX`, commit `e69d1e983ced794b791317e2b75ec3d23bdb8780` (`Fix group moderation actions`, 2026-06-09), `Version` = `2026.05.03`.
- VRCSM doc baseline: `docs/UI-REPAIR-VRCX-PARITY-PLAN.md`, `docs/NEXT-AGENT-HANDOFF.md`, `docs/MD-INDEX.md`.

Public API/documentation sources verified reachable on 2026-06-23:

- VRChat.community / VRChat API community docs: <https://vrchat.community/>
- OpenAPI reference repository: <https://github.com/vrchatapi/specification>
- VRCX GitHub: <https://github.com/vrcx-team/VRCX>
- VRCX VRChat Wiki page: <https://wiki.vrchat.com/wiki/Community:VRCX>
- List Friends: <https://vrchat.community/reference/get-friends>
- Check Friend Status: <https://vrchat.community/reference/get-friend-status>
- Get User Mutual Friends: <https://vrchat.community/reference/get-mutual-friends>
- List Favorites: <https://vrchat.community/reference/get-favorites>
- List Favorite Groups: <https://vrchat.community/reference/get-favorite-groups>
- Add Favorite: <https://vrchat.community/reference/add-favorite>
- Remove Favorite: <https://vrchat.community/reference/remove-favorite>
- Send Friend Request: <https://vrchat.community/reference/friend>
- Unfriend: <https://vrchat.community/reference/unfriend>
- Request Invite: <https://vrchat.community/reference/request-invite>
- Invite User: <https://vrchat.community/reference/invite-user>
- Pipeline WebSocket: <https://vrchat.community/websocket>

API caveat: VRChat.community is community-driven documentation, not an official stability guarantee from VRChat. Treat it as current public API research, keep calls conservative, and keep all risky/high-volume sync opt-in or rate-limited.

## Current VRCSM Social Baseline

Current strengths already present:

- `VrcApi::fetchFriends()` pages through `/api/1/auth/user/friends?offline=...&n=...&offset=...`, avoiding the old single-page truncation issue (`src/core/VrcApi.cpp:1910-1927`).
- `friends.list` validates current auth and returns filtered friend rows through IPC (`src/host/bridges/ApiBridge.cpp:300-330`).
- `Friends.tsx` keeps a localStorage warm cache, refreshes `friends.list`, filters by display name/status/bio/user ID/trust/world/avatar, groups by status bucket, and computes same-location friends (`web/src/pages/Friends.tsx:573-932`).
- Pipeline starts in the host and forwards VRChat event envelopes into WebView as `pipeline.event` (`src/host/bridges/PipelineBridge.cpp:39-69`).
- `friends-pipeline.ts` merges `friend-online`, `friend-offline`, `friend-active`, `friend-location`, `friend-update`, `friend-add`, and `friend-delete` into the cached friend list (`web/src/lib/friends-pipeline.ts:1-117`).
- `useFriendsPipelineSync()` writes selected profile/status/avatar/displayName changes into `friend_log`, and records observed avatar changes into avatar history (`web/src/lib/useFriendsPipelineSync.ts:12-182`).
- Friend detail already reads richer profile data, world details, friend log and notes (`web/src/components/FriendDetailDialog.tsx:145-240`).
- Local persistence already has `friend_log`, `friend_notes`, `local_favorites`, notes and tags (`src/core/Database.cpp:1440-1579`, `src/core/Database.cpp:2880-2939`).
- Workspace friend tab already has joinable friends and locally favorited friends (`web/src/pages/workspace/TabFriends.tsx:307-467`).
- VRChat action wrappers already exist for `listFriends`, `sendFriendRequest`, `removeFriend`, `inviteSelf`, `inviteUser`, `requestInvite`, `muteUser`, `blockUser`, notifications and notes (`web/src/lib/vrchat-api.ts:44-140`, `web/src/lib/social.ts:1-66`).

Main gaps:

- No single backend Social/Relationship service owns sync policy, rate limits, event normalization or source provenance.
- Friend list state still lives partly in page state and partly in React Query cache.
- `friend_log` is useful but too narrow for VRCX-level analysis: no dedicated presence event table, no profile snapshot table, no mutual edge table, no relationship snapshot, no searchable unified feed.
- Official VRChat favorites sync currently covers avatars/worlds; friend favorite groups need first-class handling and a clear remote-vs-local distinction.
- No VRCX-style full table with sortable relationship metrics.
- No mutual-friend graph fetch, cache, opt-out tracking or progress/cancel UI.
- No local statistics layer for friend join count, co-presence time, last seen by instance, previous display names or relationship age.
- Friend detail is a dialog, not a durable relationship workspace with timeline, shared worlds, mutual graph, notes, tags and action history.

## VRCX Capabilities To Match Or Beat

### 1. Friends Locations

Evidence: `src/views/FriendsLocations/FriendsLocations.vue:1-120`, `src/views/FriendsLocations/FriendsLocations.vue:260-560`.

What VRCX does well:

- Search is always available at the top of the view.
- Segments separate online, favorite, same-instance, active and offline.
- Settings control same-instance behavior, card scale and card spacing.
- Virtual rows avoid rendering every friend card at once.
- Favorite friends can come from remote VRChat favorite groups or local favorite groups.
- Same-instance groups are lifted into a first-class view, not buried in a row expansion.

VRCSM target:

- Replace the current single Friends page layout with a `Friends` workspace containing tabs: `Locations`, `Table`, `Timeline`, `Mutuals`, `Groups`, `Requests`.
- Locations should group by instance/world first, then status/favorite. Same-instance should be one click from the top toolbar.
- Keep list virtualization mandatory for large friend lists.

### 2. Full Friend Table

Evidence: `src/views/FriendList/columns.jsx:99-480`.

What VRCX exposes:

- Sortable columns for friend number, avatar, display name, rank, status, language, bio link, join count, time together, last seen, mutual friends, last activity, last login, date joined and unfriend.
- Mutual opt-out state has a visible icon, so missing mutual data is not confused with zero mutuals.

VRCSM target:

- Add a dense friend table with column visibility/order persistence.
- Start with columns already available from current data: avatar, display name, status, location, trust, platform, status text, avatar name, last login/activity, local favorite, note.
- Add computed columns after persistence lands: mutual count, co-presence count, co-presence time, last same instance, relationship age, display-name changes, avatar changes.

### 3. Mutual Graph

Evidence: `src/stores/charts.js:142-378`.

What VRCX does well:

- Single-friend mutual fetch and full graph fetch are separate paths.
- Full graph has rate limiting, backoff on 429, cancellation, progress, local persistence and opt-out/403/404 metadata.
- Cached mutual data survives reloads and is not blindly deleted when opt-out metadata is present.

VRCSM target:

- Do not auto-fetch mutual graph on startup. It is high-volume and privacy-sensitive.
- Implement manual `social.mutual.fetchOne` first, then an opt-in full graph job with progress/cancel.
- Persist `opted_out`, `last_error_code`, `fetched_at`, and `source` for every attempted friend so the UI can show "not fetched", "hidden", "failed", or "0 mutuals" accurately.

### 4. Relationship Log And Feed

Evidence: `src/coordinators/friendRelationshipCoordinator.js:105-170`, `src/coordinators/friendRelationshipCoordinator.js:192-281`, `src/coordinators/friendRelationshipCoordinator.js:362-410`, `src/services/database/feed.js:5-303`.

What VRCX does well:

- Friend add/delete, display name changes and trust changes are treated as relationship events.
- GPS/location, status, bio, avatar and online/offline are stored as feed tables.
- Feed search can filter event types and constrain to VIP/favorite users.

VRCSM target:

- Keep `friend_log`, but introduce normalized event tables or a unified typed event table so status/location/avatar/profile/relationship events can be queried without stringly typed overload.
- Every event should record: `user_id`, `display_name_at_time`, `event_type`, `old_value`, `new_value`, `occurred_at`, `source`, `source_event_id`, `confidence`.
- The UI should show source labels such as `Pipeline`, `Friends Poll`, `VRChat Log`, `Manual Note`, `Imported`.

### 5. Local Stats From Logs

Evidence: `src/services/database/gameLog.js:390-527`.

What VRCX does well:

- Computes last seen, join count, time spent together and previous display names from join/leave logs.
- These stats are local evidence and do not require extra API calls.

VRCSM target:

- Build friend statistics from existing `player_events`, `world_visits`, `player_encounters`, and `friend_log`.
- Avoid adding API traffic for data the local log database can answer.
- Surface stats in table columns and friend detail: "seen together", "total co-presence", "last same instance", "worlds shared", "name history".

## API Boundary And Sync Rules

Verified public docs support these categories:

- Friend list: `GET /auth/user/friends` through List Friends.
- Friend status: friend relationship state for a user through Check Friend Status.
- Mutual friends: `GET /users/{userId}/mutuals/friends` with paging. The page documents auth-cookie requirement and `n`/`offset`.
- Favorites/favorite groups: list favorites, list favorite groups, add favorite, remove favorite.
- Actions: send friend request, unfriend, request invite, invite user.
- Pipeline WebSocket: receive-only event stream, with friend online/offline/update/location event families.

Design rules:

- Treat Pipeline as incremental hints, not the only truth. Periodic reconcile still needs `friends.list`.
- Treat `friends.list` as the authoritative current snapshot, but not as history.
- Treat VRChat logs and VRCSM DB as local evidence. They should never overwrite remote truth, but they can enrich it.
- Mutual graph fetch must be opt-in, rate-limited and cancelable.
- Any API call that mutates VRChat state needs explicit user action and undo/confirmation where appropriate: unfriend, block, mute, invite, friend request, favorite changes.
- Private/orange/red/private-world locations must remain privacy-preserving. Do not invent hidden world names or infer private instance details.

## Proposed Module Architecture

Keep raw API wrappers and domain behavior separate.

Backend/core:

- `VrcApi`: raw VRChat REST/Pipeline wrappers only. Each function maps one endpoint family and returns `Result<T>`.
- `SocialRepository`: database read/write methods for snapshots, events, notes, groups, mutuals and statistics.
- `SocialSyncService`: sync orchestration for friends bootstrap, periodic reconcile, Pipeline event ingest, diffing and rate-limited enrichment.
- `SocialStatsService`: local-only stats from `player_events`, `world_visits`, `player_encounters`, and social events.
- `SocialBridge`: IPC view-model endpoints and jobs. Pages should not need to know table layout or raw endpoint shapes.

Frontend:

- `web/src/lib/vrchat-api.ts`: direct user/avatar/world/group/favorite/moderation/invite endpoint wrappers.
- `web/src/lib/social.ts`: friend list view models, relationship timeline, notes, local groups, mutual graph jobs, social stats.
- `web/src/lib/history-api.ts`: local history/player/world/avatar evidence.
- `web/src/lib/friends-pipeline.ts`: pure reducer for Pipeline event-to-snapshot patching.
- `web/src/lib/useFriendsPipelineSync.ts`: thin hook that forwards events into React Query and calls `social.ts` logging helpers.

Do not put new reusable raw `ipc.call(...)` calls inside pages. Pages should consume `social.ts`, `vrchat-api.ts`, `history-api.ts`, `library.ts`, and `shell-api.ts`.

## Data Model Draft

Recommended new/expanded tables:

- `friend_snapshots`
  - `user_id`, `display_name`, `status`, `status_description`, `location`, `world_id`, `instance_id`, `platform`, `avatar_id`, `avatar_name`, `profile_pic_url`, `user_icon_url`, `tags_json`, `raw_json`, `first_seen_at`, `last_seen_at`, `source`.
- `friend_presence_events`
  - `id`, `user_id`, `event_type`, `location`, `world_id`, `instance_id`, `previous_location`, `status`, `platform`, `occurred_at`, `source`, `source_event_id`.
- `friend_profile_events`
  - `id`, `user_id`, `field`, `old_value`, `new_value`, `occurred_at`, `source`.
- `friend_relationship_events`
  - `id`, `user_id`, `event_type`, `display_name`, `occurred_at`, `source`.
- `friend_mutual_edges`
  - `friend_user_id`, `mutual_user_id`, `fetched_at`, `source`, primary key on `(friend_user_id, mutual_user_id)`.
- `friend_mutual_meta`
  - `friend_user_id`, `fetched_at`, `opted_out`, `last_error_code`, `last_error_message`, `mutual_count`.
- `friend_groups_local`
  - local relationship groups independent from VRChat official favorite groups. Can be backed by existing `local_favorites` initially.
- `friend_search_fts`
  - optional FTS5 index for display name, previous names, notes, status text, bio, world names and tags.

Migration approach:

- Keep existing `friend_log` and `friend_notes` for compatibility.
- Add new tables under a new schema version.
- Backfill snapshots from current `friends.list` when the user next logs in.
- Backfill stats from existing `player_events` and `world_visits` without network calls.
- Do not destroy existing friend notes or local favorites.

## UI Redesign Target

The new Friends area should be a power-user workspace, not a tall list.

Primary layout:

- Left: saved filters / relationship groups / favorite groups.
- Center: current tab (`Locations`, `Table`, `Timeline`, `Mutuals`, `Requests`).
- Right: selected friend inspector with profile, actions, notes, recent timeline and shared stats.

Tabs:

- `Locations`
  - Instance/world grouped online view, same-instance mode, joinable filter, favorite group filter, status filter.
- `Table`
  - Dense sortable table with persistent columns and virtual rows.
- `Timeline`
  - Unified feed of online/offline, location, status, avatar, name, friend/unfriend, notes and local co-presence.
- `Mutuals`
  - Manual fetch per friend, opt-in full graph, progress/cancel, opt-out badges, local cached graph.
- `Requests`
  - Friend requests, invites, request-invite responses and notification actions.

Friend inspector:

- Header: avatar/profile picture, display name, status, trust, platform, current world/instance.
- Actions: join/self-invite, request invite, invite to current location, send friend request, unfriend, mute, block, open VRChat profile, copy IDs.
- Relationship: local note, local groups, remote favorite group membership when available, mutual friends, shared worlds, co-presence stats.
- Timeline: recent events with source labels.
- Safety: destructive actions require confirmation; private location details stay private.

## How VRCSM Can Beat VRCX

VRCX is mature, but VRCSM can be better in these areas:

- Source-aware history: every row can show whether it came from Pipeline, REST poll, log parse, local note or import.
- Cleaner API boundaries: raw API wrappers, sync services, DB repositories and UI view models are separate. This makes features easier to test.
- Local-first analytics: co-presence, last seen, shared worlds and avatar sightings come from local logs before making network calls.
- Better privacy posture: mutual graph and remote enrichment are opt-in, cancelable and rate-limited by design.
- Better degraded states: "not fetched", "hidden/private", "API failed", "rate limited", "no mutuals" and "offline" should be visually distinct.
- Better quick actions: command palette and context menus can expose the same friend actions from any page.
- Better diagnostics: sync status, last reconcile time, last Pipeline event and API budget can be visible in a small status bar.

## Implementation Roadmap

### Phase 0 - Baseline Lock

Do not start broad social rewrites until the current pending patch remains buildable:

- Keep `UpdatePackage.{h,cpp}` included.
- Preserve the migration/update/database fixes listed in `docs/NEXT-AGENT-HANDOFF.md`.
- Keep new frontend API calls in `web/src/lib`.
- Keep `.codegraph/`, `build/`, artifacts and generated output out of Git.

### Phase 1 - Social API And Data Foundation

Goal: add the relationship data backbone without changing the whole UI.

Tasks:

- Add core `SocialRepository` methods or equivalent `Database` methods for snapshots, presence events, mutual meta/edges and aggregate stats.
- Add `SocialBridge` IPC endpoints:
  - `social.friends.snapshot`
  - `social.timeline`
  - `social.statsForUser`
  - `social.groups.local.*`
  - `social.mutual.fetchOne`
  - `social.mutual.fetchJobStart/Cancel/Status`
- Extend `web/src/lib/social.ts` with typed wrappers.
- Keep `Friends.tsx` behavior stable while new endpoints are introduced.

Verification:

- C++ tests for new DB tables and dedupe/upsert behavior.
- TypeScript strict build.
- Existing page smoke tests.

### Phase 2 - Friends Table And Inspector

Goal: visible VRCX parity without high-volume API jobs.

Tasks:

- Add virtualized table view.
- Add persistent column state and sort state.
- Add friend inspector route/panel that uses current `FriendDetailDialog` pieces but is not trapped inside a modal.
- Show local notes, favorite state, timeline, shared stats and action buttons.
- Use existing local DB/log data first.

Verification:

- Table renders 0, 10, 500 and 2000 mock friends.
- Long display names and status descriptions do not overlap.
- Page smoke covers signed-out, loading, empty, populated and API-error states.

### Phase 3 - Locations View

Goal: make online/joinable/same-instance behavior better than the current list.

Tasks:

- Add instance/world grouped view with virtual rows.
- Add filters for status, platform, favorite/local group, same instance, joinable/private/offline.
- Add clear labels for private, offline, traveling and request-invite-only states.
- Reuse current `parseLocation`, `instanceTypeLabel`, `regionLabel`, `openVrchatLocation`, `inviteSelf` and `requestInvite` helpers.

Verification:

- Mock friend locations cover public, friends+, invite+, private, offline and traveling.
- No accidental `vrchat://launch` for private/offline rows.

### Phase 4 - Mutual Graph

Goal: relationship graph with explicit API budget and privacy handling.

Tasks:

- Implement single-friend mutual fetch first.
- Add cached mutual count to table and inspector.
- Add full graph opt-in job with progress/cancel and backoff.
- Track `opted_out` and errors separately from zero mutuals.

Verification:

- Unit test 200/401/403/404/429 handling.
- Cancel test confirms partial results do not corrupt old cache.
- UI shows separate states for not fetched, opted out, failed, zero and populated.

### Phase 5 - Unified Timeline And Search

Goal: relationship memory that beats a snapshot list.

Tasks:

- Merge `friend_log`, presence events, local player events, avatar sightings and notes into a single timeline view model.
- Add search filters by name, note, previous name, world, avatar, status text and event type.
- Add quick filter presets: favorites, same-instance history, recently active, old friends, high mutual overlap, frequently together.

Verification:

- DB query tests with mixed event types.
- UI smoke with large timeline.

## Guardrails

- Do not implement private avatar copying, client bypasses, injection, or hidden/private-location inference.
- Do not auto-fetch mutual graph for every friend on startup.
- Do not mutate VRChat state without explicit user action.
- Do not bury API calls inside UI components.
- Do not let Pipeline-only state overwrite a newer explicit poll without timestamp/source checks.
- Do not delete existing notes, favorites or friend log rows during migration.

## First Code Slice Recommendation

Start with the smallest slice that improves architecture and unlocks UI work:

1. Add `social.ts` wrapper methods for current `friendLog`, `friendNote`, `friends.list`, `requestInvite`, `inviteUser`, `removeFriend`, `sendFriendRequest`, `muteUser`, `blockUser` paths where still scattered.
2. Add DB tables for `friend_snapshots` and `friend_presence_events`.
3. On `friends.list` success, upsert current snapshot rows.
4. On Pipeline friend events, insert presence/profile events through a central helper instead of page-local logic.
5. Add tests for DB upsert/event insert and TypeScript wrappers.
6. Only then start the `Locations` and `Table` UI tabs.

This keeps the system modular and prevents a new "social mega page" from turning into a maintenance problem.
