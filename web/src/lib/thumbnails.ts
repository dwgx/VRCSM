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
  cached: boolean;
  error: string | null;
}

interface IpcResponse {
  results: ThumbnailResult[];
}

type CacheEntry =
  | { state: "resolved"; url: string | null }
  | { state: "pending"; promise: Promise<string | null> };

const memo = new Map<string, CacheEntry>();

// Generation counter + listeners let mounted `useThumbnail` hooks re-run
// their fetch effect after something clears the cache. Without this,
// null results recorded while signed-out would stick around forever
// even after the user logs in and private-avatar thumbnails start
// resolving on the host side.
let memoGeneration = 0;
const invalidationListeners = new Set<() => void>();

export function invalidateThumbnails(): void {
  memo.clear();
  memoGeneration += 1;
  for (const listener of invalidationListeners) {
    listener();
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
  const hit = memo.get(id);
  if (hit) {
    if (hit.state === "resolved") return Promise.resolve(hit.url);
    return hit.promise;
  }
  if (!isLookupSupported(id)) {
    memo.set(id, { state: "resolved", url: null });
    return Promise.resolve(null);
  }
  const promise = ipc
    .call<{ ids: string[] }, IpcResponse>("thumbnails.fetch", { ids: [id] })
    .then((resp) => {
      const row = resp.results.find((r) => r.id === id) ?? resp.results[0];
      const url = row?.url ?? null;
      memo.set(id, { state: "resolved", url });
      return url;
    })
    .catch(() => {
      // On network / IPC failure, cache a null so we don't retry storm.
      // The user can invalidate by refreshing the app.
      memo.set(id, { state: "resolved", url: null });
      return null;
    });
  memo.set(id, { state: "pending", promise });
  return promise;
}

export function useThumbnail(id: string | null): {
  url: string | null;
  loading: boolean;
} {
  const [state, setState] = useState<{ url: string | null; loading: boolean }>(
    () => {
      if (!id) return { url: null, loading: false };
      const hit = memo.get(id);
      if (hit && hit.state === "resolved") {
        return { url: hit.url, loading: false };
      }
      return { url: null, loading: true };
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
    if (hit && hit.state === "resolved") {
      setState({ url: hit.url, loading: false });
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
  }, [id, generation]);

  return state;
}

/** Warm the cache for a list of ids — used on page mount to batch-prefetch
 * everything visible in one IPC round-trip. Safe to call repeatedly; ids
 * already cached or in-flight are skipped. Unsupported prefixes (avatars)
 * resolve synchronously to `null` without any IPC traffic. */
export function prefetchThumbnails(ids: string[]): void {
  // Resolve unsupported ids inline so later useThumbnail calls hit the
  // memo directly. No IPC, no round-trip.
  for (const id of ids) {
    if (memo.has(id)) continue;
    if (!isLookupSupported(id)) {
      memo.set(id, { state: "resolved", url: null });
    }
  }

  const need = ids.filter((id) => {
    const hit = memo.get(id);
    return !hit && isLookupSupported(id);
  });
  if (need.length === 0) return;

  const batchPromise = ipc
    .call<{ ids: string[] }, IpcResponse>("thumbnails.fetch", { ids: need })
    .then((resp) => {
      for (const row of resp.results) {
        memo.set(row.id, { state: "resolved", url: row.url ?? null });
      }
      // Notify mounted useThumbnail hooks so they immediately render the
      // newly-cached URLs instead of waiting for individual promise chains.
      memoGeneration += 1;
      for (const listener of invalidationListeners) {
        listener();
      }
    })
    .catch(() => {
      for (const id of need) {
        memo.set(id, { state: "resolved", url: null });
      }
      memoGeneration += 1;
      for (const listener of invalidationListeners) {
        listener();
      }
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
