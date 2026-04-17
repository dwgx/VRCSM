import type { VrcSettingEntry, VrcSettingValueSnapshot } from "@/lib/types";

export function snapshotFromEntry(entry: VrcSettingEntry): VrcSettingValueSnapshot {
  const snap: VrcSettingValueSnapshot = { type: entry.type };
  if (entry.intValue !== undefined) snap.intValue = entry.intValue;
  if (entry.floatValue !== undefined) snap.floatValue = entry.floatValue;
  if (entry.stringValue !== undefined) snap.stringValue = entry.stringValue;
  if (entry.boolValue !== undefined) snap.boolValue = entry.boolValue;
  if (entry.raw !== undefined) snap.raw = entry.raw;
  return snap;
}

export function snapshotsEqual(
  a: VrcSettingValueSnapshot,
  b: VrcSettingValueSnapshot,
): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "int":
      return (a.intValue ?? 0) === (b.intValue ?? 0);
    case "float":
      return (a.floatValue ?? 0) === (b.floatValue ?? 0);
    case "string":
      return (a.stringValue ?? "") === (b.stringValue ?? "");
    case "bool":
      return (a.boolValue ?? false) === (b.boolValue ?? false);
    default:
      return JSON.stringify(a.raw ?? []) === JSON.stringify(b.raw ?? []);
  }
}

export function displayForEntry(entry: VrcSettingEntry): string {
  switch (entry.type) {
    case "int":
      return String(entry.intValue ?? 0);
    case "float":
      return (entry.floatValue ?? 0).toString();
    case "string":
      return entry.stringValue ?? "";
    case "bool":
      return entry.boolValue ? "true" : "false";
    default:
      return `[${(entry.raw ?? []).length} B]`;
  }
}

export function hexBytes(bytes: number[] | undefined): string {
  if (!bytes || !bytes.length) return "—";
  return bytes
    .slice(0, 96)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}
