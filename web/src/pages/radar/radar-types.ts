/**
 * Shared type definitions for the Radar page components.
 */

import type {
  PlayerEvent,
  AvatarSwitchEvent,
  WorldSwitchEvent,
  ScreenshotEvent,
} from "@/lib/types";

export interface ClassifiedStreamPayload {
  kind: "player" | "avatarSwitch" | "screenshot" | "worldSwitch";
  data: PlayerEvent | AvatarSwitchEvent | WorldSwitchEvent | ScreenshotEvent;
}

export interface RadarPlayer {
  displayName: string;
  userId: string | null;
  joinTime: string | null;
  avatarIdOrName: string | null;
  lastAvatarSwitchTime: string | null;
}

// ── Timeline event types ─────────────────────────────────────────────────
export interface TimelineEntry {
  id: string;
  time: string;
  kind: "joined" | "left" | "avatarSwitch" | "worldSwitch";
  actor: string;
  detail?: string;
}

export interface RecentSessionEvent {
  id: number;
  kind: string;
  display_name: string;
  user_id?: string | null;
  world_id?: string | null;
  occurred_at: string;
}

export type RadarTab = "live" | "analysis" | "history";

export interface ScanLogsResponse {
  world_switches: WorldSwitchEvent[];
  player_events: PlayerEvent[];
  avatar_switches: AvatarSwitchEvent[];
  world_names: Record<string, string>;
  local_user_name?: string | null;
}

export interface AnalysisSessionPlayer {
  displayName: string;
  userId: string | null;
  joinTime: string | null;
  leaveTime: string | null;
  avatarIdOrName: string | null;
}

export interface AnalysisSessionTimelineEntry {
  id: string;
  kind: "joined" | "left" | "avatarSwitch";
  time: string | null;
  actor: string;
  detail?: string;
  sortKey: number;
}

export interface AnalysisSession {
  id: string;
  worldId: string;
  worldName: string;
  instanceId: string;
  accessType: string;
  ownerId: string | null;
  region: string | null;
  startTime: string | null;
  startMs: number | null;
  endTime: string | null;
  endMs: number | null;
  players: AnalysisSessionPlayer[];
  peakConcurrent: number;
  avatarChanges: number;
  timeline: AnalysisSessionTimelineEntry[];
}
