import { describe, expect, it } from "vitest";

import {
  classifyPaletteEntity,
  entityOpenIntent,
  matchScore,
  PALETTE_ENTITY_KIND_ORDER,
  rankPaletteRows,
  type PaletteEntityLike,
} from "../command-palette-search";
import { vrchatGroupUrl, vrchatUserUrl, vrchatWorldUrl } from "../shell-api";

function entity(partial: PaletteEntityLike): PaletteEntityLike {
  return partial;
}

const COMMANDS = [
  { id: "nav-friends", label: "Friends", keywords: "friends social" },
  {
    id: "last-instance",
    label: "Last instance",
    keywords: "last instance rejoin recover crash kick vrchat:// shortcut",
  },
  { id: "invite-slots", label: "Slot mail", keywords: "invite slots mail message cooldown" },
  { id: "playspace", label: "Playspace offset", keywords: "playspace offset steamvr space drag" },
] as const;

function commandScore(query: string) {
  return (cmd: (typeof COMMANDS)[number]) =>
    Math.max(matchScore(cmd.label, query), matchScore(cmd.keywords, query));
}

describe("matchScore", () => {
  it("ranks exact, prefix, includes, then subsequence", () => {
    expect(matchScore("Alice", "alice")).toBe(1000);
    expect(matchScore("Alice", "ali")).toBe(500);
    expect(matchScore("xxAlice", "alice")).toBe(100);
    expect(matchScore("a-l-i-c-e", "alice")).toBe(50);
    expect(matchScore("bob", "alice")).toBe(0);
  });

  it("returns 1 for an empty query so empty-palette commands stay visible", () => {
    expect(matchScore("anything", "")).toBe(1);
  });
});

describe("classifyPaletteEntity", () => {
  it("maps search.global types and id prefixes onto palette sections", () => {
    expect(classifyPaletteEntity(entity({ type: "user", id: "usr_1" }))).toBe("friend");
    expect(classifyPaletteEntity(entity({ type: "world", id: "wrld_1" }))).toBe("world");
    expect(classifyPaletteEntity(entity({ type: "avatar", id: "avtr_1" }))).toBe("avatar");
    expect(classifyPaletteEntity(entity({ type: "group", id: "grp_1" }))).toBe("group");
  });

  it("promotes grp_ ids even when the IPC type is favorite", () => {
    expect(
      classifyPaletteEntity(entity({ type: "favorite", id: "grp_club" })),
    ).toBe("group");
  });

  it("id prefix wins over a mismatched type", () => {
    expect(
      classifyPaletteEntity(entity({ type: "favorite", id: "usr_alice" })),
    ).toBe("friend");
    expect(
      classifyPaletteEntity(entity({ type: "user", id: "wrld_park" })),
    ).toBe("world");
  });

  it("puts leftover favorites / memo evidence in notes", () => {
    expect(
      classifyPaletteEntity(
        entity({
          type: "favorite",
          id: "memo-1",
          evidence: [{ kind: "favorite", label: "Favorite", detail: "Saved in Library with note" }],
        }),
      ),
    ).toBe("note");
    expect(
      classifyPaletteEntity(
        entity({
          type: "timeline_event",
          id: "timeline:1",
          subtitle: "local memo about a player",
        }),
      ),
    ).toBe("note");
  });

  it("drops timeline/asset hits that are not an entity or note", () => {
    expect(
      classifyPaletteEntity(entity({ type: "timeline_event", id: "timeline:2" })),
    ).toBeNull();
    expect(classifyPaletteEntity(entity({ type: "asset", id: "cache-1" }))).toBeNull();
  });
});

