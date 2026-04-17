import { ipc } from "@/lib/ipc";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Edit3,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

// ── Types ────────────────────────────────────────────────────────────

interface PlayerEvent {
  id: number;
  kind: string;            // "join" | "leave"
  display_name: string;
  user_id?: string;
  world_id?: string;
  occurred_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function eventIcon(kind: string) {
  switch (kind) {
    case "join":
      return <UserPlus className="size-3.5 text-emerald-400" />;
    case "leave":
      return <UserMinus className="size-3.5 text-rose-400" />;
    case "friend_add":
      return <UserCheck className="size-3.5 text-sky-400" />;
    case "friend_remove":
      return <UserMinus className="size-3.5 text-orange-400" />;
    case "online":
      return <UserCheck className="size-3.5 text-emerald-400" />;
    case "offline":
      return <Clock className="size-3.5 text-zinc-500" />;
    default:
      return <Users className="size-3.5 text-zinc-500" />;
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "join":       return "Joined";
    case "leave":      return "Left";
    case "friend_add": return "Friend Added";
    case "friend_remove": return "Friend Removed";
    case "online":     return "Online";
    case "offline":    return "Offline";
    default:           return kind;
  }
}

function kindColor(kind: string): string {
  switch (kind) {
    case "join":
    case "online":
    case "friend_add":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "leave":
    case "offline":
      return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
    case "friend_remove":
      return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    default:
      return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
  }
}

// ── Note Editor ──────────────────────────────────────────────────────

function NoteEditor({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    ipc.friendNoteGet(userId).then((r) => {
      if (alive) {
        setNote(r.note ?? "");
        setLoading(false);
      }
    }).catch(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [userId]);

  const save = async () => {
    setSaving(true);
    try {
      await ipc.friendNoteSet(userId, note);
      toast.success("Note saved");
      onClose();
    } catch (e) {
      toast.error(`Failed to save note: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          <Loader2 className="size-3 animate-spin" /> Loading note…
        </div>
      ) : (
        <>
          <textarea
            className={cn(
              "w-full rounded-[var(--radius-sm)] border border-[hsl(var(--border))]",
              "bg-[hsl(var(--canvas))] px-3 py-2 text-[12px] text-[hsl(var(--foreground))]",
              "placeholder:text-[hsl(var(--muted-foreground))]",
              "focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]",
              "resize-none min-h-[80px]",
            )}
            placeholder="Add a personal note about this friend…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-[11px]"
              disabled={saving}
              onClick={save}
            >
              {saving ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
              Save Note
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Player Event Row ─────────────────────────────────────────────────

function EventRow({ event }: { event: PlayerEvent }) {
  const [expanded, setExpanded] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  return (
    <div
      className={cn(
        "group border-b border-[hsl(var(--border)/0.5)]",
        "hover:bg-[hsl(var(--surface-raised)/0.5)]",
        "transition-colors",
      )}
    >
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Event icon */}
        <div className="flex-shrink-0">{eventIcon(event.kind)}</div>

        {/* Name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-[hsl(var(--foreground))] truncate">
              {event.display_name}
            </span>
            <Badge
              variant="outline"
              className={cn("text-[10px] px-1.5 py-0 h-4 font-mono", kindColor(event.kind))}
            >
              {kindLabel(event.kind)}
            </Badge>
          </div>
          {event.world_id ? (
            <div className="text-[10px] text-[hsl(var(--muted-foreground))] truncate mt-0.5">
              {event.world_id}
            </div>
          ) : null}
        </div>

        {/* Time */}
        <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))] tabular-nums shrink-0">
          <Clock className="size-3" />
          {relativeTime(event.occurred_at)}
        </div>

        {/* Expand chevron */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
          {expanded ? (
            <ChevronDown className="size-3.5 text-[hsl(var(--muted-foreground))]" />
          ) : (
            <ChevronRight className="size-3.5 text-[hsl(var(--muted-foreground))]" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 ml-[30px] space-y-2 animate-in fade-in-0 slide-in-from-top-1 duration-150">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <div className="text-[hsl(var(--muted-foreground))]">Event</div>
            <div className="text-[hsl(var(--foreground))] font-mono">{event.kind}</div>

            <div className="text-[hsl(var(--muted-foreground))]">Time</div>
            <div className="text-[hsl(var(--foreground))] font-mono">
              {new Date(event.occurred_at).toLocaleString()}
            </div>

            {event.user_id ? (
              <>
                <div className="text-[hsl(var(--muted-foreground))]">User ID</div>
                <div className="text-[hsl(var(--foreground))] font-mono truncate">{event.user_id}</div>
              </>
            ) : null}

            {event.world_id ? (
              <>
                <div className="text-[hsl(var(--muted-foreground))]">World</div>
                <div className="text-[hsl(var(--foreground))] font-mono truncate">{event.world_id}</div>
              </>
            ) : null}
          </div>

          {event.user_id ? (
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] gap-1"
                onClick={(e) => { e.stopPropagation(); setNoteOpen(!noteOpen); }}
              >
                <Edit3 className="size-3" />
                {noteOpen ? "Close" : "Note"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  ipc.dbPlayerEncounters(event.user_id!).then((r) => {
                    toast.info(`${r.items.length} encounter(s) recorded with ${event.display_name}`);
                  }).catch(() => {});
                }}
              >
                <Users className="size-3" />
                Encounters
              </Button>
            </div>
          ) : null}

          {noteOpen && event.user_id ? (
            <NoteEditor userId={event.user_id} onClose={() => setNoteOpen(false)} />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Main FriendLog Page ──────────────────────────────────────────────

const PAGE_SIZE = 50;

function FriendLog() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<PlayerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebouncedValue(filter, 200);
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (reset = false) => {
    const newOffset = reset ? 0 : offset;
    setLoading(true);
    try {
      const result = await ipc.dbPlayerEvents(PAGE_SIZE, newOffset);
      const items = result.items as PlayerEvent[];
      if (reset) {
        setEvents(items);
        setOffset(items.length);
      } else {
        setEvents((prev) => [...prev, ...items]);
        setOffset((prev) => prev + items.length);
      }
      setHasMore(items.length >= PAGE_SIZE);
    } catch (e) {
      toast.error(`Failed to load events: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let items = events;
    if (kindFilter !== "all") {
      items = items.filter((e) => e.kind === kindFilter);
    }
    if (debouncedFilter) {
      const q = debouncedFilter.toLowerCase();
      items = items.filter(
        (e) =>
          e.display_name.toLowerCase().includes(q) ||
          (e.user_id?.toLowerCase().includes(q) ?? false) ||
          (e.world_id?.toLowerCase().includes(q) ?? false),
      );
    }
    return items;
  }, [events, debouncedFilter, kindFilter]);

  // Unique player count
  const uniquePlayers = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) {
      set.add(e.display_name);
    }
    return set.size;
  }, [events]);

