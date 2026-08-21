import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import type { CoPresenceGraph } from "@/lib/ipc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useReport } from "@/lib/report-context";
import { collectSelfIdentity, friendStubFromIdentity, isSelfPlayer, primarySelfUserId } from "@/lib/self-player";
import type { Friend } from "@/lib/types";
import { Users, Globe2, RefreshCcw, TrendingUp, Share2, Trash2 } from "lucide-react";
import { WorldPopupBadge } from "@/components/WorldPopupBadge";
import { EntityLink } from "@/components/EntityLink";
import { RelationshipGraph } from "@/components/RelationshipGraph";
import { FriendDetailDialog } from "@/components/FriendDetailDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type SocialTab = "rankings" | "graph";

interface WorldVisitStat {
  world_id: string;
  visit_count: number;
  total_minutes: number;
}

interface FriendEncounter {
  user_id: string;
  display_name: string;
  encounter_count: number;
  last_seen: string;
}

export default function SocialGraph() {
  const { t } = useTranslation();
  const { status } = useAuth();
  const { report } = useReport();
  const [topWorlds, setTopWorlds] = useState<WorldVisitStat[]>([]);
  const [topFriends, setTopFriends] = useState<FriendEncounter[]>([]);
  const [graph, setGraph] = useState<CoPresenceGraph | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [tab, setTab] = useState<SocialTab>("rankings");
  const [loading, setLoading] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [sinceDays, setSinceDays] = useState(90);
  const [minOverlapSec, setMinOverlapSec] = useState(60);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);

  const localUserIdsKey = useMemo(() => {
    const ids = (report?.local_avatar_data?.recent_items ?? [])
      .map((item) => item.user_id)
      .filter((id): id is string => Boolean(id?.startsWith("usr_")));
    return [...new Set(ids)].sort().join("|");
  }, [report]);
  const self = useMemo(
    () => collectSelfIdentity({
      userId: status.userId,
      displayName: status.displayName,
      localUserIds: localUserIdsKey ? localUserIdsKey.split("|") : [],
    }),
    [status.userId, status.displayName, localUserIdsKey],
  );
  const selfUserId = primarySelfUserId(self);

  const refresh = useCallback(async () => {
    setLoading(true);
    setGraphError(null);
    try {
      // Use existing world visits + player encounters from DB
      const visits = await ipc.dbWorldVisits(200, 0);
      const items = (visits.items ?? []) as Array<{ world_id?: string; joined_at?: string; left_at?: string }>;

      // Aggregate by world
      const worldMap = new Map<string, { count: number; minutes: number }>();
      for (const v of items) {
        if (!v.world_id) continue;
        const entry = worldMap.get(v.world_id) ?? { count: 0, minutes: 0 };
        entry.count += 1;
        if (v.joined_at && v.left_at) {
          const mins = (new Date(v.left_at).getTime() - new Date(v.joined_at).getTime()) / 60000;
          if (mins > 0 && mins < 1440) entry.minutes += mins;
        }
        worldMap.set(v.world_id, entry);
      }
      const sorted = [...worldMap.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 20)
        .map(([id, s]) => ({ world_id: id, visit_count: s.count, total_minutes: Math.round(s.minutes) }));
      setTopWorlds(sorted);

      // Player encounters from DB. Pull more rows so self-filtering does not
      // leave the leaderboard empty, then drop the local account everywhere.
      const events = await ipc.dbPlayerEvents(2000, 0);
      const playerItems = (events.items ?? []) as Array<{ user_id?: string; display_name?: string; kind?: string; occurred_at?: string }>;
      const friendMap = new Map<string, { name: string; count: number; lastSeen: string }>();
      for (const e of playerItems) {
        if (!e.user_id || e.kind !== "joined") continue;
        if (isSelfPlayer(self, e.user_id, e.display_name)) continue;
        const existing = friendMap.get(e.user_id) ?? { name: e.display_name ?? "", count: 0, lastSeen: "" };
        existing.count += 1;
        if (e.display_name) existing.name = e.display_name;
        if (e.occurred_at && e.occurred_at > existing.lastSeen) existing.lastSeen = e.occurred_at;
        friendMap.set(e.user_id, existing);
      }
      const sortedFriends = [...friendMap.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 20)
        .map(([id, s]) => ({ user_id: id, display_name: s.name, encounter_count: s.count, last_seen: s.lastSeen }));
      setTopFriends(sortedFriends);

      if (selfUserId) {
        try {
          const g = await ipc.dbCoPresenceGraph(selfUserId, sinceDays, minOverlapSec);
          setGraph(g);
        } catch (e) {
          setGraph(null);
          setGraphError(e instanceof Error ? e.message : String(e));
        }
      } else {
        setGraph(null);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [self, selfUserId, sinceDays, minOverlapSec]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function handleClear() {
    setClearing(true);
    try {
      // Social analytics is derived from player-encounter events. World visits
      // have their own clear on the World History page, so this only wipes the
      // encounter/co-presence data unique to this view.
      await ipc.dataClear(["history.playerEvents"]);
      setTopFriends([]);
      setGraph(null);
      await refresh();
      toast.success(
        t("socialGraph.clearSuccess", { defaultValue: "Social analytics cleared." }),
      );
    } catch (e) {
      toast.error(
        t("socialGraph.clearFailed", {
          error: e instanceof Error ? e.message : String(e),
          defaultValue: "Failed to clear: {{error}}",
        }),
      );
    } finally {
      setClearing(false);
      setClearOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in max-w-5xl mx-auto w-full">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4" />
          <span className="text-[11px] uppercase tracking-[0.08em] font-semibold">
            {t("socialGraph.title", { defaultValue: "Social Analytics" })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setClearOpen(true)}
            disabled={clearing || (topFriends.length === 0 && !graph)}
          >
            <Trash2 className={clearing ? "size-3 animate-pulse" : "size-3"} />
            {t("socialGraph.clear", { defaultValue: "Clear" })}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCcw className={loading ? "size-3 animate-spin" : "size-3"} />
          </Button>
        </div>
      </header>
      {tab === "graph" && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[hsl(var(--muted-foreground))]">
          <label className="flex items-center gap-1.5">
            {t("socialGraph.windowDays", { defaultValue: "Window" })}
            <select
              className="h-7 rounded border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-1.5 font-mono text-[11px]"
              value={sinceDays}
              onChange={(e) => setSinceDays(Number(e.target.value))}
            >
              <option value={14}>14d</option>
              <option value={30}>30d</option>
              <option value={90}>90d</option>
              <option value={365}>365d</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            {t("socialGraph.minOverlap", { defaultValue: "Min overlap" })}
            <select
              className="h-7 rounded border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-1.5 font-mono text-[11px]"
              value={minOverlapSec}
              onChange={(e) => setMinOverlapSec(Number(e.target.value))}
            >
              <option value={15}>15s</option>
              <option value={60}>60s</option>
              <option value={300}>5m</option>
              <option value={900}>15m</option>
            </select>
          </label>
        </div>
      )}

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={t("socialGraph.clearTitle", { defaultValue: "Clear social analytics?" })}
        description={t("socialGraph.clearDesc", {
          defaultValue:
            "This permanently deletes logged player encounters used for friend rankings and the co-presence graph. World-visit rankings are cleared separately on the World History page. This cannot be undone.",
        })}
        confirmLabel={t("socialGraph.clear", { defaultValue: "Clear" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        onConfirm={handleClear}
        loading={clearing}
        tone="destructive"
      />

      <Card className="unity-panel">
        <CardContent className="p-3 text-[11px] text-[hsl(var(--muted-foreground))] space-y-1">
          <p>{t("socialGraph.guide", { defaultValue: "Aggregates world visits and player encounters from your VRChat log history. Data accumulates as VRCSM parses logs — keep the app running while you play to build up analytics." })}</p>
          <p>{t("socialGraph.selfFiltered", { defaultValue: "Your own player id is excluded from encounter rankings." })}</p>
          <p>{t("socialGraph.lazyWorlds", { defaultValue: "World badges and thumbnails are loaded only when visible or opened." })}</p>
        </CardContent>
      </Card>

      {/* Tab switcher: rankings (existing leaderboards) vs the co-presence graph. */}
      <div className="flex items-center gap-1 border-b border-[hsl(var(--border)/0.4)]">
        <button
          type="button"
          onClick={() => setTab("rankings")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider border-b-2 -mb-px transition-colors ${
            tab === "rankings"
              ? "border-[hsl(var(--primary))] text-[hsl(var(--foreground))]"
              : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          }`}
        >
          <TrendingUp className="size-3" />
          {t("socialGraph.tabRankings", { defaultValue: "Rankings" })}
        </button>
        <button
          type="button"
          onClick={() => setTab("graph")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider border-b-2 -mb-px transition-colors ${
            tab === "graph"
              ? "border-[hsl(var(--primary))] text-[hsl(var(--foreground))]"
              : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          }`}
        >
          <Share2 className="size-3" />
          {t("socialGraph.tabGraph", { defaultValue: "Relationship Graph" })}
        </button>
      </div>

      {tab === "graph" ? (
        <Card className="unity-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-[12px] font-mono uppercase tracking-wider flex items-center gap-2">
              <Share2 className="size-3" />
              {t("socialGraph.graphTitle", { defaultValue: "Co-Presence Network" })}
              {graph && <Badge variant="secondary">{graph.nodes.length}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mb-2">
              {t("socialGraph.graphGuide", { defaultValue: "Players who shared your instances, linked by overlapping time. Solid lines are confirmed (logged from your own instance); dashed lines are inferred co-presence between others — not confirmed friendships." })}
            </p>
            {graph && graph.nodes.some((n) => !n.is_center) ? (
              <RelationshipGraph
                graph={graph}
                onSelect={(userId) => {
                  const node = graph.nodes.find((n) => n.user_id === userId);
                  const stub = friendStubFromIdentity(userId, node?.display_name);
                  if (stub) setSelectedFriend(stub);
                }}
              />
            ) : (
              <div className="py-10 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                {loading ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="grid w-full max-w-sm grid-cols-3 gap-2 px-6">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-16 animate-pulse rounded-full bg-[hsl(var(--muted)/0.16)]"
                        />
                      ))}
                    </div>
                    <p>
                      {t("socialGraph.graphLoading", { defaultValue: "Building co-presence graph…" })}
                    </p>
                  </div>
                ) : graphError
                    ? t("socialGraph.graphFailed", {
                        defaultValue: "Co-presence graph failed: {{error}}",
                        error: graphError,
                      })
                    : t("socialGraph.graphEmpty", { defaultValue: "No co-presence data yet. Edges appear once VRCSM has logged players sharing your instances." })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="unity-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-[12px] font-mono uppercase tracking-wider flex items-center gap-2">
              <Globe2 className="size-3" />
              {t("socialGraph.topWorlds", { defaultValue: "Most Visited Worlds" })}
              <Badge variant="secondary">{topWorlds.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 max-h-[400px] overflow-y-auto">
            {loading && topWorlds.length === 0 && (
              <div className="flex flex-col gap-1 py-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-6 rounded bg-[hsl(var(--muted)/0.25)] animate-pulse" />
                ))}
              </div>
            )}
            {topWorlds.length === 0 && !loading && (
              <div className="py-6 text-center">
                <Globe2 className="size-6 mx-auto mb-2 text-[hsl(var(--muted-foreground)/0.3)]" />
                <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("socialGraph.noWorlds", { defaultValue: "No visit data yet. World history is recorded when VRCSM parses your VRChat logs." })}
                </p>
              </div>
            )}
            {topWorlds.map((w, i) => (
              <div key={w.world_id} className="flex items-center gap-2 text-[11px] py-1.5 border-b border-[hsl(var(--border)/0.3)]">
                <span className="w-5 text-[hsl(var(--muted-foreground))] text-right font-mono">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  {w.world_id.startsWith("wrld_") ? (
                    <LazyWorldPopupBadge worldId={w.world_id} />
                  ) : (
                    <span className="truncate font-mono">{w.world_id}</span>
                  )}
                </div>
                <Badge variant="outline" className="text-[9px] font-mono">{w.visit_count}x</Badge>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">{w.total_minutes}m</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="unity-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-[12px] font-mono uppercase tracking-wider flex items-center gap-2">
              <Users className="size-3" />
              {t("socialGraph.topEncounters", { defaultValue: "Most Encountered Players" })}
              <Badge variant="secondary">{topFriends.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 max-h-[400px] overflow-y-auto">
            {loading && topFriends.length === 0 && (
              <div className="flex flex-col gap-1 py-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-6 rounded bg-[hsl(var(--muted)/0.25)] animate-pulse" />
                ))}
              </div>
            )}
            {topFriends.length === 0 && !loading && (
              <div className="py-6 text-center">
                <Users className="size-6 mx-auto mb-2 text-[hsl(var(--muted-foreground)/0.3)]" />
                <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("socialGraph.noEncounters", { defaultValue: "No encounter data yet. Player encounters are logged from VRChat output logs." })}
                </p>
              </div>
            )}
            {topFriends.map((f, i) => (
              <button
                key={f.user_id}
                type="button"
                className="flex w-full items-center gap-2 text-[11px] py-1.5 border-b border-[hsl(var(--border)/0.3)] text-left hover:bg-[hsl(var(--muted)/0.2)]"
                onClick={() => {
                  const stub = friendStubFromIdentity(f.user_id, f.display_name);
                  if (stub) setSelectedFriend(stub);
                }}
              >
                <span className="w-5 text-[hsl(var(--muted-foreground))] text-right font-mono">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <EntityLink id={f.user_id} name={f.display_name} />
                </div>
                <Badge variant="outline" className="text-[9px] font-mono">{f.encounter_count}x</Badge>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
      )}
      <FriendDetailDialog
        friend={selectedFriend}
        onClose={() => setSelectedFriend(null)}
        readOnly
      />
    </div>
  );
}

function LazyWorldPopupBadge({ worldId }: { worldId: string }) {
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (visible || !worldId.startsWith("wrld_")) return;
    const node = containerRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "180px 0px" });

    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, worldId]);

  return (
    <div ref={containerRef} className="min-h-6 min-w-0">
      {visible ? (
        <WorldPopupBadge worldId={worldId} />
      ) : (
        <span className="block truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
          {worldId.slice(0, 18)}...
        </span>
      )}
    </div>
  );
}
