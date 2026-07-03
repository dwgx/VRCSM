import { describe, it, expect } from "vitest";
import {
  normalizeMatrix,
  robustCeiling,
  cellIntensity,
  buildHeatmapModel,
} from "../activity-heatmap";

describe("activity-heatmap normalizeMatrix", () => {
  it("coerces a well-formed 7×24 matrix unchanged", () => {
    const raw = Array.from({ length: 7 }, (_, d) =>
      Array.from({ length: 24 }, (_, h) => d + h),
    );
    const out = normalizeMatrix(raw);
    expect(out).toHaveLength(7);
    expect(out[0]).toHaveLength(24);
    expect(out[3][5]).toBe(8);
  });

  it("pads short rows and clamps negatives / non-numbers to 0", () => {
    const raw = [[1, -2, "x", 4], [], null, [9]];
    const out = normalizeMatrix(raw);
    expect(out).toHaveLength(7);
    expect(out[0][0]).toBe(1);
    expect(out[0][1]).toBe(0); // negative → 0
    expect(out[0][2]).toBe(0); // NaN → 0
    expect(out[0][3]).toBe(4);
    expect(out[0][23]).toBe(0); // padded
    expect(out[2][0]).toBe(0); // null row → zeros
    expect(out[3][0]).toBe(9);
  });

  it("returns an all-zero grid for garbage input", () => {
    expect(normalizeMatrix(null).flat().every((v) => v === 0)).toBe(true);
    expect(normalizeMatrix("nope").flat().every((v) => v === 0)).toBe(true);
    expect(normalizeMatrix(42).flat()).toHaveLength(168);
  });
});

describe("activity-heatmap robustCeiling", () => {
  it("is 0 for an empty grid", () => {
    expect(robustCeiling(normalizeMatrix([]))).toBe(0);
  });

  it("falls back to the max when there are few nonzero samples", () => {
    const m = normalizeMatrix([[1, 2, 100]]);
    // Only 3 nonzero values → use max so we don't mis-estimate a percentile.
    expect(robustCeiling(m)).toBe(100);
  });

  it("ignores a single outlier when enough samples exist", () => {
    // 20 ones plus one huge spike; the 95th percentile should stay near 1,
    // not jump to the spike — this is the whole point of the robust ceiling.
    const row = Array.from({ length: 23 }, () => 1);
    row[23] = 0;
    const m = normalizeMatrix([row, [999]]);
    const ceiling = robustCeiling(m, 0.95);
    expect(ceiling).toBeLessThan(999);
    expect(ceiling).toBeGreaterThanOrEqual(1);
  });

  it("never collapses below 1", () => {
    const m = normalizeMatrix([[1]]);
    expect(robustCeiling(m)).toBeGreaterThanOrEqual(1);
  });
});

describe("activity-heatmap cellIntensity", () => {
  it("is 0 for zero count or zero ceiling", () => {
    expect(cellIntensity(0, 10)).toBe(0);
    expect(cellIntensity(5, 0)).toBe(0);
  });

  it("saturates at 1 when count meets/exceeds the ceiling", () => {
    expect(cellIntensity(10, 10)).toBeCloseTo(1, 5);
    expect(cellIntensity(20, 10)).toBe(1);
  });

  it("lifts low buckets above the linear ramp (gamma < 1)", () => {
    // At 10% of the ceiling, a linear ramp gives 0.1; gamma 0.65 lifts it.
    const intensity = cellIntensity(1, 10, 0.65);
    expect(intensity).toBeGreaterThan(0.1);
    expect(intensity).toBeLessThan(1);
  });

  it("is monotonic in count", () => {
    const a = cellIntensity(1, 100);
    const b = cellIntensity(50, 100);
    const c = cellIntensity(100, 100);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
});

describe("activity-heatmap buildHeatmapModel", () => {
  it("produces 168 cells and aggregate stats", () => {
    const raw = Array.from({ length: 7 }, (_, d) =>
      Array.from({ length: 24 }, (_, h) => (d === 1 && h === 20 ? 12 : 1)),
    );
    const model = buildHeatmapModel(raw);
    expect(model.cells).toHaveLength(168);
    expect(model.peak).toBe(12);
    expect(model.total).toBe(167 * 1 + 12);
    expect(model.busiest).not.toBeNull();
    expect(model.busiest?.day).toBe(1);
    expect(model.busiest?.hour).toBe(20);
  });

  it("returns a null busiest cell for an all-zero grid", () => {
    const model = buildHeatmapModel([]);
    expect(model.total).toBe(0);
    expect(model.peak).toBe(0);
    expect(model.busiest).toBeNull();
    expect(model.cells.every((c) => c.intensity === 0)).toBe(true);
  });
});
