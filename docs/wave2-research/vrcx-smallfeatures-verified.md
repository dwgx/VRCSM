# VRCX Small-Feature Parity — Verified Implementation Spec

Scope: the remaining small QoL features from `vrcx-quickwins.md` that were NOT in the shipped
batch. Every VRCSM claim below cites a file:line I read in the current `main` working tree
(2026-06-29). VRCX claims rely on the keys already verified in `vrcx-quickwins.md` @ commit
`7e4f4b1` — no local VRCX clone exists (checked `D:\Project`, `D:\VRCX`, `D:\Project\*\VRCX`;
none present), so anything not in that doc is marked **UNVERIFIED**.

## Status of the "already shipped" set (spot-verified, skipped)
- #5 friended-on date — **NOT shipped** (see below; this was wrongly on the skip list).
- #6 hide-unfriends — shipped: pref `vrcsm.friendLog.hideUnfriends` read `FriendDetailDialog.tsx:216`, filter `:217-219`; Settings row `TabGeneral.tsx:413-424`.
- #8 show-instance-id — shipped: pref `vrcsm.privacy.showInstanceId` `TabGeneral.tsx:51,401-412`.
- #9 live occupant count — shipped: `instance.details` query `FriendDetailDialog.tsx:190-205`, rendered `:507-519`.
- #3 relativeTime i18n — shipped: `relativeTime` now uses `Intl.RelativeTimeFormat(i18n.language)` `vrcFriends.ts:229,263-265`.
- TTS / accessible-status / per-user color / sort / mutual-count / week-start / striped — **none exist** (`rg accessibleStatus|colorblind|sortFavorites|sortAlphabetical|striped|weekStart|mutualFriend|hashColor|userColor` → no matches across `web/src`). All genuinely missing.

NOTE on shared `ui-prefs` infra: `web/src/lib/ui-prefs.ts` already provides `useUiPrefBoolean`
(`:76`), `useUiPrefString` (`:44`), and `useUiPrefStringSet` (`:120`) with cross-tab + same-tab
change propagation. Every frontend pref below should reuse these — no new storage layer needed.

---

## 1. "Friended on / friends since" date — S, value MED, frontend-only

**Missing?** YES. `FriendDetailDialog.tsx` already queries the friend log
(`friendLog.forUser`, limit 15, `:208-214`) and renders a "Recent Activity" list
(`:698-729`) plus derived Avatar History (`:731-766`), but nowhere derives or shows a
"friends since" date. `eventDescription` handles `friend.added` → `"Became friends"`
(`:145`) but only as a row in the activity feed, never as a header field.

**Data shape (verified):** `friend_log` rows carry `friend.added` events.
`useFriendsPipelineSync.ts:160-167` inserts `{ event_type: "friend.added", occurred_at, ... }`
on the `friend-add` pipeline event. The query returns `FriendLogItem` =
`{ id, user_id, event_type, old_value, new_value, occurred_at }` (`FriendDetailDialog.tsx:115-122`).

**Caveat (must label honestly):** the date is only the earliest `friend.added` VRCSM ever
*observed* — friendships predating VRCSM logging have no row, and the dialog only pulls
`limit: 15` rows so an old `friend.added` may be paged out. Two implementation options:
- (a) Cheap: derive from `logData.items` already in memory — find the min `occurred_at`
  among `event_type === "friend.added"`. Accurate only if the add is within the last 15 rows.
- (b) Correct: add a tiny dedicated query. There is NO existing IPC that returns the single
  earliest friend.added row, so (a) is the zero-C++ path; (b) would need a new
  `friendLog.firstAdded` handler. Recommend (a) with an explicit "tracked since" label.

**Touch-points (option a, no C++):**
- `FriendDetailDialog.tsx` — after `logItems` is built (`:217-219`), derive
  `const friendedAt = (logData?.items ?? []).filter(i => i.event_type === "friend.added").reduce(min occurred_at)`.
