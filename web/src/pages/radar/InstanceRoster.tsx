import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/ipc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePipelineEvent } from "@/lib/pipeline-events";
import { Users, RefreshCcw, MapPin } from "lucide-react";

interface PlayerEventRow {
  id: number;
  kind: string;
  user_id?: string;
  display_name: string;
  world_id?: string;
  instance_id?: string;
  occurred_at: string;
}

interface LivePlayer {
  userId: string;
  displayName: string;
  joinedAt: string;
}

export function InstanceRoster() {
  const { t } = useTranslation();
  const [recentEvents, setRecentEvents] = useState<PlayerEventRow[]>([]);
  const [livePlayers, setLivePlayers] = useState<Map<string, LivePlayer>>(new Map());
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ipc.dbPlayerEvents(50, 0);
      setRecentEvents((res.items ?? []) as PlayerEventRow[]);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  usePipelineEvent("user-location", (content: { userId?: string; user?: { displayName?: string }; location?: string }) => {
    if (!content?.userId || !content?.location) return;
    if (content.location === "offline" || content.location === "private") {
      setLivePlayers((prev) => {
        const next = new Map(prev);
        next.delete(content.userId!);
        return next;
      });
      return;
    }
    setLivePlayers((prev) => {
      const next = new Map(prev);
      next.set(content.userId!, {
        userId: content.userId!,
        displayName: content.user?.displayName ?? content.userId!,
        joinedAt: new Date().toISOString(),
      });
      return next;
    });
  });

  const liveList = Array.from(livePlayers.values());

  return (
    <div className="flex flex-col gap-3">
      {liveList.length > 0 && (
        <Card className="unity-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-[12px] font-mono uppercase tracking-wider flex items-center gap-2">
              <Users className="size-3" />
              {t("radar.liveRoster", { defaultValue: "Live Instance Roster" })}
              <Badge variant="secondary">{liveList.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {liveList.map((p) => (
              <div key={p.userId} className="flex items-center gap-2 text-[11px] font-mono py-0.5">
                <MapPin className="size-3 text-[hsl(var(--success))]" />
                <span className="font-medium">{p.displayName}</span>
                <span className="text-[hsl(var(--muted-foreground))] text-[10px]">{p.userId}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="unity-panel">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-[12px] font-mono uppercase tracking-wider">
            {t("radar.recentPlayerEvents", { defaultValue: "Recent Player Events" })}
            <Badge variant="secondary" className="ml-2">{recentEvents.length}</Badge>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCcw className={loading ? "size-3 animate-spin" : "size-3"} />
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-0.5 max-h-[400px] overflow-y-auto">
          {recentEvents.length === 0 && !loading && (
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("radar.noPlayerEvents", { defaultValue: "No player events recorded yet. Launch VRChat and join a world." })}
            </p>
          )}
          {recentEvents.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-[11px] font-mono py-0.5 border-b border-[hsl(var(--border)/0.3)] last:border-0">
              <Badge
                variant={e.kind === "joined" ? "default" : "outline"}
                className="text-[9px] w-12 justify-center"
              >
                {e.kind === "joined" ? "JOIN" : "LEFT"}
              </Badge>
              <span className="font-medium truncate flex-1">{e.display_name}</span>
              {e.occurred_at && (
                <span className="text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">
                  {new Date(e.occurred_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
