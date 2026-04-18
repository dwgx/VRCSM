import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserPopupBadge } from "@/components/UserPopupBadge";
import { WorldPopupBadge } from "@/components/WorldPopupBadge";
import { ipc } from "@/lib/ipc";
import {
  LIBRARY_LIST_NAME,
  useFavoriteActions,
  useFavoriteItems,
} from "@/lib/library";
import { useUiPrefBoolean } from "@/lib/ui-prefs";
import { useReport } from "@/lib/report-context";
import { prefetchThumbnails, useThumbnail } from "@/lib/thumbnails";
import { type WorldSwitchEvent, type PlayerEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Copy, ExternalLink, Globe2, Play, Search, Clock, Lock, Users, EyeOff, Heart, PanelRightClose, PanelRightOpen } from "lucide-react";

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

function SessionPlayerList({
  players,
}: {
  players: Array<{ displayName: string; userId: string | null }>;
}) {
  const { t } = useTranslation();

  return (
    <div className="mt-1 border-t border-[hsl(var(--border)/0.5)] pt-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {t("worlds.playersSeen", { defaultValue: "Players in Room" })} ({players.length})
      </div>
      <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
        {players.map((player) => (
          <div
            key={player.userId || player.displayName}
            className="flex min-w-0 items-center rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1.5"
            title={player.userId || undefined}
          >
            {player.userId?.startsWith("usr_") ? (
              <UserPopupBadge userId={player.userId} />
            ) : (
              <div className="min-w-0 truncate text-[11px] text-[hsl(var(--foreground))]">
                {player.displayName}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Stable string hash used to seed the world tile gradient so each
 * world gets a distinct two-tone fill without pulling from any asset
 * catalog. Same pattern as Avatars.tsx.
 */
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function hueFor(id: string): number {
  return hashString(id) % 360;
}

function shortenId(id: string, head = 10, tail = 6): string {
  const clean = id.replace(/^wrld_/, "");
  if (clean.length <= head + tail + 3) return clean;
  return `${clean.slice(0, head)}…${clean.slice(-tail)}`;
}

function parseLogTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const normalized = value.includes("T")
    ? value
    : value.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, "$1-$2-$3");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function chooseBestVisitForSwitch(
  visits: DbWorldVisit[],
  instanceId: string,
  switchTime: number | null,
  nextSwitchTime: number | null,
): DbWorldVisit | null {
  const candidates = visits.filter(
    (visit) => Boolean(visit.instance_id) && visit.instance_id === instanceId,
  );
  if (candidates.length === 0) {
    return null;
  }

  if (switchTime === null) {
    return candidates[0] ?? null;
  }

  const scored = candidates
    .map((visit) => {
      const join = parseLogTime(visit.joined_at);
      const rawLeft = parseLogTime(visit.left_at);
      const effectiveLeft =
        rawLeft !== null && nextSwitchTime !== null
          ? Math.min(rawLeft, nextSwitchTime)
          : rawLeft ?? nextSwitchTime;
      const containsSwitch =
        join !== null &&
        join <= switchTime &&
        (effectiveLeft === null || effectiveLeft > switchTime);
      const distance =
        join === null ? Number.POSITIVE_INFINITY : Math.abs(join - switchTime);
      return {
        visit,
        join,
        containsSwitch,
        distance,
      };
    })
    .sort((a, b) => {
      if (a.containsSwitch !== b.containsSwitch) {
        return a.containsSwitch ? -1 : 1;
      }
      if ((a.join ?? -Infinity) !== (b.join ?? -Infinity)) {
        return (b.join ?? -Infinity) - (a.join ?? -Infinity);
      }
      return a.distance - b.distance;
    });

  return scored[0]?.visit ?? null;
}

function WorldThumb({
  id,
  className,
  label,
  isFavorited,
  onToggleFavorite,
}: {
  id: string;
  className?: string;
  label?: boolean;
  isFavorited?: boolean;
  onToggleFavorite?: (thumbnailUrl: string | null) => void;
}) {
  const { url } = useThumbnail(id);
  const hue = hueFor(id);
  return (
    <div
      className={`relative ${className ?? "h-20 w-full"}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 68% 46%), hsl(${
          (hue + 60) % 360
        } 52% 22%))`,
      }}
    >
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 2px, transparent 2px 8px)",
        }}
      />
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover animate-fade-in"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : null}
      {label ? (
        <div className="absolute bottom-1 right-1.5 text-[9px] font-mono uppercase tracking-wider text-white/70 drop-shadow">
          wrld
        </div>
      ) : null}
      {onToggleFavorite ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(url);
          }}
          className={cn(
            "absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full border border-black/20 transition-colors",
            isFavorited
              ? "bg-[#C25B5B] text-white"
              : "bg-black/45 text-white/85 hover:bg-black/65",
          )}
          title={isFavorited ? "Remove from library" : "Save to library"}
        >
          <Heart className={cn("size-3", isFavorited && "fill-current")} />
        </button>
      ) : null}
    </div>
  );
}

