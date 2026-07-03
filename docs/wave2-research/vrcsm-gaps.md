I have verified all extension points across the stack. Here is the precise map.

---

# VRCSM Extension-Points Map (verified D:\Project\VRCSM, branch main)

## 1. New log atom — 6 C++ + 3 web touch-points (the shipped video/portal/sticker pattern)

The atom flow is shared between batch parse and live stream via `ParseVrchatLogAtom`. To add atom `Foo`:

### A. `src/core/LogAtoms.cpp` — regex + parse case
- Declare regex in the anonymous-namespace block, alongside the others at `LogAtoms.cpp:35-58` (e.g. `kVideoResolveRe` at :35, `kStickerSpawnRe` at :57).
- Add a `std::regex_search` branch inside `ParseVrchatLogAtom` (the if-chain ending `return std::nullopt;` at `LogAtoms.cpp:414`). Copy the sticker block at `LogAtoms.cpp:405-412` (build `LogAtom{LogAtomKind::Foo, {}}`, `put(atom, "key", match[N].str())`, `return atom`). Helper `put()` at `LogAtoms.cpp:84-91` skips empty values.

### B. `src/core/LogAtoms.h` — enum
- Add `Foo` to `enum class LogAtomKind` at `LogAtoms.h:19-37` (last existing member `StickerSpawn` at :36).

### C. `src/core/LogParser.h` — event struct + to_json decl + LogReport vector
- Define `struct FooEvent` next to `StickerSpawnEvent` at `LogParser.h:160-168`; declare `void to_json(...)` after it (pattern at :168).
- Add `std::vector<FooEvent> foos;` to `struct LogReport`, in the Track L block at `LogParser.h:225-229` (after `sticker_spawns` at :229).

### D. `src/core/LogParser.cpp` — to_json impl + UNION into report to_json + batch parse case
- `to_json(FooEvent&)` impl beside `StickerSpawnEvent`'s at `LogParser.cpp:166-174`.
- Add `{"foos", r.foos}` to the `LogReport` to_json object — list ends at `LogParser.cpp:212` (`sticker_spawns`), closing brace :213.
- Add a `case LogAtomKind::Foo:` to the batch atom switch at `LogParser.cpp:695-751` (copy the `StickerSpawn` case at :738-747; guard `report.foos.size() < kMaxEventsPerKind`, set `ev.iso_time = st.lastTimestamp`, push).

### E. `src/core/LogEventClassifier.cpp` — fromAtom builder + classifier case
- Add a `FooEvent fooFromAtom(...)` in the anon namespace beside `stickerSpawnFromAtom` at `LogEventClassifier.cpp:82-90`.
- Add `case LogAtomKind::Foo:` to the switch in `ClassifyStreamLine` at `LogEventClassifier.cpp:116-165` (copy `StickerSpawn` case :153-157 — emits `{"kind","foo"},{"data", fooFromAtom(...)}`). The string `"foo"` is the live event kind consumed downstream.

### F. `src/host/bridges/LogsBridge.cpp` — live persistence
- The generic-atom branch is the `else if (kind == "videoPlay" || ... || kind == "stickerSpawn")` block at `LogsBridge.cpp:326-379`. Add `"foo"` to that `kind ==` disjunction (:326-328), then add an `else if (kind == "foo")` payload-packing block before the `RecordLogEvent` call at :378 (copy the sticker block :370-375 which sets `e.user_id/display_name/detail`). All Track L kinds funnel into `Database::LogEventInsert` → `RecordLogEvent`.
- NOTE: if the atom is NOT a generic log_event (e.g. needs its own table like worldSwitch/player/avatarSwitch at :233-325), it instead needs a dedicated `else if` branch there. For feed parity, generic `log_event` is the cheap path.

