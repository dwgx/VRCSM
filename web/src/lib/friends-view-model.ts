/**
 * Pure Friends list view-model. Grouping, smart-view filters, and the
 * flattened virtual-row list live here so Friends.tsx stays composition
 * (query, pipeline, inspector) and grouping stays unit-tested.
 *
 * Location sections are keyed by the full VRChat location tag
 * (`wrld_…:instance~type~region…`), not worldId. Offline / private /
 * traveling never mix into a world section.
 */
import type { Friend } from "./types";
import {
  parseLocation,
  STATUS_BUCKET_ORDER,
  statusBucket,
  type InstanceType,
  type StatusBucket,
} from "./vrcFriends";

export type FriendSmartView =
  | "all"
  | "favorites"
  | "sameInstance"
  | "joinable"
  | "online"
  | "offline";

export type FriendsListLayout = "locations" | "status";

export type LocationGroupKind =
  | "world"
  | "private"
  | "traveling"
  | "offline"
  | "unknown";

export type FriendsVirtualRow =
  | {
      kind: "header";
      key: string;
      sectionId: string;
      count: number;
      groupKind: LocationGroupKind | "status";
      worldId?: string;
      location?: string;
      instanceType?: InstanceType;
      region?: string;
      pinned?: "self";
      bucket?: StatusBucket;
    }
  | {
      kind: "friend";
      key: string;
      friend: Friend;
      locationKey: string;
    };

/** Section id for one friend. World instances keep the exact location string. */
export function friendLocationSectionId(
  location: string | null | undefined,
): string {
  if (!location || location === "offline") return "offline";
  if (location === "private") return "private";
  if (location === "traveling") return "traveling";
  const loc = parseLocation(location);
  if (loc.kind === "world") return location;
  return `unknown:${location}`;
}

/**
 * 2+ friends sharing a full location tag. Used by the existing
 * `sameInstance` chip (crowded instance, not "same as me").
 */
export function buildLocationGroups(
  friends: readonly Friend[],
): Record<string, Friend[]> {
  const groups: Record<string, Friend[]> = {};
  for (const f of friends) {
    if (!f.location || f.location === "offline" || f.location === "private") {
      continue;
    }
    const loc = parseLocation(f.location);
    if (loc.kind === "world") {
      if (!groups[f.location]) groups[f.location] = [];
      groups[f.location].push(f);
    }
  }
  return groups;
}

export function countSmartViews(
  friends: readonly Friend[],
  favoriteUserIds: ReadonlySet<string>,
  locationGroups: Record<string, Friend[]>,
): Record<FriendSmartView, number> {
  let sameInstance = 0;
  let joinable = 0;
  let online = 0;
  let offline = 0;
  for (const f of friends) {
    const loc = parseLocation(f.location);
    if (
      f.location &&
      loc.kind === "world" &&
      (locationGroups[f.location]?.length ?? 0) > 1
    ) {
      sameInstance += 1;
    }
    if (loc.kind === "world" && loc.worldId) joinable += 1;
    if (loc.kind === "offline" || f.status === "offline") offline += 1;
    else online += 1;
  }
  return {
    all: friends.length,
    favorites: friends.filter((f) => favoriteUserIds.has(f.id)).length,
    sameInstance,
    joinable,
    online,
    offline,
  };
}

export function filterFriendsBySmartView(
  friends: readonly Friend[],
  smartView: FriendSmartView,
  favoriteUserIds: ReadonlySet<string>,
  locationGroups: Record<string, Friend[]>,
): Friend[] {
  return friends.filter((f) => {
    const loc = parseLocation(f.location);
    switch (smartView) {
      case "favorites":
        return favoriteUserIds.has(f.id);
      case "sameInstance":
        return (
          !!f.location &&
          loc.kind === "world" &&
          (locationGroups[f.location]?.length ?? 0) > 1
        );
      case "joinable":
        return loc.kind === "world" && !!loc.worldId;
      case "online":
        return loc.kind !== "offline" && f.status !== "offline";
      case "offline":
        return loc.kind === "offline" || f.status === "offline";
      default:
        return true;
    }
  });
}

export function filterFriendsByQuery(
  friends: readonly Friend[],
  query: string,
  opts: {
    noteSearchIndex: ReadonlyMap<string, string>;
    trustLabel: (friend: Friend) => string;
  },
): Friend[] {
  const q = query.trim().toLowerCase();
  if (!q) return friends.slice();
  return friends.filter((f) => {
    if (f.displayName.toLowerCase().includes(q)) return true;
    if (f.statusDescription?.toLowerCase().includes(q)) return true;
    if (f.bio?.toLowerCase().includes(q)) return true;
    if (f.id.toLowerCase().includes(q)) return true;
    if (opts.trustLabel(f).toLowerCase().includes(q)) return true;
    if (f.location && f.location !== "offline" && f.location !== "private") {
      const loc = parseLocation(f.location);
      if (loc.worldId?.toLowerCase().includes(q)) return true;
      if (f.location.toLowerCase().includes(q)) return true;
    }
    if (f.currentAvatarName?.toLowerCase().includes(q)) return true;
    const note = opts.noteSearchIndex.get(f.id);
    if (note?.includes(q)) return true;
    return false;
  });
}

