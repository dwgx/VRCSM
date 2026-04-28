import { useEffect, useState } from "react";
import { ipc } from "./ipc";

/**
 * Thumbnail resolver — talks to the C++ host `thumbnails.fetch` IPC which
 * in turn calls the public VRChat API and keeps a disk cache. For the
 * frontend we layer a second, in-process cache so repeated renders of
 * the same id (list ↔ inspector, re-mounts, navigation) don't re-hit
 * the bridge.
 *
 * Contract:
 *   - `useThumbnail(id)` returns `{ url: string | null, loading: boolean }`
 *   - `url === null` means "we asked and there is nothing" (private
 *     avatar, deleted world, etc.) — the caller should render a fallback
 *   - `url === undefined` never happens while `loading === false`
 *   - Fetches are deduplicated: concurrent hook instances on the same id
 *     share a single in-flight promise
 */

export interface ThumbnailResult {
  id: string;
  url: string | null;
  localUrl?: string | null;
  cached: boolean;
  imageCached?: boolean;
  source?: "memory" | "disk" | "network" | "negative";
  error: string | null;
}

interface IpcResponse {
  results: ThumbnailResult[];
}

type CacheEntry =
  | { state: "resolved"; url: string | null; expiresAt: number }
  | { state: "pending"; promise: Promise<string | null> };

const memo = new Map<string, CacheEntry>();
const lowPriorityQueue = new Set<string>();
let lowPriorityTimer: number | null = null;

// A successful URL never expires (the resolved CDN URL doesn't move within a
// session). A negative result (genuinely not-found) is cached for 5 min so
// signing in / privacy changes don't keep showing a stale empty tile forever.
// A transient IPC/network failure is NOT cached — every subsequent useThumbnail
// call will retry, instead of the old "miss once, dark forever" behaviour.
const NEG_TTL_MS = 5 * 60_000;
const FOREVER = Number.POSITIVE_INFINITY;

function isResolvedFresh(e: CacheEntry, now: number): e is { state: "resolved"; url: string | null; expiresAt: number } {
  return e.state === "resolved" && e.expiresAt > now;
}

function needsFetch(id: string, now: number): boolean {
  if (!isLookupSupported(id)) return false;
  const hit = memo.get(id);
  if (!hit) return true;
  if (hit.state === "pending") return false;
  return !isResolvedFresh(hit, now);
}

// Generation counter + listeners let mounted `useThumbnail` hooks re-run
// their fetch effect after something clears the cache. Without this,
// null results recorded while signed-out would stick around forever
// even after the user logs in and private-avatar thumbnails start
// resolving on the host side.
let memoGeneration = 0;
const invalidationListeners = new Set<() => void>();

function notifyInvalidation(): void {
  memoGeneration += 1;
  for (const listener of invalidationListeners) {
    listener();
  }
}

export function invalidateThumbnails(): void {
  memo.clear();
  resetLowPriorityThumbnailQueue();
  notifyInvalidation();
}

export function invalidateThumbnail(id: string): void {
  memo.delete(id);
  lowPriorityQueue.delete(id);
  notifyInvalidation();
}

export function resetLowPriorityThumbnailQueue(): void {
  lowPriorityQueue.clear();
  if (lowPriorityTimer !== null) {
    window.clearTimeout(lowPriorityTimer);
    lowPriorityTimer = null;
  }
}

// Auto-wire auth state changes → cache invalidation. This fires exactly
// once at module load (we subscribe forever), so the frontend no longer
// has to remember to bump the memo after login/logout at every call
// site. Avatar cards and friend rows refresh without a page reload.
ipc.on("auth.loginCompleted", () => {
  invalidateThumbnails();
});

/**
 * Accept both world and avatar prefixes. The C++ host is now auth-aware
 * (v0.2.0 AuthStore): worlds always work anonymously, avatars only work
 * when the user has a VRChat session cookie. If we're not logged in yet
 * the host returns `url: null` and the frontend falls back to the
 * procedural cube. Once login lands, the same useThumbnail call starts
 * returning real CDN URLs without any call-site change.
 */
function isLookupSupported(id: string): boolean {
  return id.startsWith("wrld_") || id.startsWith("avtr_");
}

function fetchOne(id: string): Promise<string | null> {
  const now = Date.now();
  const hit = memo.get(id);
  if (hit) {
    if (hit.state === "pending") return hit.promise;
    if (isResolvedFresh(hit, now)) return Promise.resolve(hit.url);
    // Expired negative-cache entry — fall through and re-fetch.
  }
  if (!isLookupSupported(id)) {
    memo.set(id, { state: "resolved", url: null, expiresAt: FOREVER });
    return Promise.resolve(null);
  }
  const promise = ipc
    .call<{ ids: string[]; downloadImages?: boolean }, IpcResponse>("thumbnails.fetch", {
      ids: [id],
      downloadImages: true,
    })
    .then((resp) => {
      const row = resp.results.find((r) => r.id === id) ?? resp.results[0];
      const hadError = !!row?.error;
      const url = row?.localUrl ?? row?.url ?? null;
      if (hadError) {
        // Backend reported a transient failure (network, 5xx). Don't poison
        // the cache — drop the entry so the next useThumbnail tries again.
        memo.delete(id);
      } else {
        memo.set(id, {
          state: "resolved",
          url,
          expiresAt: url ? FOREVER : Date.now() + NEG_TTL_MS,
        });
      }
      return url;
    })
    .catch(() => {
      // IPC-layer failure (bridge dropped the call, deserialization). Treat
      // as transient — don't cache.
      memo.delete(id);
      return null;
    });
  memo.set(id, { state: "pending", promise });
  return promise;
}

