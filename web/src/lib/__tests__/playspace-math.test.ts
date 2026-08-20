import { describe, expect, it } from "vitest";
import {
  applyLocks,
  clampNudge,
  clampSession,
  controlsDisabled,
  DEFAULT_PLAYSPACE_LOCKS,
  keyToNudge,
  stickDelta,
} from "../playspace-math";

describe("applyLocks", () => {
  it("drops Y when lockY is on (default)", () => {
    const v = applyLocks({ x: 1, y: 0.5, z: -1 }, DEFAULT_PLAYSPACE_LOCKS);
    expect(v).toEqual({ x: 1, y: 0, z: -1 });
  });
});

describe("clampNudge", () => {
  it("accepts ±0.25 and rejects anything larger", () => {
    expect(clampNudge({ x: 0.25, y: 0, z: 0 }).ok).toBe(true);
    expect(clampNudge({ x: 0.26, y: 0, z: 0 })).toEqual({ ok: false, code: "invalid_params" });
  });
});

describe("clampSession", () => {
  it("rejects a step that would exceed 5 m", () => {
    expect(clampSession({ x: 0, y: 0, z: 4.9 }, { x: 0, y: 0, z: 0.05 }).ok).toBe(true);
    expect(clampSession({ x: 0, y: 0, z: 4.9 }, { x: 0, y: 0, z: 0.2 })).toEqual({
      ok: false,
      code: "offset_limit",
    });
  });
});

describe("stickDelta", () => {
  it("maps stick XY to playspace XZ after deadzone", () => {
    expect(stickDelta(0.1, 0.1, 1)).toEqual({ x: 0, y: 0, z: 0 });
    const d = stickDelta(1, 0, 1, 1.5);
    expect(d.x).toBeCloseTo(1.5);
    expect(d.y).toBe(0);
    expect(d.z).toBe(0);
  });
});

describe("keyToNudge", () => {
  it("maps arrows to XZ and Page keys to Y when unlocked", () => {
    const unlocked = { lockX: false, lockY: false, lockZ: false };
    expect(keyToNudge("ArrowLeft", unlocked)).toEqual({ x: -0.05, y: 0, z: 0 });
    expect(keyToNudge("ArrowUp", unlocked)).toEqual({ x: 0, y: 0, z: 0.05 });
    expect(keyToNudge("PageUp", unlocked)).toEqual({ x: 0, y: 0.05, z: 0 });
    expect(keyToNudge("PageUp", DEFAULT_PLAYSPACE_LOCKS)).toBeNull();
    expect(keyToNudge("a", unlocked)).toBeNull();
  });
});

describe("controlsDisabled", () => {
  it("disables the lab unless SteamVR is ready or active", () => {
    expect(controlsDisabled("idle")).toBe(true);
    expect(controlsDisabled("steamvr_not_running")).toBe(true);
    expect(controlsDisabled("error")).toBe(true);
    expect(controlsDisabled("ready")).toBe(false);
    expect(controlsDisabled("active")).toBe(false);
  });
});
