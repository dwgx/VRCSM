/**
 * Pure helpers for the world-visit activity heatmap.
 *
 * The host returns a raw 7×24 matrix of visit counts (row = day-of-week
 * Sun..Sat in the DB's stored timezone, col = hour 0..23) from the
 * `db.stats.heatmap` IPC. VRCX renders an equivalent grid with a flat
 * linear count→opacity ramp, which makes a handful of heavy hours wash out
 * everything else into near-black.
 *
 * Our edge: a perceptual intensity ramp. We normalize against a robust
 * high-percentile ceiling (not the raw max, so one outlier hour doesn't
 * crush the rest) and apply a gamma curve so low-but-nonzero buckets stay
 * visible. The result reads like a real activity surface rather than a few
 * bright dots on black. All logic here is pure and unit-tested.
 */

export type HeatmapMatrix = number[][]; // [7][24]

export interface HeatmapCell {
  day: number; // 0=Sun .. 6=Sat
  hour: number; // 0..23
  count: number;
  /** Perceptual fill intensity in [0,1] for the cell color ramp. */
  intensity: number;
}

export interface HeatmapModel {
  cells: HeatmapCell[];
  /** Robust ceiling used for normalization (the percentile count). */
  ceiling: number;
  /** Largest single-cell count (for the legend / tooltip max). */
  peak: number;
  total: number;
  /** Busiest cell, or null when the matrix is empty/all-zero. */
  busiest: HeatmapCell | null;
}

/** Coerce arbitrary IPC output into a strict 7×24 number matrix. */
export function normalizeMatrix(raw: unknown): HeatmapMatrix {
  const out: HeatmapMatrix = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0),
  );
  if (!Array.isArray(raw)) return out;
  for (let d = 0; d < 7; d += 1) {
    const row = raw[d];
    if (!Array.isArray(row)) continue;
    for (let h = 0; h < 24; h += 1) {
      const v = Number(row[h]);
      out[d][h] = Number.isFinite(v) && v > 0 ? v : 0;
    }
  }
  return out;
}

/**
 * Percentile of the nonzero counts, used as the normalization ceiling so a
 * single outlier hour doesn't flatten the rest of the grid. Falls back to the
 * max when there are too few nonzero samples to estimate a percentile.
 */
export function robustCeiling(matrix: HeatmapMatrix, percentile = 0.95): number {
  const nonzero: number[] = [];
  let max = 0;
  for (const row of matrix) {
    for (const v of row) {
      if (v > 0) nonzero.push(v);
      if (v > max) max = v;
    }
  }
  if (nonzero.length === 0) return 0;
  if (nonzero.length < 5) return max;
  nonzero.sort((a, b) => a - b);
  const idx = Math.min(
    nonzero.length - 1,
    Math.max(0, Math.round(percentile * (nonzero.length - 1))),
  );
  // Never let the ceiling collapse below 1 (keeps single-visit cells visible).
  return Math.max(1, nonzero[idx]);
}

/**
 * Perceptual intensity for a count given a normalization ceiling. Linear
 * normalization with a gamma < 1 lifts low-but-nonzero buckets so they stay
 * legible instead of fading to the background. Counts at/above the ceiling
 * saturate at 1.
 */
export function cellIntensity(count: number, ceiling: number, gamma = 0.65): number {
  if (count <= 0 || ceiling <= 0) return 0;
  const linear = Math.min(1, count / ceiling);
  return Math.pow(linear, gamma);
}

export function buildHeatmapModel(raw: unknown, percentile = 0.95): HeatmapModel {
  const matrix = normalizeMatrix(raw);
  const ceiling = robustCeiling(matrix, percentile);
  const cells: HeatmapCell[] = [];
  let peak = 0;
  let total = 0;
  let busiest: HeatmapCell | null = null;
  for (let d = 0; d < 7; d += 1) {
    for (let h = 0; h < 24; h += 1) {
      const count = matrix[d][h];
      total += count;
      if (count > peak) peak = count;
      const cell: HeatmapCell = {
        day: d,
        hour: h,
        count,
        intensity: cellIntensity(count, ceiling),
      };
      cells.push(cell);
      if (busiest === null || count > busiest.count) {
        busiest = count > 0 ? cell : busiest;
      }
    }
  }
  return { cells, ceiling, peak, total, busiest };
}
