import { ipc } from "./ipc";
import { parseLocation } from "./vrcFriends";
import type { FeedEntryDto, FeedSourceKind } from "./ipc";

/**
 * Historical activity ledger — a filtered read of `feed.unified`, not the
 * live Radar Feed. Mapping is fail-closed: unknown event types and missing
 * identities become `other` / null rather than invented names.
 */

export type LedgerKind =
  | "join"
  | "leave"
  | "meet"
  | "invite"
  | "inviteResponse"
  | "requestInvite"
  | "friendRequest"
  | "video"
  | "other";

/** Filter chips in display order. `other` is last so unclassified rows stay opt-in. */
export const LEDGER_KINDS: readonly LedgerKind[] = [
  "join",
  "leave",
  "meet",
  "invite",
  "inviteResponse",
  "requestInvite",
  "friendRequest",
  "video",
  "other",
] as const;

export type LedgerRangePreset = "recent" | "7d" | "30d" | "all";

export const LEDGER_RANGE_PRESETS: readonly LedgerRangePreset[] = [
  "recent",
  "7d",
  "30d",
  "all",
] as const;

/** Recent = last 24 hours. */
const RECENT_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const VIDEO_EVENTS = new Set([
  "videoplay",
  "videoerror",
  "attributedvideoplay",
  "videosync",
]);

/**
 * VRChat notification `type` values we can map without guessing. Logged
 * notifications are received (`[API] Received Notification`); send vs recv
 * is not a separate column, so we keep the VRChat type name as the kind.
 * `requestInviteResponse` folds into `inviteResponse` (response family).
 */
const NOTIFICATION_TYPE_TO_KIND: Record<string, LedgerKind> = {
  invite: "invite",
  inviteresponse: "inviteResponse",
  requestinvite: "requestInvite",
  requestinviteresponse: "inviteResponse",
  friendrequest: "friendRequest",
};

const KIND_TO_SOURCE: Record<LedgerKind, FeedSourceKind | undefined> = {
  join: "player_event",
  leave: "player_event",
  meet: "player_event",
  invite: "log_event",
  inviteResponse: "log_event",
  requestInvite: "log_event",
  friendRequest: "log_event",
  video: "log_event",
  other: undefined,
};

export interface LedgerMapOptions {
  /**
   * Local VRChat user id when known. Required to split self `join` from
   * other-player `meet`. When omitted, every player join stays `join`
   * (we do not guess who is "me").
   */
  selfUserId?: string | null;
}

export interface LedgerEntry {
  /** Stable key: `${source_kind}:${event_id}`. */
  key: string;
  sourceKind: FeedSourceKind;
  kind: LedgerKind;
  /** Raw host event_type / log kind. */
  eventType: string | null;
  userId: string | null;
  displayName: string | null;
  worldId: string | null;
  instanceId: string | null;
  detail: string | null;
  occurredAt: string | null;
  /** Best id to copy: usr_… then wrld_… then the composite key. */
  copyId: string;
}

export interface LedgerQuery {
  limit?: number;
  offset?: number;
  kinds?: readonly LedgerKind[];
  occurredAfter?: string;
  occurredBefore?: string;
  selfUserId?: string | null;
}

export interface LedgerPage {
  entries: LedgerEntry[];
  /** Unified-feed offset after the last consumed raw page. */
  nextOffset: number;
  /** True when the last raw page was shorter than `limit`. */
  exhausted: boolean;
}

