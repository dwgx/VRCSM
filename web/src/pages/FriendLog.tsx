import { ipc } from "@/lib/ipc";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
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
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

interface SessionEvent {
  id: number;
  kind: string;
  display_name: string;
  user_id?: string | null;
  world_id?: string | null;
  occurred_at: string;
}

interface SocialEvent {
  id: number;
  user_id: string | null;
  event_type: string | null;
  old_value: string | null;
  new_value: string | null;
  occurred_at: string | null;
}

type FeedTab = "session" | "social";

const PAGE_SIZE = 50;

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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    ipc.friendNoteGet(userId).then((r) => {
      if (!alive) return;
      setNote(r.note ?? "");
      setLoading(false);
    }).catch(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  async function save() {
    setSaving(true);
    try {
      await ipc.friendNoteSet(userId, note);
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
        <div className="mt-0.5">{sessionKindIcon(event.kind)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[13px] font-medium text-[hsl(var(--foreground))]">
              {event.display_name}
            </span>
            <Badge variant="outline" className={cn("h-5 border text-[10px] font-mono", sessionKindTone(event.kind))}>
              {sessionKindLabel(event.kind, t)}
            </Badge>
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
              {relativeTime(event.occurred_at)}
            </span>
          </div>

          <div className="mt-1 grid gap-1 text-[10.5px] text-[hsl(var(--muted-foreground))]">
            {event.user_id ? <div className="font-mono">{event.user_id}</div> : null}
            {event.world_id ? <div className="font-mono">{event.world_id}</div> : null}
            <div>{parseTime(event.occurred_at)?.toLocaleString() ?? event.occurred_at}</div>
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
            <span className="truncate text-[13px] font-medium text-[hsl(var(--foreground))]">
              {event.user_id ?? t("friendLog.social.unknownUser")}
            </span>
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
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([]);
  const [socialEvents, setSocialEvents] = useState<SocialEvent[]>([]);
  const [tab, setTab] = useState<FeedTab>("session");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sessionOffset, setSessionOffset] = useState(0);
  const [socialOffset, setSocialOffset] = useState(0);
  const [sessionHasMore, setSessionHasMore] = useState(true);
  const [socialHasMore, setSocialHasMore] = useState(true);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);

  const load = useCallback(async (reset = false, targetTab?: FeedTab) => {
    const nextTab = targetTab ?? tab;
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      if (nextTab === "session") {
        const offset = reset ? 0 : sessionOffset;
        const result = await ipc.dbPlayerEvents(PAGE_SIZE, offset);
        const items = result.items as SessionEvent[];
        setSessionEvents((prev) => reset ? items : [...prev, ...items]);
        setSessionOffset((prev) => reset ? items.length : prev + items.length);
        setSessionHasMore(items.length >= PAGE_SIZE);
      } else {
        const offset = reset ? 0 : socialOffset;
        const result = await ipc.friendLogRecent(PAGE_SIZE, offset);
        const items = result.items as SocialEvent[];
        setSocialEvents((prev) => reset ? items : [...prev, ...items]);
        setSocialOffset((prev) => reset ? items.length : prev + items.length);
        setSocialHasMore(items.length >= PAGE_SIZE);
      }
    } catch (e) {
      toast.error(
        t("friendLog.loadFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [sessionOffset, socialOffset, t, tab]);

  useEffect(() => {
    void load(true, "session");
    void load(true, "social");
  }, [load]);

  async function handleClearHistory() {
    setClearingHistory(true);
    try {
      await ipc.dbHistoryClear(false);
      setSessionEvents([]);
      setSocialEvents([]);
      setSessionOffset(0);
      setSocialOffset(0);
      setSessionHasMore(false);
      setSocialHasMore(false);
      await Promise.all([load(true, "session"), load(true, "social")]);
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

  const filteredSession = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    if (!query) return sessionEvents;
    return sessionEvents.filter((event) =>
      event.display_name.toLowerCase().includes(query) ||
      (event.user_id?.toLowerCase().includes(query) ?? false) ||
      (event.world_id?.toLowerCase().includes(query) ?? false),
    );
  }, [debouncedSearch, sessionEvents]);

  const filteredSocial = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    if (!query) return socialEvents;
    return socialEvents.filter((event) =>
      (event.user_id?.toLowerCase().includes(query) ?? false) ||
      (event.event_type?.toLowerCase().includes(query) ?? false) ||
      (event.old_value?.toLowerCase().includes(query) ?? false) ||
      (event.new_value?.toLowerCase().includes(query) ?? false),
    );
  }, [debouncedSearch, socialEvents]);

  const sessionUniquePlayers = useMemo(() => {
    const set = new Set<string>();
    sessionEvents.forEach((event) => {
      if (event.user_id) set.add(event.user_id);
      else set.add(event.display_name);
    });
    return set.size;
  }, [sessionEvents]);

  const activeItems = tab === "session" ? filteredSession : filteredSocial;
  const canLoadMore = tab === "session" ? sessionHasMore : socialHasMore;

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
            onClick={() => {
              void load(true, "session");
              void load(true, "social");
            }}
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
              onClick={() => {
                void load(true, "session");
                void load(true, "social");
              }}
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
              {sessionEvents.length.toLocaleString()}
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
              {socialEvents.length.toLocaleString()}
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
          <CardTitle className="text-[13px]">
            {tab === "session" ? t("friendLog.session.title") : t("friendLog.social.title")}
          </CardTitle>
          <CardDescription className="text-[11px]">
            {tab === "session" ? t("friendLog.session.desc") : t("friendLog.social.desc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-3 space-y-3">
          {loading && activeItems.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-[hsl(var(--muted-foreground))]">
              <Loader2 className="mr-2 size-5 animate-spin" />
              <span className="text-sm">{t("common.loading")}</span>
            </div>
          ) : activeItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[hsl(var(--muted-foreground))]">
              <Clock className="mb-2 size-8 opacity-40" />
              <span className="text-sm">
                {tab === "session"
                  ? t("friendLog.session.empty")
                  : t("friendLog.social.empty")}
              </span>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {tab === "session"
                  ? filteredSession.map((event) => (
                      <SessionEventRow key={`${event.id}-${event.occurred_at}`} event={event} />
                    ))
                  : filteredSocial.map((event) => (
                      <SocialEventRow key={`${event.id}-${event.occurred_at}`} event={event} />
                    ))}
              </div>

              {canLoadMore ? (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={loadingMore}
                    onClick={() => void load(false, tab)}
                  >
                    {loadingMore ? (
                      <Loader2 className="mr-1 size-3 animate-spin" />
                    ) : null}
                    {t("friendLog.loadMore")}
                  </Button>
                </div>
              ) : null}
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
