import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Globe2, Heart, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ipc } from "@/lib/ipc";
import { OFFICIAL_FAVORITES_LIST_NAME, normalizeFavoriteType, useFavoriteItems } from "@/lib/library";
import { useReport } from "@/lib/report-context";
import { relativeTime } from "@/lib/vrcFriends";
import { SectionTitle } from "./WorkspaceCards";

const MAX_RECENT_WORLDS = 12;

/** Shorten a world id for display when no name is available. */
function shortenWorldId(id: string, head = 10, tail = 6): string {
  if (id.length <= head + tail + 3) return id;
  return `${id.slice(0, head)}...${id.slice(-tail)}`;
}

/** Build a VRChat launch URI for a given world id. */
function buildLaunchUrl(worldId: string): string {
  return `vrchat://launch?id=${encodeURIComponent(worldId)}`;
}

/** Fire a shell.openUrl IPC call. */
function openUrl(url: string): void {
  ipc.call<{ url: string }, { ok: boolean }>("shell.openUrl", { url }).catch(() => {
    /* swallow — toast handled by caller if needed */
  });
}

// ── Recent Worlds Section ───────────────────────────────────────────────

interface RecentWorld {
  world_id: string;
  name: string | null;
  last_seen_at: string | null;
}

function RecentWorldsSection() {
  const { t } = useTranslation();
  const { report } = useReport();

  const recentWorlds = useMemo<RecentWorld[]>(() => {
    if (!report) return [];

    const worldIds = report.logs.recent_world_ids ?? [];
    const worldNames = report.logs.world_names ?? {};
    const worldSwitches = report.logs.world_switches ?? [];

    // Build a map of world_id -> last seen timestamp from world switch events
    const lastSeenMap = new Map<string, string>();
    for (const ev of worldSwitches) {
      if (ev.world_id && ev.iso_time) {
        const existing = lastSeenMap.get(ev.world_id);
        if (!existing || ev.iso_time > existing) {
          lastSeenMap.set(ev.world_id, ev.iso_time);
        }
      }
    }

    const seen = new Set<string>();
    const out: RecentWorld[] = [];

    for (const id of worldIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        world_id: id,
        name: worldNames[id] ?? null,
        last_seen_at: lastSeenMap.get(id) ?? null,
      });
      if (out.length >= MAX_RECENT_WORLDS) break;
    }

    return out;
  }, [report]);

  return (
    <Card elevation="flat" className="p-0">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px]">
          <SectionTitle
            title={t("vrchatWorkspace.recentWorlds", { defaultValue: "Recent Worlds" })}
            count={recentWorlds.length}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {recentWorlds.length === 0 ? (
          <div className="px-4 pb-4 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
            {t("vrchatWorkspace.noRecentWorlds", {
              defaultValue: "No recent worlds found in VRChat logs.",
            })}
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="flex flex-col gap-px px-2 pb-2">
              {recentWorlds.map((world) => (
                <div
                  key={world.world_id}
                  className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 transition-colors hover:bg-[hsl(var(--surface-raised))]"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
                    <Globe2 className="size-3.5" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[12px] font-medium text-[hsl(var(--foreground))]">
                      {world.name ?? shortenWorldId(world.world_id)}
                    </span>
                    <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                      {world.name ? (
                        <>
                          <span className="truncate font-mono">
                            {shortenWorldId(world.world_id, 8, 4)}
                          </span>
                          <span>·</span>
                        </>
                      ) : null}
                      {world.last_seen_at ? (
                        <span>{relativeTime(world.last_seen_at)}</span>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 gap-1 text-[11px]"
                    onClick={() => openUrl(buildLaunchUrl(world.world_id))}
                    title={t("vrchatWorkspace.launchWorld", {
                      defaultValue: "Launch in VRChat",
                    })}
                  >
                    <Play className="size-3" />
                    {t("vrchatWorkspace.launch", { defaultValue: "Launch" })}
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

// ── Favorite Worlds Section ─────────────────────────────────────────────

function FavoriteWorldsSection() {
  const { t } = useTranslation();
  const { items: allFavItems } = useFavoriteItems(OFFICIAL_FAVORITES_LIST_NAME);

  const worldFavorites = useMemo(
    () => allFavItems.filter((item) => normalizeFavoriteType(item.type) === "world"),
    [allFavItems],
  );

  if (worldFavorites.length === 0) {
    return (
      <Card elevation="flat" className="p-0">
        <CardHeader className="px-4 py-3">
          <CardTitle className="text-[13px]">
            <SectionTitle
              title={t("vrchatWorkspace.favoriteWorlds", { defaultValue: "Favorite Worlds" })}
              count={0}
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="text-center text-[11px] text-[hsl(var(--muted-foreground))]">
            {t("vrchatWorkspace.noFavoriteWorlds", {
              defaultValue: "No favorite worlds yet. Sync your VRChat favorites to see them here.",
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card elevation="flat" className="p-0">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px]">
          <SectionTitle
            title={t("vrchatWorkspace.favoriteWorlds", { defaultValue: "Favorite Worlds" })}
            count={worldFavorites.length}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <ScrollArea className="max-h-[400px]">
          <div className="flex flex-col gap-px px-2 pb-2">
            {worldFavorites.map((item) => (
              <div
                key={item.target_id}
                className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 transition-colors hover:bg-[hsl(var(--surface-raised))]"
              >
                {/* Thumbnail or icon placeholder */}
                {item.thumbnail_url ? (
                  <div className="size-8 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
                    <img
                      src={item.thumbnail_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[hsl(var(--secondary)/0.2)] text-[hsl(var(--secondary-foreground))]">
                    <Globe2 className="size-3.5" />
                  </div>
                )}

                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[12px] font-medium text-[hsl(var(--foreground))]">
                    {item.display_name ?? shortenWorldId(item.target_id)}
                  </span>
                  <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                    <span className="truncate font-mono">
                      {shortenWorldId(item.target_id, 8, 4)}
                    </span>
                    {item.added_at ? (
                      <>
                        <span>·</span>
                        <span>{relativeTime(item.added_at)}</span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Heart className="size-3 fill-[hsl(var(--destructive))] text-[hsl(var(--destructive))]" />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => openUrl(buildLaunchUrl(item.target_id))}
                    title={t("vrchatWorkspace.launchWorld", {
                      defaultValue: "Launch in VRChat",
                    })}
                  >
                    <Play className="size-3" />
                    {t("vrchatWorkspace.launch", { defaultValue: "Launch" })}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// ── Tab Root ─────────────────────────────────────────────────────────────

export default function TabWorlds() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RecentWorldsSection />
      <FavoriteWorldsSection />
    </div>
  );
}
