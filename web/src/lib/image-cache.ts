import { useEffect, useMemo, useState } from "react";
import { ipc } from "./ipc";

export interface CachedImageResult {
  id: string;
  url: string;
  localUrl?: string | null;
  imageCached: boolean;
  source: "disk" | "network" | "negative";
  error: string | null;
}

interface IpcResponse {
  results: CachedImageResult[];
}

type CacheEntry =
  | { state: "resolved"; localUrl: string | null; sourceUrl: string; expiresAt: number }
  | { state: "pending"; promise: Promise<string | null>; sourceUrl: string };

const memo = new Map<string, CacheEntry>();
const NEG_TTL_MS = 5 * 60_000;
const FOREVER = Number.POSITIVE_INFINITY;

// Hard ceiling on memo entries. The cache is keyed by id|url and previously
// grew monotonically (resolved entries hold FOREVER TTL), so a multi-hour
// browse session could accumulate tens of thousands of entries and leak heap
// in the long-lived WebView2 process. We cap it and evict in insertion order
// (Map preserves insertion order) once the ceiling is crossed.
const MAX_ENTRIES = 4_000;

function memoSet(key: string, entry: CacheEntry): void {
  // Re-insert moves the key to the most-recent position, giving a cheap
  // LRU-on-write so churned keys stay and cold keys age out first.
  if (memo.has(key)) memo.delete(key);
  memo.set(key, entry);
  if (memo.size > MAX_ENTRIES) {
    const overflow = memo.size - MAX_ENTRIES;
    let removed = 0;
    for (const oldKey of memo.keys()) {
      if (removed >= overflow) break;
      // Never evict the entry we just wrote.
      if (oldKey === key) continue;
      memo.delete(oldKey);
      removed += 1;
    }
  }
}

let generation = 0;
const listeners = new Set<() => void>();

function keyFor(id: string, url: string): string {
  return `${id}|${url}`;
}

function isAlreadyLocalImageUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "thumb.local" || host === "preview.local" || host === "screenshot-thumbs.local";
  } catch {
    return false;
  }
}

function isFresh(entry: CacheEntry, now: number): entry is Extract<CacheEntry, { state: "resolved" }> {
  return entry.state === "resolved" && entry.expiresAt > now;
}

function notify(): void {
  generation += 1;
  for (const listener of listeners) listener();
}

export async function cacheImageUrl(id: string, url: string): Promise<string | null> {
  if (!id || !url) return null;
  const key = keyFor(id, url);
  if (isAlreadyLocalImageUrl(url)) {
    memoSet(key, { state: "resolved", localUrl: url, sourceUrl: url, expiresAt: FOREVER });
    return url;
  }
  const now = Date.now();
  const hit = memo.get(key);
  if (hit) {
    if (hit.state === "pending") return hit.promise;
    if (isFresh(hit, now)) return hit.localUrl;
  }

  const promise = ipc
    .call<{ id: string; url: string }, IpcResponse>("images.cache", { id, url })
    .then((resp) => {
      const row = resp.results[0];
      if (!row || row.error) {
        memoSet(key, {
          state: "resolved",
          localUrl: null,
          sourceUrl: url,
          expiresAt: Date.now() + NEG_TTL_MS,
        });
        notify();
        return null;
      }
      const localUrl = row.localUrl ?? null;
      memoSet(key, {
        state: "resolved",
        localUrl,
        sourceUrl: url,
        expiresAt: localUrl ? FOREVER : Date.now() + NEG_TTL_MS,
      });
      notify();
      return localUrl;
    })
    .catch(() => {
      memo.delete(key);
      notify();
      return null;
    });
  memoSet(key, { state: "pending", promise, sourceUrl: url });
  return promise;
}

export function invalidateCachedImageUrl(id: string, url: string): void {
  if (!id || !url) return;
  memo.delete(keyFor(id, url));
  notify();
}

export function invalidateCachedImages(): void {
  memo.clear();
  notify();
}