function WorldTile({
  id,
  name,
  isSelected,
  isFavorited,
  onSelect,
  onToggleFavorite,
}: {
  id: string;
  name: string | null;
  isSelected: boolean;
  isFavorited: boolean;
  onSelect: () => void;
  onToggleFavorite: (thumbnailUrl: string | null) => void;
}) {
  const display = name ?? shortenId(id);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "group relative flex flex-col overflow-hidden rounded-[var(--radius-sm)] border text-left transition-colors " +
        (isSelected
          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.14)]"
          : "border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] hover:border-[hsl(var(--border-strong))]")
      }
    >
      <WorldThumb
        id={id}
        label
        isFavorited={isFavorited}
        onToggleFavorite={onToggleFavorite}
      />
      <div className="flex flex-col gap-0.5 px-2.5 py-2">
        <div className="truncate text-[12px] font-medium text-[hsl(var(--foreground))]">
          {display}
        </div>
        <div className="truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
          {shortenId(id, 8, 4)}
        </div>
      </div>
    </button>
  );
}

function WorldHistoryPanel({
  switches,
  allSwitches,
  playerEvents,
  dbVisits,
  dbPlayerEvents,
}: {
  switches: WorldSwitchEvent[];
  allSwitches: WorldSwitchEvent[];
  playerEvents: PlayerEvent[];
  dbVisits: DbWorldVisit[];
  dbPlayerEvents: DbPlayerEvent[];
}) {
  const { t } = useTranslation();
  if (switches.length === 0) return null;
  const orderedSwitches = [...allSwitches]
    .map((entry, index) => ({
      entry,
      index,
      time: parseLogTime(entry.iso_time),
    }))
    .filter((entry) => entry.time !== null)
    .sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

  return (
    <div className="flex flex-col gap-3 mt-4">
      <div className="text-[12px] font-semibold text-[hsl(var(--foreground))]">
        {t("worlds.joinHistory")}
      </div>
      <div className="flex flex-col gap-2.5">
        {switches.map((ev, i) => {
          let AccessIcon = Globe2;
          let accessLabel = t("worlds.accessPublic");
          if (ev.access_type === "private") {
            AccessIcon = Lock;
            accessLabel = t("worlds.accessPrivate");
          } else if (ev.access_type === "hidden") {
            AccessIcon = EyeOff;
            accessLabel = t("worlds.accessHidden");
          } else if (ev.access_type === "friends") {
            AccessIcon = Users;
            accessLabel = t("worlds.accessFriends");
          } else if (ev.access_type === "group") {
            AccessIcon = Users;
            accessLabel = t("worlds.accessGroup");
          }

          const timeStr = ev.iso_time
            ? new Intl.DateTimeFormat("default", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(ev.iso_time.replace(/\./g, "-")))
            : "Unknown time";

          let sessionPlayers: { displayName: string; userId: string | null }[] = [];
          const orderedIndex = orderedSwitches.findIndex((entry) => entry.entry === ev);
          const nextSwitchTime =
            orderedIndex >= 0 ? orderedSwitches[orderedIndex + 1]?.time ?? null : null;
          const matchedDbVisit = chooseBestVisitForSwitch(
            dbVisits,
            ev.instance_id,
            parseLogTime(ev.iso_time),
            nextSwitchTime,
          );

          if (matchedDbVisit?.joined_at && ev.instance_id) {
            const visitStart = parseLogTime(matchedDbVisit.joined_at);
            const rawVisitEnd = parseLogTime(matchedDbVisit.left_at);
            const visitEnd =
              rawVisitEnd !== null && nextSwitchTime !== null
                ? Math.min(rawVisitEnd, nextSwitchTime)
                : rawVisitEnd ?? nextSwitchTime;
            const seenMap = new Map<string, { displayName: string; userId: string | null }>();
            const activeMap = new Map<string, { displayName: string; userId: string | null }>();

            const relevantDbEvents = dbPlayerEvents
              .map((entry) => ({
                entry,
                time: parseLogTime(entry.occurred_at),
              }))
              .filter(({ entry, time }) => {
                if (time === null || visitStart === null) {
                  return false;
                }
                if (entry.world_id !== ev.world_id || entry.instance_id !== ev.instance_id) {
                  return false;
                }
                if (time < visitStart) {
                  return false;
                }
                if (visitEnd !== null && time >= visitEnd) {
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
              const value = { displayName, userId: entry.user_id };
              if (entry.kind === "joined") {
                activeMap.set(key, value);
                seenMap.set(key, value);
              } else if (entry.kind === "left") {
                activeMap.delete(key);
              }
            }

            const dbPlayers = Array.from((activeMap.size > 0 ? activeMap : seenMap).values());
            dbPlayers.sort((a, b) => a.displayName.localeCompare(b.displayName));
            if (dbPlayers.length > 0) {
              sessionPlayers = dbPlayers;
            }
          }

          const sessionStart = parseLogTime(ev.iso_time);
          if (sessionPlayers.length === 0 && sessionStart !== null) {
            const activeMap = new Map<string, { displayName: string; userId: string | null }>();
            const seenMap = new Map<string, { displayName: string; userId: string | null }>();
            const relevantEvents = playerEvents
              .map((entry) => ({
                entry,
                time: parseLogTime(entry.iso_time),
              }))
              .filter((entry) => {
                if (entry.time === null) {
                  return false;
                }
                if (entry.time < sessionStart) {
                  return false;
                }
                if (nextSwitchTime !== null && entry.time >= nextSwitchTime) {
                  return false;
                }
                return true;
              })
              .sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

            for (const { entry } of relevantEvents) {
              const key = entry.user_id || entry.display_name;
              if (entry.kind === "joined") {
                const value = { displayName: entry.display_name, userId: entry.user_id };
                activeMap.set(key, value);
                seenMap.set(key, value);
              } else {
                activeMap.delete(key);
              }
            }

            sessionPlayers = Array.from((activeMap.size > 0 ? activeMap : seenMap).values());
            sessionPlayers.sort((a, b) => a.displayName.localeCompare(b.displayName));
          }

          return (
            <div key={i} className="group relative flex flex-col gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 transition-colors hover:bg-[hsl(var(--accent))]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[11px] font-medium text-[hsl(var(--foreground))]">
                  <Clock className="size-3.5 text-[hsl(var(--muted-foreground))]" />
                  {timeStr}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                    <AccessIcon className="size-3.5" />
                    <span className="font-medium text-[hsl(var(--foreground))]">{accessLabel}</span>
                  </div>
                  <Badge variant="secondary" className="h-[20px] px-2 text-[10px] font-semibold tracking-wide ml-1">
                    {ev.region?.toUpperCase() ?? "US"}
                  </Badge>
                </div>
              </div>

              {ev.owner_id && (
                <div className="mt-1 flex items-center justify-between rounded bg-[hsl(var(--muted))] px-2 py-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <UserPopupBadge userId={ev.owner_id} />
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--background))] hover:text-[hsl(var(--foreground))]"
                      title="Open Profile on vrchat.com"
                      onClick={(e) => {
                        e.stopPropagation();
                        const urlPath = ev.owner_id!.startsWith("grp_") ? `group/${ev.owner_id}` : `user/${ev.owner_id}`;
                        ipc.call<{ url: string }, { ok: boolean }>("shell.openUrl", {
                          url: `https://vrchat.com/home/${urlPath}`,
                        }).catch(console.error);
                      }}
                    >
                      <ExternalLink className="size-3" />
                    </Button>
                    {(ev.instance_id && ev.instance_id.includes(":")) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--background))] hover:text-[hsl(var(--foreground))]"
                        title="Launch this specific instance in VRChat"
                        onClick={(e) => {
                          e.stopPropagation();
                          ipc.call<{ url: string }, { ok: boolean }>("shell.openUrl", {
                            url: `vrchat://launch?id=${ev.instance_id}`,
                          }).catch(console.error);
                        }}
                      >
                        <Play className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {sessionPlayers.length > 0 ? <SessionPlayerList players={sessionPlayers} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Worlds() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { report, loading, error } = useReport();
  const logs = report?.logs ?? null;
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showInspector, setShowInspector] = useUiPrefBoolean("vrcsm.layout.worlds.inspector.visible", true);
  const [dbVisits, setDbVisits] = useState<DbWorldVisit[]>([]);
  const [dbPlayerEvents, setDbPlayerEvents] = useState<DbPlayerEvent[]>([]);
  const { byType: favoriteIds } = useFavoriteItems(LIBRARY_LIST_NAME);
  const { toggleFavorite } = useFavoriteActions();

  useEffect(() => {
    const selectedFromRoute = searchParams.get("select");
    if (selectedFromRoute) {
      setSelectedId(selectedFromRoute);
    }
  }, [searchParams]);

  const ids = useMemo(() => logs?.recent_world_ids ?? [], [logs]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return ids;
    return ids.filter((id) => {
      if (id.toLowerCase().includes(q)) return true;
      const name = logs?.world_names[id];
      return name?.toLowerCase().includes(q) ?? false;
    });
  }, [ids, filter, logs?.world_names]);

  const selected = useMemo(() => {
    if (!filtered.length) return null;
    if (!selectedId) return filtered[0];
    return filtered.find((id) => id === selectedId) ?? filtered[0];
  }, [filtered, selectedId]);
  const shouldShowInspector = showInspector && Boolean(selected);

  const selectedSwitches = useMemo(() => {
    if (!selected || !logs?.world_switches) return [];
    const hits = logs.world_switches.filter((s) => s.world_id === selected);
    hits.sort((a, b) => {
      const aTime = parseLogTime(a.iso_time) ?? 0;
      const bTime = parseLogTime(b.iso_time) ?? 0;
      return bTime - aTime;
    });
    return hits;
  }, [selected, logs?.world_switches]);

  // Warm the thumbnail cache for the full world list as soon as it lands —
  // batches into a single IPC call and kicks the C++ side to fetch
  // everything over one WinHTTP session.
  useEffect(() => {
    if (ids.length > 0) {
      prefetchThumbnails(ids);
    }
  }, [ids]);

  useEffect(() => {
    let cancelled = false;
    void ipc.dbWorldVisits(500, 0)
      .then((result) => {
        if (!cancelled) {
          setDbVisits((result.items ?? []) as DbWorldVisit[]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDbVisits([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [logs?.world_switches]);

  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setDbPlayerEvents([]);
      return () => {
        cancelled = true;
      };
    }
    const earliestSelectedTime =
      selectedSwitches.length > 0
        ? selectedSwitches[selectedSwitches.length - 1]?.iso_time ?? undefined
        : undefined;
    void ipc.dbPlayerEvents(1000, 0, {
      worldId: selected,
      occurredAfter: earliestSelectedTime,
    })
      .then((result) => {
        if (!cancelled) {
          setDbPlayerEvents((result.items ?? []) as DbPlayerEvent[]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDbPlayerEvents([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected, selectedSwitches]);

  async function handleToggleFavorite(
    worldId: string,
    thumbnailUrl: string | null,
  ) {
    const isFavorited = favoriteIds.world.has(worldId);
    const displayName = logs?.world_names[worldId] ?? null;
    try {
      await toggleFavorite(
        {
          type: "world",
          target_id: worldId,
          list_name: LIBRARY_LIST_NAME,
          display_name: displayName ?? undefined,
          thumbnail_url: thumbnailUrl,
        },
        isFavorited,
      );
      toast.success(
        t(
          isFavorited ? "library.removedToast" : "library.savedToast",
          { name: displayName ?? shortenId(worldId) },
        ),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(t("library.toggleFailed", { error: message }));
    }
  }

  const worldListPane = (
    <Card elevation="flat" className="flex h-full flex-col overflow-hidden p-0">
      <div className="unity-panel-header flex items-center justify-between">
        <span>{t("worlds.gridPaneTitle")}</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] normal-case tracking-normal">
            {filtered.length}
          </span>
          {!shouldShowInspector && selected ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => setShowInspector(true)}
            >
              <PanelRightOpen className="size-3.5" />
              {t("worlds.inspectorPaneTitle")}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("worlds.filterPlaceholder")}
            className="h-7 pl-7 text-[12px]"
          />
        </div>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
            {t("worlds.noMatch")}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((id) => (
              <WorldTile
                key={id}
                id={id}
                name={logs?.world_names[id] ?? null}
                isSelected={selected === id}
                isFavorited={favoriteIds.world.has(id)}
                onSelect={() => setSelectedId(id)}
                onToggleFavorite={(thumbnailUrl) =>
                  handleToggleFavorite(id, thumbnailUrl)
                }
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  );

  const inspectorPane = selected ? (
    <Card elevation="flat" className="flex h-full flex-col overflow-hidden p-0">
      <div className="unity-panel-header flex items-center justify-between gap-2">
        <span>{t("worlds.inspectorPaneTitle")}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-[10px]"
          onClick={() => setShowInspector(false)}
        >
          <PanelRightClose className="size-3.5" />
          {t("common.close", { defaultValue: "Close" })}
        </Button>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 scrollbar-thin">
        <div className="relative overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))]">
          <WorldThumb
            id={selected}
            className="h-36 w-full"
            label
            isFavorited={favoriteIds.world.has(selected)}
            onToggleFavorite={(thumbnailUrl) =>
              handleToggleFavorite(selected, thumbnailUrl)
            }
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="text-[16px] font-semibold leading-tight text-[hsl(var(--foreground))]">
            {logs?.world_names[selected] ?? t("worlds.unknownName")}
          </div>
          {!logs?.world_names[selected] ? (
            <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("worlds.nameFromLogOnly")}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">
            <Globe2 className="size-3" />
            {t("worlds.instanceBadge")}
          </Badge>
        </div>

        <div className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2 text-[11px]">
          <WorldPopupBadge worldId={selected} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="justify-start"
            onClick={() => {
              navigator.clipboard
                .writeText(selected)
                .then(() => {
                  toast.success(t("worlds.copiedToast"));
                })
                .catch((e: unknown) => {
                  const msg = e instanceof Error ? e.message : String(e);
                  toast.error(t("worlds.copyFailed", { error: msg }));
                });
            }}
          >
            <Copy />
            {t("worlds.copyId")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="justify-start"
            onClick={() => {
              ipc
                .call<{ url: string }, { ok: boolean }>("shell.openUrl", {
                  url: `https://vrchat.com/home/world/${selected}`,
                })
                .catch((e: unknown) => {
                  const msg = e instanceof Error ? e.message : String(e);
                  toast.error(t("worlds.openFailed", { error: msg }));
                });
            }}
          >
            <ExternalLink />
            {t("worlds.openExternal")}
          </Button>
          <Button
            variant="tonal"
            size="sm"
            className="justify-start"
            onClick={() => {
              ipc
                .call<{ url: string }, { ok: boolean }>("shell.openUrl", {
                  url: `vrchat://launch?id=${selected}`,
                })
                .catch((e: unknown) => {
                  const msg = e instanceof Error ? e.message : String(e);
                  toast.error(t("worlds.launchFailed", { error: msg }));
                });
            }}
          >
            <Play />
            {t("worlds.launchInVrc")}
          </Button>
        </div>

        <WorldHistoryPanel
          switches={selectedSwitches}
          allSwitches={logs?.world_switches || []}
          playerEvents={logs?.player_events || []}
          dbVisits={dbVisits.filter((visit) => visit.world_id === selected)}
          dbPlayerEvents={dbPlayerEvents}
        />
      </div>
    </Card>
  ) : (
    <Card
      elevation="flat"
      className="flex h-full items-center justify-center p-0"
    >
      <div className="flex flex-col items-center gap-2 py-10 text-[12px] text-[hsl(var(--muted-foreground))]">
        <Globe2 className="size-6" />
        {t("worlds.pickOne")}
      </div>
    </Card>
  );

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("worlds.title")}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("worlds.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
          <span>{t("worlds.totalCount", { count: ids.length })}</span>
        </div>
      </header>

      {loading && !logs ? (
        <Card>
          <CardContent className="py-8 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("worlds.scanning")}
          </CardContent>
        </Card>
      ) : error || !logs ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("worlds.loadFailed")}</CardTitle>
            <CardDescription>
              {error ?? t("common.unknownError")}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : ids.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("worlds.empty")}
          </CardContent>
        </Card>
      ) : (
        shouldShowInspector ? (
          <PanelGroup orientation="horizontal" className="min-h-[560px]">
            <Panel defaultSize={66} minSize={34}>
              <div className="h-full pr-2">
                {worldListPane}
              </div>
            </Panel>
            <PanelResizeHandle className="unity-splitter w-[3px] cursor-col-resize rounded-full" />
            <Panel defaultSize={34} minSize={24}>
              <div className="h-full pl-2">
                {inspectorPane}
              </div>
            </Panel>
          </PanelGroup>
        ) : (
          <div className="min-h-[560px]">
            {worldListPane}
          </div>
        )
      )}
    </div>
  );
}

export default Worlds;
