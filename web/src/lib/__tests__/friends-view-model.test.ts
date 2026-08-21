import { describe, expect, it } from "vitest";

import { applyFriendPipelineEvent } from "@/lib/friends-pipeline";
import {
  buildLocationGroups,
  buildLocationVirtualRows,
  buildStatusVirtualRows,
  countSmartViews,
  filterFriendsByQuery,
  filterFriendsBySmartView,
  friendLocationSectionId,
  visibleWorldIdsFromRows,
} from "@/lib/friends-view-model";
import type { Friend, FriendsListResult } from "@/lib/types";

const WORLD_A = "wrld_aaa:inst1~region(us)";
const WORLD_A_EU = "wrld_aaa:inst1~region(eu)";
const WORLD_B = "wrld_bbb:inst2~hidden(usr_owner)~region(jp)";

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

describe("friendLocationSectionId", () => {
  it("keeps the full world location string as the key", () => {
    expect(friendLocationSectionId(WORLD_A)).toBe(WORLD_A);
    expect(friendLocationSectionId(WORLD_A_EU)).toBe(WORLD_A_EU);
    expect(friendLocationSectionId(WORLD_A)).not.toBe(
      friendLocationSectionId(WORLD_A_EU),
    );
  });

  it("buckets empty, null, and offline together", () => {
    expect(friendLocationSectionId(null)).toBe("offline");
    expect(friendLocationSectionId("")).toBe("offline");
    expect(friendLocationSectionId("offline")).toBe("offline");
  });

  it("keeps private and traveling out of world groups", () => {
    expect(friendLocationSectionId("private")).toBe("private");
    expect(friendLocationSectionId("traveling")).toBe("traveling");
  });
});

describe("buildLocationGroups", () => {
  it("groups by exact location tag and skips private/offline", () => {
    const friends = [
      friend({ id: "usr_1", displayName: "A", location: WORLD_A }),
      friend({ id: "usr_2", displayName: "B", location: WORLD_A }),
      friend({ id: "usr_3", displayName: "C", location: WORLD_B }),
      friend({ id: "usr_4", displayName: "D", location: "private" }),
      friend({ id: "usr_5", displayName: "E", location: "offline" }),
      friend({ id: "usr_6", displayName: "F", location: "traveling" }),
    ];
    const groups = buildLocationGroups(friends);
    expect(Object.keys(groups).sort()).toEqual([WORLD_A, WORLD_B].sort());
    expect(groups[WORLD_A]).toHaveLength(2);
    expect(groups[WORLD_B]).toHaveLength(1);
  });
});

