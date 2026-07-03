import { describe, it, expect } from "vitest";
import { deriveNameHistory, type NameLogEvent } from "../name-history";

function ev(old: string | null, neu: string | null, at: string): NameLogEvent {
  return { event_type: "displayName.changed", old_value: old, new_value: neu, occurred_at: at };
}

describe("deriveNameHistory", () => {
  it("returns [] when there are no name-change events", () => {
    const events: NameLogEvent[] = [
      { event_type: "status.changed", old_value: "a", new_value: "b", occurred_at: "2026-01-01T00:00:00Z" },
      { event_type: "avatar.changed", old_value: null, new_value: "av", occurred_at: "2026-01-02T00:00:00Z" },
    ];
    expect(deriveNameHistory(events, "Current")).toEqual([]);
  });

  it("lists former names newest-first", () => {
    const events = [
      ev("OldOne", "OldTwo", "2026-01-01T00:00:00Z"),
      ev("OldTwo", "Current", "2026-02-01T00:00:00Z"),
    ];
    const out = deriveNameHistory(events, "Current");
    expect(out.map((e) => e.name)).toEqual(["OldTwo", "OldOne"]);
  });

  it("excludes the current name", () => {
    const events = [
      ev("Current", "Temp", "2026-01-01T00:00:00Z"),
      ev("Temp", "Current", "2026-02-01T00:00:00Z"),
    ];
    const out = deriveNameHistory(events, "Current");
    expect(out.map((e) => e.name)).toEqual(["Temp"]);
  });

  it("de-dupes repeated former names keeping the latest sighting", () => {
    const events = [
      ev("Alpha", "Beta", "2026-01-01T00:00:00Z"),
      ev("Beta", "Alpha", "2026-02-01T00:00:00Z"),
      ev("Alpha", "Gamma", "2026-03-01T00:00:00Z"),
    ];
    const out = deriveNameHistory(events, "Gamma");
    // Alpha appears twice as old_value; keep the most recent (2026-03).
    const alpha = out.find((e) => e.name === "Alpha");
    expect(alpha?.lastSeen).toBe("2026-03-01T00:00:00Z");
    // No duplicate Alpha entries.
    expect(out.filter((e) => e.name === "Alpha")).toHaveLength(1);
  });

  it("ignores blank old_value", () => {
    const events = [
      ev("", "First", "2026-01-01T00:00:00Z"),
      ev("   ", "Second", "2026-01-02T00:00:00Z"),
      ev("Real", "Third", "2026-01-03T00:00:00Z"),
    ];
    const out = deriveNameHistory(events, "Third");
    expect(out.map((e) => e.name)).toEqual(["Real"]);
  });

  it("handles a missing currentName by listing all former names", () => {
    const events = [ev("A", "B", "2026-01-01T00:00:00Z")];
    expect(deriveNameHistory(events).map((e) => e.name)).toEqual(["A"]);
  });
});