function sortByDisplayName(friends: Friend[]): Friend[] {
  return [...friends].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function groupKindForSection(
  sectionId: string,
  sample: Friend | undefined,
): LocationGroupKind {
  if (sectionId === "private") return "private";
  if (sectionId === "traveling") return "traveling";
  if (sectionId === "offline") return "offline";
  const loc = parseLocation(sample?.location ?? null);
  if (loc.kind === "world") return "world";
  return "unknown";
}

/**
 * Instance-first rows. Same-as-me (exact self location tag) is first even
 * when the group has one friend. Private / traveling / offline are their
 * own sections. `collapsed` hides friend rows but keeps the header.
 */
export function buildLocationVirtualRows(args: {
  friends: readonly Friend[];
  selfLocation: string | null;
  collapsed: ReadonlySet<string>;
}): FriendsVirtualRow[] {
  const { friends, selfLocation, collapsed } = args;
  const buckets = new Map<string, Friend[]>();
  for (const f of friends) {
    const id = friendLocationSectionId(f.location);
    const list = buckets.get(id);
    if (list) list.push(f);
    else buckets.set(id, [f]);
  }

  const selfIsWorld =
    !!selfLocation && parseLocation(selfLocation).kind === "world";
  const pinnedKey =
    selfIsWorld && selfLocation && buckets.has(selfLocation)
      ? selfLocation
      : null;

  const worldKeys: string[] = [];
  const unknownKeys: string[] = [];
  for (const key of buckets.keys()) {
    if (key === "private" || key === "traveling" || key === "offline") continue;
    const kind = groupKindForSection(key, buckets.get(key)?.[0]);
    if (kind === "world") worldKeys.push(key);
    else unknownKeys.push(key);
  }

  worldKeys.sort((a, b) => {
    if (a === b) return 0;
    if (a === pinnedKey) return -1;
    if (b === pinnedKey) return 1;
    const ca = buckets.get(a)?.length ?? 0;
    const cb = buckets.get(b)?.length ?? 0;
    if (cb !== ca) return cb - ca;
    return a.localeCompare(b);
  });
  unknownKeys.sort();

  const order: string[] = [...worldKeys];
  if (buckets.has("private")) order.push("private");
  if (buckets.has("traveling")) order.push("traveling");
  order.push(...unknownKeys);
  if (buckets.has("offline")) order.push("offline");

  const rows: FriendsVirtualRow[] = [];
  for (const sectionId of order) {
    const members = sortByDisplayName(buckets.get(sectionId) ?? []);
    if (members.length === 0) continue;
    const sampleLoc = parseLocation(members[0]?.location ?? null);
    const groupKind = groupKindForSection(sectionId, members[0]);
    rows.push({
      kind: "header",
      key: `hdr:${sectionId}`,
      sectionId,
      count: members.length,
      groupKind,
      worldId: sampleLoc.worldId,
      location: groupKind === "world" ? sectionId : undefined,
      instanceType: sampleLoc.instanceType,
      region: sampleLoc.region,
      pinned: sectionId === pinnedKey ? "self" : undefined,
    });
    if (collapsed.has(sectionId)) continue;
    for (const friend of members) {
      rows.push({
        kind: "friend",
        key: `usr:${friend.id}`,
        friend,
        locationKey: sectionId,
      });
    }
  }
  return rows;
}

/** Status-bucket rows for the optional List layout. Not the default. */
export function buildStatusVirtualRows(args: {
  friends: readonly Friend[];
  collapsed: ReadonlySet<string>;
}): FriendsVirtualRow[] {
  const buckets: Record<StatusBucket, Friend[]> = {
    joinMe: [],
    active: [],
    askMe: [],
    busy: [],
    offline: [],
  };
  for (const f of args.friends) {
    buckets[statusBucket(f.status)].push(f);
  }
  const rows: FriendsVirtualRow[] = [];
  for (const bucket of STATUS_BUCKET_ORDER) {
    const members = sortByDisplayName(buckets[bucket]);
    if (members.length === 0) continue;
    const sectionId = `status:${bucket}`;
    rows.push({
      kind: "header",
      key: `hdr:${sectionId}`,
      sectionId,
      count: members.length,
      groupKind: "status",
      bucket,
    });
    if (args.collapsed.has(sectionId)) continue;
    for (const friend of members) {
      rows.push({
        kind: "friend",
        key: `usr:${friend.id}`,
        friend,
        locationKey: sectionId,
      });
    }
  }
  return rows;
}

/** World ids currently on screen (plus the selected inspector friend). */
export function visibleWorldIdsFromRows(
  rows: readonly FriendsVirtualRow[],
  indexes: readonly number[],
  selected?: Friend | null,
): string[] {
  const ids = new Set<string>();
  for (const i of indexes) {
    const row = rows[i];
    if (!row) continue;
    if (row.kind === "header" && row.worldId) ids.add(row.worldId);
    if (row.kind === "friend") {
      const loc = parseLocation(row.friend.location);
      if (loc.kind === "world" && loc.worldId) ids.add(loc.worldId);
    }
  }
  if (selected) {
    const loc = parseLocation(selected.location);
    if (loc.kind === "world" && loc.worldId) ids.add(loc.worldId);
  }
  return [...ids];
}
