// Shared helpers for "avatars seen on other players" thumbnail resolution.
// Both the Models page (Avatars.tsx) and Avatar Benchmark page need to fall
// back to the wearer's current profile/avatar image when a public-search
// match for the avatar name doesn't exist. The resolution is intentionally
// labelled as a *reference* — it's the wearer's current avatar, not the
// historical one that was logged — and the UI surfaces a "REF" badge so
// the user knows the image isn't a verified match.
//
// This module owns the localStorage cache and the shape contract; the
// query plumbing (`useQuery`, throttling, persistence) is duplicated in
// each page because their data shapes differ.

const WEARER_REFERENCE_CACHE_KEY = "vrcsm.seen.wearerReferences.v1";
const WEARER_REFERENCE_TTL_MS = 24 * 60 * 60_000;

export type WearerReferenceStatus = "loading" | "resolved" | "miss";

export interface WearerReference {
  status: WearerReferenceStatus;
  url?: string;
  localUrl?: string;
  userId?: string;
  displayName?: string;
  avatarName?: string;
  avatarId?: string;
  /**
   * If set, the wearer's current-avatar name normalized-equals the logged
   * avatar name at the moment of resolution. Use this to promote the
   * reference image as a *verified* thumbnail rather than a fallback.
   */
  verifiedForAvatarName?: string;
  resolvedAtMs?: number;
}

interface CacheShape {
  [key: string]: WearerReference;
}

function safeReadCache(): CacheShape {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(WEARER_REFERENCE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: CacheShape = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!key || !value || typeof value !== "object") continue;
      const item = value as Partial<WearerReference>;
      if (item.status !== "resolved" && item.status !== "miss") continue;
      // Drop entries past TTL so stale wearer-current images don't linger.
      if (item.resolvedAtMs && Date.now() - item.resolvedAtMs > WEARER_REFERENCE_TTL_MS) continue;
      out[key] = {
        status: item.status,
        url: typeof item.url === "string" ? item.url : undefined,
        localUrl: typeof item.localUrl === "string" ? item.localUrl : undefined,
        userId: typeof item.userId === "string" ? item.userId : undefined,
        displayName: typeof item.displayName === "string" ? item.displayName : undefined,
        avatarName: typeof item.avatarName === "string" ? item.avatarName : undefined,
        avatarId: typeof item.avatarId === "string" ? item.avatarId : undefined,
        verifiedForAvatarName:
          typeof item.verifiedForAvatarName === "string" ? item.verifiedForAvatarName : undefined,
        resolvedAtMs: typeof item.resolvedAtMs === "number" ? item.resolvedAtMs : Date.now(),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function safeWriteCache(cache: CacheShape): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WEARER_REFERENCE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Quota exceeded — drop the in-memory cache write silently. The
    // resolved data is still in the React state for the active session.
  }
}

let cacheMemo: CacheShape | null = null;

export function loadWearerReferenceCache(): CacheShape {
  if (cacheMemo === null) {
    cacheMemo = safeReadCache();
  }
  return cacheMemo;
}

export function saveWearerReference(key: string, ref: WearerReference): void {
  const cache = loadWearerReferenceCache();
  cache[key] = { ...ref, resolvedAtMs: ref.resolvedAtMs ?? Date.now() };
  cacheMemo = cache;
  safeWriteCache(cache);
}

export function readWearerReference(key: string): WearerReference | undefined {
  const cache = loadWearerReferenceCache();
  return cache[key];
}

export function normalizeAvatarName(name?: string | null): string {
  return (name ?? "")
    .normalize("NFKC")
    .replace(/[._\-‐‑‒–—―\s]+/g, "")
    .toLowerCase()
    .trim();
}

export function isSameAvatarName(a?: string | null, b?: string | null): boolean {
  const left = normalizeAvatarName(a);
  const right = normalizeAvatarName(b);
  return Boolean(left && right && left === right);
}

/**
 * Return the highest-trust profile image for a user. Prefers the explicit
 * profile pic override (which the user uploaded as their public avatar
 * frame), then falls back to the current-avatar image, then thumbnail.
 * Returns undefined if the input is falsy or none of the fields are set.
 */
export function pickProfileImage(profile: {
  profilePicOverride?: string | null;
  currentAvatarImageUrl?: string | null;
  currentAvatarThumbnailImageUrl?: string | null;
} | null | undefined): string | undefined {
  if (!profile) return undefined;
  return (
    profile.profilePicOverride
    || profile.currentAvatarImageUrl
    || profile.currentAvatarThumbnailImageUrl
    || undefined
  ) || undefined;
}

import { cacheImageUrl } from "@/lib/image-cache";

/**
 * Wrap a resolved WearerReference with a host-cached `localUrl` so the
 * <img> tag can load it cross-origin. VRChat's CDN serves the file
 * endpoints with cookies; the browser drops them on cross-origin
 * requests, so the image silently 401s. The host downloads the file
 * with auth and re-serves it through the `cache-images.local` virtual
 * host, which IS same-origin from the WebView's POV.
 *
 * Returns the original reference if caching fails (we still keep the
 * remote URL — it might work in the future when the user clicks Refresh).
 */
export async function attachLocalUrl(
  cacheKey: string,
  reference: WearerReference,
): Promise<WearerReference> {
  if (reference.status !== "resolved" || !reference.url) return reference;
  if (reference.localUrl) return reference;
  const localUrl = await cacheImageUrl(`wearer:${cacheKey}`, reference.url).catch(() => null);
  if (!localUrl) return reference;
  return { ...reference, localUrl };
}
