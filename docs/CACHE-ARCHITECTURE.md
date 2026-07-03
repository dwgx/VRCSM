# VRCSM Cache Architecture

Last updated: 2026-06-25

This is the registry to read before changing cache behavior. It is intentionally practical: identify the owner, the source of truth, the stale rules, and the invalidation path before adding another cache.

## Ownership Rules

- VRCSM-owned caches live under `%LocalAppData%\VRCSM`, the app database, WebView2 user-data, or browser memory/localStorage. VRCSM may create, prune, invalidate, or factory-reset these.
- VRChat-owned data lives under `%LocalLow%\VRChat\VRChat`, the user's Pictures screenshots folder, SteamVR/Steam config, and remote VRChat API state. VRCSM may read it, index it, or show dry-run delete/migration plans, but must not mutate it unless the user explicitly started that workflow.
- Source-of-truth order for metadata is: current VRChat API response > verified local VRChat files/logs > persisted VRCSM cache > frontend in-memory cache > UI hint/placeholder.
- Lower-confidence hints must not overwrite higher-confidence data. If a cache records confidence/source, writes must preserve verified rows over page-level hints.
- Caches that contain account-derived data must be scoped by account or invalidated on logout/account switch. Do not let one VRChat account's friends, profile, or local preferences leak into another account's UI.

## Freshness Policy

- Positive metadata should have a clear TTL or an explicit "valid until invalidated" rule. If no durable TTL exists, frontend memory caches should stay short-lived.
- Negative cache entries are allowed only to prevent tight retry loops. Use short TTLs; current frontend image/asset negative caches use about 5 minutes.
- Stale rows may be displayed when they are labeled as stale or only used as a fast first paint. Background refresh should improve them without blocking visible rows.
- Disk caches need size or row caps before broad prefetching. Prefer LRU by `last_used_at`, bounded batch sizes, and visible-row priority over loading entire pages.
- Invalidation events to respect: logout, account switch, factory reset, explicit `assets.invalidate`, update install/download cleanup, plugin uninstall, thumbnail source URL change, VRChat cache root mtime change, and user-initiated cache deletion.

## Storage Boundaries

- SQLite/persistent DB stores queryable app data and durable metadata. It is the right place for cross-page asset metadata and account-scoped records.
- `%LocalAppData%\VRCSM` file caches store downloaded or generated blobs such as images, GLB previews, update installers, plugin data, and cache indexes.
- WebView2 user-data stores renderer cookies, IndexedDB, localStorage, service-worker/cache state, and browser internals. Treat it as renderer state, not the app database. It cannot be fully wiped while WebView2 is alive; factory reset marks it for next launch.
- React Query is process memory. It owns deduplication, visible-page freshness, and live Pipeline patching while the app is open. It is not a durable source of truth.
- Browser localStorage is acceptable for UI preferences and temporary warm-start hints only. Avoid putting authoritative API or cross-account state there unless scoped and invalidated.

## Registry

