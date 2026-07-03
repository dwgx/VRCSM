# Own Algorithm: "Best Time to Catch a Friend Online" Predictor

Status: design only (no code written). Every VRCSM claim below cites a `file:line`
that was read while authoring this spec.

## 0. Why this beats VRCX

VRCX surfaces a friend's *current* presence and a raw activity log, but it has no
predictive, server-side model of *when* a friend tends to be online. VRCSM already
persists a durable, per-friend presence stream in `friend_presence_events`
(`src/core/Database.cpp:4232-4248`), so we can aggregate observed online windows
into an hour-of-week histogram and rank the most likely time slots. This is an
original analytic layer on top of data we already collect — not a port of any VRCX
feature.

---

## 1. Session bracketing: which `event_type` values mark online/offline

### Ground truth from the recorder

Presence rows are written by the frontend coordinator `web/src/lib/feed-recorder.ts`.
The pipeline→`event_type` mapping is the authority for which discriminator values
exist (`web/src/lib/feed-recorder.ts:23-29`):

```ts
const PRESENCE_EVENT_TYPE: Record<string, string> = {
  "friend-online":   "online",
  "friend-offline":  "offline",
  "friend-active":   "status",
  "friend-location": "location",
  "friend-update":   "status",
};
```

So the only `event_type` values that can appear in `friend_presence_events` from the
live pipeline are: `"online"`, `"offline"`, `"location"`, `"status"`. The C++ insert
struct documents the same set plus `"avatar"`
(`src/core/Database.h:255`: `"online" | "offline" | "location" | "status" | "avatar"`).

The insert itself is `Database::RecordFriendPresenceEvent`
(`src/core/Database.cpp:1875-1916`), binding 11 columns in the order
`user_id, display_name, event_type, world_id, instance_id, location, status,
old_value, new_value, source, occurred_at` (`src/core/Database.cpp:1892-1896`).

### Session inference rule

A friend's "online session" is the interval **[online_ts, offline_ts)**:

- **Session start** = a row with `event_type = 'online'`.
- **Session end** = the next chronological row (same `user_id`) with
  `event_type = 'offline'`.

`location` and `status` rows are *evidence of being online* but are not session
boundaries on their own (a friend can move worlds / change status many times within
one online session). They are used only as a fallback liveness signal (see dangling
handling).

Because the pipeline can miss events (app not running, pipeline reconnects), we must
handle malformed bracketing explicitly:

1. **Dangling `online` (no following `offline`).**
   - If another `online` appears before any `offline`, close the first session at the
     second `online`'s timestamp (treat the duplicate `online` as an implicit
     re-affirmation; do not double-count).
   - If the dangling `online` is the most recent row and the friend is *currently*
     online, close the session at "now" (capped — see below).
   - If the dangling `online` is stale (older than `kMaxSessionHours`, default 12h)
     and there is no later evidence, **cap** the session at `online_ts +
     kMaxSessionHours` rather than letting one missed `offline` smear a whole day of
     buckets. This is the single most important guard against bad data.

2. **Dangling `offline` (no preceding `online`).** Ignore it — there is no interval
   to attribute. (It commonly happens when collection started mid-session.)

3. **`location`/`status` with no enclosing `online`.** Optionally synthesize a
   short "presence pulse" of `kPulseMinutes` (default 5 min) centered on the event,
   attributing only that small window. This recovers signal when the `online` row
   was missed but we clearly observed the friend active. This behavior is gated
   behind a flag (`includePulses`, default `true`) so it can be disabled if it
   proves noisy. Pulses never merge into capped real sessions; if a `location`/
   `status` falls inside an open `online` interval it is already covered and adds
   nothing.

Only sessions (and optional pulses) contribute to the histogram. Time spent
"offline" or "private with status only" outside an online bracket contributes
nothing.

---

## 2. Aggregation: 168-bucket hour-of-week histogram

### Timezone: confirm the `occurred_at` format first

This is a real correctness hazard. There are **two** producers writing
`occurred_at`, and they disagree on timezone encoding:

- **Frontend** (`web/src/lib/feed-recorder.ts:99`) writes
  `new Date().toISOString()` → UTC with a `Z` suffix, e.g.
  `2026-06-24T12:00:00.000Z`.
- **C++ host fallback** (`src/host/bridges/DatabaseBridge.cpp:660`) calls
  `vrcsm::core::nowIso()` when the param is empty. `nowIso()`
  (`src/core/Common.cpp:38-62`) emits **local** time with a numeric offset, e.g.
  `2026-06-24T20:00:00+08:00` (no `Z`, fractional seconds absent).

