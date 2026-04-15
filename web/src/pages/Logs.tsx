import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ipc } from "@/lib/ipc";
import { useReport } from "@/lib/report-context";
import type {
  AvatarNameInfo,
  AvatarSwitchEvent,
  LogEnvironment,
  LogSettingsSection,
  PlayerEvent,
  ScreenshotEvent,
} from "@/lib/types";
import {
  Camera,
  LogIn,
  LogOut,
  Search,
  Shirt,
  UserRound,
} from "lucide-react";

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

function shortId(id: string): string {
  const clean = id.replace(/^(wrld|avtr)_/, "");
  if (clean.length <= 14) return clean;
  return `${clean.slice(0, 8)}…${clean.slice(-4)}`;
}

/**
 * Take a sticky `YYYY.MM.DD HH:MM:SS` timestamp from the backend and render
 * it compact (`MM-DD HH:MM:SS`). Returns `—` for null so we don't leave the
 * column empty on older-build lines. Unknown shapes fall back to the raw
 * value so we never silently hide data.
 */
function formatIsoTime(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!m) return iso;
  return `${m[2]}-${m[3]} ${m[4]}`;
}

/**
 * Pull the file leaf off a Windows path without touching `path/posix` (we
 * keep this file dependency-free). Log paths look like
 * `C:\Users\x\Pictures\VRChat\2026-04\VRChat_2026-04-15_02-18-44.439_1920x1080.png`.
 */
function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i >= 0 ? p.slice(i + 1) : p;
}

// Cap on each live-delta array. The page merges baseline (batch-parsed)
// events with events arriving from `logs.stream.event`, and without a cap
// a long session would pile up thousands of entries in browser state. 200
// is well past "what's on screen right now" for any of the 3 panels.
const LIVE_DELTA_CAP = 200;

interface ClassifiedStreamPayload {
  kind: "player" | "avatarSwitch" | "screenshot";
  data: PlayerEvent | AvatarSwitchEvent | ScreenshotEvent;
}

