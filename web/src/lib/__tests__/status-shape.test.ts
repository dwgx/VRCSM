import { describe, expect, it } from "vitest";

import { statusShape, statusShapeClass, statusBucket, countOnlineFriends } from "../vrcFriends";

// The colorblind-friendly status indicator pairs each status bucket with a
// distinct shape so the five statuses are distinguishable without color. These
// helpers are pure, so we can lock the mapping directly.

describe("statusShape", () => {
  it("maps each known status to a distinct shape", () => {
    expect(statusShape("join me")).toBe("ring");
    expect(statusShape("active")).toBe("solid");
    expect(statusShape("ask me")).toBe("diamond");
    expect(statusShape("busy")).toBe("square");
    expect(statusShape("offline")).toBe("hollow");
  });

  it("falls back to the offline shape for unknown/null status", () => {
    expect(statusShape(null)).toBe("hollow");
    expect(statusShape("something-else")).toBe("hollow");
  });

  it("produces five unique shapes across the buckets", () => {
    const shapes = new Set(
      ["join me", "active", "ask me", "busy", "offline"].map(statusShape),
    );
    expect(shapes.size).toBe(5);
  });

  it("agrees with statusBucket on the offline fallback", () => {
    // Any status that buckets to offline must also get the hollow shape.
    expect(statusBucket("nonsense")).toBe("offline");
    expect(statusShape("nonsense")).toBe("hollow");
  });
});

describe("statusShapeClass", () => {
  it("returns geometry-overriding classes for non-solid shapes", () => {
    expect(statusShapeClass("diamond")).toContain("rotate-45");
    expect(statusShapeClass("square")).toContain("rounded-[1px]");
    expect(statusShapeClass("ring")).toContain("ring-2");
    expect(statusShapeClass("hollow")).toContain("bg-transparent");
  });

  it("returns no override for the solid (active) shape", () => {
    expect(statusShapeClass("solid")).toBe("");
  });
});

describe("countOnlineFriends", () => {
  it("counts friends with a non-offline location", () => {
    const friends = [
      { location: "wrld_abc:123" },
      { location: "private" },
      { location: "traveling" },
      { location: "offline" },
      { location: null },
      { location: "" },
      {},
    ];
    expect(countOnlineFriends(friends)).toBe(3);
  });

  it("returns 0 for an empty list", () => {
    expect(countOnlineFriends([])).toBe(0);
  });

  it("treats offline and missing locations as offline", () => {
    expect(countOnlineFriends([{ location: "offline" }, {}, { location: null }])).toBe(0);
  });
});
