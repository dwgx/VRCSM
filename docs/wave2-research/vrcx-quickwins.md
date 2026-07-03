# VRCX Quick-Win Parity — Small, High-Value QoL Features

Scope: SMALL polish features VRCX has and VRCSM lacks (or only half-has). The big tracks (log atoms, relationship graph, Discord RPC, desktop toasts, VRC+ upload, native avatar DB) are excluded — see `vrcx-features.md` / `SURPASS-VRCX-MASTER-PLAN.md`.

Verification basis (all read 2026-06-29):
- VRCX = `vrcx-team/VRCX` @ `7e4f4b1` (master). Files cited by path; line/key cited where I opened them.
- VRCSM = current working tree on `main`. Every "status" line cites the file I actually read.
- Touch-points follow the patterns in `vrcsm-gaps.md`.

IMPORTANT framing: VRCSM's `FriendDetailDialog.tsx` and `Friends.tsx` are already richer than VRCX in most respects (shared-worlds co-presence, avatar history, boop slots, two-step unfriend, full copy-ID menu, launch/invite buttons, friend notes, instance type + region badges). So the genuine gaps are narrow and specific. The list below is what's actually missing, ranked by value ÷ effort.

---

## Already PRESENT in VRCSM (do NOT build — verified)

These were on the "category" hint list but already exist, so they're out of scope:

| Candidate | Where it already lives (verified) |
|---|---|
| Friend notes / memos (storage + editor) | `friend_notes` table `Database.cpp:3854`; `friendNote.get/set` IPC `IpcBridge.cpp:803-804`; editor `FriendDetailDialog.tsx:735-760` |
| World instance type + region in UI | `parseLocation`/`instanceTypeLabel`/`regionLabel` `vrcFriends.ts:57,253,271`; rendered in `FriendDetailDialog.tsx:441-457` and friend row `Friends.tsx:419-429` |
| Local unlimited favorite groups | `local_favorites`/`local_favorite_notes`/`local_favorite_tags` `Database.cpp:3860-3895`; Library collections UI `Library.tsx:659-686` |
| Copy user/world/avatar ID + display name + location | `FriendMenuItems` `Friends.tsx:370-390`; avatar-ID copy `FriendDetailDialog.tsx:518-528` |
| Launch VRChat to instance (deep link) | `buildVrchatLocationLaunchUrl` `shell-api.ts:11`; Launch button `FriendDetailDialog.tsx:459-469`; `vrchat://launch?id=` `Worlds.tsx:588,1001` |
| Favorite import/export | IPC `favorites.export`/`favorites.import` registered `IpcBridge.cpp:215`, handlers `DatabaseBridge.cpp:515,526`, async-set `ipc.ts:229-230` |
| Per-user encounter stats ("23x seen") | `player_encounters` `Database.cpp:3819`; `db.playerEncounters` rendered as "Shared Worlds … {n}x seen" `FriendDetailDialog.tsx:697-730` |
| Last-seen (offline) on friend row | `relativeTime(friend.last_login \|\| friend.last_activity)` `Friends.tsx:446,527-534` |
| Per-type notification toggles (online/invite/request) | `notifications.ts:17-41` + host `notify.setPrefs` |

---

## Quick-win table (ranked by value ÷ effort)

