import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
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
import { useReport } from "@/lib/report-context";
import { prefetchThumbnails, useThumbnail } from "@/lib/thumbnails";
import { type WorldSwitchEvent, type PlayerEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Copy, ExternalLink, Globe2, Play, Search, Clock, Lock, Users, EyeOff, Heart } from "lucide-react";

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
}: {
  switches: WorldSwitchEvent[];
  allSwitches: WorldSwitchEvent[];
  playerEvents: PlayerEvent[];
}) {
  const { t } = useTranslation();
  if (switches.length === 0) return null;

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
          if (ev.iso_time) {
            const evTime = ev.iso_time;
            const nextSwitchTime = allSwitches.reduce((closest, s) => {
              if (s.iso_time && s.iso_time > evTime) {
                if (!closest || s.iso_time < closest) return s.iso_time;
              }
              return closest;
            }, null as string | null);

            const pMap = new Map<string, { displayName: string; userId: string | null }>();
            for (const p of playerEvents) {
              if (p.iso_time && p.iso_time >= evTime) {
                if (!nextSwitchTime || p.iso_time < nextSwitchTime) {
                  // Only track joined events, ignoring left events to form a roster of anyone who was present
                  if (p.kind === "joined") {
                    const key = p.user_id || p.display_name;
                    pMap.set(key, { displayName: p.display_name, userId: p.user_id });
                  }
                }
              }
            }
            sessionPlayers = Array.from(pMap.values());
            // Optionally, sort alphabetically
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
                            url: `vrchat://launch?id=${ev.world_id}:${ev.instance_id}`,
                          }).catch(console.error);
                        }}
                      >
                        <Play className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {sessionPlayers.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1 border-t border-[hsl(var(--border)/0.5)] pt-2">
                  <div className="w-full text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-0.5">
                    {t("worlds.playersSeen", { defaultValue: "Players in Room" })} ({sessionPlayers.length})
                  </div>
                  {sessionPlayers.map((sp) => (
                    <Badge
                      key={sp.userId || sp.displayName}
                      variant="outline"
                      className="h-[20px] px-1.5 text-[9.5px] font-normal text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--border-strong))] transition-colors"
                      title={sp.userId || undefined}
                    >
                      {sp.displayName}
                    </Badge>
                  ))}
                </div>
              )}
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

  const selectedSwitches = useMemo(() => {
    if (!selected || !logs?.world_switches) return [];
    const hits = logs.world_switches.filter((s) => s.world_id === selected);
    // Sort descending by time
    hits.sort((a, b) => {
      if (!a.iso_time) return 1;
      if (!b.iso_time) return -1;
      return a.iso_time < b.iso_time ? 1 : -1;
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
        <div className="grid min-h-[560px] gap-4 md:grid-cols-[1fr_280px]">
          <Card elevation="flat" className="flex flex-col overflow-hidden p-0">
            <div className="unity-panel-header flex items-center justify-between">
              <span>{t("worlds.gridPaneTitle")}</span>
              <span className="font-mono text-[10px] normal-case tracking-normal">
                {filtered.length}
              </span>
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
                      name={logs.world_names[id] ?? null}
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

          {selected ? (
            <Card elevation="flat" className="flex flex-col overflow-hidden p-0">
              <div className="unity-panel-header">
                {t("worlds.inspectorPaneTitle")}
              </div>
              <div className="flex flex-col gap-3 p-4">
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
                    {logs.world_names[selected] ?? t("worlds.unknownName")}
                  </div>
                  {!logs.world_names[selected] ? (
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

                {/*
                  Action row. These buttons are the only handles we have for
                  a world short of implementing a full vrcx-style client —
                  Copy ID is always safe, the two links go through the host
                  `shell.openUrl` IPC which whitelists http(s) + vrchat://
                  schemes so the browser/VRChat do the rest of the work.
                */}
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
                      // `vrchat://launch?id=<worldId>` is VRChat's own URI
                      // scheme. When VRChat is already running it pops a
                      // "join this world" toast in-game; when it isn't,
                      // Windows starts VRChat via Steam / the shim exe.
                      // Either way the OS shell handler does the work.
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
                  allSwitches={logs.world_switches || []} 
                  playerEvents={logs.player_events || []} 
                />
              </div>
            </Card>
          ) : (
            <Card
              elevation="flat"
              className="flex items-center justify-center p-0"
            >
              <div className="flex flex-col items-center gap-2 py-10 text-[12px] text-[hsl(var(--muted-foreground))]">
                <Globe2 className="size-6" />
                {t("worlds.pickOne")}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

export default Worlds;
