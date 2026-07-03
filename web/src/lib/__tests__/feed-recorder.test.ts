import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordPresenceEvent, recordPresenceFromPipeline } from "../feed-recorder";
import { ipc } from "../ipc";
import type { Friend } from "../types";

vi.mock("../ipc", () => ({
  ipc: {
    friendPresenceRecord: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

const recordMock = ipc.friendPresenceRecord as unknown as ReturnType<typeof vi.fn>;

describe("feed-recorder", () => {
  beforeEach(() => {
    recordMock.mockClear();
  });

  it("maps pipeline types to presence event_type discriminators", () => {
    recordPresenceEvent({ pipelineType: "friend-location", userId: "usr_a" });
    recordPresenceEvent({ pipelineType: "friend-offline", userId: "usr_a" });
    recordPresenceEvent({ pipelineType: "friend-active", userId: "usr_a" });
    recordPresenceEvent({ pipelineType: "friend-online", userId: "usr_a" });

    expect(recordMock).toHaveBeenCalledTimes(4);
    expect(recordMock.mock.calls[0][0]).toMatchObject({ event_type: "location" });
    expect(recordMock.mock.calls[1][0]).toMatchObject({ event_type: "offline" });
    expect(recordMock.mock.calls[2][0]).toMatchObject({ event_type: "status" });
    expect(recordMock.mock.calls[3][0]).toMatchObject({ event_type: "online" });
  });

  it("ignores unknown pipeline types and empty user ids", () => {
    recordPresenceEvent({ pipelineType: "friend-add", userId: "usr_a" });
    recordPresenceEvent({ pipelineType: "friend-location", userId: "" });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("derives world_id and instance_id from a world location string", () => {
    recordPresenceEvent({
      pipelineType: "friend-location",
      userId: "usr_a",
      location: "wrld_abc:12345~friends(usr_a)~region(us)",
    });
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock.mock.calls[0][0]).toMatchObject({
      world_id: "wrld_abc",
      instance_id: "12345",
      location: "wrld_abc:12345~friends(usr_a)~region(us)",
      source: "pipeline",
    });
  });

  it("treats sentinel locations as no world", () => {
    recordPresenceEvent({
      pipelineType: "friend-location",
      userId: "usr_a",
      location: "private",
    });
    const call = recordMock.mock.calls[0][0];
    expect(call.world_id).toBeUndefined();
    expect(call.instance_id).toBeUndefined();
    expect(call.location).toBeUndefined();
  });

  it("extracts userId, displayName and status diff from a pipeline payload", () => {
    const prev: Partial<Friend> = { id: "usr_a", displayName: "Alice", status: "active" };
    recordPresenceFromPipeline(
      "friend-active",
      { userId: "usr_a", user: { id: "usr_a", status: "join me" } },
      prev as Friend,
    );
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock.mock.calls[0][0]).toMatchObject({
      user_id: "usr_a",
      event_type: "status",
      display_name: "Alice",
      old_value: "active",
      new_value: "join me",
    });
  });

  it("falls back to the prior display name when the patch lacks one", () => {
    const prev: Partial<Friend> = { id: "usr_a", displayName: "Alice" };
    recordPresenceFromPipeline("friend-offline", { userId: "usr_a" }, prev as Friend);
    expect(recordMock.mock.calls[0][0]).toMatchObject({
      user_id: "usr_a",
      event_type: "offline",
      display_name: "Alice",
    });
  });
});
