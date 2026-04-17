import type { Report } from "@/lib/types";
import { formatBytes } from "@/lib/utils";

const CACHE_CATEGORY_KEYS = new Set([
  "cache_windows_player",
  "http_cache",
  "texture_cache",
]);

export function getTrueCacheBytes(report: Report | null | undefined): number {
  if (!report) return 0;
  return report.category_summaries.reduce((total, category) => {
    if (!CACHE_CATEGORY_KEYS.has(category.key)) {
      return total;
    }
    return total + category.bytes;
  }, 0);
}

export function getTrueCacheCategoryCount(report: Report | null | undefined): number {
  if (!report) return 0;
  return report.category_summaries.filter((category) =>
    CACHE_CATEGORY_KEYS.has(category.key) && category.exists,
  ).length;
}

export function getTrueCacheLabel(report: Report | null | undefined): string {
  return formatBytes(getTrueCacheBytes(report));
}
