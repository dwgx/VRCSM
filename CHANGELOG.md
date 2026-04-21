# Changelog

All notable changes to VRCSM (VRChat Cache & Settings Manager).

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
but entries are written in the voice of the person who actually landed
them rather than as a terse bullet list. Dates are UTC.

## [Unreleased] — v0.10 dev

Second batch of v0.10 work lands a long-missing gap against VRCX: real-time
event push via the VRChat Pipeline WebSocket, a notifications inbox, Discord
Rich Presence, OSC send/receive, and screenshot metadata injection. The
`AuthContext` now drives the pipeline lifecycle automatically so every
signed-in user gets instant friend-presence + invite / friend-request
delivery without any extra setup.

### Added — real-time event stream (Pipeline)

- **`src/core/Pipeline.{h,cpp}`** — VRChat Pipeline WebSocket client over
  WinHTTP's native WebSocket upgrade path (no third-party dep). On each
  connect the worker calls `GET /api/1/auth` to harvest a short-lived
  WebSocket token — VRChat rejects the raw session cookie here, which was
  the footgun VRCX's own code path warns about. The inner `content` field
  is double-stringified by the server and gets unwrapped before reaching
  callbacks. Reconnect is a flat 5 s (matching VRCX), with a longer 60 s
  backoff on 401/403 so a stale cookie doesn't thrash the server.
- **`src/host/bridges/PipelineBridge.cpp`** — new bridge file hosting
  Pipeline, Discord RPC, OSC, notifications, screenshot metadata, and
  targeted-invite handlers. Events flow out as `pipeline.event` with
  `{type, content}` and `pipeline.state` with `{state, detail}`.
- **`web/src/lib/pipeline-events.ts`** — typed subscribe helper +
  `usePipelineEvent` React hook. All documented VRChat event types
  enumerated so the compiler catches typos.
- **`web/src/lib/auth-context.tsx`** — pipeline lifecycle is now tied to
  auth: start on sign-in, stop on sign-out. `pipelineState` is surfaced on
  the context for UI indicators.

### Added — notifications inbox

- **6 new `VrcApi` methods** — `fetchNotifications`, `acceptFriendRequest`,
  `respondNotification` (for invite replies via
  `POST /api/1/invite/{id}/response`), `hideNotification`,
  `clearNotifications`, `sendUserMessage`. All wired through the auth
  cookie + rate-limiter path.
- **`web/src/components/NotificationsInbox.tsx`** — bell icon in the
  Toolbar with unread count badge + dropdown panel. Bootstraps via
  `notifications.list` on sign-in, then subscribes to Pipeline
  `notification` / `notification-v2` / `see-notification` /
  `notification-v2-delete` / `clear-notification` for live updates.
  Per-row actions: Accept (friend request), Reply (invite), Hide.
- **`user.inviteTo`** — targeted invite (as opposed to the existing
  `user.invite` which is self-invite). Posts to `/api/1/invite/{userId}`.
- **`message.send`** — POST to `/api/1/message/{userId}/message` for DM
  send, body clipped at 2000 chars.

### Added — Discord Rich Presence

- **`src/core/DiscordRpc.{h,cpp}`** — Windows Named Pipe client for
  Discord's local RPC gateway (`\\.\pipe\discord-ipc-0..9`, tried in
  order). Handshake with `{v:1, client_id:"..."}`, then fires
  `SET_ACTIVITY` frames carrying the caller-supplied activity JSON.
  Reconnects on Discord restart automatically, back-off 30 s on
  handshake rejection. IPC methods: `discord.setActivity`,
  `discord.clearActivity`, `discord.status`.

### Added — OSC bridge

- **`src/core/OscBridge.{h,cpp}`** — UDP OSC 1.0 client + server for
  VRChat's parameter port (`127.0.0.1:9000` out, `:9001` in). Supports
  `i` / `f` / `s` / `b` / `T` / `F` type tags (the set VRChat actually
  uses). Send is fire-and-forget sync; listen spawns a dedicated
  `recvfrom` thread and fans messages out through
  `PostEventToUi("osc.message", ...)`. IPC: `osc.send`,
  `osc.listen.start`, `osc.listen.stop`.

### Added — screenshot metadata (VRCX-style)

- **`src/core/PngMetadata.{h,cpp}`** — PNG `tEXt` chunk injector. Writes
  metadata as standard PNG text chunks inserted right after IHDR, with
  CRC32 computed inline (no zlib dep). Atomic rename-over on write so a
  partial write never corrupts the user's capture. Companion
  `ReadPngTextChunks` for reading back existing metadata.
