import { describe, expect, it } from "vitest";
import {
  formatHrBpmToken,
  hrBpmFromOscMessage,
  isHrOscAddress,
  parseHrBpm,
} from "../hr-from-osc";

describe("hr-from-osc", () => {
  it("matches common HRtoVRChat addresses and ignores others", () => {
    expect(isHrOscAddress("/avatar/parameters/HR")).toBe(true);
    expect(isHrOscAddress("/avatar/parameters/HeartRate")).toBe(true);
    expect(isHrOscAddress("/avatar/parameters/BPM")).toBe(true);
    expect(isHrOscAddress("/avatar/parameters/VRCEmote")).toBe(false);
  });

  it("parses int and 0..1 float 72-ish", () => {
    expect(parseHrBpm([72])).toBe(72);
    expect(parseHrBpm([72.4])).toBe(72);
    expect(hrBpmFromOscMessage("/avatar/parameters/HR", [0.36])).toBe(72);
    expect(parseHrBpm([0])).toBeNull();
    expect(parseHrBpm([300])).toBeNull();
    expect(hrBpmFromOscMessage("/other", [72])).toBeNull();
  });

  it("clears {hr.bpm} after stale window", () => {
    expect(formatHrBpmToken(72, 0, 1_000)).toBe("72");
    expect(formatHrBpmToken(72, 0, 16_000)).toBe("");
    expect(formatHrBpmToken(null, 0, 1_000)).toBe("");
  });
});
