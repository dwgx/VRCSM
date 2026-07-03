import { describe, it, expect } from "vitest";
import {
  hashUserId,
  userColor,
  ensureContrast,
} from "../user-color";

describe("user-color hashUserId", () => {
  it("is deterministic", () => {
    expect(hashUserId("usr_abc")).toBe(hashUserId("usr_abc"));
  });

  it("differs for different ids", () => {
    expect(hashUserId("usr_abc")).not.toBe(hashUserId("usr_abd"));
  });

  it("returns an unsigned 32-bit integer", () => {
    const h = hashUserId("usr_some-long-id-1234567890");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it("handles the empty string without throwing", () => {
    expect(() => hashUserId("")).not.toThrow();
  });
});

describe("user-color userColor", () => {
  it("is deterministic per id", () => {
    expect(userColor("usr_abc").css).toBe(userColor("usr_abc").css);
  });

  it("produces a valid oklch() string", () => {
    const { css } = userColor("usr_abc");
    expect(css).toMatch(/^oklch\(\d\.\d{3} \d\.\d{3} \d+(\.\d)?\)$/);
  });

  it("keeps hue in [0,360)", () => {
    for (const id of ["usr_a", "usr_bbbb", "usr_zzz999", "x", ""]) {
      const { hue } = userColor(id);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("spreads hues for similar ids via the golden angle", () => {
    // Sequential ids should NOT cluster — the golden angle decorrelates them.
    const a = userColor("usr_0001").hue;
    const b = userColor("usr_0002").hue;
    const c = userColor("usr_0003").hue;
    // No two of three adjacent ids land within 10° of each other.
    expect(Math.abs(a - b)).toBeGreaterThan(10);
    expect(Math.abs(b - c)).toBeGreaterThan(10);
  });

  it("yields a good spread of hues across many ids", () => {
    const buckets = new Set<number>();
    for (let i = 0; i < 60; i += 1) {
      buckets.add(Math.floor(userColor(`usr_user_${i}`).hue / 30)); // 12 buckets
    }
    // Expect most of the 12 hue buckets to be hit — not all colors bunched up.
    expect(buckets.size).toBeGreaterThanOrEqual(8);
  });

  it("pins lightness to the legible dark-theme band by default", () => {
    const { lightness } = userColor("usr_abc");
    expect(lightness).toBeGreaterThan(0.7);
    expect(lightness).toBeLessThanOrEqual(0.92);
  });
});

describe("user-color ensureContrast", () => {
  it("leaves an already-contrasting lightness untouched", () => {
    // 0.78 vs a dark 0.27 background already clears the threshold.
    expect(ensureContrast(0.78, 0.27)).toBe(0.78);
  });

  it("lifts a too-dark color on a dark background", () => {
    const out = ensureContrast(0.3, 0.27);
    expect(out).toBeGreaterThan(0.3);
    expect(out).toBeGreaterThanOrEqual(0.27 + 0.5 - 1e-9);
  });

  it("drops a too-light color on a light background", () => {
    const out = ensureContrast(0.8, 0.95);
    expect(out).toBeLessThan(0.8);
  });
});