### G. `tests/CommonTests.cpp` — golden line test
- Add `TEST(CommonTests, LogAtomsParseFoo)` calling `ParseVrchatLogAtom("<real log line>")` and a `TEST(CommonTests, LogEventClassifierEmitsFoo)` calling `ClassifyStreamLine`. Copy the video test at `CommonTests.cpp:1138-1157` or the sticker classifier test at :1221-1236. There is also a full multi-line batch integration test around :1295-1354.

## 2. Unified feed wiring (so a new log_event kind appears in the Feed)

No DB change needed if the atom persists via `RecordLogEvent` — it already flows through the `'log_event'` UNION branch.

### C++ (`src/core/Database.cpp`)
- `RecordLogEvent` at `Database.cpp:1256-1283` (INSERT into `log_events`, columns `kind,user_id,display_name,world_id,instance_id,detail,occurred_at`).
- `UnifiedFeed` UNION-ALL at `Database.cpp:1825-1927`; the `'log_event'` branch is `Database.cpp:1872-1874`. Output columns: `source_kind,event_id,user_id,display_name,event_type,world_id,instance_id,detail,occurred_at`. To add a NEW source table (not log_events), append a `UNION ALL SELECT '<kind>', ...` inside the subquery at :1852-1875 matching the 9-column shape.
- IPC handler: `IpcBridge::HandleFeedUnified` at `src/host/bridges/DatabaseBridge.cpp:674-685` (registered, see §4).

### Web
- `web/src/lib/ipc.ts`: `FeedSourceKind` union at `ipc.ts:170-175`, `FeedEntryDto` at :177-187, `feedUnified()` binding at :2442-2453.
- `web/src/lib/feed.ts`: `FeedCategory` union at `feed.ts:20-34`, `FEED_CATEGORIES` display order at :37-52, `CATEGORY_TO_SOURCE_KIND` at :55-63, **`categorize()` at :79-111** (the `kind === "log_event"` switch on `evt` is :83-89 — add `if (evt === "foo") return "foo";`). `toFeedEntry` at :115-136 builds the stable key `` `${source_kind}:${event_id}` ``.
- `web/src/pages/Feed.tsx`: `categoryIcon()` switch at `Feed.tsx:73-100`, `defaultCategoryLabel()` at :106-123, `DETAIL_CATEGORIES` set at :126-132. Add a `case "foo":` to each.
- `web/src/i18n/locales/en.json`: `feed.category` object at `en.json:1138-1150`. GAP CONFIRMED — it does NOT contain `video/portal/moderation/sticker` keys; Feed.tsx silently falls back to `defaultCategoryLabel`. A new category should add its key here for proper i18n.
- Test: `web/src/lib/__tests__/feed.test.ts` (log_event categorization at :54-58) — add an assertion.

## 3. New VRChat API method + IPC method (end-to-end, using `worlds.search` as the verified template)

1. **`src/core/VrcApi.h`** — declare `static Result<nlohmann::json> searchWorlds(...)` (cite `VrcApi.h:289-292`; simpler single-arg example `fetchUser` at :183).
2. **`src/core/VrcApi.cpp`** — implement. Pattern (`searchWorlds` at `VrcApi.cpp:2854-...`, or cleaner `fetchUser` at :2084-2107): get `getLoadedCookieHeader()`; if empty return `Error{"auth_expired",...,401}`; build path via `fmt::format("/api/1/...&apiKey={}", kApiKey, ...)` + `toWide`; call `httpGet(kApiHostW, path, cookieHeader)`; `if (auto err = checkStandardHttpError(response, "")) return *err;` then status checks; `return parseJsonBody(response, "...")`.
3. **`src/host/bridges/ApiBridge.cpp`** — add `nlohmann::json IpcBridge::HandleWorldsSearch(...)` (template at `ApiBridge.cpp:1069-1081`): extract params via `JsonStringField`/`ParamInt`, throw `IpcException({"missing_field",...,400})` on missing, `return unwrapResult(vrcsm::core::VrcApi::searchWorlds(...))`.
4. **`src/host/IpcBridge.h`** — declare the handler (`HandleWorldsSearch` at `IpcBridge.h:128`; `HandleFeedUnified` at :237).
5. **`src/host/IpcBridge.cpp`** — TWO registrations:
   - `m_handlers.emplace("worlds.search", [this](...){ return HandleWorldsSearch(p,id); });` at `IpcBridge.cpp:695` (feed.unified equivalent at :776).
   - Add the method string to `AsyncMethodSet()` at `IpcBridge.cpp:98-177` (set is a `static std::unordered_set<std::string>`; `"worlds.search"` listed at :149) — REQUIRED if the call does blocking I/O so it runs on a worker thread.
