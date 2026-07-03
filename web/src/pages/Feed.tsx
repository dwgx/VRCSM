import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Activity,
  Bell,
  DoorOpen,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  Shield,
  Shirt,
  Smile,
  TerminalSquare,
  UserMinus,
  UserPlus,
  Video,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserPopupBadge } from "@/components/UserPopupBadge";
import { WorldPopupBadge } from "@/components/WorldPopupBadge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useUiPrefStringSet } from "@/lib/ui-prefs";
import { usePipelineEvent } from "@/lib/pipeline-events";
import { qk } from "@/lib/query-keys";
import {
  FEED_CATEGORIES,
  fetchFeed,
  type FeedCategory,
  type FeedEntry,
} from "@/lib/feed";

const PAGE_SIZE = 60;

interface FeedPanelProps {
  /** When embedded inside another page (Radar tab) skip the standalone header. */
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
      return t("friendLog.relative.minutes", { count: Math.floor(diff / 60_000) });
    }
    if (diff < 86_400_000) {
      return t("friendLog.relative.hours", { count: Math.floor(diff / 3_600_000) });
    }
    if (diff < 604_800_000) {
      return t("friendLog.relative.days", { count: Math.floor(diff / 86_400_000) });
    }
    return parsed.toLocaleDateString();
  }, [t]);
}

function categoryIcon(category: FeedCategory) {
  switch (category) {
    case "online":
      return <Wifi className="size-3.5 text-emerald-400" />;
    case "offline":
      return <WifiOff className="size-3.5 text-zinc-400" />;
    case "joined":
      return <UserPlus className="size-3.5 text-emerald-400" />;
    case "left":
      return <UserMinus className="size-3.5 text-zinc-400" />;
    case "friend-added":
      return <UserPlus className="size-3.5 text-sky-400" />;
    case "friend-removed":
      return <UserMinus className="size-3.5 text-orange-400" />;
    case "avatar":
      return <Shirt className="size-3.5 text-violet-400" />;
    case "video":
      return <Video className="size-3.5 text-rose-400" />;
    case "portal":
      return <DoorOpen className="size-3.5 text-cyan-400" />;
    case "moderation":
      return <Shield className="size-3.5 text-amber-400" />;
    case "sticker":
      return <Smile className="size-3.5 text-pink-400" />;
    case "notification":
      return <Bell className="size-3.5 text-sky-400" />;
    case "session":
      return <LogOut className="size-3.5 text-zinc-400" />;
    case "diagnostic":
      return <TerminalSquare className="size-3.5 text-amber-300" />;
    default:
      return <Activity className="size-3.5 text-sky-400" />;
  }
}

function categoryLabel(category: FeedCategory, t: ReturnType<typeof useTranslation>["t"]): string {
  return t(`feed.category.${category}`, { defaultValue: defaultCategoryLabel(category) });
}

function defaultCategoryLabel(category: FeedCategory): string {
  switch (category) {
    case "online": return "Online";
    case "offline": return "Offline";
    case "location": return "Location";
    case "status": return "Status";
    case "avatar": return "Avatar";
    case "joined": return "Joined";
    case "left": return "Left";
    case "friend-added": return "Friend added";
    case "friend-removed": return "Friend removed";
    case "video": return "Video";
    case "portal": return "Portal";
    case "moderation": return "Moderation";
    case "sticker": return "Sticker";
    case "notification": return "Notification";
    case "session": return "Session";
    case "diagnostic": return "Diagnostic";
    default: return "Other";
  }
}

/** Categories whose detail payload is worth showing as a subtext line. */
const DETAIL_CATEGORIES = new Set<FeedCategory>([
  "status",
  "avatar",
  "video",
  "moderation",
  "sticker",
  "notification",
  "session",
  "diagnostic",
]);

function entryMatchesSearch(entry: FeedEntry, query: string): boolean {
  if (!query) return true;
  return (
    (entry.displayName?.toLowerCase().includes(query) ?? false) ||
    (entry.userId?.toLowerCase().includes(query) ?? false) ||
    (entry.worldId?.toLowerCase().includes(query) ?? false) ||
    (entry.detail?.toLowerCase().includes(query) ?? false)
  );
}

