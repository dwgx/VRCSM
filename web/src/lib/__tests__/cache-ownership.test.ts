import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  removeQueries: vi.fn(),
  invalidateAssets: vi.fn(),
  invalidateThumbnails: vi.fn(),
  invalidateCachedImages: vi.fn(),
  clearWearerReferenceCache: vi.fn(),
}));

vi.mock("../queryClient", () => ({
  queryClient: {
    removeQueries: mocks.removeQueries,
  },
}));

vi.mock("../assets-cache", () => ({
  invalidateAssets: mocks.invalidateAssets,
}));

vi.mock("../thumbnails", () => ({
  invalidateThumbnails: mocks.invalidateThumbnails,
}));

vi.mock("../image-cache", () => ({
  invalidateCachedImages: mocks.invalidateCachedImages,
}));

vi.mock("../seenThumbnails", () => ({
  WEARER_REFERENCE_CACHE_KEY: "vrcsm.seen.wearerReferences.v1",
  clearWearerReferenceCache: mocks.clearWearerReferenceCache,
}));

import {
  ACCOUNT_SCOPED_LOCAL_STORAGE_KEYS,
  resetAccountScopedCaches,
} from "../cache-ownership";

describe("cache ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("clears account-scoped browser snapshots without dropping UI preferences", () => {
    for (const key of ACCOUNT_SCOPED_LOCAL_STORAGE_KEYS) {
      window.localStorage.setItem(key, "cached");
    }
    window.localStorage.setItem("vrcsm.friends.liveRefresh", "true");
    window.localStorage.setItem("vrcsm.cache.pageSize", "96");

    resetAccountScopedCaches("logout");

    for (const key of ACCOUNT_SCOPED_LOCAL_STORAGE_KEYS) {
      expect(window.localStorage.getItem(key)).toBeNull();
    }
    expect(window.localStorage.getItem("vrcsm.friends.liveRefresh")).toBe("true");
    expect(window.localStorage.getItem("vrcsm.cache.pageSize")).toBe("96");
  });

  it("invalidates process image caches and account-scoped query roots", () => {
    resetAccountScopedCaches("account-switch");

    expect(mocks.invalidateAssets).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateThumbnails).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateCachedImages).toHaveBeenCalledTimes(1);
    expect(mocks.clearWearerReferenceCache).toHaveBeenCalledTimes(1);
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ["user.me"] });
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ["friends.list"] });
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ["friendLog.recent"] });
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ["user.getProfile"] });
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ["avatar.details"] });
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ["assets.resolve"] });
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ["favorites.lists"] });
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ["favorites.items"] });
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ["groups.list"] });
  });
});
