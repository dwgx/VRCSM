import { ipc } from "@/lib/ipc";
import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Globe,
  LogOut,
  Shirt,
  Users,
  Copy,
  Clock,
  TrendingUp,
  UserCheck,
  Palette,
  AlertTriangle,
  UserPlus,
  UserMinus,
  ArrowRightLeft,
  Monitor,
  Smartphone,
  FileClock,
  Radio,
  ChevronDown,
  ChevronRight,
  BarChart3,
  RefreshCw,
  History,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ProfileCard } from "@/components/ProfileCard";
import { AvatarPopupBadge } from "@/components/AvatarPopupBadge";
import { WorldPopupBadge } from "@/components/WorldPopupBadge";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import { cn } from "@/lib/utils";
import { useVrcProcess } from "@/lib/vrc-context";
import { useUiPrefBoolean } from "@/lib/ui-prefs";
import { trustRank, trustDotColor } from "@/lib/vrcFriends";
import { FriendLogPanel } from "@/pages/FriendLog";
import type { VrcUserProfile } from "@/components/ProfileCard";
import type {
  PlayerEvent,
  AvatarSwitchEvent,
  WorldSwitchEvent,
  ScreenshotEvent,
} from "@/lib/types";

interface ClassifiedStreamPayload {
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
interface TimelineEntry {
  id: string;
  time: string;
  kind: "joined" | "left" | "avatarSwitch" | "worldSwitch";
  actor: string;
  detail?: string;
}

interface RecentSessionEvent {
  id: number;
  kind: string;
  display_name: string;
  user_id?: string | null;
  world_id?: string | null;
  occurred_at: string;
}

type RadarTab = "live" | "analysis" | "history";

interface ScanLogsResponse {
  world_switches: WorldSwitchEvent[];
  player_events: PlayerEvent[];
  avatar_switches: AvatarSwitchEvent[];
  world_names: Record<string, string>;
  local_user_name?: string | null;
}

interface AnalysisSessionPlayer {
  displayName: string;
  userId: string | null;
  joinTime: string | null;
  leaveTime: string | null;
  avatarIdOrName: string | null;
}

interface AnalysisSessionTimelineEntry {
  id: string;
  kind: "joined" | "left" | "avatarSwitch";
  time: string | null;
  actor: string;
  detail?: string;
  sortKey: number;
}

interface AnalysisSession {
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

function formatDateAndTime(iso: string | null): string {
  if (!iso) return "--";
  if (iso.includes(".") && iso.includes(" ") && !iso.includes("T")) {
    return iso;
  }
  return iso.replace("T", " ").slice(0, 19);
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function shortId(id: string): string {
  if (!id) return "";
  const clean = id.replace(/^(wrld|avtr|usr)_/, "");
  if (clean.length <= 14) return clean;
  return `${clean.slice(0, 8)}…${clean.slice(-4)}`;
}

function formatTimePart(isoTime: string | null): string {
  if (!isoTime) return "--:--";
  // Handle both "2026.04.15 00:42:02" and ISO 8601 formats
  const timePart = isoTime.includes(" ") ? isoTime.split(" ")[1] : isoTime.split("T")[1]?.slice(0, 8);
  return timePart ?? "--:--";
}

function parseEventTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  if (value.includes(".") && value.includes(" ") && !value.includes("T")) {
    const [datePart, timePart] = value.split(" ");
    const parsed = Date.parse(`${datePart.replace(/\./g, "-")}T${timePart}`);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Elapsed time as "Xh Xm Xs" from an ISO timestamp to now */
function useElapsedTime(since: string | null): string {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!since) { setElapsed(""); return; }

    const calc = () => {
      // Parse "2026.04.15 00:42:02" format
      let parsed: number;
      if (since.includes(".") && since.includes(" ") && !since.includes("T")) {
        const [datePart, timePart] = since.split(" ");
        const isoDate = datePart.replace(/\./g, "-");
        parsed = Date.parse(`${isoDate}T${timePart}`);
      } else {
        parsed = Date.parse(since);
      }
      if (Number.isNaN(parsed)) { setElapsed("--"); return; }
      const diffSec = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
      const h = Math.floor(diffSec / 3600);
      const m = Math.floor((diffSec % 3600) / 60);
      const s = diffSec % 60;
      if (h > 0) setElapsed(`${h}h ${m}m ${s}s`);
      else if (m > 0) setElapsed(`${m}m ${s}s`);
      else setElapsed(`${s}s`);
    };

    calc();
    const iv = setInterval(calc, 1000);
    return () => clearInterval(iv);
  }, [since]);

  return elapsed;
}

function PlayerProfileDialog({ userId, displayName }: { userId: string | null; displayName: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = useIpcQuery<{ userId: string }, { profile: VrcUserProfile | null }>(
    "user.getProfile",
    { userId: userId ?? "" },
    { staleTime: 120_000, enabled: !!userId && userId.startsWith("usr_") },
  );
  const profile = data?.profile ?? null;

  return (
    <DialogContent
      className="max-w-[380px] p-0 border-none bg-transparent shadow-none"
      onClick={(e) => e.stopPropagation()}
    >
      <DialogTitle className="sr-only">{displayName}</DialogTitle>
      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-[12px] text-[hsl(var(--muted-foreground))]">{t("common.loading", { defaultValue: "Loading..." })}</div>
      ) : profile ? (
        <ProfileCard user={profile} />
      ) : (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-6 flex flex-col gap-3">
          <p className="text-[13px] font-semibold">{displayName}</p>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{t("radar.idUnknown", { defaultValue: "ID unknown, cannot load profile details" })}</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(displayName);
                toast.success(t("radar.nameCopied", { defaultValue: "Name copied" }));
              }}
              className="flex items-center gap-1.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-all"
            >
              <Copy className="size-3" />
              {t("radar.copyName", { defaultValue: "Copy Name" })}
            </button>
          </div>
        </div>
      )}
    </DialogContent>
  );
}

// ── Trust rank color dot component ────────────────────────────────────────
function TrustDot({ tags }: { tags: string[] | undefined }) {
  if (!tags || tags.length === 0) return null;
  const rank = trustRank(tags);
  const color = trustDotColor(rank);
  return (
    <span
      className="inline-block size-2 rounded-full shrink-0"
      style={{ backgroundColor: color }}
      title={rank}
    />
  );
}

// ── Platform icon component ───────────────────────────────────────────────
function PlatformIcon({ platform }: { platform: string | null | undefined }) {
  if (!platform) return null;
  const lower = platform.toLowerCase();
  if (lower.includes("android") || lower.includes("quest")) {
    return <span title="Quest / Android"><Smartphone className="size-3 text-[hsl(var(--muted-foreground))]" /></span>;
  }
  if (lower.includes("windows") || lower.includes("pc") || lower === "standalonewindows") {
    return <span title="PC"><Monitor className="size-3 text-[hsl(var(--muted-foreground))]" /></span>;
  }
  return null;
}


