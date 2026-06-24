import { useEffect, useState } from "react";
import { ipc } from "./ipc";

export type AssetType = "world" | "avatar" | "user";

export interface AssetResolveItem {
  type: AssetType;
  id: string;
  hintName?: string | null;
  hintImageUrl?: string | null;
}

export interface AssetCacheItem {
  type: AssetType;
  id: string;
  displayName?: string | null;
  subtitle?: string | null;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  localThumbnailUrl?: string | null;
  source?: string | null;
  confidence?: string | null;
  fetchedAt?: string | null;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  negativeUntil?: string | null;
  stale?: boolean;
  negative?: boolean;
  payload?: Record<string, unknown>;
}

interface AssetResolveResponse {
  results: AssetCacheItem[];
  resolvedAt?: string;
  ok?: boolean;
}

type CacheEntry =
  | { state: "resolved"; asset: AssetCacheItem; expiresAt: number }
  | { state: "pending"; promise: Promise<AssetCacheItem | null> };

const memo = new Map<string, CacheEntry>();
const lowPriorityQueue = new Map<string, AssetResolveItem>();
let lowPriorityTimer: number | null = null;
let generation = 0;

const listeners = new Set<() => void>();
const RESOLVED_TTL_MS = 10 * 60_000;
const NEGATIVE_TTL_MS = 5 * 60_000;
const LOW_PRIORITY_DELAY_MS = 250;
const LOW_PRIORITY_BATCH_SIZE = 48;

function cacheKey(type: AssetType, id: string): string {
  return `${type}|${id}`;
}

function isSupported(item: AssetResolveItem): boolean {
  if (!item.id) return false;
  if (item.type === "world") return item.id.startsWith("wrld_");
  if (item.type === "avatar") return item.id.startsWith("avtr_");
  return item.id.startsWith("usr_");
}

function isFresh(entry: CacheEntry, now: number): entry is { state: "resolved"; asset: AssetCacheItem; expiresAt: number } {
  return entry.state === "resolved" && entry.expiresAt > now;
}

function assetExpiresAt(asset: AssetCacheItem): number {
  if (asset.negative) return Date.now() + NEGATIVE_TTL_MS;
  return Date.now() + RESOLVED_TTL_MS;
}

function notify(): void {
  generation += 1;
  for (const listener of listeners) listener();
}

function normalizedItems(items: AssetResolveItem[]): AssetResolveItem[] {
  const seen = new Set<string>();
  const out: AssetResolveItem[] = [];
  for (const item of items) {
    if (!isSupported(item)) continue;
    const key = cacheKey(item.type, item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      type: item.type,
      id: item.id,
      hintName: item.hintName ?? undefined,
      hintImageUrl: item.hintImageUrl ?? undefined,
    });
    if (out.length >= 256) break;
  }
  return out;
}

function mergeAsset(asset: AssetCacheItem): void {
  memo.set(cacheKey(asset.type, asset.id), {
    state: "resolved",
    asset,
    expiresAt: assetExpiresAt(asset),
  });
}

function placeholderFromItem(item: AssetResolveItem): AssetCacheItem {
  return {
    type: item.type,
    id: item.id,
    displayName: item.hintName ?? null,
    thumbnailUrl: item.hintImageUrl ?? null,
    imageUrl: null,
    localThumbnailUrl: null,
    source: "placeholder",
    confidence: "placeholder",
    stale: true,
    negative: false,
    payload: {},
  };
}

async function fetchBatch(items: AssetResolveItem[], refresh = false): Promise<AssetCacheItem[]> {
  const normalized = normalizedItems(items);
  if (normalized.length === 0) return [];

  const resp = await ipc.call<
    { items: AssetResolveItem[]; refresh?: boolean },
    AssetResolveResponse
  >("assets.resolve", { items: normalized, refresh });

  const rows = resp.results ?? [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isSupported(row)) continue;
    seen.add(cacheKey(row.type, row.id));
    mergeAsset(row);
  }
  for (const item of normalized) {
    const key = cacheKey(item.type, item.id);
    if (!seen.has(key)) {
      memo.set(key, {
        state: "resolved",
        asset: placeholderFromItem(item),
        expiresAt: Date.now() + NEGATIVE_TTL_MS,
      });
    }
  }
  notify();
  return rows;
}

function needsFetch(item: AssetResolveItem, now: number): boolean {
  const hit = memo.get(cacheKey(item.type, item.id));
  if (!hit) return true;
  if (hit.state === "pending") return false;
  if (!isFresh(hit, now)) return true;
  if (item.hintName && !hit.asset.displayName) return true;
  if (item.hintImageUrl && !assetImageUrl(hit.asset)) return true;
  return false;
}

export function assetImageUrl(asset: AssetCacheItem | null | undefined): string | null {
  return asset?.localThumbnailUrl ?? asset?.thumbnailUrl ?? asset?.imageUrl ?? null;
}

export function invalidateAssets(): void {
  memo.clear();
  resetLowPriorityAssetQueue();
  notify();
}