- Render in the header near pronouns/status (`:348-358` name block, or just under the status
  line `:360-379`) as `t("friendDetail.friendsSince", { when: relativeTime(friendedAt) })`.
  `relativeTime` is already imported (`:63`).

**i18n keys:** `friendDetail.friendsSince` ("Friends since {{when}}" / "成为好友 {{when}}"),
`friendDetail.friendsSinceUnknown` ("Friendship date not tracked" / "好友时间未记录").
Insert in `en.json` friendDetail block (`:194-`) and `zh-CN.json` (`:149-`).

**VRCX evidence:** `dialog.user.info.friended` / `friend_number` (en.json) — cited in
`vrcx-quickwins.md:40,79`. Exact VRCX algorithm UNVERIFIED (no local clone).

---

## 2. TTS announcements — S/M, value MED, frontend-only

**Missing?** YES. No `speechSynthesis` anywhere (`rg speech|TTS` → no matches). Toasts are
raised host-side (Action Center) gated by `notify.setPrefs` (`notifications.ts:36-41`); the
only in-app `toast()` for live social events is the Stranger alert
(`useStrangerAlert.ts:146-149`). There is no frontend speech hook.

**Where social events arrive (verified):** the pipeline event bus
(`pipeline-events.ts:21-34`) exposes typed events incl. `friend-online`, `friend-active`,
`friend-add`, `notification`, `notification-v2`. `useFriendsPipelineSync.ts` already
subscribes to the friend events and writes friend_log; `NotificationsInbox.tsx:124-173`
subscribes to `notification` / `notification-v2` (invites, requests). These are the natural
trigger points.

**Existing pref pattern to mirror (verified):** toast prefs live in `notifications.ts:17-19`
as `vrcsm.notify.toast.*` localStorage keys, read via `readUiPrefBoolean`
(`notifications.ts:30-32`), with a Settings card "Desktop Notifications"
(`TabGeneral.tsx:556-619`). TTS should sit alongside as a sibling pref + Settings row.

**Touch-points (no C++):**
- New `web/src/lib/tts.ts` (mirror `notifications.ts`): export
  `TTS_PREF_ENABLED = "vrcsm.notify.tts.enabled"`, optional
  `TTS_PREF_WHEN = "vrcsm.notify.tts.when"` (string pref: `never|gameRunning|gameClosed|always`
  — VRCX `when_to_play` parity), and a `speak(text)` helper guarding `typeof window.speechSynthesis`.
- New hook `useTtsAnnounce()` subscribing to `friend-online` (and optionally `notification`)
  via `subscribePipelineEvent` (same pattern as `useStrangerAlert.ts:95-150`), gated by the
  pref + (if `when` set) `useVrcProcess()` running state (`vrc-context`, already imported in
  `App.tsx:32`). Mount in `App.tsx` next to `useStrangerAlert()` (`:139`).
- Settings: add a TTS card/rows in `TabGeneral.tsx` after the Desktop Notifications card
  (`:619`), using the same `useUiPrefBoolean` + Button toggle pattern (`:573-582`).
- Optional `use_memo_nicknames` parity: read the friend note first line (the inline-nickname
  data already wired in `Friends.tsx:499-506`) and speak it instead of displayName.

**i18n keys:** `settings.notify.tts.title`, `settings.notify.tts.label`,
`settings.notify.tts.desc`, and `when` option labels
(`settings.notify.tts.when.{never,gameRunning,gameClosed,always}`). en.json settings.notify
block + zh-CN.

**VRCX evidence:** `VRCX_notificationTTS` (default `'Never'`), values
`Never|Inside VR|Game Running|Game Closed|Always`; `VRCX_notificationTTSNickName`;
`VRCX_notificationTTSVoice` — verified in `vrcx-quickwins.md:146-147`. Voice-index selection
is OPTIONAL and lower value; defer unless asked.

---

## 3. Accessible status indicators — S, value MED, frontend-only