- **`src/core/ScreenshotWatcher.{h,cpp}`** — `ReadDirectoryChangesW`
  recursive watcher over `%USERPROFILE%\Pictures\VRChat\`. Debounces
  the multi-event bursts Windows emits per file save, waits 250 ms for
  the file to fully flush, then fires a callback per new `.png`.
- **IPC:** `screenshots.watcher.start`, `screenshots.watcher.stop`,
  `screenshots.injectMetadata`, `screenshots.readMetadata`. Watcher
  emits `screenshots.new` events so the UI can refresh without
  polling.

### Added — IPC frontend methods

- **14 new `ipc.*` methods** in `web/src/lib/ipc.ts` — pipelineStart/Stop,
  notificationsList/Accept/Respond/Hide/Clear, sendMessage, inviteUser,
  discordSetActivity/ClearActivity/Status, oscSend/ListenStart/ListenStop,
  screenshotsWatcherStart/Stop, screenshotsInjectMetadata/ReadMetadata.

### Added — architecture overhaul (first batch, still unreleased)

- **Workspace tab layout.** `VrchatWorkspace.tsx` reduced from 2210 →
  ~140 lines (thin tab shell). Six lazy-loaded tabs — Overview, Friends,
  Avatars, Worlds, Social, VRC+ — each in its own
  `web/src/pages/workspace/Tab*.tsx` module. Active tab persisted to
  `localStorage` so the page remembers where you left off.
- **`FriendDetailDialog`** (`web/src/components/FriendDetailDialog.tsx`)
  — full-screen Dialog replacing the old 300px right panel. Six sections:
  Profile header with avatar + status dot + trust-rank color, Current
  World with Launch + Invite Self buttons, Avatar section with
  SmartWearButton, Actions row (Mute / Block with inline confirmation
  bar), Recent Activity timeline, Avatar History from logs, and Friend
  Note editor. Bio links auto-detect 12+ platforms (Twitter/X, Bilibili,
  YouTube, Discord, GitHub, Twitch, etc.) and render real SVG icons.
  Block confirmation uses an inline bar rather than a nested AlertDialog
  (which breaks inside Dialog).
- **`SmartWearButton`** (`web/src/components/SmartWearButton.tsx`) —
  replaces ALL Wear buttons app-wide (Friends, Radar, Avatars, Dialog).
  Multi-step flow: direct `selectAvatar` → on 403 → fetch
  `avatar.details` → retry if public → search alternatives by
  name + author → show alternatives dialog. Avatar History lists every
  avatar a friend has worn (parsed from logs), each individually
  wearable. Wear action includes a "Save to Library" toast shortcut.
  Three visual variants: `pill`, `button`, `compact`.
- **Social action IPC handlers** — five new C++ endpoints:
  - `VrcApi::inviteSelf()` — `POST /api/1/invite/myself`
  - `VrcApi::addPlayerModeration(type, userId)` —
    `POST /api/1/auth/user/playermoderations`
  - `VrcApi::removePlayerModeration(id)` —
    `DELETE /api/1/auth/user/playermoderations/{id}`
  - IPC: `user.invite`, `user.mute`, `user.unmute`, `user.block`,
    `user.unblock` — all registered in `AsyncMethodSet`.
- **`alert-dialog.tsx`** (`web/src/components/ui/alert-dialog.tsx`) —
  shadcn-style AlertDialog component built on top of Dialog primitive.
- **CI pipeline** (`.github/workflows/ci.yml`) — GitHub Actions workflow
  for automated builds.
- **i18n** — new keys in `en.json` and `zh-CN.json` for workspace tabs,
  friend dialog sections, smart wear flow, and the new notifications
  inbox.

### Changed

- **Radar module split.** `Radar.tsx` (1700+ lines) refactored into
  `radar/RadarEngine.tsx`, `radar/RadarHistoryAnalysis.tsx`,
  `radar/RadarPlayerWidgets.tsx` with shared types and utilities
  extracted to `radar/radar-types.ts` and `radar/radar-utils.ts`.
- **IPC mock data extraction.** All mock data previously inline in
  `ipc.ts` moved to `web/src/lib/__mocks__/ipc-mock-data.ts` with
  companion test file. `ipc.ts` shrunk from ~900 to ~440 lines.
- **PCH optimization** — `src/pch.h` updated for faster incremental
  builds.
- **`ApiBridge::FilterFriend`** now includes `currentAvatarId` and
  `currentAvatarName` in the friend envelope so the frontend can render
  Wear buttons without an extra API round-trip.

### Fixed

- **Avatar not showing in dialog** — empty string `""` bypassed the
  `??` (nullish coalescing) operator since `""` is not nullish. Changed
  to `||` so falsy empty strings fall through to the placeholder.
- **Status dot rendering** in `FriendDetailDialog` — dot color now
  correctly maps to VRChat status values.
- **Social media icon detection** — bio link parser handles edge cases
  for platform URL patterns.
- **Block confirmation** — replaced nested `AlertDialog` (which broke
  inside `Dialog` due to portal stacking) with an inline confirmation
  bar.
(2200+ lines) was gutted into a thin tab shell with six lazy-loaded tabs,
the Friends list got a proper full-screen dialog, and avatar cloning now
goes beyond what VRCX offers — including automatic alternatives search,
avatar history, and save-to-library. On the backend, five new social-action
IPC handlers land (invite, mute/unmute, block/unblock).

### Added

- **Workspace tab layout.** `VrchatWorkspace.tsx` reduced from 2210 →
  ~140 lines (thin tab shell). Six lazy-loaded tabs — Overview, Friends,
  Avatars, Worlds, Social, VRC+ — each in its own
  `web/src/pages/workspace/Tab*.tsx` module. Active tab persisted to
  `localStorage` so the page remembers where you left off.
- **`FriendDetailDialog`** (`web/src/components/FriendDetailDialog.tsx`)
  — full-screen Dialog replacing the old 300px right panel. Six sections:
  Profile header with avatar + status dot + trust-rank color, Current
  World with Launch + Invite Self buttons, Avatar section with
  SmartWearButton, Actions row (Mute / Block with inline confirmation
  bar), Recent Activity timeline, Avatar History from logs, and Friend
  Note editor. Bio links auto-detect 12+ platforms (Twitter/X, Bilibili,
  YouTube, Discord, GitHub, Twitch, etc.) and render real SVG icons.
  Block confirmation uses an inline bar rather than a nested AlertDialog
  (which breaks inside Dialog).
- **`SmartWearButton`** (`web/src/components/SmartWearButton.tsx`) —
  replaces ALL Wear buttons app-wide (Friends, Radar, Avatars, Dialog).
  Multi-step flow: direct `selectAvatar` → on 403 → fetch
  `avatar.details` → retry if public → search alternatives by
  name + author → show alternatives dialog. Avatar History lists every
  avatar a friend has worn (parsed from logs), each individually
  wearable. Wear action includes a "Save to Library" toast shortcut.
  Three visual variants: `pill`, `button`, `compact`.
- **Social action IPC handlers** — five new C++ endpoints:
  - `VrcApi::inviteSelf()` — `POST /api/1/invite/myself`
  - `VrcApi::addPlayerModeration(type, userId)` —
    `POST /api/1/auth/user/playermoderations`
  - `VrcApi::removePlayerModeration(id)` —
    `DELETE /api/1/auth/user/playermoderations/{id}`
  - IPC: `user.invite`, `user.mute`, `user.unmute`, `user.block`,
    `user.unblock` — all registered in `AsyncMethodSet`.
- **`alert-dialog.tsx`** (`web/src/components/ui/alert-dialog.tsx`) —
  shadcn-style AlertDialog component built on top of Dialog primitive.
- **CI pipeline** (`.github/workflows/ci.yml`) — GitHub Actions workflow
  for automated builds.
- **i18n** — new keys in `en.json` and `zh-CN.json` for all workspace
  tabs, friend dialog sections, and smart wear flow strings.

### Changed

- **Radar module split.** `Radar.tsx` (1700+ lines) refactored into
  `radar/RadarEngine.tsx`, `radar/RadarHistoryAnalysis.tsx`,
  `radar/RadarPlayerWidgets.tsx` with shared types and utilities
  extracted to `radar/radar-types.ts` and `radar/radar-utils.ts`.
- **IPC mock data extraction.** All mock data previously inline in
  `ipc.ts` moved to `web/src/lib/__mocks__/ipc-mock-data.ts` with
  companion test file. `ipc.ts` shrunk from ~900 to ~440 lines.
- **PCH optimization** — `src/pch.h` updated for faster incremental
  builds.
- **`ApiBridge::FilterFriend`** now includes `currentAvatarId` and
  `currentAvatarName` in the friend envelope so the frontend can render
  Wear buttons without an extra API round-trip.

### Fixed

- **Avatar not showing in dialog** — empty string `""` bypassed the
  `??` (nullish coalescing) operator since `""` is not nullish. Changed
  to `||` so falsy empty strings fall through to the placeholder.
- **Status dot rendering** in `FriendDetailDialog` — dot color now
  correctly maps to VRChat status values.
- **Social media icon detection** — bio link parser handles edge cases
  for platform URL patterns.
- **Block confirmation** — replaced nested `AlertDialog` (which broke
  inside `Dialog` due to portal stacking) with an inline confirmation
  bar.

## [0.9.2] — 2026-04-19

Fixes the v0.9.0 plugin-iframe IPC regression where responses from
host handlers never reached plugin panels — the panel call would
queue forever (the AutoUploader's "Loading…" hang on the folder
picker was the visible symptom). Adds a real scan + rename UI to the
AutoUploader so per-folder name overrides survive across sessions
and feed straight through to Unity.

### Fixed

- **Plugin iframe IPC routing** (`src/host/WebViewHost.cpp`) — wired
  `ICoreWebView2_4::add_FrameCreated` so the host now tracks every
  plugin iframe by id and routes responses through
  `ICoreWebView2Frame2::PostWebMessageAsString`. The top-level
  `ICoreWebView2::PostWebMessageAsString` only reaches the main SPA
  frame, so before this fix any reply targeted at a plugin frame
  vanished silently and the panel hung waiting for a result.

### Added

- **`fs.writePlan` IPC** (`src/host/bridges/ShellBridge.cpp`) — narrow
  write surface that emits exactly one file (`.vrcsm-upload-plan.json`)
  inside an existing directory. JSON-validated, capped at 1MB. Granted
  to plugins via `ipc:shell` so the AutoUploader panel can persist its
  rename map without opening a general fs.write surface.
- **AutoUploader scan + rename UI** (`plugins/vrc-auto-uploader/`) —
  `Scan` now lists the picked root's avatar subfolders inline with
  per-row "Upload as…" inputs, a per-row reset button, and a bulk
  "skip" checkbox. Edits persist in `localStorage` keyed by the root
  path; same-name folders auto-suffix (`name`, `name_2`, `name_3`, …)
  but a user-typed name always wins. On `Start upload batch` the panel
  writes `.vrcsm-upload-plan.json` next to the chosen root via
  `fs.writePlan`, then prints the runner command with the matching
  `--plan` argument.
- **Plan-aware Python runner**
  (`plugins/vrc-auto-uploader/bin/python/extractor.py`, `main.py`) —
  `scan_model_directory` accepts an optional `plan` dict and applies
  its `renameMap`/`skip` list before dispatching to Unity. `--plan`
  was added to `batch`, `extract`, and `fix-thumbnails`; if omitted
  the runner auto-loads `.vrcsm-upload-plan.json` from the picked
  root so users running the CLI by hand also benefit.

### Bumped

- AutoUploader plugin manifest → `0.9.2` (`hostMin: 0.9.2`).
- Top-level `VERSION` → `0.9.2`.

## [0.9.1] — 2026-04-19

Follow-up polish on v0.9.0 — the Win32 folder picker used by the
AutoUploader plugin (and the main SPA's `pickFolder` helper) was
frequently obscured behind the WebView2 frame. Replaced with a fully
in-app folder browser so the dialog is guaranteed to render on top of
the application.

### Added

- **`fs.listDir` IPC** (`src/host/bridges/ShellBridge.cpp`) — read-only
  directory listing, 2000-entry cap, skips hidden/system by default,
  returns drive roots with volume labels when given an empty path.
  Runs on the thread pool (registered in `AsyncMethodSet`) so large
  mounts don't freeze the UI. Granted to plugins via the existing
  `ipc:shell` permission token.
- **`<FolderPickerHost />` React component** (`web/src/components/FolderPicker.tsx`)
  — shadcn dialog with breadcrumb nav, root-drive fallback, and a
  "Choose this folder" confirmation. Mounts at the app shell and
  registers itself with `ipc.pickFolder`, so every existing call site
  (`VrchatWorkspace`, `Migrate`, future consumers) now opens the
  in-app dialog instead of `IFileOpenDialog`.
- **AutoUploader in-panel folder picker**
  (`plugins/vrc-auto-uploader/index.html` + `style.css` + `main.js`)
  — dedicated modal inside the iframe that consumes `fs.listDir`
  directly via `plugin.rpc`. Keyboard `Esc` to dismiss, backdrop
  click to cancel.

### Changed

- `ipc.pickFolder()` on the frontend prefers the in-app handler when
  it's mounted and only falls back to `shell.pickFolder` for
  headless/test contexts. The host IPC is kept in place for
  backward-compatible plugin authors.
- AutoUploader plugin `hostMin` bumped to `0.9.1` since the in-panel
  picker requires the new `fs.listDir` handler.

## [0.9.0] — 2026-04-19

Phase B of the plugin-system rollout — the **VRChat Auto-Uploader** is now
a first-class VRCSM plugin, with all four of the known 25%-failure-rate
bugs fixed at the source. Ships alongside a thick batch of bug fixes the
user hit in v0.8.1 while driving the app through a real workflow.

### Added

- **`dev.vrcsm.autouploader` plugin** (`plugins/vrc-auto-uploader/`) —
  ported from the standalone [VRC-Auto-Uploader](https://github.com/dwgx/VRC-Auto-Uploader)
  as a `shape: "panel"` plugin. Bundles the Python runner, the Unity
  `AutoUploader.cs` / `PopupSuppressor.cs` editor scripts, and a thin
  VRCSM panel UI (HTML + CSS + vanilla JS, no framework) for folder
  selection + status tracking. Registered in the gh-pages feed as
  version `0.9.0` with SHA-256
  `b5cc2d8cad51571af4163dc5600f6ed5f9d2d3690eb61ac39715ec49935e6db3`.
  The panel uses `plugin.rpc → shell.pickFolder / shell.openUrl`
  through a new **`ipc:shell`** permission token (see below) rather
  than shelling out directly.
- **Four fixes against the historical 25% failure rate** (15/60 of the
  user's own upload attempts failed with "Could not find
  VRCAvatarDescriptor" in `upload_results_backup.json`):
  1. `AutoUploader.cs` now waits on `AssetDatabase.importPackageCompleted` /
     `importPackageFailed` / `importPackageCancelled` with a 120 s
     timeout instead of a flat `Task.Delay(3000)` — big packages no
     longer finish past the deadline and let `FindAvatarInScenes` run
     before MonoScript resolution completes.
  2. Static fields (`_currentTaskIndex`, `_isRunning`, `_sdkReady`)
     are now backed by `SessionState.GetInt` / `SetBool`, so a domain
     reload mid-batch (caused by a shader import or SDK update) no
     longer restarts from task 0.
  3. `sanitizer.py` extends `BAD_EXTENSIONS` with `.shader`, `.cginc`,
     `.hlsl`, `.compute`, and `.raytrace` — these used to trigger the
     compile-and-reload that caused fix #2 to fire in the first place.
  4. `FindAvatarInScenes` gets one retry after a forced synchronous
     `AssetDatabase.Refresh` when the first scan misses, and
     `PopupSuppressor.cs` wraps `Clickable.Invoke` in a per-popup
     try/catch so one mis-shaped dialog doesn't disable suppression
     for the rest of the session.
- **`ipc:shell` permission token** (`src/core/plugins/PluginRegistry.cpp`)
  — grants `shell.pickFolder` + `shell.openUrl` to plugins that declare
  it. First consumer is the AutoUploader panel.
- **All VRChat language tags with Chinese + regional dialects.**
  Profile language picker went from 30 hand-picked entries to 80+
  covering Cantonese (粵語 `language_yue`), Wu (吴语 `language_wuu`),
  Min Nan (闽南/潮汕/台语 `language_nan`), Hakka (`language_hak`),
  Tibetan, Uighur, Mongolian, every major European/African/SE Asian
  language VRChat's API actually accepts, sign languages including
  JSL / CSL, and Esperanto / Latin. The 3-tag cap (`{count}/3`) is
  gone — VRChat's server still limits, but the UI no longer blocks
  you from trying more.

### Fixed

- **SteamVR Settings tab crashed with React error #310.** The cleanup
  `useEffect` I added in v0.8.1 sat below the `if (!config) return null`
  early-return; on the first render (`config == null`) the hook wasn't
  registered, on the second (`config` loaded) it was — violating Rules
  of Hooks. Moved the cleanup unconditionally above the early-return.
- **Runtime detection showed "VR / None" for desktop users.** VRChat
  writes the literal string `XR Device: None` into its log when no XR
  device is active, and the detector took that as a truthy VR hint.
  Both `detectRuntimeSummary` (VrchatWorkspace sidebar) and the
  `runtimeSummary` memo in TabGeneral now treat the lowercase string
  `"none"` as absent and fall through to the desktop branch with
  `deviceModel` / `platform` instead.
- **Radar's "Most-encountered players" listed the signed-in user.**
  The aggregation over `sessions.players` now filters out rows where
  `userId === authStatus.userId` (or `displayName` matches, for old
  log entries that didn't carry a userId).
- **Friends list took 1-3 s to paint anything.** The page now seeds
  state from a `localStorage` cache on mount so the list renders
  instantly, then kicks off the IPC refresh in the background and
  overwrites + writes the cache back. On the C++ side,
  `VrcApi::fetchFriends` went from a single-page 100-row fetch to
  the same paginated helper `fetchGroups` / `fetchPlayerModerations`
  use, so users with 200+ friends finally see all of them.
- **VrchatWorkspace sticky Quick-filters bar scrolled with the
  page.** The codex-generated `sticky top-[68px]` was sticking to
  the inner scroll container at the wrong offset; rather than
  fight the layout, the bar is now a normal non-sticky row at the
  top of the main column. Backdrop-blur removed.
- **Quick-filter labels rendered in English on non-English locales.**
  The strings went through `t()` but the zh-CN / ja / ko / ru / th /
  hi locale files didn't have the keys — added `vrchatWorkspace.
  quickFilters / onlyOnlineFriends / onlyMyGroups / hideModerations`
  to all six. English falls back to `defaultValue` so en.json is
  unchanged.

### Changed

- `VERSION` → `0.9.0`, `web/package.json` → `0.9.0`, MSI filename
  becomes `VRCSM-0.9.0-x64.msi`.
- Plugin feed at `https://dwgx.github.io/VRCSM/plugins.json` now has
  two entries (AutoUploader + Hello) and uses a real `generated`
  timestamp.

