I now have everything verified. Producing the final parity report.

---

# VRCX Feature Parity Matrix — Wave 2 (vrcx-features)

Source of truth: `vrcx-team/VRCX` `Dotnet/LogWatcher.cs` (master, 1442 lines — fetched & grepped 2026-06-29). VRCSM side verified against local `src/core/LogAtoms.{h,cpp}`, `LogEventClassifier.cpp`, `web/src/lib/feed.ts`. Every log signature below is the **exact literal** VRCX matches via `string.Compare`/`Contains`/`IndexOf`.

## 1. FULL log-event coverage (the table that drives implementation)

VRCX `LogWatcher.cs` has **34 parser methods**; ~26 emit feed events (rest are state-only or commented dead code). VRCSM has **16 atoms** covering ~10 of VRCX's event-producers. Below: every VRCX parser, its exact match string(s) with `LogWatcher.cs` line, emitted `type`, and VRCSM status.

| VRCX parser (line) | EXACT log-line match string | VRCX `type` | VRCSM status |
|---|---|---|---|
| `ParseLogOnPlayerJoinedOrLeft` (463) | `"[Behaviour] OnPlayerJoined"` (excl. `"] OnPlayerJoined:"`) / `"[Behaviour] OnPlayerLeft"` (excl. `"] OnPlayerLeftRoom"`, `"] OnPlayerLeft:"`) | `player-joined` / `player-left` | ✅ `PlayerPresence` (`kPlayerJoinedRe`/`kPlayerLeftRe`) |
| `ParseLogLocation` (342) | `"[Behaviour] Entering Room: "` (→ RecentWorldName, no event); `"[Behaviour] Joining "` (excl. `"] Joining or Creating Room: "`, `"] Joining friend: "`) | `location` | ✅ `RoomName`/`WorldInstance` (`kEnteringRoomRe`,`kJoiningRoomRe`,`kJoiningInstanceRe`) |
| `ParseLogLocationDestination` (422) | `"[Behaviour] OnLeftRoom"` / `"[Behaviour] Destination fetching: "` | `location-destination` | 🟡 partial — `WorldDestination` matches `Destination requested/set/fetching` but **no `OnLeftRoom` leave marker** |
| `ParseLogAvatarChange` (909) | `" to avatar "` after `"[Behaviour] Switching "` | `avatar-change` | ✅ `AvatarSwitch` (`kSwitchingAvatarRe`) |
| `ParseLogScreenshot` (400) | `"[VRC Camera] Took screenshot to: "` | `screenshot` | ✅ `Screenshot` (`kScreenshotRe`) |
| `ParseLogPortalSpawn` (541) | `"[Behaviour] Instantiated a (Clone ["` + `"] Portals/PortalInternalDynamic)"` | `portal-spawn` | ✅ `PortalSpawn` (`kPortalSpawnRe`) |
| `ParseLogVideoChange` (738) | `"[Video Playback] Attempting to resolve URL '"` | `video-play` | ✅ `VideoPlay` (`kVideoResolveRe` covers both) |
| `ParseLogAVProVideoChange` (763) | `"[Video Playback] Resolving URL '"` | `video-play` | ✅ `VideoPlay` (same regex) |
| `ParseVoteKick` (1232) | `"[Behaviour] Received executive message: "` | `event` | ✅ `VoteKick` phase=self (`kVoteKickSelfRe`) |
| `ParseVoteKickInitiation` (1303) | `"[ModerationManager] A vote kick has been initiated against "` | `event` | ✅ `VoteKick` (`kVoteKickInitiatedRe`) |
| `ParseVoteKickSuccess` (1322) | `"[ModerationManager] Vote to kick "` | `event` | ✅ `VoteKick` (`kVoteKickSucceededRe`) |
| `ParseFailedToJoin` (1250) | `"[Behaviour] Failed to join instance "` | `event` | ✅ `JoinBlocked` reason_kind=failed (`kFailedToJoinRe`) |
| `ParseLogJoinBlocked` (587) | `"] Master is not sending any events! Moving to a new instance."` | `event` | ✅ `JoinBlocked` reason_kind=blocked (`kJoinBlockedRe`) |
| `ParseStickerSpawn` (1341) | `"[StickersManager] User "` + `"inv_"` + `"spawned sticker"` | `sticker-spawn` | ✅ `StickerSpawn` (`kStickerSpawnRe`) |
| `User Authenticated` (handled in user/auth flow, not LogWatcher table but VRCSM parses it) | `"User Authenticated: <name> (usr_…)"` | — | ✅ `UserAuthenticated` (`kUserAuthRe`) |
| (avatar `-  avatar:` profile line) | `^  - avatar: avtr_…` | — | ✅ `ProfileAvatar` (`kProfileAvatarRe`) |
| `Unpacking World` / `Unpacking Avatar` / `Loading Avatar Data:` | (Unity loader lines) | — | ✅ `WorldUnpack`/`AvatarUnpack`/`AvatarLoad` (VRCSM-only extras, VRCX doesn't surface these as feed) |
| **`ParseLogNotification` (860)** | **`"[API] Received Notification: <"` + `"> received at "`** | **`notification`** | ❌ **GAP — friend req/invite/inviteResponse/requestInvite echoed in log** |
| **`ParseLogUdonException` (1084)** | **`"[PyPyDance]"` OR `" ---> VRC.Udon.VM.UdonVMException: "`** | **`udon-exception`** | ❌ **GAP (L7, deferred opt-in)** |
| **`ParseOscFailedToStart` (1267)** | **`"Could not Start OSC: "`** (e.g. `Address already in use`) | **`event`** | ❌ **GAP (L7)** |
| **`ParseLogShaderKeywordsLimit` (562)** | **`"Maximum number (384) of shader global keywords exceeded"`** | **`event`** | ❌ **GAP (L7), once-per-context dedupe** |
| **`ParseLogOnAudioConfigurationChanged` (1032)** | **`"[Always] uSpeak: OnAudioConfigurationChanged"` (state) + `"[Always] uSpeak: SetInputDevice 0"` → extracts mic name after `") '"`** | **`event`** ("Audio device changed, mic set to '…'") | ❌ **GAP (L7), stateful 2-line dedupe** |
| **`ParseInstanceResetWarning` (1284)** | **`"[ModerationManager] This instance will be reset in "`** | **`event`** | ❌ **GAP (L8)** |
| **`ParseApplicationQuit` (1118)** | **`"VRCApplication: OnApplicationQuit at "` OR `"VRCApplication: HandleApplicationQuit at "`** | **`vrc-quit`** (sets VrcClosedGracefully) | ❌ **GAP (L8) — session end marker** |
| **`ParseOpenVRInit` (1140)** | **`"Initializing VRSDK."` OR `"STEAMVR HMD Model: "`** | **`openvr-init`** | ❌ **GAP (L8) — VR session marker** |
| **`ParseDesktopMode` (1162)** | **`"VR Disabled"`** | **`desktop-mode`** | ❌ **GAP (L8)** |
| **`ParseLogAvatarPedestalChange` (605)** | **`"[Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for "`** → `"<user> changed avatar pedestal"` | **`event`** | ❌ **GAP** |
| **`ParseLogVideoError` (625)** | **`"[Video Playback] ERROR: "` / `"[AVProVideo] Error: "` / `"Attempted to play an untrusted URL"`** (special-cases YouTube `"Sign in to confirm"` → injects VRCVideoCacher fix URL) | **`event`** (`VideoError: …`) | ❌ **GAP — video failure feed item** |
| **`ParseLogSDK2VideoPlay` (788)** | **`"User "` + `" added URL "`** (captures display name) | **`video-play`** | 🟡 GAP — VRCSM has video-play but not this SDK2 variant w/ attributed user |
| **`ParseLogUsharpVideoPlay` (814)** | **`"[USharpVideo] Started video load for URL: "` + `", requested by "`** | **`video-play`** | 🟡 GAP — USharpVideo variant w/ requester |
| **`ParseLogUsharpVideoSync` (840)** | **`"[USharpVideo] Syncing video to "`** | **`video-sync`** | ❌ GAP |
| **`ParseLogStringDownload` (1178)** | **`"] Attempting to load String from URL '"`** (ignores `localhost:22500`) | **`resource-load-string`** | ❌ **GAP — Udon string-loader URL** |
| **`ParseLogImageDownload` (1205)** | **`"] Attempting to load image from URL '"`** (ignores `localhost:22500`) | **`resource-load-image`** | ❌ **GAP — Udon image-loader URL** |
| `ParseLogAPIRequest` (884) | `"] Sending Get request to "` | `api-request` | ⚪ internal/diagnostic, low value |
| `ParseLogWorldVRCX` (704) | `"[VRCX] "` | `vrcx` | ⚪ VRCX self-protocol (in-world→app); not applicable |
| `ParseLogWorldDataVRCX` (724) | `"[VRCX-World] "` | (deprecated, logged only) | ⚪ deprecated |
| `ParseLogPhotonId` (935) | `" Avatar (UnityEngine.Animator) VRCPlayer[Remote] "` etc. | — | ⚪ **commented-out dead code in VRCX** |

### The GAP — ~12 VRCX event-producers VRCSM is missing (priority order)

High-value feed items:
1. **Notification** — `"[API] Received Notification: <"` … `"> received at "` (friend requests, invites, invite responses, requestInvite). VRCSM master-plan L6.
2. **Video error** — `"[Video Playback] ERROR: "` / `"[AVProVideo] Error: "` / `"Attempted to play an untrusted URL"`.
3. **SDK2 / USharpVideo play+sync** — `" added URL "`, `"[USharpVideo] Started video load for URL: "` + `", requested by "`, `"[USharpVideo] Syncing video to "` (attributed-user video, VRCSM only has the anonymous `[Video Playback]` resolve form).
4. **Avatar pedestal change** — `"[Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for "`.

Diagnostics (master-plan L7, default-off category):
5. **Udon exception** — `" ---> VRC.Udon.VM.UdonVMException: "` (+ `"[PyPyDance]"`).
6. **OSC failed-to-start** — `"Could not Start OSC: "`.
7. **Shader keyword limit** — `"Maximum number (384) of shader global keywords exceeded"`.
8. **Audio device change** — `"[Always] uSpeak: SetInputDevice 0"` (stateful; needs `OnAudioConfigurationChanged` flag + last-device dedupe).
9. **String/Image download** — `"] Attempting to load String from URL '"` / `"] Attempting to load image from URL '"` (Udon loaders; filter `localhost:22500`).

Session markers (master-plan L8):
10. **Instance reset warning** — `"[ModerationManager] This instance will be reset in "`.
11. **App quit** — `"VRCApplication: OnApplicationQuit at "` / `"VRCApplication: HandleApplicationQuit at "`.
12. **OpenVR init / desktop mode** — `"Initializing VRSDK."` / `"STEAMVR HMD Model: "` / `"VR Disabled"`.

Also missing the cheap state-only **`OnLeftRoom`** leave marker (`"[Behaviour] OnLeftRoom"`).

**Emoji spawn:** No stock-client `[EmojiManager]` log line exists in VRCX's `LogWatcher.cs` (zero matches). VRCSM master-plan L5 already correctly flagged this as unverifiable. **UNVERIFIED** — do not ship without a live-log capture.

## 2. BOOP / stickers / emoji / prints / gallery / icons — UI + API

VRCX stores these in `src/stores/gallery.js`, UI in `src/views/Tools/Gallery.vue` (tabs: gallery / icons / emojis / stickers, gated by `maxUserEmoji`/`maxUserStickers`). API in `src/api/vrcPlusImage.js` (verified):

| Content | VRCX API (verified path + method) | VRCX UI | VRCSM status |
|---|---|---|---|
| **Gallery images** | `uploadGalleryImage` → POST `file/image` (`tag:'gallery'`, `matchingDimensions:false`); list via `getFileList` `tag:'gallery'` | Gallery tab, React Query key `['gallery']` | ❌ none |
| **Stickers** | `uploadSticker` → POST `file/image` (`uploadImage:true`, `matchingDimensions:true`); list `tag` (gallery store) | Stickers tab | 🟡 spawn-event only (`StickerSpawn` log atom); no upload/manage/gallery |
| **Emoji** | `uploadEmoji` → POST `file/image` (`matchingDimensions:true`) | Emojis tab | ❌ none (spawn log line unverified) |
| **Icons (VRC+)** | tab present (`dialog.gallery_icons.icons`); upload path **not in this file — UNVERIFIED** (likely `file/image` with icon tag/fileType) | Icons tab | ❌ none |
| **Prints** | `getPrints` → GET `prints/user/{userId}`; `getPrint` → GET `prints/{printId}`; `uploadPrint` → POST `prints` (`uploadImagePrint:true`, `cropWhiteBorder`); `deletePrint` → DELETE `prints/{printId}` (`editPrint` commented out) | Prints viewer/manager | ❌ none |
| **BOOP** | **UNVERIFIED** — no `boop`/`BOOP` identifier found in `LogWatcher.cs` or `vrcPlusImage.js`. BOOP is a VRChat avatar interaction (Avatar Dynamics/contact), not a VRCX-parsed log/API feature. No VRCX coverage to match. | — | n/a |

Sticker/emoji/gallery all hit the **same `file/image` endpoint**, differentiated by params (tag + `matchingDimensions`), not path. Prints have dedicated `prints/*` endpoints.

## 3. Avatar / model management & provider weaknesses

VRCX shows owned avatars via VRChat's own avatar API (`avatars?user=me`), plus optional **user-configured external "Remote Avatar Database" providers** (community sites like avtrDB/worldbalancer/avatarrecovery) to look up avatars **not owned by the user** (recover/browse public-but-unlisted avatars by `avtr_`/user id).

Confirmed weaknesses (verified via GitHub issues):
- **#1017** (closed *not_planned*, 2026-03-16): No documentation for implementing an avatar search provider — users must "use a proxy to intercept HTTP requests and reverse engineer it yourself." Provider integration is undocumented/fragile.
- **#412** (closed, 2022): Avatar search/cache behaves unexpectedly — search-all with no query only returns the user's own avatars; results only appear after typing a query (cache/history quirk, no sort-without-query).
- **#430** (closed, 2022): Provider lookup breaks when a remote DB returns non-JSON (`"error code:1020" is not valid JSON` — Cloudflare block) → `SyntaxError`, no graceful handling of dead/Cloudflare-gated providers.

Net: VRCX's avatar-DB feature is a **hardcoded, undocumented, third-party-dependent hack** prone to dead providers and brittle JSON parsing. VRCSM master-plan Track M targets this directly (M3 pluggable provider as sandboxed plugin, provider-agnostic, results cached in `asset_cache`; M1 native local avatar DB). VRCSM currently has experimental visual/CLIP avatar search (`avatar-embedding.ts`, master-plan unique angle) — a differentiator VRCX lacks.

## 4. Other online things VRCX does that VRCSM lacks

- **Notification/invite pipeline surfacing** — VRCX echoes the websocket `[API] Received Notification` feed (friend req, invite, inviteResponse, requestInvite) and offers tray toasts. VRCSM master-plan B5/P2 unbuilt (`Notifications/toasts: ❌ none`).
- **Print management** — full `prints/*` CRUD (above). VRCSM none.
- **Gallery/emoji/sticker/icon VRC+ management** — full upload/list/delete. VRCSM none.
- **Video-error + attributed video sources** — VRCX surfaces playback errors and per-user video attribution (SDK2/USharpVideo); VRCSM only has anonymous resolve-URL.
- **Diagnostics feed** (Udon exceptions, OSC failure, shader-keyword, audio-device) — VRCX surfaces; VRCSM none (L7 deferred).
- **Session markers** (VR/desktop mode, app-quit graceful flag, instance-reset) — VRCX tracks; VRCSM none (L8).

Where VRCSM already **wins** (per master-plan, not regressions): virtualized+deduped feed with stable composite keys (vs VRCX paging bugs #1788/#1801), real OSC Studio + send flow (VRCX only detects OSC failure), bundle/cache sniff + avatar preview, sandboxed plugin market, experimental CLIP avatar search.

## Implementation note for the GAP atoms
Each missing atom follows the locked 6-touch-point pattern (regex in `LogAtoms.cpp` → `LogAtomKind` enum in `LogAtoms.h` → classifier case in `LogEventClassifier.cpp` → `LogReport` struct+`to_json` in `LogParser.{h,cpp}` → `LogsBridge.cpp` live persist → `Database.cpp` UnifiedFeed `source_kind`/`category` + `web/src/lib/feed.ts` `categorize()` + `Feed.tsx` icon/label, + golden-line test in `tests/CommonTests.cpp`). Two atoms need **stateful dedupe** like VRCX (shader-keyword once-per-context; audio-device needs the `OnAudioConfigurationChanged` flag + last-device compare) — VRCSM's `ParseVrchatLogAtom` is currently stateless, so these require either a stateful classifier layer or per-session dedupe in `LogsBridge`/`Database` (matches the existing comment in `LogAtoms.h:56-57` about adding cross-line context).

Key files: `D:\Project\VRCSM\src\core\LogAtoms.cpp`, `D:\Project\VRCSM\src\core\LogAtoms.h`, `D:\Project\VRCSM\src\core\LogEventClassifier.cpp`, `D:\Project\VRCSM\web\src\lib\feed.ts`. VRCX reference: `vrcx-team/VRCX` `Dotnet/LogWatcher.cs` (line numbers cited above, master branch), `src/api/vrcPlusImage.js`, `src/views/Tools/Gallery.vue`, `src/stores/gallery.js`.