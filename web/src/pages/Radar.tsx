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

type RadarTab = "live" | "history";

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
            <CardHeader className="py-4 border-b border-[hsl(var(--border)/0.5)]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Clock className="size-3 text-[hsl(var(--muted-foreground))]" />
                  <CardTitle className="text-xs">
                    {t("radar.recentHistory.title", { defaultValue: "Recent Session History" })}
                  </CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => onOpenHistory?.()}
                >
                  {t("radar.recentHistory.open", { defaultValue: "Open Log" })}
                </Button>
              </div>
              <CardDescription className="text-[11px]">
                {t("radar.recentHistory.desc", {
                  defaultValue: "Pulled from the persistent player event database.",
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
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
      ) : vrcRunning === false ? (
        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.1)] p-8 text-center text-[hsl(var(--muted-foreground))] opacity-70">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
            <Globe className="size-6 text-[hsl(var(--muted-foreground)/0.5)]" />
          </div>
          <h3 className="mb-1 text-sm font-semibold text-[hsl(var(--foreground))]">VRChat 未运行</h3>
          <p className="text-xs">游戏启动后在此实时监测房间与玩家动向</p>
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