function lower(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function deriveWorld(row: FeedEntryDto): {
  worldId: string | null;
  instanceId: string | null;
} {
  let worldId = row.world_id;
  let instanceId = row.instance_id;
  if (!worldId && row.detail && row.detail.startsWith("wrld_")) {
    const parsed = parseLocation(row.detail);
    if (parsed.kind === "world") {
      worldId = parsed.worldId ?? null;
      instanceId = parsed.instanceId ?? null;
    }
  }
  return { worldId, instanceId };
}

function notificationKind(type: string | null | undefined): LedgerKind | null {
  const key = lower(type).replace(/[_\s-]/g, "");
  if (!key) return null;
  return NOTIFICATION_TYPE_TO_KIND[key] ?? null;
}

/**
 * Map one unified-feed row to a ledger kind. Honest:
 * - missing notification type → `other` (not invite)
 * - player join with no user_id while self is known → `other` (can't split meet/join)
 * - `friend.added` is not a friend request
 * - `joinBlocked` is not a join
 */
export function mapLedgerKind(
  row: FeedEntryDto,
  options: LedgerMapOptions = {},
): LedgerKind {
  const source = row.source_kind ?? "presence";
  const evt = lower(row.event_type);

  if (source === "player_event") {
    if (evt === "left" || evt === "leave") return "leave";
    if (evt === "joined" || evt === "join") {
      const self = options.selfUserId?.trim() || "";
      const userId = row.user_id?.trim() || "";
      if (!self) return "join";
      if (!userId) return "other";
      return userId === self ? "join" : "meet";
    }
    return "other";
  }

  if (source === "log_event") {
    if (VIDEO_EVENTS.has(evt)) return "video";
    if (evt === "notification") {
      return notificationKind(row.detail) ?? "other";
    }
    const asNotif = notificationKind(row.event_type);
    if (asNotif) return asNotif;
    return "other";
  }

  // Presence / friend_log / avatar never encode invite or meet.
  const asNotif = notificationKind(row.event_type);
  if (asNotif) return asNotif;
  return "other";
}

function copyIdFor(
  row: FeedEntryDto,
  worldId: string | null,
  key: string,
): string {
  const userId = row.user_id?.trim() || "";
  if (userId.startsWith("usr_")) return userId;
  const world = (worldId ?? "").trim();
  if (world.startsWith("wrld_")) return world;
  return key;
}

export function toLedgerEntry(
  row: FeedEntryDto,
  options: LedgerMapOptions = {},
): LedgerEntry {
  const { worldId, instanceId } = deriveWorld(row);
  const sourceKind = (row.source_kind ?? "presence") as FeedSourceKind;
  const key = `${sourceKind}:${row.event_id}`;
  return {
    key,
    sourceKind,
    kind: mapLedgerKind(row, options),
    eventType: row.event_type,
    userId: row.user_id,
    displayName: row.display_name,
    worldId,
    instanceId,
    detail: row.detail,
    occurredAt: row.occurred_at,
    copyId: copyIdFor(row, worldId, key),
  };
}

/** Host `source_kind` hint when every selected kind shares one source. */
export function ledgerSourceKindHint(
  kinds: readonly LedgerKind[] | undefined,
): FeedSourceKind | undefined {
  if (!kinds || kinds.length === 0) return undefined;
  const sources = new Set<FeedSourceKind | undefined>();
  for (const kind of kinds) sources.add(KIND_TO_SOURCE[kind]);
  if (sources.size !== 1) return undefined;
  const only = [...sources][0];
  return only;
}

export function ledgerOccurredAfter(
  preset: LedgerRangePreset,
  nowMs = Date.now(),
): string | undefined {
  if (preset === "all") return undefined;
  const span =
    preset === "recent" ? RECENT_MS : preset === "7d" ? 7 * DAY_MS : 30 * DAY_MS;
  return new Date(nowMs - span).toISOString();
}

export function parseLedgerTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.includes("T")
    ? value
    : value.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, "$1-$2-$3");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function ledgerEntryMatchesKeyword(
  entry: LedgerEntry,
  query: string,
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    (entry.displayName?.toLowerCase().includes(q) ?? false) ||
    (entry.userId?.toLowerCase().includes(q) ?? false) ||
    (entry.worldId?.toLowerCase().includes(q) ?? false) ||
    (entry.instanceId?.toLowerCase().includes(q) ?? false) ||
    (entry.detail?.toLowerCase().includes(q) ?? false) ||
    (entry.eventType?.toLowerCase().includes(q) ?? false) ||
    entry.kind.toLowerCase().includes(q) ||
    entry.copyId.toLowerCase().includes(q)
  );
}

export async function fetchLedger(query: LedgerQuery = {}): Promise<LedgerPage> {
  const sourceKind = ledgerSourceKindHint(query.kinds);
  const pageSize = query.limit ?? 80;
  const startOffset = query.offset ?? 0;
  const want = query.kinds && query.kinds.length > 0 ? new Set(query.kinds) : null;
  const entries: LedgerEntry[] = [];
  let offset = startOffset;
  let lastRawLen = 0;
  // Kind chips are a client filter. Keep walking unified-feed pages until
  // this request fills `pageSize` matches or the feed is exhausted, so a
  // Video-only chip does not render empty after a join-heavy first page.
  const maxWalk = 8;
  for (let i = 0; i < maxWalk; i += 1) {
    const res = await ipc.feedUnified({
      limit: pageSize,
      offset,
      source_kind: sourceKind,
      occurred_after: query.occurredAfter,
      occurred_before: query.occurredBefore,
    });
    const raw = res.items ?? [];
    lastRawLen = raw.length;
    for (const row of raw) {
      const entry = toLedgerEntry(row, { selfUserId: query.selfUserId });
      if (!want || want.has(entry.kind)) entries.push(entry);
    }
    offset += raw.length;
    if (raw.length < pageSize) break;
    if (entries.length >= pageSize) break;
  }
  return {
    entries: entries.slice(0, pageSize),
    nextOffset: offset,
    exhausted: lastRawLen < pageSize,
  };
}
