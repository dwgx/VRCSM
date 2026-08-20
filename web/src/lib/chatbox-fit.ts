/**
 * VRChat chatbox length rail. The in-game box is 144 characters; a naive
 * `.slice(0, 144)` cuts mid-emoji / mid-ZWJ and keeps low-value tail
 * segments (" | extra"). Drop lowest-priority segments (split on ` | `
 * or ` / `, right-first) then grapheme-safe trim.
 */

export const CHATBOX_LIMIT = 144;

const SEGMENT_SEP_RE = / \|| \/ /g;

function graphemesOf(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const out: string[] = [];
    for (const part of seg.segment(text)) out.push(part.segment);
    return out;
  }
  // Code-point fallback (keeps surrogate pairs; does not join ZWJ sequences).
  return Array.from(text);
}

export function graphemeLength(text: string): number {
  return graphemesOf(text).length;
}

export function graphemeSlice(text: string, max: number): string {
  if (!(Number.isFinite(max) && max > 0)) return "";
  const limit = Math.floor(max);
  const parts = graphemesOf(text);
  if (parts.length <= limit) return text;
  return parts.slice(0, limit).join("");
}

interface SplitSegments {
  segs: string[];
  seps: string[];
}

function splitPriority(text: string): SplitSegments {
  const segs: string[] = [];
  const seps: string[] = [];
  SEGMENT_SEP_RE.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = SEGMENT_SEP_RE.exec(text)) !== null) {
    segs.push(text.slice(last, match.index));
    seps.push(match[0]);
    last = match.index + match[0].length;
  }
  segs.push(text.slice(last));
  return { segs, seps };
}

function joinPriority(parts: SplitSegments, count: number): string {
  if (count <= 0) return "";
  let out = parts.segs[0] ?? "";
  const n = Math.min(count, parts.segs.length);
  for (let i = 0; i < n - 1; i++) {
    out += (parts.seps[i] ?? " | ") + (parts.segs[i + 1] ?? "");
  }
  return out;
}

/**
 * Fit `text` into `limit` graphemes (default 144). Drops trailing
 * ` | `- or ` / `-separated segments first, then trims by grapheme.
 * Returns the original string when it already fits.
 */
export function fitChatbox(text: string, limit = CHATBOX_LIMIT): string {
  if (!text) return "";
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : CHATBOX_LIMIT;
  if (graphemeLength(text) <= max) return text;

  const parts = splitPriority(text);
  let count = parts.segs.length;
  while (count > 1 && graphemeLength(joinPriority(parts, count)) > max) {
    count -= 1;
  }
  const joined = joinPriority(parts, count);
  if (graphemeLength(joined) <= max) return joined;
  return graphemeSlice(joined, max);
}