In practice the live pipeline always supplies `occurred_at`, so production rows are
UTC-`Z`. But the algorithm must not assume it. **Rule:** parse `occurred_at` into an
absolute UTC instant, honoring an explicit trailing `Z` or `±HH:MM` offset; if the
string carries *no* offset designator, treat it as already-local wall-clock and skip
the local conversion step (it is local by construction via `nowIso()`). After
obtaining a UTC instant, convert to the **user's local timezone** before bucketing,
because "Tuesday 8pm" only means anything in local time.

Recommendation: do the timezone math in **C++**, not SQL. SQLite's `strftime` can
shift by a fixed offset but cannot apply DST-correct zone rules, and mixed
`Z`/offset/naive strings make a pure-SQL `GROUP BY strftime('%w %H', ...)` unsafe.
The C++ method should:

1. `SELECT event_type, occurred_at FROM friend_presence_events WHERE user_id = ?1
   AND event_type IN ('online','offline','location','status') ORDER BY occurred_at
   ASC` — mirrors the parameterized, `ORDER BY occurred_at` style of
   `RecentFriendPresenceEvents` (`src/core/Database.cpp:1937-1946`).
2. Parse each `occurred_at` to a `std::chrono::system_clock::time_point` (UTC).
3. Walk the ordered stream applying the session-bracketing rules from §1.
4. For each resolved session interval, split it across hour-of-week buckets in the
   **local** zone. An interval that spans bucket boundaries contributes its
   *overlap duration* (in minutes) to each bucket it touches — not a flat +1 — so a
   3-hour session correctly lights up three hour buckets proportionally.

Bucket index: `bucket = localDayOfWeek * 24 + localHour`, where `localDayOfWeek` is
0=Sunday..6=Saturday and `localHour` is 0..23, giving 168 buckets.

### Local time conversion in C++

`nowIso()` already demonstrates the available primitives: `localtime_s` +
`GetTimeZoneInformation` (`src/core/Common.cpp:42-47`). For bucketing, convert each
session's UTC endpoints with `localtime_s` to get local `tm_wday`/`tm_hour`. This
follows the existing house pattern rather than introducing `std::chrono::zoned_time`
(which the codebase does not currently use).

---

## 3. Confidence weighting + minimum-observations threshold

### Exponential recency decay

Weight each minute of observed online time by how recent the session is, so this
month's habits dominate a friend who changed schedules:

```
ageWeeks = (now - sessionStart) / 1 week
weight   = pow(0.5, ageWeeks / HALF_LIFE_WEEKS)     // HALF_LIFE_WEEKS default 4
bucket[i] += overlapMinutes_i * weight
```

A 4-week half-life means observations from ~2 months ago count ~25%, and a year-old
session counts <0.01%. Expose `HALF_LIFE_WEEKS` as a constant (`kHalfLifeWeeks`) in
the C++ TU, kCamelCase per coding standards (CLAUDE.md "Coding Standards").

Also track an **unweighted** observation count per bucket (`observedDays[i]` = number
of distinct local calendar days that contributed any online minutes to bucket `i`).
This drives the data-sufficiency gate and is more honest than raw minutes (one
12-hour outlier day should not look like 12 days of evidence).

### Sufficiency gate

Return `"status": "insufficient_data"` (and omit predictions) when **either**:

- total distinct observation days across the whole window `< kMinObservationDays`
  (default 7), or
- the friend's total resolved online time `< kMinOnlineMinutes` (default 120).

A bucket is only allowed into the ranked output if its `observedDays[i] >=
kMinBucketObservations` (default 2) — i.e. we saw them online in that slot on at
least two different days — so a single Tuesday-night fluke never becomes a
"prediction".

---

## 4. Output shape

```jsonc
{
  "user_id": "usr_xxxx",
  "status": "ok",                  // "ok" | "insufficient_data"
  "timezone_offset_minutes": 480,  // local offset used for bucketing (e.g. +08:00)
  "window_start": "2026-04-01T00:00:00Z",  // oldest occurred_at considered
  "window_end":   "2026-06-29T00:00:00Z",  // = now
  "total_online_minutes": 5421.5,
  "observation_days": 23,
  "half_life_weeks": 4,

  // 168 normalized weights, index = dayOfWeek(0=Sun)*24 + hour(0..23).
  // Normalized to the peak bucket = 1.0; 0.0 means never observed online.
  "heatmap": [0.0, 0.0, 0.12, /* ... 168 floats total ... */],

  // Top-N contiguous windows, highest confidence first.
  "top_windows": [
    {
      "day_of_week": 2,            // 0=Sun .. 6=Sat (here: Tuesday)
      "start_hour": 20,           // local
      "end_hour": 22,             // local, exclusive
      "score": 1.0,               // normalized (peak window = 1.0)
      "observation_days": 6,      // distinct days seen online in this window
      "label_key": "predictor.window"  // i18n key; FE formats day+hours
    }
    // ... up to N (default 3) ...
  ]
}
```

