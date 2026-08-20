import { describe, it, expect } from "vitest";
import {
  httpsLaunchUrl,
  isPublicAccess,
  parseVisitInstant,
  pickLastInstance,
  visitLocation,
  vrchatLaunchUrl,
  type WorldVisitRow,
} from "../last-instance";
import { buildVrchatLocationLaunchUrl } from "../shell-api";

const WORLD_A = "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const WORLD_B = "wrld_11111111-2222-3333-4444-555555555555";

function visit(partial: Partial<WorldVisitRow> & Pick<WorldVisitRow, "id">): WorldVisitRow {
  return {
    world_id: WORLD_A,
    instance_id: `${WORLD_A}:12345~hidden(usr_x)~region(us)`,
    access_type: "hidden",
    joined_at: "2026-08-20T12:00:00.000Z",
    ...partial,
  };
}

describe("isPublicAccess", () => {
  it("skips only clearly public access types", () => {
    expect(isPublicAccess("public")).toBe(true);
    expect(isPublicAccess("Public")).toBe(true);
    expect(isPublicAccess(" PUBLIC ")).toBe(true);
  });

  it("does not treat empty or unknown as public", () => {
    expect(isPublicAccess("")).toBe(false);
    expect(isPublicAccess("   ")).toBe(false);
    expect(isPublicAccess("unknown")).toBe(false);
    expect(isPublicAccess("friends")).toBe(false);
    expect(isPublicAccess("friends+")).toBe(false);
    expect(isPublicAccess("invite")).toBe(false);
    expect(isPublicAccess("hidden")).toBe(false);
    expect(isPublicAccess("group")).toBe(false);
  });
});

describe("parseVisitInstant", () => {
  it("parses ISO timestamps", () => {
    expect(parseVisitInstant("2026-08-20T12:00:00.000Z")).toBe(
      Date.parse("2026-08-20T12:00:00.000Z"),
    );
  });

  it("parses VRChat DOT-local timestamps", () => {
    const t = parseVisitInstant("2026.08.20 12:00:00");
    expect(t).toBe(Date.parse("2026-08-20T12:00:00"));
  });

  it("returns null for empty or garbage", () => {
    expect(parseVisitInstant(null)).toBeNull();
    expect(parseVisitInstant("")).toBeNull();
    expect(parseVisitInstant("not-a-date")).toBeNull();
  });
});

describe("httpsLaunchUrl", () => {
  it("splits worldId and instanceId on the first colon", () => {
    const loc = `${WORLD_A}:54321~region(use)`;
    expect(httpsLaunchUrl(loc)).toBe(
      `https://vrchat.com/home/launch?worldId=${encodeURIComponent(WORLD_A)}&instanceId=${encodeURIComponent("54321~region(use)")}`,
    );
  });

  it("keeps an empty instanceId when the tag has no colon", () => {
    expect(httpsLaunchUrl(WORLD_A)).toBe(
      `https://vrchat.com/home/launch?worldId=${encodeURIComponent(WORLD_A)}&instanceId=`,
    );
  });

  it("returns empty query values for a blank location", () => {
    expect(httpsLaunchUrl("")).toBe(
      "https://vrchat.com/home/launch?worldId=&instanceId=",
    );
  });
});

describe("vrchatLaunchUrl", () => {
  it("matches the existing deeplink builder", () => {
    const loc = `${WORLD_A}:54321~private(usr_x)`;
    expect(vrchatLaunchUrl(loc)).toBe(buildVrchatLocationLaunchUrl(loc));
    expect(vrchatLaunchUrl(loc)).toContain("vrchat://launch?ref=vrchat.com&id=");
    expect(vrchatLaunchUrl(loc)).toContain(encodeURIComponent(loc));
  });
});

