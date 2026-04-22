import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, Star, Compass, Trophy } from "lucide-react";

type CalendarTab = "discover" | "featured" | "jams";

interface CalendarEvent {
  id?: string;
  name?: string;
  title?: string;
  description?: string;
  startsAt?: string;
  starts_at?: string;
  endsAt?: string;
  ends_at?: string;
  imageUrl?: string;
  image_url?: string;
  thumbnailImageUrl?: string;
  worldId?: string;
  region?: string;
  groupId?: string;
  groupName?: string;
  [key: string]: unknown;
}

function getStartsAt(e: CalendarEvent): string | undefined {
  return e.startsAt ?? e.starts_at;
}

function getImageUrl(e: CalendarEvent): string | undefined {
  return e.imageUrl ?? e.image_url ?? e.thumbnailImageUrl;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
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

export default function CalendarPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<CalendarTab>("discover");

  const discover = useQuery({
    queryKey: ["calendar.discover"],
    queryFn: () => ipc.calendarDiscover(),
    staleTime: 5 * 60_000,
    enabled: tab === "discover",
  });

  const featured = useQuery({
    queryKey: ["calendar.featured"],
    queryFn: () => ipc.calendarFeatured(),
    staleTime: 5 * 60_000,
    enabled: tab === "featured",
  });

  const jams = useQuery({
    queryKey: ["jams.list"],
    queryFn: () => ipc.jamsList(),
    staleTime: 5 * 60_000,
    enabled: tab === "jams",
  });

  const events: CalendarEvent[] =
    tab === "discover"
      ? ((discover.data?.events ?? []) as CalendarEvent[])
      : tab === "featured"
        ? ((featured.data?.events ?? []) as CalendarEvent[])
        : [];

  const rawJams = jams.data;
  const jamItems: CalendarEvent[] = tab === "jams"
    ? (Array.isArray(rawJams) ? rawJams : ((rawJams as unknown as Record<string, unknown>)?.submissions as CalendarEvent[] ?? []))
    : [];
  const isLoading =
    tab === "discover" ? discover.isLoading
      : tab === "featured" ? featured.isLoading
        : jams.isLoading;

  return (
    <div className="flex flex-col gap-4 animate-fade-in max-w-5xl mx-auto w-full">
      <header className="flex items-center gap-2">
        <div className="unity-panel-header inline-flex items-center gap-2 border-0 bg-transparent px-0 py-0 normal-case tracking-normal">
          <CalendarIcon className="size-4" />
          <span className="text-[11px] uppercase tracking-[0.08em]">
            {t("calendar.pageTitle", { defaultValue: "Calendar & Jams" })}
          </span>
        </div>
      </header>

      <div className="flex gap-1 border-b border-[hsl(var(--border))] pb-0">
        {([
          { key: "discover" as const, icon: Compass, label: "Discover" },
          { key: "featured" as const, icon: Star, label: "Featured" },
          { key: "jams" as const, icon: Trophy, label: "Jams" },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`unity-tab flex items-center gap-1.5 px-4 py-2 text-[12px] ${tab === t.key ? "unity-tab-active" : ""}`}
          >
            <t.icon className="size-3" />
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <p className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono">
          {t("calendar.loading")}
        </p>
      )}

      {tab !== "jams" && !isLoading && events.length === 0 && (
        <Card className="unity-panel">
          <CardContent className="p-6 text-center">
            <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("calendar.empty", { defaultValue: "No events found." })}
            </p>
          </CardContent>
        </Card>
      )}

      {tab !== "jams" && (
        <div className="grid gap-3 md:grid-cols-2">
          {events.map((e, i) => {
            const when = formatTime(getStartsAt(e));
            const thumb = getImageUrl(e);
            return (
              <Card key={e.id ?? i} className="unity-panel overflow-hidden">
                {thumb && (
                  <div className="h-32 overflow-hidden">
                    <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                  </div>
                )}
                <CardContent className="p-3 flex flex-col gap-1">
                  <div className="text-[13px] font-medium">{e.name ?? "Untitled"}</div>
                  {when && (
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono">
                      {when}
                      {e.region ? ` · ${String(e.region).toUpperCase()}` : ""}
                    </div>
                  )}
                  {e.groupName && (
                    <Badge variant="outline" className="w-fit text-[10px]">{String(e.groupName)}</Badge>
                  )}
                  {e.description && (
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-2 mt-1">
                      {String(e.description)}
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 w-fit"
                    onClick={() => {
                      void ipc.call<{ url: string }, { ok: boolean }>("shell.openUrl", {
                        url: "https://vrchat.com/home/events",
                      });
                    }}
                  >
                    {t("calendar.openInBrowser", { defaultValue: "Open in VRChat" })}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "jams" && !isLoading && jamItems.length === 0 && (
        <Card className="unity-panel">
          <CardContent className="p-6 text-center">
            <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("calendar.noJams", { defaultValue: "No active jams right now." })}
            </p>
          </CardContent>
        </Card>
      )}

      {tab === "jams" && (
        <div className="grid gap-3 md:grid-cols-2">
          {jamItems.map((j, i) => (
            <Card key={j.id ?? i} className="unity-panel">
              <CardHeader className="pb-2">
                <CardTitle className="text-[13px]">{j.title ?? j.name ?? "Untitled Jam"}</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                {j.description && (
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-3">
                    {String(j.description)}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
