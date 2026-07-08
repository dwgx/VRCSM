import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression lock for the "resets to English every launch" bug: a stored
// vrcsm.language must survive the async init() and end up as the active
// language. The original i18nReady read i18n.resolvedLanguage in the same tick
// as a non-awaited init(), so a saved non-en locale (e.g. zh-CN) silently fell
// back to "en" until the user re-picked it by hand.

describe("i18n startup language persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("honors a stored non-en language after i18nReady resolves", async () => {
    // Simulate a previous session having persisted zh-CN.
    window.localStorage.setItem("vrcsm.language", "zh-CN");

    const mod = await import("../index");
    await mod.i18nReady;

    const active = mod.default.resolvedLanguage ?? mod.default.language;
    expect(active).toBe("zh-CN");
  });

  it("falls back to en when nothing is stored (and navigator is en)", async () => {
    // jsdom's navigator.language defaults to en-US, so with no stored value
    // the detector should resolve to en.
    const mod = await import("../index");
    await mod.i18nReady;

    const active = mod.resolveSupportedLanguage(
      mod.default.resolvedLanguage ?? mod.default.language,
    );
    expect(active).toBe("en");
  });
});