6. **`web/src/lib/ipc.ts`** — add binding method in the `IpcClient` class (template `worldsSearch` at `ipc.ts:1705-1710`): `return this.call<ParamsType, ResultType>("worlds.search", {...});`. Reusable IPC lives in lib domain modules, NOT in pages (per CLAUDE.md).

## 4. Web page registration (for a new "model DB" page)

Pages are lazy-imported and routed in `web/src/App.tsx`:
- `const Foo = lazy(() => import("@/pages/Foo"));` — block at `App.tsx:43-69`.
- `<Route path="/foo" element={<Foo />} />` — block at `App.tsx:493-521`.
- Catch-all `<Route path="*" ...>` at :521 must stay last.

Closest existing model-DB page to copy: **`web/src/pages/Avatars.tsx`** — it is the canonical "entity database" page (search/filter/grid, favorites, thumbnails, profile dialog). Its imports at `Avatars.tsx:1-55` show the full toolkit: `useIpcQuery`, `useThumbnail`/`prefetchThumbnails` from `thumbnails`, `cacheImageUrl`/`useCachedImageUrl` from `image-cache`, `useFavoriteItems`/`useFavoriteActions` from `library`, `ThumbImage`, `ProfileCard`, shadcn `Card`/`Dialog`/`Badge`. The avatar-union model logic lives separately in `web/src/lib/avatar-models.ts` (`mergeAvatarModels`/`filterAvatarModels` at :215-239, image/label helpers :207-213) — a new model-DB page should add a parallel domain module in `web/src/lib`, not inline the merge.

NOTE: `Feed.tsx` and `GameLog.tsx` are NOT routed in App.tsx — they are exported as embeddable panels (`FeedPanel`/`GameLogPanel`) and consumed inside `web/src/pages/Radar.tsx:26-27,143-145`. So "add a feed surface" = import the panel, not add a route.

## 5. Cache / image / thumbnail module surfaces (web/src/lib)

- `assets-cache.ts` — `AssetType="world"|"avatar"|"user"` (:4), `resolveAssets`/`prefetchAssets`/`useAsset` (:197/:227/:261), `assetImageUrl` (:172), invalidation `invalidateAsset`/`invalidateAssetsCoherent` (:182/:188). Account-scoped resolution layer over `assets.resolve` IPC.
- `image-cache.ts` — `cacheImageUrl`/`cacheImageUrls` (:50/:108), `useCachedImageUrl` hook (:208), `invalidateCachedImageUrl`/`invalidateCachedImages` (:97/:103).
- `thumbnails.ts` — `useThumbnail` hook (:153), `prefetchThumbnails`/`prefetchThumbnailsLowPriority` (:210/:293), `invalidateThumbnail`/`invalidateThumbnails` (:83/:77), `resetLowPriorityThumbnailQueue` (:89).
- A model-DB page reuses these directly (as Avatars.tsx does); do not add new fetch logic in the page.

## 6. Schema migration pattern (to add a new table — current max = v14)

In `Database.cpp::InitSchema`, all DDL+migrations run inside ONE transaction: `BEGIN;` at `Database.cpp:3733`, `COMMIT;` at :4084, with `RollbackIfNeeded(m_db)` on every error. **There is no per-version gate/skip** — every step is idempotent (`CREATE TABLE IF NOT EXISTS`, ALTER wrapped in raw `sqlite3_exec` that ignores "duplicate column" errors) and runs on every startup; `PRAGMA user_version = N;` is bumped after each block purely as a marker.

