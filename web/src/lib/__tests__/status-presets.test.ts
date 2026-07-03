import { describe, it, expect } from "vitest";
import {
  parsePresets,
  addPreset,
  removePreset,
  isVrcStatus,
  MAX_PRESETS,
  MAX_LABEL_LEN,
  MAX_DESC_LEN,
  type StatusPreset,
} from "../status-presets";

describe("status-presets parsePresets", () => {
  it("returns [] for invalid JSON", () => {
    expect(parsePresets("not json")).toEqual([]);
    expect(parsePresets("")).toEqual([]);
  });

  it("returns [] for non-array JSON", () => {
    expect(parsePresets('{"a":1}')).toEqual([]);
    expect(parsePresets("42")).toEqual([]);
  });

  it("drops entries missing id or label", () => {
    const raw = JSON.stringify([
      { id: "", label: "x", status: "busy", statusDescription: "" },
      { id: "a", label: "", status: "busy", statusDescription: "" },
      { id: "ok", label: "Good", status: "active", statusDescription: "hi" },
    ]);
    const out = parsePresets(raw);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("ok");
  });

  it("drops entries with an unknown status", () => {
    const raw = JSON.stringify([
      { id: "a", label: "bad", status: "invisible", statusDescription: "" },
      { id: "b", label: "good", status: "join me", statusDescription: "" },
    ]);
    const out = parsePresets(raw);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("join me");
  });

  it("caps to MAX_PRESETS", () => {
    const many = Array.from({ length: MAX_PRESETS + 5 }, (_, i) => ({
      id: `id${i}`,
      label: `L${i}`,
      status: "active",
      statusDescription: "",
    }));
    expect(parsePresets(JSON.stringify(many))).toHaveLength(MAX_PRESETS);
  });
});

describe("status-presets addPreset", () => {
  const base: StatusPreset[] = [];

  it("appends a new preset and assigns an id when absent", () => {
    const out = addPreset(base, { label: "Open", status: "join me", statusDescription: "come hang" });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBeTruthy();
    expect(out[0].label).toBe("Open");
    expect(out[0].status).toBe("join me");
  });

  it("trims overlong label and description", () => {
    const longLabel = "x".repeat(MAX_LABEL_LEN + 10);
    const longDesc = "y".repeat(MAX_DESC_LEN + 10);
    const out = addPreset(base, { label: longLabel, status: "busy", statusDescription: longDesc });
    expect(out[0].label).toHaveLength(MAX_LABEL_LEN);
    expect(out[0].statusDescription).toHaveLength(MAX_DESC_LEN);
  });

  it("ignores an empty label", () => {
    expect(addPreset(base, { label: "   ", status: "busy", statusDescription: "x" })).toEqual([]);
  });

  it("de-dupes identical label+status+description", () => {
    const once = addPreset(base, { label: "Grind", status: "busy", statusDescription: "lab" });
    const twice = addPreset(once, { label: "Grind", status: "busy", statusDescription: "lab" });
    expect(twice).toHaveLength(1);
  });

  it("allows same label with different status", () => {
    const a = addPreset(base, { label: "Mode", status: "busy", statusDescription: "" });
    const b = addPreset(a, { label: "Mode", status: "active", statusDescription: "" });
    expect(b).toHaveLength(2);
  });

  it("never exceeds MAX_PRESETS", () => {
    let list: StatusPreset[] = [];
    for (let i = 0; i < MAX_PRESETS + 5; i++) {
      list = addPreset(list, { label: `L${i}`, status: "active", statusDescription: `d${i}` });
    }
    expect(list).toHaveLength(MAX_PRESETS);
  });
});

describe("status-presets removePreset", () => {
  it("removes by id and leaves others", () => {
    const list = addPreset(
      addPreset([], { label: "A", status: "busy", statusDescription: "" }),
      { label: "B", status: "active", statusDescription: "" },
    );
    const removed = removePreset(list, list[0].id);
    expect(removed).toHaveLength(1);
    expect(removed[0].label).toBe("B");
  });

  it("is a no-op for an unknown id", () => {
    const list = addPreset([], { label: "A", status: "busy", statusDescription: "" });
    expect(removePreset(list, "nope")).toHaveLength(1);
  });
});

describe("status-presets isVrcStatus", () => {
  it("accepts the five known statuses", () => {
    for (const s of ["active", "join me", "ask me", "busy", "offline"]) {
      expect(isVrcStatus(s)).toBe(true);
    }
  });
  it("rejects anything else", () => {
    expect(isVrcStatus("invisible")).toBe(false);
    expect(isVrcStatus(undefined)).toBe(false);
    expect(isVrcStatus(5)).toBe(false);
  });
});
