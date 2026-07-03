import { invalidateAssets } from "./assets-cache";
import { invalidateCachedImages } from "./image-cache";
import { ipc } from "./ipc";
import { qk } from "./query-keys";
import { queryClient } from "./queryClient";
import {
  WEARER_REFERENCE_CACHE_KEY,
  clearWearerReferenceCache,
} from "./seenThumbnails";
import { invalidateThumbnails } from "./thumbnails";

const FRIENDS_CACHE_KEY = "vrcsm.friends.cache.v1";
const AVATAR_WEARER_REFERENCE_CACHE_KEY = "vrcsm.avatars.wearerReferences.v2";

export const ACCOUNT_SCOPED_LOCAL_STORAGE_KEYS = [
  FRIENDS_CACHE_KEY,
  WEARER_REFERENCE_CACHE_KEY,
  AVATAR_WEARER_REFERENCE_CACHE_KEY,
] as const;

export type AccountScopedCacheResetReason =
  | "login"
  | "logout"
  | "auth-expired"
  | "account-switch"
  | "manual";

const ACCOUNT_SCOPED_QUERY_ROOTS = [
  qk.auth.meRoot,
  qk.friends.root,
  qk.friends.logRoot,
  qk.feed.root,
  qk.users.profileRoot,
  qk.avatars.detailsRoot,
  qk.assets.resolveRoot,
  qk.favorites.listsRoot,
  qk.favorites.itemsRoot,
  qk.groups.listRoot,
] as const;

export function clearAccountScopedLocalStorage(): void {
  if (typeof window === "undefined") return;
  for (const key of ACCOUNT_SCOPED_LOCAL_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // localStorage can be disabled in tests or constrained WebView contexts.
    }
  }
}

export function invalidateAccountScopedProcessCaches(): void {
  invalidateAssets();
  invalidateThumbnails();
  invalidateCachedImages();
  clearWearerReferenceCache();
}

export function clearAccountScopedQueryCaches(): void {
  for (const queryKey of ACCOUNT_SCOPED_QUERY_ROOTS) {
    queryClient.removeQueries({ queryKey });
  }
}

export function resetAccountScopedCaches(reason: AccountScopedCacheResetReason): void {
  // Reap in-flight IPC calls when a session ends or switches accounts, so a
  // long-running call started under the previous session can't keep its
  // pending slot (and any spinner awaiting it) alive past the transition.
  // Login starts a fresh session with nothing to reap.
  if (reason !== "login") {
    ipc.cancelAll(reason === "auth-expired" ? "auth_expired" : "cancelled");
  }
  clearAccountScopedLocalStorage();
  invalidateAccountScopedProcessCaches();
  clearAccountScopedQueryCaches();
}