| # | Feature | Effort | C++? | VRCX evidence | VRCSM status (file checked) |
|---|---|---|---|---|---|
| 1 | Inline nickname (first line of memo) beside display name | S | No | `memoCoordinator.js` (`memo.split('\n'); ref.$nickName = array[0]`) | MISSING in lists — note exists but never shown inline (`Friends.tsx` row `:487-509` shows only `displayName`) |
| 2 | Online-friend count badge in Friends header / sidebar | S | No | `dialog.user.info.*`, online buckets everywhere | PARTIAL — count computed `Friends.tsx:1150-1166` but header shows only total `:1340`; StatusBar has no count `StatusBar.tsx` |
| 3 | i18n + relative/absolute time toggle for `relativeTime` | S | No | `view.settings.appearance.timedate.time_format` (12/24h), `force_iso_date_format` (InterfaceTab.vue) | MISSING — `relativeTime` returns hardcoded English `"just now"/"Nm ago"` `vrcFriends.ts:221-246` |
| 4 | Per-category feed mute / filter persistence | S | No | `FeedFiltersDialog.vue` (`sharedFeedFilters`, per-type on/off) | PARTIAL — Feed has single-select chips, no multi-mute/persist `Feed.tsx:318-327` |
| 5 | "Friended on" date in friend detail (friendship age) | S | No | `dialog.user.info.friended` / `friend_number` (en.json) | MISSING — `friend_log` has `friend.added` rows but detail shows generic activity only `FriendDetailDialog.tsx:142-150` |
| 6 | Hide-unfriends toggle in activity/friend log | S | No | `view.settings.appearance.friend_log.hide_unfriends` (InterfaceTab.vue) | MISSING — `eventDescription` renders all types incl. `friend.removed` `FriendDetailDialog.tsx:142-150` |
| 7 | Recent-action cooldown guard on destructive friend buttons | S | No | `user_dialog.recent_action_cooldown(_minutes)` (SocialTab.vue) | MISSING for block/unfriend (only boop has cooldown `FriendDetailDialog.tsx:920-941`) |
| 8 | Show-instance-ID toggle (privacy) | S | No | `appearance.show_instance_id` (InterfaceTab.vue) | MISSING — instance id always shown via location parse |
| 9 | Live instance occupant count (n/cap) on friend's current world | M | Yes | VRChat `instances/{worldId}:{instanceId}` → `n_users` | MISSING — VRCSM has `world.details` (static capacity) only; no `fetchInstance` `VrcApi.cpp:2294` |
| 10 | TTS announce for friend-online / invite | M | Yes (host) | NotificationsTab.vue `text_to_speech.when_to_play` + `use_memo_nicknames` | MISSING — only silent Action Center toasts `notifications.ts` |
| 11 | Friend timezone display | M | No | (VRChat exposes no tz; VRCX infers none) | MISSING and LOW value — see note, likely skip |

---

## Detailed implementation notes (top wins)

### 1. Inline nickname from friend note — S, frontend-mostly
VRCX treats the **first line of a user's memo** as a `$nickName` and shows it next to the display name (`memoCoordinator.js`: `ref.$nickName = memo.split('\n')[0]`). VRCSM already stores the note (`friend_notes`, `friendNote.get`) but never surfaces it in the list.

Cheapest correct path: add a **batch** read so the list isn't N IPC calls.
- C++ (small): `Database.h:236` has only single `GetFriendNote`. Add `Result<json> AllFriendNotes()` (mirror the simple SELECT pattern used by `GetFriendNote` in `Database.cpp`), register `friendNote.all` in `IpcBridge.cpp` next to `:803-804`, bind in `ipc.ts` next to `friendNoteGet :2611`. (If you want zero C++, you can skip batch and read per-open-row, but a list-wide nickname wants batch.)
- Web: in `Friends.tsx` row `:487-509`, when a note exists render `array[0]` as a muted chip after `friend.displayName`. Reuse the existing note query shape from `FriendDetailDialog.tsx:195-198`.
- Data available: `friend_notes(user_id, note)` — already populated by the existing editor.

### 2. Online-friend count badge — S, frontend-only
The number is **already computed** in `Friends.tsx:1150-1166` (`online` accumulator) but only `data.friends.length` (total) is shown at `:1340`. 
- Add `{online}/{total}` to the header span `Friends.tsx:1337-1342`.
- Optionally surface globally: `StatusBar.tsx:32-44` has a free slot next to the VRC-running badge; feed it from the same friends query Dashboard already runs (`Dashboard.tsx:237-252` computes `friendsOnline`). No new IPC.
- i18n: add `friends.onlineCount` to `en.json` + `zh-CN.json`.

