# Review 2026-07 — Area: web-pages

Scope: `web/src/pages/**` + `web/src/components/**`. Read-only review of the new
ActivityHeatmap / EntityLink / RelationshipGraph / StatusBar / ProfileCard /
FriendDetailDialog / NotificationsInbox components and the
Friends/Radar/SocialGraph/VrchatWorkspace/WorldHistory/Logs/Avatars/Library page
changes in the current dirty working tree.

Verification baseline: `npx tsc -b` passes clean (EXIT 0). All line numbers below
were read from disk at review time.

---

## CRITICAL

None found.

---

## HIGH

None found.

The two correctness-sensitive new pieces — the ActivityHeatmap day/hour indexing
and the RelationshipGraph force layout — were checked against their data sources
and are correct:

- `ActivityHeatmap` builds `byDayHour` keyed by `cell.day * 24 + cell.hour`
  (`web/src/components/ActivityHeatmap.tsx:57-60`) and reads it back with the same
  key while rendering `DISPLAY_ORDER` rows (`:105`). `buildHeatmapModel` produces
  exactly 7×24 cells in row-major `day,hour` order
  (`web/src/lib/activity-heatmap.ts:99-115`), and the host emits a 7×24
  `[day][hour]` matrix (`src/core/Database.cpp:3622-3633`). Indexing is consistent
  end to end.
- `RelationshipGraph.layout()` runs a fixed 220-iteration deterministic sim with
  no `Math.random`, memoized on `graph` identity
  (`web/src/components/RelationshipGraph.tsx:67-126,133`), so there is no render
  loop and the smoke tests stay stable. Edge/node lookups guard missing ids
  (`:97,:163-165`).

---

## MEDIUM

### M1. Logs filter labels are hardcoded English, never localized
`web/src/pages/Logs.tsx:658-670` defines `FILTER_LABELS` as literal English
strings ("Players", "Avatars", … "Diagnostics") and they are rendered directly at
`web/src/pages/Logs.tsx:1393` (`{FILTER_LABELS[key]}`) with no `t()` call. The
three new filter buckets added in this change (`notifications`, `session`,
`diagnostic` — diff lines 515-517) inherit the same problem.

- Impact: the entire Logs filter toggle row shows English in the zh-CN locale,
  inconsistent with the rest of the app which is fully translated. This is
  pre-existing for the original 8 buckets but the change extends it to 11 without
  fixing it.
- Fix: replace the static map with `t("logs.filter.<key>")` lookups (keys already
  follow a clean enum) and add the 11 entries to both `en.json` and `zh-CN.json`.

### M2. FriendDetailDialog activity descriptions are hardcoded English
`web/src/components/FriendDetailDialog.tsx:150-159` `eventDescription()` returns
literal English ("Became friends", "Unfriended", `Status: … → …`, `Moved to …`,
`Avatar → …`). It is rendered in the Recent Activity list at
`web/src/components/FriendDetailDialog.tsx:839`. The surrounding section headers
*are* localized via `t()` (`:826,:850`), so the mixed output is visible: localized
header, English event rows.

- Impact: zh-CN users see English activity text inside an otherwise translated
  dialog. (Pre-existing function, but it sits squarely in the new/heavily-edited
  FriendDetailDialog under review.)
- Fix: route each branch through `t("friendDetail.event.<type>", { old, new })`
  with interpolation, and add keys to both locales.

### M3. `friends.totalCount` lacks a singular form for the new online tally line
`web/src/pages/Friends.tsx:1383-1385` renders `{viewCounts.online} / {t("friends.totalCount", {count})}`.
`friends.totalCount` only exists as `totalCount_one`/`totalCount_other`
(`web/src/i18n/locales/en.json:451-452`) — i18next pluralization resolves this
correctly, so this is *not* a missing-key bug. Verified all other new keys
(`worldHistory.heatmap.*`, `statusBar.onlineCount`, `worldHistory.rejoin*`,
`feed.tab`, `gameLog.tab`, `dock.*`, `radar.rosterSortAlphabetical`,
`socialGraph.tabGraph/graphTitle`, `library.officialSyncSuccessGrouped`) are
present in BOTH en.json and zh-CN.json.

- Real issue: the `statusBar.onlineCount` tooltip string
  (`web/src/i18n/locales/en.json:826` = `"{{count}} friends online"`) has no
  `_one` form, so it reads "1 friends online" at count 1.