**Missing?** YES. Status dots are plain color-only circles in three places:
- `FriendDetailDialog.tsx` `statusDot()` `:103-111` → color-only Tailwind classes
  (`bg-emerald-400` etc.), rendered as a bare `<span … rounded-full>` `:341-344`.
- `ProfileCard.tsx` `statusDot()` `:64-72` (identical color-only switch), rendered `:367`.
- `Friends.tsx` list row uses a *trust-rank* dot, not status, `:153-157` (color = `trustDotColor`).
  The status itself shows as a text Badge `:513-520`, so the list is already partly
  shape/text-distinguishable; the color-only-dot problem is the detail dialog + ProfileCard.

No shape/pattern/aria differentiation exists for colorblind users (`rg accessibleStatus|colorblind`
→ none).

**Touch-points (no C++):**
- Centralize: the two `statusDot` helpers are duplicated. Add a shared
  `statusMeta(status)` in `web/src/lib/vrcFriends.ts` (next to `trustDotColor`/`statusBucket`)
  returning `{ colorClass, shape, label }` where `shape` ∈ a small glyph set
  (e.g. ● active, ◆ join-me, ▲ ask-me, ■ busy, ○ offline) so each status is distinct by shape.
- Gate behind a pref `vrcsm.a11y.statusShapes` (`useUiPrefBoolean`, default off) so the dot
  shows a tiny shape/letter overlay only when enabled; always add `title`/`aria-label`.
- Apply at `FriendDetailDialog.tsx:341-344` and `ProfileCard.tsx:367`. Optionally the
  ProfileCard status picker dots `:423`.
- Settings: an "Accessibility" toggle row in `TabGeneral.tsx` (same Button pattern).

**i18n keys:** `settings.general.statusShapes` + `…Hint`; per-status labels can reuse
existing `friends.bucket.*` (`en.json:447`).

**VRCX evidence:** `InterfaceTab accessibleStatusIndicators` — named in `vrcx-quickwins.md:150`.
Exact glyph set is OUR choice (VRCX's specific shapes UNVERIFIED).

---

## 4. Deterministic per-user color from user id — S, value LOW/MED, frontend-only

**Missing?** YES. No hashing-to-color helper exists (`rg hashColor|userColor|stringToColor|colorFor`
→ none). Display names in feeds/lists render with a single static foreground color:
- Feed row `Feed.tsx:163,173` (`text-[hsl(var(--foreground))]`).
- Friend row `Friends.tsx:493-498` (color is by *trust rank* via `trustColorClass(rank)`,
  not per-user identity).
- Instance roster `InstanceRoster.tsx:129,165` (`font-mono`, no color).

**Touch-points (no C++):**
- Add `userColor(userId: string): string` to `web/src/lib/vrcFriends.ts` — hash the id
  (simple 32-bit FNV/`charCodeAt` accumulate) → `hsl(${hue} 65% 60%)` with fixed S/L so it
  reads on the dark theme. Pure function, easy to unit-test (`vrcFriends` has no existing
  color-hash test).
- Gate behind pref `vrcsm.appearance.userColors` (`useUiPrefBoolean`, default off — VRCX's
  `randomUserColours` is opt-in). Apply as inline `style={{ color }}` at the three render
  sites above, but ONLY where it doesn't fight the trust-rank color (recommend: feed +
  instance roster yes; friend-list name no, since trust color is load-bearing there).
- Settings toggle row in `TabGeneral.tsx`.

**i18n keys:** `settings.general.userColors` + `…Hint`.

