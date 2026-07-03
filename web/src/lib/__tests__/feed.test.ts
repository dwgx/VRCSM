import { beforeEach, describe, expect, it, vi } from "vitest";

import { CATEGORY_TO_SOURCE_KIND, fetchFeed, toFeedEntry } from "../feed";
import { ipc } from "../ipc";
import type { FeedEntryDto } from "../ipc";

vi.mock("../ipc", () => ({
  ipc: {
    feedUnified: vi.fn(),
  },
}));

const feedMock = ipc.feedUnified as unknown as ReturnType<typeof vi.fn>;

function row(partial: Partial<FeedEntryDto>): FeedEntryDto {
  return {
    source_kind: "presence",
    event_id: 1,
    user_id: "usr_a",
    display_name: "Alice",
    event_type: null,
    world_id: null,
    instance_id: null,
    detail: null,
    occurred_at: "2026-06-24T12:00:00Z",
    ...partial,
  };
}

describe("toFeedEntry categorization", () => {
  it("maps presence event types to categories", () => {
    expect(toFeedEntry(row({ source_kind: "presence", event_type: "online" })).category).toBe("online");
    expect(toFeedEntry(row({ source_kind: "presence", event_type: "offline" })).category).toBe("offline");
    expect(toFeedEntry(row({ source_kind: "presence", event_type: "location" })).category).toBe("location");
    expect(toFeedEntry(row({ source_kind: "presence", event_type: "status" })).category).toBe("status");
  });

  it("maps player_event join/leave to joined/left", () => {
    expect(toFeedEntry(row({ source_kind: "player_event", event_type: "joined" })).category).toBe("joined");
    expect(toFeedEntry(row({ source_kind: "player_event", event_type: "left" })).category).toBe("left");
  });

  it("maps friend_log friend.added / friend.removed", () => {
    expect(toFeedEntry(row({ source_kind: "friend_log", event_type: "friend.added" })).category).toBe("friend-added");
    expect(toFeedEntry(row({ source_kind: "friend_log", event_type: "friend.removed" })).category).toBe("friend-removed");
    expect(toFeedEntry(row({ source_kind: "friend_log", event_type: "status.changed" })).category).toBe("status");
  });

  it("classifies avatar source rows", () => {
    expect(toFeedEntry(row({ source_kind: "avatar", event_type: null })).category).toBe("avatar");
  });

  it("maps log_event kinds to video/portal/moderation/sticker", () => {
    expect(toFeedEntry(row({ source_kind: "log_event", event_type: "videoPlay" })).category).toBe("video");
    expect(toFeedEntry(row({ source_kind: "log_event", event_type: "portalSpawn" })).category).toBe("portal");
    expect(toFeedEntry(row({ source_kind: "log_event", event_type: "voteKick" })).category).toBe("moderation");
    expect(toFeedEntry(row({ source_kind: "log_event", event_type: "joinBlocked" })).category).toBe("moderation");
    expect(toFeedEntry(row({ source_kind: "log_event", event_type: "stickerSpawn" })).category).toBe("sticker");
  });

  it("maps log_event categories back to the log_event source kind", () => {
    expect(CATEGORY_TO_SOURCE_KIND.video).toBe("log_event");
    expect(CATEGORY_TO_SOURCE_KIND.portal).toBe("log_event");
    expect(CATEGORY_TO_SOURCE_KIND.moderation).toBe("log_event");
    expect(CATEGORY_TO_SOURCE_KIND.sticker).toBe("log_event");
  });

  it("derives world/instance from a location detail when columns are empty", () => {
    const entry = toFeedEntry(row({
      source_kind: "presence",
      event_type: "location",
      world_id: null,
      detail: "wrld_abc:99~friends(usr_a)",
    }));
    expect(entry.worldId).toBe("wrld_abc");
    expect(entry.instanceId).toBe("99");
  });

  it("builds a stable composite key", () => {
    expect(toFeedEntry(row({ source_kind: "player_event", event_id: 42 })).key).toBe("player_event:42");
  });
});

describe("fetchFeed", () => {
  beforeEach(() => {
    feedMock.mockReset();
  });

  it("pushes a source_kind hint for categories that map cleanly", () => {
    expect(CATEGORY_TO_SOURCE_KIND.joined).toBe("player_event");
    expect(CATEGORY_TO_SOURCE_KIND.avatar).toBe("avatar");
    expect(CATEGORY_TO_SOURCE_KIND.online).toBeUndefined();
  });

  it("narrows shared-source categories client-side (online vs offline)", async () => {
    feedMock.mockResolvedValue({
      items: [
        row({ event_id: 1, source_kind: "presence", event_type: "online" }),
        row({ event_id: 2, source_kind: "presence", event_type: "offline" }),
      ],
    });
    const online = await fetchFeed({ category: "online" });
    expect(online.entries).toHaveLength(1);
    expect(online.entries[0].category).toBe("online");
    // rawCount reflects the host rows BEFORE narrowing, so the pager keeps going.
    expect(online.rawCount).toBe(2);
    // source_kind was NOT forwarded (online/offline share "presence")
    expect(feedMock.mock.calls[0][0].source_kind).toBeUndefined();
  });

  it("forwards source_kind for joined and still returns mapped entries", async () => {
    feedMock.mockResolvedValue({
      items: [row({ event_id: 3, source_kind: "player_event", event_type: "joined" })],
    });
    const joined = await fetchFeed({ category: "joined" });
    expect(feedMock.mock.calls[0][0].source_kind).toBe("player_event");
    expect(joined.entries).toHaveLength(1);
    expect(joined.entries[0].category).toBe("joined");
  });

  it("reports rawCount so paging survives a page that narrows to zero", async () => {
    // A full page of log_event rows that are all `portal`, while the user is
    // filtering `video`: entries narrow to [], but rawCount must stay 2 so the
    // infinite pager fetches the next page instead of declaring the feed empty.
    feedMock.mockResolvedValue({
      items: [
        row({ event_id: 10, source_kind: "log_event", event_type: "portalspawn" }),
        row({ event_id: 11, source_kind: "log_event", event_type: "portalspawn" }),
      ],
    });
    const video = await fetchFeed({ category: "video" });
    expect(video.entries).toHaveLength(0);
    expect(video.rawCount).toBe(2);
  });

  it("passes pagination and user filters through", async () => {
    feedMock.mockResolvedValue({ items: [] });
    await fetchFeed({ limit: 60, offset: 120, userId: "usr_x" });
    expect(feedMock.mock.calls[0][0]).toMatchObject({
      limit: 60,
      offset: 120,
      user_id: "usr_x",
    });
  });
});