- Impact: minor grammatical glitch in a `title` tooltip only.
- Fix: add `statusBar.onlineCount_one` / `_other` (and zh-CN is count-invariant so
  no change needed there).

### M4. ActivityHeatmap returns `null` during load with no skeleton
`web/src/components/ActivityHeatmap.tsx:40` returns `null` while `isLoading`,
then the card pops in once data resolves. Every sibling panel on WorldHistory
renders a card frame immediately.

- Impact: layout shift / flash on the World History page when the heatmap query
  resolves. Cosmetic, not a correctness bug.
- Fix: render the `Card` shell with a fixed-height placeholder grid during load
  instead of returning `null`.

### M5. RelationshipGraph `onSelect` is wired but never provided; nodes look clickable but do nothing
`RelationshipGraph` exposes `onSelect?: (userId) => void` and binds it to each
node's `onClick` with `role="button"` + `cursor: pointer`
(`web/src/components/RelationshipGraph.tsx:200-203`,`:197`). The only caller,
SocialGraph, renders `<RelationshipGraph graph={graph} />` with no `onSelect`
(`web/src/pages/SocialGraph.tsx:165`).

- Impact: every node advertises itself as a button (pointer cursor, button role,
  aria-label) but clicking is a no-op — an accessibility/affordance mismatch.
  Keyboard users get a focusable-looking control that does nothing.
- Fix: either pass an `onSelect` that opens the user popup/detail (consistent with
  EntityLink behavior elsewhere), or drop `role="button"`/`cursor-pointer` when no
  handler is supplied.

---

## LOW

### L1. Dead `svgRef` in RelationshipGraph
`web/src/components/RelationshipGraph.tsx:131` creates `svgRef` and attaches it at
`:154`, but it is never read (no `.current` access anywhere in the file). Harmless
but dead code — remove the ref or wire the intended behavior.

### L2. Index-based React keys in several new/edited lists
`web/src/components/FriendDetailDialog.tsx:503` (bioLinks), `:787` (prediction
windows), `:876` (avatar history), `:905` (name history); `ProfileCard.tsx:532,
:569, :608`. These render from arrays that can reorder/dedupe (e.g. avatar history
is filtered for uniqueness at `:861-865`), so positional keys can cause stale DOM
on data change. Low impact because the lists are short and mostly static per
render; prefer a stable id (`ev.new_value`, `entry.name`, the url string) where
available.

### L3. `EntityLink` renders inferred-user badges for self-id in encounter ranking
`web/src/pages/SocialGraph.tsx:232` passes raw `f.user_id` to `EntityLink`. Self
is filtered out of the ranking aggregation (`:70`), so this is fine in practice;
noting only that `EntityLink`'s fallback path (`EntityLink.tsx:57-60`) silently
degrades unknown ids to plain text, which is the correct defensive behavior.

### L4. NotificationsInbox mark-seen effect intentionally omits `items` from deps
`web/src/components/NotificationsInbox.tsx:198-205` reads `items` but lists only
`[open]` with an `eslint-disable`. This is deliberate (fire-once-on-open) and the
optimistic update + `Promise.allSettled` swallow is reasonable, but if a new
unread notification arrives while the drawer is already open it won't be marked
seen until the next open. Acceptable; documenting the trade-off.

### L5. Avatars row button-in-button fix is correct and worth highlighting
`web/src/pages/Avatars.tsx:1241-1268` correctly converts the outer row from
`<button>` to `role="button"` div with `tabIndex={0}` + Enter/Space handling to
avoid nested-button invalid HTML. Good a11y-preserving fix. No action needed.

---

## Supplemental pass (second reviewer) — Friends polling, InstanceRoster, SocialGraph

These items were not covered above; verified against disk at review time.

### M6. Friends live poll can overwrite pipeline-merged presence updates
`web/src/pages/Friends.tsx:1147-1152` guards a stale poll by keeping `prev` only
when `(prev as any).__polledAt > started`. But `__polledAt` is stamped *only* on
poll results (`:1151`). Pipeline events flow through `applyFriendPipelineEvent`
(`web/src/lib/friends-pipeline.ts:36-39`), which spreads a fresh object carrying
**no `__polledAt`**. So right after a pipeline event merges mid-poll,
`prev.__polledAt` is `undefined`, `undefined > started` is `false`, and the
in-flight (older) poll result replaces the newer pipeline state.

- Impact: a real-time location/status update arriving while a `friends.list`
  poll is in flight is reverted to the older polled value until the next pipeline
  event. The inline comment at `:1148-1150` claims this race is handled; it is
  not. Self-heals on the next event, hence MEDIUM not HIGH.