Notes:
- **Top-window merging:** after scoring 168 buckets, merge adjacent same-day buckets
  whose normalized score is `>= kWindowJoinThreshold` (default 0.6 of peak) into one
  window, then rank windows by summed weighted score and take the top `N`. This is
  what yields human phrasing like "Tuesdays 8–10pm" instead of 168 raw numbers.
- The frontend owns localized day/hour formatting; C++ returns numeric `day_of_week`
  + `start_hour`/`end_hour` and an i18n `label_key`, consistent with how the dialog
  already uses `t(...)` with `defaultValue` (`web/src/components/FriendDetailDialog.tsx:779`).

---

## 5. Full touch-point list (all cited from files read)

### 5.1 Core — `src/core/Database.h`

Declare next to the other presence/feed read methods (after `UnifiedFeed`, which
ends at `src/core/Database.h:286`). Match the `std::optional` defaulted-param style
of `RecentFriendPresenceEvents` (`src/core/Database.h:268-274`):

```cpp
// Predict a friend's likely-online hour-of-week distribution from their
// friend_presence_events online/offline brackets. Returns the JSON shape in
// docs/wave2-research/own-overlap-algorithm-design.md §4.
Result<nlohmann::json> PredictFriendOnlineWindows(
    const std::string& user_id,
    int top_n = 3,
    int half_life_weeks = 4);
```

### 5.2 Core — `src/core/Database.cpp`

Implement adjacent to `RecentFriendPresenceEvents`
(`src/core/Database.cpp:1918-1995`) / `UnifiedFeed`
(`src/core/Database.cpp:1997` onward). Reuse the established mechanics seen there:
`std::lock_guard<std::mutex> lock(m_mutex)` + `m_db == nullptr` guard
(`src/core/Database.cpp:1926-1935`), `sqlite3_prepare_v2` + `StatementGuard`
(`src/core/Database.cpp:1948-1953`), `BindText`/`BindOptionalText`, the
`while (sqlite3_step == SQLITE_ROW)` loop, and `ColumnTextOrNull`
(`src/core/Database.cpp:1971-1985`). The SELECT should be parameterized on `user_id`
and constrain `event_type IN (...)` as in §2. All bucketing/decay/merging is plain
C++ after the rows are read; no extra SQL.

### 5.3 Host registration — `src/host/IpcBridge.cpp` (three spots)

1. **Handler map** — add next to the presence handlers
   (`src/host/IpcBridge.cpp:809-811`):
   ```cpp
   m_handlers.emplace("friendPresence.predict",
       [this](const nlohmann::json& p, const std::optional<std::string>& id) {
           return HandleFriendPresencePredict(p, id); });
   ```
2. **Async method set** — add the string to `AsyncMethodSet()` alongside
   `"friendPresence.recent"` (`src/host/IpcBridge.cpp:224-226`). The histogram walk
   is CPU work over potentially many rows, so it belongs on the detached worker
   thread (dispatch path at `src/host/IpcBridge.cpp:504`).
3. (No third registration list beyond these two — the handler map at 809 and the
   async set at 224 are the two required spots; confirmed by how
   `friendPresence.record`/`.recent` appear in exactly those two places.)

### 5.4 Host handler declaration — `src/host/IpcBridge.h`

Add beside the presence/feed handler declarations
(`src/host/IpcBridge.h:257-259`):
```cpp
nlohmann::json HandleFriendPresencePredict(const nlohmann::json& params,
                                           const std::optional<std::string>& id);
```

### 5.5 Host handler body — `src/host/bridges/DatabaseBridge.cpp`

Implement next to `HandleFriendPresenceRecent`
(`src/host/bridges/DatabaseBridge.cpp:671-682`). Follow that exact shape: pull params
with `JsonStringField` / `ParamInt` (`DatabaseBridge.cpp:673-678`), call
`vrcsm::core::Database::Instance().PredictFriendOnlineWindows(...)`
(cf. `.RecentFriendPresenceEvents(...)` at `DatabaseBridge.cpp:679-680`), and return
via `unwrapResult(std::move(res))` (`DatabaseBridge.cpp:681`). `user_id` is required —
throw `IpcException(vrcsm::core::Error{"invalid_argument", ...})` when empty, mirroring
`HandleFriendPresenceRecord` (`DatabaseBridge.cpp:645-648`).

### 5.6 Frontend binding — `web/src/lib/ipc.ts`

Add a method beside `friendPresenceRecent`
(`web/src/lib/ipc.ts:2716-2727`), and a `FriendOnlinePredictionDto` interface near
`FriendPresenceEventDto` (`web/src/lib/ipc.ts:153-166`):

