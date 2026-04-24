import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  AvatarSwitchEvent,
  LogEnvironment,
  LogSettingsSection,
  PlayerEvent,
  ScreenshotEvent,
  WorldSwitchEvent,
} from "@/lib/types";
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Globe2,
  Search,
  Shirt,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENV_ORDER: Array<{ key: keyof LogEnvironment; label: string }> = [
  { key: "vrchat_build", label: "VRChat Build" },
  { key: "store", label: "Store" },
  { key: "platform", label: "Platform" },
  { key: "device_model", label: "Device Model" },
  { key: "processor", label: "Processor" },
  { key: "system_memory", label: "System Memory" },
  { key: "operating_system", label: "Operating System" },
  { key: "gpu_name", label: "GPU" },
  { key: "gpu_api", label: "Graphics API" },
  { key: "gpu_memory", label: "GPU Memory" },
  { key: "xr_device", label: "XR Device" },
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
  | "world_switch";

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
  world_switch: {
    border: "border-l-blue-500",
    iconBg: "bg-blue-500/15",
    iconColor: "text-blue-400",
    icon: Globe2,
    label: "World",
  },
};

// ---------------------------------------------------------------------------
// Live streaming buffer cap
// ---------------------------------------------------------------------------

const LIVE_DELTA_CAP = 200;

interface ClassifiedStreamPayload {
  kind: "player" | "avatarSwitch" | "screenshot";
  data: PlayerEvent | AvatarSwitchEvent | ScreenshotEvent;
}

// ---------------------------------------------------------------------------
// Filter toggles
// ---------------------------------------------------------------------------

type FilterKey = "players" | "avatars" | "screenshots" | "worlds";

const FILTER_KEYS: FilterKey[] = ["players", "avatars", "screenshots", "worlds"];

const FILTER_LABELS: Record<FilterKey, string> = {
  players: "Players",
  avatars: "Avatars",
  screenshots: "Screenshots",
  worlds: "Worlds",
};

const FILTER_COLORS: Record<FilterKey, string> = {
  players: "bg-emerald-500",
  avatars: "bg-violet-500",
  screenshots: "bg-amber-500",
  worlds: "bg-blue-500",
};

function matchesFilter(kind: TimelineEventKind, filters: Record<FilterKey, boolean>): boolean {
  if (kind === "player_join" || kind === "player_left") return filters.players;
  if (kind === "avatar_switch") return filters.avatars;
  if (kind === "screenshot") return filters.screenshots;
  if (kind === "world_switch") return filters.worlds;
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
    worlds: true,
  });

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [clearingLogFiles, setClearingLogFiles] = useState(false);
  const [clearLogFilesOpen, setClearLogFilesOpen] = useState(false);

  const toggleFilter = useCallback((key: FilterKey) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
    setVisibleCount(PAGE_SIZE);
  }, []);

  // -- Live streaming deltas ------------------------------------------------

  const [livePlayer, setLivePlayer] = useState<PlayerEvent[]>([]);
  const [liveSwitch, setLiveSwitch] = useState<AvatarSwitchEvent[]>([]);
  const [liveScreenshot, setLiveScreenshot] = useState<ScreenshotEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const pendingRef = useRef<{
    player: PlayerEvent[];
    switches: AvatarSwitchEvent[];
    screenshots: ScreenshotEvent[];
  }>({ player: [], switches: [], screenshots: [] });
  const flushTimerRef = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    flushTimerRef.current = null;
    const buf = pendingRef.current;
    if (buf.player.length > 0) {
      const incoming = buf.player;
      buf.player = [];
      setLivePlayer((prev) => {
        const merged = prev.concat(incoming);
        return merged.length > LIVE_DELTA_CAP
          ? merged.slice(merged.length - LIVE_DELTA_CAP)
          : merged;
      });
    }
    if (buf.switches.length > 0) {
      const incoming = buf.switches;
      buf.switches = [];
      setLiveSwitch((prev) => {
        const merged = prev.concat(incoming);
        return merged.length > LIVE_DELTA_CAP
          ? merged.slice(merged.length - LIVE_DELTA_CAP)
          : merged;
      });
    }
    if (buf.screenshots.length > 0) {
      const incoming = buf.screenshots;
      buf.screenshots = [];
      setLiveScreenshot((prev) => {
        const merged = prev.concat(incoming);
        return merged.length > LIVE_DELTA_CAP
          ? merged.slice(merged.length - LIVE_DELTA_CAP)
          : merged;
      });
    }
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
      } else {
        return;
      }
      scheduleFlush();
    });
    return () => {
      off();
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [flushPending]);

  // -- Unified timeline -----------------------------------------------------

  const worldNames = logs?.world_names ?? {};

  const timeline = useMemo<TimelineEvent[]>(() => {
    if (!logs) return [];

    const events: TimelineEvent[] = [];

    for (const ev of logs.player_events.concat(livePlayer)) {
      events.push(playerToTimeline(ev));
    }
    for (const ev of logs.avatar_switches.concat(liveSwitch)) {
      events.push(avatarToTimeline(ev));
    }
    for (const ev of logs.screenshots.concat(liveScreenshot)) {
      events.push(screenshotToTimeline(ev));
    }
    for (const ev of logs.world_switches ?? []) {
      const te = worldToTimeline(ev);
      // Resolve world names
      const name = worldNames[ev.world_id];
      if (name) te.title = name;
      events.push(te);
    }

    // Sort newest first
    events.sort((a, b) => b.sortKey - a.sortKey);
    return events;
  }, [logs, livePlayer, liveSwitch, liveScreenshot, worldNames]);

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
      worlds: 0,
    };
    for (const ev of timeline) {
      if (ev.kind === "player_join" || ev.kind === "player_left") counts.players++;
      else if (ev.kind === "avatar_switch") counts.avatars++;
      else if (ev.kind === "screenshot") counts.screenshots++;
      else if (ev.kind === "world_switch") counts.worlds++;
    }
    return counts;
  }, [timeline]);

  // -- Environment ----------------------------------------------------------

  const hasEnvironment = useMemo(() => {
    if (!logs) return false;
    return ENV_ORDER.some(({ key }) => logs.environment[key] !== null);
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
        <CardContent className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
          {t("logs.scanning")}
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
              Live
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
                {ENV_ORDER.filter(({ key }) => logs.environment[key] !== null).map(
                  ({ key, label }) => (
                    <div
                      key={key}
                      className="flex items-baseline justify-between gap-3 border-b border-dashed border-[hsl(var(--border))] py-1 last:border-b-0"
                    >
                      <span className="text-[11px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                        {label}
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

                      {/* Detail line for avatar switches */}
                      {ev.kind === "avatar_switch" && ev.detail ? (
                        <div className="mt-0.5 truncate text-[10px] text-[hsl(var(--muted-foreground))]">
                          {ev.detail}
                        </div>
                      ) : null}

                      {/* Detail line for player IDs */}
                      {(isJoin || isLeft) && ev.detail ? (
                        <div className="mt-0.5 truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
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
