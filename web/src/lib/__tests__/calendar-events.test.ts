import { describe, expect, it } from "vitest";
import {
  getGroupId,
  getJamState,
  normalizeJams,
  getEventTitle,
} from "@/lib/calendar-events";

describe("calendar-events", () => {
  it("reads group id from ownerId used by VRChat calendar payloads", () => {
    expect(getGroupId({ ownerId: "grp_abc" })).toBe("grp_abc");
    expect(getGroupId({ group: { id: "grp_nested" } })).toBe("grp_nested");
  });

  it("does not treat non-string jam state as a crashable value", () => {
    expect(getJamState({ state: { code: "live" } })).toBeUndefined();
    expect(getJamState({ state: "closed" })).toBe("closed");
    expect(getJamState({ isActive: true })).toBe("active");
  });

  it("unwraps jams from content/results envelopes", () => {
    expect(normalizeJams({ content: [{ id: "1", title: "A" }] })).toHaveLength(1);
    expect(normalizeJams([{ id: "2" }])).toHaveLength(1);
    expect(normalizeJams({ ok: true })).toEqual([]);
  });

  it("falls back to Untitled for nameless events", () => {
    expect(getEventTitle({})).toBe("Untitled");
  });
});
