import { ipc } from "@/lib/ipc";
import type {
  AvatarHistoryItem,
  AvatarHistoryResolveRequest,
  DbPlayerEvent,
  DbPlayerEventsFilter,
  DbWorldVisit,
  FriendLogEvent,
  GlobalSearchResult,
  PagedItems,
  SearchGlobalRequest,
  SearchGlobalResponse,
} from "@/lib/types";

export function listWorldVisits(limit = 250, offset = 0): Promise<PagedItems<DbWorldVisit>> {
  return ipc.dbWorldVisits(limit, offset) as Promise<PagedItems<DbWorldVisit>>;
}

export function listPlayerEvents(
  limit = 100,
  offset = 0,
  filter?: DbPlayerEventsFilter,
): Promise<PagedItems<DbPlayerEvent>> {
  return ipc.dbPlayerEvents(limit, offset, filter) as Promise<PagedItems<DbPlayerEvent>>;
}

export function listFriendLog(limit = 100, offset = 0): Promise<PagedItems<FriendLogEvent>> {
  return ipc.friendLogRecent(limit, offset) as Promise<PagedItems<FriendLogEvent>>;
}

export function listAvatarHistory(limit = 100, offset = 0): Promise<PagedItems<AvatarHistoryItem>> {
  return ipc.dbAvatarHistory(limit, offset) as Promise<PagedItems<AvatarHistoryItem>>;
}

export function countAvatarHistory(): Promise<{ count: number }> {
  return ipc.dbAvatarHistoryCount();
}

export function resolveAvatarHistory(params: AvatarHistoryResolveRequest): Promise<{ ok: boolean }> {
  return ipc.dbAvatarHistoryResolve(params);
}

export function clearHistory(includeFriendNotes = false): Promise<unknown> {
  return ipc.dbHistoryClear(includeFriendNotes);
}

export function searchGlobal(params: SearchGlobalRequest): Promise<SearchGlobalResponse> {
  return ipc.searchGlobal(params);
}

export async function searchGlobalItems(params: SearchGlobalRequest): Promise<GlobalSearchResult[]> {
  const result = await searchGlobal(params);
  return result.items ?? [];
}
