import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ipc, type CalendarEvent } from "@/lib/ipc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThumbImage } from "@/components/ThumbImage";

// VRChat-official upcoming events tile. Read-only for v0.11 — clicking
// an event opens the event's landing page in the browser (VRChat has no
// stable "join this event instance now" endpoint, so we can't autojoin
// yet). Gracefully hides when the calendar is empty or the user is
// signed out.

function formatEventTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }
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

function getStartsAt(e: CalendarEvent): string | undefined {
  return e.startsAt ?? e.starts_at;
}
function getImageUrl(e: CalendarEvent): string | undefined {
  return e.imageUrl ?? e.image_url ?? e.thumbnailImageUrl;
}

export function CalendarTile() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["calendar.list"],
    queryFn: () => ipc.calendarList(),
    // Calendar is low-frequency; 5-minute staleTime is plenty and keeps
    // us off the API's good side.
    staleTime: 5 * 60_000,
  });

  const events = data?.events ?? [];
  if (!isLoading && events.length === 0) {
    // Silently hide rather than showing an empty card.
    return null;
  }

  return (
    <Card className="unity-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-[12px] font-mono uppercase tracking-wider">
          {t("calendar.tileTitle")}
          {events.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {events.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isLoading && (
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono">
            {t("calendar.loading")}
          </p>
        )}
        {events.slice(0, 5).map((e, i) => {
          const when = formatEventTime(getStartsAt(e));
          const thumb = getImageUrl(e);
          return (
            <button
              key={e.id ?? i}
              className="flex items-center gap-3 border border-[hsl(var(--border))] rounded p-2 text-left hover:bg-[hsl(var(--muted))] transition-colors"
              onClick={() => {
                // Open in VRChat's own calendar page. If an event has a
                // worldId we could deep-link to the world — add later.
                void ipc.call<{ url: string }, { ok: boolean }>("shell.openUrl", {
                  url: "https://vrchat.com/home/events",
                });
              }}
            >
              {thumb ? (
                <ThumbImage
                  src={thumb}
                  seedKey={e.worldId ?? e.id ?? String(i)}
                  label={e.name ?? t("calendar.untitledEvent")}
                  alt=""
                  className="h-10 w-10 shrink-0"
                  aspect=""
                  rounded="rounded"
                />
              ) : (
                <div className="w-10 h-10 rounded bg-[hsl(var(--muted))] shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium truncate">
                  {e.name ?? t("calendar.untitledEvent")}
                </div>
                {when && (
                  <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] font-mono">
                    {when}
                    {e.region ? ` · ${e.region.toUpperCase()}` : ""}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
