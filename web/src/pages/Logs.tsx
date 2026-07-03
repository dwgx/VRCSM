import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { UserPopupBadge } from "@/components/UserPopupBadge";
import { ipc } from "@/lib/ipc";
import { useReport } from "@/lib/report-context";
import type {
  AppQuitEvent,
  AttributedVideoEvent,
  AudioDeviceEvent,
  AvatarPedestalEvent,
  AvatarSwitchEvent,
  InstanceResetEvent,
  JoinBlockedEvent,
  LogEnvironment,
  LogSettingsSection,
  NotificationEvent,
  OscFailEvent,
  PlayerEvent,
  PortalSpawnEvent,
  ScreenshotEvent,
  SessionModeEvent,
  ShaderKeywordEvent,
  StickerSpawnEvent,
  UdonExceptionEvent,
  VideoErrorEvent,
  VideoPlayEvent,
  VideoSyncEvent,
  VoteKickEvent,
  WorldSwitchEvent,
} from "@/lib/types";
import {
  AlertTriangle,
  Ban,
  Bell,
  Camera,
  ChevronDown,
  ChevronUp,
  DoorOpen,
  Gavel,
  Globe2,
  Headset,
  Loader2,
  LogOut,
  PlayCircle,
  Search,
  Shirt,
  Smile,
  TerminalSquare,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENV_ORDER: Array<keyof LogEnvironment> = [
  "vrchat_build",
  "store",
  "platform",
  "device_model",
  "processor",
  "system_memory",
  "operating_system",
  "gpu_name",
  "gpu_api",
  "gpu_memory",
  "xr_device",
];

/** Compact env keys shown as badges in the collapsed bar. */
const ENV_HIGHLIGHT_KEYS: Array<keyof LogEnvironment> = [
  "gpu_name",
  "processor",
  "system_memory",
  "xr_device",
];

function shortId(id: string): string {
  const clean = id.replace(/^(wrld|avtr)_/, "");
  if (clean.length <= 14) return clean;
  return `${clean.slice(0, 8)}...${clean.slice(-4)}`;
}

function formatIsoTime(iso: string | null): string {
  if (!iso) return "\u2014";
  const m = iso.match(/^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}`;
}

function formatTimeOnly(iso: string | null): string {
  if (!iso) return "\u2014";
  const m = iso.match(/^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!m) return iso;
  return m[4];
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** Parse a VRChat-style timestamp into a sortable numeric key. */
function isoToSortKey(iso: string | null): number {
  if (!iso) return 0;
  const m = iso.match(
    /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!m) return 0;
  return (
    Number(m[1]) * 1e10 +
    Number(m[2]) * 1e8 +
    Number(m[3]) * 1e6 +
    Number(m[4]) * 1e4 +
    Number(m[5]) * 1e2 +
    Number(m[6])
  );
}

// ---------------------------------------------------------------------------
// Unified timeline event
// ---------------------------------------------------------------------------

type TimelineEventKind =
  | "player_join"
  | "player_left"
  | "avatar_switch"
  | "screenshot"
  | "video_play"
  | "portal_spawn"
  | "vote_kick"
  | "join_blocked"
  | "sticker_spawn"
  | "world_switch"
  | "notification"
  | "video_error"
  | "attributed_video"
  | "video_sync"
  | "avatar_pedestal"
  | "vrc_quit"
  | "session_mode"
  | "osc_fail"
  | "udon_exception"
  | "instance_reset"
  | "shader_keyword"
  | "audio_device";

interface TimelineEvent {
  kind: TimelineEventKind;
  iso_time: string | null;
  sortKey: number;
  /** Primary display text. */
  title: string;
  /** Secondary detail line. */
  detail?: string;
  /** Extra metadata for tooltips. */
  meta?: string;
}

function playerToTimeline(ev: PlayerEvent): TimelineEvent {
  return {
    kind: ev.kind === "joined" ? "player_join" : "player_left",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: ev.display_name,
    detail: ev.user_id ? shortId(ev.user_id.replace(/^usr_/, "")) : undefined,
    meta: ev.user_id ?? undefined,
  };
}

function avatarToTimeline(ev: AvatarSwitchEvent): TimelineEvent {
  return {
    kind: "avatar_switch",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: ev.avatar_name,
    detail: ev.actor,
  };
}

function screenshotToTimeline(ev: ScreenshotEvent): TimelineEvent {
  return {
    kind: "screenshot",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: basename(ev.path),
    meta: ev.path,
  };
}

function videoPlayToTimeline(ev: VideoPlayEvent): TimelineEvent {
  return {
    kind: "video_play",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: ev.url,
    meta: ev.url,
  };
}

function portalSpawnToTimeline(ev: PortalSpawnEvent): TimelineEvent {
  return {
    kind: "portal_spawn",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: "Portal dropped",
  };
}

function voteKickToTimeline(ev: VoteKickEvent): TimelineEvent {
  const title =
    ev.phase === "self"
      ? ev.message ?? "You were kicked"
      : ev.target ?? "Unknown player";
  const detail =
    ev.phase === "initiated"
      ? "Vote started"
      : ev.phase === "succeeded"
        ? "Vote passed"
        : undefined;
  return {
    kind: "vote_kick",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title,
    detail,
  };
}

function joinBlockedToTimeline(ev: JoinBlockedEvent): TimelineEvent {
  const title =
    ev.reason_kind === "blocked"
      ? "Join blocked (master timeout)"
      : ev.reason ?? "Failed to join instance";
  return {
    kind: "join_blocked",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title,
    detail: ev.location ?? undefined,
  };
}

function stickerSpawnToTimeline(ev: StickerSpawnEvent): TimelineEvent {
  return {
    kind: "sticker_spawn",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: ev.display_name,
    detail: "Spawned a sticker",
    meta: ev.user_id,
  };
}

function worldToTimeline(ev: WorldSwitchEvent): TimelineEvent {
  return {
    kind: "world_switch",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: ev.world_id,
    detail: ev.access_type + (ev.region ? ` \u00B7 ${ev.region.toUpperCase()}` : ""),
    meta: ev.instance_id,
  };
}

// \u2500\u2500 Wave 2 Section A timeline mappers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function notificationToTimeline(ev: NotificationEvent): TimelineEvent {
  return {
    kind: "notification",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: ev.sender_name || ev.sender_id,
    detail: ev.type,
    meta: ev.sender_id,
  };
}

function videoErrorToTimeline(ev: VideoErrorEvent): TimelineEvent {
  return {
    kind: "video_error",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: "Video error",
    detail: ev.error_message,
  };
}

function attributedVideoToTimeline(ev: AttributedVideoEvent): TimelineEvent {
  return {
    kind: "attributed_video",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: ev.requester ?? ev.url,
    detail: ev.url,
    meta: ev.url,
  };
}

function videoSyncToTimeline(ev: VideoSyncEvent): TimelineEvent {
  return {
    kind: "video_sync",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: "Video synced",
    detail: ev.url,
    meta: ev.url,
  };
}

function avatarPedestalToTimeline(ev: AvatarPedestalEvent): TimelineEvent {
  return {
    kind: "avatar_pedestal",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: ev.display_name,
    detail: "Avatar from pedestal",
    meta: ev.user_id ?? undefined,
  };
}

function appQuitToTimeline(ev: AppQuitEvent): TimelineEvent {
  return {
    kind: "vrc_quit",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: "VRChat closed",
    detail: ev.uptime_seconds ? `Uptime ${ev.uptime_seconds}s` : undefined,
  };
}

function sessionModeToTimeline(ev: SessionModeEvent): TimelineEvent {
  return {
    kind: "session_mode",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: ev.mode === "vr" ? "VR session" : "Desktop session",
    detail: ev.hmd_model ?? undefined,
  };
}

function oscFailToTimeline(ev: OscFailEvent): TimelineEvent {
  return {
    kind: "osc_fail",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: "OSC failed to start",
    detail: ev.reason,
  };
}

function udonExceptionToTimeline(ev: UdonExceptionEvent): TimelineEvent {
  return {
    kind: "udon_exception",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: "Udon exception",
    detail: ev.message,
  };
}

function instanceResetToTimeline(ev: InstanceResetEvent): TimelineEvent {
  return {
    kind: "instance_reset",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: "Instance reset scheduled",
    detail: `In ${ev.minutes} minutes`,
  };
}

function shaderKeywordToTimeline(ev: ShaderKeywordEvent): TimelineEvent {
  return {
    kind: "shader_keyword",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: "Shader keyword limit",
    detail: "Maximum global keywords exceeded",
  };
}

function audioDeviceToTimeline(ev: AudioDeviceEvent): TimelineEvent {
  return {
    kind: "audio_device",
    iso_time: ev.iso_time,
    sortKey: isoToSortKey(ev.iso_time),
    title: "Input device changed",
    detail: ev.device_name,
  };
}

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const KIND_STYLES: Record<
  TimelineEventKind,
  {
    border: string;
    iconBg: string;
    iconColor: string;
    icon: typeof Users;
    label: string;
  }
> = {
  player_join: {
    border: "border-l-emerald-500",
    iconBg: "bg-emerald-500/15",
    iconColor: "text-emerald-400",
    icon: Users,
    label: "Joined",
  },
  player_left: {
    border: "border-l-red-500",
    iconBg: "bg-red-500/15",
    iconColor: "text-red-400",
    icon: Users,
    label: "Left",
  },
  avatar_switch: {
    border: "border-l-violet-500",
    iconBg: "bg-violet-500/15",
    iconColor: "text-violet-400",
    icon: Shirt,
    label: "Avatar",
  },
  screenshot: {
    border: "border-l-amber-500",
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-400",
    icon: Camera,
    label: "Screenshot",
  },
  video_play: {
    border: "border-l-pink-500",
    iconBg: "bg-pink-500/15",
    iconColor: "text-pink-400",
    icon: PlayCircle,
    label: "Video",
  },
  portal_spawn: {
    border: "border-l-cyan-500",
    iconBg: "bg-cyan-500/15",
    iconColor: "text-cyan-400",
    icon: DoorOpen,
    label: "Portal",
  },
  vote_kick: {
    border: "border-l-orange-500",
    iconBg: "bg-orange-500/15",
    iconColor: "text-orange-400",
    icon: Gavel,
    label: "Vote kick",
  },
  join_blocked: {
    border: "border-l-rose-500",
    iconBg: "bg-rose-500/15",
    iconColor: "text-rose-400",
    icon: Ban,
    label: "Join blocked",
  },
  sticker_spawn: {
    border: "border-l-teal-500",
    iconBg: "bg-teal-500/15",
    iconColor: "text-teal-400",
    icon: Smile,
    label: "Sticker",
  },
  world_switch: {
    border: "border-l-blue-500",
    iconBg: "bg-blue-500/15",
    iconColor: "text-blue-400",
    icon: Globe2,
    label: "World",
  },
  notification: {
    border: "border-l-sky-500",
    iconBg: "bg-sky-500/15",
    iconColor: "text-sky-400",
    icon: Bell,
    label: "Notification",
  },
  video_error: {
    border: "border-l-rose-500",
    iconBg: "bg-rose-500/15",
    iconColor: "text-rose-400",
    icon: AlertTriangle,
    label: "Video error",
  },
  attributed_video: {
    border: "border-l-pink-500",
    iconBg: "bg-pink-500/15",
    iconColor: "text-pink-400",
    icon: PlayCircle,
    label: "Video",
  },
  video_sync: {
    border: "border-l-pink-500",
    iconBg: "bg-pink-500/15",
    iconColor: "text-pink-400",
    icon: PlayCircle,
    label: "Video sync",
  },
  avatar_pedestal: {
    border: "border-l-violet-500",
    iconBg: "bg-violet-500/15",
    iconColor: "text-violet-400",
    icon: Shirt,
    label: "Pedestal",
  },
  vrc_quit: {
    border: "border-l-zinc-500",
    iconBg: "bg-zinc-500/15",
    iconColor: "text-zinc-400",
    icon: LogOut,
    label: "Quit",
  },
  session_mode: {
    border: "border-l-indigo-500",
    iconBg: "bg-indigo-500/15",
    iconColor: "text-indigo-400",
    icon: Headset,
    label: "Session",
  },
  osc_fail: {
    border: "border-l-amber-500",
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-400",
    icon: TerminalSquare,
    label: "OSC",
  },
  udon_exception: {
    border: "border-l-amber-500",
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-400",
    icon: TerminalSquare,
    label: "Udon",
  },
  instance_reset: {
    border: "border-l-orange-500",
    iconBg: "bg-orange-500/15",
    iconColor: "text-orange-400",
    icon: AlertTriangle,
    label: "Instance reset",
  },
  shader_keyword: {
    border: "border-l-amber-500",
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-400",
    icon: TerminalSquare,
    label: "Shader",
  },
  audio_device: {
    border: "border-l-zinc-500",
    iconBg: "bg-zinc-500/15",
    iconColor: "text-zinc-400",
    icon: TerminalSquare,
    label: "Audio device",
  },
};

// ---------------------------------------------------------------------------
// Live streaming buffer cap
// ---------------------------------------------------------------------------

const LIVE_DELTA_CAP = 200;

interface ClassifiedStreamPayload {
  kind:
    | "player"
    | "avatarSwitch"
    | "screenshot"
    | "videoPlay"
    | "portalSpawn"
    | "voteKick"
    | "joinBlocked"
    | "stickerSpawn"
    | "notification"
    | "videoError"
    | "attributedVideoPlay"
    | "videoSync"
    | "avatarPedestal"
    | "vrcQuit"
    | "sessionMode"
    | "oscFail"
    | "udonException"
    | "instanceReset"
    | "shaderKeyword"
    | "audioDevice";
  data:
    | PlayerEvent
    | AvatarSwitchEvent
    | ScreenshotEvent
    | VideoPlayEvent
    | PortalSpawnEvent
    | VoteKickEvent
    | JoinBlockedEvent
    | StickerSpawnEvent
    | NotificationEvent
    | VideoErrorEvent
    | AttributedVideoEvent
    | VideoSyncEvent
    | AvatarPedestalEvent
    | AppQuitEvent
    | SessionModeEvent
    | OscFailEvent
    | UdonExceptionEvent
    | InstanceResetEvent
    | ShaderKeywordEvent
    | AudioDeviceEvent;
}

// ---------------------------------------------------------------------------
// Filter toggles
// ---------------------------------------------------------------------------

type FilterKey =
  | "players"
  | "avatars"
  | "screenshots"
  | "videos"
  | "portals"
  | "moderation"
  | "stickers"
  | "worlds"
  | "notifications"
  | "session"
  | "diagnostic";

const FILTER_KEYS: FilterKey[] = [
  "players",
  "avatars",
  "screenshots",
  "videos",
  "portals",
  "moderation",
  "stickers",
  "worlds",
  "notifications",
  "session",
  "diagnostic",
];

const FILTER_LABELS: Record<FilterKey, string> = {
  players: "Players",
  avatars: "Avatars",
  screenshots: "Screenshots",
  videos: "Videos",
  portals: "Portals",
  moderation: "Moderation",
  stickers: "Stickers",
  worlds: "Worlds",
  notifications: "Notifications",
  session: "Session",
  diagnostic: "Diagnostics",
};

const FILTER_COLORS: Record<FilterKey, string> = {
  players: "bg-emerald-500",
  avatars: "bg-violet-500",
  screenshots: "bg-amber-500",
  videos: "bg-pink-500",
  portals: "bg-cyan-500",
  moderation: "bg-orange-500",
  stickers: "bg-teal-500",
  worlds: "bg-blue-500",
  notifications: "bg-sky-500",
  session: "bg-indigo-500",
  diagnostic: "bg-amber-400",
};

function matchesFilter(kind: TimelineEventKind, filters: Record<FilterKey, boolean>): boolean {
  if (kind === "player_join" || kind === "player_left") return filters.players;
  if (kind === "avatar_switch" || kind === "avatar_pedestal") return filters.avatars;
  if (kind === "screenshot") return filters.screenshots;
  if (kind === "video_play" || kind === "video_error"
    || kind === "attributed_video" || kind === "video_sync")
    return filters.videos;
  if (kind === "portal_spawn") return filters.portals;
  if (kind === "vote_kick" || kind === "join_blocked" || kind === "instance_reset")
    return filters.moderation;
  if (kind === "sticker_spawn") return filters.stickers;
  if (kind === "world_switch") return filters.worlds;
  if (kind === "notification") return filters.notifications;
  if (kind === "vrc_quit" || kind === "session_mode") return filters.session;
  if (kind === "osc_fail" || kind === "udon_exception"
    || kind === "shader_keyword" || kind === "audio_device")
    return filters.diagnostic;
  return true;
}

// ---------------------------------------------------------------------------
// Page size for virtual scroll
// ---------------------------------------------------------------------------

const PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function Logs() {
  const { t } = useTranslation();
  const { report, loading, error, refresh } = useReport();
  const logs = report?.logs ?? null;

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 150);

  const [envExpanded, setEnvExpanded] = useState(false);
  const [settingsFilter, setSettingsFilter] = useState("");
  const debouncedSettingsFilter = useDebouncedValue(settingsFilter, 150);

  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({
    players: true,
    avatars: true,
    screenshots: true,
    videos: true,
    portals: true,
    moderation: true,
    stickers: true,
    worlds: true,
    notifications: true,
    session: true,
    // Diagnostics (A7/A8) are noisy — default OFF so they stay opt-in.
    diagnostic: false,
  });

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [clearingLogFiles, setClearingLogFiles] = useState(false);
  const [clearLogFilesOpen, setClearLogFilesOpen] = useState(false);

  const envLabels: Record<keyof LogEnvironment, string> = useMemo(() => ({
    vrchat_build: t("logs.envLabel.vrchatBuild", { defaultValue: "VRChat Build" }),
    store: t("logs.envLabel.store", { defaultValue: "Store" }),
    platform: t("logs.envLabel.platform", { defaultValue: "Platform" }),
    device_model: t("logs.envLabel.deviceModel", { defaultValue: "Device Model" }),
    processor: t("logs.envLabel.processor", { defaultValue: "Processor" }),
    system_memory: t("logs.envLabel.systemMemory", { defaultValue: "System Memory" }),
    operating_system: t("logs.envLabel.operatingSystem", { defaultValue: "Operating System" }),
    gpu_name: t("logs.envLabel.gpu", { defaultValue: "GPU" }),
    gpu_api: t("logs.envLabel.graphicsApi", { defaultValue: "Graphics API" }),
    gpu_memory: t("logs.envLabel.gpuMemory", { defaultValue: "GPU Memory" }),
    xr_device: t("logs.envLabel.xrDevice", { defaultValue: "XR Device" }),
  }), [t]);

  const toggleFilter = useCallback((key: FilterKey) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
    setVisibleCount(PAGE_SIZE);
  }, []);

  // -- Live streaming deltas ------------------------------------------------

  const [livePlayer, setLivePlayer] = useState<PlayerEvent[]>([]);
  const [liveSwitch, setLiveSwitch] = useState<AvatarSwitchEvent[]>([]);
  const [liveScreenshot, setLiveScreenshot] = useState<ScreenshotEvent[]>([]);
  const [liveVideo, setLiveVideo] = useState<VideoPlayEvent[]>([]);
  const [livePortal, setLivePortal] = useState<PortalSpawnEvent[]>([]);
  const [liveVoteKick, setLiveVoteKick] = useState<VoteKickEvent[]>([]);
  const [liveJoinBlocked, setLiveJoinBlocked] = useState<JoinBlockedEvent[]>([]);
  const [liveSticker, setLiveSticker] = useState<StickerSpawnEvent[]>([]);
  const [liveNotification, setLiveNotification] = useState<NotificationEvent[]>([]);
  const [liveVideoError, setLiveVideoError] = useState<VideoErrorEvent[]>([]);
  const [liveAttributedVideo, setLiveAttributedVideo] = useState<AttributedVideoEvent[]>([]);
  const [liveVideoSync, setLiveVideoSync] = useState<VideoSyncEvent[]>([]);
  const [liveAvatarPedestal, setLiveAvatarPedestal] = useState<AvatarPedestalEvent[]>([]);
  const [liveAppQuit, setLiveAppQuit] = useState<AppQuitEvent[]>([]);
  const [liveSessionMode, setLiveSessionMode] = useState<SessionModeEvent[]>([]);
  const [liveOscFail, setLiveOscFail] = useState<OscFailEvent[]>([]);
  const [liveUdonException, setLiveUdonException] = useState<UdonExceptionEvent[]>([]);
  const [liveInstanceReset, setLiveInstanceReset] = useState<InstanceResetEvent[]>([]);
  const [liveShaderKeyword, setLiveShaderKeyword] = useState<ShaderKeywordEvent[]>([]);
  const [liveAudioDevice, setLiveAudioDevice] = useState<AudioDeviceEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const pendingRef = useRef<{
    player: PlayerEvent[];
    switches: AvatarSwitchEvent[];
    screenshots: ScreenshotEvent[];
    videos: VideoPlayEvent[];
    portals: PortalSpawnEvent[];
    voteKicks: VoteKickEvent[];
    joinBlocked: JoinBlockedEvent[];
    stickers: StickerSpawnEvent[];
    notifications: NotificationEvent[];
    videoErrors: VideoErrorEvent[];
    attributedVideos: AttributedVideoEvent[];
    videoSyncs: VideoSyncEvent[];
    avatarPedestals: AvatarPedestalEvent[];
    appQuits: AppQuitEvent[];
    sessionModes: SessionModeEvent[];
    oscFails: OscFailEvent[];
    udonExceptions: UdonExceptionEvent[];
    instanceResets: InstanceResetEvent[];
    shaderKeywords: ShaderKeywordEvent[];
    audioDevices: AudioDeviceEvent[];
  }>({
    player: [],
    switches: [],
    screenshots: [],
    videos: [],
    portals: [],
    voteKicks: [],
    joinBlocked: [],
    stickers: [],
    notifications: [],
    videoErrors: [],
    attributedVideos: [],
    videoSyncs: [],
    avatarPedestals: [],
    appQuits: [],
    sessionModes: [],
    oscFails: [],
    udonExceptions: [],
    instanceResets: [],
    shaderKeywords: [],
    audioDevices: [],
  });
  const flushTimerRef = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    flushTimerRef.current = null;
    const buf = pendingRef.current;
    // Generic drain: move a pending bucket into its capped live-state array.
    const drain = <T,>(
      bucket: T[],
      clear: () => void,
      setLive: Dispatch<SetStateAction<T[]>>,
    ) => {
      if (bucket.length === 0) return;
      const incoming = bucket;
      clear();
      setLive((prev) => {
        const merged = prev.concat(incoming);
        return merged.length > LIVE_DELTA_CAP
          ? merged.slice(merged.length - LIVE_DELTA_CAP)
          : merged;
      });
    };
    drain(buf.player, () => (buf.player = []), setLivePlayer);
    drain(buf.switches, () => (buf.switches = []), setLiveSwitch);
    drain(buf.screenshots, () => (buf.screenshots = []), setLiveScreenshot);
    drain(buf.videos, () => (buf.videos = []), setLiveVideo);
    drain(buf.portals, () => (buf.portals = []), setLivePortal);
    drain(buf.voteKicks, () => (buf.voteKicks = []), setLiveVoteKick);
    drain(buf.joinBlocked, () => (buf.joinBlocked = []), setLiveJoinBlocked);
    drain(buf.stickers, () => (buf.stickers = []), setLiveSticker);
    drain(buf.notifications, () => (buf.notifications = []), setLiveNotification);
    drain(buf.videoErrors, () => (buf.videoErrors = []), setLiveVideoError);
    drain(buf.attributedVideos, () => (buf.attributedVideos = []), setLiveAttributedVideo);
    drain(buf.videoSyncs, () => (buf.videoSyncs = []), setLiveVideoSync);
    drain(buf.avatarPedestals, () => (buf.avatarPedestals = []), setLiveAvatarPedestal);
    drain(buf.appQuits, () => (buf.appQuits = []), setLiveAppQuit);
    drain(buf.sessionModes, () => (buf.sessionModes = []), setLiveSessionMode);
    drain(buf.oscFails, () => (buf.oscFails = []), setLiveOscFail);
    drain(buf.udonExceptions, () => (buf.udonExceptions = []), setLiveUdonException);
    drain(buf.instanceResets, () => (buf.instanceResets = []), setLiveInstanceReset);
    drain(buf.shaderKeywords, () => (buf.shaderKeywords = []), setLiveShaderKeyword);
    drain(buf.audioDevices, () => (buf.audioDevices = []), setLiveAudioDevice);
    setIsStreaming(true);
  }, []);

  useEffect(() => {
    void ipc.call("logs.stream.start").catch(() => undefined);

    const scheduleFlush = () => {
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = window.setTimeout(flushPending, 100);
    };

    const off = ipc.on<ClassifiedStreamPayload>("logs.stream.event", (payload) => {
      if (!payload || typeof payload !== "object") return;
      const buf = pendingRef.current;
      if (payload.kind === "player") {
        buf.player.push(payload.data as PlayerEvent);
      } else if (payload.kind === "avatarSwitch") {
        buf.switches.push(payload.data as AvatarSwitchEvent);
      } else if (payload.kind === "screenshot") {
        buf.screenshots.push(payload.data as ScreenshotEvent);
      } else if (payload.kind === "videoPlay") {
        buf.videos.push(payload.data as VideoPlayEvent);
      } else if (payload.kind === "portalSpawn") {
        buf.portals.push(payload.data as PortalSpawnEvent);
      } else if (payload.kind === "voteKick") {
        buf.voteKicks.push(payload.data as VoteKickEvent);
      } else if (payload.kind === "joinBlocked") {
        buf.joinBlocked.push(payload.data as JoinBlockedEvent);
      } else if (payload.kind === "stickerSpawn") {
        buf.stickers.push(payload.data as StickerSpawnEvent);
      } else if (payload.kind === "notification") {
        buf.notifications.push(payload.data as NotificationEvent);
      } else if (payload.kind === "videoError") {
        buf.videoErrors.push(payload.data as VideoErrorEvent);
      } else if (payload.kind === "attributedVideoPlay") {
        buf.attributedVideos.push(payload.data as AttributedVideoEvent);
      } else if (payload.kind === "videoSync") {
        buf.videoSyncs.push(payload.data as VideoSyncEvent);
      } else if (payload.kind === "avatarPedestal") {
        buf.avatarPedestals.push(payload.data as AvatarPedestalEvent);
      } else if (payload.kind === "vrcQuit") {
        buf.appQuits.push(payload.data as AppQuitEvent);
      } else if (payload.kind === "sessionMode") {
        buf.sessionModes.push(payload.data as SessionModeEvent);
      } else if (payload.kind === "oscFail") {
        buf.oscFails.push(payload.data as OscFailEvent);
      } else if (payload.kind === "udonException") {
        buf.udonExceptions.push(payload.data as UdonExceptionEvent);
      } else if (payload.kind === "instanceReset") {
        buf.instanceResets.push(payload.data as InstanceResetEvent);
      } else if (payload.kind === "shaderKeyword") {
        buf.shaderKeywords.push(payload.data as ShaderKeywordEvent);
      } else if (payload.kind === "audioDevice") {
        buf.audioDevices.push(payload.data as AudioDeviceEvent);
      } else {
        return;
      }
      scheduleFlush();
    });
    return () => {
      off();
      // Drop our refcount on the shared log tailer so navigating away from
      // this page tears it down only when no other subscriber (e.g. radar)
      // is also using it.
      void ipc.call("logs.stream.stop").catch(() => undefined);
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [flushPending]);

  // -- Unified timeline -----------------------------------------------------

  const worldNames = logs?.world_names ?? {};

  // Stable historical timeline — only rebuilds when the parsed log report or
  // world-name lookup changes. The previous implementation sorted the entire
  // history + live deltas on every flush, making live tail cost O(N log N)
  // against the full session length.
  const historicalTimeline = useMemo<TimelineEvent[]>(() => {
    if (!logs) return [];
    const events: TimelineEvent[] = [];
    for (const ev of logs.player_events) events.push(playerToTimeline(ev));
    for (const ev of logs.avatar_switches) events.push(avatarToTimeline(ev));
    for (const ev of logs.screenshots) events.push(screenshotToTimeline(ev));
    for (const ev of logs.video_plays ?? []) events.push(videoPlayToTimeline(ev));
    for (const ev of logs.portal_spawns ?? []) events.push(portalSpawnToTimeline(ev));
    for (const ev of logs.vote_kicks ?? []) events.push(voteKickToTimeline(ev));
    for (const ev of logs.join_blocked ?? []) events.push(joinBlockedToTimeline(ev));
    for (const ev of logs.sticker_spawns ?? []) events.push(stickerSpawnToTimeline(ev));
    for (const ev of logs.notifications ?? []) events.push(notificationToTimeline(ev));
    for (const ev of logs.video_errors ?? []) events.push(videoErrorToTimeline(ev));
    for (const ev of logs.attributed_video_plays ?? []) events.push(attributedVideoToTimeline(ev));
    for (const ev of logs.video_syncs ?? []) events.push(videoSyncToTimeline(ev));
    for (const ev of logs.avatar_pedestals ?? []) events.push(avatarPedestalToTimeline(ev));
    for (const ev of logs.app_quits ?? []) events.push(appQuitToTimeline(ev));
    for (const ev of logs.session_modes ?? []) events.push(sessionModeToTimeline(ev));
    for (const ev of logs.osc_fails ?? []) events.push(oscFailToTimeline(ev));
    for (const ev of logs.udon_exceptions ?? []) events.push(udonExceptionToTimeline(ev));
    for (const ev of logs.instance_resets ?? []) events.push(instanceResetToTimeline(ev));
    for (const ev of logs.shader_keywords ?? []) events.push(shaderKeywordToTimeline(ev));
    for (const ev of logs.audio_devices ?? []) events.push(audioDeviceToTimeline(ev));
    for (const ev of logs.world_switches ?? []) {
      const te = worldToTimeline(ev);
      const name = worldNames[ev.world_id];
      if (name) te.title = name;
      events.push(te);
    }
    events.sort((a, b) => b.sortKey - a.sortKey);
    return events;
  }, [logs, worldNames]);

  // Live deltas projected to TimelineEvent. Tiny in size (current session),
  // sorted on its own so we don't disturb `historicalTimeline`.
  const liveTimeline = useMemo<TimelineEvent[]>(() => {
    const events: TimelineEvent[] = [];
    for (const ev of livePlayer) events.push(playerToTimeline(ev));
    for (const ev of liveSwitch) events.push(avatarToTimeline(ev));
    for (const ev of liveScreenshot) events.push(screenshotToTimeline(ev));
    for (const ev of liveVideo) events.push(videoPlayToTimeline(ev));
    for (const ev of livePortal) events.push(portalSpawnToTimeline(ev));
    for (const ev of liveVoteKick) events.push(voteKickToTimeline(ev));
    for (const ev of liveJoinBlocked) events.push(joinBlockedToTimeline(ev));
    for (const ev of liveSticker) events.push(stickerSpawnToTimeline(ev));
    for (const ev of liveNotification) events.push(notificationToTimeline(ev));
    for (const ev of liveVideoError) events.push(videoErrorToTimeline(ev));
    for (const ev of liveAttributedVideo) events.push(attributedVideoToTimeline(ev));
    for (const ev of liveVideoSync) events.push(videoSyncToTimeline(ev));
    for (const ev of liveAvatarPedestal) events.push(avatarPedestalToTimeline(ev));
    for (const ev of liveAppQuit) events.push(appQuitToTimeline(ev));
    for (const ev of liveSessionMode) events.push(sessionModeToTimeline(ev));
    for (const ev of liveOscFail) events.push(oscFailToTimeline(ev));
    for (const ev of liveUdonException) events.push(udonExceptionToTimeline(ev));
    for (const ev of liveInstanceReset) events.push(instanceResetToTimeline(ev));
    for (const ev of liveShaderKeyword) events.push(shaderKeywordToTimeline(ev));
    for (const ev of liveAudioDevice) events.push(audioDeviceToTimeline(ev));
    events.sort((a, b) => b.sortKey - a.sortKey);
    return events;
  }, [
    livePlayer,
    liveSwitch,
    liveScreenshot,
    liveVideo,
    livePortal,
    liveVoteKick,
    liveJoinBlocked,
    liveSticker,
    liveNotification,
    liveVideoError,
    liveAttributedVideo,
    liveVideoSync,
    liveAvatarPedestal,
    liveAppQuit,
    liveSessionMode,
    liveOscFail,
    liveUdonException,
    liveInstanceReset,
    liveShaderKeyword,
    liveAudioDevice,
  ]);

  // Merge: live (newest, at top) + historical (already sorted). Live size is
  // bounded by current session, historical by parsed log cap, so this is at
  // worst a single pass. We keep them merged with a single sort over both
  // arrays only because live events can land out-of-order across kinds.
  const timeline = useMemo<TimelineEvent[]>(() => {
    if (liveTimeline.length === 0) return historicalTimeline;
    if (historicalTimeline.length === 0) return liveTimeline;
    // Both are pre-sorted desc by sortKey — n-way merge.
    const out: TimelineEvent[] = new Array(liveTimeline.length + historicalTimeline.length);
    let i = 0, j = 0, k = 0;
    while (i < liveTimeline.length && j < historicalTimeline.length) {
      out[k++] = liveTimeline[i].sortKey >= historicalTimeline[j].sortKey
        ? liveTimeline[i++]
        : historicalTimeline[j++];
    }
    while (i < liveTimeline.length) out[k++] = liveTimeline[i++];
    while (j < historicalTimeline.length) out[k++] = historicalTimeline[j++];
    return out;
  }, [historicalTimeline, liveTimeline]);

  const filteredTimeline = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return timeline.filter((ev) => {
      if (!matchesFilter(ev.kind, filters)) return false;
      if (q) {
        const haystack = `${ev.title} ${ev.detail ?? ""} ${ev.meta ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [timeline, filters, debouncedSearch]);

  // -- Stats counts ---------------------------------------------------------

  const stats = useMemo(() => {
    const counts = {
      total: timeline.length,
      players: 0,
      avatars: 0,
      screenshots: 0,
      videos: 0,
      portals: 0,
      moderation: 0,
      stickers: 0,
      worlds: 0,
      notifications: 0,
      session: 0,
      diagnostic: 0,
    };
    for (const ev of timeline) {
      if (ev.kind === "player_join" || ev.kind === "player_left") counts.players++;
      else if (ev.kind === "avatar_switch" || ev.kind === "avatar_pedestal") counts.avatars++;
      else if (ev.kind === "screenshot") counts.screenshots++;
      else if (ev.kind === "video_play" || ev.kind === "video_error"
        || ev.kind === "attributed_video" || ev.kind === "video_sync") counts.videos++;
      else if (ev.kind === "portal_spawn") counts.portals++;
      else if (ev.kind === "vote_kick" || ev.kind === "join_blocked"
        || ev.kind === "instance_reset") counts.moderation++;
      else if (ev.kind === "sticker_spawn") counts.stickers++;
      else if (ev.kind === "world_switch") counts.worlds++;
      else if (ev.kind === "notification") counts.notifications++;
      else if (ev.kind === "vrc_quit" || ev.kind === "session_mode") counts.session++;
      else if (ev.kind === "osc_fail" || ev.kind === "udon_exception"
        || ev.kind === "shader_keyword" || ev.kind === "audio_device") counts.diagnostic++;
    }
    return counts;
  }, [timeline]);

  // -- Environment ----------------------------------------------------------

  const hasEnvironment = useMemo(() => {
    if (!logs) return false;
    return ENV_ORDER.some((key) => logs.environment[key] !== null);
  }, [logs]);

  // -- Settings sections filter ---------------------------------------------

  const filteredSections = useMemo<LogSettingsSection[]>(() => {
    if (!logs) return [];
    const q = debouncedSettingsFilter.trim().toLowerCase();
    if (!q) return logs.settings_sections;
    return logs.settings_sections
      .map((sec) => ({
        name: sec.name,
        entries: sec.entries.filter(
          ([k, v]) =>
            k.toLowerCase().includes(q) || v.toLowerCase().includes(q),
        ),
      }))
      .filter((sec) => sec.entries.length > 0);
  }, [logs, debouncedSettingsFilter]);

  // -- Scroll sentinel for "load more" -------------------------------------

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredTimeline.length));
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredTimeline.length]);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [debouncedSearch, filters]);

  const handleClearLogFiles = useCallback(async () => {
    setClearingLogFiles(true);
    try {
      const result = await ipc.logFilesClear();
      await refresh();

      const skippedMessage = result.skipped.length > 0
        ? t("logs.clearFilesSkippedActive", {
            count: result.skipped.length,
            defaultValue: " Kept {{count}} active log file because VRChat is running.",
          })
        : "";

      toast.success(
        t("logs.clearFilesSuccess", {
          count: result.deleted,
          defaultValue: "Deleted {{count}} log files.",
        }) + skippedMessage,
      );
    } catch (e) {
      toast.error(
        t("logs.clearFilesFailed", {
          error: e instanceof Error ? e.message : String(e),
          defaultValue: "Failed to clear log files: {{error}}",
        }),
      );
    } finally {
      setClearingLogFiles(false);
      setClearLogFilesOpen(false);
    }
  }, [refresh, t]);

  // -- Loading / error states -----------------------------------------------

  if (loading && !logs) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-[hsl(var(--muted-foreground))]">
          <Loader2 className="size-4 animate-spin" />
          <span>{t("logs.scanning")}</span>
        </CardContent>
      </Card>
    );
  }

  if (error || !logs) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("logs.failedRead")}</CardTitle>
          <CardDescription>{error ?? t("common.unknownError")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // =========================================================================
  // Render
  // =========================================================================

  const visibleEvents = filteredTimeline.slice(0, visibleCount);
  const hasMore = visibleCount < filteredTimeline.length;

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("logs.title")}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("logs.subtitle", { count: logs.log_count })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.3)] px-3 text-[11px] font-medium text-[hsl(var(--destructive))] transition-colors hover:bg-[hsl(var(--destructive)/0.08)]"
            disabled={clearingLogFiles}
            onClick={() => setClearLogFilesOpen(true)}
          >
            <Trash2 className={["size-3.5", clearingLogFiles ? "animate-pulse" : ""].join(" ")} />
            {t("logs.clearFiles", { defaultValue: "Clear Log Files" })}
          </button>
          {isStreaming ? (
            <div className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
              {t("common.live", { defaultValue: "Live" })}
            </div>
          ) : null}
          {logs.local_user_name ? (
            <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-1.5 text-[11px]">
              <UserRound className="size-3.5 text-[hsl(var(--primary))]" />
              <span className="font-medium text-[hsl(var(--foreground))]">
                {logs.local_user_name}
              </span>
              {logs.local_user_id ? (
                <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                  {shortId(logs.local_user_id.replace(/^usr_/, ""))}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {/* ── Stats Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="muted" className="font-mono text-[11px]">
          {t("logs.eventCount", { count: stats.total, defaultValue: "{{count}} events" })}
        </Badge>
        <Badge className="border-emerald-500/40 bg-emerald-500/12 text-emerald-400 text-[11px]">
          <Users className="size-3" />
          {stats.players}
        </Badge>
        <Badge className="border-violet-500/40 bg-violet-500/12 text-violet-400 text-[11px]">
          <Shirt className="size-3" />
          {stats.avatars}
        </Badge>
        <Badge className="border-amber-500/40 bg-amber-500/12 text-amber-400 text-[11px]">
          <Camera className="size-3" />
          {stats.screenshots}
        </Badge>
        <Badge className="border-pink-500/40 bg-pink-500/12 text-pink-400 text-[11px]">
          <PlayCircle className="size-3" />
          {stats.videos}
        </Badge>
        <Badge className="border-cyan-500/40 bg-cyan-500/12 text-cyan-400 text-[11px]">
          <DoorOpen className="size-3" />
          {stats.portals}
        </Badge>
        <Badge className="border-orange-500/40 bg-orange-500/12 text-orange-400 text-[11px]">
          <Gavel className="size-3" />
          {stats.moderation}
        </Badge>
        <Badge className="border-teal-500/40 bg-teal-500/12 text-teal-400 text-[11px]">
          <Smile className="size-3" />
          {stats.stickers}
        </Badge>
        <Badge className="border-blue-500/40 bg-blue-500/12 text-blue-400 text-[11px]">
          <Globe2 className="size-3" />
          {stats.worlds}
        </Badge>
      </div>

      {/* ── Environment Card (compact bar, expandable) ────────────── */}
      {hasEnvironment ? (
        <Card className="overflow-hidden">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[hsl(var(--surface-raised))]"
            onClick={() => setEnvExpanded((v) => !v)}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold text-[hsl(var(--foreground))]">
                {t("logs.environment")}
              </span>
              {!envExpanded
                ? ENV_HIGHLIGHT_KEYS.filter((key) => logs.environment[key] !== null).map(
                    (key) => (
                      <Badge
                        key={key}
                        variant="outline"
                        className="max-w-[200px] truncate text-[10px] font-mono"
                      >
                        {logs.environment[key]}
                      </Badge>
                    ),
                  )
                : null}
            </div>
            {envExpanded ? (
              <ChevronUp className="size-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
            ) : (
              <ChevronDown className="size-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
            )}
          </button>
          {envExpanded ? (
            <CardContent className="border-t border-[hsl(var(--border))] pt-3 pb-3">
              <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {ENV_ORDER.filter((key) => logs.environment[key] !== null).map(
                  (key) => (
                    <div
                      key={key}
                      className="flex items-baseline justify-between gap-3 border-b border-dashed border-[hsl(var(--border))] py-1 last:border-b-0"
                    >
                      <span className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                        {envLabels[key]}
                      </span>
                      <span className="truncate text-right font-mono text-[11px] text-[hsl(var(--foreground))]">
                        {logs.environment[key]}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {/* ── Filters + Search ──────────────────────────────────────── */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("logs.filterEvents", { defaultValue: "Filter by name..." })}
                className="h-8 pl-8 text-[12px]"
              />
            </div>

            {/* Filter toggles */}
            <div className="flex items-center gap-1.5">
              {FILTER_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleFilter(key)}
                  className={[
                    "flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1 text-[11px] font-medium transition-all",
                    filters[key]
                      ? "border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] text-[hsl(var(--foreground))]"
                      : "border-transparent bg-transparent text-[hsl(var(--muted-foreground))] opacity-50 hover:opacity-75",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "size-2 rounded-full transition-opacity",
                      FILTER_COLORS[key],
                      filters[key] ? "opacity-100" : "opacity-30",
                    ].join(" ")}
                  />
                  {FILTER_LABELS[key]}
                </button>
              ))}
            </div>

            {/* Filtered count */}
            <span className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono">
              {filteredTimeline.length}
              {filteredTimeline.length !== timeline.length
                ? ` / ${timeline.length}`
                : ""}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Unified Timeline ──────────────────────────────────────── */}
      <Card>
        <CardContent className="py-3">
          {filteredTimeline.length === 0 ? (
            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-8 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("logs.noPlayerEvents", { defaultValue: "No events match the current filters." })}
            </div>
          ) : (
            <div className="relative flex flex-col">
              {/* Vertical timeline line */}
              <div className="absolute left-[59px] top-0 bottom-0 w-px bg-[hsl(var(--border))]" />

              {visibleEvents.map((ev, i) => {
                const style = KIND_STYLES[ev.kind];
                const Icon = style.icon;
                const isJoin = ev.kind === "player_join";
                const isLeft = ev.kind === "player_left";

                return (
                  <div
                    key={`${ev.kind}-${i}-${ev.sortKey}`}
                    className={[
                      "group relative flex items-start gap-3 py-1.5 pl-0 pr-2",
                      "transition-colors hover:bg-[hsl(var(--surface-raised))]",
                      "rounded-[var(--radius-sm)]",
                    ].join(" ")}
                  >
                    {/* Timestamp */}
                    <span className="w-[50px] shrink-0 pt-1 text-right font-mono text-[10px] leading-tight text-[hsl(var(--muted-foreground))]">
                      {formatTimeOnly(ev.iso_time)}
                    </span>

                    {/* Timeline dot */}
                    <div className={[
                      "relative z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                      style.iconBg,
                    ].join(" ")}>
                      <Icon className={["size-3", style.iconColor].join(" ")} />
                    </div>

                    {/* Event card */}
                    <div
                      className={[
                        "min-w-0 flex-1 rounded-[var(--radius-sm)] border-l-2 px-3 py-1.5",
                        style.border,
                        "bg-[hsl(var(--canvas))] border border-[hsl(var(--border))]",
                      ].join(" ")}
                      title={ev.meta ?? undefined}
                    >
                      <div className="flex items-center gap-2">
                        {ev.meta?.startsWith("usr_") ? (
                          <UserPopupBadge userId={ev.meta} displayName={ev.title} />
                        ) : (
                          <span
                            className={[
                              "truncate text-[12px] font-medium",
                              isLeft
                                ? "text-[hsl(var(--muted-foreground))]"
                                : "text-[hsl(var(--foreground))]",
                            ].join(" ")}
                          >
                            {ev.title}
                          </span>
                        )}

                        {/* Action verb badge */}
                        {isJoin ? (
                          <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[9px] px-1.5 py-0">
                            {t("logs.joined", { defaultValue: "joined" })}
                          </Badge>
                        ) : isLeft ? (
                          <Badge className="border-red-500/30 bg-red-500/10 text-red-400 text-[9px] px-1.5 py-0">
                            {t("logs.left", { defaultValue: "left" })}
                          </Badge>
                        ) : ev.kind === "world_switch" && ev.detail ? (
                          <Badge className="border-blue-500/30 bg-blue-500/10 text-blue-400 text-[9px] px-1.5 py-0">
                            {ev.detail}
                          </Badge>
                        ) : null}

                        {/* Full timestamp on hover */}
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-[hsl(var(--muted-foreground))] opacity-0 transition-opacity group-hover:opacity-100">
                          {formatIsoTime(ev.iso_time)}
                        </span>
                      </div>

                      {/* Detail subtext. Player IDs render mono; everything else
                          (avatar name, vote outcome, join location, sticker note)
                          uses the regular muted style. */}
                      {ev.detail ? (
                        <div
                          className={[
                            "mt-0.5 truncate text-[10px] text-[hsl(var(--muted-foreground))]",
                            isJoin || isLeft ? "font-mono" : "",
                          ].join(" ")}
                        >
                          {ev.detail}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {/* Load-more sentinel */}
              {hasMore ? (
                <div
                  ref={sentinelRef}
                  className="flex items-center justify-center py-4 text-[11px] text-[hsl(var(--muted-foreground))]"
                >
                  {t("common.loading", { defaultValue: "Loading..." })}
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Settings Sections (preserved from original) ───────────── */}
      {logs.settings_sections.length > 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>{t("logs.settingsDetected")}</CardTitle>
                <CardDescription>{t("logs.settingsDesc")}</CardDescription>
              </div>
              <Badge variant="muted" className="font-mono">
                {logs.settings_sections.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <Input
                value={settingsFilter}
                onChange={(e) => setSettingsFilter(e.target.value)}
                placeholder={t("logs.filterSettings")}
                className="h-7 pl-7 text-[12px]"
              />
            </div>
            {filteredSections.length === 0 ? (
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-4 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
                {t("logs.noSettingMatch")}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredSections.map((section) => (
                  <section
                    key={section.name}
                    className="overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))]"
                  >
                    <header className="unity-panel-header flex items-center justify-between">
                      <span>{section.name}</span>
                      <span className="font-mono text-[10px] normal-case tracking-normal">
                        {section.entries.length}
                      </span>
                    </header>
                    <div className="divide-y divide-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
                      {section.entries.map(([k, v]) => (
                        <div
                          key={`${section.name}.${k}`}
                          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 px-3 py-1.5"
                        >
                          <span className="truncate font-mono text-[11px] text-[hsl(var(--foreground))]">
                            {k}
                          </span>
                          <span className="truncate text-right font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                            {v}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Log Files (preserved from original) ───────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("logs.logFiles")}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {logs.log_files.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {t("logs.noLogFiles")}
            </p>
          ) : (
            <ul className="scrollbar-thin max-h-60 space-y-1 overflow-auto pr-2 text-xs font-mono text-[hsl(var(--muted-foreground))]">
              {logs.log_files.map((f) => (
                <li
                  key={f}
                  className="truncate rounded-md px-2 py-1 hover:bg-[hsl(var(--accent)/0.5)]"
                >
                  {f}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={clearLogFilesOpen}
        onOpenChange={setClearLogFilesOpen}
        title={t("logs.clearFiles", { defaultValue: "Clear Log Files" })}
        description={t("logs.clearFilesConfirm", {
          defaultValue: "Delete stored VRChat output_log files? If VRChat is running, the current active log will be kept.",
        })}
        confirmLabel={t("logs.clearFiles", { defaultValue: "Clear Log Files" })}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void handleClearLogFiles()}
        loading={clearingLogFiles}
        tone="destructive"
      />
    </div>
  );
}

export default Logs;