export async function cacheImageUrls(
  items: Array<{ id: string; url: string }>,
): Promise<CachedImageResult[]> {
  const now = Date.now();
  const need: Array<{ id: string; url: string; key: string }> = [];
  const resolved = new Map<string, CachedImageResult>();

  for (const item of items) {
    if (!item.id || !item.url) continue;
    const key = keyFor(item.id, item.url);
    if (isAlreadyLocalImageUrl(item.url)) {
      memoSet(key, {
        state: "resolved",
        localUrl: item.url,
        sourceUrl: item.url,
        expiresAt: FOREVER,
      });
      resolved.set(key, {
        id: item.id,
        url: item.url,
        localUrl: item.url,
        imageCached: true,
        source: "disk",
        error: null,
      });
      continue;
    }
    const hit = memo.get(key);
    if (hit?.state === "resolved" && isFresh(hit, now)) {
      resolved.set(key, {
        id: item.id,
        url: item.url,
        localUrl: hit.localUrl,
        imageCached: Boolean(hit.localUrl),
        source: hit.localUrl ? "disk" : "negative",
        error: hit.localUrl ? null : "cached-negative",
      });
      continue;
    }
    if (hit?.state === "pending") {
      const awaited = await hit.promise;
      // Overlapping-batch guard: the prior batch's derived promise can resolve
      // to null even when that id actually succeeded (e.g. its batch's shared
      // catch cleared the key). Re-read the memo and prefer a freshly-resolved
      // positive entry so we don't flap this id to the fallback and re-fetch.
      const after = memo.get(key);
      const localUrl =
        after?.state === "resolved" && isFresh(after, Date.now())
          ? after.localUrl
          : awaited;
      resolved.set(key, {
        id: item.id,
        url: item.url,
        localUrl,
        imageCached: Boolean(localUrl),
        source: localUrl ? "disk" : "negative",
        error: localUrl ? null : "cached-negative",
      });
      continue;
    }
    need.push({ ...item, key });
  }

  if (need.length > 0) {
    const sharedPromise = ipc
      .call<{ items: Array<{ id: string; url: string }> }, IpcResponse>("images.cache", {
        items: need.map(({ id, url }) => ({ id, url })),
      })
      .then((resp) => resp.results);
    // Track the exact pending entries we insert so the shared catch only
    // removes keys still owned by *this* batch — never a key a concurrent
    // batch has since overwritten with its own pending/resolved entry.
    const ownPending = new Map<string, CacheEntry>();
    for (const item of need) {
      const entry: CacheEntry = {
        state: "pending",
        sourceUrl: item.url,
        promise: sharedPromise.then((rows) => rows.find((row) => row.id === item.id && row.url === item.url)?.localUrl ?? null),
      };
      ownPending.set(item.key, entry);
      memoSet(item.key, entry);
    }
    try {
      const rows = await sharedPromise;
      const byKey = new Map(rows.map((row) => [keyFor(row.id, row.url), row]));
      for (const item of need) {
        const row = byKey.get(item.key);
        const localUrl = row?.error ? null : row?.localUrl ?? null;
        memoSet(item.key, {
          state: "resolved",
          localUrl,
          sourceUrl: item.url,
          expiresAt: localUrl ? FOREVER : Date.now() + NEG_TTL_MS,
        });
        resolved.set(item.key, row ?? {
          id: item.id,
          url: item.url,
          localUrl,
          imageCached: Boolean(localUrl),
          source: localUrl ? "network" : "negative",
          error: localUrl ? null : "missing-result",
        });
      }
    } catch {
      for (const item of need) {
        // Only clear keys still holding *our* pending entry — a concurrent
        // batch may have already replaced it with a valid result.
        if (memo.get(item.key) === ownPending.get(item.key)) {
          memo.delete(item.key);
        }
      }
    } finally {
      notify();
    }
  }

  return items
    .map((item) => resolved.get(keyFor(item.id, item.url)))
    .filter((item): item is CachedImageResult => Boolean(item));
}

export function useCachedImageUrl(
  id: string | null | undefined,
  sourceUrl: string | null | undefined,
): { url: string | null; localUrl: string | null; loading: boolean } {
  const cacheKey = useMemo(() => (id && sourceUrl ? keyFor(id, sourceUrl) : null), [id, sourceUrl]);
  const [state, setState] = useState<{ localUrl: string | null; loading: boolean }>(() => {
    if (!cacheKey) return { localUrl: null, loading: false };
    const hit = memo.get(cacheKey);
    if (hit?.state === "resolved" && isFresh(hit, Date.now())) {
      return { localUrl: hit.localUrl, loading: false };
    }
    return { localUrl: null, loading: true };
  });
  const [tick, setTick] = useState(generation);

  useEffect(() => {
    const listener = () => setTick(generation);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!id || !sourceUrl || !cacheKey) {
      setState({ localUrl: null, loading: false });
      return;
    }
    const hit = memo.get(cacheKey);
    if (hit?.state === "resolved" && isFresh(hit, Date.now())) {
      setState({ localUrl: hit.localUrl, loading: false });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ localUrl: prev.localUrl, loading: true }));
    cacheImageUrl(id, sourceUrl).then((localUrl) => {
      if (!cancelled) setState({ localUrl, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, id, sourceUrl, tick]);

  return {
    url: state.localUrl ?? sourceUrl ?? null,
    localUrl: state.localUrl,
    loading: state.loading,
  };
}
