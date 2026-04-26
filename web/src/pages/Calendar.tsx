import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Calendar as CalendarIcon,
  Star,
  Compass,
  Trophy,
  Clock,
  Globe,
  Users,
  ExternalLink,
  UserCircle,
  ImageOff,
} from "lucide-react";
import { useThumbnail } from "@/lib/thumbnails";
import { ThumbImage } from "@/components/ThumbImage";

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
  thumbnail_image_url?: string;
  worldId?: string;
  world_id?: string;
  region?: string;
  groupId?: string;
  group_id?: string;
  groupName?: string;
  group_name?: string;
  hostUserId?: string;
  host_user_id?: string;
  hostUserName?: string;
  host_user_name?: string;
  hostUserDisplayName?: string;
  attendingUserCount?: number;
  attending_user_count?: number;
  tags?: string[];
  category?: string;
  isFeatured?: boolean;
  [key: string]: unknown;
}

interface Jam {
  id?: string;
  title?: string;
  name?: string;
  description?: string;
  thumbnailImageUrl?: string;
  thumbnail_image_url?: string;
  imageUrl?: string;
  image_url?: string;
  state?: string;
  isActive?: boolean;
  submissionsCanBeVoted?: boolean;
  closedAt?: string;
  startedAt?: string;
  coverImageUrl?: string;
  cover_image_url?: string;
  bannerImageUrl?: string;
  banner_image_url?: string;
  bannerUrl?: string;
  banner_url?: string;
  coverUrl?: string;
  cover_url?: string;
  previewImageUrl?: string;
  preview_image_url?: string;
  posterImageUrl?: string;
  poster_image_url?: string;
  [key: string]: unknown;
}

function getJamImage(jam: Jam): string | undefined {
  return firstString(
    jam.thumbnailImageUrl,
    jam.thumbnail_image_url,
    jam.imageUrl,
    jam.image_url,
    jam.coverImageUrl,
    jam.cover_image_url,
    jam.bannerImageUrl,
    jam.banner_image_url,
    jam.bannerUrl,
    jam.banner_url,
    jam.coverUrl,
    jam.cover_url,
    jam.previewImageUrl,
    jam.preview_image_url,
    jam.posterImageUrl,
    jam.poster_image_url,
  ) ?? findImageUrlDeep(jam);
}

function mergeJamDetail(jam: Jam, detail: unknown): Jam {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return jam;
  const record = detail as Record<string, unknown>;
  const inner =
    (record.jam && typeof record.jam === "object" && !Array.isArray(record.jam))
      ? record.jam as Record<string, unknown>
      : (record.data && typeof record.data === "object" && !Array.isArray(record.data))
        ? record.data as Record<string, unknown>
        : (record.result && typeof record.result === "object" && !Array.isArray(record.result))
          ? record.result as Record<string, unknown>
          : (record.details && typeof record.details === "object" && !Array.isArray(record.details))
            ? record.details as Record<string, unknown>
            : record;
  return { ...jam, ...record, ...inner };
}

function firstString(...values: (string | undefined | null)[]): string | undefined {
  for (const v of values) if (v) return v;
  return undefined;
}

function looksLikeImageUrl(value: string): boolean {
  return /^https?:\/\/\S+\.(?:avif|webp|png|jpe?g|gif)(?:[?#]\S*)?$/i.test(value)
    || /^https?:\/\/api\.vrchat\.cloud\/api\/1\/file\/file_[^/\s]+\/[^/\s]+\/file$/i.test(value)
    || /^https?:\/\/[^/\s]*vrchat[^/\s]*\/\S*(?:image|thumbnail|icon|banner|cover|preview|poster|media)\S*$/i.test(value);
}

function extractImageUrlFromText(value: string): string | undefined {
  const markdownMatch = value.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i);
  if (markdownMatch?.[1] && looksLikeImageUrl(markdownMatch[1])) return markdownMatch[1];

  const urlMatches = value.match(/https?:\/\/[^\s)]+/gi);
  return urlMatches?.find(looksLikeImageUrl);
}