function FeedRow({ entry }: { entry: FeedEntry }) {
  const { t } = useTranslation();
  const relativeTime = useRelativeTime();
  const name = entry.displayName ?? entry.userId ?? t("feed.unknownUser", { defaultValue: "Unknown" });

  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-[hsl(var(--border)/0.65)] bg-[hsl(var(--surface))] p-3">
      <div className="mt-0.5">{categoryIcon(entry.category)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          {entry.userId?.startsWith("usr_") ? (
            <UserPopupBadge userId={entry.userId} displayName={entry.displayName ?? undefined} compact />
          ) : (
            <span className="font-medium text-[hsl(var(--foreground))]">{name}</span>
          )}
          <span className="text-[hsl(var(--muted-foreground))]">
            {categoryLabel(entry.category, t)}
          </span>
          {entry.worldId?.startsWith("wrld_") ? (
            <WorldPopupBadge worldId={entry.worldId} />
          ) : null}
        </div>
        {DETAIL_CATEGORIES.has(entry.category) && entry.detail ? (
          <p className="mt-0.5 truncate text-[11px] text-[hsl(var(--muted-foreground))]">{entry.detail}</p>
        ) : null}
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]">
        {relativeTime(entry.occurredAt)}
      </span>
    </div>
  );
}

export function FeedPanel({ embedded = false }: FeedPanelProps) {
  const { t } = useTranslation();
  const { status: authStatus } = useAuth();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<FeedCategory | "all">("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  // Per-category mute (VRCX FeedFiltersDialog parity): right-click a chip to
  // hide that category from the "All" view. Persisted across sessions.
  const [mutedCategories, toggleMuted] = useUiPrefStringSet("vrcsm.feed.muted");

  const activeCategory = category === "all" ? undefined : category;

  const feedQuery = useInfiniteQuery({
    queryKey: qk.feed.unified({ category: activeCategory ?? null }),
    queryFn: ({ pageParam = 0 }) =>
      fetchFeed({ limit: PAGE_SIZE, offset: pageParam as number, category: activeCategory }),
    initialPageParam: 0,
    // Page on the host's RAW row count, not the post-narrow entry count — a full
    // page that narrows to zero matching rows still means "keep paging".
    getNextPageParam: (lastPage, allPages) =>
      lastPage.rawCount < PAGE_SIZE ? undefined : allPages.length * PAGE_SIZE,
    enabled: authStatus.authed,
    staleTime: 15_000,
  });

  // Live refresh: any friend pipeline event means new feed rows may have been
  // written by the recorder. Invalidate the root so the visible page refetches.
  // Debounce via React Query's own dedup — invalidate is cheap and coalesced.
  const onPipeline = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.feed.root });
  }, [queryClient]);
  usePipelineEvent("friend-online", onPipeline);
  usePipelineEvent("friend-offline", onPipeline);
  usePipelineEvent("friend-location", onPipeline);
  usePipelineEvent("friend-active", onPipeline);

  const entries = useMemo(
    () => feedQuery.data?.pages.flatMap((p) => p.entries) ?? [],
    [feedQuery.data],
  );

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    let rows = entries;
    // Muting only applies to the "All" view — selecting a category explicitly
    // always shows it even if muted, so a mute can never hide what you asked for.
    if (category === "all" && mutedCategories.size > 0) {
      rows = rows.filter((e) => !mutedCategories.has(e.category));
    }
    if (!q) return rows;
    return rows.filter((e) => entryMatchesSearch(e, q));
  }, [entries, debouncedSearch, category, mutedCategories]);

  // Virtualize the row list so a feed with thousands of entries only mounts
  // the visible window. Rows have variable height (status/avatar detail line),
  // so measureElement handles dynamic sizing off the estimate.
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 64,
    overscan: 8,
    getItemKey: (index) => filtered[index]?.key ?? index,
  });

  // Auto-load the next page when the last virtual row scrolls into view,
  // replacing the manual "Load more" button with seamless infinite scroll.
  const virtualItems = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (!last) return;
    if (
      last.index >= filtered.length - 1 &&
      feedQuery.hasNextPage &&
      !feedQuery.isFetchingNextPage
    ) {
      void feedQuery.fetchNextPage();
    }
  }, [virtualItems, filtered.length, feedQuery]);

  if (!authStatus.authed) {
    return (
      <div className={cn("space-y-4", !embedded && "animate-fade-in")}>
        <div className="flex min-h-[200px] items-center justify-center rounded-xl border-2 border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.1)] p-8 text-center">
          <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("feed.loginRequired", { defaultValue: "Log in to VRChat via the Settings page to view your activity feed." })}
          </p>
        </div>
      </div>
    );
  }

  const loading = feedQuery.isLoading;
  const loadingMore = feedQuery.isFetchingNextPage;

  return (
    <div className={cn("space-y-4", !embedded && "animate-fade-in")}>
      {embedded ? null : (
        <header className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold leading-none tracking-tight">
              {t("feed.title", { defaultValue: "Activity Feed" })}
            </h1>
            <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("feed.subtitle", { defaultValue: "Unified, persistent timeline of friend presence, sessions and avatar changes." })}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-[12px]"
            disabled={loading}
            onClick={() => void feedQuery.refetch()}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            {t("common.refresh")}
          </Button>
        </header>
      )}

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-[13px] font-semibold">
              {t("feed.title", { defaultValue: "Activity Feed" })}
            </CardTitle>
            <div className="relative w-full max-w-[220px]">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("feed.searchPlaceholder", { defaultValue: "Search name, world, detail…" })}
                className="h-8 pl-7 text-[12px]"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={category === "all"} onClick={() => setCategory("all")}>
              {t("feed.category.all", { defaultValue: "All" })}
            </FilterChip>
            {FEED_CATEGORIES.map((c) => (
              <FilterChip
                key={c}
                active={category === c}
                muted={category === "all" && mutedCategories.has(c)}
                onClick={() => setCategory(c)}
                onContextMenu={(e) => {
                  // Right-click toggles mute without changing the selected view.
                  e.preventDefault();
                  toggleMuted(c);
                }}
                title={t("feed.muteHint", { defaultValue: "Right-click to hide from the All view" })}
              >
                {categoryLabel(c, t)}
              </FilterChip>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex min-h-[160px] items-center justify-center text-[hsl(var(--muted-foreground))]">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : feedQuery.isError ? (
            <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("feed.loadFailed", { defaultValue: "Could not load the feed." })}
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => void feedQuery.refetch()}>
                {t("common.retry", { defaultValue: "Retry" })}
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[120px] items-center justify-center text-center text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("feed.empty", { defaultValue: "No activity yet. Events appear here as your friends come online and move between instances." })}
            </div>
          ) : (
            <>
              <div
                ref={scrollParentRef}
                className="max-h-[560px] overflow-y-auto"
              >
                <div
                  className="relative w-full"
                  style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                >
                  {virtualItems.map((vi) => {
                    const entry = filtered[vi.index];
                    if (!entry) return null;
                    return (
                      <div
                        key={vi.key}
                        data-index={vi.index}
                        ref={rowVirtualizer.measureElement}
                        className="absolute left-0 top-0 w-full pb-2"
                        style={{ transform: `translateY(${vi.start}px)` }}
                      >
                        <FeedRow entry={entry} />
                      </div>
                    );
                  })}
                </div>
              </div>
              {loadingMore ? (
                <div className="flex justify-center pt-2 text-[hsl(var(--muted-foreground))]">
                  <Loader2 className="size-3.5 animate-spin" />
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FilterChip({
  active,
  muted = false,
  onClick,
  onContextMenu,
  title,
  children,
}: {
  active: boolean;
  muted?: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
          : muted
            ? "border-[hsl(var(--border)/0.4)] text-[hsl(var(--muted-foreground)/0.45)] line-through"
            : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]",
      )}
    >
      {children}
    </button>
  );
}

export default function Feed() {
  return <FeedPanel />;
}