- Fix: keep a `lastMergeAtRef` updated in the pipeline effect and discard any
  poll whose `started < lastMergeAtRef.current`; or have
  `applyFriendPipelineEvent` carry forward a monotonic version on every merge.

### M7. InstanceRoster re-subscribes its pipeline handler on every render
`web/src/pages/radar/InstanceRoster.tsx:89` calls
`usePipelineEvent("user-location", (content) => {...})` with a fresh inline arrow
each render. `usePipelineEvent` lists `handler` in its effect deps
(`web/src/lib/pipeline-events.ts:75`), and its JSDoc explicitly tells callers to
memoize the handler. This component re-renders frequently (it drives
`setLivePlayers`/`setRecentEvents`), so the subscription is torn down and
recreated on every commit.

- Impact: subscribe/unsubscribe churn on a hot live-event path. No event loss
  (cleanup+setup run synchronously at commit), but wasteful and fragile.
- Fix: wrap the handler in `useCallback` (its only dependency, `setLivePlayers`,
  is stable) so the subscription is created once.

### M8. SocialGraph swallows all load errors with no error UI
`web/src/pages/SocialGraph.tsx:93-96` wraps the entire fetch sequence in
`try { ... } catch {}` with an empty catch (only `setLoading(false)` in
`finally`). A genuine `dbWorldVisits`/`dbPlayerEvents`/`dbCoPresenceGraph`
failure is indistinguishable from "no data yet" — the empty-state copy shows in
both cases. Contrast `WorldHistory.tsx:195-201`, which surfaces query errors.

- Impact: DB/IPC failures look identical to an empty database; no message, no
  retry hint.
- Fix: add an `error` state, render a small error banner, and reserve the
  empty-state copy for the genuinely-empty case.

### L6. RelationshipGraph recomputes neighbor lookup O(nodes×edges) per hover
`web/src/components/RelationshipGraph.tsx:189-192` runs `graph.edges.some(...)`
inside the node `.map` for the `dim` flag. Hover sets `hovered` state (`:198`),
re-rendering the whole SVG, so each hover costs O(nodes × edges). Layout is
memoized (`:133`) so it is not recomputed, but this scan is. With the ~60-node
cap and a dense edge set, hover can get janky.

- Fix: `useMemo` an adjacency map (user_id → Set of neighbor ids) over
  `graph.edges`, and look up `adj.get(node.user_id)?.has(hovered)` in render.

### L7. InstanceRoster: hardcoded English tooltip + unbounded live roster
- `web/src/pages/radar/InstanceRoster.tsx:60` — `title="Click to change limit"`
  is a literal string while the rest of the file uses `t()`. Fix with
  `t("radar.rosterLimitHint", { defaultValue: "Click to change limit" })`.
- `web/src/pages/radar/InstanceRoster.tsx:99-108` — `livePlayers` only adds on
  `user-location` and removes on `offline`/`private`. There is no seed from the
  current instance on mount and no eviction for players who left without a
  terminal event, so the roster starts empty and can accumulate stale entries
  over a long session. Consider seeding from `dbPlayerEvents` join/leave pairing
  and pruning on world change.

---

## Area health summary

- New components are solid: ActivityHeatmap day/hour indexing, RelationshipGraph
  deterministic layout (no rAF/loop, memoized), and the EntityLink fallback are
  all verified correct, with proper effect cleanup (NotificationsInbox unsubscribes
  all pipeline subs and removes listeners; Logs stream effect tears down the tailer
  and clears its flush timer; SocialGraph's IntersectionObserver disconnects).
- The recurring weakness is i18n: Logs filter labels (M1) and FriendDetailDialog
  activity descriptions (M2) are hardcoded English embedded in otherwise fully
  translated surfaces — the most user-visible gap in this batch. All newly added
  translation keys, by contrast, are present in both locales.
- No render loops, no missing-cleanup leaks, no stale-closure data bugs found.
  Remaining items are affordance/cosmetic (M4 layout flash, M5 dead click handler)
  and minor hygiene (L1 dead ref, L2 index keys).
- Supplemental pass surfaced one real-time-correctness smell worth fixing first:
  the Friends live poll (M6) can briefly revert pipeline-merged presence because
  its stale-guard never sees `__polledAt` on pipeline-produced state. Plus
  InstanceRoster's per-render pipeline re-subscription (M7) and SocialGraph's
  swallowed errors (M8).