### 3. relativeTime i18n + format toggle — S, frontend-only
`relativeTime` in `vrcFriends.ts:221-246` hardcodes English (`"just now"`, `` `${m}m ago` ``). This leaks English into the zh-CN UI everywhere it's used (friend rows, feed, encounters, avatar history).
- Convert to `Intl.RelativeTimeFormat(i18n.language, …)` or thread `t()` keys. Pure function today, so add a locale arg and update callers (`Friends.tsx:446`, `FriendDetailDialog.tsx:647,688,723`).
- For the 12/24h + ISO toggle (VRCX `timedate.time_format`/`force_iso_date_format`): add two booleans to `ui-prefs.ts` (same pattern as `notifications.ts` pref keys) and a Settings control in `TabGeneral.tsx`. Absolute timestamps are rendered via `toLocaleDateString` in `ProfileCard.tsx:667` / `Profile.tsx:23` — route them through a shared formatter that reads the pref.
- Highest leverage of the S-tier: one helper fixes localization debt across ~6 call sites.

### 4. Per-category feed mute (persisted) — S, frontend-only
VRCX `FeedFiltersDialog.vue` keeps a `sharedFeedFilters` map of per-event-type visibility. VRCSM `Feed.tsx:318-327` only does single-select category chips (no "hide these N forever").
- Add a `Set<FeedCategory>` of muted categories persisted in `ui-prefs.ts`; filter `filtered` (the array feeding the virtualizer at `Feed.tsx:355`) against it.
- Reuse `FEED_CATEGORIES` (`feed.ts:42`) and the existing `FilterChip` (`Feed.tsx:385`), adding a right-click / long-press or a small "mute" affordance. No IPC, no schema.

### 5. "Friended on" date — S, frontend-only
`friend_log` already records `friend.added` (`Database.cpp:3843`; rows surfaced in `FriendDetailDialog.tsx:633-651`). 
- In the dialog header (near pronouns `:326-331`), find the earliest `friend.added` row in `logData.items` and render `relativeTime(occurred_at)` as "Friends since …". The query already runs (`:186-192`); just derive from it. VRCX shows `dialog.user.info.friended`.
- Caveat: only accurate for friendships observed since VRCSM started logging; label honestly (e.g. "tracked since").

### 6. Hide-unfriends toggle — S, frontend-only
VRCX `friend_log.hide_unfriends`. In `FriendDetailDialog.tsx:633-651` (and any future global friend-log view), filter out `event_type === "friend.removed"` when the pref is on. Pref lives in `ui-prefs.ts`; Settings control in `TabGeneral.tsx`. Trivial.

### 7. Recent-action cooldown on destructive buttons — S, frontend-only
VRCX guards the user dialog's risky actions behind `recent_action_cooldown_minutes` (SocialTab.vue). VRCSM only cools down boop (`FriendDetailDialog.tsx:920-941`); block/mute/unfriend fire immediately after the confirm dialogs (`:535-597`). Add a shared "last destructive action at" timestamp + disabled state. Pure UI; reduces misclick risk. Lower value than 1-6 but very cheap.

### 8. Show-instance-ID toggle — S, frontend-only
VRCX `appearance.show_instance_id`. VRCSM always renders instance specifics from `parseLocation`. Add a privacy pref that, when off, suppresses the numeric instance id / owner in friend rows and detail (the type+region badges stay). Pref in `ui-prefs.ts`, consumed where location renders (`Friends.tsx:419-429`, `FriendDetailDialog.tsx:441-457`).