To add **v15**: copy the v14 template at `Database.cpp:4052-4082` verbatim — insert a new block AFTER the `PRAGMA user_version = 14;` set (:4078-4082) and BEFORE the `COMMIT;` (:4084):
```
static const char* kSchemaV15Sql = R"SQL( CREATE TABLE IF NOT EXISTS ... ; CREATE INDEX IF NOT EXISTS ...; )SQL";
if (const auto r = ExecSimple(kSchemaV15Sql); std::holds_alternative<Error>(r)) { RollbackIfNeeded(m_db); return std::get<Error>(r); }
if (const auto r = ExecSimple("PRAGMA user_version = 15;"); std::holds_alternative<Error>(r)) { RollbackIfNeeded(m_db); return std::get<Error>(r); }
```
The v14 `log_events` table DDL itself is at `Database.cpp:4058-4069`. Insert struct `LogEventInsert` at `Database.h:119-128`; method decl `RecordLogEvent` at `Database.h:130`. For a column-add (not new table), use the ALTER-ignore-error pattern at `Database.cpp:3938-3973` (raw `sqlite3_exec`, no error check).

---

## Quick reference: file:line anchors
| Capability | Add code at | Copy pattern from |
|---|---|---|
| Atom regex+parse | `LogAtoms.cpp:35`/`:405` | sticker block :405-412 |
| Atom enum | `LogAtoms.h:36` | `StickerSpawn` |
| Event struct+vector | `LogParser.h:160`/`:229` | `StickerSpawnEvent` |
| to_json + batch case | `LogParser.cpp:166`/`:212`/`:738` | sticker case :738-747 |
| Classifier case | `LogEventClassifier.cpp:82`/`:153` | sticker :153-157 |
| Live persist | `LogsBridge.cpp:326`/`:370` | sticker :370-375 |
| Golden test | `CommonTests.cpp:1138`,`:1221` | video/sticker tests |
| DB record | `Database.cpp:1256` (RecordLogEvent) | — |
| Feed UNION | `Database.cpp:1872` | log_event branch |
| New migration | `Database.cpp:4082` (before COMMIT) | v14 :4052-4082 |
| API method | `VrcApi.cpp:2084`/`.h:183` | `fetchUser` |
| IPC bridge handler | `ApiBridge.cpp:1069`, `IpcBridge.h:128` | `HandleWorldsSearch` |
| IPC register (×2) | `IpcBridge.cpp:695` + `:149` (async set) | `worlds.search` |
| Web IPC binding | `ipc.ts:1705` | `worldsSearch` |
| Feed categorize | `feed.ts:83` | log_event evt-switch |
| Feed icon/label/i18n | `Feed.tsx:73`/`:106`, `en.json:1138` | video/sticker cases |
| Page route | `App.tsx:53`+`:511` | any lazy route |
| Model-DB page | new `pages/Foo.tsx` + `lib/foo-models.ts` | `Avatars.tsx` + `avatar-models.ts` |

## Confirmed gaps / notes
- `en.json` feed.category (`:1138-1150`) is MISSING `video/portal/moderation/sticker/friend-added/friend-removed` keys — Feed.tsx falls back to hardcoded `defaultCategoryLabel`. Any new category should add its i18n key here.
- `Feed.tsx`/`GameLog.tsx` are panels embedded in `Radar.tsx`, NOT standalone routes — confirmed via grep (only references are `Radar.tsx:26-27` and self default-export wrappers).
- All Track L atoms share one generic `log_events` table; a new atom needs NO schema change if it persists via `RecordLogEvent`. A new dedicated table is only needed if it carries structured columns beyond `detail` (like world_visits/player_events do).
- UNVERIFIED: I did not open the full middle of `VrcApi.cpp` searchWorlds (lines 2899+, the result-shaping tail) or the nav/sidebar menu file where a new page label would also need registering — App.tsx routing is confirmed but the sidebar nav list was not located in this pass.