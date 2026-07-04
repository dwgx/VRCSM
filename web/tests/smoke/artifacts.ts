import fs from "node:fs";
import path from "node:path";

/**
 * Per-test artifact partials + merge.
 *
 * Playwright restarts the worker process after a test failure, which wipes any
 * module-level accumulator arrays. Relying on those + an afterAll flush loses
 * every route before the last failure. Instead each test writes its own partial
 * JSON under .artifacts/partials/, and a globalTeardown merges them into the
 * consolidated reports. Robust to worker recycling and to running specs
 * separately.
 */

export const ARTIFACTS = path.join(import.meta.dirname, ".artifacts");
export const PARTIALS = path.join(ARTIFACTS, "partials");

export function ensureArtifactDirs(): void {
  fs.mkdirSync(PARTIALS, { recursive: true });
}

/** Write one test's partial. `kind` namespaces the file (nav | int). */
export function writePartial(kind: string, slug: string, data: unknown): void {
  ensureArtifactDirs();
  const safe = slug.replace(/[^a-z0-9_-]+/gi, "_");
  fs.writeFileSync(path.join(PARTIALS, `${kind}__${safe}.json`), JSON.stringify(data));
}

function readPartials(kind: string): unknown[] {
  if (!fs.existsSync(PARTIALS)) return [];
  return fs
    .readdirSync(PARTIALS)
    .filter((f) => f.startsWith(`${kind}__`) && f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(PARTIALS, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((v): v is unknown => v !== null);
}

interface NavPartial {
  route: string;
  offsets: unknown[];
  events: unknown[];
  manifest: unknown[];
  pixeldiffs: unknown[];
}

interface IntPartial {
  route: string;
  clicks: number;
  events: unknown[];
}

/** Merge all partials into the consolidated report files. Idempotent. */
export function mergeReports(): void {
  const nav = readPartials("nav") as NavPartial[];
  const int = readPartials("int") as IntPartial[];

  const offsetReport = nav.flatMap((n) => n.offsets ?? []);
  const manifest = nav.flatMap((n) => n.manifest ?? []);
  const pixeldiff = nav.flatMap((n) => n.pixeldiffs ?? []);
  const navEvents: Record<string, unknown> = {};
  for (const n of nav) navEvents[n.route] = n.events ?? [];

  const clickTally: Record<string, number> = {};
  const interactionEvents: Record<string, unknown> = {};
  for (const i of int) {
    clickTally[i.route] = i.clicks ?? 0;
    interactionEvents[i.route] = i.events ?? [];
  }

  if (nav.length) {
    fs.writeFileSync(path.join(ARTIFACTS, "offset-report.json"), JSON.stringify(offsetReport, null, 2));
    fs.writeFileSync(path.join(ARTIFACTS, "events.json"), JSON.stringify(navEvents, null, 2));
    fs.writeFileSync(path.join(ARTIFACTS, "manifest.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(ARTIFACTS, "pixeldiff-report.json"), JSON.stringify(pixeldiff, null, 2));
  }
  if (int.length) {
    fs.writeFileSync(
      path.join(ARTIFACTS, "interaction-report.json"),
      JSON.stringify({ clickTally, interactionEvents }, null, 2),
    );
  }
}
