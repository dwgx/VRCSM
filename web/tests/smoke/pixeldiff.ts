import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

/**
 * Soft (report-only) pixel diff. NEVER a hard fail — this module compares each
 * captured viewport screenshot against a committed baseline under
 * tests/smoke/__screenshots__/<name>.png and records the % diff. On first run
 * (no baseline) it blesses the current screenshot as the baseline.
 */

export interface PixelDiffEntry {
  name: string;
  baselinePath: string;
  actualPath: string;
  diffPath?: string;
  blessed: boolean;
  matched: boolean;
  totalPixels: number;
  diffPixels: number;
  diffPct: number;
  note?: string;
}

function readPng(file: string): PNG | null {
  try {
    return PNG.sync.read(fs.readFileSync(file));
  } catch {
    return null;
  }
}

/**
 * Compare `actualPath` (a freshly-captured screenshot) against the committed
 * baseline `baselineDir/<name>.png`. Writes a diff png to `diffDir/<name>.png`
 * when they differ. Blesses (copies actual → baseline) when no baseline exists.
 */
export function comparePixels(opts: {
  name: string;
  actualPath: string;
  baselineDir: string;
  diffDir: string;
  /** When true, (re)bless the baseline from the current shot regardless of an
   *  existing baseline. Driven by `test:ui-smoke:update` (--update-snapshots). */
  update?: boolean;
}): PixelDiffEntry {
  const { name, actualPath, baselineDir, diffDir } = opts;
  const baselinePath = path.join(baselineDir, `${name}.png`);

  fs.mkdirSync(baselineDir, { recursive: true });
  fs.mkdirSync(diffDir, { recursive: true });

  // First run (no baseline) OR explicit refresh (test:ui-smoke:update passes
  // update=true, derived from Playwright's --update-snapshots) → bless.
  const updateMode = opts.update === true;
  if (!fs.existsSync(baselinePath) || updateMode) {
    const hadBaseline = fs.existsSync(baselinePath);
    fs.copyFileSync(actualPath, baselinePath);
    const png = readPng(actualPath);
    const total = png ? png.width * png.height : 0;
    return {
      name,
      baselinePath,
      actualPath,
      blessed: true,
      matched: true,
      totalPixels: total,
      diffPixels: 0,
      diffPct: 0,
      note: hadBaseline ? "blessed (refresh via update mode)" : "blessed (no prior baseline)",
    };
  }

  const baseline = readPng(baselinePath);
  const actual = readPng(actualPath);
  if (!baseline || !actual) {
    return {
      name,
      baselinePath,
      actualPath,
      blessed: false,
      matched: false,
      totalPixels: 0,
      diffPixels: 0,
      diffPct: 0,
      note: "could not read one of the PNGs",
    };
  }

  // Dimension mismatch → cannot pixelmatch; report as full diff, no crash.
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      name,
      baselinePath,
      actualPath,
      blessed: false,
      matched: false,
      totalPixels: actual.width * actual.height,
      diffPixels: actual.width * actual.height,
      diffPct: 100,
      note: `dimension mismatch baseline ${baseline.width}x${baseline.height} vs actual ${actual.width}x${actual.height}`,
    };
  }

  const { width, height } = actual;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(baseline.data, actual.data, diff.data, width, height, {
    threshold: 0.1,
  });
  const total = width * height;
  const diffPct = total > 0 ? (diffPixels / total) * 100 : 0;

  let diffPath: string | undefined;
  if (diffPixels > 0) {
    diffPath = path.join(diffDir, `${name}.png`);
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
  }

  return {
    name,
    baselinePath,
    actualPath,
    diffPath,
    blessed: false,
    matched: diffPixels === 0,
    totalPixels: total,
    diffPixels,
    diffPct: Number(diffPct.toFixed(4)),
  };
}
