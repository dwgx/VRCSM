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

let generation = 0;
const listeners = new Set<() => void>();

function keyFor(id: string, url: string): string {
  return `${id}|${url}`;
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
        memo.set(key, {
          state: "resolved",
          localUrl: null,
          sourceUrl: url,
          expiresAt: Date.now() + NEG_TTL_MS,
        });
        notify();
        return null;
      }
      const localUrl = row.localUrl ?? null;
      memo.set(key, {
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
  memo.set(key, { state: "pending", promise, sourceUrl: url });
  return promise;
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
      const localUrl = await hit.promise;
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
    for (const item of need) {
      memo.set(item.key, {
        state: "pending",
        sourceUrl: item.url,
        promise: sharedPromise.then((rows) => rows.find((row) => row.id === item.id && row.url === item.url)?.localUrl ?? null),
      });
    }
    try {
      const rows = await sharedPromise;
      const byKey = new Map(rows.map((row) => [keyFor(row.id, row.url), row]));
      for (const item of need) {
        const row = byKey.get(item.key);
        const localUrl = row?.error ? null : row?.localUrl ?? null;
        memo.set(item.key, {
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
      for (const item of need) memo.delete(item.key);
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
