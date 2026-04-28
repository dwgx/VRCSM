import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WorldPopupBadge } from "@/components/WorldPopupBadge";

const LIMIT_STORAGE_KEY = "vrcsm.worldHistory.limit";
const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 5000;
const LIMIT_OPTIONS = [100, 250, 500, 1000, 2000] as const;

interface WorldVisit {
  id: number;
  world_id?: string;
  instance_id?: string;
  access_type?: string;
  owner_id?: string;
  region?: string;
  joined_at?: string;
  left_at?: string | null;
  player_count?: number;
  player_event_count?: number;
  last_player_seen_at?: string | null;
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: "numeric",
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
    default:
      return "outline";
  }
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(25, Math.min(MAX_LIMIT, Math.round(value)));
}

function readInitialLimit(): number {
  if (typeof window === "undefined") return DEFAULT_LIMIT;
  const stored = window.localStorage.getItem(LIMIT_STORAGE_KEY);
  return stored ? clampLimit(Number(stored)) : DEFAULT_LIMIT;
}

function LimitControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(value));

  const commitDraft = () => {
    const next = clampLimit(Number(draft));
    setDraft(String(next));
    onChange(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
      <span className="font-mono uppercase tracking-[0.08em]">
        {t("worldHistory.limitLabel", { defaultValue: "Rows" })}
      </span>
      <div className="inline-flex overflow-hidden rounded-md border border-[hsl(var(--border))]">
        {LIMIT_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setDraft(String(option));
              onChange(option);
            }}
            className={`h-7 px-2 font-mono text-[10px] transition-colors ${
              value === option
                ? "bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                : "bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface))]"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
      <input
        aria-label={t("worldHistory.customLimit", { defaultValue: "Custom world history row limit" })}
        type="number"
        min={25}
        max={MAX_LIMIT}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(String(value));
        }}
        className="h-7 w-20 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 text-center font-mono text-[10px] text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary)/0.6)]"
      />
    </div>
  );
}

export default function WorldHistory() {
  const { t } = useTranslation();
  const [limit, setLimitState] = useState(readInitialLimit);
  const setLimit = (next: number) => {
    const clamped = clampLimit(next);
    setLimitState(clamped);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LIMIT_STORAGE_KEY, String(clamped));
    }
  };
  const { data, isLoading, error } = useQuery({
    queryKey: ["db.worldVisits.list", { limit, offset: 0 }],
    queryFn: () => ipc.dbWorldVisits(limit, 0),
    staleTime: 2 * 60_000,
    gcTime: 30 * 60_000,
  });

  const items = ((data?.items ?? []) as WorldVisit[]).slice();

  return (
    <div className="flex flex-col gap-4 animate-fade-in max-w-5xl mx-auto w-full">
      <header className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="unity-panel-header inline-flex items-center gap-2 border-0 bg-transparent px-0 py-0 normal-case tracking-normal">
            <span className="text-[11px] uppercase tracking-[0.08em]">
              {t("worldHistory.title")}
            </span>
          </div>
          <span className="h-[11px] w-px bg-[hsl(var(--border-strong))]" />
          <span className="min-w-0 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            {t("worldHistory.recentLimit", {
              count: limit,
              defaultValue: "Recent {{count}} visits",
            })}
            {" · "}
            {t("worldHistory.subtitle")}
          </span>
        </div>
        <LimitControl value={limit} onChange={setLimit} />
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
        {items.map((v, index) => (
          <Card key={v.id} className="unity-panel">
            <CardContent className="p-3 flex items-center gap-3 text-[11px]">
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {v.world_id ? (
                    <WorldPopupBadge worldId={v.world_id} prefetch={index < 16} />
                  ) : (
                    <span className="text-[12px] font-medium font-mono truncate">
                      {t("worldHistory.unknownWorld")}
                    </span>
                  )}
                  <Badge variant={accessBadgeVariant(v.access_type)}>
                    {v.access_type ?? "—"}
                  </Badge>
                  {v.region && (
                    <Badge variant="outline">{v.region.toUpperCase()}</Badge>
                  )}
                  <Badge
                    variant={v.player_count && v.player_count > 0 ? "secondary" : "outline"}
                    className="gap-1"
                    title={
                      v.player_event_count && v.player_event_count > 0
                        ? t("worldHistory.playerCountHint", {
                            count: v.player_event_count,
                            defaultValue: "{{count}} local player log events in this visit window.",
                          })
                        : t("worldHistory.noPlayerCountHint", {
                            defaultValue: "No local player join/leave events were recorded in this visit window.",
                          })
                    }
                  >
                    <Users className="size-3" />
                    {v.player_count && v.player_count > 0
                      ? t("worldHistory.loggedPlayers", {
                          count: v.player_count,
                          defaultValue: "{{count}} logged players",
                        })
                      : t("worldHistory.noLoggedPlayers", {
                          defaultValue: "No player log",
                        })}
                  </Badge>
                </div>
                <div className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
                  {formatRelative(v.joined_at)}
                  {" → "}
                  {v.left_at ? formatRelative(v.left_at) : t("worldHistory.stillInWorld")}
                  {" · "}
                  {durationMinutes(v.joined_at, v.left_at)}
                  {v.last_player_seen_at && (
                    <>
                      {" · "}
                      {t("worldHistory.lastPlayerSeen", {
                        time: formatRelative(v.last_player_seen_at),
                        defaultValue: "last player event {{time}}",
                      })}
                    </>
                  )}
                </div>
              </div>
              {v.world_id && (
                <button
                  className="shrink-0 text-[10px] text-[hsl(var(--primary))] hover:underline"
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
