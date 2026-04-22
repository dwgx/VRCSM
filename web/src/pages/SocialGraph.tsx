import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/ipc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { Users, Globe2, RefreshCcw, TrendingUp } from "lucide-react";

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
  useAuth();
  const [topWorlds, setTopWorlds] = useState<WorldVisitStat[]>([]);
  const [topFriends, setTopFriends] = useState<FriendEncounter[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
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

      // Player encounters from DB
      const events = await ipc.dbPlayerEvents(500, 0);
      const playerItems = (events.items ?? []) as Array<{ user_id?: string; display_name?: string; kind?: string; occurred_at?: string }>;
      const friendMap = new Map<string, { name: string; count: number; lastSeen: string }>();
      for (const e of playerItems) {
        if (!e.user_id || e.kind !== "joined") continue;
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
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="flex flex-col gap-4 animate-fade-in max-w-5xl mx-auto w-full">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4" />
          <span className="text-[11px] uppercase tracking-[0.08em] font-semibold">
            {t("socialGraph.title", { defaultValue: "Social Analytics" })}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCcw className={loading ? "size-3 animate-spin" : "size-3"} />
        </Button>
      </header>

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
            {topWorlds.length === 0 && !loading && (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">No visit data yet.</p>
            )}
            {topWorlds.map((w, i) => (
              <div key={w.world_id} className="flex items-center gap-2 text-[11px] font-mono py-1 border-b border-[hsl(var(--border)/0.3)]">
                <span className="w-5 text-[hsl(var(--muted-foreground))] text-right">{i + 1}</span>
                <span className="flex-1 truncate">{w.world_id}</span>
                <Badge variant="outline" className="text-[9px]">{w.visit_count}x</Badge>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{w.total_minutes}m</span>
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
            {topFriends.length === 0 && !loading && (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">No encounter data yet.</p>
            )}
            {topFriends.map((f, i) => (
              <div key={f.user_id} className="flex items-center gap-2 text-[11px] font-mono py-1 border-b border-[hsl(var(--border)/0.3)]">
                <span className="w-5 text-[hsl(var(--muted-foreground))] text-right">{i + 1}</span>
                <span className="flex-1 truncate font-medium">{f.display_name || f.user_id}</span>
                <Badge variant="outline" className="text-[9px]">{f.encounter_count}x</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
