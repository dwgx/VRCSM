import { useEffect, useRef } from "react";
import { ipc } from "./ipc";
import { useAuth } from "./auth-context";
import { subscribePipelineEvent } from "./pipeline-events";
import { readUiPrefBoolean, readUiPrefString } from "./ui-prefs";
import { parseLocation, type InstanceType } from "./vrcFriends";

const PREF_ENABLED = "vrcsm.discord.enabled";
const PREF_CLIENT_ID = "vrcsm.discord.clientId";

interface UserLocationContent {
  userId?: string;
  location?: string;
  travelingToLocation?: string;
  world?: { name?: string; capacity?: number; recommendedCapacity?: number };
}

// L1 video-active: the live log stream classifies `[Video Playback]` lines
// into `videoPlay` events. We surface the current video in the Discord
// panel as a "watching" line. URLs are local log data (not other users'
// PII), so they are safe to show when presence is already enabled.
interface VideoPlayStreamEvent {
  url?: string;
}
interface ClassifiedStreamPayload {
  kind?: string;
  data?: unknown;
}

// Instance privacy buckets. Only genuinely public instances may expose
// instance details (party size, the raw location string). Everything
// else — friends, friends+, invite, invite+, group, group+ — is treated
// as private: we show the world name only and never leak the owner id
// (which is embedded in the raw `~private(usr_…)` location string) or a
// join secret.
const PUBLIC_INSTANCE_TYPES: ReadonlySet<InstanceType> = new Set<InstanceType>([
  "public",
  "group-public",
]);

function isPublicInstance(type: InstanceType | undefined): boolean {
  return type !== undefined && PUBLIC_INSTANCE_TYPES.has(type);
}

/**
 * Decide what may be exposed in the Discord panel for a raw VRChat
 * location string. Pure + exported so the privacy gate is unit-tested
 * without mounting the hook. Public instances expose the world name and
 * instance details; everything else (friends / invite / group / unknown)
 * is treated as private — world name only, no owner id, no party, no
 * join secret.
 */
export function discordPresenceVisibility(location: string | null): {
  showWorld: boolean;
  exposeInstanceDetails: boolean;
} {
  const info = parseLocation(location);
  if (info.kind !== "world") {
    return { showWorld: false, exposeInstanceDetails: false };
  }
  const pub = isPublicInstance(info.instanceType);
  return { showWorld: true, exposeInstanceDetails: pub };
}

/**
 * Drives Discord Rich Presence from the live VRChat session. Mounted
 * once at the app shell; pulls clientId + enable flag from local UI
 * prefs (Settings page surfaces them), then re-publishes the activity on
 * every `user-location` pipeline event and whenever the now-playing video
 * changes.
 *
 * Disabled by default — Discord presence is opt-in because it requires
 * the user to register their own application snowflake.
 *
 * PRIVACY: for any non-public instance (friends / invite / group …) we
 * publish the world name only. We never put the raw location string
 * (which embeds the instance owner's `usr_` id) into `details`, never set
 * a `party` derived from a private instance, and never send a join
 * secret. This is the default-hidden behaviour required by the spec.
 */
