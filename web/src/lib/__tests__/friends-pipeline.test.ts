import { describe, expect, it } from "vitest";

import { applyFriendPipelineEvent } from "@/lib/friends-pipeline";
import type { Friend, FriendsListResult } from "@/lib/types";

function friend(
  partial: Partial<Friend> & Pick<Friend, "id" | "displayName">,
): Friend {
  return {
    username: null,
    currentAvatarImageUrl: null,
    currentAvatarThumbnailImageUrl: null,
    statusDescription: null,
    status: "active",
    location: "offline",
    last_platform: null,
    bio: null,
    developerType: null,
    last_login: null,
    last_activity: null,
    profilePicOverride: null,
    userIcon: null,
    tags: [],
    ...partial,
  };
}

function list(friends: Friend[], touched = 10): FriendsListResult {
  return { friends, __touchedAt: touched };
}

describe("applyFriendPipelineEvent", () => {
  it("patches friend-location in place and stamps __touchedAt", () => {
    const current = list([
      friend({
        id: "usr_a",
        displayName: "Ada",
        location: "wrld_aaa:1~region(us)",
      }),
    ]);
    const next = applyFriendPipelineEvent(current, "friend-location", {
      userId: "usr_a",
      location: "wrld_bbb:2~region(jp)",
    });
    expect(next?.friends[0]?.location).toBe("wrld_bbb:2~region(jp)");
    expect(next?.__touchedAt ?? 0).toBeGreaterThan(10);
  });

  it("marks friend-offline without dropping the row", () => {
    const current = list([
      friend({ id: "usr_a", displayName: "Ada", location: "wrld_aaa:1" }),
    ]);
    const next = applyFriendPipelineEvent(current, "friend-offline", {
      userId: "usr_a",
    });
    expect(next?.friends).toHaveLength(1);
    expect(next?.friends[0]?.location).toBe("offline");
    expect(next?.friends[0]?.status).toBe("offline");
  });

  it("appends friend-add and removes friend-delete", () => {
    const current = list([
      friend({ id: "usr_a", displayName: "Ada", location: "offline" }),
    ]);
    const added = applyFriendPipelineEvent(current, "friend-add", {
      user: friend({ id: "usr_b", displayName: "Bea", location: "private" }),
    });
    expect(added?.friends.map((f) => f.id)).toEqual(["usr_b", "usr_a"]);
    const removed = applyFriendPipelineEvent(added!, "friend-delete", {
      userId: "usr_a",
    });
    expect(removed?.friends.map((f) => f.id)).toEqual(["usr_b"]);
  });

  it("returns null for unknown types or missing current list", () => {
    expect(applyFriendPipelineEvent(null, "friend-location", { userId: "x" })).toBeNull();
    expect(
      applyFriendPipelineEvent(list([]), "something-else", { userId: "x" }),
    ).toBeNull();
  });
});