## [0.8.1] — 2026-04-19

Quality-of-life release focused on the bits of the desktop app users
touch every day — in-app updates that don't need a browser trip, the
Profile page catching up with everything the VRChat website lets you
edit, Settings surfaces that remember "yes, I actually want this
saved", and a Quest-specific troubleshooting seam. All on top of the
v0.8.0 plugin-system foundation.

### Added

- **In-app hot-update flow (`src/core/updater/` + `UpdateBridge.cpp` +
  `components/UpdateDialog.tsx`).** VRCSM now talks to the GitHub
  Releases API directly, pulls the signed MSI over WinHTTP with resume
  support, verifies SHA-256 via BCrypt, and hands off to
  `msiexec /i /passive /norestart` before closing itself. Users can
  **Skip this version**, **Remind later**, or **Install now** — skipped
  versions persist in `%LocalAppData%\VRCSM\updater-state.json` and
  stop re-nagging. The 5-minute host cache + per-check state means
  "Help → Check for updates" never hits GitHub twice in a burst.
- **Profile editor now covers everything vrchat.com does.** Bio stays,
  and alongside it: **bioLinks** (up to 4 URLs with add/remove/reorder),
  **pronouns** (pick-list with custom fall-back), **spoken languages**
  (up to 3 tags drawn from the same VRChat-recognised set as the
  website — 30 entries from English through 中文 / 日本語 / हिन्दी),
  plus a **stats strip** under the card that surfaces join date, trust
  level, age-verification status, and language summary. The bridge
  (`ApiBridge::HandleUserUpdateProfile`) deep-merges all new fields
  into VRChat's `PUT /users/{id}` while preserving the server-side
  fields we don't own (tags are merged with language_* replaced, the
  rest preserved).
