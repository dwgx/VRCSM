import { rejoinLocationFromVisit, buildVrchatLocationLaunchUrl } from "@/lib/shell-api";

/** Visit row from `db.worldVisits.list`. */
export interface WorldVisitRow {
  id: number;
  world_id?: string | null;
  instance_id?: string | null;
  access_type?: string | null;
  owner_id?: string | null;
  region?: string | null;
  joined_at?: string | null;
  left_at?: string | null;
  player_count?: number;
  player_event_count?: number;
  last_player_seen_at?: string | null;
}

export interface PickLastInstanceOpts {
  skipPublic: boolean;
  /** `null` or `<= 0` disables the age filter. */
  maxAgeMinutes: number | null;
  /** Injected clock for tests. */
  nowMs?: number;
}

/**
 * Only skip when the access type is clearly public. Empty / unknown / friends /
 * invite / group / hidden are kept.
 */
export function isPublicAccess(access_type: string): boolean {
  return access_type.trim().toLowerCase() === "public";
}

/** Parse ISO or VRChat DOT-local (`YYYY.MM.DD HH:MM:SS`) instants. */
export function parseVisitInstant(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const dot = /^(\d{4})\.(\d{2})\.(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (dot) {
    const iso = `${dot[1]}-${dot[2]}-${dot[3]}T${dot[4]}:${dot[5]}:${dot[6]}`;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : t;
  }

  const t = Date.parse(trimmed);
  return Number.isNaN(t) ? null : t;
}

export function visitLocation(visit: WorldVisitRow): string | null {
  return rejoinLocationFromVisit(visit.world_id, visit.instance_id);
}

export function pickLastInstance(
  visits: readonly WorldVisitRow[],
  opts: PickLastInstanceOpts,
): WorldVisitRow | null {
  const now = opts.nowMs ?? Date.now();
  const maxAgeMs =
    opts.maxAgeMinutes != null && opts.maxAgeMinutes > 0
      ? opts.maxAgeMinutes * 60_000
      : null;

  const ranked = visits.slice().sort((a, b) => {
    const ta = parseVisitInstant(a.joined_at) ?? 0;
    const tb = parseVisitInstant(b.joined_at) ?? 0;
    return tb - ta;
  });

  for (const visit of ranked) {
    if (!visitLocation(visit)) continue;
    if (opts.skipPublic && isPublicAccess(visit.access_type ?? "")) continue;
    if (maxAgeMs != null) {
      const joined = parseVisitInstant(visit.joined_at);
      if (joined == null) continue;
      if (now - joined > maxAgeMs) continue;
    }
    return visit;
  }
  return null;
}

/**
 * Official https launch URL parsed from a `wrld_*:instance` location tag.
 * Always returns the `worldId` / `instanceId` query shape, even if empty.
 */
export function httpsLaunchUrl(location: string): string {
  const trimmed = location.trim();
  let worldId = "";
  let instanceId = "";
  if (trimmed) {
    const colon = trimmed.indexOf(":");
    if (colon <= 0) {
      if (trimmed.startsWith("wrld_")) worldId = trimmed;
    } else {
      worldId = trimmed.slice(0, colon);
      instanceId = trimmed.slice(colon + 1);
    }
  }
  return `https://vrchat.com/home/launch?worldId=${encodeURIComponent(worldId)}&instanceId=${encodeURIComponent(instanceId)}`;
}

export function vrchatLaunchUrl(location: string): string {
  return buildVrchatLocationLaunchUrl(location);
}
