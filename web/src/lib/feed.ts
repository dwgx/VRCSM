import { ipc } from "./ipc";
import { parseLocation } from "./vrcFriends";
import type { FeedEntryDto, FeedSourceKind } from "./ipc";

/**
 * Feed domain module — the read side of Track B1.
 *
 * The C++ `feed.unified` read model UNION ALL's four event sources into one
 * time-ordered stream with a `source_kind` discriminator. This module turns
 * those raw rows into a render-friendly `FeedEntry` shape: a single canonical
 * `category` the UI filters on, a derived `world`/`instance` for session
 * grouping, and a human-facing summary the row component can show directly.
 *
 * Keeping this mapping out of the component means the FeedPanel stays a dumb
 * renderer, and any future feed surface (Dashboard tile, command palette)
 * reuses the same normalization.
 */

/** UI-facing category. Narrower and more stable than the raw event_type soup. */
export type FeedCategory =
  | "online"
  | "offline"
  | "location"
  | "status"
  | "avatar"
  | "joined"
  | "left"
  | "friend-added"
  | "friend-removed"
  | "video"
  | "portal"
  | "moderation"
  | "sticker"
  | "notification"
  | "session"
  | "diagnostic"
  | "other";

/** All categories the filter UI offers, in display order.
 * `diagnostic` is intentionally excluded — A7/A8 noisy lines are opt-in via the
 * Logs page filters only, never the default social feed. */
export const FEED_CATEGORIES: readonly FeedCategory[] = [
  "online",
  "offline",
  "location",
  "status",
  "joined",
  "left",
  "avatar",
  "notification",
  "video",
  "portal",
  "moderation",
  "sticker",
  "session",
  "friend-added",
  "friend-removed",
  "other",
] as const;

/** Maps a UI category back to the `source_kind` filter the host understands. */
export const CATEGORY_TO_SOURCE_KIND: Partial<Record<FeedCategory, FeedSourceKind>> = {
  joined: "player_event",
  left: "player_event",
  avatar: "avatar",
  video: "log_event",
  portal: "log_event",
  moderation: "log_event",
  sticker: "log_event",
  notification: "log_event",
  session: "log_event",
  diagnostic: "log_event",
};

export interface FeedEntry {
  /** Stable key: `${source_kind}:${event_id}`. */
  key: string;
  sourceKind: FeedSourceKind;
  category: FeedCategory;
  userId: string | null;
  displayName: string | null;
  worldId: string | null;
  instanceId: string | null;
  /** Raw detail payload (location / new status / avatar name) when present. */
  detail: string | null;
  occurredAt: string | null;
}

function categorize(row: FeedEntryDto): FeedCategory {
  const kind = row.source_kind;
  const evt = (row.event_type ?? "").toLowerCase();
  if (kind === "avatar") return "avatar";
  if (kind === "log_event") {
    if (evt === "videoplay") return "video";
    // A2/A3: video error + attributed play + sync all fold into `video`.
    if (evt === "videoerror" || evt === "attributedvideoplay" || evt === "videosync")
      return "video";
    if (evt === "portalspawn") return "portal";
    // A7: instance-reset reuses the moderation family.
    if (evt === "votekick" || evt === "joinblocked" || evt === "instancereset")
      return "moderation";
    if (evt === "stickerspawn") return "sticker";
    // A1: inbound notifications get their own category.
    if (evt === "notification") return "notification";
    // A4: pedestal avatar swap reuses the avatar category.
    if (evt === "avatarpedestal") return "avatar";
    // A5/A6: session lifecycle markers.
    if (evt === "vrcquit" || evt === "sessionmode") return "session";
    // A7/A8: diagnostics (default-off feed category, opt-in via Logs filters).
    if (evt === "oscfail" || evt === "udonexception" || evt === "shaderkeyword"
      || evt === "audiodevice")
      return "diagnostic";
    return "other";
  }
  if (kind === "player_event") {
    if (evt === "joined" || evt === "join") return "joined";
    if (evt === "left" || evt === "leave") return "left";
    return "other";
  }
  if (kind === "friend_log") {
    if (evt === "friend.added") return "friend-added";
    if (evt === "friend.removed") return "friend-removed";
    if (evt.startsWith("status")) return "status";
    if (evt.startsWith("avatar")) return "avatar";
    if (evt.startsWith("online")) return "online";
    if (evt.startsWith("offline")) return "offline";
    return "other";
  }
  // presence
  if (evt === "online") return "online";
  if (evt === "offline") return "offline";
  if (evt === "location") return "location";
  if (evt === "status") return "status";
  if (evt === "avatar") return "avatar";
  return "other";
}

/** Normalize one raw feed row. Derives world/instance from detail when the
 * row didn't already carry them (friend_log location flips, for instance). */
export function toFeedEntry(row: FeedEntryDto): FeedEntry {
  let worldId = row.world_id;
  let instanceId = row.instance_id;
  if (!worldId && row.detail && row.detail.startsWith("wrld_")) {
    const parsed = parseLocation(row.detail);
    if (parsed.kind === "world") {
      worldId = parsed.worldId ?? null;
      instanceId = parsed.instanceId ?? null;
    }
  }
  return {
    key: `${row.source_kind ?? "unknown"}:${row.event_id}`,
    sourceKind: (row.source_kind ?? "presence") as FeedSourceKind,
    category: categorize(row),
    userId: row.user_id,
    displayName: row.display_name,
    worldId,
    instanceId,
    detail: row.detail,
    occurredAt: row.occurred_at,
  };
}

export interface FeedQuery {
  limit?: number;
  offset?: number;
  userId?: string;
  /** Filter to one UI category. Mapped to a source_kind hint where possible;
   * categories that share a source_kind are further narrowed client-side. */
  category?: FeedCategory;
  occurredAfter?: string;
  occurredBefore?: string;
}

/** One fetched page of feed rows.
 *
 * `entries` is the render-ready, category-narrowed list. `rawCount` is how many
 * rows the host actually returned BEFORE client-side category narrowing — the
 * infinite-scroll pager must decide "is there a next page?" on `rawCount`, never
 * `entries.length`. Otherwise a page of e.g. 60 `log_event` rows that happens to
 * contain zero `video` rows would narrow to `[]` and halt paging prematurely,
 * making categories that share a source_kind (video/portal/moderation/sticker,
 * online/offline/status) look empty even when matching rows exist deeper. */
export interface FeedPage {
  entries: FeedEntry[];
  rawCount: number;
}

/**
 * Fetch a page of normalized feed entries. When a category maps cleanly to a
 * single source_kind we push the filter to the host; otherwise (e.g. online vs
 * offline, both `presence`) we over-fetch by source_kind and narrow here so
 * pagination still behaves.
 */
export async function fetchFeed(query: FeedQuery = {}): Promise<FeedPage> {
  const sourceKind = query.category
    ? CATEGORY_TO_SOURCE_KIND[query.category]
    : undefined;

  const res = await ipc.feedUnified({
    limit: query.limit,
    offset: query.offset,
    user_id: query.userId,
    source_kind: sourceKind,
    occurred_after: query.occurredAfter,
    occurred_before: query.occurredBefore,
  });

  const raw = res.items ?? [];
  let entries = raw.map(toFeedEntry);
  if (query.category) {
    entries = entries.filter((e) => e.category === query.category);
  }
  return { entries, rawCount: raw.length };
}