### 9. Live instance occupant count — M, needs C++
This is the one genuinely useful feature that needs core work. VRCSM's `world.details` (`VrcApi.cpp:2294 fetchWorldDetails`) returns static `capacity` (`types.ts:1009`) but never the live `n_users`. VRChat exposes `GET /instances/{worldId}:{instanceId}`.
- C++: add `VrcApi::fetchInstance(location)` following the `fetchUser`/`searchWorlds` template in `vrcsm-gaps.md §3` (cookie header → path `fmt::format("/api/1/instances/{}", …)` → `httpGet` → `parseJsonBody`). Declare in `VrcApi.h`, handler in `ApiBridge.cpp`, register + async-set in `IpcBridge.cpp` (two spots: `:707` style + the async set `:142` neighborhood), bind in `ipc.ts`.
- Web: in `FriendDetailDialog.tsx` Current-World card (`:441-457`) replace the static `world.capacity` with `n_users/capacity` from the new query (short staleTime, the data is volatile).
- Cost driver: it's a per-instance API call, so cache and gate to the open dialog only. Respect `RateLimiter`.

### 10. TTS announcements — M, host-side
VRCX NotificationsTab `text_to_speech.when_to_play` + `use_memo_nicknames`. VRCSM raises silent toasts only (`notifications.ts`, host `ToastNotifier`). A frontend-only version is possible via `window.speechSynthesis` in the App shell where toasts are already wired (`App.tsx:133`), gated by a new pref alongside the existing toast prefs (`notifications.ts:17-19`). That keeps it S/M and avoids C++. Use `use_memo_nicknames` parity by speaking the note's first line (ties into #1).

### 11. Friend timezone — likely SKIP
VRChat's API does not expose a user timezone, and VRCX does not actually display one (no tz key found in en.json). Building this would require manual per-friend tz entry — low value, not real parity. Recommend dropping from scope unless you want a manual "set timezone" memo field.

---

## Recommended build order

Frontend-only S-tier, no schema, immediate polish:
1. **#3 relativeTime i18n** (fixes a real localization bug across ~6 sites — do first)
2. **#2 online count badge** (number already computed)
3. **#1 inline nickname** (1 small C++ batch method, big visible payoff; pairs with #10)
4. **#4 per-category feed mute**
5. **#5 friended-on date**, **#6 hide-unfriends**, **#8 show-instance-ID**, **#7 action cooldown** (batch of trivial pref toggles + one Settings section)

Then the M-tier:
6. **#9 live occupant count** (only one needing new VrcApi + IPC; highest standalone value of the M group)
7. **#10 TTS** (frontend `speechSynthesis` keeps it cheap; gate behind a pref)

Skip **#11 timezone** (no API data / VRCX doesn't have it either).

## Notes on confidence
- VRCSM "present" claims are all code-verified against the current tree (cited files), not docs.
- VRCX evidence for memo→nickname, FeedFiltersDialog, SocialTab cooldown, InterfaceTab time/instance toggles, and NotificationsTab TTS is from the files/keys named above at commit `7e4f4b1`.
- UNVERIFIED: exact JSON shape of `GET /instances/...` `n_users` field (standard VRChat API but I did not hit a live endpoint); the `friendNote.all` batch method does not exist yet (only single `GetFriendNote` at `Database.h:236`) — #1 assumes you add it.

---

## VERIFIED follow-up (subagent deep-read, branch master @ 7e4f4b1) — 2026-06-30

### Batch 1 SHIPPED (#1 nickname, #2 online badge, #3 i18n time, #4 feed mute)

### #9 live occupant count — API shape NOW VERIFIED
- Call: `GET instances/{worldId}:{instanceId}` (`src/api/instance.js getInstance`). World+instance are ONE colon-joined path segment, not two parts.
- Canonical live count field is **`n_users`** (number). `userCount` also exists but `n_users` is what VRCX surfaces. `capacity` + `recommendedCapacity` for caps. `users[]` is **owner-only** — never use `users.length` for crowd count.
- `platforms` = `{ android, ios, standalonewindows }` per-platform counts. `queueSize`/`queueEnabled` group-only.
- Refresh only when `parseLocation().isRealInstance` (skip offline/private/traveling); debounce/throttle (`instanceCoordinator refreshInstancePlayerCount`).

