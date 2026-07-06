import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  Loader2,
  RefreshCw,
  Search,
  ShieldEllipsis,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { UserPopupBadge } from "@/components/UserPopupBadge";
import { WorldPopupBadge } from "@/components/WorldPopupBadge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { clearHistory, listFriendLog, listPlayerEvents } from "@/lib/history-api";
import { getFriendNote, setFriendNote } from "@/lib/social";
import type { DbPlayerEvent, FriendLogEvent, PagedItems } from "@/lib/types";

type SessionEvent = DbPlayerEvent;
type SocialEvent = FriendLogEvent;

type FeedTab = "session" | "social";

const DEFAULT_PAGE_SIZE = 100;

interface FriendLogPanelProps {
  embedded?: boolean;
}

function parseTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.includes("T")
    ? value
    : value.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, "$1-$2-$3");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function useRelativeTime() {
  const { t } = useTranslation();
  return useCallback((value: string | null | undefined) => {
    const parsed = parseTime(value);
    if (!parsed) return "--";
    const diff = Date.now() - parsed.getTime();
    if (diff < 60_000) return t("friendLog.relative.now");
    if (diff < 3_600_000) {
      return t("friendLog.relative.minutes", {
        count: Math.floor(diff / 60_000),
      });
    }
    if (diff < 86_400_000) {
      return t("friendLog.relative.hours", {
        count: Math.floor(diff / 3_600_000),
      });
    }
    if (diff < 604_800_000) {
      return t("friendLog.relative.days", {
        count: Math.floor(diff / 86_400_000),
      });
    }
    return parsed.toLocaleDateString();
  }, [t]);
}

function sessionKindTone(kind: string): string {
  switch (kind) {
    case "joined":
    case "join":
      return "bg-emerald-500/12 text-emerald-400 border-emerald-500/25";
    case "left":
    case "leave":
      return "bg-zinc-500/12 text-zinc-300 border-zinc-500/25";
    default:
      return "bg-sky-500/12 text-sky-300 border-sky-500/25";
  }
}

function sessionKindIcon(kind: string) {
  switch (kind) {
    case "joined":
    case "join":
      return <UserPlus className="size-3.5 text-emerald-400" />;
    case "left":
    case "leave":
      return <UserMinus className="size-3.5 text-zinc-400" />;
    default:
      return <Users className="size-3.5 text-sky-400" />;
  }
}

function socialKindTone(eventType: string | null): string {
  switch (eventType) {
    case "friend.added":
      return "bg-emerald-500/12 text-emerald-400 border-emerald-500/25";
    case "friend.removed":
      return "bg-orange-500/12 text-orange-400 border-orange-500/25";
    default:
      return "bg-sky-500/12 text-sky-300 border-sky-500/25";
  }
}

function socialKindLabel(eventType: string | null, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (eventType) {
    case "friend.added":
      return t("friendLog.social.kind.friendAdded");
    case "friend.removed":
      return t("friendLog.social.kind.friendRemoved");
    case "status.changed":
      return t("friendLog.social.kind.statusChanged");
    case "location.changed":
      return t("friendLog.social.kind.locationChanged");
    case "avatar.changed":
      return t("friendLog.social.kind.avatarChanged");
    default:
      return eventType ?? t("friendLog.social.kind.unknown");
  }
}

function sessionKindLabel(kind: string, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (kind) {
    case "joined":
    case "join":
      return t("friendLog.session.kind.joined");
    case "left":
    case "leave":
      return t("friendLog.session.kind.left");
    default:
      return kind;
  }
}

function sessionDisplayName(event: SessionEvent): string {
  return event.display_name ?? event.user_id ?? "Unknown";
}

function sessionKind(event: SessionEvent): string {
  return event.kind ?? "event";
}

function sessionOccurredAt(event: SessionEvent): string {
  return event.occurred_at ?? "";
}

