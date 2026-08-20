import { describe, expect, it } from "vitest";
import {
  groupShotsByVisit,
  matchVisit,
  metadataHasPlayer,
  parseLiberalTimestamp,
  parseScreenshotPlayers,
  parseScreenshotTime,
  type VisitWindow,
} from "../screenshot-visits";

const WORLD_A = "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const WORLD_B = "wrld_11111111-2222-3333-4444-555555555555";

describe("parseLiberalTimestamp", () => {
  it("parses DOT as naive local, matching naive ISO", () => {
    const dot = parseLiberalTimestamp("2026.07.09 10:00:00");
    const iso = parseLiberalTimestamp("2026-07-09T10:00:00");
    expect(dot).toBeTypeOf("number");
    expect(dot).toBe(iso);
  });

  it("parses offset-aware ISO leave independently of local civil", () => {
    const withOffset = parseLiberalTimestamp("2026-07-09T12:00:00+09:00");
    expect(withOffset).toBe(Date.parse("2026-07-09T12:00:00+09:00"));
  });

  it("parses Zulu ISO", () => {
    expect(parseLiberalTimestamp("2026-07-09T12:00:00.000Z")).toBe(
      Date.parse("2026-07-09T12:00:00.000Z"),
    );
  });

  it("never throws and returns null for garbage", () => {
    expect(parseLiberalTimestamp(undefined)).toBeNull();
    expect(parseLiberalTimestamp(null)).toBeNull();
    expect(parseLiberalTimestamp("")).toBeNull();
    expect(parseLiberalTimestamp("not-a-date")).toBeNull();
    expect(parseLiberalTimestamp({})).toBeNull();
    expect(parseLiberalTimestamp(Number.NaN)).toBeNull();
    expect(() => parseLiberalTimestamp("2026.13.99 99:99:99")).not.toThrow();
  });
});

describe("parseScreenshotTime", () => {
  it("reads VRChat_YYYY-MM-DD_HH-mm-ss filename stamps", () => {
    const fromName = parseScreenshotTime({
      filename: "VRChat_2026-07-09_11-00-00.png",
      created_at: "1999-01-01T00:00:00Z",
    });
    expect(fromName).toBe(parseLiberalTimestamp("2026-07-09T11:00:00"));
  });

  it("reads the real VRChat `time.ms_RESxRES` layout", () => {
    const t = parseScreenshotTime({
      filename: "VRChat_2026-04-15_02-18-44.439_1920x1080.png",
    });
    expect(t).toBe(parseLiberalTimestamp("2026-04-15T02:18:44.439"));
  });

  it("reads the resolution-prefixed mock layout", () => {
    const t = parseScreenshotTime({
      path: "C:/Users/dev/Pictures/VRChat/2026-07/VRChat_2560x1440_2026-07-09_11-30-00.png",
    });
    expect(t).toBe(parseLiberalTimestamp("2026-07-09T11:30:00"));
  });

  it("falls back to created_at when the filename has no stamp", () => {
    const t = parseScreenshotTime({
      filename: "capture.png",
      created_at: "2026-07-09T11:00:00.000Z",
    });
    expect(t).toBe(Date.parse("2026-07-09T11:00:00.000Z"));
  });

  it("never throws on empty input", () => {
    expect(parseScreenshotTime(undefined)).toBeNull();
    expect(parseScreenshotTime({})).toBeNull();
  });
});

