import { describe, expect, it } from "vitest";
import { emptyWatchDraft, validateWatchDraft } from "../event-watch";

describe("validateWatchDraft", () => {
  it("requires world or group", () => {
    expect(validateWatchDraft(emptyWatchDraft())).toBe("worldId or groupId is required");
  });

  it("rejects autoJoin without notify", () => {
    expect(
      validateWatchDraft({ worldId: "wrld_a", autoJoin: true, notify: false }),
    ).toBe("autoJoin requires notify");
  });

  it("accepts a notify-only world watch", () => {
    expect(validateWatchDraft({ worldId: "wrld_a", notify: true, autoJoin: false })).toBeNull();
  });

  it("rejects unknown access", () => {
    expect(validateWatchDraft({ groupId: "grp_a", access: "secret" })).toBe("unknown access filter");
  });
});