describe("buildLocationVirtualRows", () => {
  it("puts same-as-me first even for a singleton", () => {
    const friends = [
      friend({ id: "usr_1", displayName: "Solo", location: WORLD_B }),
      friend({ id: "usr_2", displayName: "CrowdA", location: WORLD_A }),
      friend({ id: "usr_3", displayName: "CrowdB", location: WORLD_A }),
    ];
    const rows = buildLocationVirtualRows({
      friends,
      selfLocation: WORLD_B,
      collapsed: new Set(),
    });
    const headers = rows.filter((r) => r.kind === "header");
    expect(headers[0]?.sectionId).toBe(WORLD_B);
    expect(headers[0]?.kind === "header" && headers[0].pinned).toBe("self");
    expect(headers[0]?.count).toBe(1);
    expect(headers[1]?.sectionId).toBe(WORLD_A);
    expect(headers[1]?.count).toBe(2);
  });

  it("does not mix private, traveling, or offline into a wrld_ section", () => {
    const friends = [
      friend({ id: "usr_1", displayName: "InWorld", location: WORLD_A }),
      friend({ id: "usr_2", displayName: "Hid", location: "private" }),
      friend({ id: "usr_3", displayName: "Move", location: "traveling" }),
      friend({ id: "usr_4", displayName: "Off", location: "offline", status: "offline" }),
    ];
    const rows = buildLocationVirtualRows({
      friends,
      selfLocation: null,
      collapsed: new Set(),
    });
    const worldFriends = rows.filter(
      (r) => r.kind === "friend" && r.locationKey === WORLD_A,
    );
    expect(worldFriends).toHaveLength(1);
    expect(worldFriends[0]?.kind === "friend" && worldFriends[0].friend.id).toBe(
      "usr_1",
    );
    expect(rows.some((r) => r.kind === "header" && r.sectionId === "private")).toBe(
      true,
    );
    expect(
      rows.some((r) => r.kind === "header" && r.sectionId === "traveling"),
    ).toBe(true);
    expect(rows.some((r) => r.kind === "header" && r.sectionId === "offline")).toBe(
      true,
    );
  });

  it("splits the same world across regions into two sections", () => {
    const friends = [
      friend({ id: "usr_1", displayName: "West", location: WORLD_A }),
      friend({ id: "usr_2", displayName: "East", location: WORLD_A_EU }),
    ];
    const rows = buildLocationVirtualRows({
      friends,
      selfLocation: null,
      collapsed: new Set(),
    });
    const headers = rows.filter((r) => r.kind === "header");
    expect(headers).toHaveLength(2);
    expect(new Set(headers.map((h) => h.sectionId))).toEqual(
      new Set([WORLD_A, WORLD_A_EU]),
    );
  });

  it("hides friend rows when a section is collapsed", () => {
    const friends = [
      friend({ id: "usr_1", displayName: "A", location: WORLD_A }),
      friend({ id: "usr_2", displayName: "B", location: WORLD_A }),
    ];
    const rows = buildLocationVirtualRows({
      friends,
      selfLocation: null,
      collapsed: new Set([WORLD_A]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("header");
    expect(rows[0]?.kind === "header" && rows[0].count).toBe(2);
  });

  it("returns no rows for an empty list", () => {
    expect(
      buildLocationVirtualRows({
        friends: [],
        selfLocation: WORLD_A,
        collapsed: new Set(),
      }),
    ).toEqual([]);
  });

  it("builds a header per instance for 500 friends including offline", () => {
    const crowd = Array.from({ length: 500 }, (_, i) =>
      friend({
        id: `usr_${i}`,
        displayName: `User ${String(i).padStart(3, "0")}`,
        location: i < 400 ? "offline" : i < 450 ? WORLD_A : WORLD_B,
        status: i < 400 ? "offline" : "active",
      }),
    );
    const rows = buildLocationVirtualRows({
      friends: crowd,
      selfLocation: WORLD_A,
      collapsed: new Set(),
    });
    expect(rows.filter((r) => r.kind === "friend")).toHaveLength(500);
    const headers = rows.filter((r) => r.kind === "header");
    expect(headers[0]?.kind === "header" && headers[0].pinned).toBe("self");
    expect(headers[0]?.count).toBe(50);
    expect(headers.some((h) => h.sectionId === "offline" && h.count === 400)).toBe(
      true,
    );
  });

  it("moves a friend between sections after a pipeline location patch", () => {
    const alice = friend({ id: "usr_alice", displayName: "Alice", location: WORLD_A });
    const bob = friend({ id: "usr_bob", displayName: "Bob", location: WORLD_A });
    let list: FriendsListResult = { friends: [alice, bob], __touchedAt: 1 };
    const next = applyFriendPipelineEvent(list, "friend-location", {
      userId: "usr_alice",
      location: WORLD_B,
    });
    expect(next).not.toBeNull();
    expect(next!.__touchedAt ?? 0).toBeGreaterThan(1);
    const rows = buildLocationVirtualRows({
      friends: next!.friends,
      selfLocation: null,
      collapsed: new Set(),
    });
    const aliceRow = rows.find(
      (r) => r.kind === "friend" && r.friend.id === "usr_alice",
    );
    const bobRow = rows.find(
      (r) => r.kind === "friend" && r.friend.id === "usr_bob",
    );
    expect(aliceRow?.kind === "friend" && aliceRow.locationKey).toBe(WORLD_B);
    expect(bobRow?.kind === "friend" && bobRow.locationKey).toBe(WORLD_A);
  });
});

describe("smart views and query", () => {
  const friends = [
    friend({ id: "usr_1", displayName: "Ada", location: WORLD_A, status: "join me" }),
    friend({ id: "usr_2", displayName: "Bea", location: WORLD_A, status: "ask me" }),
    friend({ id: "usr_3", displayName: "Cyd", location: "private", status: "busy" }),
    friend({
      id: "usr_4",
      displayName: "Dot",
      location: "offline",
      status: "offline",
      bio: "likes cats",
    }),
  ];
  const groups = buildLocationGroups(friends);
  const favs = new Set(["usr_3"]);

  it("counts sameInstance as 2+ on the same tag, not self", () => {
    const counts = countSmartViews(friends, favs, groups);
    expect(counts.sameInstance).toBe(2);
    expect(counts.favorites).toBe(1);
    expect(counts.offline).toBe(1);
    expect(counts.joinable).toBe(2);
  });

  it("filters smart views", () => {
    expect(
      filterFriendsBySmartView(friends, "sameInstance", favs, groups).map(
        (f) => f.id,
      ),
    ).toEqual(["usr_1", "usr_2"]);
    expect(
      filterFriendsBySmartView(friends, "favorites", favs, groups).map((f) => f.id),
    ).toEqual(["usr_3"]);
  });

  it("matches query on name, bio, and note", () => {
    const notes = new Map([["usr_3", "secret memo"]]);
    expect(
      filterFriendsByQuery(friends, "  ada  ", {
        noteSearchIndex: notes,
        trustLabel: () => "visitor",
      }).map((f) => f.id),
    ).toEqual(["usr_1"]);
    expect(
      filterFriendsByQuery(friends, "cats", {
        noteSearchIndex: notes,
        trustLabel: () => "visitor",
      }).map((f) => f.id),
    ).toEqual(["usr_4"]);
    expect(
      filterFriendsByQuery(friends, "secret", {
        noteSearchIndex: notes,
        trustLabel: () => "visitor",
      }).map((f) => f.id),
    ).toEqual(["usr_3"]);
  });
});

describe("buildStatusVirtualRows", () => {
  it("uses status buckets, not location", () => {
    const friends = [
      friend({ id: "usr_1", displayName: "A", status: "join me", location: WORLD_A }),
      friend({ id: "usr_2", displayName: "B", status: "offline", location: "offline" }),
    ];
    const rows = buildStatusVirtualRows({
      friends,
      collapsed: new Set(),
    });
    const headers = rows.filter((r) => r.kind === "header");
    expect(headers.map((h) => h.kind === "header" && h.bucket)).toEqual([
      "joinMe",
      "offline",
    ]);
  });
});

describe("visibleWorldIdsFromRows", () => {
  it("collects world ids from visible headers and the selected friend", () => {
    const friends = [
      friend({ id: "usr_1", displayName: "A", location: WORLD_A }),
      friend({ id: "usr_2", displayName: "B", location: WORLD_B }),
    ];
    const rows = buildLocationVirtualRows({
      friends,
      selfLocation: null,
      collapsed: new Set(),
    });
    const headerIndexes = rows
      .map((r, i) => (r.kind === "header" ? i : -1))
      .filter((i) => i >= 0);
    const ids = visibleWorldIdsFromRows(rows, [headerIndexes[0]!], friends[1]);
    expect(ids).toContain("wrld_aaa");
    expect(ids).toContain("wrld_bbb");
  });
});