function NoteEditor({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getFriendNote(userId).then((r) => {
      if (!alive) return;
      setNote(r?.note ?? "");
      setLoading(false);
    }).catch(() => {
      if (alive) { setLoading(false); setLoadError(true); }
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  async function save() {
    setSaving(true);
    try {
      await setFriendNote(userId, note);
      toast.success(t("friendLog.note.saved"));
      onClose();
    } catch (e) {
      toast.error(
        t("friendLog.note.saveFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-3">
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          <Loader2 className="size-3 animate-spin" />
          {t("friendLog.note.loading")}
        </div>
      ) : loadError ? (
        <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("friendLog.note.loadFailed", { defaultValue: "Could not load note." })}
          <button
            type="button"
            className="ml-2 underline text-[hsl(var(--primary))] hover:text-[hsl(var(--primary)/0.8)]"
            onClick={() => { setLoadError(false); setLoading(true); }}
          >
            {t("common.retry", { defaultValue: "Retry" })}
          </button>
        </div>
      ) : (
        <>
          <textarea
            className={cn(
              "min-h-[84px] w-full resize-none rounded-[var(--radius-sm)] border border-[hsl(var(--border))]",
              "bg-[hsl(var(--surface))] px-3 py-2 text-[12px] text-[hsl(var(--foreground))]",
              "placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]",
            )}
            placeholder={t("friendLog.note.placeholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" className="h-7 text-[11px]" disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
              {saving ? t("profile.saving") : t("common.save")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function SessionEventRow({ event }: { event: SessionEvent }) {
  const { t } = useTranslation();
  const relativeTime = useRelativeTime();
  const [noteOpen, setNoteOpen] = useState(false);

  return (
    <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border)/0.65)] bg-[hsl(var(--surface))] p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{sessionKindIcon(sessionKind(event))}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {event.user_id?.startsWith("usr_") ? (
              <UserPopupBadge userId={event.user_id} displayName={sessionDisplayName(event)} />
            ) : (
              <span className="truncate text-[13px] font-medium text-[hsl(var(--foreground))]">
                {sessionDisplayName(event)}
              </span>
            )}
            <Badge variant="outline" className={cn("h-5 border text-[10px] font-mono", sessionKindTone(sessionKind(event)))}>
              {sessionKindLabel(sessionKind(event), t)}
            </Badge>
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
              {relativeTime(event.occurred_at)}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-[hsl(var(--muted-foreground))]">
            {event.world_id?.startsWith("wrld_") ? (
              <WorldPopupBadge worldId={event.world_id} />
            ) : event.world_id ? (
              <span className="font-mono">{event.world_id}</span>
            ) : null}
            <span>{parseTime(event.occurred_at)?.toLocaleString() ?? sessionOccurredAt(event)}</span>
          </div>
        </div>

        {event.user_id ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-[10px]"
            onClick={() => setNoteOpen((value) => !value)}
          >
            <Edit3 className="size-3" />
            {noteOpen ? t("friendLog.note.close") : t("friendLog.note.open")}
          </Button>
        ) : null}
      </div>

      {noteOpen && event.user_id ? (
        <div className="mt-3">
          <NoteEditor userId={event.user_id} onClose={() => setNoteOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

function SocialEventRow({ event }: { event: SocialEvent }) {
  const { t } = useTranslation();
  const relativeTime = useRelativeTime();

  return (
    <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border)/0.65)] bg-[hsl(var(--surface))] p-3">
      <div className="flex items-start gap-3">
        <ShieldEllipsis className="mt-0.5 size-3.5 text-sky-400" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {event.user_id?.startsWith("usr_") ? (
              <UserPopupBadge userId={event.user_id} displayName={event.display_name ?? undefined} />
            ) : (
              <span className="truncate text-[13px] font-medium text-[hsl(var(--foreground))]">
                {event.display_name ?? event.user_id ?? t("friendLog.social.unknownUser")}
              </span>
            )}
            <Badge variant="outline" className={cn("h-5 border text-[10px] font-mono", socialKindTone(event.event_type))}>
              {socialKindLabel(event.event_type, t)}
            </Badge>
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
              {relativeTime(event.occurred_at)}
            </span>
          </div>

          {(event.old_value || event.new_value) ? (
            <div className="mt-2 grid gap-1 text-[10.5px] text-[hsl(var(--muted-foreground))]">
              <div>
                {t("friendLog.social.from")}:{" "}
                <span className="font-mono text-[hsl(var(--foreground))]">
                  {event.old_value ?? "—"}
                </span>
              </div>
              <div>
                {t("friendLog.social.to")}:{" "}
                <span className="font-mono text-[hsl(var(--foreground))]">
                  {event.new_value ?? "—"}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function FriendLogPanel({ embedded = false }: FriendLogPanelProps) {
  const { t } = useTranslation();
  const { status: authStatus } = useAuth();
  const queryClient = useQueryClient();
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [tab, setTab] = useState<FeedTab>("session");
  // Offset-based paging: one page in view at a time (server-side LIMIT/OFFSET).
  // Each tab keeps its own page index so switching tabs preserves position.
  const [sessionPage, setSessionPage] = useState(0);
  const [socialPage, setSocialPage] = useState(0);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);

  const page = tab === "session" ? sessionPage : socialPage;
  const setPage = tab === "session" ? setSessionPage : setSocialPage;

  // One fetch per (tab, pageSize, page) — server does the LIMIT/OFFSET slicing.
  // `keepPreviousData` holds the current rows on screen while the next page
  // loads so Prev/Next doesn't flash an empty list. staleTime matches the rest
  // of the app so re-entering /radar reuses cached pages.
  const sessionQuery = useQuery<PagedItems<SessionEvent>>({
    queryKey: ["db.playerEvents.list", pageSize, sessionPage],
    queryFn: () => listPlayerEvents(pageSize, sessionPage * pageSize),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

  const socialQuery = useQuery<PagedItems<SocialEvent>>({
    queryKey: ["friendLog.recent", pageSize, socialPage],
    queryFn: () => listFriendLog(pageSize, socialPage * pageSize),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

  const sessionItems = useMemo(
    () => sessionQuery.data?.items ?? [],
    [sessionQuery.data],
  );
  const socialItems = useMemo(
    () => socialQuery.data?.items ?? [],
    [socialQuery.data],
  );

  const activeQuery = tab === "session" ? sessionQuery : socialQuery;
  const pageItems = tab === "session" ? sessionItems : socialItems;

  const loading = activeQuery.isPending;
  // A full page implies at least one more may exist. If the host reports
  // `total`, we trust that instead of the fetched-count heuristic.
  const reportedTotal = activeQuery.data?.total;
  const hasNextPage = reportedTotal !== undefined
    ? (page + 1) * pageSize < reportedTotal
    : pageItems.length >= pageSize;
  const hasPrevPage = page > 0;
  // Item range shown on this page (1-indexed for humans).
  const rangeStart = pageItems.length === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = page * pageSize + pageItems.length;

  function refresh() {
    void sessionQuery.refetch();
    void socialQuery.refetch();
  }

  async function handleClearHistory() {
    setClearingHistory(true);
    try {
      await clearHistory(false);
      await queryClient.invalidateQueries({ queryKey: ["db.playerEvents.list"] });
      await queryClient.invalidateQueries({ queryKey: ["friendLog.recent"] });
      toast.success(t("friendLog.clearHistorySuccess", {
        defaultValue: "History cleared. Friend notes were kept.",
      }));
    } catch (e) {
      toast.error(
        t("friendLog.clearHistoryFailed", {
          error: e instanceof Error ? e.message : String(e),
          defaultValue: "Failed to clear history: {{error}}",
        }),
      );
    } finally {
      setClearingHistory(false);
      setClearHistoryOpen(false);
    }
  }

  // Search filters the CURRENT page's rows only. Because paging is server-side
  // (LIMIT/OFFSET) and the friend-log/player-event bridges expose no search
  // param, this is a per-page filter — matches on other pages are not pulled
  // in. The UI surfaces this so the scope is never surprising.
  const filteredSession = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    if (!query) return sessionItems;
    return sessionItems.filter((event) =>
      sessionDisplayName(event).toLowerCase().includes(query) ||
      (event.user_id?.toLowerCase().includes(query) ?? false) ||
      (event.world_id?.toLowerCase().includes(query) ?? false),
    );
  }, [debouncedSearch, sessionItems]);

  const filteredSocial = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    if (!query) return socialItems;
    return socialItems.filter((event) =>
      (event.user_id?.toLowerCase().includes(query) ?? false) ||
      (event.event_type?.toLowerCase().includes(query) ?? false) ||
      (event.old_value?.toLowerCase().includes(query) ?? false) ||
      (event.new_value?.toLowerCase().includes(query) ?? false),
    );
  }, [debouncedSearch, socialItems]);

  const searchActive = debouncedSearch.trim().length > 0;

  const sessionUniquePlayers = useMemo(() => {
    const set = new Set<string>();
    sessionItems.forEach((event) => {
      if (event.user_id) set.add(event.user_id);
      else set.add(sessionDisplayName(event));
    });
    return set.size;
  }, [sessionItems]);

  if (!authStatus.authed) {
    return (
      <div className={cn("space-y-4", !embedded && "animate-fade-in")}>
        {embedded ? null : (
          <header className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-[22px] font-semibold leading-none tracking-tight">
                {t("nav.friendLog")}
              </h1>
            </div>
          </header>
        )}
        <div className="flex min-h-[200px] items-center justify-center rounded-xl border-2 border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.1)] p-8 text-center">
          <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("friendLog.loginRequired", { defaultValue: "Log in to VRChat via the Settings page to view friend activity history." })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", !embedded && "animate-fade-in")}>
      {embedded ? null : (
        <header className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold leading-none tracking-tight">
              {t("nav.friendLog")}
            </h1>
            <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("friendLog.subtitle")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-[12px]"
            disabled={loading}
            onClick={refresh}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            {t("common.refresh")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-[12px] text-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))]"
            disabled={clearingHistory}
            onClick={() => setClearHistoryOpen(true)}
          >
            <Trash2 className={cn("size-3.5", clearingHistory && "animate-pulse")} />
            {t("friendLog.clearHistory", { defaultValue: "Clear History" })}
          </Button>
        </header>
      )}

      {embedded ? (
        <Card className="border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--canvas))] shadow-sm">
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-[14px] font-semibold text-[hsl(var(--foreground))]">
                {t("nav.friendLog")}
              </div>
              <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                {t("friendLog.subtitle")}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-[12px]"
              disabled={loading}
              onClick={refresh}
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              {t("common.refresh")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-[12px] text-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))]"
              disabled={clearingHistory}
              onClick={() => setClearHistoryOpen(true)}
            >
              <Trash2 className={cn("size-3.5", clearingHistory && "animate-pulse")} />
              {t("friendLog.clearHistory", { defaultValue: "Clear History" })}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              {t("friendLog.stats.sessionEvents")}
            </div>
            <div className="mt-1 text-xl font-bold tabular-nums text-[hsl(var(--foreground))]">
              {sessionItems.length.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              {t("friendLog.stats.uniquePlayers")}
            </div>
            <div className="mt-1 text-xl font-bold tabular-nums text-[hsl(var(--foreground))]">
              {sessionUniquePlayers.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              {t("friendLog.stats.socialChanges")}
            </div>
            <div className="mt-1 text-xl font-bold tabular-nums text-[hsl(var(--foreground))]">
              {socialItems.length.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={cn(
                "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                tab === "session"
                  ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                  : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]",
              )}
              onClick={() => setTab("session")}
            >
              <div className="flex items-center gap-1.5">
                <Wifi className="size-3" />
                {t("friendLog.tabs.session")}
              </div>
            </button>
            <button
              type="button"
              className={cn(
                "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                tab === "social"
                  ? "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                  : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]",
              )}
              onClick={() => setTab("social")}
            >
              <div className="flex items-center gap-1.5">
                <ShieldEllipsis className="size-3" />
                {t("friendLog.tabs.social")}
              </div>
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <Input
              className="h-8 pl-8 text-[12px]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("friendLog.searchPlaceholder")}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-0">
          <CardTitle className="flex items-center gap-2 text-[13px]">
            {tab === "session" ? t("friendLog.session.title") : t("friendLog.social.title")}
            <input
              type="number"
              min={10}
              max={500}
              value={pageSize}
              onChange={(e) => {
                setPageSize(Math.min(500, Math.max(10, Number(e.target.value) || DEFAULT_PAGE_SIZE)));
                // Page indices are relative to the old size; reset to the first
                // page so the visible offset stays valid.
                setSessionPage(0);
                setSocialPage(0);
              }}
              className="w-12 rounded border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-1 py-0.5 text-center text-[10px] font-mono text-[hsl(var(--foreground))]"
              title={t("friendLog.perPage", { defaultValue: "Items per page" })}
            />
          </CardTitle>
          <CardDescription className="text-[11px]">
            {tab === "session" ? t("friendLog.session.desc") : t("friendLog.social.desc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-3 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-[hsl(var(--muted-foreground))]">
              <Loader2 className="mr-2 size-5 animate-spin" />
              <span className="text-sm">{t("common.loading")}</span>
            </div>
          ) : pageItems.length === 0 && !hasPrevPage ? (
            // True empty state: first page, nothing stored yet.
            <div className="flex flex-col items-center justify-center px-6 py-10 text-[hsl(var(--muted-foreground))]">
              <Clock className="mb-3 size-8 opacity-40" />
              <pre className="max-w-[60ch] whitespace-pre-line text-center text-[12px] font-sans leading-relaxed">
                {tab === "session"
                  ? t("friendLog.session.empty")
                  : t("friendLog.social.empty")}
              </pre>
            </div>
          ) : (
            <>
              {(tab === "session" ? filteredSession : filteredSocial).length === 0 ? (
                // Page has rows, but this page's search filter (or an overshot
                // page) leaves nothing to show. Keep pagination reachable.
                <div className="flex flex-col items-center justify-center px-6 py-8 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                  <Clock className="mb-2 size-6 opacity-40" />
                  {searchActive
                    ? t("friendLog.noMatchesOnPage", {
                        defaultValue: "No matches on this page. Try another page or clear the search.",
                      })
                    : t("friendLog.emptyPage", {
                        defaultValue: "No items on this page.",
                      })}
                </div>
              ) : (
                <div className="space-y-2">
                  {tab === "session"
                    ? filteredSession.map((event) => (
                        <SessionEventRow key={`${event.id}-${event.occurred_at}`} event={event} />
                      ))
                    : filteredSocial.map((event) => (
                        <SocialEventRow key={`${event.id}-${event.occurred_at}`} event={event} />
                      ))}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--border)/0.5)] pt-3">
                <div className="min-w-0 text-[11px] text-[hsl(var(--muted-foreground))]">
                  <span>
                    {t("friendLog.pageLabel", {
                      defaultValue: "Page {{page}}",
                      page: page + 1,
                    })}
                  </span>
                  <span className="mx-1.5 opacity-50">·</span>
                  <span className="tabular-nums">
                    {reportedTotal !== undefined
                      ? t("friendLog.rangeOfTotal", {
                          defaultValue: "{{start}}–{{end}} of {{total}}",
                          start: rangeStart,
                          end: rangeEnd,
                          total: reportedTotal,
                        })
                      : t("friendLog.range", {
                          defaultValue: "items {{start}}–{{end}}",
                          start: rangeStart,
                          end: rangeEnd,
                        })}
                  </span>
                  {searchActive ? (
                    <span className="ml-1.5 opacity-75">
                      {t("friendLog.searchScopePage", {
                        defaultValue: "(search filters this page only)",
                      })}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  {activeQuery.isFetching ? (
                    <Loader2 className="size-3 animate-spin text-[hsl(var(--muted-foreground))]" />
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-[11px]"
                    disabled={!hasPrevPage || activeQuery.isFetching}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="size-3.5" />
                    {t("common.previous", { defaultValue: "Previous" })}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-[11px]"
                    disabled={!hasNextPage || activeQuery.isFetching}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t("common.next", { defaultValue: "Next" })}
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={clearHistoryOpen}
        onOpenChange={setClearHistoryOpen}
        title={t("friendLog.clearHistory", { defaultValue: "Clear History" })}
        description={t("friendLog.clearHistoryConfirm", {
          defaultValue: "Clear stored session history and social change history? Friend notes will be kept.",
        })}
        confirmLabel={t("friendLog.clearHistory", { defaultValue: "Clear History" })}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void handleClearHistory()}
        loading={clearingHistory}
        tone="destructive"
      />
    </div>
  );
}

export default function FriendLog() {
  return <FriendLogPanel />;
}
