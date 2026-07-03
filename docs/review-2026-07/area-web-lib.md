# Review: web/src/lib (area: web-lib)

Date: 2026-07-01
Scope: `web/src/lib/**` only — IPC client, frontend caches, auth context, types, new pure-fn modules. Read-only audit; no source modified.

Verification baseline: line numbers cited below were read from disk on 2026-07-01. `useMemoryRadar.ts` confirmed deleted (`git status` shows `D`) and fully de-referenced — no source under `web/src/` imports it; `MemoryRadar.tsx` (page) uses `useRadar` from `@/lib/hooks/useRadar`, which still exists.

---

## CRITICAL

None found.

---

## HIGH

### H1. In-flight IPC promise leaks for long-running methods on bridge silence
File: `web/src/lib/ipc.ts:291-307`, `web/src/lib/ipc.ts:501-524`

Problem: methods in `LONG_RUNNING_METHODS` (`migrate.execute`, `scan`, `avatar.preview`, `favorites.syncOfficial`, `prints.upload`, `files.uploadImage`, etc.) disable the 60s timeout entirely (`applyTimeout = !LONG_RUNNING_METHODS.has(method)`, line 501). For these, `timerId` stays `null` and the pending slot is only ever removed when a matching response with the same `id` arrives in `handle()` (`ipc.ts:455-457`). If the host worker thread dies, the WebView2 message channel drops the response, or the host never posts a reply, the `Pending` entry lives in `this.pending` forever and the awaiting Promise never settles. The class comment at lines 281-285 acknowledges the leak risk for the default path, but the exemption list reintroduces it for exactly the methods most likely to hang (multi-GB copy, AssetRipper shell-out, full favorites-graph round-trip).

Impact: a single hung long-running call pins a Promise + closure (and any React state/query awaiting it) for the lifetime of the window. Callers like `migrate.execute` or `favorites.syncOfficial` that show a spinner will spin forever with no error path. There is no caller-side cancellation wired up despite the comment "callers own their own cancellation."

Concrete fix: give long-running methods a generous-but-finite ceiling (e.g. 10–15 min) instead of `null`, or expose an `AbortSignal`/cancellation token from `call()` so callers can free the slot. At minimum, add a `cancelAll()` path invoked on auth-expired/logout so stale long-running slots are reaped when the session resets.

### H2. `images.cache` memo grows unbounded with `FOREVER` TTL and never evicts
File: `web/src/lib/image-cache.ts:21-23`, `web/src/lib/image-cache.ts:79-84`, `web/src/lib/image-cache.ts:118-124`

Problem: the module-level `memo` Map stores every resolved image keyed by `${id}|${url}` with `expiresAt: FOREVER` (`POSITIVE_INFINITY`) for any successful local URL (lines 83, 123) and for already-local URLs (line 54). There is no size cap and no LRU eviction — entries are only removed by `invalidateCachedImageUrl` (single key, line 99), `invalidateCachedImages` (full clear, line 104, called on account reset), or a failed fetch (`memo.delete`, line 89). During a long session browsing many avatars/worlds/users (each row caches a distinct `id|url`), the Map grows monotonically. `seenThumbnails` further injects keys like `wearer:<cacheKey>` via `attachLocalUrl` (`seenThumbnails.ts:166`), compounding it.

Impact: unbounded heap growth in a long-lived WebView2 process meant to stay open for hours. A roster + feed + avatar-benchmark session can accumulate thousands of FOREVER entries that survive until logout. Same pattern: `thumbnails.ts` memo (FOREVER at lines 48, 138, 242) and `assets-cache.ts` memo (TTL-based but uncapped, line 42).

Concrete fix: add a max-entry ceiling (e.g. 2–4k) with insertion-order/LRU eviction in `cacheImageUrl`/`cacheImageUrls`, or attach a long finite TTL to "FOREVER" entries so periodic `isFresh` checks let stale keys fall out. Apply the same cap to `thumbnails.ts` and `assets-cache.ts`.

### H3. Overlapping `cacheImageUrls` batches can flap to fallback and re-fetch
File: `web/src/lib/image-cache.ts:147-158`, `web/src/lib/image-cache.ts:162-201`

Problem: in the batch path, an id that hits an existing `pending` slot does `await hit.promise` inside the per-item loop (lines 147-158). That awaited promise is the per-id derived promise from a prior `cacheImageUrls` call (line 172). If the original shared batch rejects, its `catch` only deletes keys in *its own* `need` set (line 197); a later caller awaiting the derived chain of an evicted key resolves to `null` (`...?.localUrl ?? null`) and the negative is not recorded, so the next render re-requests. Two overlapping batches for overlapping ids (common: list + detail panel mounting together) is therefore non-deterministic.