  // Kind counts for filter badges
  const kindCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of events) {
      map[e.kind] = (map[e.kind] ?? 0) + 1;
    }
    return map;
  }, [events]);

  const kinds = Object.keys(kindCounts).sort();

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[hsl(var(--foreground))]">
            {t("nav.friendLog", { defaultValue: "Friend Log" })}
          </h1>
          <p className="text-[12px] text-[hsl(var(--muted-foreground))] mt-0.5">
            Player join/leave history from your VRChat sessions
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-[12px]"
          disabled={loading}
          onClick={() => load(true)}
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="bg-[hsl(var(--surface))]">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Total Events
            </div>
            <div className="text-xl font-bold text-[hsl(var(--foreground))] tabular-nums mt-0.5">
              {events.length.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[hsl(var(--surface))]">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Unique Players
            </div>
            <div className="text-xl font-bold text-[hsl(var(--foreground))] tabular-nums mt-0.5">
              {uniquePlayers.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[hsl(var(--surface))]">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Filtered
            </div>
            <div className="text-xl font-bold text-[hsl(var(--foreground))] tabular-nums mt-0.5">
              {filtered.length.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter bar */}
      <Card className="bg-[hsl(var(--surface))]">
        <CardContent className="p-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[hsl(var(--muted-foreground))]" />
            <Input
              className="h-8 pl-8 text-[12px]"
              placeholder="Search by player name, user ID, or world ID…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                onClick={() => setFilter("")}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Kind filter pills */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                kindFilter === "all"
                  ? "bg-[hsl(var(--primary)/0.2)] text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.5)]"
                  : "bg-transparent text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-raised))]",
              )}
              onClick={() => setKindFilter("all")}
            >
              All ({events.length})
            </button>
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                  kindFilter === k
                    ? kindColor(k)
                    : "bg-transparent text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-raised))]",
                )}
                onClick={() => setKindFilter(kindFilter === k ? "all" : k)}
              >
                {kindLabel(k)} ({kindCounts[k]})
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Event list */}
      <Card className="bg-[hsl(var(--surface))] overflow-hidden">
        <CardHeader className="pb-0 pt-3 px-4">
          <CardTitle className="text-[13px] font-medium text-[hsl(var(--foreground))]">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4" />
              Event Timeline
            </div>
          </CardTitle>
          <CardDescription className="text-[11px]">
            {loading && events.length === 0
              ? "Loading events…"
              : `Showing ${filtered.length} events`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 mt-2">
          {loading && events.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-[hsl(var(--muted-foreground))]">
              <Loader2 className="size-5 animate-spin mr-2" />
              <span className="text-sm">Loading player events…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[hsl(var(--muted-foreground))]">
              <Users className="size-8 mb-2 opacity-40" />
              <span className="text-sm">
                {events.length === 0
                  ? "No player events recorded yet. Start VRChat to begin logging!"
                  : "No events match your filter."}
              </span>
            </div>
          ) : (
            <>
              <div className="divide-y divide-[hsl(var(--border)/0.3)]">
                {filtered.map((event) => (
                  <EventRow key={`${event.id}-${event.occurred_at}`} event={event} />
                ))}
              </div>

              {/* Load more */}
              {hasMore && (
                <div className="flex justify-center py-3 border-t border-[hsl(var(--border)/0.5)]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px] gap-1.5"
                    disabled={loading}
                    onClick={() => load(false)}
                  >
                    {loading ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <ChevronDown className="size-3" />
                    )}
                    Load More
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default FriendLog;
