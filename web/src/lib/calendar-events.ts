export interface CalendarEventLike {
  id?: string;
  name?: string;
  title?: string;
  description?: unknown;
  startsAt?: string;
  starts_at?: string;
  endsAt?: string;
  ends_at?: string;
  worldId?: string;
  world_id?: string;
  region?: unknown;
  groupId?: string;
  group_id?: string;
  groupName?: string;
  group_name?: string;
  ownerId?: string;
  owner_id?: string;
  ownerDisplayName?: string;
  hostUserId?: string;
  host_user_id?: string;
  hostUserName?: string;
  host_user_name?: string;
  hostUserDisplayName?: string;
  attendingUserCount?: number;
  attending_user_count?: number;
  group?: { id?: string; name?: string } | null;
  owner?: { id?: string; displayName?: string } | null;
  isFeatured?: boolean;
  [key: string]: unknown;
}

export interface JamLike {
  id?: string;
  title?: string;
  name?: string;
  description?: unknown;
  state?: unknown;
  isActive?: boolean;
  closedAt?: string;
  startedAt?: string;
  [key: string]: unknown;
}

export function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

export function asDisplayString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export function getEventTitle(e: CalendarEventLike): string {
  return firstString(e.name, e.title) ?? "Untitled";
}

export function getStartsAt(e: CalendarEventLike): string | undefined {
  return firstString(e.startsAt, e.starts_at);
}

export function getEndsAt(e: CalendarEventLike): string | undefined {
  return firstString(e.endsAt, e.ends_at);
}

export function getWorldId(e: CalendarEventLike): string | undefined {
  return firstString(e.worldId, e.world_id);
}

export function getGroupId(e: CalendarEventLike): string | undefined {
  return firstString(
    e.groupId,
    e.group_id,
    e.ownerId,
    e.owner_id,
    e.group?.id,
    e.owner?.id,
  );
}

export function getGroupName(e: CalendarEventLike): string | undefined {
  return firstString(e.groupName, e.group_name, e.ownerDisplayName, e.group?.name, e.owner?.displayName);
}

export function getHostName(e: CalendarEventLike): string | undefined {
  return firstString(e.hostUserName, e.host_user_name, e.hostUserDisplayName);
}

export function getAttending(e: CalendarEventLike): number | undefined {
  if (typeof e.attendingUserCount === "number") return e.attendingUserCount;
  if (typeof e.attending_user_count === "number") return e.attending_user_count;
  return undefined;
}

export function getJamState(jam: JamLike): string | undefined {
  return asDisplayString(jam.state) ?? (jam.isActive ? "active" : undefined);
}

export function normalizeJams(raw: unknown): JamLike[] {
  if (Array.isArray(raw)) return raw as JamLike[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["content", "jams", "results", "submissions", "data"]) {
      const value = obj[key];
      if (Array.isArray(value)) return value as JamLike[];
    }
  }
  return [];
}

export function dedupeEvents(events: CalendarEventLike[]): CalendarEventLike[] {
  const seen = new Set<string>();
  const out: CalendarEventLike[] = [];
  for (const e of events) {
    const key = e.id ?? `${getEventTitle(e)}|${getStartsAt(e) ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