| Store | Owner | Location / API | Source of truth | Scope | Freshness / caps | Invalidation |
|---|---|---|---|---|---|---|
| `asset_cache` | VRCSM core DB | SQLite table in app DB; IPC `assets.resolve`, `assets.prefetch`, `assets.invalidate` | VRChat API and verified local evidence beat hints | Must be account-safe for user-derived rows; world/avatar metadata can be shared only if not private | Has `expires_at`, `negative_until`, `last_used_at`, confidence/source; future pruning should use row cap/LRU | `assets.invalidate`, logout/account switch for account-derived rows, source URL changes, factory reset |
| `thumb-cache.json` | VRCSM core | `%LocalAppData%\VRCSM\thumb-cache.json` | Remote image URL plus local file existence | Shared by URL/id; avoid account-private assumptions | Legacy JSON index; keep small enough to parse quickly | Factory reset, image URL change, thumbnail resolver repair |
| `thumb-cache-files` | VRCSM core | `%LocalAppData%\VRCSM\thumb-cache-files`, served as `https://thumb.local/` | Downloaded image bytes from remote CDN/API URLs | Shared by validated content/URL | Needs disk cap/LRU before aggressive prefetch | Factory reset, `thumb-cache.json` repair, source URL change |
| `preview-cache` | VRCSM core | `%LocalAppData%\VRCSM\preview-cache`, served as `http://preview.local/` | Generated GLB from local VRChat bundle | Local machine cache; may reflect VRChat-owned bundle inputs | Keyed by bundle hash; should be size-capped before bulk generation | Factory reset, source bundle/hash change, preview pipeline invalidation |
| `cache-index.json` | VRCSM core | `%LocalAppData%\VRCSM\cache-index.json` | Current `Cache-WindowsPlayer` directory scan | Local machine and VRChat cache-root specific | Stale when cache root mtime changes; background rebuild, O(1) lookup when warm | VRChat cache root mtime change, cache path change, factory reset |
| WebView2 | Host/WebView2 | `%LocalAppData%\VRCSM\WebView2` | Renderer runtime state only | Per Windows user, not a durable app source | Browser-managed | Cookie clear on logout where possible; full wipe on next launch after factory reset marker |
| Screenshots thumbs | Host | `%LocalAppData%\VRCSM\screenshot-thumbs`, served as `https://screenshot-thumbs.local/` | VRChat screenshot files in Pictures | Local machine/user | Generated JPEG thumbs; should be bounded by source file existence and eventual disk cap | Screenshot rescan, missing source file, factory reset |
| Updates | VRCSM updater | `%LocalAppData%\VRCSM\updates` | GitHub release asset metadata and validated MSI file | Machine-wide app update cache | Downloader deletes old MSIs except current keep path | Successful download/install flow, update cleanup, factory reset |
| `plugins/plugin-data` | Plugin system | `%LocalAppData%\VRCSM\plugin-data\<id>` | Individual plugin contract | Per plugin; plugin may store account-derived data | Plugin-owned; host should enforce permissions and uninstall boundaries | Plugin uninstall, factory reset, plugin-specific clear action |
| Frontend cache ownership | Frontend | `web/src/lib/cache-ownership.ts` | Auth boundary and explicit reset events | Account-derived browser/process/query caches | Removes account-scoped localStorage, clears image/asset memo caches, and removes React Query roots while preserving UI prefs | `login`, `logout`, `auth-expired`, `account-switch`, manual reset |
| React Query | Frontend | In-memory TanStack Query cache | IPC/API responses while process is open | Current renderer/session/account | Uses per-query `staleTime`; no disk persistence | Query invalidation, Pipeline events, `cache-ownership.ts`, page refresh |
| `assets-cache.ts` | Frontend | Module-level memory map | `asset_cache` IPC result | Current renderer/session | Positive default about 10 minutes; negative about 5 minutes; low-priority batches capped at 48 | `invalidateAssets*`, `assets.invalidate`, page reload |
| `image-cache.ts` | Frontend | Module-level memory map over `images.cache` IPC | Local thumbnail URL from host resolver | Current renderer/session | Positive local URL cached for process lifetime; negative about 5 minutes | `invalidateCachedImageUrl`, `invalidateCachedImages`, page reload, source URL change |
| Friends localStorage | Frontend | `vrcsm.friends.cache.v1`, plus refresh prefs | `friends.list` and Pipeline patches for warm first paint | Account-derived; must be cleared or keyed on logout/account switch | Warm-start only; React Query/current API response owns active truth | `cache-ownership.ts`, `friends.list` success replacement, factory reset |
| Wearer reference localStorage | Frontend | `vrcsm.seen.wearerReferences.v1`, `vrcsm.avatars.wearerReferences.v2` | Resolved profile/current-avatar image references used as thumbnail fallback | Account-derived warm hints | Shared helper TTL is 24h; page-level cache is warm-start only and not authoritative | `cache-ownership.ts`, manual refresh, factory reset |

## Before Changing Cache Behavior

1. Find the registry row or add one for the store being changed.
2. State the source of truth and what can overwrite what.
3. Decide whether the data is account-scoped.
4. Set positive, stale, and negative-cache rules.
5. Add row/disk caps before broad prefetch or background scans.
6. Wire account-derived frontend invalidation through `web/src/lib/cache-ownership.ts`, plus any durable backend invalidation.
7. Keep VRChat-owned data read-only unless the user invoked a destructive workflow.