export function useDiscordPresence() {
  const { status } = useAuth();
  const sessionStartRef = useRef<number>(Math.floor(Date.now() / 1000));
  const lastWorldRef = useRef<string>("");
  // Current now-playing video URL (L1), or "" when nothing is playing.
  const videoRef = useRef<string>("");
  // Latest computed presence so the video subscription can re-publish
  // without re-deriving the world line.
  const lastActivityRef = useRef<Record<string, unknown> | null>(null);
  const clientIdRef = useRef<string>("");

  useEffect(() => {
    const enabled = readUiPrefBoolean(PREF_ENABLED, false);
    const clientId = readUiPrefString(PREF_CLIENT_ID, "");
    clientIdRef.current = clientId;
    if (!status.authed || !enabled || !clientId) {
      // If we previously published, scrub the panel so users don't see
      // a stale "in <last world>" after disabling.
      void ipc.discordClearActivity().catch(() => {});
      lastActivityRef.current = null;
      return;
    }

    // Build + push the activity, folding in the now-playing video as a
    // small "watching" overlay when present.
    const publish = (base: Record<string, unknown>) => {
      const activity: Record<string, unknown> = { ...base };
      const video = videoRef.current;
      if (video) {
        // Show the video host (never the full URL with query params) so
        // we don't leak tokens embedded in some stream URLs.
        let host = video;
        try {
          host = new URL(video).hostname.replace(/^www\./, "");
        } catch {
          host = video.slice(0, 48);
        }
        activity.assets = {
          ...(activity.assets as Record<string, unknown> | undefined),
          small_image: "video",
          small_text: `Watching · ${host}`,
        };
      }
      lastActivityRef.current = activity;
      void ipc.discordSetActivity(activity, clientIdRef.current).catch(() => {});
    };

    const buildWorldActivity = (content: UserLocationContent): Record<string, unknown> => {
      const info = parseLocation(content.location ?? null);
      const worldName = content.world?.name ?? "VRChat";
      const vis = discordPresenceVisibility(content.location ?? null);

      const activity: Record<string, unknown> = {
        timestamps: { start: sessionStartRef.current },
        assets: {
          large_image: "vrcsm-logo",
          large_text: "VRCSM",
        },
      };

      if (!vis.showWorld) {
        // Offline / private / traveling / unknown — no world to show.
        activity.state = "Online";
        activity.details = status.displayName ?? "VRChat";
        return activity;
      }

      activity.details = `In ${worldName}`;
      if (vis.exposeInstanceDetails) {
        // Public: safe to expose instance specifics.
        const cap =
          content.world?.recommendedCapacity ?? content.world?.capacity ?? 0;
        const region = info.region ? info.region.toUpperCase() : "";
        activity.state = region ? `Public · ${region}` : "Public";
        if (cap > 0 && info.instanceId) {
          activity.party = { id: info.instanceId, size: [1, cap] as [number, number] };
        }
      } else {
        // Private (friends / invite / group …) — hide instance details.
        // No party id (would leak the instance id), no owner, no secret.
        activity.state = "In a private instance";
      }
      return activity;
    };

    // Initial state — best effort, the location refines on the first
    // pipeline event.
    publish({
      state: "Online",
      details: status.displayName ?? "VRChat",
      timestamps: { start: sessionStartRef.current },
      assets: { large_image: "vrcsm-logo", large_text: "VRCSM" },
    });

    const unsubLoc = subscribePipelineEvent<UserLocationContent>(
      "user-location",
      (content) => {
        if (!content) return;
        if (content.userId && status.userId && content.userId !== status.userId) {
          return; // not our own location
        }
        const loc = content.location ?? "";
        // Reset the elapsed timer when the world changes so the counter
        // reflects time-in-world rather than total session time.
        if (loc !== lastWorldRef.current) {
          sessionStartRef.current = Math.floor(Date.now() / 1000);
          videoRef.current = ""; // a new world implies the old video is gone
          lastWorldRef.current = loc;
        }
        publish(buildWorldActivity(content));
      },
    );

    // L1 video-active: track the now-playing video from the classified
    // log stream and re-publish the existing world activity with the
    // "watching" overlay.
    const offVideo = ipc.on<ClassifiedStreamPayload>("logs.stream.event", (payload) => {
      if (!payload || typeof payload !== "object") return;
      if (payload.kind !== "videoPlay") return;
      const data = payload.data as VideoPlayStreamEvent | undefined;
      const url = data?.url ?? "";
      if (!url || url === videoRef.current) return;
      videoRef.current = url;
      if (lastActivityRef.current) {
        // Re-publish from the base world activity minus any prior video
        // overlay so we don't stack `small_*` text.
        const base = { ...lastActivityRef.current };
        delete (base.assets as Record<string, unknown> | undefined)?.small_image;
        publish(base);
      }
    });

    return () => {
      unsubLoc();
      offVideo();
    };
  }, [status.authed, status.displayName, status.userId]);
}

export const DISCORD_PREF_ENABLED = PREF_ENABLED;
export const DISCORD_PREF_CLIENT_ID = PREF_CLIENT_ID;
