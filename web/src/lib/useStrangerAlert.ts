import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { subscribePipelineEvent } from "./pipeline-events";
import { useAuth } from "./auth-context";
import type { Friend, FriendsListResult } from "./types";

// ── Instance access parsing ────────────────────────────────────────
// VRChat encodes instance access as suffixes on the location string:
//   wrld_{id}:{instance}                → public
//   wrld_{id}:{instance}~hidden(usr_..) → friends+
//   wrld_{id}:{instance}~friends(usr_..)→ friends-only
//   wrld_{id}:{instance}~private(usr_..)→ invite-only
// We only trigger stranger alerts for non-public instances — showing a
// toast every time anyone joins a public world would be noise.

type AccessType = "public" | "friends+" | "friends" | "invite" | "group" | "unknown";

function parseAccessType(location: string | undefined | null): AccessType {
  if (!location || typeof location !== "string") return "unknown";
  if (location === "offline" || location === "private" || location === "traveling") {
    return "unknown";
  }
  if (location.includes("~hidden(")) return "friends+";
  if (location.includes("~friends(")) return "friends";
  if (location.includes("~private(") || location.includes("~group(")) {
    return location.includes("~group(") ? "group" : "invite";
  }
  // Some worlds omit the tilde segment entirely → public.
  if (location.includes(":") && !location.includes("~")) return "public";
  return "unknown";
}

function sameInstance(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  // Compare up to the first `~` (instance id), ignoring access modifiers
  // so a shared wrld+instance matches even if ownership metadata differs.
  const stripMod = (s: string) => {
    const tilde = s.indexOf("~");
    return tilde < 0 ? s : s.slice(0, tilde);
  };
  return stripMod(a) === stripMod(b);
}

export interface StrangerEvent {
  strangerUserId: string;
  strangerDisplayName: string | null;
  instanceLocation: string;
  accessType: AccessType;
}

/**
 * React hook that watches the pipeline for `user-location` events and
 * fires a toast when a non-friend joins the user's own non-public
 * instance. The "own location" comes from the local player's
 * `user-update` event (VRChat emits one whenever the current user's
 * presence changes), which we cache in a ref.
 *
 * This is the backbone of the Stranger-in-Private alert (Roadmap §Tier
 * S bet #3). It's stateless across restarts — no DB, no persistence —
 * so false positives are cheap to dismiss.
 */
export function useStrangerAlert() {
  const { t } = useTranslation();
  const { status } = useAuth();
  const queryClient = useQueryClient();

  // Our own current instance location. Updated on every `user-update`
  // that carries a location, and on `user-location` events that target
  // ourselves. Held in a ref so it's readable from other subscriptions
  // without triggering re-renders.
  const selfLocationRef = useRef<string | null>(null);

  // Debounce alerts — if someone joins + leaves + rejoins in rapid
  // succession (cell transitions, shard re-balance) we only want one
  // toast per user per minute.
  const recentAlertsRef = useRef<Map<string, number>>(new Map());

  const getFriendIds = useCallback((): Set<string> => {
    const cached = queryClient.getQueryData<FriendsListResult>(["friends.list"]);
    const friends = cached?.friends ?? [];
    return new Set(
      friends.map((f: Friend) => f.id).filter((id): id is string => typeof id === "string"),
    );
  }, [queryClient]);

  useEffect(() => {
    if (!status.authed || !status.userId) return;

    const selfId = status.userId;

    // Track our own location via `user-update` (whole-user patch) AND
    // `user-location` where userId equals us.
    const unsubSelfUpdate = subscribePipelineEvent<{
      userId?: string;
      user?: { location?: string; id?: string };
    }>("user-update", (content) => {
      if (!content) return;
      if (content.userId === selfId || content.user?.id === selfId) {
        const loc = content.user?.location;
        if (typeof loc === "string" && loc) {
          selfLocationRef.current = loc;
        }
      }
    });

    const unsubUserLocation = subscribePipelineEvent<{
      userId?: string;
      location?: string;
      user?: { id?: string; displayName?: string };
    }>("user-location", (content) => {
      if (!content) return;

      // If the event targets us, it's us teleporting — update our ref.
      const targetId = content.userId ?? content.user?.id;
      if (targetId === selfId) {
        if (typeof content.location === "string") {
          selfLocationRef.current = content.location;
        }
        return;
      }

      // Otherwise: foreign user joined/moved. Check if they're in OUR
      // instance and whether they're a stranger.
      const mine = selfLocationRef.current;
      if (!mine) return;
      const theirs = content.location;
      if (!theirs || typeof theirs !== "string") return;
      if (!sameInstance(mine, theirs)) return;

      const access = parseAccessType(mine);
      if (access === "public" || access === "unknown") return;

      if (!targetId) return;
      const friendIds = getFriendIds();
      if (friendIds.has(targetId)) return;

      // Debounce: one alert per stranger per minute.
      const now = Date.now();
      const last = recentAlertsRef.current.get(targetId) ?? 0;
      if (now - last < 60_000) return;
      recentAlertsRef.current.set(targetId, now);

      const displayName = content.user?.displayName ?? t("strangerAlert.unknownUser");
      toast.warning(t("strangerAlert.title", { access }), {
        description: `${displayName} (${targetId})`,
        duration: 8000,
      });
    });

    return () => {
      unsubSelfUpdate();
      unsubUserLocation();
    };
  }, [status.authed, status.userId, getFriendIds, t]);
}