export function invalidateAsset(type: AssetType, id: string): void {
  memo.delete(cacheKey(type, id));
  lowPriorityQueue.delete(cacheKey(type, id));
  notify();
}

export async function resolveAssets(items: AssetResolveItem[], options: { refresh?: boolean } = {}): Promise<AssetCacheItem[]> {
  const now = Date.now();
  const need = normalizedItems(items).filter((item) => options.refresh || needsFetch(item, now));
  if (need.length === 0) {
    return normalizedItems(items)
      .map((item) => memo.get(cacheKey(item.type, item.id)))
      .filter((entry): entry is { state: "resolved"; asset: AssetCacheItem; expiresAt: number } =>
        Boolean(entry && entry.state === "resolved"),
      )
      .map((entry) => entry.asset);
  }

  const batchPromise = fetchBatch(need, options.refresh).catch(() => {
    for (const item of need) memo.delete(cacheKey(item.type, item.id));
    notify();
    return [];
  });

  for (const item of need) {
    memo.set(cacheKey(item.type, item.id), {
      state: "pending",
      promise: batchPromise.then((rows) => (
        rows.find((row) => row.type === item.type && row.id === item.id) ?? null
      )),
    });
  }

  return batchPromise;
}

export function prefetchAssets(items: AssetResolveItem[], options: { refresh?: boolean } = {}): void {
  void resolveAssets(items, options);
}

export function resetLowPriorityAssetQueue(): void {
  lowPriorityQueue.clear();
  if (lowPriorityTimer !== null) {
    window.clearTimeout(lowPriorityTimer);
    lowPriorityTimer = null;
  }
}

function flushLowPriorityQueue(): void {
  lowPriorityTimer = null;
  const batch = Array.from(lowPriorityQueue.values()).slice(0, LOW_PRIORITY_BATCH_SIZE);
  for (const item of batch) lowPriorityQueue.delete(cacheKey(item.type, item.id));
  if (batch.length > 0) {
    prefetchAssets(batch);
  }
  if (lowPriorityQueue.size > 0) {
    lowPriorityTimer = window.setTimeout(flushLowPriorityQueue, LOW_PRIORITY_DELAY_MS);
  }
}

export function prefetchAssetsLowPriority(items: AssetResolveItem[]): void {
  for (const item of normalizedItems(items)) {
    if (!needsFetch(item, Date.now())) continue;
    lowPriorityQueue.set(cacheKey(item.type, item.id), item);
  }
  if (lowPriorityQueue.size > 0 && lowPriorityTimer === null) {
    lowPriorityTimer = window.setTimeout(flushLowPriorityQueue, LOW_PRIORITY_DELAY_MS);
  }
}

export function useAsset(
  type: AssetType,
  id: string | null | undefined,
  options: {
    enabled?: boolean;
    hintName?: string | null;
    hintImageUrl?: string | null;
    refresh?: boolean;
  } = {},
): { asset: AssetCacheItem | null; loading: boolean } {
  const enabled = options.enabled ?? true;
  const item = id ? { type, id, hintName: options.hintName, hintImageUrl: options.hintImageUrl } : null;
  const [localGeneration, setLocalGeneration] = useState(generation);
  const [state, setState] = useState<{ asset: AssetCacheItem | null; loading: boolean }>(() => {
    if (!item || !isSupported(item)) return { asset: null, loading: false };
    const hit = memo.get(cacheKey(type, item.id));
    if (hit && isFresh(hit, Date.now())) return { asset: hit.asset, loading: false };
    return { asset: options.hintName || options.hintImageUrl ? placeholderFromItem(item) : null, loading: enabled };
  });

  useEffect(() => {
    const listener = () => setLocalGeneration(generation);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!item || !isSupported(item)) {
      setState({ asset: null, loading: false });
      return;
    }

    const key = cacheKey(type, item.id);
    const hit = memo.get(key);
    if (hit && isFresh(hit, Date.now())) {
      setState({ asset: hit.asset, loading: false });
      return;
    }
    if (!enabled) {
      setState({
        asset: options.hintName || options.hintImageUrl ? placeholderFromItem(item) : null,
        loading: false,
      });
      return;
    }

    let cancelled = false;
    setState((prev) => ({
      asset: prev.asset ?? (options.hintName || options.hintImageUrl ? placeholderFromItem(item) : null),
      loading: true,
    }));
    resolveAssets([item], { refresh: options.refresh }).then((rows) => {
      if (cancelled) return;
      const row = rows.find((asset) => asset.type === type && asset.id === item.id);
      const latest = row ?? memo.get(key);
      if (latest && "state" in latest && latest.state === "resolved") {
        setState({ asset: latest.asset, loading: false });
      } else {
        setState({ asset: row ?? placeholderFromItem(item), loading: false });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [type, id, enabled, options.hintName, options.hintImageUrl, options.refresh, localGeneration]);

  return state;
}

ipc.on("auth.loginCompleted", () => {
  invalidateAssets();
});
