# Global Quick Search + Evidence-First Result Model

Status: `search.global` v1 local-only implementation exists; remote enrichment, Timeline inspectors, and advanced query grammar remain roadmap/spec.
Owner surface: current `search.global` core/IPC/quick-search UI plus future Timeline integration.
Last updated: 2026-04-29.

## Goal

VRCSM needs one narrow feature cut that clearly exceeds VRCX instead of only matching it: a global quick search that starts from the user's local evidence, then optionally enriches from VRChat only when cached or safely debounced.

The differentiator is not "one box that calls every API". The differentiator is "show why this result is here":

- evidence badge: every result carries local proof such as favorite membership, visit history, encounter events, avatar history, cached bundle, screenshot metadata, or remote cached detail.
- local cache safety: local DB and local files rank first; remote API cannot be triggered per keystroke or by background fanout.
- 3D preview / local asset evidence: avatars and worlds can show whether VRCSM has a local cache artifact or previewable GLB candidate.
- privacy-first offline index: search should remain useful when signed out or offline, because the index is built from `%LocalLow%\VRChat\VRChat\` logs, VRCSM SQLite, and VRCSM-owned caches.

## Implemented v1 Cut

The first local-only implementation has shipped:

- `Database::GlobalSearch()` merges local favorites, world visits, player events, player encounters, and avatar history into one evidence-first result list.
- `search.global` is registered as an async host IPC method.
- `web/src/lib/types.ts` and `web/src/lib/ipc.ts` expose the typed client contract and dev mock.
- The existing `Ctrl+K` command palette calls `search.global` and renders local evidence rows before built-in navigation commands.
- Unit tests cover favorite/visit evidence merging and the historical-avatar reference-thumbnail guard.

Remote VRChat API enrichment is intentionally disabled in v1. `includeRemote` is accepted for contract stability, but diagnostics report `remoteSources: []` and `remoteSuppressedReason: "disabled"`.

## Existing Inputs

Use the current local surfaces first. Do not invent a parallel store until the first implementation proves a query cannot be answered from these tables and IPC methods.

| Source | Existing table / method | Result types | Evidence value |
|---|---|---|---|
| Local favorites | `local_favorites`, `favorites.items` | `world`, `avatar`, `user`, `other` | User explicitly saved it, optional tags/note/list name |
| World visits | `world_visits`, `db.worldVisits.list` | `world`, `timeline_event` | Joined/left timestamps, instance id, access type, region |
| Player events | `player_events`, `db.playerEvents.list` | `user`, `timeline_event` | Join/leave events in a specific world/instance |
| Player encounters | `player_encounters`, `db.playerEncounters` | `user` | Aggregated first/last seen and encounter count |
| Avatar history | `avatar_history`, `db.avatarHistory.list` | `avatar`, `timeline_event` | First seen time, wearer, release status, resolved thumbnail state |
| Cache / preview | cache scan, preview cache, `thumb.local`, `avatar.preview.*` | `avatar`, `world`, `asset` | Local artifact exists and may be inspectable without VRChat API |
| Remote VRChat API | `user.search`, `worlds.search`, `avatar.search`, details endpoints | `user`, `world`, `avatar` | Enrichment only; never the first source for local history results |

## IPC Contract

Add a new async IPC method:

```ts
type SearchGlobalRequest = {
  query: string;
  limit?: number;              // default 20, hard cap 50
  offset?: number;             // default 0
  types?: Array<"user" | "world" | "avatar" | "favorite" | "timeline_event" | "asset">;
  includeRemote?: "never" | "cached" | "debounced"; // default "cached"
  timelineWindow?: {
    start?: string;            // ISO8601 inclusive
    end?: string;              // ISO8601 inclusive
  };
};

