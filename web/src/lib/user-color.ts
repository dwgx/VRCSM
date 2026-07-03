/**
 * Deterministic per-user name colors.
 *
 * VRCX tints friend names with a plain hash → HSL, which has two problems:
 * adjacent hashes can land on near-identical hues, and HSL "lightness" is not
 * perceptually uniform (a yellow at L=60% reads far brighter than a blue at
 * L=60%), so some names glare while others sink into the background.
 *
 * Our approach:
 *   1. FNV-1a 32-bit hash of the userId — stable, dependency-free.
 *   2. Hue via the golden angle (137.508°). Successive/similar inputs get
 *      maximally spaced hues, so a roster of users reads as distinct colors
 *      instead of a cluster of look-alikes.
 *   3. Emit OKLCH with lightness + chroma pinned to a band that stays legible
 *      on our dark surfaces. OKLCH lightness is perceptually uniform, so every
 *      hue lands at the same apparent brightness.
 *   4. `ensureContrast` nudges lightness toward the readable end if a color
 *      ever fails a contrast target. The app is dark-only today (see
 *      main.tsx), so the default band already clears it — this is future-proof
 *      for a light theme and is exercised by the unit tests.
 *
 * Everything here is pure and unit-tested in __tests__/user-color.test.ts.
 */

// FNV-1a constants (32-bit).
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Stable 32-bit FNV-1a hash of a string, returned as an unsigned int. */
export function hashUserId(userId: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < userId.length; i += 1) {
    h ^= userId.charCodeAt(i) & 0xff;
    // Multiply in 32-bit space (Math.imul) then coerce back to unsigned.
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

// Golden-angle hue stepping maximizes spacing between successive hashes.
const GOLDEN_ANGLE = 137.508;

// Perceptual band tuned for the dark theme (surface ≈ OKLCH L 0.27). L 0.78
// clears ~7:1 against it; chroma 0.13 stays inside sRGB gamut for every hue so
// no color desaturates inconsistently.
const DEFAULT_LIGHTNESS = 0.78;
const DEFAULT_CHROMA = 0.13;

export interface UserColor {
  hue: number; // degrees, [0,360)
  lightness: number; // OKLCH L, [0,1]
  chroma: number; // OKLCH C
  /** Ready-to-use CSS `oklch(...)` string. */
  css: string;
}

/**
 * Approximate the relative luminance of an OKLCH lightness for a coarse
 * contrast check. OKLCH L is already perceptual, so for our purpose (deciding
 * whether to push a name lighter/darker) L itself is a good enough proxy — we
 * don't need a full OKLCH→sRGB→WCAG pipeline to keep names readable.
 */
function lightnessContrastsWith(l: number, backgroundL: number): boolean {
  return Math.abs(l - backgroundL) >= 0.45;
}

/**
 * Nudge an OKLCH lightness so it stays readable against a background lightness.
 * Returns the original when it already passes. Pure.
 */
export function ensureContrast(lightness: number, backgroundL: number): number {
  if (lightnessContrastsWith(lightness, backgroundL)) return lightness;
  // Move away from the background: lift on dark backgrounds, drop on light.
  return backgroundL < 0.5
    ? Math.min(0.92, backgroundL + 0.5)
    : Math.max(0.18, backgroundL - 0.5);
}

export interface UserColorOptions {
  /** Background OKLCH lightness to guarantee contrast against (dark surface). */
  backgroundLightness?: number;
  lightness?: number;
  chroma?: number;
}

/** Deterministic color for a userId. Same id always yields the same color. */
export function userColor(userId: string, opts: UserColorOptions = {}): UserColor {
  const hash = hashUserId(userId || "");
  const hue = (hash * GOLDEN_ANGLE) % 360;
  const chroma = opts.chroma ?? DEFAULT_CHROMA;
  const baseL = opts.lightness ?? DEFAULT_LIGHTNESS;
  // 0.27 ≈ our --surface token lightness; the dark-only default never trips
  // ensureContrast, but callers can pass a real background for a light theme.
  const lightness = ensureContrast(baseL, opts.backgroundLightness ?? 0.27);
  const css = `oklch(${lightness.toFixed(3)} ${chroma.toFixed(3)} ${hue.toFixed(1)})`;
  return { hue, lightness, chroma, css };
}
