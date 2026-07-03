import { describe, expect, it } from "vitest";
import { buildAvatarPatch } from "@/lib/vrc-media";
import {
  filterAvatarModels,
  normalizeAvatarModelRecords,
} from "@/lib/avatar-models";
import type { AvatarSearchResult } from "@/lib/types";

function ownedAvatar(over: Partial<AvatarSearchResult> = {}): AvatarSearchResult {
  return {
    id: "avtr_owned_1",
    name: "Owned Name",
    description: "Owned description",
    authorId: "usr_me",
    authorName: "me",
    imageUrl: "https://img/owned.png",
    thumbnailImageUrl: "https://img/owned-thumb.png",
    releaseStatus: "private",
    version: 3,
    tags: [],
    unityPackages: [],
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-06-01T00:00:00Z",
    ...over,
  } as AvatarSearchResult;
}

describe("buildAvatarPatch", () => {
  it("returns null when nothing changed", () => {
    const patch = buildAvatarPatch(
      { name: "A", description: "B", releaseStatus: "private", tags: ["x"] },
      { name: "A", description: "B", releaseStatus: "private", tags: ["x"] },
    );
    expect(patch).toBeNull();
  });

  it("includes only the fields that changed", () => {
    const patch = buildAvatarPatch(
      { name: "Old", description: "Desc", releaseStatus: "private" },
      { name: "New", description: "Desc", releaseStatus: "private" },
    );
    expect(patch).toEqual({ name: "New" });
  });

  it("trims name comparison so whitespace-only edits are no-ops", () => {
    const patch = buildAvatarPatch({ name: "Hi" }, { name: "  Hi  " });
    expect(patch).toBeNull();
  });

  it("detects tag set changes regardless of order", () => {
    const same = buildAvatarPatch({ tags: ["a", "b"] }, { tags: ["b", "a"] });
    expect(same).toBeNull();
    const changed = buildAvatarPatch({ tags: ["a"] }, { tags: ["a", "b"] });
    expect(changed).toEqual({ tags: ["a", "b"] });
  });

  it("treats releaseStatus visibility flips as a change", () => {
    const patch = buildAvatarPatch(
      { releaseStatus: "private" },
      { releaseStatus: "public" },
    );
    expect(patch).toEqual({ releaseStatus: "public" });
  });
});

describe("normalizeAvatarModelRecords with owned source", () => {
  it("tags owned avatars with the owned source and surfaces their fields", () => {
    const records = normalizeAvatarModelRecords({ owned: [ownedAvatar()] });
    expect(records).toHaveLength(1);
    expect(records[0].sources).toContain("owned");
    expect(records[0].name).toBe("Owned Name");
    expect(records[0].releaseStatus).toBe("private");
  });

  it("lets owned data override history-derived fields for the same id", () => {
    const records = normalizeAvatarModelRecords({
      owned: [ownedAvatar({ name: "Authoritative", releaseStatus: "public" })],
      history: [
        {
          avatar_id: "avtr_owned_1",
          avatar_name: "Stale History Name",
          release_status: "private",
        } as never,
      ],
    });
    const record = records.find((r) => r.avatarId === "avtr_owned_1");
    expect(record?.name).toBe("Authoritative");
    expect(record?.releaseStatus).toBe("public");
    expect(record?.sources).toEqual(expect.arrayContaining(["owned", "history"]));
  });

  it("filters by the owned source", () => {
    const records = normalizeAvatarModelRecords({
      owned: [ownedAvatar()],
      history: [
        { avatar_id: "avtr_history_only", avatar_name: "H" } as never,
      ],
    });
    const ownedOnly = filterAvatarModels(records, { source: "owned" });
    expect(ownedOnly.map((r) => r.avatarId)).toEqual(["avtr_owned_1"]);
  });
});