function findImageUrlDeep(value: unknown, depth = 0, seen = new Set<unknown>()): string | undefined {
  if (depth > 4 || value == null) return undefined;
  if (typeof value === "string") return extractImageUrlFromText(value);
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageUrlDeep(item, depth + 1, seen);
      if (found) return found;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const preferredKeys = [
    "thumbnailImageUrl", "thumbnail_image_url",
    "imageUrl", "image_url",
    "coverImageUrl", "cover_image_url",
    "bannerImageUrl", "banner_image_url",
    "bannerUrl", "banner_url",
    "coverUrl", "cover_url",
    "previewImageUrl", "preview_image_url",
    "posterImageUrl", "poster_image_url",
    "previewUrl", "preview_url",
    "posterUrl", "poster_url",
    "image", "thumbnail", "cover", "banner", "preview", "poster",
    "url", "fileUrl", "file_url",
  ];
  for (const key of preferredKeys) {
    const candidate = record[key];
    if (typeof candidate === "string") {
      if (looksLikeImageUrl(candidate)) return candidate;
      const extracted = extractImageUrlFromText(candidate);
      if (extracted) return extracted;
    }
  }

  for (const [key, candidate] of Object.entries(record)) {
    if (!/(image|thumbnail|icon|banner|cover|preview|poster|media|asset|file|gallery|screenshot|submission|description)/i.test(key)) continue;
    const found = findImageUrlDeep(candidate, depth + 1, seen);
    if (found) return found;
  }
  return undefined;
}

function firstNumber(...values: (number | undefined | null)[]): number | undefined {
  for (const v of values) if (typeof v === "number") return v;
  return undefined;
}

function getEventTitle(e: CalendarEvent): string {
  return firstString(e.name, e.title) ?? "Untitled";
}

function getStartsAt(e: CalendarEvent): string | undefined {
  return firstString(e.startsAt, e.starts_at);
}

function getEndsAt(e: CalendarEvent): string | undefined {
  return firstString(e.endsAt, e.ends_at);
}

function getImageUrl(e: CalendarEvent): string | undefined {
  return firstString(e.imageUrl, e.image_url, e.thumbnailImageUrl, e.thumbnail_image_url);
}

function getWorldId(e: CalendarEvent): string | undefined {
  return firstString(e.worldId, e.world_id);
}

function getGroupName(e: CalendarEvent): string | undefined {
  return firstString(e.groupName, e.group_name);
}

function getHostName(e: CalendarEvent): string | undefined {
  return firstString(e.hostUserName, e.host_user_name, e.hostUserDisplayName as string | undefined);
}

function getAttending(e: CalendarEvent): number | undefined {
  return firstNumber(e.attendingUserCount, e.attending_user_count);
}

