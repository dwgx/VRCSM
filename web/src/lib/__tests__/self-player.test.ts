import { describe, expect, it } from "vitest";
import { collectSelfIdentity, friendStubFromIdentity, isSelfPlayer, primarySelfUserId } from "@/lib/self-player";

describe("self-player", () => {
  it("collects auth and LocalAvatarData usr_ folders", () => {
    const self = collectSelfIdentity({
      userId: "usr_aaa",
      displayName: "dwgx",
      localUserIds: ["usr_aaa", "not-a-user", "usr_bbb", "usr_aaa"],
    });
    expect(self.userIds).toEqual(["usr_aaa", "usr_bbb"]);
    expect(self.displayNames).toEqual(["dwgx"]);
    expect(primarySelfUserId(self)).toBe("usr_aaa");
  });

  it("matches self by user id ignoring case", () => {
    const self = collectSelfIdentity({ userId: "usr_AAA", displayName: "Me" });
    expect(isSelfPlayer(self, "USR_aaa", "someone")).toBe(true);
  });

  it("matches self by display name only when the other user id is missing", () => {
    const self = collectSelfIdentity({ displayName: "dwgx" });
    expect(isSelfPlayer(self, "", "dwgx")).toBe(true);
    expect(isSelfPlayer(self, "usr_other", "dwgx")).toBe(false);
    expect(isSelfPlayer(self, "usr_other", "susuoo")).toBe(false);
  });

  it("builds a dialog stub only for usr_ ids", () => {
    expect(friendStubFromIdentity("wrld_x", "nope")).toBeNull();
    const stub = friendStubFromIdentity("usr_abc", "Alice");
    expect(stub?.id).toBe("usr_abc");
    expect(stub?.displayName).toBe("Alice");
  });
});