describe("matchVisit", () => {
  it("matches a shot inside a DOT join / naive-ISO leave window", () => {
    const visits: VisitWindow[] = [
      {
        id: 1,
        world_id: WORLD_A,
        instance_id: `${WORLD_A}:12345~region(us)`,
        joined_at: "2026.07.09 10:00:00",
        left_at: "2026-07-09T12:00:00",
      },
    ];
    const shot = parseScreenshotTime({ filename: "VRChat_2026-07-09_11-00-00.png" })!;
    expect(matchVisit(shot, visits)?.id).toBe(1);
  });

  it("matches DOT join against an offset-aware ISO leave", () => {
    const visits: VisitWindow[] = [
      {
        id: 7,
        world_id: WORLD_A,
        instance_id: `${WORLD_A}:1`,
        joined_at: "2026.07.09 10:00:00",
        left_at: "2026-07-09T23:59:59Z",
      },
    ];
    const shot = parseScreenshotTime({ filename: "VRChat_2026-07-09_11-00-00.png" })!;
    expect(matchVisit(shot, visits)?.id).toBe(7);
  });

  it("returns null when the shot is outside every visit (unmatched)", () => {
    const visits: VisitWindow[] = [
      {
        id: 1,
        world_id: WORLD_A,
        joined_at: "2026.07.09 10:00:00",
        left_at: "2026-07-09T11:00:00",
      },
    ];
    const shot = parseScreenshotTime({ filename: "VRChat_2026-07-09_15-00-00.png" })!;
    expect(matchVisit(shot, visits)).toBeNull();
  });

  it("on overlap prefers the visit with the latest joined_at", () => {
    const visits: VisitWindow[] = [
      {
        id: 1,
        world_id: WORLD_A,
        joined_at: "2026-07-09T10:00:00",
        left_at: "2026-07-09T14:00:00",
      },
      {
        id: 2,
        world_id: WORLD_B,
        joined_at: "2026-07-09T11:00:00",
        left_at: "2026-07-09T13:00:00",
      },
    ];
    const noon = parseLiberalTimestamp("2026-07-09T12:00:00")!;
    expect(matchVisit(noon, visits)?.id).toBe(2);
    const early = parseLiberalTimestamp("2026-07-09T10:30:00")!;
    expect(matchVisit(early, visits)?.id).toBe(1);
    const late = parseLiberalTimestamp("2026-07-09T13:30:00")!;
    expect(matchVisit(late, visits)?.id).toBe(1);
  });

  it("treats a missing left_at as open through nowMs", () => {
    const visits: VisitWindow[] = [
      {
        id: 3,
        world_id: WORLD_A,
        joined_at: "2026-07-09T10:00:00.000Z",
        left_at: null,
      },
    ];
    const now = Date.parse("2026-07-09T18:00:00.000Z");
    const inside = Date.parse("2026-07-09T12:00:00.000Z");
    const afterNow = Date.parse("2026-07-09T19:00:00.000Z");
    expect(matchVisit(inside, visits, now)?.id).toBe(3);
    expect(matchVisit(afterNow, visits, now)).toBeNull();
  });

  it("skips inverted intervals (DOT join after ISO leave)", () => {
    const visits: VisitWindow[] = [
      {
        id: 9,
        world_id: WORLD_A,
        joined_at: "2026.07.09 22:00:00",
        left_at: "2026-07-09T00:00:00Z",
      },
    ];
    const shot = parseLiberalTimestamp("2026-07-09T21:00:00")!;
    const now = Date.parse("2026-07-10T00:00:00Z");
    expect(matchVisit(shot, visits, now)).toBeNull();
  });

  it("never throws on garbage visits / times", () => {
    expect(matchVisit(Number.NaN, [])).toBeNull();
    expect(matchVisit(1, undefined)).toBeNull();
    expect(matchVisit(1, [{ joined_at: "nope" }])).toBeNull();
    expect(matchVisit(1, [null as unknown as VisitWindow])).toBeNull();
  });
});

describe("groupShotsByVisit", () => {
  it("buckets shots under the matching visit and trails unmatched", () => {
    const visits: VisitWindow[] = [
      {
        id: 1,
        world_id: WORLD_A,
        joined_at: "2026-07-09T10:00:00",
        left_at: "2026-07-09T12:00:00",
      },
      {
        id: 2,
        world_id: WORLD_B,
        joined_at: "2026-07-09T13:00:00",
        left_at: "2026-07-09T14:00:00",
      },
    ];
    const shots = [
      { filename: "VRChat_2026-07-09_10-30-00.png", path: "a" },
      { filename: "VRChat_2026-07-09_13-30-00.png", path: "b" },
      { filename: "VRChat_2026-07-09_18-00-00.png", path: "c" },
    ];
    const groups = groupShotsByVisit(shots, visits);
    expect(groups).toHaveLength(3);
    expect(groups[0].visit?.id).toBe(2);
    expect(groups[0].shots.map((s) => s.path)).toEqual(["b"]);
    expect(groups[1].visit?.id).toBe(1);
    expect(groups[1].shots.map((s) => s.path)).toEqual(["a"]);
    expect(groups[2].visit).toBeNull();
    expect(groups[2].shots.map((s) => s.path)).toEqual(["c"]);
  });

  it("never throws on null inputs", () => {
    expect(groupShotsByVisit(null, null)).toEqual([]);
  });
});

describe("parseScreenshotPlayers / metadataHasPlayer", () => {
  const meta = {
    "vrcsm:players": JSON.stringify([
      { displayName: "Neko", userId: "usr_neko", isLocal: false },
      { displayName: "You", userId: "usr_me", isLocal: true },
    ]),
  };

  it("reads the inject JSON array string", () => {
    expect(parseScreenshotPlayers(meta)).toEqual([
      { displayName: "Neko", userId: "usr_neko", isLocal: false },
      { displayName: "You", userId: "usr_me", isLocal: true },
    ]);
  });

  it("matches a user id for the player filter", () => {
    expect(metadataHasPlayer(meta, "usr_neko")).toBe(true);
    expect(metadataHasPlayer(meta, "usr_missing")).toBe(false);
  });

  it("returns [] / false on garbage and never throws", () => {
    expect(parseScreenshotPlayers({ "vrcsm:players": "{not-json" })).toEqual([]);
    expect(parseScreenshotPlayers(undefined)).toEqual([]);
    expect(metadataHasPlayer(undefined, "usr_x")).toBe(false);
  });
});
