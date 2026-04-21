import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth-context";
import { subscribePipelineEvent } from "./pipeline-events";
import {
  applyFriendPipelineEvent,
  FRIEND_PIPELINE_EVENT_TYPES,
} from "./friends-pipeline";
import type { FriendsListResult } from "./types";

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