- **Groups page (`/groups`).** Dedicated view of every VRChat group
  you belong to, sorted by representative first, then by online
  activity. Each card shows icon, banner, verified badge, member
  counts, role summary, and jumps out to vrchat.com or the workspace
  online-instance filter. Complements the Friends / Avatars / Worlds
  triad and brings the navigation closer to the VRChat website's
  coverage.
- **Hardware detector + preset recommender (`src/core/hw/` +
  `HwBridge.cpp`).** WMI-based CPU/GPU/RAM probe, HMD lookup via
  SteamVR vrsettings and the Oculus registry, then a scored preset
  pick (`ultra` / `high` / `balanced` / `low`) that drops straight
  into the SteamVR writer used by the VR streaming tab. Optional
  online enrichment pulls community profiles from
  `https://dwgx.github.io/VRCSM/hw-profiles.json` when the user opts
  in.
- **`shadcn`-style Slider (`components/ui/slider.tsx`).** Tailwind-
  only, no Radix dependency, keyboard- and mouse-accessible. Replaces
  the two raw `<input type="range">` controls in VR Streaming
  Settings and becomes the primitive for any future slider.
- **Quest 3 troubleshooting section in VR Streaming Settings.** Card
  appears automatically when a Quest HMD is detected. Ships the
  **Quest 3 Optimized** preset (150 Mbps / 1.2× SS / 90 Hz), plus
  deep-links to Oculus Debug Tool, Windows GPU scheduling, and the
  VRCSM Quest-3 guide for the grid of "edge jitter / blur /
  black-screen" complaints that are almost always runtime-layer, not
  VRChat itself.

### Changed

- **VR Streaming settings no longer roll back on save.** The
  `SteamVrConfig.Write` path was racing SteamVR's own autosave — if
  the user edited something while the runtime was still winding down
  we'd write, SteamVR would write over us, and the UI would refetch
  our clobbered file and show the user "wait, why did my slider jump
  back?" The save button is now **only enabled when there are
  actually pending edits**, shows a small dot when the form is
  dirty, and refetches **after a 1 s grace window** preserving any
  edits the user made mid-save. Added an explicit "SteamVR must be
  restarted for changes to take effect" toast so nobody thinks we're
  secretly hot-reloading.
- **VrchatWorkspace layout.** The one-long-column-then-a-sidebar
  layout was causing users to scroll for a solid thousand pixels on
  1080p monitors. Grid now breaks into two columns at `lg` (1024 px)
  instead of `xl` (1280 px), gains a third compact stats column at
  `2xl`, and the side panel is `sticky top-[68px]` so it tracks the
  main column's scroll. Cards in the side column got a pass for
  density: smaller type, flat elevation, stat tiles with icon +
  label + value only.
- **Sidebar gets a Groups entry** between Friends and Radar.
  **Help → Check for updates** now opens the in-app `UpdateDialog`
  instead of bouncing the user out to GitHub.
- **Profile card surfaces pronouns inline** next to the display
  name, matching the way VRChat's website places them.

### Fixed

- **Cache-clear no longer strands the window at
  `ERR_FILE_NOT_FOUND`.** Factory-reset + page reload occasionally
  fired while the view was sitting on a `preview.local` or
  `plugin.*.vrcsm` URL that the reset had just invalidated —
  WebView2's default error page would latch and the user had to kill
  VRCSM to get back in. `WebViewHost` now installs a
  `NavigationCompleted` watcher that detects failed navigations,
  bounces to `https://app.vrcsm/index.html`, and falls back to a
  self-hosted "UI resources are missing" page if the `web/` folder
  itself is AWOL. `factoryReset` also uses `window.location.replace`
  with an absolute URL instead of `window.location.reload` to avoid
  inheriting a stale origin.

### Security

- The `NavigationCompleted` recovery path only navigates to the
  fixed `app.vrcsm` root — no user-controlled URL can leak into it,
  so an attacker who somehow coaxes the view into an error cannot
  redirect via this fallback.

## [0.8.0] — 2026-04-19

Plugin system — Phase A. VRCSM grows a proper extension surface. First
official plugin feed lives at `https://dwgx.github.io/VRCSM/plugins.json`
and ships with a reference **Hello Plugin** bundled in the MSI so users
can kick the tyres before installing anything third-party. The
VRC-Auto-Uploader port is Phase B (v0.9.0).

### Added