**VRCX evidence:** `randomUserColours` — named `vrcx-quickwins.md:153`. Hash algorithm is
OURS (VRCX's exact formula UNVERIFIED).

---

## 5. Sort options (favorites + instance users) — S, value MED, frontend-only

**Missing?** YES.
- Favorites/Library: `Library.tsx` `visibleItems` (`:445-460`) only filters; it never sorts —
  items render in raw DB order (`:789`). No `sort`/`localeCompare` on the favorites list
  (the only `localeCompare` is for tag-count ordering `:440-441`).
- Instance users: `InstanceRoster.tsx` live roster is
  `Array.from(livePlayers.values())` with no sort (`:109`), rendered as-is (`:123`). Recent
  events render in DB order (`:153`).
- (Friends list IS already sorted alphabetically within status buckets
  `Friends.tsx:1262-1264`, so that one's done.)

**Touch-points (no C++):**
- Library: add a sort pref `vrcsm.library.sort` (`useUiPrefString`, e.g.
  `added|name|type`) and a small select/segmented control in the Library header card
  (near the type filter buttons `:718`). Apply `.sort()` to `visibleItems` before render
  (`:445-460`) — `localeCompare(item.display_name)` for name, keep insertion order for "added".
- Instance roster: add `vrcsm.radar.roster.sortAlphabetical` (`useUiPrefBoolean`); when on,
  sort `liveList` by `displayName.localeCompare` before `:123`. Tiny.

**i18n keys:** `library.sort.{added,name,type}` + `library.sortLabel`;
`radar.rosterSortAlphabetical`. en.json `library`/`radar` blocks + zh-CN.

**VRCX evidence:** `sortFavorites`, `instanceUsersSortAlphabetical` — named
`vrcx-quickwins.md:154`. Exact option set UNVERIFIED.

---

## 6. Lower-value batch (spec briefly) — S each, value LOW

- **Mutual-friends count** — needs the set of mutual friends. VRCSM has a full friends list
  (`friends.list` cache) but no per-user mutual computation, and VRChat's API does not return
  a mutual list for arbitrary users, so this would only be computable for friends-of-friends
  we happen to cache. **Likely not feasible** for non-friends without new data; LOW value,
  recommend SKIP unless restricted to "friends you both have in your own list" (trivial set
  intersection, marginal value). UNVERIFIED whether VRCX has a data source we lack.
- **Week-starts-on** — pure display pref for any calendar/date grouping. VRCSM has
  `web/src/pages/Calendar.tsx`; add `vrcsm.locale.weekStart` (`useUiPrefString`, `sun|mon`)
  consumed wherever week boundaries are computed. Low effort, low impact. (Did not deep-read
  Calendar.tsx — confirm the week-grid construction site before implementing.)
- **Striped table / density** — pure CSS. Apply alternating-row backgrounds via
  `even:bg-…` and a compact-spacing variant, gated by `vrcsm.appearance.density`
  (`useUiPrefString`, `comfortable|compact`). Candidate surfaces: Feed list (`Feed.tsx:166`),
  instance roster (`InstanceRoster.tsx:124,154`), activity log (`FriendDetailDialog.tsx:709`).
  Cosmetic; lowest priority.

---

## Summary table

> **Update (post-research implementation pass):** #1 (friends-since), #3 (accessible
> status shapes), library sort, instance-roster alphabetical sort, and a prediction
> confidence badge are now **SHIPPED** (frontend-only, verified by `tsc`, full vitest
> suite 159+6 passing, and prod build). Status shapes live in `vrcFriends.ts`
> (`statusShape` / `statusShapeClass`, pref `vrcsm.a11y.statusShapes`), applied in
> `ProfileCard.tsx` + `FriendDetailDialog.tsx`, toggle in `TabGeneral.tsx`. Library sort
> is pref `vrcsm.library.sort` in `Library.tsx`. Roster sort is pref
> `vrcsm.radar.roster.sortAlphabetical` in `radar/InstanceRoster.tsx`.
>
> **Update 2 (2026-06-30 cut/add pass):** #2 TTS and #4 per-user color are now
> also **SHIPPED**, closing every feasible item in this table.
> - #4 per-user color: `web/src/lib/user-color.ts` (FNV-1a + golden-angle hue +
>   OKLCH lightness band + `ensureContrast` — deliberately beyond VRCX's plain
>   hash→HSL), pref `vrcsm.a11y.userColor`, applied `ProfileCard.tsx` +
>   `UserPopupBadge.tsx`, tested `__tests__/user-color.test.ts`.
> - #2 TTS: `web/src/lib/tts.ts` (`isTtsSupported`/`speak`/`useTtsAnnounce`),
>   prefs `vrcsm.notify.tts.enabled` + `vrcsm.notify.tts.scope`, mounted in
>   `App.tsx` beside `useStrangerAlert`, Settings rows in `TabGeneral.tsx`,
>   i18n `tts.*` + `settings.notify.tts*`, tested `__tests__/tts.test.ts`.
>   Frontend-only (WebView2 ships Web Speech). Verified: tsc clean, 199 vitest
>   pass, prod build clean.
>
> Remaining table items (#6 mutual-count / week-start / striped) are LOW value;
> see CUT list below for what is permanently dropped.
>
> **CUT — permanently dropped as infeasible / dead weight (code+API verified):**
> - **Friend timezone display** — VRChat API exposes no timezone field; VRCX
>   infers none (`vrcx-quickwins.md:166`). Nothing to surface.
> - **Recent-action / destructive-button cooldown** — advisory-only in VRCX, no
>   real safety value here; we already confirm destructive IPC host-side.
> - **VRCX-style scraper avatar-DB providers** — depend on third-party scraped
>   databases outside our data ownership boundary; out of scope.
> - **Confirmed-edge friends-of-friends graph** — needs the unverified
>   `/users/{id}/mutuals/friends` endpoint; superseded by the co-presence graph
>   (EXTEND, built from data we already persist).
>
> **EXTEND — our own algorithms beyond VRCX:** online-window predictor (SHIPPED,
> `friendPresence.predict`), perceptual per-user color (SHIPPED, `user-color.ts`),
> co-presence relationship graph (DESIGNED, unbuilt — `player_encounters` +
> `db.playerEncounters` IPC already exist; only aggregation + SVG ego-network
> remain. Highest-value open original work).

| # | Feature | Missing? | C++? | Effort | Value | Primary VRCSM touch-point |
|---|---|---|---|---|---|---|
| 1 | Friends-since date | YES | No | S | Med | `FriendDetailDialog.tsx:208-219,348-379` |
| 2 | TTS announcements | YES | No | S/M | Med | new `lib/tts.ts` + hook in `App.tsx:139`; `TabGeneral.tsx:619` |
| 3 | Accessible status shapes | YES | No | S | Med | `vrcFriends.ts` + `FriendDetailDialog.tsx:341`, `ProfileCard.tsx:367` |
| 4 | Per-user color | YES | No | S | Low/Med | `vrcFriends.ts` + `Feed.tsx:173`, `InstanceRoster.tsx:129` |
| 5 | Sort favorites / roster | YES | No | S | Med | `Library.tsx:445-460,718`; `InstanceRoster.tsx:109,123` |
| 6 | Mutual count / week-start / striped | YES | No | S | Low | see §6 |

All six are frontend-only. None require C++ or IPC changes — every needed data source
(friend_log query, pipeline event bus, friends/favorites caches, ui-prefs store) already
exists in the tree. Recommended order: 1, 5, 3 (clear wins), then 2, then 4, then 6.

## Confidence / caveats
- All "missing" claims are code-verified against the current `main` tree at the cited
  file:line (read this session), not from docs.
- VRCX config-key claims are reproduced from `vrcx-quickwins.md` @ `7e4f4b1`; I could not
  re-verify them (no local VRCX clone). Items flagged UNVERIFIED are where VRCX's exact
  algorithm/option-set is not pinned in that doc — for those, the spec uses VRCSM-native
  choices (hash formula, glyph set, sort options) rather than guessing VRCX internals.
- Feature 6 mutual-friends-count is the one with a real feasibility question (data source);
  the rest are straightforward UI + ui-pref work.
