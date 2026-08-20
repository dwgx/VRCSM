import { parseLiberalTimestamp } from "./screenshot-visits";

/** Rank from the newest 500 `db.worldVisits.list` rows; no SQL GROUP BY. */
export const HOT_WORLDS_VISIT_LIMIT = 500;
export const HOT_WORLDS_CAP = 100;

const MS_PER_HOUR = 3_600_000;
/** Skip implausible dwell (mixed DOT/ISO `world_visits` timestamps, task P16). */
const MAX_VISIT_HOURS = 48;

export interface HotWorldVisitRow {
  world_id?: string | null;
  world_name?: string | null;
  joined_at?: string | null;
  left_at?: string | null;
}

/** `player_encounters` or `player_events` rows that carry world + user ids. */
export interface HotWorldEncounterRow {
  world_id?: string | null;
  user_id?: string | null;
  kind?: string | null;
}

export interface HotWorldRank {
  worldId: string;
  visits: number;
  lastVisit: string;
  hours?: number;
  worldName?: string;
  friends?: number;
}

export interface RankHotWorldsOptions {
  /** Distinct-friend counts keyed by world id. Missing keys stay omitted. */
  friendsByWorld?: Map<string, number> | Readonly<Record<string, number>>;
  cap?: number;
}

interface Acc {
  worldId: string;
  visits: number;
  lastVisit: string;
  lastVisitMs: number;
  hoursMs: number;
  worldName?: string;
}

function worldKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const id = raw.trim();
  return id.length > 0 ? id : null;
}

function displayName(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined;
  const name = raw.trim();
  return name.length > 0 ? name : undefined;
}

function friendsLookup(
  source: RankHotWorldsOptions["friendsByWorld"],
  worldId: string,
): number | undefined {
  if (!source) return undefined;
  if (source instanceof Map) {
    return source.has(worldId) ? source.get(worldId) : undefined;
  }
  const record = source;
  return Object.prototype.hasOwnProperty.call(record, worldId) ? record[worldId] : undefined;
}

function isJoinKind(kind: string | null | undefined): boolean {
  if (kind == null) return true;
  const k = kind.trim().toLowerCase();
  if (!k) return true;
  return k === "joined" || k === "join";
}

function dwellMs(joinedAt: string | null | undefined, leftAt: string | null | undefined): number {
  if (!joinedAt || !leftAt) return 0;
  const start = parseLiberalTimestamp(joinedAt);
  const end = parseLiberalTimestamp(leftAt);
  if (start == null || end == null) return 0;
  const delta = end - start;
  if (!(delta > 0)) return 0;
  if (delta > MAX_VISIT_HOURS * MS_PER_HOUR) return 0;
  return delta;
}

/** Distinct `user_id` per world. Skips empty ids, self, and non-join kinds when set. */
export function countDistinctFriendsByWorld(
  rows: readonly HotWorldEncounterRow[],
  selfUserId?: string | null,
): Map<string, number> {
  const self = selfUserId?.trim() || "";
  const seen = new Map<string, Set<string>>();
  for (const row of rows) {
    const worldId = worldKey(row.world_id);
    const userId = worldKey(row.user_id);
    if (!worldId || !userId) continue;
    if (self && userId === self) continue;
    if (!isJoinKind(row.kind)) continue;
    let users = seen.get(worldId);
    if (!users) {
      users = new Set();
      seen.set(worldId, users);
    }
    users.add(userId);
  }
  const out = new Map<string, number>();
  for (const [worldId, users] of seen) {
    out.set(worldId, users.size);
  }
  return out;
}

/**
 * Rank worlds by visit count desc, then lastVisit desc.
 * Empty `world_id` is ignored. Output is capped (default 100).
 */
export function rankHotWorlds(
  visits: readonly HotWorldVisitRow[],
  options: RankHotWorldsOptions = {},
): HotWorldRank[] {
  const cap = options.cap ?? HOT_WORLDS_CAP;
  const byWorld = new Map<string, Acc>();

  for (const visit of visits) {
    const worldId = worldKey(visit.world_id);
    if (!worldId) continue;

    const joinedMs = parseLiberalTimestamp(visit.joined_at) ?? 0;
    const name = displayName(visit.world_name);
    let acc = byWorld.get(worldId);
    if (!acc) {
      acc = {
        worldId,
        visits: 0,
        lastVisit: visit.joined_at?.trim() || "",
        lastVisitMs: joinedMs,
        hoursMs: 0,
        worldName: name,
      };
      byWorld.set(worldId, acc);
    }

    acc.visits += 1;
    acc.hoursMs += dwellMs(visit.joined_at, visit.left_at);
    if (joinedMs > acc.lastVisitMs) {
      acc.lastVisitMs = joinedMs;
      acc.lastVisit = visit.joined_at?.trim() || acc.lastVisit;
      if (name) acc.worldName = name;
    } else if (!acc.worldName && name) {
      acc.worldName = name;
    } else if (!acc.lastVisit && visit.joined_at?.trim()) {
      acc.lastVisit = visit.joined_at.trim();
    }
  }

  const ranked = [...byWorld.values()].sort((a, b) => {
    if (b.visits !== a.visits) return b.visits - a.visits;
    if (b.lastVisitMs !== a.lastVisitMs) return b.lastVisitMs - a.lastVisitMs;
    return a.worldId.localeCompare(b.worldId);
  });

  const limit = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : HOT_WORLDS_CAP;
  return ranked.slice(0, limit).map((acc) => {
    const row: HotWorldRank = {
      worldId: acc.worldId,
      visits: acc.visits,
      lastVisit: acc.lastVisit,
    };
    if (acc.hoursMs > 0) row.hours = acc.hoursMs / MS_PER_HOUR;
    if (acc.worldName) row.worldName = acc.worldName;
    const friends = friendsLookup(options.friendsByWorld, acc.worldId);
    if (friends != null) row.friends = friends;
    return row;
  });
}
