import { useEffect, useState } from "react";
import { ipc } from "./ipc";
import { usePipelineEvent } from "./pipeline-events";
import { useAuth } from "./auth-context";
import { parseLocation, type LocationInfo } from "./vrcFriends";

interface MyProfileResponse {
  profile?: { location?: string | null };
}

interface UserLocationEvent {
  userId?: string;
  location?: string;
}

/**
 * Tracks the signed-in user's current VRChat instance location. Pulls the
 * initial value from `user.me` on mount / login, then keeps it live via
 * the pipeline `user-location` event. The raw string goes through
 * `parseLocation` so callers get the same `{ kind, worldId, instanceId,
 * instanceType, ... }` shape as friend rows.
 *
 * Returns `null` for `location` when the user is offline / private /
 * traveling, so UI can gate "invite to my room" actions on
 * `location.kind === "world"`.
 */
export function useSelfLocation() {
  const { status } = useAuth();
  const [raw, setRaw] = useState<string | null>(null);

  useEffect(() => {
    if (!status.authed || !status.userId) {
      setRaw(null);
      return;
    }
    let cancelled = false;
    ipc
      .call<undefined, MyProfileResponse>("user.me", undefined)
      .then((res) => {
        if (!cancelled) setRaw(res?.profile?.location ?? null);
      })
      .catch(() => {
        if (!cancelled) setRaw(null);
      });
    return () => {
      cancelled = true;
    };
  }, [status.authed, status.userId]);

  usePipelineEvent<UserLocationEvent>("user-location", (content) => {
    if (!status.userId) return;
    if (content.userId && content.userId !== status.userId) return;
    if (typeof content.location === "string") setRaw(content.location);
  });

  const info: LocationInfo = parseLocation(raw);
  return {
    raw,
    info,
    worldId: info.kind === "world" ? info.worldId ?? null : null,
    instanceId: info.kind === "world" ? info.instanceId ?? null : null,
    isInWorld: info.kind === "world",
  };
}
