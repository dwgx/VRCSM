import { describe, expect, it } from "vitest";

import { qk } from "../query-keys";

describe("query key factories", () => {
  it("keeps IPC query keys compatible with useIpcQuery", () => {
    expect(qk.friends.list()).toEqual(["friends.list", undefined]);
    expect(qk.favorites.lists()).toEqual(["favorites.lists", undefined]);
    expect(qk.favorites.items("Library")).toEqual([
      "favorites.items",
      { list_name: "Library" },
    ]);
  });

  it("exposes stable roots for partial invalidation and cache updates", () => {
    expect(qk.auth.meRoot).toEqual(["user.me"]);
    expect(qk.friends.root).toEqual(["friends.list"]);
    expect(qk.friends.logRoot).toEqual(["friendLog.recent"]);
    expect(qk.users.profileRoot).toEqual(["user.getProfile"]);
    expect(qk.avatars.detailsRoot).toEqual(["avatar.details"]);
    expect(qk.assets.resolveRoot).toEqual(["assets.resolve"]);
    expect(qk.favorites.listsRoot).toEqual(["favorites.lists"]);
    expect(qk.favorites.itemsRoot).toEqual(["favorites.items"]);
    expect(qk.groups.listRoot).toEqual(["groups.list"]);
  });

  it("builds high-value domain keys with deterministic params", () => {
    expect(qk.users.profile("usr_123")).toEqual([
      "user.getProfile",
      { userId: "usr_123" },
    ]);
    expect(qk.worlds.details("wrld_123")).toEqual([
      "world.details",
      { id: "wrld_123" },
    ]);
    expect(qk.avatars.details("avtr_123")).toEqual([
      "avatar.details",
      { id: "avtr_123" },
    ]);
  });
});
