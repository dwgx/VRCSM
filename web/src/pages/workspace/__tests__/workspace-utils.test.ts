/**
 * Tests for workspace utility functions.
 */

import { describe, it, expect } from "vitest";
import {
  statusBadgeVariant,
  shortenId,
  moderationVariant,
  settingValueText,
  isJsonRecord,
  scalarText,
  stringArrayField,
  findScalarField,
} from "@/pages/workspace/workspace-utils";

describe("workspace-utils", () => {
  describe("statusBadgeVariant", () => {
    it("maps known statuses correctly", () => {
      expect(statusBadgeVariant("join me")).toBe("success");
      expect(statusBadgeVariant("active")).toBe("success");
      expect(statusBadgeVariant("ask me")).toBe("secondary");
      expect(statusBadgeVariant("busy")).toBe("warning");
    });

    it("returns muted for unknown/null", () => {
      expect(statusBadgeVariant(null)).toBe("muted");
      expect(statusBadgeVariant("offline")).toBe("muted");
    });
  });

  describe("shortenId", () => {
    it("returns short IDs unchanged", () => {
      expect(shortenId("short")).toBe("short");
    });

    it("truncates long IDs with ellipsis", () => {
      const long = "usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const result = shortenId(long);
      expect(result).toContain("…");
      expect(result.length).toBeLessThan(long.length);
    });
  });

  describe("moderationVariant", () => {
    it("maps block to warning", () => {
      expect(moderationVariant({ type: "block" } as any)).toBe("warning");
    });

    it("maps mute to secondary", () => {
      expect(moderationVariant({ type: "mute" } as any)).toBe("secondary");
    });

    it("maps unknown to muted", () => {
      expect(moderationVariant({ type: "xyz" } as any)).toBe("muted");
    });
  });

  describe("settingValueText", () => {
    it("returns null for null entry", () => {
      expect(settingValueText(null)).toBeNull();
    });

    it("handles string type", () => {
      expect(settingValueText({ type: "string", stringValue: "hello" } as any)).toBe("hello");
      expect(settingValueText({ type: "string", stringValue: "  " } as any)).toBeNull();
    });

    it("handles int type", () => {
      expect(settingValueText({ type: "int", intValue: 42 } as any)).toBe("42");
    });

    it("handles float type", () => {
      expect(settingValueText({ type: "float", floatValue: 0.85 } as any)).toBe("0.85");
    });

    it("handles bool type", () => {
      expect(settingValueText({ type: "bool", boolValue: true } as any)).toBe("true");
      expect(settingValueText({ type: "bool", boolValue: false } as any)).toBe("false");
    });
  });

  describe("isJsonRecord", () => {
    it("returns true for plain objects", () => {
      expect(isJsonRecord({})).toBe(true);
      expect(isJsonRecord({ a: 1 })).toBe(true);
    });

    it("returns false for arrays, null, primitives", () => {
      expect(isJsonRecord([])).toBe(false);
      expect(isJsonRecord(null)).toBe(false);
      expect(isJsonRecord("string")).toBe(false);
      expect(isJsonRecord(42)).toBe(false);
    });
  });

  describe("scalarText", () => {
    it("extracts string values", () => {
      expect(scalarText("hello")).toBe("hello");
      expect(scalarText("  ")).toBeNull();
    });

    it("converts numbers and booleans", () => {
      expect(scalarText(42)).toBe("42");
      expect(scalarText(true)).toBe("true");
    });

    it("returns null for non-scalar types", () => {
      expect(scalarText(null)).toBeNull();
      expect(scalarText(undefined)).toBeNull();
      expect(scalarText({})).toBeNull();
    });
  });

  describe("stringArrayField", () => {
    it("extracts string arrays", () => {
      expect(stringArrayField({ tags: ["a", "b"] }, "tags")).toEqual(["a", "b"]);
    });

    it("filters out non-strings and empty strings", () => {
      expect(stringArrayField({ tags: ["a", 42, "", "  ", "b"] } as any, "tags")).toEqual(["a", "b"]);
    });

    it("returns empty for missing key or non-array", () => {
      expect(stringArrayField({}, "tags")).toEqual([]);
      expect(stringArrayField(null, "tags")).toEqual([]);
      expect(stringArrayField({ tags: "string" }, "tags")).toEqual([]);
    });
  });

  describe("findScalarField", () => {
    it("finds exact key matches", () => {
      const record = { steamId: "12345", email: "x@y.com" };
      expect(findScalarField(record, ["steamid"])).toEqual({ key: "steamId", value: "12345" });
    });

    it("falls back to partial matches", () => {
      const record = { obfuscatedEmail: "x@y.com" };
      expect(findScalarField(record, ["email"])).toEqual({ key: "obfuscatedEmail", value: "x@y.com" });
    });

    it("returns null for no match", () => {
      expect(findScalarField({ foo: "bar" }, ["baz"])).toBeNull();
      expect(findScalarField(null, ["foo"])).toBeNull();
    });
  });
});