Impact: under concurrent batch calls for overlapping ids, images can flicker to the fallback tile and re-fetch repeatedly — wasted IPC and visible thumbnail flicker. Not a crash.

Concrete fix: in the `await hit.promise` branch, re-read `memo.get(key)` after the await and prefer a freshly-resolved entry; in the shared-promise `catch`, only delete keys still `pending` for *this* batch so a newer call's slot isn't clobbered.

---

## MEDIUM

### M1. Auth credentials flow through `call()`; no logging leak today but no guard against future regressions
File: `web/src/lib/auth-context.tsx:172-198`, `web/src/lib/auth-context.tsx:200-225`, `web/src/lib/ipc.ts:523`

Problem: `login` passes `{ username, password }` and `verifyTwoFactor` passes `{ method, code }` straight into `ipc.call`, which does `JSON.stringify(envelope)` then `postMessage` (`ipc.ts:523`). Verified there is currently **no** `console.*` logging of `params` anywhere in `ipc.ts` (only `console.warn(message)` at line 1849 on an unrelated path) and `auth-context` only logs `err.message` (lines 282, 287), so no password/2FA code is leaked today. The risk is a future `console.debug(envelope)` in `call()` or `handle()` would silently dump credentials.

Impact: latent — a one-line debug addition in the IPC core would log plaintext passwords. No live leak verified.

Concrete fix: add a redaction guard if any request logging is ever introduced (mask params for methods in an `AUTH_METHODS` set), and a unit/lint assertion that `call()` does not stringify params into console. Low effort, prevents a class of regression.

### M2. `assets-cache` and `thumbnails` low-priority queue timers are never cleared on unmount of the last consumer
File: `web/src/lib/thumbnails.ts:273-300`, `web/src/lib/assets-cache.ts:239-259`

Problem: `prefetchThumbnailsLowPriority`/`prefetchAssetsLowPriority` start a module-level `setTimeout` chain (`pumpLowPriorityQueue` / `flushLowPriorityQueue`) that re-arms itself while the queue is non-empty (thumbnails line 287; assets line 247). These timers are module-global and only cleared by explicit `resetLowPriorityThumbnailQueue` / `resetLowPriorityAssetQueue`, which are called from `invalidateThumbnails`/`invalidateAssets` (account reset). If a page that queued prefetches unmounts, the pump keeps firing IPC calls in the background until the queue drains.

Impact: minor wasted IPC/CPU after navigating away from a list page while a large prefetch backlog is still draining. Bounded (queue drains), not a true leak, but the work outlives the UI that needed it.

Concrete fix: acceptable as-is given the queue is bounded and self-terminating, but consider gating the pump on at least one mounted listener (`listeners.size > 0` / `invalidationListeners.size > 0`) so background tabs don't keep fetching.

### M3. `any` leakage in IPC return types weakens downstream type safety
File: `web/src/lib/ipc.ts:2055`, `:2063`, `:2177`, `:2238`, `:2243`, `:2267`, `:2461`, `:2483`, `:2497`, `:2517`, `:2753`, `:2761`; `web/src/lib/types.ts:385`, `:393`

Problem: several IPC wrappers return `{ items: any[] }` / `{ notifications: any[] }` / `{ prints: any[] }` / `{ files: any[] }`, and `writeConfig`/`writeSteamVrConfig` take `config: any` / `updates: any`. `SteamVrConfig.driver_vrlink` and `.steamvr` have `[key: string]: any` index signatures (`types.ts:385,393`). This violates the project's "TypeScript: strict mode, no `any`" standard (CLAUDE.md) and means callers of `notificationsList`, `printsList`, `filesList`, group/feed list helpers, etc. get untyped rows with no compile-time field checks.

Impact: type-safety holes at exactly the IPC boundary where backend shape drift is most likely. No runtime bug verified, but refactors lose their safety net.

Concrete fix: define DTO interfaces for notifications/prints/files/group rows (several already exist in `types.ts` — wire them in) and replace the `any` index signatures with explicit optional fields or `unknown` + narrowing. The `avatar-embedding.ts:103 as any` is justified and documented (transformers.js `.d.ts` gap) — leave it.

### M4. `friends.cache.v1` localStorage write is not the de-facto account-scope owner it appears to be
File: `web/src/lib/cache-ownership.ts:11-18`, writer at `web/src/pages/Friends.tsx:957-973`

