/**
 * Synced-lyrics support for the now-playing OSC module. Resolves time-stamped
 * lyrics for a track through a provider chain (LRCLIB exact → LRCLIB search →
 * NetEase), parses LRC, optionally merges a timestamp-aligned translation, and
 * caches once per normalized track. All providers are free / no-auth.
 *
 * Kept free of React and of the {music.*} render path: `osc-studio.ts` stays
 * pure/sync and receives the already-resolved line(s) as `musicLyricLine` /
 * `musicLyricTranslated`. The fetch/async lives here and in `useNowPlaying`.
 */

export interface LyricLine {
  timeMs: number;
  text: string;
  /**
   * Optional translated line (e.g. NetEase `tlyric`), aligned to `text` by the
   * nearest timestamp. Undefined/empty when no translation is available.
   */
  trText?: string;
}

export type LyricsSource = "lrclib" | "netease" | "none";

export interface LyricsResult {
  synced: LyricLine[];
  found: boolean;
  instrumental: boolean;
  source: LyricsSource;
}

const LRCLIB_BASE = "https://lrclib.net/api";
const NETEASE_BASE = "https://music.163.com/api";

// Candidate ranking: duration must land within this window to count as a match.
const DURATION_WINDOW_MS = 3000;
// A translation line is aligned to a main line only within this timestamp delta.
const TR_TOLERANCE_MS = 1000;
// Minimum combined similarity a fuzzy-search candidate must clear to be accepted.
const MATCH_THRESHOLD = 0.5;

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
 * Return the last line whose `timeMs <= positionMs`, or null before the first
 * timestamp / when there are no lines. Assumes `lines` is time-sorted (as
 * returned by `parseLrc`). Pure. Shared by the text/translation accessors.
 */
export function currentLyricAt(lines: LyricLine[], positionMs: number): LyricLine | null {
  if (!lines.length) return null;
  const pos = Number.isFinite(positionMs) ? positionMs : 0;
  let result: LyricLine | null = null;
  for (const line of lines) {
    if (line.timeMs <= pos) result = line;
    else break;
  }
  return result;
}

/**
 * Return the text of the last line whose `timeMs <= positionMs`. Empty string
 * before the first timestamp or when there are no lines. Pure.
 */
export function currentLyricLine(lines: LyricLine[], positionMs: number): string {
  return currentLyricAt(lines, positionMs)?.text ?? "";
}

/**
 * Return the translated text (`trText`) of the current line, or "" when there
 * is no current line or it carries no translation. Pure.
 */
export function currentLyricTrans(lines: LyricLine[], positionMs: number): string {
  return currentLyricAt(lines, positionMs)?.trText ?? "";
}

/**
 * Align a translation track onto the main lines by nearest timestamp. For each
 * main line, finds the translation line whose `timeMs` is closest within
 * `TR_TOLERANCE_MS` and copies its text into `trText`. Both inputs are assumed
 * time-sorted. Returns new line objects (does not mutate `mainLines`). Pure.
 */
export function mergeTranslation(mainLines: LyricLine[], trLines: LyricLine[]): LyricLine[] {
  if (!mainLines.length || !trLines.length) return mainLines;
  return mainLines.map((line) => {
    let best: LyricLine | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const tr of trLines) {
      const delta = Math.abs(tr.timeMs - line.timeMs);
      if (delta < bestDelta) {
        best = tr;
        bestDelta = delta;
      } else if (tr.timeMs > line.timeMs) {
        // trLines is sorted; once past the target and diverging, stop.
        break;
      }
    }
    if (best && bestDelta <= TR_TOLERANCE_MS && best.text) {
      return { ...line, trText: best.text };
    }
    return line;
  });
}

export interface NormalizedQuery {
  title: string;
  artist: string;
}

// Parenthetical/bracketed tag groups: (2006) 【官方】「」 [Official MV] etc.
const BRACKET_RE = /[([{【「『（][^)\]}】」』）]*[)\]}】」』）]/g;
// Trailing "feat./ft." credit and everything after it. Requires leading
// whitespace so it never eats the "ft" inside words like "Daft".
const FEAT_RE = /\s+(?:feat|ft|featuring)\.?\s.*$/i;
// Noise words commonly appended to browser/uploader titles.
const NOISE_RE =
  /\b(?:official(?:\s+(?:video|audio|music\s+video|lyric\s+video))?|mv|m\/v|lyrics?|lyric\s+video|ost|cover|audio|visualizer|hd|hq|4k|8k|remaster(?:ed)?|explicit|full\s+version)\b/gi;
const CJK_NOISE_RE = /(高清|官方(?:版|MV)?|无损|现场版|完整版|超清)/g;
// Uploader-ish artist strings we should not trust as the real artist.
const UPLOADER_RE = /(vevo|topic|official|channel|music|records?|entertainment)/i;

