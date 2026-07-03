I have everything needed. Verified all market sources and traced the existing 6 touch-point pattern through the VRCSM codebase. Final report below.

---

# VRCSM Wave 2 — Log-Max-Coverage Research

## What I verified (sources)

- **VRCX `LogWatcher.cs`** — read in full at `Dotnet/LogWatcher.cs`, commit `7e4f4b1`, blob SHA `0c77ee4b`. This is the authoritative market parser. Extracted all 35 `Parse*` methods with their verbatim marker strings and the real dated log samples in their code comments. [vrcx-team/VRCX](https://github.com/vrcx-team/VRCX/blob/master/LogWatcher.cs)
- **VRC-LOG** (avatar-ID sourcing) — read `src/vrchat.rs`, `src/lib.rs` at commit `313f493`. Confirmed the Amplitude technique path + regex (details in §3). [ShayBox/VRC-LOG](https://github.com/ShayBox/VRC-LOG)
- **Current VRCSM** — read `src/core/LogAtoms.{h,cpp}` (16 atoms), traced `StickerSpawn` through all 6 touch-points. The "video/portal/sticker pattern" is real and consistent.
- **Emoji** — searched VRChat wiki/docs/feedback + grepped VRCX. **Result below in §4 (UNVERIFIED).**

Current 16 `LogAtomKind` (LogAtoms.h:19-37): UserAuthenticated, ProfileAvatar, WorldDestination, WorldUnpack, RoomName, WorldInstance, AvatarSwitch, AvatarUnpack, AvatarLoad, PlayerPresence, Screenshot, VideoPlay, PortalSpawn, VoteKick, JoinBlocked, StickerSpawn.

All regex below match the **prefix-stripped body** (the `match[3]` capture of `kLinePrefixRe` at LogAtoms.cpp:13-14), matching VRCSM's existing convention. VRChat 2023+ prefix is `YYYY.MM.DD HH:MM:SS Log/Warning/Error        -  <body>` (padded width), already handled.

---

## §1 — Ranked, implementation-ready atom list

### TIER 1 — high value, modern-confirmed, ship first

**A1. Notification (invite / friend request / invite response)** — the biggest social gap.
- VRCX: `ParseLogNotification`, marker `[API] Received Notification: <` ... `> received at `
- Real line (VRCX comment, dated 2021.01.03, format unchanged through 2024):
  ```
  [API] Received Notification: <Notification from username:pypy, sender user id:usr_4f76a584-9d4b-46f6-8209-8305eb683661 to of type: friendRequest, id: not_3a8f66eb-613c-4351-bee3-9980e6b5652c, created at: 01/14/2021 15:38:40 UTC, details: {{}}, type:friendRequest, m seen:False, message: ""> received at 01/02/2021 16:48:58 UTC
  ```
- Proposed regex (extract inner blob, then sub-parse fields):
  ```
  \[API\] Received Notification: <Notification from username:(.+?), sender user id:(usr_[0-9a-fA-F-]+) to of type: (\w+), id: (not_[0-9a-fA-F-]+).*?, type:(\w+).*?> received at
  ```
- Captured: `sender_name`, `sender_id`, `type` (friendRequest / invite / requestInvite / inviteResponse / requestInviteResponse / votetokick / message), `notification_id`. VRCX captures the whole blob and parses in JS; VRCSM should capture sender_id/name/type/not_id in C++.
- Reliability: **HIGH.** VRCX still ships this; format stable since 2021. The `[API]` prefix and the trailing `> received at` bracket are the stable anchors.
- Feed category: `notification` (new) — sub-icon by type (invite / friendRequest).

**A2. Video playback error** — complements existing `VideoPlay`.
- VRCX: `ParseLogVideoError`, markers `[Video Playback] ERROR: ` and `[AVProVideo] Error: `
- Real lines:
  ```
  [Video Playback] ERROR: Video unavailable
  [Video Playback] ERROR: Private video
  [AVProVideo] Error: Loading failed.
  ```
- Regex: `\[(?:Video Playback|AVProVideo)\] (?:ERROR|Error): (.+?)\s*$`
- Captured: `error_message`. Reliability: **HIGH** (both code paths active in modern client).
- Feed category: reuse `video` source_kind with an `error` flag, or new `videoError`.

**A3. Application quit / session boundary** — powers session segmentation + "closed gracefully".
- VRCX: `ParseApplicationQuit`, markers `VRCApplication: OnApplicationQuit at ` and `VRCApplication: HandleApplicationQuit at `
- Real lines:
  ```
  VRCApplication: OnApplicationQuit at 1603.499
  VRCApplication: HandleApplicationQuit at 936.5161
  ```
- Regex: `VRCApplication: (?:OnApplicationQuit|HandleApplicationQuit) at ([\d.]+)`
- Captured: `uptime_seconds`. Reliability: **HIGH** — note VRCX added `HandleApplicationQuit` (2024.10.23) because the client renamed it; you MUST match both.
- Feed category: `session` (new) — pairs with launch/auth to bracket play sessions.

**A4. VR vs Desktop mode** — session metadata flag.
- VRCX: `ParseOpenVRInit` markers `Initializing VRSDK.` / `STEAMVR HMD Model: `; `ParseDesktopMode` marker `VR Disabled`.
- Real lines:
  ```
  OpenVR initialized!
  Initializing VRSDK.
  StartVRSDK: Open VR Loader
  STEAMVR HMD Model: Index
  VR Disabled
  ```
- Regex (single atom, two phases): `^(OpenVR initialized!|Initializing VRSDK\.|STEAMVR HMD Model: (.+?)|VR Disabled)\s*$`
- Captured: `mode` = `vr`|`desktop`, optional `hmd_model`. Reliability: **HIGH.** Note: VRCX's live `ParseOpenVRInit` only keys off `Initializing VRSDK.`/`STEAMVR HMD Model:` (its `OpenVR initialized!` is a stale comment) — prefer `Initializing VRSDK.` as the primary VR anchor and `VR Disabled` as the desktop anchor.
- Feed category: `session` metadata (low-frequency, attach to session row).

### TIER 2 — useful, confirmed, ship second

**A5. OSC failed to start.**
- VRCX: `ParseOscFailedToStart`, marker `Could not Start OSC: ` (Warning level).
- Real line: `Could not Start OSC: Address already in use`
- Regex: `Could not Start OSC: (.+?)\s*$` → `reason`. Reliability: **HIGH** (dated 2023.09.26).
- Feed category: `system`/`osc`.

**A6. Udon script exception.**
- VRCX: `ParseLogUdonException`, anchor ` ---> VRC.Udon.VM.UdonVMException: ` (Error level), plus a `[PyPyDance]` special-case.
- Real line:
  ```
  [UdonBehaviour] An exception occurred during Udon execution, this UdonBehaviour will be halted.
  VRC.Udon.VM.UdonVMException: An exception occurred in an UdonVM, execution will be halted. ---> VRC.Udon.VM.UdonVMException: ... ---> System.NullReferenceException: ...
  ```
- Regex: ` ---> VRC\.Udon\.VM\.UdonVMException: (.+)$` → `exception`. Reliability: **MEDIUM** — multi-line; the exception body is on a continuation line. VRCSM's `ParsedLogLine.has_prefix=false` continuation handling (LogAtoms.h:16) is the right hook. Noisy worlds (PyPyDance) flood this; gate behind a user toggle.
- Feed category: `system`/`error` (off by default in feed; on in Logs page).

**A7. Audio input device change.**
- VRCX: `ParseLogOnAudioConfigurationChanged`, markers `[Always] uSpeak: SetInputDevice 0` and `[Always] uSpeak: OnAudioConfigurationChanged`.
- Real lines:
  ```
  [Always] uSpeak: SetInputDevice 0 (2 total) 'Microphone (NVIDIA Broadcast)'
  [Always] uSpeak: OnAudioConfigurationChanged - devicesChanged = True, resetting mic..
  ```
- Regex: `\[Always\] uSpeak: SetInputDevice 0 \(\d+ total\) '(.+?)'\s*$` → `device_name`. Reliability: **HIGH** (dated 2025.01.03). VRCX dedups against `LastAudioDevice` — replicate with cross-line state (only emit on change).
- Feed category: `system`/`audio` (low value in feed; useful in diagnostics).

**A8. Instance reset warning.**
- VRCX: `ParseInstanceResetWarning`, marker `[ModerationManager] This instance will be reset in `.
- Real line: `[ModerationManager] This instance will be reset in 60 minutes due to its age.`
- Regex: `\[ModerationManager\] This instance will be reset in (\d+) minutes due to its age\.` → `minutes`. Reliability: **HIGH** (dated 2024.08.30).
- Feed category: `moderation` (reuse existing VoteKick/JoinBlocked moderation family).

**A9. Avatar pedestal change.**
- VRCX: `ParseLogAvatarPedestalChange`, marker `[Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for `.
- Real line: `[Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for User`
- Regex: `\[Network Processing\] RPC invoked SwitchAvatar on AvatarPedestal for (.+?)\s*$` → `display_name`. Reliability: **MEDIUM** (dated 2021.05.07, not re-confirmed in a 2024 sample but no rename observed).
- Feed category: `avatar`.

### TIER 3 — situational / lower priority

**A10. API fetch lines (avatar/world REST GET)** — enrichment source, not a feed event.
- VRCX: `ParseLogAPIRequest`, marker `[API] [<n>] Sending Get request to `.
- Real line: `[API] [110] Sending Get request to https://api.vrchat.cloud/api/1/worlds?...`
- Use: harvest `usr_`/`wrld_`/`avtr_` IDs seen in-session for offline enrichment. Noisy (every request). Reliability: HIGH but **do not surface in feed** — feed it into the enrichment map (§2).

**A11. String / Image download** (`ParseLogStringDownload`, `ParseLogImageDownload`) — low feed value; skip unless a consumer needs it.

**DO NOT IMPLEMENT — PhotonId (`ParseLogPhotonId`)**: this method is **entirely commented out in current VRCX** (the whole block is `// private bool ParseLogPhotonId`). VRChat's photon-id correlation is unreliable without the VRCX companion mod (confirmed by VRCX issue #317). Skip it.

---

## §2 — Cross-line enrichment (display-name → usr_ join)

VRCSM's `ParseVrchatLogAtom` is deliberately **stateless** (LogAtoms.h:56-57: *"batch parsers can add cross-line context later"*). That comment is the designed hook. The enrichment layer belongs in the **batch parser** (`LogParser.cpp` around the atom switch at line ~690-746), not in LogAtoms.

Mechanism (mirrors VRCX's `ParseUserInfo` + location/player state machine):
1. Maintain `std::map<std::string,std::string> nameToUserId` while iterating atoms in time order.
2. On `PlayerPresence` (OnPlayerJoined, which carries both display name AND `usr_` — LogAtoms.cpp:27-28), record `nameToUserId[name] = usr_id`.
3. Backfill `usr_` onto later atoms that carry **only** a display name: `AvatarSwitch` (`Switching <name> to avatar <x>`), `VoteKick` target, `AvatarPedestalChange` (A9). Sticker already carries `usr_` so it's exempt.
4. Reset the map on `WorldInstance`/world change (names are per-instance).

This is a pure win: it makes VRCSM's avatar/moderation feed rows clickable to a stable `usr_` id where VRCX leaves them as bare names. Note VRChat's `LastIndexOf(" (")` ambiguity for names containing `(` — VRCSM's `kPlayerJoinedRe` already handles the optional `(usr_…)` group correctly, so reuse that capture rather than re-splitting strings.

---

## §3 — Amplitude avatar-ID sourcing (VRC-LOG technique)

Verified from `ShayBox/VRC-LOG` source (commit `313f493`):

- **File path** (`src/vrchat.rs`): Windows `%Temp%\VRChat\VRChat\amplitude.cache` (Linux Proton path also defined). This replaced cache-file ripping because **"VRChat now encrypts local avatar cache files"** (README) — so `BundleSniff`/`__data` UnityFS parsing can no longer recover `avtr_` IDs. Amplitude is the current viable source.
- **Extraction** (`src/lib.rs` `parse_avatar_ids`): line-by-line regex
  ```
  avtr_\w{8}-\w{4}-\w{4}-\w{4}-\w{12}
  ```
  collected into a dedup `HashSet`. Watches files with extensions `csv|log|txt` plus the literal `amplitude.cache` (poll watcher, `with_compare_contents`).
- **Behavior**: VRChat "writes, uploads, writes again, uploads again, and clears it every time you switch worlds." VRC-LOG offers a `clear_amplitude` setting to wipe it post-read for privacy.

**Recommendation for VRCSM (read-only + TOS-noted):**
- Implement as a **read-only local scanner** in core (e.g. `AmplitudeProbe`), regex `avtr_[0-9a-fA-F]{8}-...`, dedup, **account-scoped cache only** (per CLAUDE.md account-scoping rule).
- **Hard boundary / TOS note**: VRC-LOG's purpose is to *upload* harvested IDs to third-party avatar-search providers (`Provider::send_avatar_id`). That is the part that draws ToS/ripping concern. VRCSM must **never upload** — keep IDs strictly local, read-only, for the user's own seen-avatar history/enrichment. Do NOT auto-clear the user's amplitude.cache by default (it's VRChat's analytics file; mutating it is a data-write the user didn't request — gate behind explicit opt-in per the no-mutation rule). Flag this in docs as analytics-file reading, not cache ripping.

---

## §4 — Emoji spawn: UNVERIFIED

**No stock `[EmojiManager]` log line could be confirmed.**
- VRCX `LogWatcher.cs` has **no** emoji parser — only `[StickersManager]` (`ParseStickerSpawn`). Grepped the full file: zero `Emoji`/`Emote` matches.
- VRChat Wiki confirms emojis are a real feature (Action Menu / Emoji Wing, managed in Inventory) and uses `inv_` inventory IDs like stickers, but **no public source documents an emoji spawn log line**.
- Inference (NOT verified): if VRChat logs emoji spawns at all, it would likely mirror stickers as `[<SomeManager>] User usr_… (<name>) spawned emoji …` — but I found **no real log sample** proving such a line exists, and VRCX (the most complete parser) does not parse one. **Treat emoji-spawn as UNVERIFIED — do not ship a regex against an invented signature.** Action: capture a real modern `output_log` while spawning an emoji to confirm the exact `[...]` tag before adding an atom. Until then, stickers are the only confirmed `inv_`-based spawn event.

---

## §5 — The 6 touch-points (verified from StickerSpawn trace)

For each Tier-1/2 atom, replicate exactly this path (file:line anchors confirmed):
1. **Regex + classifier** — `src/core/LogAtoms.cpp` (regex const ~line 57; `std::regex_search` branch ~line 405) + `LogAtomKind` enum in `src/core/LogAtoms.h:19-37`.
2. **Atom→event + to_json** — `src/core/LogEventClassifier.cpp:82` (`*FromAtom`) and switch case at `:153`.
3. **Report vector + to_json** — `src/core/LogParser.h` struct, `LogParser.cpp:166` (`to_json`), `:212` (report aggregation key), `:738` (batch switch case, guarded by `kMaxEventsPerKind`).
4. **Live persistence** — `src/host/bridges/LogsBridge.cpp:328` (kind allow-list) and `:370` (dispatch branch).
5. **DB unified feed** — `src/core/Database.cpp:4052` (schema v14 Track L `source_kind`/category).
6. **Frontend** — `web/src/lib/types.ts` (event type), `web/src/lib/feed.ts:33/48/62/87` (source_kind + category map), `web/src/pages/Feed.tsx:95/120/131` (icon/label/order), `web/src/pages/Logs.tsx` (timeline + filters).
7. **Golden test** — `tests/CommonTests.cpp` (pattern at `:1221` classifier test + `:1299` full-report disk test).

---

## §6 — Golden test lines (verbatim, modern format — for CommonTests.cpp)

```
2024.08.30 01:43:40 Log        -  [ModerationManager] This instance will be reset in 60 minutes due to its age.
2023.09.26 04:12:57 Warning    -  Could not Start OSC: Address already in use
2024.10.23 21:18:34 Log        -  VRCApplication: HandleApplicationQuit at 936.5161
2025.01.03 19:11:42 Log        -  [Always] uSpeak: SetInputDevice 0 (2 total) 'Microphone (NVIDIA Broadcast)'
2024.07.26 01:48:56 Log        -  STEAMVR HMD Model: Index
2023.04.22 16:54:18 Log        -  VR Disabled
2024.07.31 22:28:47 Error      -  [AVProVideo] Error: Loading failed.
2021.01.03 05:48:58 Log        -  [API] Received Notification: <Notification from username:pypy, sender user id:usr_4f76a584-9d4b-46f6-8209-8305eb683661 to of type: friendRequest, id: not_3a8f66eb-613c-4351-bee3-9980e6b5652c, created at: 01/14/2021 15:38:40 UTC, details: {{}}, type:friendRequest, m seen:False, message: ""> received at 01/02/2021 16:48:58 UTC
2022.11.29 04:27:33 Error      -  VRC.Udon.VM.UdonVMException: An exception occurred in an UdonVM, execution will be halted. ---> VRC.Udon.VM.UdonVMException: ... ---> System.NullReferenceException: Object reference not set to an instance of an object.
2021.05.07 10:48:19 Log        -  [Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for User
```
(Notification/Udon/pedestal lines carry older dates because those are the verbatim samples in VRCX's source comments; the markers are unchanged in the current client. Notification, OSC, quit, audio, instance-reset, HMD lines are from 2023-2025 VRCX samples and are confirmed modern.)

---

## Recommended max coverage

**16 → 25 atoms.** Ship Tier 1 (Notification, VideoError, AppQuit/session, VR/Desktop) + Tier 2 (OSC, Udon, AudioDevice, InstanceReset, PedestalChange). Add the cross-line enrichment layer (§2) and a read-only local Amplitude scanner (§3, no upload, opt-in, no file mutation). **Do not** ship PhotonId (dead in VRCX) or Emoji (UNVERIFIED — needs a captured real log line first). Notification (A1) is the single highest-value gap vs VRCX parity and should lead.