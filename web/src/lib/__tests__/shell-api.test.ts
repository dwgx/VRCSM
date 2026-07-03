import { describe, it, expect } from "vitest";
import {
  rejoinLocationFromVisit,
  buildVrchatLocationLaunchUrl,
} from "../shell-api";

describe("rejoinLocationFromVisit", () => {
  const WORLD = "wrld_1234abcd";

  it("returns a full location tag verbatim when instance already includes the world id", () => {
    const full = `${WORLD}:54321~region(use)`;
    expect(rejoinLocationFromVisit(WORLD, full)).toBe(full);
  });

  it("composes world:instance when instance is the bare portion", () => {
    expect(rejoinLocationFromVisit(WORLD, "54321~region(use)")).toBe(
      `${WORLD}:54321~region(use)`,
    );
  });

  it("returns null when world id is missing or not a world id", () => {
    expect(rejoinLocationFromVisit("", "54321")).toBeNull();
    expect(rejoinLocationFromVisit(undefined, "54321")).toBeNull();
    expect(rejoinLocationFromVisit("usr_nope", "54321")).toBeNull();
  });

  it("returns null when instance is missing", () => {
    expect(rejoinLocationFromVisit(WORLD, "")).toBeNull();
    expect(rejoinLocationFromVisit(WORLD, null)).toBeNull();
    expect(rejoinLocationFromVisit(WORLD, "   ")).toBeNull();
  });

  it("trims surrounding whitespace before composing", () => {
    expect(rejoinLocationFromVisit(`  ${WORLD}  `, "  54321  ")).toBe(
      `${WORLD}:54321`,
    );
  });

  it("produces a launch url that round-trips through the deeplink builder", () => {
    const loc = rejoinLocationFromVisit(WORLD, "54321~private(usr_x)");
    expect(loc).toBeTruthy();
    const url = buildVrchatLocationLaunchUrl(loc!);
    expect(url).toContain("vrchat://launch");
    expect(url).toContain(encodeURIComponent(loc!));
  });
});
