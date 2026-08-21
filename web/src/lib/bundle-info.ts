export type BundleAssetType = "avatar" | "world" | "unknown";

export function parseInfoUrl(url: string): { type: BundleAssetType; id: string | null } {
  if (!url) return { type: "unknown", id: null };
  const avtrMatch = url.match(/(avtr_[0-9a-f-]{36})/i);
  if (avtrMatch) return { type: "avatar", id: avtrMatch[1] };
  const wrldMatch = url.match(/(wrld_[0-9a-f-]{36})/i);
  if (wrldMatch) return { type: "world", id: wrldMatch[1] };
  return { type: "unknown", id: null };
}

/**
 * VRChat `__info` is either a URL (legacy) or a Unity cache manifest:
 *   -1
 *   <unix-seconds>
 *   1
 *   __data
 */
export function parseInfoText(infoText: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = infoText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2 && lines[0] === "-1" && /^\d+$/.test(lines[1])) {
    out.format = "unity-cache";
    out.timestamp = lines[1];
    if (lines[2]) out.version = lines[2];
    if (lines[3]) out.payload = lines[3];
    return out;
  }
  for (const line of lines) {
    const eq = line.indexOf("=");
    const colon = line.indexOf(":");
    const sep =
      eq >= 0 && (colon < 0 || eq < colon) ? eq : colon >= 0 ? colon : -1;
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (key && value) out[key] = value;
  }
  if (lines[0]?.startsWith("http")) {
    out.url = lines[0];
  }
  return out;
}