type SearchGlobalResponse = {
  query: string;
  normalizedQuery: string;
  mode: "local" | "local+remote-cache" | "local+remote-refresh";
  items: GlobalSearchResult[];
  nextOffset: number | null;
  diagnostics: {
    localSources: string[];
    remoteSources: string[];
    cacheHit: boolean;
    remoteSuppressedReason?: "short_query" | "offline" | "signed_out" | "rate_limited" | "disabled";
  };
};
```

`search.global` should be registered async because local DB scans, cache checks, and optional remote enrichment must not run on the UI thread.

## Result Schema

Each result item must use these top-level fields. Add nested fields only inside the listed objects so the UI has a stable card contract.

```ts
type GlobalSearchResult = {
  type: "user" | "world" | "avatar" | "favorite" | "timeline_event" | "asset";
  id: string;
  displayName: string;
  subtitle: string;
  source: SearchResultSource;
  evidence: SearchEvidence[];
  thumbnail: SearchThumbnail | null;
  localStatus: SearchLocalStatus;
  primaryAction: SearchPrimaryAction;
  confidence: number; // 0.0-1.0
};

type SearchResultSource = {
  kind:
    | "local.favorite"
    | "local.world_visit"
    | "local.player_event"
    | "local.player_encounter"
    | "local.avatar_history"
    | "local.cache_asset"
    | "remote.vrchat.cached"
    | "remote.vrchat.live"
    | "mixed";
  label: string;        // human-readable badge text, e.g. "Local favorite"
  updatedAt?: string;   // ISO8601 when this source was last observed/refreshed
};

type SearchEvidence = {
  kind:
    | "favorite"
    | "world_visit"
    | "player_join"
    | "player_leave"
    | "player_encounter"
    | "avatar_seen"
    | "cache_asset"
    | "preview_3d"
    | "thumbnail_cache"
    | "remote_detail"
    | "remote_search";
  label: string;        // short badge text shown in the result row
  detail: string;       // full row/tooltip text
  sourceId?: string;    // db row id, target id, cache hash, or endpoint name
  observedAt?: string;  // ISO8601 point in time
  timeRange?: {
    start: string;
    end?: string;
  };
  reliability: "verified" | "inferred" | "reference" | "remote";
  privacy: "local-only" | "local-cache" | "remote-cached" | "remote-live";
};

type SearchThumbnail = {
  url: string | null;
  kind: "local-thumb" | "remote-cdn" | "placeholder" | "preview-3d" | "reference";
  source: "thumb.local" | "screenshot-thumbs.local" | "vrc-api" | "preview-cache" | "placeholder";
  verified: boolean;
  alt: string;
};

type SearchLocalStatus = {
  state: "favorite" | "visited" | "encountered" | "seen-avatar" | "cached-asset" | "remote-only" | "unknown";
  isFavorite: boolean;
  hasLocalCache: boolean;
  has3dPreview: boolean;
  visitCount?: number;
  encounterCount?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  warnings?: Array<"thumbnail-reference-only" | "remote-stale" | "private-or-unresolved" | "cache-missing">;
};

