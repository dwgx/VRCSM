import { useEffect, useRef } from "react";
import { ipc } from "./ipc";
import { useAuth } from "./auth-context";
import { subscribePipelineEvent } from "./pipeline-events";
import { readUiPrefBoolean, readUiPrefString } from "./ui-prefs";

const PREF_ENABLED = "vrcsm.discord.enabled";
const PREF_CLIENT_ID = "vrcsm.discord.clientId";

interface FriendLocationContent {
  userId: string;
  location: string;
  worldId?: string;
  travelingToLocation?: string;
}

interface UserLocationContent {
  userId: string;
  location: string;
  travelingToLocation?: string;
  world?: { name?: string; capacity?: number; recommendedCapacity?: number };
}

/**
 * Drives Discord Rich Presence from the live VRChat session. Mounted
 * once at the app shell; pulls clientId + enable flag from local UI
 * prefs (Settings page surfaces them), then on every `user-location`
 * pipeline event re-publishes the activity.
 *
 * Disabled by default — Discord presence is opt-in because it requires
 * the user to register their own application snowflake.
 */
export function useDiscordPresence() {
  const { status } = useAuth();
  const sessionStartRef = useRef<number>(Math.floor(Date.now() / 1000));
  const lastWorldRef = useRef<string>("");

  useEffect(() => {
    const enabled = readUiPrefBoolean(PREF_ENABLED, false);
    const clientId = readUiPrefString(PREF_CLIENT_ID, "");
    if (!status.authed || !enabled || !clientId) {
      // If we previously published, scrub the panel so users don't see
      // a stale "in <last world>" after disabling.
      void ipc.discordClearActivity().catch(() => {});
      return;
    }

    const push = (state: string, details: string, partySize?: [number, number]) => {
      const activity: Record<string, unknown> = {
        state,
        details,
        timestamps: { start: sessionStartRef.current },
      };
      if (partySize) {
        activity.party = { id: lastWorldRef.current || "vrcsm", size: partySize };
      }
      activity.assets = {
        large_image: "vrcsm-logo",
        large_text: "VRCSM",
        small_image: "vrchat",
        small_text: "VRChat",
      };
      void ipc.discordSetActivity(activity, clientId).catch(() => {});
    };

    // Initial state — best effort, the location may show as "(loading)"
    // until the first pipeline event.
    push("Online", status.displayName ?? "VRChat", undefined);

    const unsubLoc = subscribePipelineEvent<UserLocationContent>(
      "user-location",
      (content) => {
        if (!content) return;
        const worldName = content.world?.name ?? content.location ?? "VRChat";
        lastWorldRef.current = content.location ?? "";
        const cap = content.world?.recommendedCapacity ?? content.world?.capacity ?? 0;
        // Reset the timer when world changes so the elapsed counter
        // reflects time-in-world rather than total session time.
        if (worldName !== lastWorldRef.current) {
          sessionStartRef.current = Math.floor(Date.now() / 1000);
        }
        push(`In ${worldName}`, content.location || "", cap > 0 ? [1, cap] : undefined);
      },
    );

    // Friend-location updates carry the world name too via the joined
    // user object — useful as a fallback.
    const unsubFriendLoc = subscribePipelineEvent<FriendLocationContent>(
      "friend-location",
      () => {/* no-op for self presence */},
    );

    return () => {
      unsubLoc();
      unsubFriendLoc();
    };
  }, [status.authed, status.displayName]);
}

export const DISCORD_PREF_ENABLED = PREF_ENABLED;
export const DISCORD_PREF_CLIENT_ID = PREF_CLIENT_ID;