function RadarEngine({
  onOpenHistory,
  showTimeline,
  onToggleTimeline,
}: {
  onOpenHistory?: () => void;
  showTimeline: boolean;
  onToggleTimeline?: () => void;
}) {
  const { t } = useTranslation();
  const [currentWorld, setCurrentWorld] = useState<WorldSwitchEvent | null>(null);
  const [worldNames, setWorldNames] = useState<Record<string, string>>({});

  // Track players in the current instance
  const [activePlayers, setActivePlayers] = useState<Record<string, RadarPlayer>>({});
  const activePlayersRef = useRef<Record<string, RadarPlayer>>({});

  // History of recently left players (for tracing who just left)
  const [leftPlayers, setLeftPlayers] = useState<Record<string, RadarPlayer>>({});

  // ── Session stats ────────────────────────────────────────────────────
  const [peakPlayerCount, setPeakPlayerCount] = useState(0);
  const [uniquePlayersSeen, setUniquePlayersSeen] = useState<Set<string>>(new Set());
  const [avatarChangeCount, setAvatarChangeCount] = useState(0);

  // ── Session timeline ─────────────────────────────────────────────────
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const timelineEndRef = useRef<HTMLDivElement>(null);
  const timelineIdCounter = useRef(0);

  // ── Player trust rank tags cache ─────────────────────────────────────
  const [playerTags, setPlayerTags] = useState<Record<string, string[]>>({});
  // ── Player platform cache ────────────────────────────────────────────
  const [playerPlatform, setPlayerPlatform] = useState<Record<string, string>>({});
  const [recentSessionEvents, setRecentSessionEvents] = useState<RecentSessionEvent[]>([]);
  const [showRecentHistory, setShowRecentHistory] = useUiPrefBoolean("vrcsm.layout.radar.recentHistory.visible", true);
  const currentWorldRef = useRef<WorldSwitchEvent | null>(null);

  const addTimelineEntry = useCallback((entry: Omit<TimelineEntry, "id">) => {
    const id = `tl-${++timelineIdCounter.current}`;
    setTimeline(prev => [...prev, { ...entry, id }]);
  }, []);

  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Scroll timeline to bottom when new entries arrive, if autoScroll is enabled
  useEffect(() => {
    if (autoScroll) {
      timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [timeline, autoScroll]);

  const handleTimelineScroll = useCallback(() => {
    if (!timelineScrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = timelineScrollRef.current;
    // Enable auto-scroll if within 50px of the bottom
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  }, []);

  // Track peak player count
  useEffect(() => {
    const count = Object.keys(activePlayers).length;
    if (count > peakPlayerCount) setPeakPlayerCount(count);
  }, [activePlayers, peakPlayerCount]);

  // Fetch trust tags for players with userId
  useEffect(() => {
    const fetchable = Object.values(activePlayers).filter(
      p => p.userId && p.userId.startsWith("usr_") && !playerTags[p.userId]
    );
    for (const p of fetchable) {
      void ipc.call<{ userId: string }, { profile: any }>("user.getProfile", { userId: p.userId! })
        .then(res => {
          const tags = res?.profile?.tags;
          const platform = res?.profile?.last_platform;
          if (tags && Array.isArray(tags)) {
            setPlayerTags(prev => ({ ...prev, [p.userId!]: tags }));
          }
          if (platform && typeof platform === "string") {
            setPlayerPlatform(prev => ({ ...prev, [p.userId!]: platform }));
          }
        })
        .catch(() => {/* silently ignore */});
    }
  }, [activePlayers, playerTags]);

  useEffect(() => {
    let alive = true;
    void ipc.dbPlayerEvents(10, 0).then((res) => {
      if (!alive) return;
      setRecentSessionEvents(res.items as RecentSessionEvent[]);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // ── Stream + Snapshot Hydration ───────────────────────────────────────
  // A ref to queue live events until the initial `scan` snapshot settles.
  const isHydrating = React.useRef(true);
  const hydrationQueue = React.useRef<ClassifiedStreamPayload[]>([]);

  useEffect(() => {
    // ── Step 1: reconstruct current state from existing log ────────────────
    type ScanLogs = {
      world_switches: WorldSwitchEvent[];
      player_events: PlayerEvent[];
      avatar_switches: AvatarSwitchEvent[];
      world_names: Record<string, string>;
      local_user_name?: string | null;
    };
    void ipc.call<object, { logs: ScanLogs }>("scan", {}).then((res) => {
      const {
        world_switches = [],
        player_events = [],
        avatar_switches = [],
        world_names = {},
        local_user_name = null,
      } = res?.logs ?? {} as ScanLogs;
      setWorldNames(world_names);
      const lastWorld = world_switches.length ? world_switches[world_switches.length - 1] : null;
      if (lastWorld) {
        setCurrentWorld(lastWorld);
        currentWorldRef.current = lastWorld;
      }

      const worldTime = lastWorld?.iso_time ?? null;
      const worldTimeMs = parseEventTimestamp(worldTime);
      const currentWorldId = lastWorld?.world_id ?? null;
      const currentInstanceId = lastWorld?.instance_id ?? null;
      const players: Record<string, RadarPlayer> = {};
      const initTimeline: Array<TimelineEntry & { sortTime: number | null }> = [];
      const seen = new Set<string>();
      let avatarChanges = 0;

      const belongsToCurrentSession = (
        event: Pick<PlayerEvent, "iso_time" | "world_id" | "instance_id"> | Pick<AvatarSwitchEvent, "iso_time" | "world_id" | "instance_id">,
      ) => {
        if (currentInstanceId && event.instance_id) {
          return event.instance_id === currentInstanceId;
        }
        if (currentWorldId && event.world_id) {
          return event.world_id === currentWorldId;
        }
        const eventTime = parseEventTimestamp(event.iso_time);
        if (worldTimeMs !== null && eventTime !== null) {
          return eventTime >= worldTimeMs;
        }
        return worldTime === null;
      };

      for (const ev of player_events) {
        if (!belongsToCurrentSession(ev)) continue;
        if (ev.kind === "joined") {
          players[ev.display_name] = {
            displayName: ev.display_name, userId: ev.user_id,
            joinTime: ev.iso_time,
            avatarIdOrName: players[ev.display_name]?.avatarIdOrName ?? null,
            lastAvatarSwitchTime: players[ev.display_name]?.lastAvatarSwitchTime ?? null,
          };
          seen.add(ev.display_name);
          initTimeline.push({
            id: `init-p-${initTimeline.length}`,
            time: formatTimePart(ev.iso_time),
            sortTime: parseEventTimestamp(ev.iso_time),
            kind: "joined",
            actor: ev.display_name,
          });
        } else if (ev.kind === "left") {
          delete players[ev.display_name];
          initTimeline.push({
            id: `init-l-${initTimeline.length}`,
            time: formatTimePart(ev.iso_time),
            sortTime: parseEventTimestamp(ev.iso_time),
            kind: "left",
            actor: ev.display_name,
          });
        }
      }
      for (const av of avatar_switches) {
        if (!belongsToCurrentSession(av)) continue;
        const isLocalActor = Boolean(local_user_name && av.actor === local_user_name);
        if (!players[av.actor] && !isLocalActor) {
          continue;
        }
        avatarChanges++;
        if (players[av.actor]) {
          players[av.actor] = { ...players[av.actor], avatarIdOrName: av.avatar_name, lastAvatarSwitchTime: av.iso_time };
        }
        initTimeline.push({
          id: `init-a-${initTimeline.length}`,
          time: formatTimePart(av.iso_time),
          sortTime: parseEventTimestamp(av.iso_time),
          kind: "avatarSwitch",
          actor: av.actor,
          detail: av.avatar_name,
        });
      }

      initTimeline.sort((a, b) => {
        if (a.sortTime !== null && b.sortTime !== null && a.sortTime !== b.sortTime) {
          return a.sortTime - b.sortTime;
        }
        return a.id.localeCompare(b.id);
      });

      setActivePlayers(players);
      activePlayersRef.current = players;
      setTimeline(initTimeline.map(({ sortTime: _sortTime, ...entry }) => entry));
      setUniquePlayersSeen(seen);
      setAvatarChangeCount(avatarChanges);
      setPeakPlayerCount(Object.keys(players).length);
      timelineIdCounter.current = initTimeline.length;
      isHydrating.current = false;

      // Flush any live events that arrived while we were scanning
      for (const payload of hydrationQueue.current) {
         processLiveEvent(payload);
      }
      hydrationQueue.current = [];
    }).catch(() => {
      isHydrating.current = false;
    });

    // ── Step 2: live tail for new events ───────────────────────────────────
    void ipc.call("logs.stream.start").catch(() => undefined);

    const processLiveEvent = (payload: ClassifiedStreamPayload) => {
      const { kind, data } = payload;

      if (kind === "worldSwitch") {
        const ev = data as WorldSwitchEvent;
        setCurrentWorld(ev);
        currentWorldRef.current = ev;
        // Clear room on new map
        setActivePlayers({});
        activePlayersRef.current = {};
        setLeftPlayers({});
        // Reset session stats for new world
        setPeakPlayerCount(0);
        setUniquePlayersSeen(new Set());
        setAvatarChangeCount(0);
        setTimeline([{
          id: `tl-world-${Date.now()}`,
          time: formatTimePart(ev.iso_time),
          kind: "worldSwitch",
          actor: "",
          detail: ev.world_id,
        }]);
        timelineIdCounter.current = 1;
      }
      else if (kind === "player") {
        const ev = data as PlayerEvent;
        const liveWorld = currentWorldRef.current;
        if (liveWorld?.instance_id && ev.instance_id && ev.instance_id !== liveWorld.instance_id) {
          return;
        }
        if (liveWorld?.world_id && ev.world_id && ev.world_id !== liveWorld.world_id) {
          return;
        }
        if (ev.kind === "joined") {
          setActivePlayers(prev => {
            const next = {
              ...prev,
              [ev.display_name]: {
              displayName: ev.display_name,
              userId: ev.user_id,
              joinTime: ev.iso_time,
              avatarIdOrName: prev[ev.display_name]?.avatarIdOrName || null,
              lastAvatarSwitchTime: prev[ev.display_name]?.lastAvatarSwitchTime || null,
            }
            };
            activePlayersRef.current = next;
            return next;
          });
          // Remove from left history if they re-join
          setLeftPlayers(prev => {
            const next = { ...prev };
            delete next[ev.display_name];
            return next;
          });
          // Track unique players
          setUniquePlayersSeen(prev => new Set(prev).add(ev.display_name));
          // Timeline
          addTimelineEntry({
            time: formatTimePart(ev.iso_time),
            kind: "joined",
            actor: ev.display_name,
          });
        }
        else if (ev.kind === "left") {
          setActivePlayers(prev => {
            const next = { ...prev };
            const p = next[ev.display_name];
            if (p) {
              // Move to leftPlayers
              setLeftPlayers(lp => ({ ...lp, [ev.display_name]: p }));
            }
            delete next[ev.display_name];
            activePlayersRef.current = next;
            return next;
          });
          // Timeline
          addTimelineEntry({
            time: formatTimePart(ev.iso_time),
            kind: "left",
            actor: ev.display_name,
          });
        }
      }
      else if (kind === "avatarSwitch") {
        const ev = data as AvatarSwitchEvent;
        const liveWorld = currentWorldRef.current;
        if (liveWorld?.instance_id && ev.instance_id && ev.instance_id !== liveWorld.instance_id) {
          return;
        }
        if (liveWorld?.world_id && ev.world_id && ev.world_id !== liveWorld.world_id) {
          return;
        }
        if (!activePlayersRef.current[ev.actor]) {
          return;
        }
        setActivePlayers(prev => {
          const next = {
            ...prev,
            [ev.actor]: {
              ...prev[ev.actor],
              avatarIdOrName: ev.avatar_name,
              lastAvatarSwitchTime: ev.iso_time
            }
          };
          activePlayersRef.current = next;
          return next;
        });
        setAvatarChangeCount(prev => prev + 1);
        // Timeline
        addTimelineEntry({
          time: formatTimePart(ev.iso_time),
          kind: "avatarSwitch",
          actor: ev.actor,
          detail: ev.avatar_name,
        });
      }
    };

    const off = ipc.on<ClassifiedStreamPayload>("logs.stream.event", (payload) => {
      if (!payload || typeof payload !== "object") return;
      if (isHydrating.current) {
        hydrationQueue.current.push(payload);
      } else {
        processLiveEvent(payload);
      }
    });

    return () => {
      off();
      void ipc.call("logs.stream.stop").catch(() => undefined);
    };
  }, []);

  const activeArray = useMemo(() => Object.values(activePlayers).sort((a,b) => a.displayName.localeCompare(b.displayName)), [activePlayers]);
  const leftArray = useMemo(() => Object.values(leftPlayers).sort((a,b) => a.displayName.localeCompare(b.displayName)), [leftPlayers]);

  const worldDetails = useIpcQuery<{ id: string | undefined }, { details: any }>(
    "world.details",
    { id: currentWorld?.world_id },
    { enabled: !!currentWorld?.world_id, staleTime: Infinity }
  );

  const elapsedTime = useElapsedTime(currentWorld?.iso_time ?? null);

  // ── Timeline dot color ──────────────────────────────────────────────────
  const timelineDotClass = (kind: TimelineEntry["kind"]) => {
    switch (kind) {
      case "joined": return "bg-emerald-500";
      case "left": return "bg-red-500";
      case "avatarSwitch": return "bg-purple-500";
      case "worldSwitch": return "bg-blue-500";
      default: return "bg-gray-500";
    }
  };

  const timelineIcon = (kind: TimelineEntry["kind"]) => {
    switch (kind) {
      case "joined": return <UserPlus className="size-3" />;
      case "left": return <UserMinus className="size-3" />;
      case "avatarSwitch": return <ArrowRightLeft className="size-3" />;
      case "worldSwitch": return <Globe className="size-3" />;
      default: return null;
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header className="flex items-end justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("radar.title", { defaultValue: "Live Instance Radar" })}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("radar.subtitle", { defaultValue: "Real-time player monitoring via log tailing" })}
          </p>
        </div>
        {/* Experimental badge */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onToggleTimeline}>
            {showTimeline
              ? t("common.hide", { defaultValue: "Hide" })
              : t("common.show", { defaultValue: "Show" })}{" "}
            {t("radar.timeline.title", { defaultValue: "Session Timeline" })}
          </Button>
          <Badge variant="outline" className="shrink-0 gap-1.5 border-amber-500/40 text-amber-500 bg-amber-500/5 text-[10px] font-medium px-2.5 py-1">
            <AlertTriangle className="size-3" />
            {t("radar.experimental", { defaultValue: "Experimental — log analysis only" })}
          </Badge>
        </div>
      </header>

      {/* ── Session Stats Bar ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="flex items-center gap-3 rounded-lg border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--canvas))] px-4 py-3">
          <div className="flex items-center justify-center size-8 rounded-md bg-blue-500/10">
            <Clock className="size-4 text-blue-500" />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider font-medium">
              {t("radar.stats.timeInWorld", { defaultValue: "Time in world" })}
            </span>
            <span className="text-[14px] font-semibold font-mono tabular-nums">
              {elapsedTime || "--"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--canvas))] px-4 py-3">
          <div className="flex items-center justify-center size-8 rounded-md bg-emerald-500/10">
            <TrendingUp className="size-4 text-emerald-500" />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider font-medium">
              {t("radar.stats.peakPlayers", { defaultValue: "Peak players" })}
            </span>
            <span className="text-[14px] font-semibold font-mono tabular-nums">
              {peakPlayerCount}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--canvas))] px-4 py-3">
          <div className="flex items-center justify-center size-8 rounded-md bg-orange-500/10">
            <UserCheck className="size-4 text-orange-500" />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider font-medium">
              {t("radar.stats.uniquePlayers", { defaultValue: "Unique players" })}
            </span>
            <span className="text-[14px] font-semibold font-mono tabular-nums">
              {uniquePlayersSeen.size}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--canvas))] px-4 py-3">
          <div className="flex items-center justify-center size-8 rounded-md bg-purple-500/10">
            <Palette className="size-4 text-purple-500" />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider font-medium">
              {t("radar.stats.avatarChanges", { defaultValue: "Avatar changes" })}
            </span>
            <span className="text-[14px] font-semibold font-mono tabular-nums">
              {avatarChangeCount}
            </span>
          </div>
        </div>
      </div>

      <div className={showTimeline ? "grid gap-4 md:grid-cols-[320px_minmax(0,1fr)_340px]" : "grid gap-4 md:grid-cols-[320px_minmax(0,1fr)]"}>
        {/* Left Column: Instance Info + Left Players */}
        <div className="flex flex-col gap-4">
          {/* ── World Instance Card with Banner ────────────────────────── */}
          <Card className="shrink-0 overflow-hidden border-t-[3px] border-t-[hsl(var(--primary))]">
            {/* World banner image */}
            {worldDetails.data?.details?.thumbnailImageUrl || worldDetails.data?.details?.imageUrl ? (
              <div className="relative w-full h-28 overflow-hidden">
                <img
                  src={worldDetails.data.details.thumbnailImageUrl || worldDetails.data.details.imageUrl}
                  className="w-full h-full object-cover"
                  alt="World"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--card))] via-[hsl(var(--card)/0.4)] to-transparent" />
              </div>
            ) : (
              <div className="w-full h-16 bg-gradient-to-br from-[hsl(var(--muted)/0.3)] to-transparent" />
            )}

            <CardHeader className="pb-3 -mt-6 relative z-10">
              <div className="flex items-center gap-2">
                <Globe className="size-4 text-[hsl(var(--primary))]" />
                <CardTitle className="text-sm">{t("radar.currentInstance", { defaultValue: "Current Instance" })}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {!currentWorld ? (
                <div className="text-[12px] text-[hsl(var(--muted-foreground))] animate-pulse">
                  {t("radar.waitingJoin", { defaultValue: "Waiting for world join event..." })}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-3 items-center">
                    {worldDetails.data?.details?.imageUrl ? (
                       <img src={worldDetails.data.details.imageUrl} className="w-16 h-12 rounded object-cover border border-[hsl(var(--border))]" alt="World" />
                    ) : (
                       <div className="w-16 h-12 bg-black/20 rounded border border-[hsl(var(--border))] flex items-center justify-center">
                         <Globe className="size-5 text-[hsl(var(--muted-foreground)/0.5)]" />
                       </div>
                    )}
                    <div className="flex flex-col flex-1 min-w-0">
                       <span className="text-[14px] font-semibold truncate leading-tight">
                          {worldDetails.data?.details?.name || worldNames[currentWorld.world_id] || "Unknown World"}
                       </span>
                       <span className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">
                          {worldDetails.data?.details?.authorName || "..."}
                       </span>
                    </div>
                  </div>

                  <div className="font-mono text-[10px] bg-black/20 p-2 rounded border border-[hsl(var(--border)/0.5)] break-all select-all text-blue-400 mt-1">
                    {currentWorld.instance_id}
                  </div>

                  <div className="flex gap-2 text-[11px] items-center flex-wrap">
                    <Badge variant="outline" className="font-mono bg-[hsl(var(--canvas))] uppercase tracking-widest">{currentWorld.access_type}</Badge>
                    {currentWorld.region && <Badge variant="secondary" className="font-mono uppercase">{currentWorld.region}</Badge>}
                    {worldDetails.data?.details?.capacity && (
                      <Badge variant="secondary" className="font-mono">
                        <Users className="size-2.5 mr-1" />
                        {activeArray.length}/{worldDetails.data.details.capacity}
                      </Badge>
                    )}
                  </div>

                  {currentWorld.owner_id && (
                    <div className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono border-t border-[hsl(var(--border)/0.3)] pt-2 mt-1">
                      {t("radar.host", { owner: currentWorld.owner_id, defaultValue: "Host: {{owner}}" })}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Left Session Card ──────────────────────────────────────── */}
          <Card className="flex flex-col border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--canvas))] shadow-sm">
            <CardHeader className="py-4 border-b border-[hsl(var(--border)/0.5)] flex flex-row items-center justify-between space-y-0">
                 <div className="flex items-center gap-2">
                   <LogOut className="size-3 text-[hsl(var(--muted-foreground))]" />
                   <CardTitle className="text-xs">{t("radar.leftSession", { defaultValue: "Left Session" })}</CardTitle>
                 </div>
                 <Badge variant="secondary" className="font-mono text-[9px] h-4">
                   {leftArray.length}
                 </Badge>
            </CardHeader>
            <CardContent className="p-0 max-h-[300px] overflow-y-auto">
               {leftArray.length === 0 ? (
                 <div className="p-4 text-center text-[11px] text-[hsl(var(--muted-foreground))]">{t("radar.nobodyLeft", { defaultValue: "No one has left yet." })}</div>
               ) : (
                 <ul className="divide-y divide-[hsl(var(--border)/0.4)]">
                   {leftArray.map((p, i) => (
                      <li key={i} className="p-2.5 hover:bg-[hsl(var(--muted)/0.3)] opacity-60 grayscale">
                        <div className="flex justify-between items-center gap-2">
                           <div className="flex items-center gap-1.5 min-w-0">
                             <TrustDot tags={p.userId ? playerTags[p.userId] : undefined} />
                             <span className="text-[12px] font-medium truncate">{p.displayName}</span>
                           </div>
                           <span className="text-[9px] font-mono opacity-50 shrink-0">{p.userId ? shortId(p.userId) : ''}</span>
                        </div>
                      </li>
                   ))}
                 </ul>
               )}
            </CardContent>
          </Card>

          <Card className="border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--canvas))] shadow-sm">
            <CardHeader className={cn("py-4", showRecentHistory && "border-b border-[hsl(var(--border)/0.5)]")}>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setShowRecentHistory((v) => !v)}
                  className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
                  aria-expanded={showRecentHistory}
                >
                  {showRecentHistory ? (
                    <ChevronDown className="size-3 text-[hsl(var(--muted-foreground))]" />
                  ) : (
                    <ChevronRight className="size-3 text-[hsl(var(--muted-foreground))]" />
                  )}
                  <Clock className="size-3 text-[hsl(var(--muted-foreground))]" />
                  <CardTitle className="text-xs">
                    {t("radar.recentHistory.title", { defaultValue: "Recent Session History" })}
                  </CardTitle>
                  {!showRecentHistory && recentSessionEvents.length > 0 ? (
                    <Badge variant="secondary" className="h-4 font-mono text-[9px]">
                      {recentSessionEvents.length}
                    </Badge>
                  ) : null}
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => onOpenHistory?.()}
                >
                  {t("radar.recentHistory.open", { defaultValue: "Open Log" })}
                </Button>
              </div>
              {showRecentHistory ? (
                <CardDescription className="text-[11px]">
                  {t("radar.recentHistory.desc", {
                    defaultValue: "Pulled from the persistent player event database.",
                  })}
                </CardDescription>
              ) : null}
            </CardHeader>
            {showRecentHistory ? (
              <CardContent className="p-0 max-h-[280px] overflow-y-auto">
                {recentSessionEvents.length === 0 ? (
                  <div className="p-4 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                    {t("radar.recentHistory.empty", { defaultValue: "No recorded session events yet." })}
                  </div>
                ) : (
                  <div className="divide-y divide-[hsl(var(--border)/0.4)]">
                    {recentSessionEvents.map((event) => (
                      <div key={`${event.id}-${event.occurred_at}`} className="flex items-start gap-2.5 px-3 py-2.5">
                        {event.kind === "joined" ? (
                          <UserPlus className="mt-0.5 size-3 text-emerald-400" />
                        ) : (
                          <UserMinus className="mt-0.5 size-3 text-zinc-400" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[11px] font-medium text-[hsl(var(--foreground))]">
                              {event.display_name}
                            </span>
                            <Badge
                              variant="outline"
                              className={cn(
                                "h-4 border text-[9px] font-mono",
                                event.kind === "joined"
                                  ? "bg-emerald-500/12 text-emerald-400 border-emerald-500/25"
                                  : "bg-zinc-500/12 text-zinc-300 border-zinc-500/25",
                              )}
                            >
                              {event.kind === "joined"
                                ? t("friendLog.session.kind.joined")
                                : t("friendLog.session.kind.left")}
                            </Badge>
                          </div>
                          <div className="mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                            {event.occurred_at}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            ) : null}
          </Card>
        </div>

        {/* ── Center: Active Players Grid ─────────────────────────────── */}
        <Card className="flex flex-col">
          <CardHeader className="py-3 border-b border-[hsl(var(--border))]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-[hsl(var(--primary))]" />
                <CardTitle>{t("radar.activePlayers", { defaultValue: "Active Players" })}</CardTitle>
                <CardDescription>{t("radar.activeDesc", { defaultValue: "Players in your immediate vicinity" })}</CardDescription>
              </div>
              <Badge className="font-mono text-[11px] shadow-sm">
                 {t("radar.onlineCount", { count: activeArray.length, defaultValue: "{{count}} Online" })}
              </Badge>
            </div>
          </CardHeader>
            <CardContent className="p-4 bg-black/5 flex-1 overflow-y-auto">
            {activeArray.length === 0 ? (
               <div className="h-full flex items-center justify-center flex-col gap-2">
                 <Users className="size-10 text-[hsl(var(--muted-foreground)/0.2)]" />
                 <span className="text-[12px] text-[hsl(var(--muted-foreground))]">{t("radar.trackingWait", { defaultValue: "Tracking will populate as players join..." })}</span>
               </div>
            ) : (
               <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                 {activeArray.map((p, idx) => (
                    <Dialog key={idx}>
                      <DialogTrigger asChild>
                        <div className="group relative flex flex-col border border-[hsl(var(--border)/0.7)] bg-[hsl(var(--card))] rounded-lg overflow-hidden shadow-sm hover:shadow-md hover:border-[hsl(var(--primary)/0.5)] transition-all duration-200 cursor-pointer">
                           <div className="px-3 py-2 flex items-center justify-between border-b border-[hsl(var(--border)/0.3)] bg-[hsl(var(--muted)/0.3)]">
                              <div className="flex items-center gap-1.5 min-w-0 pr-2">
                                <TrustDot tags={p.userId ? playerTags[p.userId] : undefined} />
                                <span className="text-[13px] font-semibold text-[hsl(var(--foreground))] truncate drop-shadow-sm">
                                  {p.displayName}
                                </span>
                                <PlatformIcon platform={p.userId ? playerPlatform[p.userId] : undefined} />
                              </div>
                              <span className="text-[9px] font-mono text-[hsl(var(--muted-foreground))] tracking-tighter shrink-0">
                                {p.joinTime ? formatTimePart(p.joinTime) : t("radar.unknownTime", { defaultValue: "Unknown" })}
                              </span>
                           </div>
                           <div className="p-3 flex flex-col gap-2 relative">
                             {p.userId && (
                               <div className="text-[10px] font-mono text-[hsl(var(--muted-foreground))] bg-black/10 px-1.5 py-0.5 rounded w-fit select-all">
                                 {shortId(p.userId)}
                               </div>
                             )}

                             <div className="min-h-[24px] flex items-center">
                               {p.avatarIdOrName ? (
                                 <div className="flex gap-2 items-center flex-wrap">
                                   <Shirt className="size-3 text-[hsl(var(--primary)/0.7)]" />
                                   {p.avatarIdOrName.startsWith('avtr_') ? (
                                      <AvatarPopupBadge avatarId={p.avatarIdOrName} />
                                   ) : (
                                      <span className="text-[11px] text-[hsl(var(--muted-foreground))] italic truncate max-w-[140px]">{p.avatarIdOrName}</span>
                                   )}
                                 </div>
                               ) : (
                                 <span className="text-[11px] text-[hsl(var(--muted-foreground)/0.5)] italic">{t("radar.unknownAvatar", { defaultValue: "Unknown Avatar" })}</span>
                               )}
                             </div>
                           </div>
                        </div>
                      </DialogTrigger>
                      <PlayerProfileDialog userId={p.userId} displayName={p.displayName} />
                    </Dialog>
                 ))}
               </div>
            )}
          </CardContent>
        </Card>

        {/* ── Right Column: Session Timeline ──────────────────────────── */}
        {showTimeline ? (
          <Card className="flex flex-col min-h-[500px]">
            <CardHeader className="py-3 border-b border-[hsl(var(--border))]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-[hsl(var(--primary))]" />
                  <CardTitle className="text-sm">{t("radar.timeline.title", { defaultValue: "Session Timeline" })}</CardTitle>
                </div>
                <Badge variant="secondary" className="font-mono text-[9px] h-4">
                  {timeline.length} {t("radar.timeline.events", { defaultValue: "events" })}
                </Badge>
              </div>
            </CardHeader>
            <CardContent
              className="p-0 flex-1 overflow-y-auto"
              ref={timelineScrollRef}
              onScroll={handleTimelineScroll}
            >
              {timeline.length === 0 ? (
                <div className="h-full flex items-center justify-center flex-col gap-2 p-4">
                  <Clock className="size-8 text-[hsl(var(--muted-foreground)/0.2)]" />
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    {t("radar.timeline.empty", { defaultValue: "Events will appear here..." })}
                  </span>
                </div>
              ) : (
                <div className="relative pl-6 pr-3 py-3">
                  <div className="absolute left-[18px] top-3 bottom-3 w-px bg-[hsl(var(--border)/0.5)]" />

                  <div className="flex flex-col gap-0.5">
                    {timeline.map((entry) => (
                      <div
                        key={entry.id}
                        className="relative flex items-start gap-3 py-1.5 group hover:bg-[hsl(var(--muted)/0.15)] rounded-r-md px-1 -ml-1 transition-colors"
                      >
                        <div className={`absolute -left-[13px] top-[9px] size-2 rounded-full ring-2 ring-[hsl(var(--card))] ${timelineDotClass(entry.kind)}`} />

                        <span className="text-[9px] font-mono text-[hsl(var(--muted-foreground))] shrink-0 w-[42px] pt-0.5 tabular-nums">
                          {entry.time}
                        </span>

                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className={`shrink-0 ${
                            entry.kind === "joined" ? "text-emerald-500" :
                            entry.kind === "left" ? "text-red-500" :
                            entry.kind === "avatarSwitch" ? "text-purple-500" :
                            "text-blue-500"
                          }`}>
                            {timelineIcon(entry.kind)}
                          </span>
                          <span className="text-[11px] truncate">
                            {entry.kind === "worldSwitch" ? (
                              <span className="text-blue-400 font-medium">
                                {t("radar.timeline.worldChanged", { defaultValue: "World changed" })}
                              </span>
                            ) : entry.kind === "avatarSwitch" ? (
                              <>
                                <span className="font-medium">{entry.actor}</span>
                                <span className="text-[hsl(var(--muted-foreground))]"> → </span>
                                <span className="italic text-purple-400">{entry.detail}</span>
                              </>
                            ) : (
                              <span className={`font-medium ${entry.kind === "joined" ? "text-emerald-400" : "text-red-400"}`}>
                                {entry.actor}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    ))}
                    <div ref={timelineEndRef} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function RadarHistoryAnalysis() {
  const { t } = useTranslation();
  const [scan, setScan] = useState<ScanLogsResponse | null>(null);
  const [loading, setLoadingState] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [playerTags, setPlayerTags] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let alive = true;
    setLoadingState(true);
    void ipc
      .call<object, { logs: ScanLogsResponse }>("scan", {})
      .then((res) => {
        if (!alive) return;
        setScan(res?.logs ?? null);
        setLoadingState(false);
      })
      .catch(() => {
        if (!alive) return;
        setLoadingState(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const sessions = useMemo<AnalysisSession[]>(() => {
    if (!scan) return [];
    const ws = scan.world_switches ?? [];
    const pe = scan.player_events ?? [];
    const av = scan.avatar_switches ?? [];
    const names = scan.world_names ?? {};
    const localUser = scan.local_user_name ?? null;

    const result: AnalysisSession[] = [];

    const nextStartMs: Array<number | null> = ws.map((_, i) => {
      const next = ws[i + 1];
      return next ? parseEventTimestamp(next.iso_time) : null;
    });

    for (let i = 0; i < ws.length; i++) {
      const world = ws[i];
      const startMs = parseEventTimestamp(world.iso_time);
      const endMs = nextStartMs[i];
      const endTime = ws[i + 1]?.iso_time ?? null;

      const belongs = (eventTime: string | null, eventWorldId?: string | null, eventInstanceId?: string | null): boolean => {
        if (eventInstanceId && world.instance_id) {
          return eventInstanceId === world.instance_id;
        }
        if (eventWorldId && world.world_id) {
          if (eventWorldId !== world.world_id) return false;
        }
        const ms = parseEventTimestamp(eventTime);
        if (ms === null) return startMs === null;
        if (startMs !== null && ms < startMs) return false;
        if (endMs !== null && ms >= endMs) return false;
        return true;
      };

      const players = new Map<string, AnalysisSessionPlayer>();
      const timeline: AnalysisSessionTimelineEntry[] = [];
      let avatarChanges = 0;
      let peakConcurrent = 0;
      let currentConcurrent = 0;

      const orderedEvents: Array<{ ms: number; idx: number; fn: () => void }> = [];

      pe.forEach((ev, idx) => {
        if (!belongs(ev.iso_time, ev.world_id ?? null, ev.instance_id ?? null)) return;
        const ms = parseEventTimestamp(ev.iso_time) ?? 0;
        orderedEvents.push({
          ms,
          idx,
          fn: () => {
            if (ev.kind === "joined") {
              const existing = players.get(ev.display_name);
              players.set(ev.display_name, {
                displayName: ev.display_name,
                userId: ev.user_id ?? existing?.userId ?? null,
                joinTime: ev.iso_time ?? existing?.joinTime ?? null,
                leaveTime: null,
                avatarIdOrName: existing?.avatarIdOrName ?? null,
              });
              currentConcurrent++;
              if (currentConcurrent > peakConcurrent) peakConcurrent = currentConcurrent;
              timeline.push({
                id: `${world.instance_id}-p${idx}`,
                kind: "joined",
                time: ev.iso_time,
                actor: ev.display_name,
                sortKey: ms,
              });
            } else if (ev.kind === "left") {
              const existing = players.get(ev.display_name);
              if (existing) {
                players.set(ev.display_name, { ...existing, leaveTime: ev.iso_time });
              }
              currentConcurrent = Math.max(0, currentConcurrent - 1);
              timeline.push({
                id: `${world.instance_id}-l${idx}`,
                kind: "left",
                time: ev.iso_time,
                actor: ev.display_name,
                sortKey: ms,
              });
            }
          },
        });
      });

      av.forEach((ev, idx) => {
        if (!belongs(ev.iso_time, ev.world_id ?? null, ev.instance_id ?? null)) return;
        const isLocalActor = !!(localUser && ev.actor === localUser);
        if (!players.has(ev.actor) && !isLocalActor) return;
        const ms = parseEventTimestamp(ev.iso_time) ?? 0;
        orderedEvents.push({
          ms,
          idx: idx + 1_000_000,
          fn: () => {
            avatarChanges++;
            const existing = players.get(ev.actor);
            if (existing) {
              players.set(ev.actor, { ...existing, avatarIdOrName: ev.avatar_name });
            }
            timeline.push({
              id: `${world.instance_id}-a${idx}`,
              kind: "avatarSwitch",
              time: ev.iso_time,
              actor: ev.actor,
              detail: ev.avatar_name,
              sortKey: ms,
            });
          },
        });
      });

      orderedEvents.sort((a, b) => (a.ms !== b.ms ? a.ms - b.ms : a.idx - b.idx));
      for (const e of orderedEvents) e.fn();

      timeline.sort((a, b) => a.sortKey - b.sortKey);

      const playerArray = Array.from(players.values()).sort((a, b) => {
        const ams = parseEventTimestamp(a.joinTime) ?? 0;
        const bms = parseEventTimestamp(b.joinTime) ?? 0;
        return ams - bms;
      });

      result.push({
        id: `${world.instance_id}-${i}`,
        worldId: world.world_id,
        worldName: names[world.world_id] ?? "",
        instanceId: world.instance_id,
        accessType: world.access_type,
        ownerId: world.owner_id,
        region: world.region,
        startTime: world.iso_time,
        startMs,
        endTime,
        endMs,
        players: playerArray,
        peakConcurrent,
        avatarChanges,
        timeline,
      });
    }

    return result.reverse();
  }, [scan]);

  const aggregate = useMemo(() => {
    const playerSet = new Set<string>();
    const worldSet = new Set<string>();
    const worldHits = new Map<string, { worldId: string; name: string; count: number }>();
    const playerHits = new Map<string, { displayName: string; userId: string | null; count: number }>();
    let totalAvatarChanges = 0;
    let totalDurationMs = 0;

    for (const s of sessions) {
      if (s.worldId) {
        worldSet.add(s.worldId);
        const hit = worldHits.get(s.worldId);
        if (hit) hit.count++;
        else worldHits.set(s.worldId, { worldId: s.worldId, name: s.worldName, count: 1 });
      }
      totalAvatarChanges += s.avatarChanges;
      if (s.startMs !== null && s.endMs !== null) {
        totalDurationMs += Math.max(0, s.endMs - s.startMs);
      }
      for (const p of s.players) {
        playerSet.add(p.displayName);
        const key = p.userId ?? p.displayName;
        const hit = playerHits.get(key);
        if (hit) hit.count++;
        else playerHits.set(key, { displayName: p.displayName, userId: p.userId, count: 1 });
      }
    }

    const topWorlds = Array.from(worldHits.values()).sort((a, b) => b.count - a.count).slice(0, 5);
    const topPlayers = Array.from(playerHits.values()).sort((a, b) => b.count - a.count).slice(0, 8);

    return {
      sessionCount: sessions.length,
      uniquePlayers: playerSet.size,
      uniqueWorlds: worldSet.size,
      totalAvatarChanges,
      totalDurationMs,
      topWorlds,
      topPlayers,
    };
  }, [sessions]);

  useEffect(() => {
    const candidates = new Set<string>();
    for (const s of sessions) {
      for (const p of s.players) {
        if (p.userId && p.userId.startsWith("usr_") && !playerTags[p.userId]) {
          candidates.add(p.userId);
        }
      }
    }
    if (candidates.size === 0) return;
    let alive = true;
    const list = Array.from(candidates).slice(0, 24);
    for (const uid of list) {
      void ipc
        .call<{ userId: string }, { profile: any }>("user.getProfile", { userId: uid })
        .then((res) => {
          if (!alive) return;
          const tags = res?.profile?.tags;
          if (tags && Array.isArray(tags)) {
            setPlayerTags((prev) => (prev[uid] ? prev : { ...prev, [uid]: tags }));
          }
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [sessions, playerTags]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCell
          icon={<History className="size-4 text-[hsl(var(--primary))]" />}
          label={t("radar.analysis.aggregate.totalSessions", { defaultValue: "Sessions" })}
          value={aggregate.sessionCount}
        />
        <StatCell
          icon={<Users className="size-4 text-emerald-400" />}
          label={t("radar.analysis.aggregate.uniquePlayers", { defaultValue: "Unique players" })}
          value={aggregate.uniquePlayers}
        />
        <StatCell
          icon={<Globe className="size-4 text-blue-400" />}
          label={t("radar.analysis.aggregate.uniqueWorlds", { defaultValue: "Unique worlds" })}
          value={aggregate.uniqueWorlds}
        />
        <StatCell
          icon={<Shirt className="size-4 text-purple-400" />}
          label={t("radar.analysis.aggregate.avatarChanges", { defaultValue: "Avatar changes" })}
          value={aggregate.totalAvatarChanges}
        />
      </div>

      {aggregate.topWorlds.length > 0 || aggregate.topPlayers.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card className="border-[hsl(var(--border)/0.5)]">
            <CardHeader className="py-3 border-b border-[hsl(var(--border)/0.5)]">
              <div className="flex items-center gap-2">
                <Globe className="size-4 text-blue-400" />
                <CardTitle className="text-xs">{t("radar.analysis.topWorlds", { defaultValue: "Most-visited worlds" })}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {aggregate.topWorlds.length === 0 ? (
                <div className="p-4 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("radar.analysis.empty", { defaultValue: "No data yet." })}
                </div>
              ) : (
                <ul className="divide-y divide-[hsl(var(--border)/0.4)]">
                  {aggregate.topWorlds.map((w) => (
                    <li key={w.worldId} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <WorldPopupBadge worldId={w.worldId} />
                      </div>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        ×{w.count}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card className="border-[hsl(var(--border)/0.5)]">
            <CardHeader className="py-3 border-b border-[hsl(var(--border)/0.5)]">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-emerald-400" />
                <CardTitle className="text-xs">{t("radar.analysis.topPlayers", { defaultValue: "Most-encountered players" })}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {aggregate.topPlayers.length === 0 ? (
                <div className="p-4 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("radar.analysis.empty", { defaultValue: "No data yet." })}
                </div>
              ) : (
                <ul className="divide-y divide-[hsl(var(--border)/0.4)]">
                  {aggregate.topPlayers.map((p) => (
                    <li key={p.userId ?? p.displayName} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <TrustDot tags={p.userId ? playerTags[p.userId] : undefined} />
                        <span className="text-[12px] font-medium truncate">{p.displayName}</span>
                        {p.userId ? (
                          <span className="text-[9px] font-mono text-[hsl(var(--muted-foreground))]">
                            {shortId(p.userId)}
                          </span>
                        ) : null}
                      </div>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        ×{p.count}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader className="py-3 border-b border-[hsl(var(--border))]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="size-4 text-[hsl(var(--primary))]" />
              <CardTitle className="text-sm">
                {t("radar.analysis.sessions", { defaultValue: "Session history" })}
              </CardTitle>
              <CardDescription className="text-[11px]">
                {t("radar.analysis.sessionsDesc", { defaultValue: "Reconstructed from local logs — newest first." })}
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => setRefreshKey((v) => v + 1)}
              disabled={loading}
            >
              <RefreshCw className={cn("size-3 mr-1", loading && "animate-spin")} />
              {t("common.refresh", { defaultValue: "Refresh" })}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-[12px] text-[hsl(var(--muted-foreground))] animate-pulse">
              {t("common.loading", { defaultValue: "Loading…" })}
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-8 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("radar.analysis.empty", { defaultValue: "No sessions found in local logs." })}
            </div>
          ) : (
            <ul className="divide-y divide-[hsl(var(--border)/0.4)]">
              {sessions.map((session, idx) => {
                const isOpen = expanded[session.id] ?? false;
                const isOngoing = idx === 0 && session.endMs === null;
                const durationMs =
                  session.startMs !== null
                    ? (session.endMs ?? Date.now()) - session.startMs
                    : 0;
                return (
                  <li key={session.id} className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => toggle(session.id)}
                      className="flex items-center gap-3 px-3 py-3 text-left hover:bg-[hsl(var(--muted)/0.2)] transition-colors"
                    >
                      <div className="shrink-0">
                        {isOpen ? (
                          <ChevronDown className="size-4 text-[hsl(var(--muted-foreground))]" />
                        ) : (
                          <ChevronRight className="size-4 text-[hsl(var(--muted-foreground))]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold truncate">
                            {session.worldName || shortId(session.worldId) || t("common.unknown", { defaultValue: "Unknown" })}
                          </span>
                          <Badge variant="outline" className="font-mono uppercase text-[9px] tracking-widest">
                            {session.accessType}
                          </Badge>
                          {session.region ? (
                            <Badge variant="secondary" className="font-mono uppercase text-[9px]">
                              {session.region}
                            </Badge>
                          ) : null}
                          {isOngoing ? (
                            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[9px]">
                              {t("radar.analysis.ongoing", { defaultValue: "Ongoing" })}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))] flex items-center gap-2 flex-wrap">
                          <Clock className="size-3" />
                          <span className="font-mono">{formatDateAndTime(session.startTime)}</span>
                          <span>·</span>
                          <span>{formatDuration(durationMs)}</span>
                        </div>
                      </div>
                      <div className="hidden sm:flex items-center gap-3 shrink-0 text-[10px] font-mono text-[hsl(var(--muted-foreground))]">
                        <span title={t("radar.stats.uniquePlayers", { defaultValue: "Unique players" })}>
                          <Users className="inline size-3 mr-0.5" />
                          {session.players.length}
                        </span>
                        <span title={t("radar.stats.peakPlayers", { defaultValue: "Peak players" })}>
                          <TrendingUp className="inline size-3 mr-0.5" />
                          {session.peakConcurrent}
                        </span>
                        <span title={t("radar.stats.avatarChanges", { defaultValue: "Avatar changes" })}>
                          <Palette className="inline size-3 mr-0.5" />
                          {session.avatarChanges}
                        </span>
                      </div>
                    </button>
                    {isOpen ? (
                      <div className="px-4 pb-4 pt-1 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] bg-[hsl(var(--canvas))]">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                            <Globe className="size-3" />
                            {session.worldId ? (
                              <WorldPopupBadge worldId={session.worldId} />
                            ) : (
                              <span className="font-mono">{t("common.unknown", { defaultValue: "Unknown" })}</span>
                            )}
                          </div>
                          <div className="font-mono text-[10px] bg-black/20 p-2 rounded border border-[hsl(var(--border)/0.5)] break-all select-all text-blue-400">
                            {session.instanceId}
                          </div>
                          <div className="text-[11px] font-semibold mt-2 mb-1 flex items-center gap-1">
                            <Users className="size-3 text-emerald-400" />
                            {t("radar.analysis.session.players", { defaultValue: "Players" })}
                            <span className="text-[10px] font-normal text-[hsl(var(--muted-foreground))]">
                              ({session.players.length})
                            </span>
                          </div>
                          {session.players.length === 0 ? (
                            <div className="text-[11px] italic text-[hsl(var(--muted-foreground))]">
                              {t("radar.analysis.session.noPlayers", { defaultValue: "No player events recorded." })}
                            </div>
                          ) : (
                            <ul className="flex flex-col divide-y divide-[hsl(var(--border)/0.3)] border border-[hsl(var(--border)/0.5)] rounded-md bg-[hsl(var(--card))]">
                              {session.players.map((p) => (
                                <li
                                  key={`${session.id}-${p.displayName}`}
                                  className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <TrustDot tags={p.userId ? playerTags[p.userId] : undefined} />
                                    <Dialog>
                                      <DialogTrigger asChild>
                                        <button
                                          type="button"
                                          className="text-[12px] font-medium truncate hover:text-[hsl(var(--primary))] transition-colors"
                                        >
                                          {p.displayName}
                                        </button>
                                      </DialogTrigger>
                                      <PlayerProfileDialog userId={p.userId} displayName={p.displayName} />
                                    </Dialog>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 text-[9px] font-mono text-[hsl(var(--muted-foreground))]">
                                    <span>{formatTimePart(p.joinTime)}</span>
                                    <ArrowRightLeft className="size-2.5 opacity-60" />
                                    <span>{p.leaveTime ? formatTimePart(p.leaveTime) : "—"}</span>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="flex flex-col gap-2">
                          <div className="text-[11px] font-semibold mb-1 flex items-center gap-1">
                            <Clock className="size-3 text-[hsl(var(--primary))]" />
                            {t("radar.analysis.session.timeline", { defaultValue: "Timeline" })}
                            <span className="text-[10px] font-normal text-[hsl(var(--muted-foreground))]">
                              ({session.timeline.length})
                            </span>
                          </div>
                          {session.timeline.length === 0 ? (
                            <div className="text-[11px] italic text-[hsl(var(--muted-foreground))]">
                              {t("radar.timeline.empty", { defaultValue: "No events recorded." })}
                            </div>
                          ) : (
                            <div className="border border-[hsl(var(--border)/0.5)] rounded-md bg-[hsl(var(--card))] max-h-[280px] overflow-y-auto p-2 flex flex-col gap-0.5">
                              {session.timeline.map((entry) => (
                                <div
                                  key={entry.id}
                                  className="flex items-start gap-2 text-[11px] py-0.5"
                                >
                                  <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))] w-[60px] shrink-0">
                                    {formatTimePart(entry.time)}
                                  </span>
                                  {entry.kind === "joined" ? (
                                    <UserPlus className="mt-0.5 size-3 text-emerald-400 shrink-0" />
                                  ) : entry.kind === "left" ? (
                                    <UserMinus className="mt-0.5 size-3 text-red-400 shrink-0" />
                                  ) : (
                                    <Palette className="mt-0.5 size-3 text-purple-400 shrink-0" />
                                  )}
                                  <span className="min-w-0 flex-1 truncate">
                                    <span className="font-medium">{entry.actor}</span>
                                    {entry.detail ? (
                                      <span className="text-[hsl(var(--muted-foreground))]">
                                        {" → "}
                                        <span className="italic text-purple-400">{entry.detail}</span>
                                      </span>
                                    ) : null}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <Card className="border-[hsl(var(--border)/0.5)]">
      <CardContent className="flex items-center gap-3 p-3">
        <div className="flex size-9 items-center justify-center rounded-md bg-[hsl(var(--muted)/0.4)]">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] truncate">
            {label}
          </div>
          <div className="text-[18px] font-semibold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Radar() {
  const { t } = useTranslation();
  const { status: vrcProcessStatus, loading } = useVrcProcess();
  const vrcRunning = loading ? null : vrcProcessStatus.running;
  const [tab, setTab] = useState<RadarTab>("live");
  const [showTimeline, setShowTimeline] = useUiPrefBoolean("vrcsm.layout.radar.timeline.visible", true);

  return (
    <div className="flex flex-col gap-4 animate-fade-in pb-12">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("nav.radar")}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("radar.subtitle", {
              defaultValue: "Real-time player monitoring via log tailing",
            })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
              tab === "live"
                ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]",
            )}
            onClick={() => setTab("live")}
          >
            <Radio className="size-3.5" />
            {t("radar.title", { defaultValue: "Live Instance Radar" })}
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
              tab === "analysis"
                ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]",
            )}
            onClick={() => setTab("analysis")}
          >
            <BarChart3 className="size-3.5" />
            {t("radar.analysis.tab", { defaultValue: "Historical Analysis" })}
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
              tab === "history"
                ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]",
            )}
            onClick={() => setTab("history")}
          >
            <FileClock className="size-3.5" />
            {t("nav.friendLog")}
          </button>
        </div>
      </header>

      {tab === "history" ? (
        <FriendLogPanel embedded />
      ) : tab === "analysis" ? (
        <RadarHistoryAnalysis />
      ) : vrcRunning === false ? (
        <div className="flex flex-col gap-4">
          <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.1)] p-8 text-center text-[hsl(var(--muted-foreground))] opacity-70">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
              <Globe className="size-6 text-[hsl(var(--muted-foreground)/0.5)]" />
            </div>
            <h3 className="mb-1 text-sm font-semibold text-[hsl(var(--foreground))]">{t("radar.vrcNotRunning")}</h3>
            <p className="text-xs">{t("radar.vrcNotRunningHint")}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 h-7 text-[11px]"
              onClick={() => setTab("analysis")}
            >
              <BarChart3 className="size-3 mr-1.5" />
              {t("radar.analysis.openFromOffline", { defaultValue: "Browse historical analysis" })}
            </Button>
          </div>
        </div>
      ) : vrcRunning === null ? null : (
        <RadarEngine
          onOpenHistory={() => setTab("history")}
          showTimeline={showTimeline}
          onToggleTimeline={() => setShowTimeline((current) => !current)}
        />
      )}
    </div>
  );
}