type SearchPrimaryAction = {
  kind: "open" | "inspect" | "focus-timeline" | "preview-3d" | "join" | "wear" | "open-browser" | "copy-id";
  label: string;
  route?: string;       // React route, e.g. "/worlds?select=wrld_..."
  ipc?: string;         // optional IPC method if the action is host-driven
  enabled: boolean;
  disabledReason?: string;
};
```

### Field Rules

- `type` is the rendered entity class. A favorite world still returns `type: "world"` unless the result is the favorite list itself.
- `id` is the canonical VRChat id when available: `usr_*`, `wrld_*`, `avtr_*`. Timeline-only rows may use `timeline:<source>:<rowid>`.
- `displayName` must never be a fake friendly label when only an id is known. Use the id or short id if the local source lacks a name.
- `subtitle` should summarize the strongest evidence, not marketing copy: `Visited 4 times, last 2026-04-27`, `Seen on Alice in wrld_...`, `Saved in Library`.
- `source.kind` is the winning source after ranking. Use `mixed` when the display name comes from one source and the ranking reason comes from another.
- `evidence` is ordered by strength. First item should be the badge shown inline; remaining items populate the inspector or Timeline detail pane.
- `thumbnail.verified` must stay false for wearer current-profile images used as references for historical avatars. Do not promote reference images into historical avatar thumbnails unless the avatar id/name match is verified.
- `localStatus` is for UI state and filters. It must not be used as a substitute for `evidence`.
- `primaryAction` should be safe by default. Destructive or account-changing actions are not allowed from global search v1.
- `confidence` is numeric because ranking, grouping, and Timeline merging need a stable sort key independent of text labels.

## Evidence-First Ranking

Rank local evidence before remote freshness. Suggested first-pass scoring:

| Signal | Score |
|---|---:|
| Exact canonical id match (`usr_`, `wrld_`, `avtr_`) | +0.45 |
| Exact display name / favorite target name match | +0.35 |
| Prefix or token match in display name | +0.25 |
| Favorite membership | +0.20 |
| Recent world visit / player encounter / avatar seen within 30 days | +0.15 |
| Repeated visits or encounters | +0.05 to +0.15 |
| Local cache or 3D preview exists | +0.10 |
| Remote cached detail confirms name/thumbnail | +0.05 |
| Remote live-only result with no local evidence | max 0.55 |
| Reference-only thumbnail for historical avatar | no score increase |

Clamp `confidence` to `[0, 1]`. Remote live-only results should be visible but below local history unless the query is an exact id and no local hit exists.

## Local-First Query Flow

1. Normalize query: trim, case-fold, collapse whitespace, keep raw id prefixes intact.
2. If the query is empty, return recent local evidence instead of remote suggestions:
   - favorites by latest `added_at`
   - recently visited worlds
   - recent player encounters
   - recent avatar history
3. If query looks like a canonical id, query matching local tables by id before any fuzzy work.
4. Query local favorites by `target_id`, `display_name`, tags, notes, and list name.
5. Query world visits by `world_id`, `instance_id`, known world names from logs, and instance metadata.
6. Query player events / encounters by `user_id`, `display_name`, world id, and instance id.
7. Query avatar history by `avatar_id`, `avatar_name`, `author_name`, wearer display name, wearer `usr_*`, and resolution fields.
8. Attach local cache evidence: thumbnail cache hit, preview cache hit, bundle/cache entry exists. This step may be best-effort but must not block local text results for long.
9. Merge duplicate entities by canonical id. Preserve all evidence; do not drop lower-ranked evidence just because a higher-ranked source exists.
10. Only then decide whether remote cached or remote live enrichment is allowed.

## Remote API Policy

Remote API is enrichment, not the core search engine.

Rules:

- Default `includeRemote` is `cached`, meaning the host may read previously cached remote detail but must not make live calls.
- `debounced` may make live calls only after the UI has stopped changing the query for at least 600 ms.
- Minimum live-query length is 3 visible characters unless the query is a full canonical id.
- Cap live calls to one request per remote source per normalized query per 10 minutes. Sources are `user.search`, `worlds.search`, `avatar.search`, and details endpoints.
- Negative cache remote misses for 15 minutes. Cache positive details for at least 24 hours, longer if the source is tied to local evidence.
- Live remote calls must be cancelable or ignorable by request generation. Stale responses must not overwrite newer local results.
- Never fan out details for every result row. Fetch details only for exact id queries, selected result inspector, or a small top-N enrichment batch with a fixed cap.
- Do not trigger `favorites.syncOfficial` from typing. Official favorites sync remains an explicit user action or an existing auth-gated background workflow.
- If signed out, offline, or rate-limited, return local results with `diagnostics.remoteSuppressedReason` instead of surfacing an empty error state.

## Timeline Projection

Global search and Timeline should share the evidence model. Timeline is not a second parser; it is a projection over the same evidence rows.

Timeline v1:

- Query `type: "timeline_event"` for event rows that do not have a stronger entity result.
- Entity results include timeline evidence in `evidence`, so selecting a result can open the Timeline filtered to that entity.
- `primaryAction.kind = "focus-timeline"` should route to the Timeline view with filters encoded in URL params:
  - `/timeline?user=usr_...`
  - `/timeline?world=wrld_...`
  - `/timeline?avatar=avtr_...`
  - `/timeline?q=<normalizedQuery>`
- Timeline badges should be rendered from `SearchEvidence.kind`, not hardcoded per source table.

Required Timeline evidence examples:

```json
{
  "kind": "world_visit",
  "label": "Visited",
  "detail": "Joined wrld_abc:1234, friends+ instance, Japan region",
  "sourceId": "world_visits:42",
  "timeRange": {
    "start": "2026-04-27T11:12:00Z",
    "end": "2026-04-27T13:04:00Z"
  },
  "reliability": "verified",
  "privacy": "local-only"
}
```

```json
{
  "kind": "avatar_seen",
  "label": "Seen avatar",
  "detail": "Seen on Alice; thumbnail is cached detail match",
  "sourceId": "avatar_history:avtr_abc",
  "observedAt": "2026-04-27T12:20:00Z",
  "reliability": "verified",
  "privacy": "local-cache"
}
```

## Result Examples

World from local visits and favorites:

```json
{
  "type": "world",
  "id": "wrld_123",
  "displayName": "Moonlit Workshop",
  "subtitle": "Favorite · visited 6 times, last 2026-04-27",
  "source": {
    "kind": "mixed",
    "label": "Favorite + local visits",
    "updatedAt": "2026-04-27T13:04:00Z"
  },
  "evidence": [
    {
      "kind": "favorite",
      "label": "Favorite",
      "detail": "Saved in Library with local tags",
      "sourceId": "local_favorites:world:wrld_123:Library",
      "observedAt": "2026-04-27T10:00:00Z",
      "reliability": "verified",
      "privacy": "local-only"
    },
    {
      "kind": "world_visit",
      "label": "Visited 6x",
      "detail": "Most recent visit in friends+ instance, Japan region",
      "sourceId": "world_visits:42",
      "timeRange": {
        "start": "2026-04-27T11:12:00Z",
        "end": "2026-04-27T13:04:00Z"
      },
      "reliability": "verified",
      "privacy": "local-only"
    }
  ],
  "thumbnail": {
    "url": "https://thumb.local/...",
    "kind": "local-thumb",
    "source": "thumb.local",
    "verified": true,
    "alt": "Moonlit Workshop thumbnail"
  },
  "localStatus": {
    "state": "favorite",
    "isFavorite": true,
    "hasLocalCache": true,
    "has3dPreview": false,
    "visitCount": 6,
    "lastSeenAt": "2026-04-27T13:04:00Z"
  },
  "primaryAction": {
    "kind": "open",
    "label": "Open world",
    "route": "/worlds?select=wrld_123",
    "enabled": true
  },
  "confidence": 0.93
}
```

Historical avatar with reference-only image:

```json
{
  "type": "avatar",
  "id": "avtr_456",
  "displayName": "Cyber Jacket",
  "subtitle": "Seen on Alice · thumbnail unresolved",
  "source": {
    "kind": "local.avatar_history",
    "label": "Avatar history",
    "updatedAt": "2026-04-27T12:20:00Z"
  },
  "evidence": [
    {
      "kind": "avatar_seen",
      "label": "Seen avatar",
      "detail": "Log-derived avatar row; wearer current image is reference only",
      "sourceId": "avatar_history:avtr_456",
      "observedAt": "2026-04-27T12:20:00Z",
      "reliability": "verified",
      "privacy": "local-only"
    }
  ],
  "thumbnail": {
    "url": null,
    "kind": "placeholder",
    "source": "placeholder",
    "verified": false,
    "alt": "Cyber Jacket"
  },
  "localStatus": {
    "state": "seen-avatar",
    "isFavorite": false,
    "hasLocalCache": false,
    "has3dPreview": false,
    "firstSeenAt": "2026-04-27T12:20:00Z",
    "lastSeenAt": "2026-04-27T12:20:00Z",
    "warnings": ["thumbnail-reference-only"]
  },
  "primaryAction": {
    "kind": "inspect",
    "label": "Inspect evidence",
    "route": "/avatars?select=avtr_456",
    "enabled": true
  },
  "confidence": 0.72
}
```

## Implementation Cut

### 2 Weeks

Delivered as the first implementation cut: local-only `search.global` and a keyboard-first quick search surface. Remaining bullets in this section describe the intended v1 shape and should be treated as implementation notes for follow-up polish, not proof that remote enrichment exists.

Backend:

- Add a small core search aggregator over existing SQLite tables and cache probes.
- Add `search.global` host bridge with the schema above.
- Prefer direct SQL over calling pagination IPC handlers internally. Existing handlers stay as public API, but search needs indexed queries and entity merging.
- Add focused unit tests using temp SQLite data:
  - exact id match returns local result without remote attempt
  - favorite + visit evidence merges into one result
  - avatar history does not mark reference thumbnails as verified
  - remote mode `cached` performs no live API call

Frontend:

- Add a `Ctrl+K` / `Cmd+K` quick search overlay or command surface that calls `search.global`.
- Render evidence badges from `evidence[0]`, not from `type`.
- Provide deterministic placeholder thumbnails for null thumbnails.
- Primary actions open existing pages/routes only. Do not add destructive actions.
- Add mock IPC data so `pnpm --prefix web dev` remains useful.

Acceptance:

- Search works signed out and offline using only local evidence.
- Typing a query does not call live VRChat APIs unless `includeRemote: "debounced"` is explicitly used after debounce.
- Existing Avatars, SteamVR, Plugin UI, and CI behavior remain untouched except where a future implementation explicitly owns quick search UI.

### 1 Month

Make the search feel current without losing local-first behavior.

- Add FTS5-backed local index tables or virtual views for `favorites`, `world_visits`, `player_events`, `player_encounters`, and `avatar_history`.
- Add cached remote detail enrichment with TTL and negative cache.
- Add top-N selected-row detail enrichment, not full-result fanout.
- Add Timeline view or Timeline drawer backed by `SearchEvidence`.
- Add local cache / 3D preview evidence for avatars and cached assets:
  - `preview_3d` badge when a retained or regenerable GLB exists
  - `cache_asset` badge when a UnityFS cache entry is locally present
- Add "why this result" inspector that lists all evidence rows with timestamps and privacy labels.

Acceptance:

- 10k local history rows remain interactive.
- Reopening the app preserves the index and thumbnail evidence.
- Remote failures degrade to local results with a visible suppressed reason, not a broken search state.

### 3 Months

Turn Global Search into VRCSM's offline knowledge layer.

- Build a privacy-first offline indexer that incrementally ingests logs, screenshots metadata, avatar history, favorites, world visits, and cache artifacts.
- Add query operators:
  - `type:world`, `type:user`, `type:avatar`
  - `source:local`, `source:favorite`, `source:cache`
  - `after:YYYY-MM-DD`, `before:YYYY-MM-DD`
  - `has:3d`, `has:thumbnail`, `has:favorite`
- Add optional vector/visual avatar search as local-only enrichment when the experimental vector tables are enabled.
- Add Timeline export/reporting: entity evidence bundle that can be handed to support or used for personal audit.
- Add "cache impact" result mode: show which local cache artifacts support an avatar/world result before cleanup.

Acceptance:

- VRCSM can answer "where did I see this person/world/avatar and why does the app know it?" with local evidence even without network.
- Remote API use is explainable, cached, bounded, and never required for local history recall.
- The user can distinguish verified thumbnails, reference images, cached assets, and remote-only metadata at a glance.

## Non-Goals

- Do not build private avatar copying, bypasses, or any workflow that violates VRChat server-side ownership/visibility checks.
- Do not scrape VRChat APIs on every keystroke.
- Do not silently upload local history, cache paths, screenshots, or player encounter data.
- Do not reuse a wearer's current public avatar image as a verified historical avatar thumbnail.
- Do not make destructive cleanup actions available directly from global search v1.

## Next Worker Checklist

1. Start from this doc plus `MEMORY.md`, `docs/NEXT-AGENT-HANDOFF.md`, and `docs/MD-INDEX.md`.
2. Inspect current `Database.cpp`, `Database.h`, `DatabaseBridge.cpp`, `IpcBridge.cpp`, `web/src/lib/ipc.ts`, and `web/src/lib/types.ts` before coding.
3. Add tests before wiring remote enrichment.
4. Keep `search.global` local-only until the result schema and evidence rendering are stable.
5. Keep `docs/MD-INDEX.md`, `docs/NEXT-AGENT-HANDOFF.md`, and `CHANGELOG.md` synchronized when changing the shipped implementation.
