import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the IPC client so we can assert the gating: when the flag is OFF the
// helper must perform NO IPC at all and return an empty array.
const avatarsHarvestIds = vi.fn(async () => ({
  ids: ["avtr_aaaa1111-2222-3333-4444-555566667777", "avtr_bbbb"],
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    avatarsHarvestIds: () => avatarsHarvestIds(),
  },
}));

import {
  canHarvestAvatarIds,
  harvestLocalAvatarIds,
  newlyHarvestedIds,
  sanitizeHarvestedIds,
} from "@/lib/avatar-harvest";

afterEach(() => {
  avatarsHarvestIds.mockClear();
});

describe("canHarvestAvatarIds", () => {
  it("is true only when the flag is explicitly enabled", () => {
    expect(canHarvestAvatarIds(true)).toBe(true);
    expect(canHarvestAvatarIds(false)).toBe(false);
    // defensive: non-strict-true values must not enable harvesting
    expect(canHarvestAvatarIds(undefined as unknown as boolean)).toBe(false);
    expect(canHarvestAvatarIds(1 as unknown as boolean)).toBe(false);
  });
});

describe("harvestLocalAvatarIds gating", () => {
  it("performs NO IPC and returns [] when the flag is OFF", async () => {
    const ids = await harvestLocalAvatarIds(false);
    expect(ids).toEqual([]);
    expect(avatarsHarvestIds).not.toHaveBeenCalled();
  });

  it("calls IPC and returns sanitized ids when the flag is ON", async () => {
    const ids = await harvestLocalAvatarIds(true);
    expect(avatarsHarvestIds).toHaveBeenCalledTimes(1);
    expect(ids).toEqual([
      "avtr_aaaa1111-2222-3333-4444-555566667777",
      "avtr_bbbb",
    ]);
  });
});

describe("sanitizeHarvestedIds", () => {
  it("keeps only well-formed unique avtr_ ids, first-seen order", () => {
    expect(
      sanitizeHarvestedIds([
        "avtr_abc123",
        " avtr_abc123 ",
        "avtr_def456",
        "usr_not_an_avatar",
        "avtr_zzz",
        "",
        42,
        null,
        "avtr_0a1b",
      ]),
    ).toEqual(["avtr_abc123", "avtr_def456", "avtr_0a1b"]);
  });
});

describe("newlyHarvestedIds", () => {
  it("returns harvested ids not already known, preserving order", () => {
    expect(
      newlyHarvestedIds(
        ["avtr_a", "avtr_b", "avtr_c"],
        ["avtr_b"],
      ),
    ).toEqual(["avtr_a", "avtr_c"]);
  });
});
