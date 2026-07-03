import { afterEach, describe, expect, it, vi } from "vitest";

// vrcFriends.ts reads the active language from the i18n singleton. Mock it so
// we can assert the locale actually drives the output of relativeTime.
let mockLanguage = "en";
vi.mock("@/i18n", () => ({
  default: {
    get language() {
      return mockLanguage;
    },
  },
}));

import { relativeTime } from "../vrcFriends";

afterEach(() => {
  mockLanguage = "en";
  vi.useRealTimers();
});

function isoSecondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

describe("relativeTime", () => {
  it("returns empty string for missing or unparseable input", () => {
    expect(relativeTime(null)).toBe("");
    expect(relativeTime(undefined)).toBe("");
    expect(relativeTime("not-a-date")).toBe("");
  });

  it("renders English relative phrases by default", () => {
    expect(relativeTime(isoSecondsAgo(5))).toMatch(/now/i);
    expect(relativeTime(isoSecondsAgo(120))).toMatch(/minute/i);
    expect(relativeTime(isoSecondsAgo(3 * 3600))).toMatch(/hour/i);
    expect(relativeTime(isoSecondsAgo(2 * 86400))).toMatch(/day/i);
  });

  it("localizes to the active i18n language", () => {
    mockLanguage = "zh-CN";
    // Intl renders Chinese units — assert it is no longer leaking English.
    const out = relativeTime(isoSecondsAgo(120));
    expect(out).not.toMatch(/ago/i);
    expect(out).toContain("分");
  });

  it("never returns blank for a valid timestamp", () => {
    for (const s of [1, 90, 7200, 200000, 3000000, 40000000]) {
      expect(relativeTime(isoSecondsAgo(s)).length).toBeGreaterThan(0);
    }
  });
});
