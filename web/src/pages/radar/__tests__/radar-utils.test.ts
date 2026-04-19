/**
 * Tests for radar utility functions.
 */

import { describe, it, expect } from "vitest";
import {
  formatDateAndTime,
  formatDuration,
  shortId,
  formatTimePart,
  parseEventTimestamp,
} from "../radar-utils";

describe("radar-utils", () => {
  describe("formatDateAndTime", () => {
    it("returns '--' for null", () => {
      expect(formatDateAndTime(null)).toBe("--");
    });

    it("passes through VRChat-style timestamps", () => {
      expect(formatDateAndTime("2026.04.15 00:42:02")).toBe("2026.04.15 00:42:02");
    });

    it("converts ISO 8601 to readable format", () => {
      expect(formatDateAndTime("2026-04-15T00:42:02.000Z")).toBe("2026-04-15 00:42:02");
    });
  });

  describe("formatDuration", () => {
    it("formats zero and negative as '0s'", () => {
      expect(formatDuration(0)).toBe("0s");
      expect(formatDuration(-100)).toBe("0s");
    });

    it("formats seconds only", () => {
      expect(formatDuration(45000)).toBe("45s");
    });

    it("formats minutes and seconds", () => {
      expect(formatDuration(125000)).toBe("2m 5s");
    });

    it("formats hours and minutes", () => {
      expect(formatDuration(3661000)).toBe("1h 1m");
    });
  });

  describe("shortId", () => {
    it("returns empty string for empty input", () => {
      expect(shortId("")).toBe("");
    });

    it("strips VRChat prefixes", () => {
      const result = shortId("wrld_abcdef");
      expect(result).not.toContain("wrld_");
    });

    it("truncates long IDs", () => {
      const long = "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const result = shortId(long);
      expect(result).toContain("…");
    });

    it("returns short IDs unchanged after prefix strip", () => {
      expect(shortId("usr_short")).toBe("short");
    });
  });

  describe("formatTimePart", () => {
    it("returns '--:--' for null", () => {
      expect(formatTimePart(null)).toBe("--:--");
    });

    it("extracts time from VRChat format", () => {
      expect(formatTimePart("2026.04.15 14:30:22")).toBe("14:30:22");
    });

    it("extracts time from ISO 8601", () => {
      expect(formatTimePart("2026-04-15T14:30:22.000Z")).toBe("14:30:22");
    });
  });

  describe("parseEventTimestamp", () => {
    it("returns null for null/undefined", () => {
      expect(parseEventTimestamp(null)).toBeNull();
      expect(parseEventTimestamp(undefined)).toBeNull();
    });

    it("parses VRChat-style timestamps", () => {
      const result = parseEventTimestamp("2026.04.15 00:42:02");
      expect(result).toBeTypeOf("number");
      expect(result).toBeGreaterThan(0);
    });

    it("parses ISO 8601 timestamps", () => {
      const result = parseEventTimestamp("2026-04-15T00:42:02.000Z");
      expect(result).toBeTypeOf("number");
      expect(result).toBeGreaterThan(0);
    });

    it("returns null for unparseable strings", () => {
      expect(parseEventTimestamp("not-a-date")).toBeNull();
    });
  });
});
