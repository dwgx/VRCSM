/** Incoming OSC heart-rate (HRtoVRChat-style). Local UDP only — not Pulsoid. */

export const HR_STALE_MS = 15_000;

const HR_LEAF = new Set([
  "hr",
  "heartrate",
  "heart_rate",
  "heartratebpm",
  "hrbpm",
  "bpm",
]);

export function isHrOscAddress(address: string): boolean {
  const leaf = address.trim().split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
  return HR_LEAF.has(leaf);
}

export function parseHrBpm(args: ReadonlyArray<number | string | boolean> | undefined): number | null {
  if (!args || args.length === 0) return null;
  const v = args[0];
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") n = Number(v);
  else return null;
  if (!Number.isFinite(n)) return null;
  // HRtoVRChat sometimes sends 0..1 float; treat (0, 2] as a fraction of 200.
  if (n > 0 && n <= 2) n = Math.round(n * 200);
  n = Math.round(n);
  if (n < 20 || n > 250) return null;
  return n;
}

export function hrBpmFromOscMessage(
  address: string,
  args: ReadonlyArray<number | string | boolean> | undefined,
): number | null {
  if (!isHrOscAddress(address)) return null;
  return parseHrBpm(args);
}

export function formatHrBpmToken(
  bpm: number | null | undefined,
  atMs: number,
  nowMs: number,
  staleMs: number = HR_STALE_MS,
): string {
  if (bpm == null) return "";
  if (nowMs - atMs > staleMs) return "";
  return String(bpm);
}
