import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/ipc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// World History page — chronological list of every world the user has
// joined (as captured by the LogTailer into vrcsm.db's world_visits
// table). MVP: read-only, no pagination UI (100 most-recent rows which
// is plenty for almost every power user). Infinite scroll is a v0.12.

interface WorldVisit {
  id: number;
  world_id?: string;
  instance_id?: string;
  access_type?: string;
  owner_id?: string;
  region?: string;
  joined_at?: string;
  left_at?: string | null;
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function durationMinutes(joined?: string, left?: string | null): string {
  if (!joined || !left) return "—";
  try {
    const dj = new Date(joined).getTime();
    const dl = new Date(left).getTime();
    if (isNaN(dj) || isNaN(dl) || dl < dj) return "—";
    const mins = Math.round((dl - dj) / 60_000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
  } catch {
    return "—";
  }
}

function accessBadgeVariant(
  access: string | undefined,
): "default" | "secondary" | "outline" | "destructive" {
  switch (access) {
    case "public":
      return "default";
    case "friends":
    case "friends+":
      return "secondary";
    case "invite":
    case "invite+":
      return "outline";
    case "group":
    case "group+":
      return "outline";
    default:
      return "outline";
  }
}

export default function WorldHistory() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ["db.worldVisits.list", { limit: 100, offset: 0 }],
    queryFn: () => ipc.dbWorldVisits(100, 0),
    staleTime: 30_000,
  });

  const items = ((data?.items ?? []) as WorldVisit[]).slice();

  return (
    <div className="flex flex-col gap-4 animate-fade-in max-w-5xl mx-auto w-full">
      <header className="flex items-center gap-2">
        <div className="unity-panel-header inline-flex items-center gap-2 border-0 bg-transparent px-0 py-0 normal-case tracking-normal">
          <span className="text-[11px] uppercase tracking-[0.08em]">
            {t("worldHistory.title")}
          </span>
        </div>
        <span className="h-[11px] w-px bg-[hsl(var(--border-strong))]" />
        <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("worldHistory.subtitle")}
        </span>
      </header>

      {isLoading && (
        <p className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono">
          {t("worldHistory.loading")}
        </p>
      )}
      {error && (
        <p className="text-[11px] text-[hsl(var(--destructive,red))] font-mono">
          {t("worldHistory.errorPrefix", {
            detail: error instanceof Error ? error.message : String(error),
          })}
        </p>
      )}
      {!isLoading && !error && items.length === 0 && (
        <Card className="unity-panel">
          <CardContent className="p-6 text-center">
            <p className="text-[12px] text-[hsl(var(--muted-foreground))] font-mono">
              {t("worldHistory.empty")}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {items.map((v) => (
          <Card key={v.id} className="unity-panel">
            <CardContent className="p-3 flex items-center gap-3 text-[11px] font-mono">
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium truncate">
                    {v.world_id ?? t("worldHistory.unknownWorld")}
                  </span>
                  <Badge variant={accessBadgeVariant(v.access_type)}>
                    {v.access_type ?? "—"}
                  </Badge>
                  {v.region && (
                    <Badge variant="outline">{v.region.toUpperCase()}</Badge>
                  )}
                </div>
                <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] truncate">
                  {formatRelative(v.joined_at)}
                  {" → "}
                  {v.left_at ? formatRelative(v.left_at) : t("worldHistory.stillInWorld")}
                  {" · "}
                  {durationMinutes(v.joined_at, v.left_at)}
                </div>
                {v.instance_id && (
                  <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] truncate">
                    {t("worldHistory.instanceLabel")}: {v.instance_id}
                  </div>
                )}
              </div>
              {v.world_id && (
                <button
                  className="shrink-0 underline text-[11px]"
                  onClick={() => {
                    void ipc.call<{ url: string }, { ok: boolean }>(
                      "shell.openUrl",
                      { url: `https://vrchat.com/home/world/${v.world_id}` },
                    );
                  }}
                >
                  {t("worldHistory.openAction")}
                </button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
