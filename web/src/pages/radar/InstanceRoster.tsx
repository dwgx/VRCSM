import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/ipc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserPopupBadge } from "@/components/UserPopupBadge";
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

function EditableLimit({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={10}
        max={1000}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Math.max(10, Math.min(1000, parseInt(draft) || value));
          onChange(n);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setDraft(String(value)); setEditing(false); }
        }}
        className="w-12 h-5 text-center text-[10px] font-mono rounded border border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--canvas))] text-[hsl(var(--foreground))] outline-none"
      />
    );
  }

  return (
    <Badge
      variant="secondary"
      className="ml-2 cursor-pointer hover:bg-[hsl(var(--primary)/0.15)] transition-colors"
      onClick={(e) => { e.stopPropagation(); setDraft(String(value)); setEditing(true); }}
      title="Click to change limit"
    >
      {value}
    </Badge>
  );
}

export function InstanceRoster() {
  const { t } = useTranslation();
  const [recentEvents, setRecentEvents] = useState<PlayerEventRow[]>([]);
  const [livePlayers, setLivePlayers] = useState<Map<string, LivePlayer>>(new Map());
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(50);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ipc.dbPlayerEvents(limit, 0);
      setRecentEvents((res.items ?? []) as PlayerEventRow[]);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [limit]);

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
              <div key={p.userId} className="flex items-center gap-2 text-[11px] py-0.5">
                <MapPin className="size-3 text-[hsl(var(--success))]" />
                {p.userId.startsWith("usr_") ? (
                  <UserPopupBadge userId={p.userId} />
                ) : (
                  <span className="font-medium font-mono">{p.displayName}</span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="unity-panel">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-[12px] font-mono uppercase tracking-wider flex items-center">
            {t("radar.recentPlayerEvents", { defaultValue: "Recent Player Events" })}
            <EditableLimit value={limit} onChange={setLimit} />
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCcw className={loading ? "size-3 animate-spin" : "size-3"} />
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-0.5 max-h-[600px] overflow-y-auto">
          {recentEvents.length === 0 && !loading && (
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("radar.noPlayerEvents", { defaultValue: "No player events recorded yet. Launch VRChat and join a world." })}
            </p>
          )}
          {recentEvents.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-[11px] py-1 border-b border-[hsl(var(--border)/0.3)] last:border-0">
              <Badge
                variant={e.kind === "joined" ? "default" : "outline"}
                className="text-[9px] w-12 justify-center shrink-0"
              >
                {e.kind === "joined" ? "JOIN" : "LEFT"}
              </Badge>
              <div className="flex-1 min-w-0">
                {e.user_id?.startsWith("usr_") ? (
                  <UserPopupBadge userId={e.user_id} />
                ) : (
                  <span className="font-medium truncate">{e.display_name}</span>
                )}
              </div>
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
