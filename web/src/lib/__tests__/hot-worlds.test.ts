import { describe, expect, it } from "vitest";
import {
  HOT_WORLDS_CAP,
  countDistinctFriendsByWorld,
  rankHotWorlds,
  type HotWorldVisitRow,
} from "../hot-worlds";

const WORLD_A = "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const WORLD_B = "wrld_11111111-2222-3333-4444-555555555555";
const WORLD_C = "wrld_cccccccccccccccccccccccccccccccccccc";

function visit(
  partial: Partial<HotWorldVisitRow> & Pick<HotWorldVisitRow, "world_id">,
): HotWorldVisitRow {
  return {
    joined_at: "2026-08-01T12:00:00.000Z",
    ...partial,
  };
}

describe("rankHotWorlds", () => {
  it("ranks by visits desc", () => {
    const ranked = rankHotWorlds([
      visit({ world_id: WORLD_A, joined_at: "2026-08-01T10:00:00.000Z" }),
      visit({ world_id: WORLD_B, joined_at: "2026-08-03T10:00:00.000Z" }),
      visit({ world_id: WORLD_A, joined_at: "2026-08-02T10:00:00.000Z" }),
      visit({ world_id: WORLD_A, joined_at: "2026-08-04T10:00:00.000Z" }),
    ]);
    expect(ranked.map((row) => row.worldId)).toEqual([WORLD_A, WORLD_B]);
    expect(ranked[0]?.visits).toBe(3);
    expect(ranked[1]?.visits).toBe(1);
  });

  it("tie-breaks lastVisit desc when visit counts match", () => {
    const ranked = rankHotWorlds([
      visit({ world_id: WORLD_A, joined_at: "2026-08-01T10:00:00.000Z" }),
      visit({ world_id: WORLD_A, joined_at: "2026-08-02T10:00:00.000Z" }),
      visit({ world_id: WORLD_B, joined_at: "2026-08-01T11:00:00.000Z" }),
      visit({ world_id: WORLD_B, joined_at: "2026-08-03T09:00:00.000Z" }),
    ]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.worldId).toBe(WORLD_B);
    expect(ranked[0]?.visits).toBe(2);
    expect(ranked[0]?.lastVisit).toBe("2026-08-03T09:00:00.000Z");
    expect(ranked[1]?.worldId).toBe(WORLD_A);
    expect(ranked[1]?.lastVisit).toBe("2026-08-02T10:00:00.000Z");
  });

  it("ignores empty world_id", () => {
    const ranked = rankHotWorlds([
      visit({ world_id: WORLD_A }),
      visit({ world_id: "" }),
      visit({ world_id: "   " }),
      visit({ world_id: null }),
      visit({ world_id: undefined }),
      { joined_at: "2026-08-01T12:00:00.000Z" },
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.worldId).toBe(WORLD_A);
    expect(ranked[0]?.visits).toBe(1);
  });

  it("caps output at 100 worlds", () => {
    const visits: HotWorldVisitRow[] = Array.from({ length: HOT_WORLDS_CAP + 1 }, (_, i) =>
      visit({
        world_id: `wrld_${String(i).padStart(3, "0")}`,
        joined_at: new Date(Date.UTC(2026, 7, 1, i, 0, 0)).toISOString(),
      }),
    );
    const ranked = rankHotWorlds(visits);
    expect(ranked).toHaveLength(HOT_WORLDS_CAP);
    expect(ranked[0]?.worldId).toBe(`wrld_${String(HOT_WORLDS_CAP).padStart(3, "0")}`);
    expect(ranked.some((row) => row.worldId === "wrld_000")).toBe(false);
  });

  it("sums completed dwell into hours and omits hours when none are valid", () => {
    const ranked = rankHotWorlds([
      visit({
        world_id: WORLD_A,
        joined_at: "2026-08-01T10:00:00.000Z",
        left_at: "2026-08-01T12:00:00.000Z",
      }),
      visit({
        world_id: WORLD_A,
        joined_at: "2026-08-02T10:00:00.000Z",
        left_at: "2026-08-02T11:00:00.000Z",
      }),
      visit({
        world_id: WORLD_B,
        joined_at: "2026-08-03T10:00:00.000Z",
      }),
    ]);
    expect(ranked[0]?.worldId).toBe(WORLD_A);
    expect(ranked[0]?.hours).toBe(3);
    expect(ranked[1]?.worldId).toBe(WORLD_B);
    expect(ranked[1]?.hours).toBeUndefined();
  });

  it("does not add negative or unparseable dwell to hours", () => {
    const ranked = rankHotWorlds([
      visit({
        world_id: WORLD_A,
        joined_at: "2026-08-01T12:00:00.000Z",
        left_at: "2026-08-01T11:00:00.000Z",
      }),
      visit({
        world_id: WORLD_A,
        joined_at: "not-a-date",
        left_at: "also-bad",
      }),
      visit({
        world_id: WORLD_A,
        joined_at: "2026-08-01T10:00:00.000Z",
        left_at: "2026-08-01T10:30:00.000Z",
      }),
    ]);
    expect(ranked[0]?.visits).toBe(3);
    expect(ranked[0]?.hours).toBe(0.5);
  });

  it("parses VRChat DOT-local visit stamps for lastVisit and hours", () => {
    const ranked = rankHotWorlds([
      visit({
        world_id: WORLD_A,
        world_name: "Old Name",
        joined_at: "2026.08.01 10:00:00",
        left_at: "2026.08.01 11:00:00",
      }),
      visit({
        world_id: WORLD_A,
        world_name: "Great Pond",
        joined_at: "2026.08.02 18:00:00",
        left_at: "2026.08.02 20:00:00",
      }),
    ]);
    expect(ranked[0]?.visits).toBe(2);
    expect(ranked[0]?.lastVisit).toBe("2026.08.02 18:00:00");
    expect(ranked[0]?.hours).toBe(3);
    expect(ranked[0]?.worldName).toBe("Great Pond");
  });

  it("attaches optional encounter counts without changing visit order", () => {
    const ranked = rankHotWorlds(
      [
        visit({ world_id: WORLD_A }),
        visit({ world_id: WORLD_A }),
        visit({ world_id: WORLD_C }),
      ],
      { friendsByWorld: { [WORLD_A]: 4, [WORLD_C]: 0 } },
    );
    expect(ranked[0]?.worldId).toBe(WORLD_A);
    expect(ranked[0]?.friends).toBe(4);
    expect(ranked[1]?.worldId).toBe(WORLD_C);
    expect(ranked[1]?.friends).toBe(0);
  });
});

describe("countDistinctFriendsByWorld", () => {
  it("counts distinct user_id per world and skips empty/self/non-join", () => {
    const counts = countDistinctFriendsByWorld(
      [
        { world_id: WORLD_A, user_id: "usr_a", kind: "joined" },
        { world_id: WORLD_A, user_id: "usr_a", kind: "joined" },
        { world_id: WORLD_A, user_id: "usr_b", kind: "join" },
        { world_id: WORLD_A, user_id: "usr_c", kind: "left" },
        { world_id: WORLD_A, user_id: "usr_me", kind: "joined" },
        { world_id: WORLD_B, user_id: "usr_a" },
        { world_id: WORLD_B, user_id: "" },
        { world_id: "", user_id: "usr_z" },
      ],
      "usr_me",
    );
    expect(counts.get(WORLD_A)).toBe(2);
    expect(counts.get(WORLD_B)).toBe(1);
    expect(counts.has(WORLD_C)).toBe(false);
  });
});
