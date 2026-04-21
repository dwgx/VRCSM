import type { Friend, FriendsListResult } from "./types";

/**
 * Patch a Pipeline event into the cached friends list. Returns a new
 * `FriendsListResult` (or `null` to mean "no change") so callers can
 * feed it straight into a `setData` call.
 *
 * The shapes here match VRChat's documented Pipeline payloads:
 *   - friend-online / friend-active / friend-update / friend-add carry
 *     a partial `user` object that we shallow-merge into the row.
 *   - friend-location additionally carries `location` + `worldId` +
 *     `travelingToLocation`.
 *   - friend-offline only carries `userId` + `platform`; we mark the
 *     row as offline rather than deleting it.
 *   - friend-delete removes the row entirely.
 *
 * Unknown event types or missing userIds resolve to `null`.
 */
export function applyFriendPipelineEvent(
  current: FriendsListResult | null,
  type: string,
  content: unknown,
): FriendsListResult | null {
  if (!current) return null;
  if (typeof content !== "object" || content === null) return null;

  const c = content as Record<string, unknown>;
  const userId = typeof c.userId === "string" ? c.userId : null;
  if (!userId && type !== "friend-add") return null;

  const userPatch =
    typeof c.user === "object" && c.user !== null
      ? (c.user as Partial<Friend>)
      : null;

  const merge = (existing: Friend, patch: Partial<Friend>): Friend => ({
    ...existing,
    ...patch,
  });

  switch (type) {
    case "friend-online":
    case "friend-active":
    case "friend-update": {
      const friends = current.friends.map((f) => {
        if (f.id !== userId) return f;
        return merge(f, {
          ...(userPatch ?? {}),
          status: (userPatch?.status as string | undefined) ?? f.status ?? "active",
          last_activity: new Date().toISOString(),
          last_platform:
            (typeof c.platform === "string" ? c.platform : null) ??
            f.last_platform,
          location:
            typeof c.location === "string" ? c.location : f.location,
        } as Partial<Friend>);
      });
      return { ...current, friends };
    }

    case "friend-location": {
      const friends = current.friends.map((f) => {
        if (f.id !== userId) return f;
        return merge(f, {
          ...(userPatch ?? {}),
          location:
            typeof c.location === "string" ? c.location : f.location,
          last_activity: new Date().toISOString(),
        } as Partial<Friend>);
      });
      return { ...current, friends };
    }

    case "friend-offline": {
      const friends = current.friends.map((f) => {
        if (f.id !== userId) return f;
        return merge(f, {
          status: "offline",
          location: "offline",
          last_login: new Date().toISOString(),
          last_activity: new Date().toISOString(),
        } as Partial<Friend>);
      });
      return { ...current, friends };
    }

    case "friend-add": {
      // The full user object is required for a fresh row.
      if (!userPatch || !userPatch.id) return null;
      // De-dup on id so re-adds (or stale-cache races) don't double up.
      const friends = current.friends.filter((f) => f.id !== userPatch.id);
      friends.unshift(userPatch as Friend);
      return { ...current, friends };
    }

    case "friend-delete": {
      const friends = current.friends.filter((f) => f.id !== userId);
      if (friends.length === current.friends.length) return null;
      return { ...current, friends };
    }

    default:
      return null;
  }
}

/** Event type set the Friends pages need to subscribe to. */
export const FRIEND_PIPELINE_EVENT_TYPES = [
  "friend-online",
  "friend-offline",
  "friend-active",
  "friend-location",
  "friend-update",
  "friend-add",
  "friend-delete",
] as const;