describe("pickLastInstance", () => {
  const now = Date.parse("2026-08-20T12:00:00.000Z");

  it("returns the newest rejoinable visit", () => {
    const older = visit({
      id: 1,
      world_id: WORLD_B,
      instance_id: `${WORLD_B}:old`,
      joined_at: "2026-08-20T10:00:00.000Z",
    });
    const newer = visit({
      id: 2,
      joined_at: "2026-08-20T11:30:00.000Z",
    });
    const picked = pickLastInstance([older, newer], {
      skipPublic: false,
      maxAgeMinutes: null,
      nowMs: now,
    });
    expect(picked?.id).toBe(2);
  });

  it("sorts even when the input is not newest-first", () => {
    const a = visit({ id: 1, joined_at: "2026-08-20T09:00:00.000Z" });
    const b = visit({ id: 2, joined_at: "2026-08-20T11:00:00.000Z" });
    const c = visit({ id: 3, joined_at: "2026-08-20T10:00:00.000Z" });
    expect(
      pickLastInstance([a, c, b], {
        skipPublic: false,
        maxAgeMinutes: null,
        nowMs: now,
      })?.id,
    ).toBe(2);
  });

  it("skips public visits when skipPublic is set, but keeps unknown", () => {
    const pub = visit({
      id: 1,
      access_type: "public",
      joined_at: "2026-08-20T11:50:00.000Z",
    });
    const unknown = visit({
      id: 2,
      access_type: "",
      joined_at: "2026-08-20T11:40:00.000Z",
    });
    const friends = visit({
      id: 3,
      access_type: "friends+",
      joined_at: "2026-08-20T11:30:00.000Z",
    });
    expect(
      pickLastInstance([pub, unknown, friends], {
        skipPublic: true,
        maxAgeMinutes: null,
        nowMs: now,
      })?.id,
    ).toBe(2);
  });

  it("does not skip public when skipPublic is false", () => {
    const pub = visit({
      id: 1,
      access_type: "public",
      joined_at: "2026-08-20T11:50:00.000Z",
    });
    expect(
      pickLastInstance([pub], {
        skipPublic: false,
        maxAgeMinutes: null,
        nowMs: now,
      })?.id,
    ).toBe(1);
  });

  it("skips visits older than maxAgeMinutes", () => {
    const stale = visit({
      id: 1,
      joined_at: "2026-08-20T10:00:00.000Z",
    });
    const fresh = visit({
      id: 2,
      joined_at: "2026-08-20T11:45:00.000Z",
    });
    expect(
      pickLastInstance([stale, fresh], {
        skipPublic: false,
        maxAgeMinutes: 30,
        nowMs: now,
      })?.id,
    ).toBe(2);
    expect(
      pickLastInstance([stale], {
        skipPublic: false,
        maxAgeMinutes: 30,
        nowMs: now,
      }),
    ).toBeNull();
  });

  it("treats maxAgeMinutes 0 / null as no age filter", () => {
    const old = visit({
      id: 1,
      joined_at: "2026-01-01T00:00:00.000Z",
    });
    expect(
      pickLastInstance([old], { skipPublic: false, maxAgeMinutes: null, nowMs: now })?.id,
    ).toBe(1);
    expect(
      pickLastInstance([old], { skipPublic: false, maxAgeMinutes: 0, nowMs: now })?.id,
    ).toBe(1);
  });

  it("skips unparseable joined_at when an age filter is on", () => {
    const garbage = visit({
      id: 1,
      joined_at: "not-a-date",
    });
    const ok = visit({
      id: 2,
      joined_at: "2026-08-20T11:50:00.000Z",
    });
    expect(
      pickLastInstance([garbage, ok], {
        skipPublic: false,
        maxAgeMinutes: 60,
        nowMs: now,
      })?.id,
    ).toBe(2);
  });

  it("skips rows that cannot form a rejoinable location", () => {
    const closed = visit({
      id: 1,
      world_id: null,
      instance_id: null,
      joined_at: "2026-08-20T11:59:00.000Z",
    });
    const ok = visit({ id: 2, joined_at: "2026-08-20T11:00:00.000Z" });
    expect(
      pickLastInstance([closed, ok], {
        skipPublic: false,
        maxAgeMinutes: null,
        nowMs: now,
      })?.id,
    ).toBe(2);
  });

  it("accepts DOT-local joined_at when filtering by age", () => {
    const picked = pickLastInstance(
      [
        visit({
          id: 1,
          joined_at: "2026.08.20 11:50:00",
        }),
      ],
      { skipPublic: false, maxAgeMinutes: 30, nowMs: Date.parse("2026-08-20T12:00:00") },
    );
    expect(picked?.id).toBe(1);
  });

  it("returns null for an empty list", () => {
    expect(
      pickLastInstance([], { skipPublic: false, maxAgeMinutes: null, nowMs: now }),
    ).toBeNull();
  });

  it("composes a location tag the https/vrchat builders accept", () => {
    const row = visit({
      id: 1,
      instance_id: "999~region(jp)",
    });
    const loc = visitLocation(row);
    expect(loc).toBe(`${WORLD_A}:999~region(jp)`);
    expect(httpsLaunchUrl(loc!)).toContain(WORLD_A);
    expect(vrchatLaunchUrl(loc!)).toContain(encodeURIComponent(loc!));
  });
});