describe("rankPaletteRows", () => {
  it("shows only commands, in source order, when the query is empty", () => {
    const rows = rankPaletteRows({
      query: "",
      commands: COMMANDS,
      commandScore: commandScore(""),
      entities: [
        entity({ type: "user", id: "usr_1", displayName: "Alice" }),
      ],
      logs: [{ id: "log-1" }],
      logScore: () => 100,
    });
    expect(rows.every((row) => row.row === "command")).toBe(true);
    expect(rows.map((row) => (row.row === "command" ? row.item.id : ""))).toEqual(
      COMMANDS.map((cmd) => cmd.id),
    );
  });

  it("ranks typed entities above commands even when a command is an exact match", () => {
    const q = "alice";
    const rows = rankPaletteRows({
      query: q,
      commands: [{ id: "alice", label: "alice", keywords: "" }],
      commandScore: (cmd) => matchScore(cmd.label, q),
      entities: [entity({ type: "user", id: "usr_alice", displayName: "alice" })],
      logs: [],
      logScore: () => 0,
    });
    expect(rows[0]).toMatchObject({ row: "entity", kind: "friend" });
    expect(rows[1]).toMatchObject({ row: "command", item: { id: "alice" } });
  });

  it("groups entities as friend/world/avatar/group/note while keeping IPC order inside a kind", () => {
    const rows = rankPaletteRows({
      query: "x",
      commands: [],
      commandScore: () => 0,
      entities: [
        entity({ type: "world", id: "wrld_b" }),
        entity({ type: "user", id: "usr_a" }),
        entity({ type: "user", id: "usr_b" }),
        entity({ type: "favorite", id: "grp_a" }),
        entity({ type: "avatar", id: "avtr_a" }),
        entity({
          type: "favorite",
          id: "note-a",
          evidence: [{ detail: "Saved in Library with note" }],
        }),
        entity({ type: "timeline_event", id: "timeline:skip" }),
      ],
      logs: [],
      logScore: () => 0,
    });
    expect(PALETTE_ENTITY_KIND_ORDER).toEqual([
      "friend",
      "world",
      "avatar",
      "group",
      "note",
    ]);
    expect(
      rows.filter((row) => row.row === "entity").map((row) => {
        return row.row === "entity" ? `${row.kind}:${row.item.id}` : "";
      }),
    ).toEqual([
      "friend:usr_a",
      "friend:usr_b",
      "world:wrld_b",
      "avatar:avtr_a",
      "group:grp_a",
      "note:note-a",
    ]);
  });

  it("keeps last-instance / invite-slots / playspace commands findable", () => {
    for (const [query, id] of [
      ["rejoin", "last-instance"],
      ["invite", "invite-slots"],
      ["playspace", "playspace"],
    ] as const) {
      const rows = rankPaletteRows({
        query,
        commands: COMMANDS,
        commandScore: commandScore(query),
        entities: [],
        logs: [],
        logScore: () => 0,
      });
      expect(
        rows.some((row) => row.row === "command" && row.item.id === id),
        `${id} should match ${query}`,
      ).toBe(true);
    }
  });

  it("puts matching logs after commands", () => {
    const rows = rankPaletteRows({
      query: "bob",
      commands: [{ id: "bob-cmd", label: "bob", keywords: "" }],
      commandScore: (cmd) => matchScore(cmd.label, "bob"),
      entities: [entity({ type: "user", id: "usr_bob" })],
      logs: [{ id: "log-bob" }, { id: "log-skip" }],
      logScore: (log) => (log.id === "log-bob" ? 100 : 0),
    });
    expect(rows.map((row) => row.row)).toEqual(["entity", "command", "log"]);
  });
});

describe("entityOpenIntent", () => {
  it("navigates an enabled in-app route from search.global", () => {
    expect(
      entityOpenIntent(
        entity({
          type: "world",
          id: "wrld_park",
          primaryAction: { enabled: true, route: "/worlds?select=wrld_park" },
        }),
      ),
    ).toEqual({ via: "navigate", route: "/worlds?select=wrld_park" });
  });

  it("ignores the generic /logs route and opens the VRChat page instead", () => {
    expect(
      entityOpenIntent(
        entity({
          type: "group",
          id: "grp_club",
          primaryAction: { enabled: true, route: "/logs" },
        }),
      ),
    ).toEqual({ via: "shell", url: vrchatGroupUrl("grp_club") });
  });

  it("falls back to shell-api URLs when no useful route is present", () => {
    expect(
      entityOpenIntent(entity({ type: "user", id: "usr_alice" })),
    ).toEqual({ via: "shell", url: vrchatUserUrl("usr_alice") });
    expect(
      entityOpenIntent(entity({ type: "world", id: "wrld_park" })),
    ).toEqual({ via: "shell", url: vrchatWorldUrl("wrld_park") });
  });

  it("opens notes in the library", () => {
    expect(
      entityOpenIntent(
        entity({
          type: "favorite",
          id: "memo-1",
          evidence: [{ detail: "Saved in Library with note" }],
        }),
      ),
    ).toEqual({ via: "navigate", route: "/library?select=memo-1" });
  });

  it("copies an unclassifiable id", () => {
    expect(
      entityOpenIntent(entity({ type: "asset", id: "cache-9" })),
    ).toEqual({ via: "copy", text: "cache-9" });
  });
});
