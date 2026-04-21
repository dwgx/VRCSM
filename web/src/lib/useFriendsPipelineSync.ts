import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth-context";
import { subscribePipelineEvent } from "./pipeline-events";
import {
  applyFriendPipelineEvent,
  FRIEND_PIPELINE_EVENT_TYPES,
} from "./friends-pipeline";
import { ipc } from "./ipc";
import type { Friend, FriendsListResult } from "./types";

// Fields we watch for diffs to persist into friend_log. Keep the list
// narrow so we don't drown the table in noise — one entry per observed
// change. `bio` is deliberately excluded (bios are long and change for
// cosmetic reasons more often than they carry signal).
const LOGGED_FIELDS: readonly (keyof Friend)[] = [
  "displayName",
  "status",
  "statusDescription",
  "currentAvatarImageUrl",
  "currentAvatarThumbnailImageUrl",
] as const;

function extractPatchedUser(content: unknown): Partial<Friend> | null {
  if (typeof content !== "object" || content === null) return null;
  const c = content as { user?: Partial<Friend>; userId?: string };
  if (c.user && typeof c.user === "object") return c.user;
  return null;
}

function diffAndLog(
  prev: Friend | undefined,
  next: Partial<Friend>,
  userId: string,
): void {
  if (!prev) return;
  const occurredAt = new Date().toISOString();
  for (const field of LOGGED_FIELDS) {
    const nextVal = next[field];
    const prevVal = prev[field];
    if (nextVal === undefined) continue;
    if (prevVal === nextVal) continue;
    const oldStr = prevVal === null || prevVal === undefined ? "" : String(prevVal);
    const newStr = nextVal === null ? "" : String(nextVal);
    const eventType =
      field === "status" || field === "statusDescription"
        ? "status.changed"
        : field === "currentAvatarImageUrl" || field === "currentAvatarThumbnailImageUrl"
          ? "avatar.changed"
          : field === "displayName"
            ? "displayName.changed"
            : `${field}.changed`;
    void ipc
      .friendLogInsert({
        user_id: userId,
        event_type: eventType,
        old_value: oldStr,
        new_value: newStr,
        occurred_at: occurredAt,
      })
      .catch((e) => console.warn("[friend-log] insert failed", e));
  }
}

/**
 * Bridge Pipeline `friend-*` events into the React Query cache used by
 * `useIpcQuery("friends.list", undefined)`. Any component that reads
 * the cached friends list (TabFriends, Dashboard, FriendDetailDialog
 * via parent props, etc.) will re-render automatically when VRChat
 * pushes an update.
 *
 * The Friends.tsx page maintains its own `useState` cache (predates
 * the React Query migration) and subscribes locally; this hook
 * complements it for the rest of the app.
 *
 * Mounted once at the app shell; lifetime is tied to auth.
 */
export function useFriendsPipelineSync() {
  const { status } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!status.authed) return;

    const unsubs = FRIEND_PIPELINE_EVENT_TYPES.map((type) =>
      subscribePipelineEvent(type, (content) => {
        // Snapshot PRIOR cache state before the reducer merges the
        // patch, so diff-based friend_log entries see the old values.
        const prevCache = qc.getQueryData<FriendsListResult>([
          "friends.list",
        ]);

        // Diff + persist (before the reducer runs, so we see old values).
        if (type === "friend-update" || type === "friend-online" ||
            type === "friend-active" || type === "friend-location")
        {
          const patch = extractPatchedUser(content);
          const c = content as { userId?: string } | null;
          const userId = c?.userId ?? patch?.id;
          if (userId && patch && prevCache) {
            const prev = prevCache.friends.find((f) => f.id === userId);
            diffAndLog(prev, patch, userId);
          }
        }
        if (type === "friend-add") {
          const patch = extractPatchedUser(content);
          if (patch?.id) {
            void ipc
              .friendLogInsert({
                user_id: patch.id,
                event_type: "friend.added",
                new_value: patch.displayName ?? "",
                occurred_at: new Date().toISOString(),
              })
              .catch(() => {});
          }
        }
        if (type === "friend-delete") {
          const c = content as { userId?: string } | null;
          if (c?.userId) {
            const prev = prevCache?.friends.find((f) => f.id === c.userId);
            void ipc
              .friendLogInsert({
                user_id: c.userId,
                event_type: "friend.removed",
                old_value: prev?.displayName ?? "",
                occurred_at: new Date().toISOString(),
              })
              .catch(() => {});
          }
        }

        // The `friends.list` query is keyed `["friends.list", undefined]`
        // (no params). Other variants would need their own update path,
        // but the workspace + dashboard call sites all use this key.
        qc.setQueriesData<FriendsListResult>(
          { queryKey: ["friends.list"] },
          (prev) => applyFriendPipelineEvent(prev ?? null, type, content) ?? prev,
        );
      }),
    );

    return () => unsubs.forEach((u) => u());
  }, [status.authed, qc]);
}
