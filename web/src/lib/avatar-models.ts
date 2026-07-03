import { OFFICIAL_FAVORITES_LIST_NAME, normalizeFavoriteType } from "@/lib/library";
import type { AvatarHistoryItem, AvatarSearchResult, FavoriteItem } from "@/lib/types";

export type AvatarModelSource = "owned" | "favorite" | "history" | "search";

export interface AvatarModelRecord {
  avatarId: string;
  name: string | null;
  authorName: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  releaseStatus: string | null;
  version: number | null;
  firstSeenAt: string | null;
  lastUpdatedAt: string | null;
  favoriteLists: string[];
  localTags: string[];
  localNote: string | null;
  sources: AvatarModelSource[];
  resolutionStatus: string | null;
}

export interface AvatarModelFilters {
  source?: AvatarModelSource | "all";
  query?: string;
  releaseStatus?: "all" | "public" | "private" | "hidden";
}

interface MutableAvatarModelRecord extends AvatarModelRecord {
  sourceSet: Set<AvatarModelSource>;
  favoriteListSet: Set<string>;
  tagSet: Set<string>;
}

function canonicalAvatarId(id: string | null | undefined): string | null {
  const trimmed = id?.trim();
  if (!trimmed) return null;
  return trimmed;
}

function historyAvatarId(item: AvatarHistoryItem): string | null {
  return canonicalAvatarId(item.resolved_avatar_id ?? item.avatar_id);
}

function createRecord(avatarId: string): MutableAvatarModelRecord {
  return {
    avatarId,
    name: null,
    authorName: null,
    imageUrl: null,
    thumbnailUrl: null,
    releaseStatus: null,
    version: null,
    firstSeenAt: null,
    lastUpdatedAt: null,
    favoriteLists: [],
    localTags: [],
    localNote: null,
    sources: [],
    resolutionStatus: null,
    sourceSet: new Set(),
    favoriteListSet: new Set(),
    tagSet: new Set(),
  };
}

function getRecord(map: Map<string, MutableAvatarModelRecord>, avatarId: string) {
  const existing = map.get(avatarId);
  if (existing) return existing;
  const next = createRecord(avatarId);
  map.set(avatarId, next);
  return next;
}

function preferText(current: string | null, next: string | null | undefined): string | null {
  const trimmed = next?.trim();
  if (!trimmed) return current;
  return trimmed;
}

function preferEarlier(current: string | null, next: string | null | undefined): string | null {
  if (!next) return current;
  if (!current) return next;
  return next < current ? next : current;
}

function preferLater(current: string | null, next: string | null | undefined): string | null {
  if (!next) return current;
  if (!current) return next;
  return next > current ? next : current;
}

function addSource(record: MutableAvatarModelRecord, source: AvatarModelSource) {
  record.sourceSet.add(source);
}

function mergeFavorite(record: MutableAvatarModelRecord, item: FavoriteItem) {
  addSource(record, "favorite");
  record.name = preferText(record.name, item.display_name);
  record.thumbnailUrl = preferText(record.thumbnailUrl, item.thumbnail_url);
  record.firstSeenAt = preferEarlier(record.firstSeenAt, item.added_at);
  record.lastUpdatedAt = preferLater(record.lastUpdatedAt, item.added_at);
  record.localNote = preferText(record.localNote, item.note);
  if (item.list_name) {
    record.favoriteListSet.add(item.list_name);
  }
  for (const tag of item.tags ?? []) {
    const trimmed = tag.trim();
    if (trimmed) record.tagSet.add(trimmed);
  }
}

function mergeHistory(record: MutableAvatarModelRecord, item: AvatarHistoryItem) {
  addSource(record, "history");
  record.name = preferText(record.name, item.avatar_name);
  record.authorName = preferText(record.authorName, item.author_name);
  record.thumbnailUrl = preferText(record.thumbnailUrl, item.resolved_thumbnail_url);
  record.imageUrl = preferText(record.imageUrl, item.resolved_image_url);
  record.releaseStatus = preferText(record.releaseStatus, item.release_status);
  record.firstSeenAt = preferEarlier(record.firstSeenAt, item.first_seen_at ?? item.first_seen_on);
  record.lastUpdatedAt = preferLater(record.lastUpdatedAt, item.resolved_at ?? item.first_seen_at);
  record.resolutionStatus = preferText(record.resolutionStatus, item.resolution_status);
}

function mergeSearch(record: MutableAvatarModelRecord, item: AvatarSearchResult) {
  addSource(record, "search");
  record.name = preferText(record.name, item.name);
  record.authorName = preferText(record.authorName, item.authorName);
  record.imageUrl = preferText(record.imageUrl, item.imageUrl);
  record.thumbnailUrl = preferText(record.thumbnailUrl, item.thumbnailImageUrl);
  record.releaseStatus = preferText(record.releaseStatus, item.releaseStatus);
  record.version = item.version ?? record.version;
  record.firstSeenAt = preferEarlier(record.firstSeenAt, item.created_at);
  record.lastUpdatedAt = preferLater(record.lastUpdatedAt, item.updated_at);
  for (const tag of item.tags ?? []) {
    const trimmed = tag.trim();
    if (trimmed) record.tagSet.add(trimmed);
  }
}

