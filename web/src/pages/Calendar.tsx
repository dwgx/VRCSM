import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import type { WorkspaceGroup, WorkspaceGroupsResult } from "@/lib/types";
import {
  Calendar as CalendarIcon,
  Star,
  Trophy,
  Clock,
  Globe,
  Users,
  ExternalLink,
  UserCircle,
} from "lucide-react";

type CalendarTab = "groups" | "jams" | "featured";

interface CalendarEvent {
  id?: string;
  name?: string;
  title?: string;
  description?: string;
  startsAt?: string;
  starts_at?: string;
  endsAt?: string;
  ends_at?: string;
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
  state?: string;
  isActive?: boolean;
  submissionsCanBeVoted?: boolean;
  closedAt?: string;
  startedAt?: string;
  [key: string]: unknown;
}

function firstString(...values: (string | undefined | null)[]): string | undefined {
  for (const v of values) if (v) return v;
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

function getWorldId(e: CalendarEvent): string | undefined {
  return firstString(e.worldId, e.world_id);
}

function getGroupId(e: CalendarEvent): string | undefined {
  return firstString(e.groupId, e.group_id);
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

function openGroup(groupId: string) {
  void ipc.call<{ url: string }, { ok: boolean }>("shell.openUrl", {
    url: `https://vrchat.com/home/group/${groupId}`,
  });
}

function dedupeEvents(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  const out: CalendarEvent[] = [];
  for (const e of events) {
    const key = e.id ?? `${getEventTitle(e)}|${getStartsAt(e) ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export default function CalendarPage() {
  const { t } = useTranslation();
  const { status } = useAuth();
  const [tab, setTab] = useState<CalendarTab>("groups");

  // The two calendar feeds we know about. /discover is region-gated and
  // /featured is the curator surface; merging both gives us the widest
  // pool to filter against the user's joined groups.
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

  const groups = useQuery<WorkspaceGroupsResult>({
    queryKey: ["groups.list", undefined],
    queryFn: () => ipc.call<undefined, WorkspaceGroupsResult>("groups.list", undefined),
    enabled: status.authed,
    staleTime: 5 * 60_000,
  });

  const joinedGroupIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of (groups.data?.groups ?? []) as WorkspaceGroup[]) {
      if (g.id) set.add(g.id);
    }
    return set;
  }, [groups.data]);

  const allEvents: CalendarEvent[] = useMemo(() => {
    const a = (discover.data?.events ?? []) as CalendarEvent[];
    const b = (featured.data?.events ?? []) as CalendarEvent[];
    return dedupeEvents([...a, ...b]);
  }, [discover.data, featured.data]);

  const groupEvents = useMemo(() => {
    if (joinedGroupIds.size === 0) return [];
    return allEvents.filter((e) => {
      const gid = getGroupId(e);
      return gid ? joinedGroupIds.has(gid) : false;
    });
  }, [allEvents, joinedGroupIds]);

  const featuredEvents: CalendarEvent[] =
    (featured.data?.events ?? []) as CalendarEvent[];

  const rawJams = jams.data;
  const jamItems: Jam[] = Array.isArray(rawJams)
    ? (rawJams as Jam[])
    : ((rawJams as unknown as Record<string, unknown>)?.submissions as Jam[] ?? []);

  const isLoading =
    tab === "groups" ? (discover.isPending || featured.isPending || groups.isPending)
      : tab === "featured" ? featured.isPending
        : jams.isPending;

  const tabDefs = [
    {
      key: "groups" as const,
      icon: Users,
      label: t("calendar.tabGroups", { defaultValue: "我的团体" }),
      count: groupEvents.length,
    },
    {
      key: "jams" as const,
      icon: Trophy,
      label: t("calendar.tabJams", { defaultValue: "Jams" }),
      count: jamItems.length,
    },
    {
      key: "featured" as const,
      icon: Star,
      label: t("calendar.tabFeatured", { defaultValue: "Featured" }),
      count: featuredEvents.length,
    },
  ];

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
        {tabDefs.map((tabDef) => (
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
              <CardContent className="p-3 flex flex-col gap-2">
                <div className="h-4 w-3/4 bg-[hsl(var(--muted)/0.3)] rounded animate-pulse" />
                <div className="h-3 w-1/2 bg-[hsl(var(--muted)/0.2)] rounded animate-pulse" />
                <div className="h-3 w-5/6 bg-[hsl(var(--muted)/0.16)] rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "groups" && !isLoading && (
        <GroupsTab
          authed={status.authed}
          groupCount={joinedGroupIds.size}
          events={groupEvents}
        />
      )}

      {tab === "featured" && !isLoading && featuredEvents.length === 0 && (
        <Card className="unity-panel">
          <CardContent className="p-6 text-center">
            <CalendarIcon className="size-8 mx-auto mb-2 text-[hsl(var(--muted-foreground)/0.3)]" />
            <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("calendar.empty", { defaultValue: "No events to show right now." })}
            </p>
          </CardContent>
        </Card>
      )}

      {tab === "featured" && !isLoading && featuredEvents.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {featuredEvents.map((e, i) => (
            <EventCard key={e.id ?? `featured-${i}`} event={e} onOpen={openEvent} />
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

function GroupsTab({
  authed,
  groupCount,
  events,
}: {
  authed: boolean;
  groupCount: number;
  events: CalendarEvent[];
}) {
  const { t } = useTranslation();

  if (!authed) {
    return (
      <Card className="unity-panel">
        <CardContent className="p-6 text-center">
          <Users className="size-8 mx-auto mb-2 text-[hsl(var(--muted-foreground)/0.3)]" />
          <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("calendar.groupsSignIn", {
              defaultValue: "登录 VRChat 后才能看到加入团体的活动。",
            })}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (groupCount === 0) {
    return (
      <Card className="unity-panel">
        <CardContent className="p-6 text-center">
          <Users className="size-8 mx-auto mb-2 text-[hsl(var(--muted-foreground)/0.3)]" />
          <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("calendar.noGroups", {
              defaultValue: "你还没有加入任何 VRChat 团体。",
            })}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card className="unity-panel">
        <CardContent className="p-6 text-center">
          <CalendarIcon className="size-8 mx-auto mb-2 text-[hsl(var(--muted-foreground)/0.3)]" />
          <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("calendar.noGroupEvents", {
              defaultValue: "你加入的 {{count}} 个团体目前没有公开活动。",
              count: groupCount,
            })}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {events.map((e, i) => (
        <EventCard key={e.id ?? `group-${i}`} event={e} onOpen={openEvent} showGroupAction />
      ))}
    </div>
  );
}

function EventCard({
  event,
  onOpen,
  showGroupAction,
}: {
  event: CalendarEvent;
  onOpen: (e: CalendarEvent) => void;
  showGroupAction?: boolean;
}) {
  const { t } = useTranslation();
  const when = formatWhen(getStartsAt(event));
  const endsWhen = formatWhen(getEndsAt(event));
  const worldId = getWorldId(event);
  const groupId = getGroupId(event);
  const groupName = getGroupName(event);
  const hostName = getHostName(event);
  const attending = getAttending(event);

  return (
    <Card className="unity-panel overflow-hidden flex flex-col">
      <CardContent className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 text-[13px] font-medium line-clamp-1">{getEventTitle(event)}</div>
          <div className="flex shrink-0 gap-1">
            {event.isFeatured && (
              <Badge variant="warning" className="gap-1">
                <Star className="size-3" />
                Featured
              </Badge>
            )}
            {event.region && (
              <Badge variant="outline" className="gap-1">
                <Globe className="size-3" />
                {String(event.region).toUpperCase()}
              </Badge>
            )}
          </div>
        </div>
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
          {worldId && (
            <Badge variant="outline" className="text-[10px]">
              {worldId}
            </Badge>
          )}
        </div>
        {event.description && (
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-2 mt-0.5">
            {String(event.description)}
          </p>
        )}
        <div className="mt-auto pt-1 flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-7 text-[11px]"
            onClick={() => onOpen(event)}
          >
            <ExternalLink className="size-3" />
            {t("calendar.openInBrowser", { defaultValue: "Open in VRChat" })}
          </Button>
          {showGroupAction && groupId && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-7 text-[11px]"
              onClick={() => openGroup(groupId)}
            >
              <Users className="size-3" />
              {t("calendar.openGroupPage", { defaultValue: "Open group" })}
            </Button>
          )}
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
  const title = firstString(jam.title, jam.name) ?? "Untitled Jam";
  const state = firstString(jam.state) ?? (jam.isActive ? "active" : undefined);

  return (
    <Card className="unity-panel overflow-hidden flex flex-col">
      <CardHeader className="pb-1.5">
        <CardTitle className="text-[13px] flex items-center gap-2 line-clamp-1">
          <Trophy className="size-3.5 text-amber-400" />
          {title}
          {state && (
            <Badge variant={jam.isActive ? "default" : "outline"} className="text-[9px] h-4">{state.toUpperCase()}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 flex-1 flex flex-col">
        {jam.description && (
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-3">
            {String(jam.description)}
          </p>
        )}
        {jam.closedAt && (
          <div className="mt-2 text-[10px] text-[hsl(var(--muted-foreground))]">
            {t("calendar.closesAt", { defaultValue: "Closes {{when}}", when: formatWhen(jam.closedAt) })}
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