function formatWhen(iso: string | undefined): string {
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

function openEvent(event: CalendarEvent) {
  const url = event.id
    ? `https://vrchat.com/home/event/${event.id}`
    : "https://vrchat.com/home/events";
  void ipc.call<{ url: string }, { ok: boolean }>("shell.openUrl", { url });
}

export default function CalendarPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<CalendarTab>("jams");

  const discover = useQuery({
    queryKey: ["calendar.discover"],
    queryFn: () => ipc.calendarDiscover(),
    staleTime: 5 * 60_000,
  });

  const featured = useQuery({
    queryKey: ["calendar.featured"],
    queryFn: () => ipc.calendarFeatured(),
    staleTime: 5 * 60_000,
  });

  const jams = useQuery({
    queryKey: ["jams.list"],
    queryFn: () => ipc.jamsList(),
    staleTime: 5 * 60_000,
  });

  const events: CalendarEvent[] =
    tab === "discover"
      ? ((discover.data?.events ?? []) as CalendarEvent[])
      : tab === "featured"
        ? ((featured.data?.events ?? []) as CalendarEvent[])
        : [];

  const rawJams = jams.data;
  const jamItems: Jam[] = tab === "jams"
    ? (Array.isArray(rawJams)
      ? (rawJams as Jam[])
      : ((rawJams as unknown as Record<string, unknown>)?.submissions as Jam[] ?? []))
    : [];
  const isLoading =
    tab === "discover" ? discover.isPending
      : tab === "featured" ? featured.isPending
        : jams.isPending;

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
          { key: "jams" as const, icon: Trophy, label: "Jams", count: Array.isArray(rawJams) ? rawJams.length : 0 },
          { key: "discover" as const, icon: Compass, label: "Discover", count: (discover.data?.events as CalendarEvent[] | undefined)?.length ?? 0 },
          { key: "featured" as const, icon: Star, label: "Featured", count: (featured.data?.events as CalendarEvent[] | undefined)?.length ?? 0 },
        ]).map((tabDef) => (
          <button
            key={tabDef.key}
            onClick={() => setTab(tabDef.key)}
            className={`unity-tab flex items-center gap-1.5 px-4 py-2 text-[12px] ${tab === tabDef.key ? "unity-tab-active" : ""}`}
          >
            <tabDef.icon className="size-3" />
            {tabDef.label}
            {tabDef.count > 0 && (
              <Badge variant="secondary" className="ml-0.5 h-4 text-[9px] px-1">{tabDef.count}</Badge>
            )}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="unity-panel overflow-hidden">
              <div className="h-32 bg-[hsl(var(--muted)/0.2)] animate-pulse" />
              <CardContent className="p-3 flex flex-col gap-2">
                <div className="h-4 w-3/4 bg-[hsl(var(--muted)/0.3)] rounded animate-pulse" />
                <div className="h-3 w-1/2 bg-[hsl(var(--muted)/0.2)] rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab !== "jams" && !isLoading && events.length === 0 && (
        <Card className="unity-panel">
          <CardContent className="p-6 text-center">
            <CalendarIcon className="size-8 mx-auto mb-2 text-[hsl(var(--muted-foreground)/0.3)]" />
            <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("calendar.empty", { defaultValue: "No events to show right now — VRChat's calendar is region- and account-gated, try again later." })}
            </p>
          </CardContent>
        </Card>
      )}

      {tab !== "jams" && !isLoading && events.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {events.map((e, i) => (
            <EventCard key={e.id ?? `${tab}-${i}`} event={e} onOpen={openEvent} />
          ))}
        </div>
      )}

      {tab === "jams" && !isLoading && jamItems.length === 0 && (
        <Card className="unity-panel">
          <CardContent className="p-6 text-center">
            <Trophy className="size-8 mx-auto mb-2 text-[hsl(var(--muted-foreground)/0.3)]" />
            <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("calendar.noJams", { defaultValue: "No active jams right now." })}
            </p>
          </CardContent>
        </Card>
      )}

      {tab === "jams" && !isLoading && jamItems.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {jamItems.map((j, i) => (
            <JamCard key={j.id ?? `jam-${i}`} jam={j} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({ event, onOpen }: { event: CalendarEvent; onOpen: (e: CalendarEvent) => void }) {
  const { t } = useTranslation();
  const when = formatWhen(getStartsAt(event));
  const endsWhen = formatWhen(getEndsAt(event));
  const thumb = getImageUrl(event);
  const worldId = getWorldId(event);
  const { url: worldThumb } = useThumbnail(!thumb && worldId ? worldId : null);
  const banner = thumb ?? worldThumb;
  const groupName = getGroupName(event);
  const hostName = getHostName(event);
  const attending = getAttending(event);

  return (
    <Card className="unity-panel overflow-hidden flex flex-col">
      <div className="relative h-32 overflow-hidden">
        <ThumbImage
          src={banner}
          seedKey={event.id ?? getEventTitle(event)}
          label={getEventTitle(event)}
          className="h-full w-full rounded-none border-0"
          aspect=""
          priority="eager"
        />
        {event.isFeatured && (
          <Badge variant="warning" className="absolute top-2 right-2 gap-1 z-10">
            <Star className="size-3" />
            Featured
          </Badge>
        )}
        {event.region && (
          <Badge variant="outline" className="absolute top-2 left-2 gap-1 bg-[hsl(var(--surface)/0.85)] backdrop-blur-sm z-10">
            <Globe className="size-3" />
            {String(event.region).toUpperCase()}
          </Badge>
        )}
      </div>
      <CardContent className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="text-[13px] font-medium line-clamp-1">{getEventTitle(event)}</div>
        {when && (
          <div className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))] font-mono">
            <Clock className="size-3" />
            {when}
            {endsWhen && endsWhen !== when && <span className="text-[10px] opacity-60">→ {endsWhen}</span>}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {groupName && (
            <Badge variant="outline" className="text-[10px] gap-1"><Users className="size-2.5" />{groupName}</Badge>
          )}
          {hostName && (
            <Badge variant="outline" className="text-[10px] gap-1"><UserCircle className="size-2.5" />{hostName}</Badge>
          )}
          {attending !== undefined && attending > 0 && (
            <Badge variant="secondary" className="text-[10px]">{attending} attending</Badge>
          )}
        </div>
        {event.description && (
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-2 mt-0.5">
            {String(event.description)}
          </p>
        )}
        <div className="mt-auto pt-1">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-7 text-[11px]"
            onClick={() => onOpen(event)}
          >
            <ExternalLink className="size-3" />
            {t("calendar.openInBrowser", { defaultValue: "Open in VRChat" })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function openJam(jam: Jam) {
  const url = jam.id
    ? `https://vrchat.com/home/jams/${jam.id}`
    : "https://vrchat.com/home/jams";
  void ipc.call<{ url: string }, { ok: boolean }>("shell.openUrl", { url });
}

function JamCard({ jam }: { jam: Jam }) {
  const { t } = useTranslation();
  const detail = useQuery({
    queryKey: ["jams.detail", jam.id],
    queryFn: () => ipc.jamsDetail(jam.id!),
    enabled: !!jam.id && !getJamImage(jam),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const mergedJam = mergeJamDetail(jam, detail.data);
  const title = firstString(mergedJam.title, mergedJam.name) ?? "Untitled Jam";
  const thumb = getJamImage(mergedJam);
  const state = firstString(mergedJam.state) ?? (mergedJam.isActive ? "active" : undefined);

  return (
    <Card className="unity-panel overflow-hidden flex flex-col">
      <div className="relative h-32 overflow-hidden">
        {thumb ? (
          <ThumbImage
            src={thumb}
            seedKey={mergedJam.id ?? title}
            label={title}
            className="h-full w-full rounded-none border-0"
            aspect=""
            priority="eager"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.18)] text-[hsl(var(--muted-foreground))]">
            <ImageOff className="size-7 opacity-70" />
            <span className="text-[11px] font-medium">
              {detail.isFetching
                ? t("calendar.resolvingPreview", { defaultValue: "Looking for preview…" })
                : t("calendar.noPreview", { defaultValue: "No preview image" })}
            </span>
          </div>
        )}
      </div>
      <CardHeader className="pb-1.5">
        <CardTitle className="text-[13px] flex items-center gap-2 line-clamp-1">
          <Trophy className="size-3.5 text-amber-400" />
          {title}
          {state && (
            <Badge variant={mergedJam.isActive ? "default" : "outline"} className="text-[9px] h-4">{state.toUpperCase()}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 flex-1 flex flex-col">
        {mergedJam.description && (
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-3">
            {String(mergedJam.description)}
          </p>
        )}
        {mergedJam.closedAt && (
          <div className="mt-2 text-[10px] text-[hsl(var(--muted-foreground))]">
            {t("calendar.closesAt", { defaultValue: "Closes {{when}}", when: formatWhen(mergedJam.closedAt) })}
          </div>
        )}
        <div className="mt-auto pt-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-7 text-[11px]"
            onClick={() => openJam(jam)}
          >
            <ExternalLink className="size-3" />
            {t("calendar.openJamPage", { defaultValue: "Open jam page" })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
