/**
 * Deterministic placeholder helpers — turn any stable string (avatar id,
 * world id, file path) into a visually pleasant gradient + initials pair.
 *
 * Purpose: every image slot in the app should render *something* on the
 * very first frame, even before the network/disk has served the real
 * bytes. No spinners, no empty boxes. When the real image arrives it
 * fades in over the gradient.
 *
 * Deterministic means the same id always gets the same colour, so a user
 * mentally associates a colour with a specific avatar/world across
 * reloads. That "this card is the purple one" recognition is free value
 * and worth the minimal code.
 */

// FNV-1a 32-bit. Fast, dependency-free, stable across platforms.
// Good enough for visual hashing — we don't need cryptographic quality.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Returns a `linear-gradient(...)` CSS value tuned to look tasteful on
 * the app's dark canvas. Two hues ~40–140° apart, moderate saturation,
 * low lightness so the gradient reads as a surface tint rather than a
 * banner. Deterministic in `seed`.
 */
export function placeholderGradient(seed: string): string {
  const h = fnv1a(seed || "vrcsm");
  const hue1 = h % 360;
  const hue2 = (hue1 + 40 + ((h >>> 8) % 100)) % 360;
  const sat = 30 + ((h >>> 16) % 25);
  const l1 = 26 + ((h >>> 20) % 10);
  const l2 = 12 + ((h >>> 24) % 10);
  return `linear-gradient(135deg, hsl(${hue1} ${sat}% ${l1}%) 0%, hsl(${hue2} ${sat}% ${l2}%) 100%)`;
}

/**
 * Extract up to 2 upper-case initials from a display name, avatar id,
 * or raw path. Tries word-boundary split first, falls back to the first
 * two characters. Strips common id prefixes (`avtr_`, `wrld_`, `usr_`).
 */
export function initials(label: string | null | undefined, fallback = "?"): string {
  if (!label) return fallback;
  let s = label.trim();
  if (!s) return fallback;

  // Strip VRChat id prefixes so the avatar "avtr_abcd…" becomes "AB" not
  // "AV". Nothing stops the caller from passing the display name instead
  // of the id, but when they don't, we still want useful letters.
  const prefixMatch = s.match(/^(?:avtr|wrld|usr|grp|file)_([a-z0-9]+)/i);
  if (prefixMatch) s = prefixMatch[1];

  const words = s.split(/[\s_\-./\\]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return s.slice(0, 2).toUpperCase();
}
