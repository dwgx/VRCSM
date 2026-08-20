import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Clock, ExternalLink, Globe2, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WorldPopupBadge } from "@/components/WorldPopupBadge";
import { ipc } from "@/lib/ipc";
import { useAuth } from "@/lib/auth-context";
import { openVrchatWorldPage } from "@/lib/shell-api";
import {
  HOT_WORLDS_VISIT_LIMIT,
  countDistinctFriendsByWorld,
  rankHotWorlds,
  type HotWorldEncounterRow,
  type HotWorldRank,
  type HotWorldVisitRow,
} from "@/lib/hot-worlds";

interface VisitListResult {
  items: HotWorldVisitRow[];
}

interface EncounterListResult {
  items: HotWorldEncounterRow[];
}

function formatLastVisit(raw: string): string {
  if (!raw) return "—";
  try {
    const normalized =
      raw.includes(".") && !raw.includes("T")
        ? raw.replace(/^(\d{4})\.(\d{2})\.(\d{2})[ T]/, "$1-$2-$3T")
        : raw;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return raw;
  }
}

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function openWorld(worldId: string) {
  if (!worldId.startsWith("wrld_")) return;
  void openVrchatWorldPage(worldId);
}

function RankRow({ row, index }: { row: HotWorldRank; index: number }) {
  const { t } = useTranslation();
  const wrld = row.worldId.startsWith("wrld_");

  return (
    <Card className="unity-panel">
      <CardContent
        className="flex items-center gap-3 p-3 text-[11px]"
        onDoubleClick={() => openWorld(row.worldId)}
      >
        <span className="w-6 shrink-0 text-right font-mono text-[hsl(var(--muted-foreground))]">
          {index + 1}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {wrld ? (
              <WorldPopupBadge worldId={row.worldId} prefetch={index < 16} />
            ) : (
              <span className="truncate font-mono text-[12px] font-medium">
                {row.worldName ||
                  t("hotWorlds.unknownWorld", { defaultValue: "Unknown world" })}
              </span>
            )}
            <Badge variant="secondary" className="font-mono">
              {t("hotWorlds.visits", {
                count: row.visits,
                defaultValue: "{{count}} visits",
              })}
            </Badge>
            {row.hours != null && (
              <Badge variant="outline" className="gap-1 font-mono">
                <Clock className="size-3" />
                {t("hotWorlds.hours", {
                  hours: formatHours(row.hours),
                  defaultValue: "{{hours}} h",
                })}
              </Badge>
            )}
            {row.friends != null && (
              <Badge variant="outline" className="gap-1 font-mono">
                <Users className="size-3" />
                {t("hotWorlds.friends", {
                  count: row.friends,
                  defaultValue: "{{count}} friends",
                })}
              </Badge>
            )}
          </div>
          <div className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
            {t("hotWorlds.lastVisit", {
              time: formatLastVisit(row.lastVisit),
              defaultValue: "last visit {{time}}",
            })}
          </div>
        </div>
        {wrld && (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-[hsl(var(--primary))] hover:underline"
            onClick={() => openWorld(row.worldId)}
          >
            <ExternalLink className="size-3" />
            {t("hotWorlds.open", { defaultValue: "Open" })}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

export default function HotWorlds() {
  const { t } = useTranslation();
  const { status } = useAuth();

  const visitsQuery = useQuery({
    queryKey: ["db.worldVisits.list", { limit: HOT_WORLDS_VISIT_LIMIT, offset: 0 }],
    queryFn: () =>
      ipc.call<{ limit: number; offset: number }, VisitListResult>("db.worldVisits.list", {
        limit: HOT_WORLDS_VISIT_LIMIT,
        offset: 0,
      }),
    staleTime: 2 * 60_000,
  });

  const encountersQuery = useQuery({
    queryKey: [
      "db.playerEvents.list",
      { limit: HOT_WORLDS_VISIT_LIMIT, offset: 0, surface: "hot-worlds" },
    ],
    queryFn: () =>
      ipc.call<{ limit: number; offset: number }, EncounterListResult>("db.playerEvents.list", {
        limit: HOT_WORLDS_VISIT_LIMIT,
        offset: 0,
      }),
    staleTime: 2 * 60_000,
    retry: false,
  });

  const ranked = useMemo(() => {
    const visits = visitsQuery.data?.items ?? [];
    const friendsByWorld = encountersQuery.isSuccess
      ? countDistinctFriendsByWorld(encountersQuery.data?.items ?? [], status.userId)
      : undefined;
    return rankHotWorlds(visits, { friendsByWorld });
  }, [
    visitsQuery.data?.items,
    encountersQuery.isSuccess,
    encountersQuery.data?.items,
    status.userId,
  ]);

  const loading = visitsQuery.isLoading;
  const error = visitsQuery.error;

  return (
    <div className="mx-auto flex w-full max-w-5xl animate-fade-in flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="unity-panel-header inline-flex items-center gap-2 border-0 bg-transparent px-0 py-0 normal-case tracking-normal">
            <span className="text-[11px] uppercase tracking-[0.08em]">
              {t("hotWorlds.title", { defaultValue: "Hot Worlds" })}
            </span>
          </div>
          <span className="h-[11px] w-px bg-[hsl(var(--border-strong))]" />
          <span className="min-w-0 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            {t("hotWorlds.subtitle", {
              defaultValue: "Local ranking from your logged world visits. No VRChat scrape.",
            })}
          </span>
        </div>
        {ranked.length > 0 && (
          <Badge variant="secondary" className="font-mono">
            {ranked.length}
          </Badge>
        )}
      </header>

      {loading && (
        <p className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("hotWorlds.loading", { defaultValue: "Loading visits…" })}
        </p>
      )}
      {error && (
        <p className="font-mono text-[11px] text-[hsl(var(--destructive,red))]">
          {t("hotWorlds.error", {
            detail: error instanceof Error ? error.message : String(error),
            defaultValue: "Failed to load visits: {{detail}}",
          })}
        </p>
      )}
      {!loading && !error && ranked.length === 0 && (
        <Card className="unity-panel">
          <CardContent className="p-6 text-center">
            <Globe2 className="mx-auto mb-2 size-6 text-[hsl(var(--muted-foreground)/0.3)]" />
            <p className="font-mono text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("hotWorlds.empty", {
                defaultValue: "No world visits in the local log history yet.",
              })}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {ranked.map((row, index) => (
          <RankRow key={row.worldId} row={row} index={index} />
        ))}
      </div>
    </div>
  );
}
