import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchLedger,
  ledgerEntryMatchesKeyword,
  ledgerOccurredAfter,
  ledgerSourceKindHint,
  mapLedgerKind,
  parseLedgerTime,
  toLedgerEntry,
} from "../activity-ledger";
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

describe("mapLedgerKind", () => {
  it("maps player_event join/leave without guessing meet when self is unknown", () => {
    expect(mapLedgerKind(row({ source_kind: "player_event", event_type: "joined" }))).toBe("join");
    expect(mapLedgerKind(row({ source_kind: "player_event", event_type: "join" }))).toBe("join");
    expect(mapLedgerKind(row({ source_kind: "player_event", event_type: "left" }))).toBe("leave");
    expect(mapLedgerKind(row({ source_kind: "player_event", event_type: "leave" }))).toBe("leave");
  });

  it("splits self join vs other meet when selfUserId is provided", () => {
    const self = "usr_me";
    expect(
      mapLedgerKind(
        row({ source_kind: "player_event", event_type: "joined", user_id: "usr_me" }),
        { selfUserId: self },
      ),
    ).toBe("join");
    expect(
      mapLedgerKind(
        row({ source_kind: "player_event", event_type: "joined", user_id: "usr_other" }),
        { selfUserId: self },
      ),
    ).toBe("meet");
  });

  it("does not guess join vs meet when the player id is missing", () => {
    expect(
      mapLedgerKind(
        row({
          source_kind: "player_event",
          event_type: "joined",
          user_id: null,
          display_name: null,
        }),
        { selfUserId: "usr_me" },
      ),
    ).toBe("other");
  });

  it("maps notification detail types; missing type stays other", () => {
    expect(
      mapLedgerKind(row({ source_kind: "log_event", event_type: "notification", detail: "invite" })),
    ).toBe("invite");
    expect(
      mapLedgerKind(
        row({ source_kind: "log_event", event_type: "notification", detail: "inviteResponse" }),
      ),
    ).toBe("inviteResponse");
    expect(
      mapLedgerKind(
        row({ source_kind: "log_event", event_type: "notification", detail: "requestInvite" }),
      ),
    ).toBe("requestInvite");
    expect(
      mapLedgerKind(
        row({
          source_kind: "log_event",
          event_type: "notification",
          detail: "requestInviteResponse",
        }),
      ),
    ).toBe("inviteResponse");
    expect(
      mapLedgerKind(
        row({ source_kind: "log_event", event_type: "notification", detail: "friendRequest" }),
      ),
    ).toBe("friendRequest");
    expect(
      mapLedgerKind(row({ source_kind: "log_event", event_type: "notification", detail: null })),
    ).toBe("other");
    expect(
      mapLedgerKind(row({ source_kind: "log_event", event_type: "notification", detail: "message" })),
    ).toBe("other");
  });

  it("maps video log kinds and refuses to treat joinBlocked as join", () => {
    expect(mapLedgerKind(row({ source_kind: "log_event", event_type: "videoPlay" }))).toBe("video");
    expect(mapLedgerKind(row({ source_kind: "log_event", event_type: "videoError" }))).toBe("video");
    expect(
      mapLedgerKind(row({ source_kind: "log_event", event_type: "attributedVideoPlay" })),
    ).toBe("video");
    expect(mapLedgerKind(row({ source_kind: "log_event", event_type: "videoSync" }))).toBe("video");
    expect(mapLedgerKind(row({ source_kind: "log_event", event_type: "joinBlocked" }))).toBe("other");
  });

  it("does not treat friend.added as a friend request", () => {
    expect(
      mapLedgerKind(row({ source_kind: "friend_log", event_type: "friend.added" })),
    ).toBe("other");
  });

  it("leaves presence location as other, not join or meet", () => {
    expect(
      mapLedgerKind(row({ source_kind: "presence", event_type: "location" })),
    ).toBe("other");
  });
});

describe("toLedgerEntry", () => {
  it("keeps a missing display name as null instead of inventing one", () => {
    const entry = toLedgerEntry(
      row({
        source_kind: "player_event",
        event_type: "joined",
        display_name: null,
        user_id: "usr_a",
      }),
    );
    expect(entry.displayName).toBeNull();
    expect(entry.kind).toBe("join");
  });

  it("derives world/instance from a location detail when columns are empty", () => {
    const entry = toLedgerEntry(
      row({
        source_kind: "presence",
        event_type: "location",
        world_id: null,
        detail: "wrld_abc:99~friends(usr_a)",
      }),
    );
    expect(entry.worldId).toBe("wrld_abc");
    expect(entry.instanceId).toBe("99");
    expect(entry.copyId).toBe("usr_a");
  });

  it("copies world id when user id is not a usr_ prefix", () => {
    const entry = toLedgerEntry(
      row({
        source_kind: "log_event",
        event_type: "videoPlay",
        user_id: null,
        display_name: null,
        world_id: "wrld_abc",
        detail: "https://example.com/a.mp4",
      }),
    );
    expect(entry.copyId).toBe("wrld_abc");
    expect(entry.kind).toBe("video");
  });

  it("builds a stable composite key", () => {
    expect(toLedgerEntry(row({ source_kind: "player_event", event_id: 42 })).key).toBe(
      "player_event:42",
    );
  });
});