- **Plugin core library (`src/core/plugins/`).** `PluginManifest` with
  strict SemVer + shape (`panel` / `service` / `app`) + permission-token
  parsing. `PluginStore` owns the on-disk layout at
  `%LocalAppData%\VRCSM\plugins\<id>\` + `plugin-data\<id>\` +
  `plugin-state.json`, mirrors bundled plugins from `<exeDir>\plugins\`
  without touching Program Files, and refuses to uninstall bundled
  entries (disable instead). `PluginInstaller` accepts `.vrcsmplugin`
  zips via Windows `tar.exe`, verifies SHA-256 against the feed,
  re-walks the extracted tree with `weakly_canonical` to reject any
  symlink or zip-slip escape, and atomically swaps a staging dir into
  place. `PluginRegistry` is the runtime singleton that exposes enabled
  panel mappings and runs the IPC permission check. `PluginFeed` fetches
  and 5-min-caches the market JSON over WinHTTP.
- **IpcBridge origin gating — `DispatchFromOrigin(originUri, json)`.**
  WebView2 iframes share `window.chrome.webview`, so a plugin iframe
  could previously call every host handler. The bridge now classifies
  messages by `ICoreWebView2WebMessageReceivedEventArgs::get_Source()`:
  the main SPA (`app.vrcsm`) keeps full access, plugin origins
  (`plugin.<sanitised-id>.vrcsm`) are whitelisted to
  `plugin.rpc` / `plugin.self.info` / `plugin.self.i18n` plus the free
  methods (`app.version`, `path.probe`, `process.vrcRunning`), and
  anything else is rejected with `forbidden_origin`. Plugin RPC still
  runs through the manifest permission table.
- **Plugin bridge — 7 new IPC methods.** `plugin.list`,
  `plugin.install`, `plugin.uninstall`, `plugin.enable`,
  `plugin.disable`, `plugin.marketFeed`, `plugin.rpc`. Install/uninstall
  refresh the WebView2 virtual-host mappings live, so no app restart is
  needed after a plugin state change.
- **React pages + iframe host.** `/plugins` (market), `/plugins/:id`
  (detail), `/plugins/installed` (manage), `/p/:pluginId/*` (sandboxed
  iframe with postMessage → `plugin.rpc` relay). Panel iframes use
  `DENY_CORS` mapping so they can't fetch app.vrcsm assets. Plugin SDK
  (`plugins/hello/sdk-bundle.js`) exposes `window.vrcsm.call(method)`
  for plugin authors.
- **Sidebar + command palette + menu bar** pick up installed panel
  plugins dynamically — a newly-enabled plugin shows up as a nav entry
  without an app restart.
- **Hello Plugin (`plugins/hello/`).** Reference plugin shipped with
  the MSI and published to the gh-pages feed. Calls `scan` through the
  IPC bridge and prints cached-bundle counts. Useful both as an install-
  flow smoke test and as a template for third-party authors.
- **7-locale i18n** for every new string — en, zh-CN, ja, ko, ru, th, hi.
- **gtest coverage** for manifest parsing, SemVer ordering, and ID
  sanitisation (`tests/PluginManifestTests.cpp`).

### Changed

- **WiX MSI** adds a `BundledPlugins` component group under
  `%LocalAppData%\VRCSM\plugins\` so the installer ships the Hello
  Plugin alongside the web bundle. `cmake/sync-plugins.cmake` copies
  `plugins/` into the build output as a post-build step, parallel to
  the existing `sync-web-dist.cmake`.
- **`IpcBridge::Dispatch(json)`** is now a thin wrapper around
  `DispatchFromOrigin("https://app.vrcsm/", json)` — legacy callers and
  tests continue to work unchanged.

### Security

- Plugin iframes get `COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS`
  so plugin A cannot XHR plugin B or the main SPA.
- `PluginInstaller` double-checks every extracted entry with
  `weakly_canonical` against the staging root; symlinks and reparse
  points are hard-rejected even though `tar.exe` already filters them.
- SHA-256 verification is mandatory when the feed entry declares a
  digest; a mismatch aborts the install before any directory is
  touched.

## [0.3.0] — 2026-04-15

"Surpass VRCX" sprint. v0.2.0 got the first cut of auth working but the
UI was mostly plumbing placeholders — raw number/text editors on the
Settings page, a thumbnail-only Avatar inspector, a flat Friends list.
v0.3.0 replaces all three with feature-parity (or better) versions of
what VRCX does, plus a factory-reset escape hatch for when the app
state gets wedged and the user just wants a clean slate.

Also: rolls up the previously-unshipped v0.2.0 work — Option-A login
via VRChat's own web form (DPAPI-encrypted session cookies, no password
ever touches VRCSM), real-time VRChat process watcher (no more 5s
polling tick), and the full 597-key localized Settings page.

### Added

- **Factory reset button in Settings.**
  New destructive action in the VRCSM shell preferences card. Wipes
  everything under `%LocalAppData%\VRCSM\` except the `WebView2/`
  user-data folder (held open by the running process), clears the
  in-memory `AuthStore` and the WebView2 cookie jar, reports back the
  list of removed + skipped paths so the toast can tell the user what
  actually happened. Gated behind a `Dialog` confirmation with an
  `AlertTriangle` warning panel — no accidental clicks.
- **Semantic Settings editors — `web/src/lib/vrcSettingsSemantics.ts`.**
  Curated metadata table for the ~35 VRChat settings a user most often
  wants to flip without booting VRChat (audio volumes, FoV, FPS cap,
  MSAA level, mirror resolution, shadow quality, region, safety level,
  mouse sensitivity, player height, …). Each entry declares what kind
  of widget should render it: `slider-float` / `slider-int` /
  `dropdown-int` / `dropdown-string` with proper range + step + unit
  metadata. `EntryEditor` in Settings.tsx tries the semantic editor
  first, falls back to the raw-value editor when the key isn't in the
  table — so 100% of the 597 keys still work, the 35 common ones just
  get a much better UX.
- **Avatar inspector — best-effort `avatar.details` IPC.**
  New `VrcApi::fetchAvatarDetails(avatarId)` calls
  `GET /api/1/avatars/{id}` with the stored session cookie and returns
  the raw JSON. Missing fields (private avatar, 401, 404) resolve to
  `nullopt` → nullish `details` in the response envelope. Frontend
  `AvatarInspector` component in `Avatars.tsx` merges local
  cache-scan data with API data, shows whatever is present (name,
  author, tags, description, release status, unity packages,
  version, created / updated), and degrades gracefully to "sign in
  for details" when the user hasn't logged in.
- **Friends page — VRCX-parity features.**
  Rewrote the flat list into status-bucketed sections
  (Join Me / Active / Ask Me / Busy / Offline) with collapsible headers
  and per-bucket counts. Full `location` string parser at
  `web/src/lib/vrcFriends.ts` — extracts instance type
  (`public` / `friends+` / `friends` / `invite+` / `invite` / `group*`),
  region (US West / US East / US Central / Europe / Japan), owner id.
  Trust rank computed from `system_trust_*` tags (Visitor → Trusted
  User) with per-rank color tokens lifted from VRCX's `TrustColor.js`.
  Moderator badge when `admin_moderator` is present. Click-to-expand
  row shows user id, world id, instance id, trust, developer type,
  bio, and relative "last seen" timestamp, each with a copy-to-
  clipboard button. Bio is searchable alongside display name + status
  description.
- **FilterFriend expanded on the C++ side** — `bio`, `developerType`,
  `last_login`, `last_activity`, `profilePicOverride`, `userIcon`, and
  a curated tags subset (`system_trust_*` + `admin_*`) now flow through
  the `friends.list` envelope so the frontend has everything it needs
  to match VRCX without additional round-trips.
- **`docs/v0.5.0-3d-preview-research.md` — design doc for real 3D
  avatar preview.** Concrete build plan around AssetRipper CLI +
  fbx2gltf + three.js in the WebView2. Not implemented in v0.3.0 —
  marked as v0.5.0+ R&D with phase-by-phase ship plan, risk matrix,
  and fallback paths for encrypted 2023+ bundles.

### Fixed

- **`VrcApi.h` missing `};` on `class VrcApi`.** Class body silently
  absorbed the namespace-close brace, and every translation unit that
  `#include`d VrcApi.h through IpcBridge compiled as if it were
  inside `vrcsm::core` — MSVC reported a cascade of "symbol cannot be
  defined within namespace 'core'" errors starting at
  `HandleMigrateExecute`. Root cause was a missing class terminator,
  not any of the code the errors pointed at.
- **Login window auto-close after successful sign-in.** VRChat's web
  frontend uses SPA navigation (`history.pushState`) rather than a
  real redirect, so `NavigationCompleted` never fires on the post-
  login URL change. `AuthLoginWindow` now listens to `SourceChanged`
  as the primary signal and closes within ~1 s of the user landing on
  `/home`, falling back to a periodic cookie-jar sniff as a safety
  net.
- **Logout actually logs out now.** Prior implementation wiped
  `AuthStore` but left the WebView2 cookie jar populated, so the next
  API call re-authed with the same credentials. New
  `WebViewHost::ClearVrcCookies` enumerates every VRChat cookie in
  the jar via `ICoreWebView2CookieManager::GetCookies` and deletes
  them individually — the only approach MSVC + WebView2 actually
  honors.
- **Thumbnail memo now invalidates on auth flip.** The in-memory cache
  keyed avatar thumbnails forever; signing in mid-session left the
  procedural fallback cubes on every row until a full reload.
  `useThumbnails` now tracks an auth generation counter and clears
  the memo when it changes.
- **VRChat process watcher is real-time.** `ProcessGuard::StartWatcher`
  replaces the 5-second IPC poll with an event-driven watcher thread
  that pushes `process.vrcStatusChanged` on every transition (and
  once on start so the frontend doesn't need a bootstrap call).

## [0.2.0] — 2026-04-15

Auth sprint + Friends page. v0.1.x was read-only against VRChat data that
lived on disk; v0.2.0 is the first cut that talks to the VRChat Web API
*as the logged-in user* — which is what it took to unblock two things
that had been pain points since v0.1.0: avatar thumbnails (VRChat's
`/api/1/avatars/{id}` refuses anonymous callers with 401) and any kind
of social surface (Friends, presence, location).

No password-scraping, no reverse-engineering the VRChat login form.
VRCSM pops a secondary WebView2 window pointed at
`https://vrchat.com/home/login`, lets VRChat's own login page handle
username + password + 2FA + email codes, and then harvests the
`auth` / `twoFactorAuth` cookies via the WebView2 CookieManager once the
user actually lands on `/home`. The cookies go into a DPAPI-encrypted
blob at `%LocalAppData%\VRCSM\session.dat` so they survive restarts
without ever touching plaintext on disk. VRCSM never sees, stores, or
proxies the password.

### Added

- **`src/core/AuthStore.{h,cpp}` — DPAPI-encrypted session store.**
  Single-instance holder for the `auth` + `twoFactorAuth` cookies.
  `Save()` runs the pair through `CryptProtectData` with user-scope
  entropy and drops the ciphertext into `%LocalAppData%\VRCSM\session.dat`;
  `Load()` walks the file back through `CryptUnprotectData` and silently
  drops it if the blob fails to decrypt (different user, different
  machine, corrupted). `BuildCookieHeader()` formats the cookies as a
  WinHTTP `Cookie:` header. Thread-safe via one mutex — VrcApi + IpcBridge
  can touch it from any worker without extra synchronisation. Crypt32.lib
  added to `src/core/CMakeLists.txt`.
- **`src/host/AuthLoginWindow.{h,cpp}` — secondary WebView2 login modal.**
  Self-owning popup class (`delete this` on `WM_NCDESTROY`) that reuses
  the shell's existing `ICoreWebView2Environment` pointer — which means
  it inherits the main `%LocalAppData%\VRCSM\WebView2` user-data folder
  and cookie jar, so VRChat's own frontend cookies don't get
  double-stored. Renders a native HWND popup parented to the main window
  with `WS_EX_DLGMODALFRAME`, and blocks the owner via
  `EnableWindow(owner, FALSE)` (re-enabled from the destructor) instead
  of running a nested message loop — the main shell pump stays in
  charge of dispatch. Navigates to `vrchat.com/home/login`, subscribes
  to `NavigationCompleted`, and on every completion whose URL doesn't
  contain `/login`, `twofactor`, `email-verify`, or `password-reset`
  walks the entire `ICoreWebView2_2::CookieManager::GetCookies(nullptr,
  …)` list extracting `auth` + `twoFactorAuth`. The URL filter is what
  stops the harvest from firing mid-2FA. Once the `auth` cookie lands,
  it hands the pair to `AuthStore::SetCookies` + `Save` and posts
  `WM_CLOSE`. Cancellation path is just `WM_CLOSE` from the user — the
  `Finish(false, "cancelled")` call is idempotent via an `m_finished`
  guard so an already-succeeded session doesn't get downgraded.
- **`WebViewHost::Environment()` / `ClearVrcCookies()`.** The shell's
  WebView2 holder now exposes its environment pointer so
  `AuthLoginWindow` can create a second controller against the same
  profile, and a `ClearVrcCookies` helper that walks the main
  WebView2's cookie manager and calls `DeleteCookiesWithDomainAndPath`
  on `auth` + `twoFactorAuth` under both `vrchat.com` and
  `api.vrchat.cloud`. `HandleAuthLogout` calls this right after
  `AuthStore::Clear()` so the next login popup doesn't silently
  rehydrate from stale browser state.
- **`VrcApi::fetchCurrentUser()` / `fetchFriends(offline)`.** Two new
  auth-gated endpoints. `fetchCurrentUser` hits `/api/1/auth/user` and
  returns `std::nullopt` specifically on 401 so callers can auto-sign-out
  on stale cookies instead of surfacing mystery errors. `fetchFriends`
  hits `/api/1/auth/user/friends?offline=bool&n=100` and returns a raw
  JSON array. Both thread the AuthStore's cookie header through the
  existing `httpGet` WinHTTP call.
- **Frontend: Friends page (`web/src/pages/Friends.tsx`).** Full VRCX-
  style friend list — avatar thumbnail, display name, status badge
  (`active` / `join me` / `ask me` / `busy` / `offline`), platform icon
  (standalonewindows / android / web), and location parsed out of
  VRChat's compound `wrld_<id>:<inst>~private(usr_xxx)~region(us)`
  format. Filter box, show/hide offline toggle, refresh button, and a
  clean "Sign in with VRChat" landing card when the user isn't authed
  yet — a single button that fires `auth.openLoginWindow` and waits for
  the host-side `auth.loginCompleted` event. Not signed in → no list,
  no friendly "empty" lie, just the explicit auth prompt.
- **Frontend: `auth-context` + `AuthChip`.** One React context
  (`web/src/lib/auth-context.tsx`) with a visibility-aware 30s
  `auth.status` poll and a subscription to the host's
  `auth.loginCompleted` event, powering the whole app. Toolbar chip
  (`web/src/components/AuthChip.tsx`) renders three states
  (loading / signed-out → `Sign in with VRChat` button / signed-in →
  display name + hover-reveal `Sign out`) and is the only piece of
  chrome that ever calls `openLogin()` / `logout()`. Every other page
  just reads `useAuth().status.authed`.
- **Frontend: avatar thumbnails actually load now.** Removed the
  `isLookupSupported` frontend gate that only allowed `wrld_*` prefixes
  (`web/src/lib/thumbnails.ts`) — `avtr_*` now flows through the same
  `useThumbnail()` hook. Avatars page uses a real `<img>` when the host
  returns a CDN URL, and keeps the procedural cube as a fallback when
  the lookup 404s or the user isn't authed.
- **New IPC methods:** `auth.status`, `auth.openLoginWindow`,
  `auth.logout`, `auth.user`, `friends.list`. A new `auth.loginCompleted`
  event channel carries `{ok, error?, user?}` from the host to the
  frontend when the popup resolves. Mock branches added to the dev-mode
  IPC shim in `web/src/lib/ipc.ts` so the browser dev server works
  without the C++ host.
- **i18n:** new `auth.*` and `friends.*` key blocks in both `en.json`
  and `zh-CN.json`, plus `nav.friends`. The Settings page's 597
  VRChat registry descriptions are now localized — `Settings.tsx`
  resolves each row's description via
  `t('settings.vrc.keys.${key}.description', { defaultValue: entry.description })`,
  so the C++ English descriptions in `VrcSettingsKnownKeys.inc` stay
  canonical and `zh-CN.json` carries a full 597-entry `settings.vrc.keys`
  subtree of terse Simplified Chinese translations with VRChat-specific
  terminology kept consistent (模型/地图/音量/信任等级/名牌/着色器 etc.)
  and brand names preserved as-is (VRChat, Steam, OSC, SteamVR, VRC+,
  Discord).

### Changed

- **`VrcApi::performLookup` no longer short-circuits `avtr_*` with
  `avatar-api-requires-auth`.** It now calls `/api/1/avatars/{id}` with
  the cookie header from `AuthStore` when one exists, and treats a 401
  as a transient error (not a negative-cache entry) so signing in
  clears stale anonymous misses without wiping the whole cache.
- **Sidebar:** Friends added as the second nav entry (under Dashboard),
  using the `Users` lucide icon. Grouped under "Social" in the
  breadcrumb.
- **Version strings bumped to 0.2.0** across the installer wxs, MSI
  build/install scripts, WinHTTP user-agent, `IpcBridge::HandleAppVersion`,
  `web/package.json`, `App.tsx` shell version, Sidebar footer,
  AboutDialog, and Settings page.

### Known limits

- Friend list is capped at VRChat's default 100 — pagination comes
  later if anyone actually runs into it.
- No favorites / world / avatar API writes yet — v0.2.0 is read-only on
  the social side. The login infrastructure is the hard part; the rest
  of the VRChat API surface slots in behind the same cookie header.
- Offline friends hit a separate endpoint call (`?offline=true`) — we
  don't union the two lists in one roundtrip, so toggling "Show offline"
  triggers a refetch rather than a client-side filter.

## [0.1.3] — 2026-04-15

Live-tail cut. v0.1.2 shipped a batch log parser — you had to hit
"Rescan" to see new events. v0.1.3 makes VRCSM watch the running client:
one second after VRChat writes a line, it shows up in the Logs page
without a manual refresh. No `FileSystemWatcher` anywhere — that API
drops writes on buffered stdout and fires false positives on rename, so
VRCX learned the hard way years ago that a dumb 1-second poll with
shared-read file handles is the only thing that actually keeps up with
VRChat's stdout. VRCSM copies that playbook.

### Added

- **`LogTailer` core worker.** New `src/core/LogTailer.{h,cpp}` spawns a
  single background `std::thread` that wakes every 1000 ms via a
  `condition_variable::wait_for` (so `Stop()` joins immediately instead
  of waiting out the poll interval), rescans the VRChat log folder for
  the newest `output_log_*.txt`, and reads any bytes past the last-known
  offset. Files are opened with `CreateFileW` +
  `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE` so VRChat's
  own non-exclusive writer can keep appending while we read —
  the bog-standard `std::ifstream` would fight the writer under NTFS
  sharing rules. The tailer seeks to EOF on first attach (no history
  replay — that's the batch parser's job), keeps a 1 MB carryover buffer
  for incomplete trailing lines, handles truncation by resetting the
  offset to 0, and picks up log rotation on the next tick by noticing
  that `FindLatestLog()` returned a different path. Emitted
  `LogTailLine` structs carry the raw body with the
  `YYYY.MM.DD HH:MM:SS Log -  ` prefix already stripped, a level
  (`info`/`warn`/`error` mapped from `Log`/`Warning`/`Error`), the ISO
  timestamp, and the source filename so the frontend can tell lines from
  a rotation apart.
- **`LogEventClassifier` streaming classifier.** New
  `src/core/LogEventClassifier.{h,cpp}` takes one `LogTailLine` at a
  time and runs it past the same four regexes the batch `LogParser`
  uses — `OnPlayerJoined`, `OnPlayerLeft`, `Switching <actor> to avatar
  <name>`, and `[VRC Camera] Took screenshot to:` — then emits a JSON
  envelope of `{kind, data}` or `null` for noise. A `substring()` prefilter
  rejects 90%+ of lines before touching `std::regex_search`, so a burst
  of 50 Udon log lines costs one `find()` each. Because it's stateless,
  the tailer never has to buffer cross-line context — every classify
  call is independent and thread-safe.
- **`logs.stream.start` / `logs.stream.stop` IPC handlers.** New
  `IpcBridge` endpoints construct / tear down a single
  `std::unique_ptr<LogTailer>` member (idempotent — calling `start`
  twice is a no-op). The tailer's callback posts two events per line
  to the web side: `logs.stream` with the raw body for anyone who wants
  the console-style firehose, and `logs.stream.event` with the
  classifier output for UI panels that only care about player /
  avatarSwitch / screenshot. Both go through
  `WebView2Host::PostMessageToWeb` so the frontend gets them via the
  existing `{event, data}` channel.
- **Logs page live-rolling panels.** `web/src/pages/Logs.tsx` now
  subscribes to `logs.stream.event` on mount via `ipc.on(...)`, appends
  each classified event to one of three local state arrays
  (`livePlayer` / `liveSwitch` / `liveScreenshot`, each capped at 200
  entries so long sessions don't balloon React state), and merges that
  delta into the existing `useMemo` timelines. The three panels that
  v0.1.2 added update in place — no rescan button — and the
  most-recent-first sort order means new events slide in at the top.
  The `logs.stream.start` RPC fires once per mount and the listener
  cleans up on unmount, so navigating away from Logs doesn't leak the
  subscription.
- **`tools/tail_probe` self-test harness.** New standalone C++ probe
  that constructs a `LogTailer` against a temp directory, writes
  synthetic `output_log_*.txt` files, and asserts ten cases covering
  the full live-tail chain: pre-start line is NOT replayed on EOF seek,
  info + warn levels are extracted with correct prefix stripping, a
  half-line flush stitches via the carryover buffer, a rotation picks
  up a newer file on the next tick, `Stop()` silences the callback, and
  five classifier cases for OnPlayerJoined with `usr_id`, OnPlayerLeft,
  Switching avatar, screenshot path, and noise-line rejection. Exit
  code is the failure count; 10/10 green as of this commit. It's wired
  into `CMakeLists.txt` next to the existing dump tools so it builds
  alongside the host without extra flags.

### Changed

- **Version strings unified.** Every user-visible version string is now
  `0.1.3`: `installer/vrcsm.wxs` ProductVersion, `scripts/build-msi.bat`
  output filename, `scripts/install-msi.ps1` default param,
  `src/core/VrcApi.cpp` User-Agent (sent to `api.vrchat.cloud`),
  `src/host/IpcBridge.cpp` `HandleAppVersion`, `web/package.json`,
  `web/src/App.tsx` `shellVersion`, `web/src/components/Sidebar.tsx`
  footer, and the dev-mode fallbacks in `AboutDialog.tsx` +
  `Settings.tsx`.

## [0.1.2] — 2026-04-15

Event-stream cut. v0.1.1 made the app feel like a native tool; v0.1.2 pushes
the LogParser past VRCX-parity and wires three new timeline surfaces into
the Logs page so you can actually see who joined, which avatars people
switched to, and where the camera dumps screenshots — all derived from
`output_log_*.txt` without hitting the VRChat API.

### Added

- **LogParser event streams.** Three new regex-driven streams collected
  during the normal per-line pass, each capped at 500 entries so the IPC
  payload stays under WebView2's comfort zone on sessions with hundreds
  of log files: `player_events` (`[Behaviour] OnPlayerJoined` /
  `OnPlayerLeft`, with optional `usr_…` id on newer client builds),
  `avatar_switches` (every `[Behaviour] Switching <actor> to avatar
  <name>` regardless of whether the actor is local or remote), and
  `screenshots` (`[VRC Camera] Took screenshot to: <absolute path>`).
  Each event carries a sticky ISO timestamp derived from the nearest
  preceding `YYYY.MM.DD HH:MM:SS` block header — the same trick VRChat
  itself uses to anchor lines without per-entry dates. Reference install
  currently emits 93 / 83 / 3 events respectively.
- **Logs page 3-panel timeline.** The Logs route gained a responsive
  `lg:grid-cols-3` row that renders the three new streams as
  independently-filterable panels: player events with join/leave icons
  and usr_id hover, avatar switches grouped by actor line, and
  screenshots shown as filename + timestamp with the absolute path on
  hover. Each panel has its own scroll container capped at `max-h-72`
  (player/switch) or `max-h-80` (screenshots) so the three never fight
  for layout space, and panels are shown most-recent-first since that's
  what the user is actually looking for. Full i18n pass in `en.json` and
  `zh-CN.json` for every new string.

### Changed

- **Settings page write path end-to-end.** The write scaffolding landed
  during v0.1.1's VrcSettings module, but the editor row wasn't wired
  into every value type — it now is. `EntryEditor` renders a 2-button
  OFF/ON toggle for `bool`, a numeric Input for `int` and `float`, a
  text Input for `string`, and a read-only hex sample for `raw`. Dirty
  rows get a primary-color key label + Apply/Revert buttons, and the
  whole thing disables itself when `ProcessGuard::IsVRChatRunning()`
  reports true so VRChat's own `PlayerPrefs.Save()` on exit can't
  clobber a pending write.
- **Version strings unified.** Every user-visible version string is now
  `0.1.2`: `installer/vrcsm.wxs` ProductVersion, `scripts/build-msi.bat`
  output filename, `scripts/install-msi.ps1` default param,
  `src/core/VrcApi.cpp` User-Agent (sent to `api.vrchat.cloud`),
  `web/src/App.tsx` `shellVersion`, `web/src/components/Sidebar.tsx`
  footer, and the dev-mode fallbacks in `AboutDialog.tsx` +
  `Settings.tsx`. `IpcBridge::HandleAppVersion` was already emitting
  `0.1.2` after the v0.1.1→v0.1.2 bump commit.

### Fixed

- **`recharts` dead dependency.** Removed from `web/package.json` —
  v0.1.1's Dashboard viz rewrite deleted every `recharts` import but
  left the dependency behind, bloating the node_modules tree.

## [0.1.1] — 2026-04-14

Second cut. v0.1.0 was the baseline rewrite — the goal for 0.1.1 was to
stop looking like a generic React dashboard and start feeling like a
native companion tool someone would actually keep open next to VRChat.

### Added

- **Unity-ish IDE shell.** The whole layout got rebuilt around a Unity
  Editor idiom: a thin top MenuBar, a unity-toolbar row underneath it
  with an app-icon and live VRChat running indicator, a persistent left
  Sidebar that doubles as the navigation rail, an optional right
  inspector dock, a tabbed Console/Output/Problems panel at the bottom
  with a drag-to-resize handle, and a 22-pixel StatusBar with page
  breadcrumbs, cache total, and version pill. Panels are flat grey
  surfaces with hard 1-pixel borders — no glow, no blur, no gradient.
- **Worlds page.** New `/worlds` route with a two-column grid/inspector
  layout. Tiles are hash-derived gradient blocks with a diagonal noise
  overlay as a stand-in thumbnail until real world thumbnail scraping
  lands. Names come from log pairing (`worldName=` regex) when
  available, otherwise fall back to the short world id.
- **Avatar name resolution from logs.** `LogParser` now watches for
  `Loading Avatar Data: avtr_…` followed by the paired
  `[AssetBundleDownloadManager] Unpacking Avatar (<name> by <author>)`
  line and stores the result in `LogReport::avatar_names`. Avatars the
  user has actually loaded once now show up with a real name + author
  in the Avatars page instead of a bare GUID.
- **Avatars page Inspector + CSS 3D preview.** Two-column Unity
  Inspector layout: filterable list on the left, a CSS 3D spinning cube
  on the right whose face colors are derived from the avatar id via
  FNV-1a so the same id always produces the same preview. Rotating
  slowly at rest, spins faster on hover. Below the cube is a proper
  metadata panel with eye height, parameter count, modified date, and a
  mono block for the raw id / user id / path.
- **Bundles preview dialog overhaul.** The `__info` text dump got
  replaced with a structured breakdown: header badges for format,
  magic, size, file count, and modification time; a zebra-striped
  key/value table built by parsing `key=value`/`key:value` lines out of
  the raw info text; a recursive file-tree view built from the full
  bundle entry directory (not just `__data`); and the full entry path
  at the bottom. The `HandleBundlePreview` C++ handler was also fixed
  to sniff the entry *directory*, so `fileTree` now actually lists
  `__data`, `__info`, `vrc-version` etc. instead of a single
  `["__data"]`.
- **VRChat in-game settings (read + export).** New `src/core/VrcSettings`
  module reads Unity PlayerPrefs values from
  `HKCU\Software\VRChat\VRChat` (597 values on the reference install)
  directly via `RegEnumValueW`, decodes Unity's poorly-documented
  `REG_BINARY` payload format, and groups keys into Audio / Graphics /
  Network / Avatar / OSC / Comfort / UI / Privacy / Other buckets using
  a hand-curated table of the most user-relevant keys. The decoder
  supports **both** Unity PlayerPrefs layouts: the legacy pre-2019
  format (1-byte type tag `0x00`/`0x01`/`0x02` + 4-byte length +
  payload for strings, `0x03` + 8-byte double for floats) *and* the
  Unity 2019+ tag-less format that current VRChat builds actually
  write — strings stored as raw UTF-8 bytes with a trailing NUL, floats
  stored as 4-byte IEEE 754 single precision with no tag at all. New
  values are tried first; we only fall back to the legacy tag dispatch
  when the bytes don't look like a null-terminated UTF-8 string or a
  4-byte float. `EncodeValue` mirrors the new format so writes
  round-trip cleanly through VRChat's own loader. New IPC methods:
  `settings.readAll`, `settings.writeOne`, `settings.exportReg`.
  Writes are gated on `ProcessGuard::IsVRChatRunning()` so VRChat's own
  `PlayerPrefs.Save()` on exit can't clobber our changes. The Settings
  page surfaces these as grouped accordion sections with live values
  straight off the registry, a dirty-edit indicator, and an "Export
  .reg" action that shells out to `reg export` for a safe backup
  before any write.
- **App icon.** The sidebar logo is now the real VRCSM icon
  (`web/public/app-icon.png`, extracted from `resources/icons/vrcsm.ico`)
  instead of the M3 gradient V placeholder.
- **i18n coverage.** Every new page and surface (Worlds, Avatars
  inspector, Bundles preview, Settings groups, MenuBar, Toolbar, Dock
  tabs, StatusBar) has both `en` and `zh-CN` strings in
  `web/src/i18n/locales/`. Unknown keys no longer fall back to English.

### Changed

- **Full palette swap, Unity dark skin.** `web/src/styles/globals.css`
  got rewritten around Unity editor neutrals:
  `--canvas 0 0% 11%` / `--surface 0 0% 16%` / `--surface-raised 0 0% 20%` /
  `--surface-bright 0 0% 24%`, primary `210 72% 56%` (#3B8FD6 — Unity
  blue, not M3 purple), radius `6px`/`3px` instead of 18px, hard
  1-pixel `--border 0 0% 8%` for cut lines and `--border-strong 0 0% 30%`
  for raised edges. Every `backdrop-filter: blur` and `saturate` call
  was deleted — that was the main source of the "light pollution"
  complaint. Body background is now an opaque `hsl(var(--canvas))`
  instead of transparent over Mica.
- **UI primitives flattened.** `Button`, `Card`, `Badge`, `Progress`,
  `Dialog`, and the new `Input` primitive were rewritten to drop glow
  rings, `backdrop-blur`, gradient fills, and hover-translate effects.
  Default card elevation is now `flat`, not `raised`. Button press
  feedback is a 1-pixel `active:translate-y-px` instead of a scale
  animation. Dialog overlay is `bg-black/70`, no blur.
- **Dashboard chart palette and tooltip.** Recharts was using an M3
  purple+neon palette (`#A78BFA #60A5FA #34D399 …`) which looked wrong
  against the grey canvas. Replaced with a muted Unity-neutral palette
  led by `#3B8FD6`. The tooltip lost its `backdrop-filter: blur(24px)`
  and `color-mix` transparency in favor of a flat `hsl(--surface-bright)`
  background with a 1-pixel `--border-strong` outline.
- **Dashboard / Migrate headers compacted.** The 32-pixel page-title
  look was pure SaaS chrome — headers are now a 13px bold label +
  uppercase mono caption + path breadcrumb, matching the Unity panel
  header voice.

### Fixed

- **Bundles preview showed nothing useful.** `HandleBundlePreview` was
  calling `BundleSniff::sniff(base / "__data")` which is a file, so the
  sniffer went down the single-file branch and `fileTree` came back as
  just `["__data"]`. Changed to `sniff(base)` so the whole entry
  directory is walked. The frontend was also passing `entry.entry`
  (the hash) where the C++ side expected `entry.path` (absolute path);
  fixed both sides together.
- **Backdrop-filter blur was fighting DWM.** Every `backdrop-filter:
  blur(...)` had been compounding with the WebView2 transparent
  background against the Win32 Mica effect, producing the washed-out
  frosted look the user kept calling "codex画风". All removed.

### Known limitations

- Bottom Console dock streams from an empty source until the C++ side
  starts forwarding log tail events. Wiring is there, source isn't yet.
- VrcSettings `WriteOne` covers `Int`/`Float`/`String` but leaves `Bool`
  writes pending — Unity encodes booleans as `DWORD` 0/1 so this is
  trivial to add, just not plumbed through the UI yet.
- The VrcSettings known-key table is ~80 entries curated out of 597
  observed keys. The remaining ~517 keys are still read (and grouped
  into `other`) but without a description.
- One C++ smoke harness lives under `tools/dump_settings/`. It links
  `vrcsm_core` directly, calls `VrcSettings::ReadAllJson`, and prints
  type/group breakdowns plus a handful of showcase entries — used as a
  GUI-less verification path for the decoder against a live registry
  hive. On the reference install it classifies all 597 entries (548
  int, 3 bool, 49 string) with zero raw fallthroughs. No broader test
  suite yet; everything else is still manual smoke: launch the MSI,
  verify Sidebar + all seven routes render, run a scan, open a bundle
  preview, spot-check one avatar's name, open Settings and confirm
  the registry enumeration returns entries.