export function useThumbnail(id: string | null, enabled = true): {
  url: string | null;
  loading: boolean;
} {
  const [state, setState] = useState<{ url: string | null; loading: boolean }>(
    () => {
      if (!id) return { url: null, loading: false };
      const hit = memo.get(id);
      if (hit && isResolvedFresh(hit, Date.now())) {
        return { url: hit.url, loading: false };
      }
      return { url: null, loading: enabled };
    },
  );
  // Track memo generation so login / logout triggers an automatic
  // re-fetch for every mounted hook — no per-page bookkeeping needed.
  const [generation, setGeneration] = useState(memoGeneration);

  useEffect(() => {
    const listener = () => setGeneration(memoGeneration);
    invalidationListeners.add(listener);
    return () => {
      invalidationListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!id) {
      setState({ url: null, loading: false });
      return;
    }
    const hit = memo.get(id);
    if (hit && isResolvedFresh(hit, Date.now())) {
      setState({ url: hit.url, loading: false });
      return;
    }
    if (!enabled) {
      setState({ url: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ url: prev.url, loading: true }));
    fetchOne(id).then((url) => {
      if (!cancelled) setState({ url, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [id, enabled, generation]);

  return state;
}

/** Warm the cache for a list of ids — used on page mount to batch-prefetch
 * everything visible in one IPC round-trip. Safe to call repeatedly; ids
 * already cached or in-flight are skipped. Unsupported prefixes
 * resolve synchronously to `null` without any IPC traffic. */
export function prefetchThumbnails(ids: string[]): void {
  const now = Date.now();
  // Resolve unsupported ids inline so later useThumbnail calls hit the
  // memo directly. No IPC, no round-trip.
  for (const id of ids) {
    const existing = memo.get(id);
    if (existing && (existing.state === "pending" || isResolvedFresh(existing, now))) continue;
    if (!isLookupSupported(id)) {
      memo.set(id, { state: "resolved", url: null, expiresAt: FOREVER });
    }
  }

  const need = ids.filter((id) => needsFetch(id, now));
  if (need.length === 0) return;

  const batchPromise = ipc
    .call<{ ids: string[]; downloadImages?: boolean }, IpcResponse>("thumbnails.fetch", {
      ids: need,
      downloadImages: true,
    })
    .then((resp) => {
      const seen = new Set<string>();
      for (const row of resp.results) {
        seen.add(row.id);
        if (row.error) {
          memo.delete(row.id);
          continue;
        }
        const url = row.localUrl ?? row.url ?? null;
        memo.set(row.id, {
          state: "resolved",
          url,
          expiresAt: url ? FOREVER : Date.now() + NEG_TTL_MS,
        });
      }
      // Any id we requested but the backend didn't return a row for: drop
      // the pending placeholder so a follow-up call retries.
      for (const id of need) {
        if (!seen.has(id)) memo.delete(id);
      }
      // Notify mounted useThumbnail hooks so they immediately render the
      // newly-cached URLs instead of waiting for individual promise chains.
      notifyInvalidation();
    })
    .catch(() => {
      // Transient batch failure — drop pending entries so retries go through.
      for (const id of need) memo.delete(id);
      notifyInvalidation();
    });

  // Mark each id as pending so individual useThumbnail calls don't
  // double-fetch — they'll resolve off the same batch promise.
  for (const id of need) {
    memo.set(id, {
      state: "pending",
      promise: batchPromise.then(() => {
        const e = memo.get(id);
        return e && e.state === "resolved" ? e.url : null;
      }),
    });
  }
}

function pumpLowPriorityQueue(): void {
  lowPriorityTimer = null;
  const now = Date.now();
  const batch: string[] = [];
  for (const id of Array.from(lowPriorityQueue)) {
    lowPriorityQueue.delete(id);
    if (!needsFetch(id, now)) continue;
    batch.push(id);
    if (batch.length >= 6) break;
  }
  if (batch.length > 0) {
    prefetchThumbnails(batch);
  }
  if (lowPriorityQueue.size > 0) {
    lowPriorityTimer = window.setTimeout(pumpLowPriorityQueue, 450);
  }
}

/** Queue lookahead thumbnails in small delayed batches so visible rows and
 * explicit user clicks keep the fast lane. */
export function prefetchThumbnailsLowPriority(ids: string[]): void {
  const now = Date.now();
  for (const id of ids) {
    if (needsFetch(id, now)) lowPriorityQueue.add(id);
  }
  if (lowPriorityQueue.size === 0 || lowPriorityTimer !== null) return;
  lowPriorityTimer = window.setTimeout(pumpLowPriorityQueue, 250);
}
