import { mergeReports } from "./artifacts";

/**
 * Global teardown: merge per-test artifact partials into the consolidated
 * reports (offset-report.json, events.json, manifest.json,
 * pixeldiff-report.json, interaction-report.json). Runs once after the entire
 * suite, so it survives worker recycling that happens on a test failure.
 */
export default function globalTeardown(): void {
  mergeReports();
}