function Logs() {
  const { t } = useTranslation();
  const { report, loading, error } = useReport();
  const logs = report?.logs ?? null;
  const [settingsFilter, setSettingsFilter] = useState("");
  const [playerFilter, setPlayerFilter] = useState("");
  const [avatarFilter, setAvatarFilter] = useState("");

  // Live deltas on top of the batch-parsed baseline. Populated by the
  // `logs.stream.event` subscription below — LogTailer seeks to EOF when
  // it attaches, so events that land here are strictly newer than anything
  // already in `logs.player_events` / `avatar_switches` / `screenshots`,
  // which means we can append without worrying about duplicates.
  const [livePlayer, setLivePlayer] = useState<PlayerEvent[]>([]);
  const [liveSwitch, setLiveSwitch] = useState<AvatarSwitchEvent[]>([]);
  const [liveScreenshot, setLiveScreenshot] = useState<ScreenshotEvent[]>([]);

  useEffect(() => {
    // The stream is owned by BottomDock (always mounted in the main shell)
    // but calling `start` here as well is idempotent on the C++ side and
    // makes the page safe to host in any future layout where the dock
    // might be collapsed or hidden.
    void ipc.call("logs.stream.start").catch(() => undefined);

    const off = ipc.on<ClassifiedStreamPayload>("logs.stream.event", (payload) => {
      if (!payload || typeof payload !== "object") return;
      if (payload.kind === "player") {
        setLivePlayer((prev) => {
          const next = [...prev, payload.data as PlayerEvent];
          return next.length > LIVE_DELTA_CAP
            ? next.slice(next.length - LIVE_DELTA_CAP)
            : next;
        });
      } else if (payload.kind === "avatarSwitch") {
        setLiveSwitch((prev) => {
          const next = [...prev, payload.data as AvatarSwitchEvent];
          return next.length > LIVE_DELTA_CAP
            ? next.slice(next.length - LIVE_DELTA_CAP)
            : next;
        });
      } else if (payload.kind === "screenshot") {
        setLiveScreenshot((prev) => {
          const next = [...prev, payload.data as ScreenshotEvent];
          return next.length > LIVE_DELTA_CAP
            ? next.slice(next.length - LIVE_DELTA_CAP)
            : next;
        });
      }
    });
    return () => {
      off();
    };
  }, []);

  const filteredSections = useMemo<LogSettingsSection[]>(() => {
    if (!logs) return [];
    const q = settingsFilter.trim().toLowerCase();
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
  }, [logs, settingsFilter]);

  const hasEnvironment = useMemo(() => {
    if (!logs) return false;
    return ENV_ORDER.some(({ key }) => logs.environment[key] !== null);
  }, [logs]);

  // VRCX-parity event streams. Backend hands us the batch-parsed baseline
  // in file order; we splice in any live deltas that arrived since mount
  // (strictly newer, since LogTailer starts at EOF — no dedupe needed) and
  // then reverse for display so the newest event is at the top.
  const filteredPlayerEvents = useMemo<PlayerEvent[]>(() => {
    if (!logs) return [];
    const merged = [...logs.player_events, ...livePlayer];
    const q = playerFilter.trim().toLowerCase();
    const base = q
      ? merged.filter(
          (e) =>
            e.display_name.toLowerCase().includes(q) ||
            (e.user_id?.toLowerCase().includes(q) ?? false),
        )
      : merged;
    return [...base].reverse();
  }, [logs, livePlayer, playerFilter]);

  const filteredAvatarSwitches = useMemo<AvatarSwitchEvent[]>(() => {
    if (!logs) return [];
    const merged = [...logs.avatar_switches, ...liveSwitch];
    const q = avatarFilter.trim().toLowerCase();
    const base = q
      ? merged.filter(
          (e) =>
            e.actor.toLowerCase().includes(q) ||
            e.avatar_name.toLowerCase().includes(q),
        )
      : merged;
    return [...base].reverse();
  }, [logs, liveSwitch, avatarFilter]);

  const screenshotsDesc = useMemo<ScreenshotEvent[]>(() => {
    if (!logs) return [];
    return [...logs.screenshots, ...liveScreenshot].reverse();
  }, [logs, liveScreenshot]);

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

  const avatarEntries = logs.recent_avatar_ids.map((id) => ({
    id,
    info: logs.avatar_names[id] as AvatarNameInfo | undefined,
  }));

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("logs.title")}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("logs.subtitle", { count: logs.log_count })}
          </p>
        </div>
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
      </header>

      {hasEnvironment ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("logs.environment")}</CardTitle>
            <CardDescription>{t("logs.environmentDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
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
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("logs.recentWorlds")}</CardTitle>
            <CardDescription>
              {t("logs.worldJoins", { count: logs.world_event_count })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pt-0">
            {logs.recent_world_ids.length === 0 ? (
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                {t("logs.noRecentWorlds")}
              </span>
            ) : (
              logs.recent_world_ids.slice(0, 20).map((id) => {
                const name = logs.world_names[id];
                return (
                  <Badge
                    key={id}
                    variant={name ? "secondary" : "outline"}
                    className="max-w-[260px] truncate text-[10px]"
                    title={`${name ?? ""}\n${id}`.trim()}
                  >
                    {name ?? shortId(id)}
                  </Badge>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("logs.recentAvatars")}</CardTitle>
            <CardDescription>
              {t("logs.avatarEvents", { count: logs.avatar_event_count })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pt-0">
            {avatarEntries.length === 0 ? (
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                {t("logs.noRecentAvatars")}
              </span>
            ) : (
              avatarEntries.slice(0, 20).map(({ id, info }) => (
                <Badge
                  key={id}
                  variant={info?.name ? "secondary" : "outline"}
                  className="max-w-[260px] truncate text-[10px]"
                  title={`${info?.name ?? ""}${
                    info?.author ? ` · by ${info.author}` : ""
                  }\n${id}`.trim()}
                >
                  {info?.name ?? shortId(id)}
                </Badge>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle>{t("logs.playerEvents")}</CardTitle>
                <CardDescription className="truncate">
                  {t("logs.playerEventsDesc")}
                </CardDescription>
              </div>
              <Badge variant="muted" className="font-mono">
                {logs.player_events.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <Input
                value={playerFilter}
                onChange={(e) => setPlayerFilter(e.target.value)}
                placeholder={t("logs.filterEvents")}
                className="h-7 pl-7 text-[12px]"
              />
            </div>
            {filteredPlayerEvents.length === 0 ? (
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-4 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
                {t("logs.noPlayerEvents")}
              </div>
            ) : (
              <ul className="scrollbar-thin max-h-72 space-y-0.5 overflow-auto pr-1">
                {filteredPlayerEvents.map((ev, i) => (
                  <li
                    key={`${ev.kind}-${i}-${ev.display_name}-${ev.iso_time ?? ""}`}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 hover:bg-[hsl(var(--surface-raised))]"
                  >
                    {ev.kind === "joined" ? (
                      <LogIn className="size-3 text-[hsl(var(--primary))]" />
                    ) : (
                      <LogOut className="size-3 text-[hsl(var(--muted-foreground))]" />
                    )}
                    <span
                      className="truncate text-[12px] text-[hsl(var(--foreground))]"
                      title={ev.user_id ?? undefined}
                    >
                      {ev.display_name}
                    </span>
                    <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                      {formatIsoTime(ev.iso_time)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle>{t("logs.avatarSwitches")}</CardTitle>
                <CardDescription className="truncate">
                  {t("logs.avatarSwitchesDesc")}
                </CardDescription>
              </div>
              <Badge variant="muted" className="font-mono">
                {logs.avatar_switches.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <Input
                value={avatarFilter}
                onChange={(e) => setAvatarFilter(e.target.value)}
                placeholder={t("logs.filterEvents")}
                className="h-7 pl-7 text-[12px]"
              />
            </div>
            {filteredAvatarSwitches.length === 0 ? (
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-4 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
                {t("logs.noAvatarSwitches")}
              </div>
            ) : (
              <ul className="scrollbar-thin max-h-72 space-y-0.5 overflow-auto pr-1">
                {filteredAvatarSwitches.map((ev, i) => (
                  <li
                    key={`${i}-${ev.actor}-${ev.avatar_name}-${ev.iso_time ?? ""}`}
                    className="flex flex-col gap-0.5 rounded-[var(--radius-sm)] px-2 py-1 hover:bg-[hsl(var(--surface-raised))]"
                  >
                    <div className="flex items-center gap-2">
                      <Shirt className="size-3 shrink-0 text-[hsl(var(--primary))]" />
                      <span className="truncate text-[12px] text-[hsl(var(--foreground))]">
                        {ev.avatar_name}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                        {formatIsoTime(ev.iso_time)}
                      </span>
                    </div>
                    <span className="ml-5 truncate text-[10px] text-[hsl(var(--muted-foreground))]">
                      {ev.actor}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle>{t("logs.screenshotsHeader")}</CardTitle>
                <CardDescription className="truncate">
                  {t("logs.screenshotsDesc")}
                </CardDescription>
              </div>
              <Badge variant="muted" className="font-mono">
                {logs.screenshots.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {screenshotsDesc.length === 0 ? (
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-4 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
                {t("logs.noScreenshots")}
              </div>
            ) : (
              <ul className="scrollbar-thin max-h-80 space-y-0.5 overflow-auto pr-1">
                {screenshotsDesc.map((ev, i) => (
                  <li
                    key={`${i}-${ev.path}`}
                    className="flex flex-col gap-0.5 rounded-[var(--radius-sm)] px-2 py-1 hover:bg-[hsl(var(--surface-raised))]"
                    title={ev.path}
                  >
                    <div className="flex items-center gap-2">
                      <Camera className="size-3 shrink-0 text-[hsl(var(--primary))]" />
                      <span className="truncate font-mono text-[11px] text-[hsl(var(--foreground))]">
                        {basename(ev.path)}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                        {formatIsoTime(ev.iso_time)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

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
    </div>
  );
}

export default Logs;
