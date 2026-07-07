/**
 * Synced-lyrics support for the now-playing OSC module. Fetches time-stamped
 * lyrics from LRCLIB (free, no auth) once per song, parses the LRC format, and
 * resolves the current line for a live playback position.
 *
 * Kept free of React and of the {music.*} render path: `osc-studio.ts` stays
 * pure/sync and receives the already-resolved line as `musicLyricLine`. The
 * fetch/async lives here and in `useNowPlaying`.
 */

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsResult {
  synced: LyricLine[];
  found: boolean;
  instrumental: boolean;
}

const LRCLIB_BASE = "https://lrclib.net/api";

// Matches "[mm:ss]", "[mm:ss.xx]" and "[mm:ss.xxx]" tags. A single line may
// carry multiple leading tags (e.g. repeated chorus lines share text).
const TIMESTAMP_RE = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/**
 * Parse an LRC lyrics string into time-sorted lines. Skips blank lines and
 * metadata-only tags (e.g. "[ti:...]", "[ar:...]", "[00:00.00]" with no text).
 * Lines carrying multiple timestamps expand to one entry per timestamp. Pure.
 */
export function parseLrc(lrc: string): LyricLine[] {
  if (!lrc) return [];
  const out: LyricLine[] = [];
  for (const rawLine of lrc.split(/\r?\n/)) {
    TIMESTAMP_RE.lastIndex = 0;
    const stamps: number[] = [];
    let match: RegExpExecArray | null;
    let lastEnd = 0;
    while ((match = TIMESTAMP_RE.exec(rawLine)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const fracRaw = match[3] ?? "";
      // Normalize hundredths/thousandths: "8" → 800ms is wrong, LRC fractions
      // are already right-padded (".08" = 80ms, ".080" = 80ms). Pad to 3 digits.
      const frac = fracRaw ? parseInt(fracRaw.padEnd(3, "0"), 10) : 0;
      const timeMs = minutes * 60_000 + seconds * 1_000 + frac;
      if (Number.isFinite(timeMs)) stamps.push(timeMs);
      lastEnd = match.index + match[0].length;
    }
    if (stamps.length === 0) continue; // no timestamp → metadata or plain text
    const text = rawLine.slice(lastEnd).trim();
    if (!text) continue; // timestamp with no lyric text → skip
    for (const timeMs of stamps) out.push({ timeMs, text });
  }
  out.sort((a, b) => a.timeMs - b.timeMs);
  return out;
}

/**
 * Return the text of the last line whose `timeMs <= positionMs`. Empty string
 * before the first timestamp or when there are no lines. Assumes `lines` is
 * time-sorted (as returned by `parseLrc`). Pure.
 */
export function currentLyricLine(lines: LyricLine[], positionMs: number): string {
  if (!lines.length) return "";
  const pos = Number.isFinite(positionMs) ? positionMs : 0;
  let result = "";
  for (const line of lines) {
    if (line.timeMs <= pos) result = line.text;
    else break;
  }
  return result;
}

// Fetch once per song, not per 2s poll. Keyed by the identity + rounded
// duration so a re-detected track reuses the resolved lyrics.
const lyricsCache = new Map<string, LyricsResult>();

function cacheKey(track: string, artist: string, album: string, durSec: number): string {
  return `${track}|${artist}|${album}|${durSec}`;
}

interface LrclibRecord {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
  artistName?: string;
  trackName?: string;
  duration?: number;
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Resolve synced lyrics for a track from LRCLIB. Tries the exact `/api/get`
 * match first (duration in whole seconds); on a miss falls back to `/api/search`
 * and picks the closest-duration candidate (±2s) with synced lyrics from a
 * matching artist. Never throws — returns `{ found: false }` on any network
 * error or miss. Instrumental tracks resolve to `{ found: true, synced: [],
 * instrumental: true }`. Results are cached in-memory per song.
 */
export async function fetchLyrics(
  track: string,
  artist: string,
  album: string,
  durationMs: number,
): Promise<LyricsResult> {
  const durSec = Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs / 1000) : 0;
  const key = cacheKey(track, artist, album, durSec);
  const cached = lyricsCache.get(key);
  if (cached) return cached;

  const miss: LyricsResult = { synced: [], found: false, instrumental: false };
  if (!track && !artist) {
    lyricsCache.set(key, miss);
    return miss;
  }

  let result = miss;
  try {
    result = await resolveLyrics(track, artist, album, durSec);
  } catch {
    result = miss;
  }
  lyricsCache.set(key, result);
  return result;
}

async function resolveLyrics(
  track: string,
  artist: string,
  album: string,
  durSec: number,
): Promise<LyricsResult> {
  // 1) Exact match via /api/get.
  const getParams = new URLSearchParams({ track_name: track, artist_name: artist });
  if (album) getParams.set("album_name", album);
  if (durSec > 0) getParams.set("duration", String(durSec));
  const exact = (await fetchJson(`${LRCLIB_BASE}/get?${getParams.toString()}`)) as LrclibRecord | null;
  const fromExact = recordToResult(exact);
  if (fromExact) return fromExact;

  // 2) Fallback: /api/search, pick closest duration (±2s) with synced lyrics.
  const q = [track, artist].filter(Boolean).join(" ").trim();
  if (!q) return { synced: [], found: false, instrumental: false };
  const searchParams = new URLSearchParams({ q });
  const candidates = (await fetchJson(`${LRCLIB_BASE}/search?${searchParams.toString()}`)) as
    | LrclibRecord[]
    | null;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { synced: [], found: false, instrumental: false };
  }

  const artistLower = artist.trim().toLowerCase();
  let best: LrclibRecord | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const cand of candidates) {
    if (!cand || typeof cand.syncedLyrics !== "string" || !cand.syncedLyrics.trim()) continue;
    if (artistLower && typeof cand.artistName === "string" && cand.artistName.trim()) {
      if (cand.artistName.trim().toLowerCase() !== artistLower) continue;
    }
    if (durSec > 0 && typeof cand.duration === "number") {
      const delta = Math.abs(cand.duration - durSec);
      if (delta > 2) continue;
      if (delta < bestDelta) {
        best = cand;
        bestDelta = delta;
      }
    } else if (!best) {
      best = cand;
      bestDelta = 0;
    }
  }
  const fromSearch = recordToResult(best);
  if (fromSearch) return fromSearch;
  return { synced: [], found: false, instrumental: false };
}

/** Convert an LRCLIB record into a LyricsResult, or null if unusable. */
function recordToResult(record: LrclibRecord | null): LyricsResult | null {
  if (!record || typeof record !== "object") return null;
  if (record.instrumental === true) {
    return { synced: [], found: true, instrumental: true };
  }
  if (typeof record.syncedLyrics === "string" && record.syncedLyrics.trim()) {
    const synced = parseLrc(record.syncedLyrics);
    if (synced.length) return { synced, found: true, instrumental: false };
  }
  return null;
}