function stripNoise(s: string): string {
  return s
    .replace(BRACKET_RE, " ")
    .replace(FEAT_RE, " ")
    .replace(NOISE_RE, " ")
    .replace(CJK_NOISE_RE, " ")
    .replace(/[-–—_|~•·]+\s*$/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Clean up messy GSMTC/browser titles into a searchable {title, artist}.
 * Strips parenthetical years/tags, "feat./ft.", and noise words (Official, MV,
 * Lyrics, OST, Cover, HD, 4K, 高清, 官方...). When the title contains " - " and
 * the artist is empty or looks like an uploader/channel, splits the title into
 * "artist - title". Pure.
 */
export function normalizeQuery(title: string, artist: string): NormalizedQuery {
  let t = (title ?? "").trim();
  let a = (artist ?? "").trim();

  const artistIsUploader = !a || UPLOADER_RE.test(a);
  // "Artist - Title" packed into a single title field (common for browser tabs).
  if (artistIsUploader && / - /.test(t)) {
    const idx = t.indexOf(" - ");
    const left = t.slice(0, idx).trim();
    const right = t.slice(idx + 3).trim();
    if (left && right) {
      a = left;
      t = right;
    }
  }

  t = stripNoise(t);
  a = stripNoise(a);
  return { title: t, artist: a };
}

/** Lowercase, strip punctuation, collapse whitespace. Keeps CJK code points. */
function normalizeForCompare(s: string): string {
  return (s ?? "")
    .toLowerCase()
    // eslint-disable-next-line no-control-regex
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  const n = normalizeForCompare(s);
  return n ? n.split(" ").filter(Boolean) : [];
}

/**
 * Similarity of two strings in [0,1]. Blends substring containment with token
 * (word) overlap so both "Song" vs "Song (Remaster)" and reordered words score
 * high. Empty query strings score neutral-low. Pure.
 */
function similarity(query: string, candidate: string): number {
  const q = normalizeForCompare(query);
  const c = normalizeForCompare(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  let sub = 0;
  if (c.includes(q) || q.includes(c)) sub = 0.8;
  const qTokens = new Set(tokenize(q));
  const cTokens = new Set(tokenize(c));
  if (qTokens.size === 0 || cTokens.size === 0) return sub;
  let hit = 0;
  for (const tok of qTokens) if (cTokens.has(tok)) hit++;
  const overlap = hit / Math.max(qTokens.size, cTokens.size);
  return Math.max(sub, overlap);
}

/**
 * Score a candidate against the normalized query. Combines title similarity
 * (dominant), artist similarity, and duration proximity. Returns a score in
 * roughly [0,1]; `durMatch` flags whether duration is known and within window.
 */
function scoreCandidate(
  q: NormalizedQuery,
  durationMs: number,
  cand: { title: string; artist: string; durationMs?: number },
): { score: number; durMatch: boolean } {
  const titleSim = similarity(q.title, cand.title);
  const artistSim = q.artist ? similarity(q.artist, cand.artist) : 0.5;
  let durMatch = false;
  let durScore = 0.5;
  if (durationMs > 0 && cand.durationMs && cand.durationMs > 0) {
    const delta = Math.abs(cand.durationMs - durationMs);
    durMatch = delta <= DURATION_WINDOW_MS;
    durScore = durMatch ? 1 - delta / DURATION_WINDOW_MS : 0;
  }
  const score = titleSim * 0.55 + artistSim * 0.25 + durScore * 0.2;
  return { score, durMatch };
}

// Fetch once per song, keyed by the normalized identity + rounded duration so a
// re-detected track reuses the resolved lyrics across the 2s poll.
const lyricsCache = new Map<string, LyricsResult>();

function cacheKey(q: NormalizedQuery, durSec: number): string {
  return `${normalizeForCompare(q.title)}|${normalizeForCompare(q.artist)}|${durSec}`;
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", ...headers } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

interface LrclibRecord {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
  artistName?: string;
  trackName?: string;
  duration?: number; // seconds
}

/** Convert an LRCLIB record into a LyricsResult, or null if unusable. */
function lrclibToResult(record: LrclibRecord | null): LyricsResult | null {
  if (!record || typeof record !== "object") return null;
  if (record.instrumental === true) {
    return { synced: [], found: true, instrumental: true, source: "lrclib" };
  }
  if (typeof record.syncedLyrics === "string" && record.syncedLyrics.trim()) {
    const synced = parseLrc(record.syncedLyrics);
    if (synced.length) return { synced, found: true, instrumental: false, source: "lrclib" };
  }
  return null;
}

/** LRCLIB provider: exact /api/get, then fuzzy /api/search with scoring. */
async function fromLrclib(
  q: NormalizedQuery,
  album: string,
  durationMs: number,
  durSec: number,
): Promise<LyricsResult | null> {
  // 1) Exact match via /api/get.
  const getParams = new URLSearchParams({ track_name: q.title, artist_name: q.artist });
  if (album) getParams.set("album_name", album);
  if (durSec > 0) getParams.set("duration", String(durSec));
  const exact = (await fetchJson(`${LRCLIB_BASE}/get?${getParams.toString()}`)) as LrclibRecord | null;
  const fromExact = lrclibToResult(exact);
  if (fromExact) return fromExact;

  // 2) Fuzzy /api/search, ranked by title+artist similarity and duration.
  const term = [q.title, q.artist].filter(Boolean).join(" ").trim();
  if (!term) return null;
  const candidates = (await fetchJson(
    `${LRCLIB_BASE}/search?${new URLSearchParams({ q: term }).toString()}`,
  )) as LrclibRecord[] | null;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  let best: LrclibRecord | null = null;
  let bestScore = -1;
  for (const cand of candidates) {
    if (!cand || typeof cand.syncedLyrics !== "string" || !cand.syncedLyrics.trim()) continue;
    const { score } = scoreCandidate(q, durationMs, {
      title: cand.trackName ?? "",
      artist: cand.artistName ?? "",
      durationMs: typeof cand.duration === "number" ? cand.duration * 1000 : undefined,
    });
    if (score > bestScore) {
      best = cand;
      bestScore = score;
    }
  }
  if (best && bestScore >= MATCH_THRESHOLD) return lrclibToResult(best);
  return null;
}

interface NeteaseSong {
  id?: number;
  name?: string;
  artists?: Array<{ name?: string }>;
  duration?: number; // ms
}

/**
 * NetEase provider: search then fetch lyric + translation. Finds Chinese songs
 * LRCLIB misses. Sends a Referer header (browsers may strip it — see fetch
 * note); if CORS-blocked at runtime the fetch rejects and we return null so the
 * chain falls through gracefully.
 */
async function fromNetease(
  q: NormalizedQuery,
  durationMs: number,
): Promise<LyricsResult | null> {
  const headers = { Referer: "https://music.163.com" };
  const term = [q.title, q.artist].filter(Boolean).join(" ").trim();
  if (!term) return null;
  const searchUrl = `${NETEASE_BASE}/search/get?${new URLSearchParams({
    s: term,
    type: "1",
    limit: "5",
  }).toString()}`;
  const search = (await fetchJson(searchUrl, headers)) as
    | { result?: { songs?: NeteaseSong[] } }
    | null;
  const songs = search?.result?.songs;
  if (!Array.isArray(songs) || songs.length === 0) return null;

  let best: NeteaseSong | null = null;
  let bestScore = -1;
  for (const song of songs) {
    if (!song || typeof song.id !== "number") continue;
    const { score } = scoreCandidate(q, durationMs, {
      title: song.name ?? "",
      artist: (song.artists ?? []).map((ar) => ar?.name ?? "").filter(Boolean).join(" "),
      durationMs: typeof song.duration === "number" ? song.duration : undefined,
    });
    if (score > bestScore) {
      best = song;
      bestScore = score;
    }
  }
  if (!best || typeof best.id !== "number" || bestScore < MATCH_THRESHOLD) return null;

  const lyricUrl = `${NETEASE_BASE}/song/lyric?${new URLSearchParams({
    id: String(best.id),
    lv: "1",
    kv: "1",
    tv: "-1",
  }).toString()}`;
  const lyric = (await fetchJson(lyricUrl, headers)) as
    | { lrc?: { lyric?: string }; tlyric?: { lyric?: string } }
    | null;
  const mainRaw = lyric?.lrc?.lyric;
  if (typeof mainRaw !== "string" || !mainRaw.trim()) return null;
  const main = parseLrc(mainRaw);
  if (!main.length) return null;
  const trRaw = lyric?.tlyric?.lyric;
  const tr = typeof trRaw === "string" && trRaw.trim() ? parseLrc(trRaw) : [];
  const merged = tr.length ? mergeTranslation(main, tr) : main;
  return { synced: merged, found: true, instrumental: false, source: "netease" };
}

const MISS: LyricsResult = { synced: [], found: false, instrumental: false, source: "none" };

/**
 * Resolve synced lyrics for a track through a provider chain (first accepted
 * synced result wins): LRCLIB exact → LRCLIB search → NetEase (with Chinese
 * translation merge). Never throws — returns `{ found:false, source:'none' }`
 * on any error or total miss. Cached in-memory per normalized track key.
 */
export async function fetchLyrics(
  track: string,
  artist: string,
  album: string,
  durationMs: number,
): Promise<LyricsResult> {
  const durMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  const durSec = durMs > 0 ? Math.round(durMs / 1000) : 0;
  const q = normalizeQuery(track, artist);
  const key = cacheKey(q, durSec);
  const cached = lyricsCache.get(key);
  if (cached) return cached;

  if (!q.title && !q.artist) {
    lyricsCache.set(key, MISS);
    return MISS;
  }

  let result = MISS;
  try {
    const fromLrc = await fromLrclib(q, album ?? "", durMs, durSec);
    if (fromLrc) {
      result = fromLrc;
    } else {
      // NetEase may be CORS-blocked in WebView2; fromNetease swallows the
      // rejection and returns null, leaving `result` as the MISS above.
      const fromNet = await fromNetease(q, durMs);
      if (fromNet) result = fromNet;
    }
  } catch {
    result = MISS;
  }
  lyricsCache.set(key, result);
  return result;
}
