/**
 * Pure join of screenshots ↔ world_visits.
 *
 * Visit rows mix VRChat DOT-local (`YYYY.MM.DD HH:MM:SS`) `joined_at` with
 * occasional offset-aware ISO `left_at`. Screenshot names use local civil
 * time (`VRChat_YYYY-MM-DD_HH-mm-ss*`). All parsers here are liberal and
 * never throw.
 */

export interface VisitWindow {
  id?: number;
  world_id?: string | null;
  instance_id?: string | null;
  world_name?: string | null;
  joined_at?: string | null;
  left_at?: string | null;
}

export interface ScreenshotLike {
  path?: string;
  filename?: string;
  created_at?: string | null;
}

export interface ScreenshotPlayer {
  displayName: string;
  userId: string;
  isLocal?: boolean;
}

export interface VisitShotGroup<S, V> {
  visit: V | null;
  shots: S[];
}

/** Unanchored: VRChat names embed the stamp after an optional `VRChat_` / resolution. */
const FILENAME_STAMP =
  /(\d{4})[-./](\d{2})[-./](\d{2})[ T_](\d{2})[-:](\d{2})[-:](\d{2})(?:\.(\d{1,3}))?/;

function toInt(raw: string | undefined, fallback = 0): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Interpret civil fields as *local* wall-clock (DOT logs + VRChat filenames). */
function civilLocal(
  year: string,
  month: string,
  day: string,
  hour: string,
  minute: string,
  sec: string,
  frac?: string,
): number | null {
  const y = toInt(year);
  const mo = toInt(month);
  const d = toInt(day);
  const h = toInt(hour);
  const mi = toInt(minute);
  const s = toInt(sec);
  const ms = frac ? toInt(frac.padEnd(3, "0").slice(0, 3)) : 0;
  if (y < 1970 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (h > 23 || mi > 59 || s > 60) return null;
  const t = new Date(y, mo - 1, d, h, mi, s, ms).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Parse a timestamp of unknown origin. DOT and naive ISO/filename stamps are
 * local; `Z` / `±HH:MM` ISO is offset-aware. Returns epoch ms or null.
 */
export function parseLiberalTimestamp(raw: unknown): number | null {
  try {
    if (raw == null) return null;
    if (typeof raw === "number") {
      if (!Number.isFinite(raw)) return null;
      // Heuristic: 10-digit unix seconds vs 13-digit ms.
      return raw > 0 && raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
    }
    if (raw instanceof Date) {
      const t = raw.getTime();
      return Number.isFinite(t) ? t : null;
    }
    if (typeof raw !== "string") return null;
    const s = raw.trim();
    if (!s) return null;

    const dateOnly = /^(\d{4})[-./](\d{2})[-./](\d{2})$/.exec(s);
    if (dateOnly) {
      return civilLocal(dateOnly[1], dateOnly[2], dateOnly[3], "0", "0", "0");
    }

    const dot = /^(\d{4})\.(\d{2})\.(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(s);
    if (dot) {
      return civilLocal(dot[1], dot[2], dot[3], dot[4], dot[5], dot[6], dot[7]);
    }

    const isoTz =
      /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i.exec(s);
    if (isoTz) {
      const t = Date.parse(s.replace(" ", "T"));
      return Number.isFinite(t) ? t : null;
    }

    const naiveIso =
      /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(s);
    if (naiveIso) {
      return civilLocal(
        naiveIso[1],
        naiveIso[2],
        naiveIso[3],
        naiveIso[4],
        naiveIso[5],
        naiveIso[6],
        naiveIso[7],
      );
    }

    const file = FILENAME_STAMP.exec(s);
    if (file) {
      return civilLocal(file[1], file[2], file[3], file[4], file[5], file[6], file[7]);
    }

    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

/**
 * Prefer the VRChat filename stamp; fall back to `created_at` (file mtime).
 */
export function parseScreenshotTime(shot: ScreenshotLike | null | undefined): number | null {
  try {
    if (!shot || typeof shot !== "object") return null;
    const name = shot.filename || shot.path || "";
    const base = name.replace(/\\/g, "/").split("/").pop() ?? name;
    const m = FILENAME_STAMP.exec(base);
    if (m) {
      const fromName = civilLocal(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
      if (fromName != null) return fromName;
    }
    return parseLiberalTimestamp(shot.created_at);
  } catch {
    return null;
  }
}

/**
 * Shot matches a visit when `joined_at <= shot <= (left_at or now)`.
 * Overlapping visits: latest `joined_at`, then shortest span, then lowest `id`.
 */
export function matchVisit<T extends VisitWindow>(
  shotTimeMs: number,
  visits: readonly T[] | null | undefined,
  nowMs: number = Date.now(),
): T | null {
  try {
    if (!Number.isFinite(shotTimeMs) || !Array.isArray(visits) || visits.length === 0) {
      return null;
    }
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    let best: T | null = null;
    let bestJoined = Number.NEGATIVE_INFINITY;
    let bestSpan = Number.POSITIVE_INFINITY;
    let bestId = Number.POSITIVE_INFINITY;

    for (const visit of visits) {
      if (!visit || typeof visit !== "object") continue;
      const joined = parseLiberalTimestamp(visit.joined_at);
      if (joined == null) continue;
      const leftParsed = parseLiberalTimestamp(visit.left_at);
      const open = visit.left_at == null || String(visit.left_at).trim() === "";
      const left = open || leftParsed == null ? now : leftParsed;
      if (left < joined) continue;
      if (shotTimeMs < joined || shotTimeMs > left) continue;

      const span = left - joined;
      const id = typeof visit.id === "number" && Number.isFinite(visit.id)
        ? visit.id
        : Number.POSITIVE_INFINITY;
      const better =
        joined > bestJoined ||
        (joined === bestJoined && span < bestSpan) ||
        (joined === bestJoined && span === bestSpan && id < bestId);
      if (better) {
        best = visit;
        bestJoined = joined;
        bestSpan = span;
        bestId = id;
      }
    }
    return best;
  } catch {
    return null;
  }
}

function visitKey(visit: VisitWindow): string {
  if (typeof visit.id === "number" && Number.isFinite(visit.id)) return `id:${visit.id}`;
  return `j:${visit.joined_at ?? ""}|w:${visit.world_id ?? ""}|i:${visit.instance_id ?? ""}`;
}

/**
 * Group shots by matched visit (recent join first). Unmatched shots land in a
 * trailing `{ visit: null }` bucket when any exist.
 */
export function groupShotsByVisit<S extends ScreenshotLike, V extends VisitWindow>(
  shots: readonly S[] | null | undefined,
  visits: readonly V[] | null | undefined,
  nowMs: number = Date.now(),
): VisitShotGroup<S, V>[] {
  try {
    const list = Array.isArray(shots) ? shots : [];
    const buckets = new Map<string, VisitShotGroup<S, V>>();
    const order: string[] = [];
    const unmatched: S[] = [];
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();

    for (const shot of list) {
      const t = parseScreenshotTime(shot);
      const visit = t == null ? null : matchVisit(t, visits, now);
      if (!visit) {
        unmatched.push(shot);
        continue;
      }
      const key = visitKey(visit);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { visit, shots: [] };
        buckets.set(key, bucket);
        order.push(key);
      }
      bucket.shots.push(shot);
    }

    const groups = order.map((key) => buckets.get(key)!);
    groups.sort((a, b) => {
      const ja = parseLiberalTimestamp(a.visit?.joined_at) ?? 0;
      const jb = parseLiberalTimestamp(b.visit?.joined_at) ?? 0;
      if (jb !== ja) return jb - ja;
      const ia = typeof a.visit?.id === "number" ? a.visit.id : 0;
      const ib = typeof b.visit?.id === "number" ? b.visit.id : 0;
      return ib - ia;
    });
    if (unmatched.length > 0) groups.push({ visit: null, shots: unmatched });
    return groups;
  } catch {
    return [];
  }
}

/**
 * PNG tEXt `vrcsm:players` is a JSON array string of
 * `{ displayName, userId, isLocal }` (see ScreenshotWatcher inject).
 */
export function parseScreenshotPlayers(
  metadata: Record<string, unknown> | null | undefined,
): ScreenshotPlayer[] {
  try {
    if (!metadata || typeof metadata !== "object") return [];
    const raw =
      metadata["vrcsm:players"] ??
      metadata["vrcsm:Players"] ??
      metadata.players;
    if (raw == null || raw === "") return [];
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    const out: ScreenshotPlayer[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const userId = String(rec.userId ?? rec.user_id ?? rec.id ?? "").trim();
      const displayName = String(
        rec.displayName ?? rec.display_name ?? rec.name ?? userId,
      ).trim();
      if (!userId && !displayName) continue;
      out.push({
        displayName: displayName || userId,
        userId,
        isLocal: Boolean(rec.isLocal ?? rec.is_local),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function metadataHasPlayer(
  metadata: Record<string, unknown> | null | undefined,
  userId: string | null | undefined,
): boolean {
  try {
    const want = (userId ?? "").trim();
    if (!want) return false;
    const players = parseScreenshotPlayers(metadata);
    if (players.some((p) => p.userId === want)) return true;
    const raw = metadata?.["vrcsm:players"];
    return typeof raw === "string" && raw.includes(want);
  } catch {
    return false;
  }
}