```ts
export interface FriendOnlinePredictionDto {
  user_id: string;
  status: "ok" | "insufficient_data";
  timezone_offset_minutes: number;
  window_start: string;
  window_end: string;
  total_online_minutes: number;
  observation_days: number;
  half_life_weeks: number;
  heatmap: number[];        // length 168
  top_windows: Array<{
    day_of_week: number; start_hour: number; end_hour: number;
    score: number; observation_days: number; label_key: string;
  }>;
}

async friendPresencePredict(params: {
  user_id: string; top_n?: number; half_life_weeks?: number;
}) {
  return this.call<typeof params, FriendOnlinePredictionDto>(
    "friendPresence.predict", params,
  );
}
```

### 5.7 Frontend render — `web/src/components/FriendDetailDialog.tsx`

Add a `useIpcQuery` next to the existing activity-log query
(`web/src/components/FriendDetailDialog.tsx:208-214`), typed to the new DTO and gated
`enabled: !!friend`:

```tsx
const { data: prediction } = useIpcQuery<
  { user_id: string },
  FriendOnlinePredictionDto
>("friendPresence.predict", { user_id: friend?.id ?? "" },
  { enabled: !!friend, staleTime: 300_000 });
```

Render a new card between **Recent Activity** (section "5", header at
`FriendDetailDialog.tsx:698-702`) and **Shared Worlds** (section "5c",
`FriendDetailDialog.tsx:768`) — call it section "5d. Best Time to Catch Online". When
`prediction?.status === "insufficient_data"`, show a muted "not enough data yet"
line (use `t(..., { defaultValue })` like the existing `friendDetail.noActivity`
string at `FriendDetailDialog.tsx:726`). Otherwise render the `top_windows` as chips
(reusing the small uppercase-label + flex-column layout of the Shared Worlds block at
`FriendDetailDialog.tsx:776-798`) and optionally a 7×24 heatmap grid from `heatmap`.

---

## 6. Testability (gtest — `tests/CommonTests.cpp`)

The project drives the real `Database` singleton against a temp file via
`OpenTempDatabase` (`tests/CommonTests.cpp:84-90`) and the
`MakeTempTestDir` + `remove_all` teardown pattern used by
`UnifiedFeedMergesSourcesInTimeOrder` (`tests/CommonTests.cpp:403-467`). A new
`TEST(CommonTests, PredictFriendOnlineWindowsRanksRecurringSlots)` should mirror it:

1. `OpenTempDatabase`, get `Database::Instance()`.
2. Insert several `FriendPresenceEventInsert` pairs via `RecordFriendPresenceEvent`
   (same call used at `tests/CommonTests.cpp:431-440`): for one `user_id`, write
   `online`/`offline` brackets all landing on, say, Tuesday 20:00–22:00 UTC across 3+
   distinct dated weeks, plus a couple of off-peak sessions on other days.
3. Call `db.PredictFriendOnlineWindows("usr_x", 3, 4)`, assert `isOk` with the
   `vrcsm::core::value(res)` accessor (as at `tests/CommonTests.cpp:445`).
4. Assertions (gtest `EXPECT_EQ`/`ASSERT_GE` style as throughout the file):
   - `result["status"] == "ok"`.
   - `result["heatmap"].size() == 168`.
   - `result["top_windows"][0]["day_of_week"] == 2` and `["start_hour"] == 20` — the
     recurring slot ranks first.
   - peak `heatmap` bucket index `2*24 + 20 == 68` is the max of the array.
5. Add a second test `PredictFriendOnlineWindowsReportsInsufficientData`: insert only
   one short session and assert `result["status"] == "insufficient_data"` and
   `top_windows` empty — verifies the §3 gate.
6. Teardown: `db.Close()` + `std::filesystem::remove_all(dir, ec)`
   (`tests/CommonTests.cpp:464-466`).

Note on determinism: the recency-decay weight depends on "now". To keep the test
stable, the core method should accept the brackets relative to a reference time, OR
the test should insert sessions dated relative to `nowIso()` so the half-life math
is exercised without hardcoding absolute weights. Asserting *ranking/ordering* and
*bucket indices* (rather than exact float weights) keeps the test robust against the
decay constant.

---

## 7. Open correctness risks (call out for the implementer)

- **Mixed timezone encoding in `occurred_at`** (§2) is the highest-risk item. The
  parser must distinguish `Z` / `±HH:MM` / naive-local. Verify against real rows
  before trusting bucket placement; a 8-hour misattribution would silently shift
  every prediction.
- **Missed `offline` events** smear sessions — the `kMaxSessionHours` cap (§1) is
  mandatory, not optional.
- **DST**: `localtime_s` is DST-correct for the *current* offset but bucketing
  historical instants near a DST boundary can be off by one hour. Acceptable for a
  "rough best time" feature; document it rather than over-engineer.
