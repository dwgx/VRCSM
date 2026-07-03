import { describe, it, expect } from "vitest";
import { parseServerStatus, levelFromIndicator } from "../vrchat-server-status";

describe("levelFromIndicator", () => {
  it("maps known Statuspage indicators", () => {
    expect(levelFromIndicator("none")).toBe("operational");
    expect(levelFromIndicator("minor")).toBe("minor");
    expect(levelFromIndicator("major")).toBe("major");
    expect(levelFromIndicator("critical")).toBe("critical");
  });

  it("falls back to unknown for unrecognized / missing values", () => {
    expect(levelFromIndicator("maintenance")).toBe("unknown");
    expect(levelFromIndicator(undefined)).toBe("unknown");
    expect(levelFromIndicator(null)).toBe("unknown");
    expect(levelFromIndicator(42)).toBe("unknown");
  });
});

describe("parseServerStatus", () => {
  it("parses a healthy Statuspage payload", () => {
    const payload = {
      page: { id: "gw6db8tk47y2", name: "VRChat" },
      status: { indicator: "none", description: "All Systems Operational" },
    };
    expect(parseServerStatus(payload)).toEqual({
      level: "operational",
      description: "All Systems Operational",
    });
  });

  it("parses an outage payload", () => {
    const payload = {
      status: { indicator: "major", description: "Partial outage" },
    };
    expect(parseServerStatus(payload)).toEqual({
      level: "major",
      description: "Partial outage",
    });
  });

  it("returns unknown for malformed payloads", () => {
    expect(parseServerStatus(null)).toEqual({ level: "unknown", description: "" });
    expect(parseServerStatus("nope")).toEqual({ level: "unknown", description: "" });
    expect(parseServerStatus({})).toEqual({ level: "unknown", description: "" });
    expect(parseServerStatus({ status: 5 })).toEqual({ level: "unknown", description: "" });
  });

  it("tolerates a missing description", () => {
    expect(parseServerStatus({ status: { indicator: "minor" } })).toEqual({
      level: "minor",
      description: "",
    });
  });
});