Problem: `cache-ownership.ts` lists `vrcsm.friends.cache.v1` in `ACCOUNT_SCOPED_LOCAL_STORAGE_KEYS` (line 15) and clears it on login/logout/account-switch. But the cache is **written from a page** (`Friends.tsx:973`), not from `web/src/lib`, which is contrary to the project rule "reusable IPC/state in web/src/lib NOT pages." The key string is duplicated in two places (`cache-ownership.ts:11` and `Friends.tsx:957`) with no shared constant, so a rename in one spot silently breaks account-scoped clearing — stale friend data from account A would persist into account B's session.

Impact: correctness risk on account switch if the two literals ever drift. Verified they match today (`vrcsm.friends.cache.v1`).

Concrete fix: export `FRIENDS_CACHE_KEY` from a lib module (e.g. `cache-ownership.ts` or a `vrcFriends` helper) and import it in `Friends.tsx`; move the read/write helpers into `web/src/lib` to honor the layering rule.

---

## LOW

### L1. `addPreset` id generation can collide on rapid saves
File: `web/src/lib/status-presets.ts:87`

Problem: `const id = preset.id ?? `sp_${Date.now().toString(36)}_${existing.length}``. If two presets are added in the same millisecond at the same list length (e.g. add then remove then add), ids can collide, breaking React keys and the delete-by-id path (`removePreset`, line 95). The dedupe by `{label,status,description}` (lines 80-86) mitigates accidental dupes but not distinct presets created in the same tick.

Impact: very low — requires sub-ms double-add. Could cause a duplicate-key warning or wrong-row delete.

Concrete fix: use `crypto.randomUUID()` (already used in `ipc.ts:332`) or append a random suffix instead of `existing.length`.

### L2. `useStatusPresets` re-parses JSON on every render and every subscribed event
File: `web/src/lib/status-presets.ts:123-142`

Problem: `parsePresets(raw)` runs on every render (line 129) and the `subscribe` handler fires the store callback for *every* `storage` and `vrcsm:ui-pref-changed` event (lines 107-116), regardless of which key changed — unlike `notifications.ts` which filters by key set (`notifications.ts:50-55`). So any UI-pref change anywhere re-runs `useSyncExternalStore`'s `getSnapshot` (`readUiPrefString`) and re-parses.

Impact: minor wasted parse work; presets list is small (max 12). Not a re-render storm because `getSnapshot` returns the raw string and React bails if unchanged, but the subscribe over-fires.

Concrete fix: filter in `subscribe` by `STORAGE_KEY` (mirror `notifications.ts`), and/or memoize `parsePresets(raw)` with `useMemo([raw])`.

### L3. `vrchat-server-status` `setStatus((prev) => prev)` on fetch failure is a no-op write
File: `web/src/lib/vrchat-server-status.ts:78`

Problem: the catch branch calls `setStatus((prev) => prev)` to "leave prior value." Returning the same reference makes React skip the update, so this is harmless but also pointless — it can simply do nothing.

Impact: cosmetic; no bug.

Concrete fix: drop the `setStatus((prev) => prev)` line (or replace with a comment). Optional.

### L4. `cacheImageUrls` final `await hit.promise` inside a sequential loop serializes deduped hits
File: `web/src/lib/image-cache.ts:147-158`

Problem: the per-item loop `await`s each pending hit one at a time before reaching the batch `need` collection. A large `items` array where many ids are already in-flight will await them sequentially rather than in parallel.

Impact: minor latency on big mixed batches; correctness unaffected.

Concrete fix: collect pending hits and `Promise.all` them after the loop, or resolve them off the critical path.

---

## Area health summary

- IPC client core is solid for the common path (60s timeout + slot cleanup + auth-expired interceptor are correct), but the long-running-method timeout exemption (H1) reopens the unbounded-pending leak the timeout was added to fix, and there is no logout/auth-expired reaping of pending slots.
- The three frontend caches (image/thumbnails/assets) share a well-designed pending-dedupe + negative-TTL + generation-listener pattern, but all three use `FOREVER` or uncapped Maps with no eviction (H2), and the overlapping-batch path in image-cache is racy (H3) — both worsen over long sessions, which is this app's normal usage.
- Auth context, account-scoping (`cache-ownership.ts`), and the new pure-fn modules (`status-presets`, `name-history`, `vrchat-server-status`, `shell-api`, `user-color`) are clean and well-guarded (no token logging verified, localStorage reads are try-wrapped and validated). Main gaps are layering (`friends.cache.v1` written from a page, M4) and residual `any` at the IPC boundary (M3) violating the no-`any` standard. `useMemoryRadar` deletion is fully clean.
