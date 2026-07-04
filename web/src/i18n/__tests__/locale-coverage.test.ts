import { describe, expect, it } from "vitest";

import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";

// en is the configured fallbackLng (see ../index.ts). Any key present in the
// primary content locale (zh-CN) but missing from en would silently fall back
// to the raw key string at runtime, so en must be a superset of zh-CN's keys.
// This guard fails the build if that coverage drifts.

type Json = Record<string, unknown>;

/** Collect every leaf key path (dot-joined) from a nested locale object. */
function leafKeys(obj: Json, prefix = "", out: string[] = []): string[] {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      leafKeys(v as Json, path, out);
    } else {
      out.push(path);
    }
  }
  return out;
}

describe("locale key coverage", () => {
  it("en (fallback locale) has every key present in zh-CN", () => {
    const enKeys = new Set(leafKeys(en as Json));
    const missing = leafKeys(zhCN as Json).filter((k) => !enKeys.has(k));
    // Surface the first offenders so a failure is actionable, not just a count.
    expect({ missingCount: missing.length, sample: missing.slice(0, 25) }).toEqual({
      missingCount: 0,
      sample: [],
    });
  });
});