describe("ledgerSourceKindHint / range / keyword", () => {
  it("hints player_event when every selected kind is join/leave/meet", () => {
    expect(ledgerSourceKindHint(["join", "meet", "leave"])).toBe("player_event");
  });

  it("hints log_event for invite/video and omits a hint on mixed sources", () => {
    expect(ledgerSourceKindHint(["invite", "video"])).toBe("log_event");
    expect(ledgerSourceKindHint(["join", "video"])).toBeUndefined();
    expect(ledgerSourceKindHint(["other"])).toBeUndefined();
    expect(ledgerSourceKindHint([])).toBeUndefined();
  });

  it("emits ISO lower bounds for range presets and nothing for all", () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    expect(ledgerOccurredAfter("all", now)).toBeUndefined();
    expect(ledgerOccurredAfter("recent", now)).toBe("2026-08-19T12:00:00.000Z");
    expect(ledgerOccurredAfter("7d", now)).toBe("2026-08-13T12:00:00.000Z");
    expect(ledgerOccurredAfter("30d", now)).toBe("2026-07-21T12:00:00.000Z");
  });

  it("parses DOT and ISO timestamps", () => {
    expect(parseLedgerTime("2026.06.24 12:00:00")?.getFullYear()).toBe(2026);
    expect(parseLedgerTime("2026-06-24T12:00:00Z")?.toISOString()).toBe("2026-06-24T12:00:00.000Z");
    expect(parseLedgerTime(null)).toBeNull();
  });

  it("matches keywords across name, ids, detail, and kind", () => {
    const entry = toLedgerEntry(
      row({
        source_kind: "log_event",
        event_type: "notification",
        detail: "invite",
        display_name: "Eve",
        user_id: "usr_eve",
      }),
    );
    expect(ledgerEntryMatchesKeyword(entry, "eve")).toBe(true);
    expect(ledgerEntryMatchesKeyword(entry, "usr_eve")).toBe(true);
    expect(ledgerEntryMatchesKeyword(entry, "invite")).toBe(true);
    expect(ledgerEntryMatchesKeyword(entry, "nope")).toBe(false);
  });
});

describe("fetchLedger", () => {
  beforeEach(() => {
    feedMock.mockReset();
  });

  it("forwards source_kind for join-only and still maps meet when self is known", async () => {
    feedMock.mockResolvedValue({
      items: [
        row({ event_id: 1, source_kind: "player_event", event_type: "joined", user_id: "usr_me" }),
        row({ event_id: 2, source_kind: "player_event", event_type: "joined", user_id: "usr_b" }),
      ],
    });
    const page = await fetchLedger({
      kinds: ["meet"],
      selfUserId: "usr_me",
    });
    expect(feedMock.mock.calls[0][0].source_kind).toBe("player_event");
    expect(page.nextOffset).toBe(2);
    expect(page.exhausted).toBe(true);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].kind).toBe("meet");
  });

  it("keeps paging when a page narrows to zero matching kinds", async () => {
    feedMock.mockResolvedValue({
      items: [
        row({ event_id: 10, source_kind: "log_event", event_type: "portalSpawn" }),
        row({ event_id: 11, source_kind: "log_event", event_type: "portalSpawn" }),
      ],
    });
    const video = await fetchLedger({ kinds: ["video"] });
    expect(video.entries).toHaveLength(0);
    expect(video.nextOffset).toBe(2);
    expect(video.exhausted).toBe(true);
  });

  it("returns nextOffset after the raw walk, not pageSize", async () => {
    const nonMatch = (startId: number) =>
      Array.from({ length: 80 }, (_, i) =>
        row({
          event_id: startId + i,
          source_kind: "log_event",
          event_type: "portalSpawn",
        }),
      );
    const match = Array.from({ length: 80 }, (_, i) =>
      row({
        event_id: 300 + i,
        source_kind: "log_event",
        event_type: "videoPlay",
      }),
    );
    feedMock
      .mockResolvedValueOnce({ items: nonMatch(1) })
      .mockResolvedValueOnce({ items: nonMatch(81) })
      .mockResolvedValueOnce({ items: match });
    const page = await fetchLedger({ kinds: ["video"] });
    expect(feedMock).toHaveBeenCalledTimes(3);
    expect(feedMock.mock.calls[0][0].offset).toBe(0);
    expect(feedMock.mock.calls[1][0].offset).toBe(80);
    expect(feedMock.mock.calls[2][0].offset).toBe(160);
    expect(page.nextOffset).toBe(240);
    expect(page.exhausted).toBe(false);
    expect(page.entries).toHaveLength(80);
    expect(page.entries[0].kind).toBe("video");
  });

  it("passes date bounds through", async () => {
    feedMock.mockResolvedValue({ items: [] });
    await fetchLedger({
      limit: 80,
      offset: 80,
      occurredAfter: "2026-08-13T00:00:00.000Z",
    });
    expect(feedMock.mock.calls[0][0]).toMatchObject({
      limit: 80,
      offset: 80,
      occurred_after: "2026-08-13T00:00:00.000Z",
    });
  });
});