// Owned avatars are account-authoritative: their server-side name, image and
// releaseStatus override anything inferred from favorites/history/search, so
// we overwrite (not just prefer-when-empty) those fields.
function mergeOwned(record: MutableAvatarModelRecord, item: AvatarSearchResult) {
  addSource(record, "owned");
  record.name = item.name?.trim() || record.name;
  record.authorName = item.authorName?.trim() || record.authorName;
  record.imageUrl = item.imageUrl?.trim() || record.imageUrl;
  record.thumbnailUrl = item.thumbnailImageUrl?.trim() || record.thumbnailUrl;
  record.releaseStatus = item.releaseStatus?.trim() || record.releaseStatus;
  record.version = item.version ?? record.version;
  record.firstSeenAt = preferEarlier(record.firstSeenAt, item.created_at);
  record.lastUpdatedAt = preferLater(record.lastUpdatedAt, item.updated_at);
  for (const tag of item.tags ?? []) {
    const trimmed = tag.trim();
    if (trimmed) record.tagSet.add(trimmed);
  }
}

function finalizeRecord(record: MutableAvatarModelRecord): AvatarModelRecord {
  const favoriteLists = Array.from(record.favoriteListSet).sort((a, b) => {
    if (a === OFFICIAL_FAVORITES_LIST_NAME) return 1;
    if (b === OFFICIAL_FAVORITES_LIST_NAME) return -1;
    return a.localeCompare(b);
  });
  const localTags = Array.from(record.tagSet).sort((a, b) => a.localeCompare(b));
  const sources = Array.from(record.sourceSet).sort((a, b) => {
    const weight: Record<AvatarModelSource, number> = { owned: 0, favorite: 1, history: 2, search: 3 };
    return weight[a] - weight[b];
  });
  return {
    avatarId: record.avatarId,
    name: record.name,
    authorName: record.authorName,
    imageUrl: record.imageUrl,
    thumbnailUrl: record.thumbnailUrl,
    releaseStatus: record.releaseStatus,
    version: record.version,
    firstSeenAt: record.firstSeenAt,
    lastUpdatedAt: record.lastUpdatedAt,
    favoriteLists,
    localTags,
    localNote: record.localNote,
    sources,
    resolutionStatus: record.resolutionStatus,
  };
}

export function normalizeAvatarModelRecords(input: {
  owned?: AvatarSearchResult[];
  favorites?: FavoriteItem[];
  history?: AvatarHistoryItem[];
  search?: AvatarSearchResult[];
}): AvatarModelRecord[] {
  const map = new Map<string, MutableAvatarModelRecord>();

  for (const item of input.favorites ?? []) {
    if (normalizeFavoriteType(item.type) !== "avatar") continue;
    const avatarId = canonicalAvatarId(item.target_id);
    if (!avatarId) continue;
    mergeFavorite(getRecord(map, avatarId), item);
  }

  for (const item of input.history ?? []) {
    const avatarId = historyAvatarId(item);
    if (!avatarId) continue;
    mergeHistory(getRecord(map, avatarId), item);
  }

  for (const item of input.search ?? []) {
    const avatarId = canonicalAvatarId(item.id);
    if (!avatarId) continue;
    mergeSearch(getRecord(map, avatarId), item);
  }

  // Owned data is account-authoritative, so it merges last and overwrites the
  // name/image/releaseStatus that favorites/history/search may have filled in.
  for (const item of input.owned ?? []) {
    const avatarId = canonicalAvatarId(item.id);
    if (!avatarId) continue;
    mergeOwned(getRecord(map, avatarId), item);
  }

  return Array.from(map.values())
    .map(finalizeRecord)
    .sort((a, b) => {
      const aTime = a.lastUpdatedAt ?? a.firstSeenAt ?? "";
      const bTime = b.lastUpdatedAt ?? b.firstSeenAt ?? "";
      const byTime = bTime.localeCompare(aTime);
      if (byTime !== 0) return byTime;
      return (a.name ?? a.avatarId).localeCompare(b.name ?? b.avatarId);
    });
}

export function avatarModelImage(record: AvatarModelRecord): string | null {
  return record.thumbnailUrl ?? record.imageUrl;
}

export function avatarModelLabel(record: AvatarModelRecord): string {
  return record.name ?? record.avatarId;
}

export function filterAvatarModels(
  records: AvatarModelRecord[],
  filters: AvatarModelFilters,
): AvatarModelRecord[] {
  const source = filters.source ?? "all";
  const releaseStatus = filters.releaseStatus ?? "all";
  const query = filters.query?.trim().toLowerCase() ?? "";
  return records.filter((record) => {
    if (source !== "all" && !record.sources.includes(source)) return false;
    if (releaseStatus !== "all" && record.releaseStatus !== releaseStatus) return false;
    if (!query) return true;
    const haystack = [
      record.avatarId,
      record.name,
      record.authorName,
      record.releaseStatus,
      ...record.favoriteLists,
      ...record.localTags,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}
