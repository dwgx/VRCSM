/**
 * Pure utility functions for the Radar page — no React, no side effects.
 */

export function formatDateAndTime(iso: string | null): string {
  if (!iso) return "--";
  if (iso.includes(".") && iso.includes(" ") && !iso.includes("T")) {
    return iso;
  }
  return iso.replace("T", " ").slice(0, 19);
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function shortId(id: string): string {
  if (!id) return "";
  const clean = id.replace(/^(wrld|avtr|usr)_/, "");
  if (clean.length <= 14) return clean;
  return `${clean.slice(0, 8)}…${clean.slice(-4)}`;
}

export function formatTimePart(isoTime: string | null): string {
  if (!isoTime) return "--:--";
  // Handle both "2026.04.15 00:42:02" and ISO 8601 formats
  const timePart = isoTime.includes(" ") ? isoTime.split(" ")[1] : isoTime.split("T")[1]?.slice(0, 8);
  return timePart ?? "--:--";
}

export function parseEventTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  if (value.includes(".") && value.includes(" ") && !value.includes("T")) {
    const [datePart, timePart] = value.split(" ");
    const parsed = Date.parse(`${datePart.replace(/\./g, "-")}T${timePart}`);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
