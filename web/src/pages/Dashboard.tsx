import { ipc } from "@/lib/ipc";
import { getTrueCacheBytes, getTrueCacheCategoryCount } from "@/lib/report-metrics";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useReport } from "@/lib/report-context";
import { useAuth } from "@/lib/auth-context";
import { cn, formatBytes, formatDate } from "@/lib/utils";
import { useVrcProcess } from "@/lib/vrc-context";
import type { FriendsListResult, Report } from "@/lib/types";
import {
  AlertTriangle,
  Camera,
  Clock,
  Database,
  FolderTree,
  Globe2,
  HardDrive,
  ScrollText,
  Shirt,
  Users,
  Wrench,
  Activity,
  Wifi,
  WifiOff,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

// ── Palette ────────────────────────────────────────────────────────────
// Unity editor-ish categorical palette — muted, no purple, no neon glow.
const palette = [
  "#3B8FD6", // unity blue (primary)
  "#6FB35C", // unity green
  "#D99447", // amber
  "#C25B5B", // brick red
  "#4EA5A5", // teal
  "#8F8F8F", // neutral grey
  "#B8A04D", // olive
  "#6C7EC4", // steel blue
];

// ── Types ──────────────────────────────────────────────────────────────

interface StatCardProps {
  title: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: "default" | "warning" | "success" | "info";
  onClick?: () => void;
}

/** A unified timeline entry assembled from world/player/avatar events. */
interface TimelineEntry {
  kind: "world" | "player_joined" | "player_left" | "avatar";
  time: string;
  label: string;
  detail?: string;
}

interface DbWorldVisit {
  id: number;
  world_id: string | null;
  instance_id: string | null;
  access_type: string | null;
  owner_id: string | null;
  region: string | null;
  joined_at: string | null;
  left_at: string | null;
}

interface DbPlayerEvent {
  id: number;
  kind: string | null;
  user_id: string | null;
  display_name: string | null;
  world_id: string | null;
  instance_id: string | null;
  occurred_at: string | null;
}

// ── Sub-components ─────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  hint,
  icon,
  tone = "default",
  onClick,
}: StatCardProps) {
  const toneRing =
    tone === "warning"
      ? "shadow-[inset_0_0_0_1px_hsl(var(--warning)/0.45)]"
      : tone === "success"
        ? "shadow-[inset_0_0_0_1px_hsl(var(--success)/0.35)]"
        : "";
  const iconBg =
    tone === "warning"
      ? "bg-[hsl(var(--warning)/0.14)] text-[hsl(var(--warning))]"
      : tone === "success"
        ? "bg-[hsl(var(--success)/0.14)] text-[hsl(var(--success))]"
        : tone === "info"
          ? "bg-[hsl(var(--primary)/0.22)] text-[hsl(var(--primary))]"
          : "bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]";
  return (
    <Card
      className={cn(
        "p-0 transition-colors",
        toneRing,
        onClick && "cursor-pointer hover:bg-[hsl(var(--surface-raised)/0.7)]",
      )}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-3 p-3 pb-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardDescription className="text-[10px] uppercase tracking-wider">
            {title}
          </CardDescription>
          <div className="text-[22px] font-semibold leading-none tracking-tight tabular-nums">
            {value}
          </div>
        </div>
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)]",
            iconBg,
          )}
        >
          {icon}
        </div>
      </CardHeader>
      {hint ? (
        <CardContent className="flex items-center gap-1 px-3 pt-0 pb-2 text-[11px] text-[hsl(var(--muted-foreground))]">
          {hint}
          {onClick && (
            <ChevronRight className="size-3 opacity-50" />
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card>
      <CardHeader>
        <div className="h-3 w-24 animate-pulse rounded bg-[hsl(var(--muted))]" />
        <div className="mt-2 h-8 w-32 animate-pulse rounded bg-[hsl(var(--muted))]" />
      </CardHeader>
    </Card>
  );
}


/** Format a VRChat log-style timestamp (2026.04.15 00:42:02) into a
 *  short locale time string. Falls back gracefully if unparseable. */
function shortTime(iso: string | null | undefined): string {
  if (!iso) return "--:--";
  // VRChat logs use "YYYY.MM.DD HH:MM:SS" — replace dots with dashes
  // for Date.parse, but also accept real ISO strings.
  const normalized = iso.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, "$1-$2-$3");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Compute human-readable elapsed time from an ISO/VRChat timestamp. */
function elapsedSince(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const normalized = iso.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, "$1-$2-$3");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  const ms = Date.now() - d.getTime();
  if (ms < 0) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

function elapsedBetween(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string | null {
  if (!startIso || !endIso) return null;
  const start = parseLogTime(startIso);
  const end = parseLogTime(endIso);
  if (start === null || end === null || end < start) return null;
  const mins = Math.floor((end - start) / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

function parseLogTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const normalized = iso.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, "$1-$2-$3");
  const parsed = new Date(normalized).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

const timelineIconMap: Record<
  TimelineEntry["kind"],
  { icon: typeof Globe2; colorClass: string }
> = {
  world: { icon: Globe2, colorClass: "bg-[#3B8FD6]/20 text-[#3B8FD6]" },
  player_joined: {
    icon: Users,
    colorClass: "bg-[#6FB35C]/20 text-[#6FB35C]",
  },
  player_left: { icon: Users, colorClass: "bg-[#8F8F8F]/20 text-[#8F8F8F]" },
  avatar: { icon: Shirt, colorClass: "bg-[#D99447]/20 text-[#D99447]" },
};

// ── Main Component ─────────────────────────────────────────────────────

function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { report, loading, error, refresh } = useReport();
  const { status: authStatus } = useAuth();

  // ── VRChat process status (via context) ──
  const { status: vrcProcessStatus } = useVrcProcess();
  const vrcRunning = vrcProcessStatus.running;
  const [repairingBrokenLinks, setRepairingBrokenLinks] = useState(false);
  const [screenshotCount, setScreenshotCount] = useState<number | null>(null);
  const [dbVisits, setDbVisits] = useState<DbWorldVisit[]>([]);
  const [dbSessionEvents, setDbSessionEvents] = useState<DbPlayerEvent[]>([]);

  // ── Friends online count (fire-and-forget, non-blocking) ──
  const [friendsOnline, setFriendsOnline] = useState<number | null>(null);
  useEffect(() => {
    if (!authStatus.authed) {
      setFriendsOnline(null);
      return;
    }
    let alive = true;
    ipc
      .call<undefined, FriendsListResult>("friends.list")
      .then((r) => {
        if (!alive) return;
        const online = r.friends.filter(
          (f) => f.location && f.location !== "offline",
        ).length;
        setFriendsOnline(online);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [authStatus.authed]);

  useEffect(() => {
    let alive = true;
    ipc
      .call<undefined, { screenshots: Array<unknown> }>("screenshots.list", undefined)
      .then((result) => {
        if (!alive) return;
        setScreenshotCount(result.screenshots.length);
      })
      .catch(() => {
        if (!alive) return;
        setScreenshotCount(null);
      });
    return () => {
      alive = false;
    };
  }, [report?.generated_at]);

  useEffect(() => {
    let alive = true;
    ipc.dbWorldVisits(20, 0)
      .then((result) => {
        if (!alive) return;
        setDbVisits((result.items ?? []) as DbWorldVisit[]);
      })
      .catch(() => {
        if (!alive) return;
        setDbVisits([]);
      });
    return () => {
      alive = false;
    };
  }, [report?.generated_at]);

  const selectedDbVisit = useMemo(() => {
    if (dbVisits.length === 0) {
      return null;
    }

    if (vrcRunning) {
      return dbVisits[0] ?? null;
    }

    return dbVisits.find((visit) => Boolean(visit.left_at)) ?? null;
  }, [dbVisits, vrcRunning]);

  useEffect(() => {
    let alive = true;
    if (!selectedDbVisit?.world_id || !selectedDbVisit.instance_id || !selectedDbVisit.joined_at) {
      setDbSessionEvents([]);
      return () => {
        alive = false;
      };
    }

    ipc.dbPlayerEvents(500, 0, {
      worldId: selectedDbVisit.world_id,
      instanceId: selectedDbVisit.instance_id,
      occurredAfter: selectedDbVisit.joined_at,
      occurredBefore: selectedDbVisit.left_at ?? undefined,
    })
      .then((result) => {
        if (!alive) return;
        setDbSessionEvents((result.items ?? []) as DbPlayerEvent[]);
      })
      .catch(() => {
        if (!alive) return;
        setDbSessionEvents([]);
      });

    return () => {
      alive = false;
    };
  }, [
    selectedDbVisit?.world_id,
    selectedDbVisit?.instance_id,
    selectedDbVisit?.joined_at,
    selectedDbVisit?.left_at,
  ]);

  // ── "Repair" shortcut ──
  const repairJunction = (category: string) => {
    navigate(`/migrate?category=${encodeURIComponent(category)}`);
  };

  async function handleRepairBrokenLink(link: Report["broken_links"][number]) {
    await ipc.call<
      { source: string; target?: string },
      { ok: boolean; target: string | null }
    >("junction.repair", {
      source: link.source_path,
      target: link.target_path ?? undefined,
    });
  }

  async function handleRepairAllBrokenLinks() {
    if (!report || report.broken_links.length === 0) return;
    setRepairingBrokenLinks(true);
    try {
      for (const link of report.broken_links) {
        await handleRepairBrokenLink(link);
      }
      toast.success(
        t("dashboard.repairAllSuccess", {
          count: report.broken_links.length,
          defaultValue: "Repaired {{count}} broken cache links",
        }),
      );
      refresh();
    } catch (e) {
      toast.error(
        t("dashboard.repairAllFailed", {
          error: e instanceof Error ? e.message : String(e),
          defaultValue: "Repair failed: {{error}}",
        }),
      );
    } finally {
      setRepairingBrokenLinks(false);
    }
  }

  // ── Assemble timeline from report logs ──
  const timeline = useMemo<TimelineEntry[]>(() => {
    if (!report) return [];
    const logs = report.logs;
    const entries: TimelineEntry[] = [];

    // World switches
    for (const ws of logs.world_switches) {
      const worldName =
        logs.world_names[ws.world_id] ??
        ws.world_id.slice(0, 20) + "...";
      entries.push({
        kind: "world",
        time: ws.iso_time ?? "",
        label: worldName,
        detail: ws.access_type
          ? `${ws.access_type}${ws.region ? ` (${ws.region})` : ""}`
          : undefined,
      });
    }

    // Player events
    for (const pe of logs.player_events) {
      entries.push({
        kind: pe.kind === "joined" ? "player_joined" : "player_left",
        time: pe.iso_time ?? "",
        label: pe.display_name,
        detail:
          pe.kind === "joined"
            ? t("dashboard.playerJoined", { defaultValue: "joined" })
            : t("dashboard.playerLeft", { defaultValue: "left" }),
      });
    }

    // Avatar switches
    for (const av of logs.avatar_switches) {
      entries.push({
        kind: "avatar",
        time: av.iso_time ?? "",
        label: av.avatar_name,
        detail: av.actor,
      });
    }

    // Sort descending by time, take the most recent 10
    entries.sort((a, b) => (b.time > a.time ? 1 : b.time < a.time ? -1 : 0));
    return entries.slice(0, 10);
  }, [report, t]);

  // ── Current session data ──
  const currentSession = useMemo(() => {
    if (!report) return null;
    const logs = report.logs;

    if (selectedDbVisit?.world_id && selectedDbVisit.joined_at) {
      const activeMap = new Map<string, string>();
      const seenMap = new Map<string, string>();

      const relevantDbEvents = dbSessionEvents
        .map((entry) => ({
          entry,
          time: parseLogTime(entry.occurred_at),
        }))
        .filter(({ entry, time }) => {
          if (time === null) {
            return false;
          }
          if (entry.world_id !== selectedDbVisit.world_id) {
            return false;
          }
          if (entry.instance_id !== selectedDbVisit.instance_id) {
            return false;
          }
          return true;
        })
        .sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

      for (const { entry } of relevantDbEvents) {
        const displayName = entry.display_name?.trim();
        if (!displayName) {
          continue;
        }
        const key = entry.user_id || displayName;
        if (entry.kind === "joined") {
          activeMap.set(key, displayName);
          seenMap.set(key, displayName);
        } else if (entry.kind === "left") {
          activeMap.delete(key);
        }
      }

      const players = Array.from(
        (vrcRunning
          ? (activeMap.size > 0 ? activeMap : seenMap)
          : seenMap).values(),
      )
        .sort((a, b) => a.localeCompare(b));

      return {
        worldId: selectedDbVisit.world_id,
        worldName:
          logs.world_names[selectedDbVisit.world_id] ??
          selectedDbVisit.world_id.slice(0, 20) + "...",
        players,
        accessType: selectedDbVisit.access_type ?? null,
        region: selectedDbVisit.region ?? null,
        joinTime: selectedDbVisit.joined_at,
        endTime: selectedDbVisit.left_at ?? null,
      };
    }

    const orderedSwitches = [...logs.world_switches]
      .map((entry) => ({
        entry,
        time: parseLogTime(entry.iso_time),
      }))
      .filter((entry) => entry.time !== null)
      .sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    const latestSwitch = orderedSwitches.at(-1)?.entry ?? null;
    if (!latestSwitch) return null;

    const latestWorldId = latestSwitch.world_id;
    const worldName = logs.world_names[latestWorldId] ?? null;
    const sessionStart = parseLogTime(latestSwitch.iso_time);
    const activeMap = new Map<string, string>();
    const seenMap = new Map<string, string>();

    const relevantEvents = logs.player_events
      .map((entry) => ({
        entry,
        time: parseLogTime(entry.iso_time),
      }))
      .filter(({ time }) => {
        if (time === null || sessionStart === null) {
          return false;
        }
        return time >= sessionStart;
      })
      .sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

    for (const { entry } of relevantEvents) {
      const displayName = entry.display_name?.trim();
      if (!displayName) {
        continue;
      }
      const key = entry.user_id || displayName;
      if (entry.kind === "joined") {
        activeMap.set(key, displayName);
        seenMap.set(key, displayName);
      } else {
        activeMap.delete(key);
      }
    }

    const players = Array.from((activeMap.size > 0 ? activeMap : seenMap).values())
      .sort((a, b) => a.localeCompare(b));

    return {
      worldId: latestWorldId,
      worldName,
      players,
      accessType: latestSwitch?.access_type ?? null,
      region: latestSwitch?.region ?? null,
      joinTime: latestSwitch?.iso_time ?? null,
      endTime: null,
    };
  }, [dbSessionEvents, report, selectedDbVisit, vrcRunning]);

  // ── Ranked storage data ──
  const ranked = useMemo(() => {
    if (!report) return { items: [], total: 0 };
    const items = report.category_summaries
      .filter((c) => c.bytes > 0)
      .map((c) => ({ name: c.name, value: c.bytes }))
      .sort((a, b) => b.value - a.value);
    const total = items.reduce((sum, c) => sum + c.value, 0);
    return { items, total };
  }, [report]);

  // ── Loading state ──
  if (loading && !report) {
    return (
      <div className="grid gap-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
          {t("dashboard.title")}
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error || !report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.scanFailed")}</CardTitle>
          <CardDescription>{error ?? t("common.unknownError")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={refresh}>{t("common.retry")}</Button>
        </CardContent>
      </Card>
    );
  }

  const visibleScreenshotCount = screenshotCount ?? report.logs.screenshots.length;
  const top = report.cache_windows_player.largest_entries.slice(0, 8);
  const trueCacheBytes = getTrueCacheBytes(report);
  const trueCacheCategoryCount = getTrueCacheCategoryCount(report);

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {/* ── Header ── */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold tracking-tight text-[hsl(var(--foreground))]">
              {t("dashboard.title")}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              overview
            </span>
            {vrcRunning ? (
              <Badge
                variant="default"
                className="ml-1 gap-1 bg-[#6FB35C]/20 text-[#6FB35C] text-[10px] font-mono uppercase border-0"
              >
                <Wifi className="size-3" />
                {t("dashboard.vrcOnline", { defaultValue: "VRChat Online" })}
              </Badge>
            ) : (
              <Badge
                variant="secondary"
                className="ml-1 gap-1 text-[10px] font-mono uppercase"
              >
                <WifiOff className="size-3" />
                {t("dashboard.vrcOffline", { defaultValue: "VRChat Offline" })}
              </Badge>
            )}
          </div>
          <p className="truncate font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            {report.base_dir}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            {t("common.rescan")}
          </Button>
        </div>
      </header>

      {/* ── Current / Last Session Card ── */}
      {currentSession && currentSession.worldName && (
        <Card className={cn(
          "shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.2)]",
          vrcRunning
            ? "bg-gradient-to-r from-[hsl(var(--primary)/0.04)] to-transparent"
            : "bg-gradient-to-r from-[hsl(var(--muted)/0.15)] to-transparent opacity-75",
        )}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "flex size-8 items-center justify-center rounded-full",
                  vrcRunning ? "bg-[#3B8FD6]/20 text-[#3B8FD6]" : "bg-[#8F8F8F]/20 text-[#8F8F8F]",
                )}>
                  <Globe2 className="size-4" />
                </div>
                <div>
                  <CardTitle className="text-[13px]">
                    {vrcRunning
                      ? t("dashboard.currentSession", { defaultValue: "Current Session" })
                      : t("dashboard.lastSession", { defaultValue: "Last Session" })}
                  </CardTitle>
                  <CardDescription className="text-[11px]">
                    {currentSession.worldName}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {currentSession.accessType && (
                  <Badge
                    variant="outline"
                    className="text-[10px] font-mono uppercase"
                  >
                    {currentSession.accessType}
                    {currentSession.region && ` / ${currentSession.region}`}
                  </Badge>
                )}
                {currentSession.joinTime && (
                  <div className="flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                    <Clock className="size-3" />
                    {vrcRunning
                      ? (elapsedSince(currentSession.joinTime) ??
                        shortTime(currentSession.joinTime))
                      : (elapsedBetween(currentSession.joinTime, currentSession.endTime) ??
                        shortTime(currentSession.joinTime))}
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          {currentSession.players.length > 0 && (
            <CardContent className="pt-0 pb-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Users className="size-3.5 text-[hsl(var(--muted-foreground))]" />
                <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                  {vrcRunning
                    ? t("dashboard.playersInWorld", {
                        count: currentSession.players.length,
                        defaultValue: "{{count}} players",
                      })
                    : t("dashboard.playersLastSeen", {
                        count: currentSession.players.length,
                        defaultValue: "{{count}} players (last seen)",
                      })}
                  :
                </span>
                {currentSession.players.slice(0, 12).map((name) => (
                  <Badge
                    key={name}
                    variant="secondary"
                    className="text-[10px] font-normal"
                  >
                    {name}
                  </Badge>
                ))}
                {currentSession.players.length > 12 && (
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                    +{currentSession.players.length - 12}
                  </span>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* ── Quick Stats Grid ── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <StatCard
          title={t("dashboard.totalCache")}
          value={formatBytes(trueCacheBytes)}
          hint={t("dashboard.totalCacheHint", {
            count: trueCacheCategoryCount,
          })}
          icon={<Database className="size-5" />}
          onClick={() => navigate("/bundles")}
        />
        <StatCard
          title={t("dashboard.categories")}
          value={String(report.category_summaries.length)}
          hint={t("dashboard.categoriesHint", {
            count: report.existing_category_count,
          })}
          icon={<FolderTree className="size-5" />}
          onClick={() => navigate("/settings")}
        />
        <StatCard
          title={t("dashboard.brokenJunctions")}
          value={String(report.broken_links.length)}
          hint={
            report.broken_links.length > 0
              ? t("dashboard.brokenJunctionsNeeded")
              : t("dashboard.brokenJunctionsClear")
          }
          icon={<AlertTriangle className="size-5" />}
          tone={report.broken_links.length > 0 ? "warning" : "success"}
          onClick={() => navigate("/migrate")}
        />
        <StatCard
          title={t("dashboard.logs")}
          value={String(report.logs.log_count)}
          hint={t("dashboard.logsHint", {
            count: report.logs.world_event_count,
          })}
          icon={<ScrollText className="size-5" />}
          onClick={() => navigate("/logs")}
        />
        <StatCard
          title={t("dashboard.friendsOnline", {
            defaultValue: "Friends online",
          })}
          value={
            friendsOnline !== null ? String(friendsOnline) : "--"
          }
          hint={
            authStatus.authed
              ? t("dashboard.friendsOnlineHint", {
                  defaultValue: "from VRChat API",
                })
              : t("dashboard.signInForFriends", {
                  defaultValue: "sign in to view",
                })
          }
          icon={<Users className="size-5" />}
          tone="info"
          onClick={() => navigate("/friends")}
        />
        <StatCard
          title={t("dashboard.screenshots", {
            defaultValue: "Screenshots",
          })}
          value={String(visibleScreenshotCount)}
          hint={t("dashboard.screenshotsHint", {
            defaultValue: "files detected on disk",
          })}
          icon={<Camera className="size-5" />}
          onClick={() => navigate("/screenshots")}
        />
      </div>

      {/* ── Middle row: Activity Timeline + Storage ── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))" }}>
        {/* ── Recent Activity Timeline ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-[hsl(var(--primary))]" />
              <CardTitle>
                {t("dashboard.recentActivity", {
                  defaultValue: "Recent Activity",
                })}
              </CardTitle>
            </div>
            <CardDescription>
              {t("dashboard.recentActivityDesc", {
                defaultValue:
                  "World joins, player events, and avatar switches",
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {timeline.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                {t("dashboard.noActivity", {
                  defaultValue: "No recent activity in logs",
                })}
              </div>
            ) : (
              <div className="relative space-y-0">
                {timeline.map((entry, idx) => {
                  const meta = timelineIconMap[entry.kind];
                  const Icon = meta.icon;
                  return (
                    <div
                      key={`${entry.kind}-${entry.time}-${idx}`}
                      className="group relative flex items-start gap-3 py-1.5"
                    >
                      <div
                        className={cn(
                          "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full",
                          meta.colorClass,
                        )}
                      >
                        <Icon className="size-3.5" />
                      </div>
                      <div className="flex min-w-0 flex-1 items-baseline gap-2 pt-0.5">
                        <span className="min-w-0 flex-1 truncate text-[12px] text-[hsl(var(--foreground))]">
                          {entry.label}
                        </span>
                        {entry.detail && (
                          <span className="shrink-0 text-[10px] text-[hsl(var(--muted-foreground))]">
                            {entry.detail}
                          </span>
                        )}
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]">
                          {shortTime(entry.time)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Storage by Category ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <HardDrive className="size-4 text-[hsl(var(--primary))]" />
              <CardTitle>{t("dashboard.storageByCategory")}</CardTitle>
            </div>
            <CardDescription>
              {t("dashboard.storageByCategoryDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {/* Stacked horizontal bar */}
            <div className="flex h-3 w-full overflow-hidden rounded-[var(--radius-sm)] bg-[hsl(var(--canvas))] shadow-[inset_0_0_0_1px_hsl(var(--border))]">
              {ranked.items.length === 0 ? (
                <div className="h-full w-full bg-[hsl(var(--muted))]" />
              ) : (
                ranked.items.map((c, idx) => (
                  <div
                    key={c.name}
                    className="h-full transition-[width] duration-300 ease-out"
                    style={{
                      width: `${(c.value / ranked.total) * 100}%`,
                      background: palette[idx % palette.length],
                    }}
                    title={`${c.name}: ${formatBytes(c.value)}`}
                  />
                ))
              )}
            </div>
            {/* Ranked table */}
            <div className="flex flex-col divide-y divide-[hsl(var(--border)/0.6)]">
              {ranked.items.map((c, idx) => {
                const pct = (c.value / ranked.total) * 100;
                return (
                  <div
                    key={c.name}
                    className="flex items-center gap-3 py-1.5"
                  >
                    <span
                      className="size-2 shrink-0 rounded-sm"
                      style={{
                        background: palette[idx % palette.length],
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[hsl(var(--foreground))]">
                      {c.name}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">
                      {pct.toFixed(1)}%
                    </span>
                    <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-[hsl(var(--foreground))]">
                      {formatBytes(c.value)}
                    </span>
                  </div>
                );
              })}
              {ranked.items.length === 0 && (
                <div className="py-3 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("common.none")}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Bottom row: Top Bundles ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.topBundles")}</CardTitle>
          <CardDescription>{t("dashboard.topBundlesDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="min-w-0 overflow-x-auto pb-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("dashboard.entry")}</TableHead>
                  <TableHead>{t("dashboard.size")}</TableHead>
                  <TableHead>{t("dashboard.modified")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.map((e) => (
                  <TableRow key={e.entry}>
                    <TableCell className="font-mono text-[11px]">
                      {e.entry}
                    </TableCell>
                    <TableCell className="text-xs">{e.bytes_human}</TableCell>
                    <TableCell className="text-[11px] text-[hsl(var(--muted-foreground))]">
                      {formatDate(e.latest_mtime)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Broken Junctions ── */}
      {report.broken_links.length > 0 && (
        <Card className="shadow-[inset_0_0_0_1px_hsl(var(--destructive)/0.3)]">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{t("dashboard.brokenTitle")}</CardTitle>
                <CardDescription>{t("dashboard.brokenDesc")}</CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={repairingBrokenLinks}
                onClick={() => void handleRepairAllBrokenLinks()}
              >
                <Wrench className={cn("size-3.5", repairingBrokenLinks && "animate-pulse")} />
                {repairingBrokenLinks
                  ? t("dashboard.repairingAll", { defaultValue: "Repairing..." })
                  : t("dashboard.repairAll", { defaultValue: "Repair all" })}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0">
            {report.broken_links.map((b) => (
              <div
                key={b.category}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.35)] bg-[hsl(var(--destructive)/0.08)] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="destructive"
                      className="font-mono text-[10px]"
                    >
                      {b.category}
                    </Badge>
                    <span className="text-[11px] text-[hsl(var(--foreground))]">
                      {b.reason}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                    {b.source_path}
                  </div>
                  {b.target_path ? (
                    <div className="truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                      → {b.target_path}
                    </div>
                  ) : null}
                  <div className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                    {t("dashboard.brokenRepairHint", {
                      defaultValue:
                        "Repair will recreate the missing target folder and restore the NTFS junction.",
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void handleRepairBrokenLink(b)
                        .then(() => {
                          toast.success(
                            t("migrate.repairSuccess", {
                              defaultValue: "Junction repaired successfully",
                            }),
                          );
                          refresh();
                        })
                        .catch((e) => {
                          toast.error(
                            t("migrate.repairFailed", {
                              error: e instanceof Error ? e.message : String(e),
                              defaultValue: "Repair failed: {{error}}",
                            }),
                          );
                        });
                    }}
                  >
                    <Wrench className="size-3" />
                    {t("common.repair")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => repairJunction(b.category)}
                  >
                  <Wrench className="size-3" />
                    {t("dashboard.openRepairPage", { defaultValue: "Advanced" })}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default Dashboard;
