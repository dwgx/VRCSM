import { afterEach, describe, expect, it } from "vitest";

import {
  IpcError,
  checkResultShape,
  registerResultValidator,
} from "../ipc";

// The IPC response path resolves `resp.result` by casting `unknown` to the
// caller's TResult. `checkResultShape` is the opt-in guard that rejects hot
// methods whose payload drifts from the expected shape. These tests lock the
// built-in validators and the register/clear contract without driving the full
// WebView bridge.

describe("checkResultShape — built-in validators", () => {
  it("passes valid payloads (returns null)", () => {
    expect(checkResultShape("auth.status", { authed: true, userId: "usr_1", displayName: "a" })).toBeNull();
    expect(checkResultShape("auth.user", { authed: false, user: null })).toBeNull();
    expect(checkResultShape("friends.list", { friends: [] })).toBeNull();
    expect(
      checkResultShape("scan", { base_dir: "C:/x", category_summaries: [] }),
    ).toBeNull();
    expect(checkResultShape("db.stats.overview", { total_world_visits: 0 })).toBeNull();
  });

  it("rejects a drifted payload with a structured shape_mismatch IpcError", () => {
    const err = checkResultShape("friends.list", { rows: [] });
    expect(err).toBeInstanceOf(IpcError);
    expect(err?.code).toBe("shape_mismatch");
    expect(err?.message).toContain("friends.list");
  });

  it("rejects when a success-shaped error object slips through", () => {
    // e.g. host returns { authed: "yes" } (string, not boolean).
    expect(checkResultShape("auth.status", { authed: "yes" })?.code).toBe(
      "shape_mismatch",
    );
    // Array where an object is expected.
    expect(checkResultShape("scan", [])?.code).toBe("shape_mismatch");
    // null / primitive payloads.
    expect(checkResultShape("db.stats.overview", null)?.code).toBe(
      "shape_mismatch",
    );
  });
});

describe("checkResultShape — opt-in / backward compatibility", () => {
  it("returns null for unregistered methods (cast-only path preserved)", () => {
    expect(checkResultShape("some.unregistered.method", 42)).toBeNull();
    expect(checkResultShape("another.method", { anything: true })).toBeNull();
  });
});

describe("registerResultValidator", () => {
  const METHOD = "test.custom.method";

  afterEach(() => {
    // Clear so a leaked registration can't affect other tests / methods.
    registerResultValidator(METHOD, null);
  });

  it("registers a custom validator and enforces it", () => {
    registerResultValidator(METHOD, (r) => typeof r === "number");
    expect(checkResultShape(METHOD, 7)).toBeNull();
    expect(checkResultShape(METHOD, "not-a-number")?.code).toBe("shape_mismatch");
  });

  it("replaces an existing validator on re-registration", () => {
    registerResultValidator(METHOD, () => false);
    expect(checkResultShape(METHOD, {})?.code).toBe("shape_mismatch");
    registerResultValidator(METHOD, () => true);
    expect(checkResultShape(METHOD, {})).toBeNull();
  });

  it("clears a validator when passed null (falls back to cast-only)", () => {
    registerResultValidator(METHOD, () => false);
    expect(checkResultShape(METHOD, {})?.code).toBe("shape_mismatch");
    registerResultValidator(METHOD, null);
    expect(checkResultShape(METHOD, {})).toBeNull();
  });
});