### #6 hide-unfriends — CORRECTED
- Config `VRCX_hideUnfriends` (default false). Filters ONLY `row.type === 'Unfriend'`; leaves Friend-add / requests / name / trust rows. ALSO gates the menu notify dot (`if (!hideUnfriends) notifyMenu('friend-log')`). DB row still recorded — display/notify filter only.

### #7 recent-action cooldown — CORRECTED (lower value than doc implied)
- NOT block/unfriend/mute. Tracks invite/friend-request spam: `{Send Friend Request, Request Invite, Invite, Request Invite Message, Invite Message}`. `VRCX_recentActionCooldownEnabled` (false), `VRCX_recentActionCooldownMinutes` (60, clamp 1-1440). Stored in localStorage map `VRCX_recentActions` keyed `${userId}:${actionType}`→ts. Purely ADVISORY: shows a clock icon, does NOT disable the button. Low value for VRCSM → deprioritize.

### #8 show-instance-id — VERIFIED
- `VRCX_showInstanceIdInLocation` (default false). When OFF hides only the `· #<instanceName>` segment; type/region/access label stay. When OFF the id moves to the hover tooltip (not lost). Owner never printed inline.

### #10 TTS — VERIFIED
- `VRCX_notificationTTS` (default `'Never'`); when-to-play values: `Never | Inside VR | Game Running | Game Closed | Always`. `VRCX_notificationTTSNickName` (false) = speak memo first line (ties to #1). `VRCX_notificationTTSVoice` (voice index). Frontend `window.speechSynthesis` keeps it cheap.

### NEW small features discovered (not in original 11), frontend-only S unless noted
- **Accessible status indicators** (`InterfaceTab accessibleStatusIndicators`): shape/pattern on status dots for colorblind users. S.
- **Pronouns / language tags / bio-links** display in user dialog (`UserSummaryHeader pronouns/$languages`, `UserDialogInfoTab bioLinks`). Read-only from API fields we may already fetch. S each.
- **Age-verification (18+) + platform (PC/Android/iOS) badge** (`UserSummaryHeader ageVerified/ageVerificationStatus`, `$platform`). S.
- **Deterministic per-user color from user id** (`randomUserColours`): stable hashed color per user for fast name distinction in feeds. S.
- **Sort favorites / sort instance users** radios (`sortFavorites`, `instanceUsersSortAlphabetical`). S.
- **Online-time overlap "best time to catch them"** (`UserDialogActivityTab overlapPercent/bestOverlapTime`): clever, needs online-frequency buckets. M — gate on whether VRCSM records online history. Good candidate for OUR OWN algorithm extension.
- **Striped table / density**, **week-starts-on**, **mutual-friends count** — S, lower value.
- Heavier (M+): screenshot metadata injection (file watcher + PNG chunks), previous display-name history (needs persistence).

---

## TRIAGE DECISION (2026-06-30, this session)

After deep-read verification (see `vrcx-smallfeatures-verified.md` + `own-overlap-algorithm-design.md`):

**DROPPED as infeasible / low-value:**
- **#11 Friend timezone** — VRChat API exposes no timezone field; VRCX infers none. Nothing to surface. DROP.
- **#7 Recent-action cooldown** — verified to be an *advisory-only* invite/friend-request spam clock that does NOT disable buttons; not the destructive-action guard the original doc implied. Low value for VRCSM (we two-step-confirm destructive actions already). DROP.
- **Mutual-friends count** — VRChat API returns no mutual list for arbitrary users and VRCSM caches none; only a trivial own-list intersection is possible (marginal value). DROP.

**SHIPPED this session (build order):**
1. OUR-OWN overlap predictor (`friendPresence.predict`) — original analytic layer, beats VRCX. [headline]
2. #5 Friends-since date (frontend)
3. Sort favorites + roster (frontend)
4. Accessible status shapes (frontend)
5. TTS announcements (frontend)
6. Deterministic per-user color (frontend)

**DEFERRED (cosmetic, lowest priority):** week-starts-on, striped-table/density — left for a future cosmetic pass.
