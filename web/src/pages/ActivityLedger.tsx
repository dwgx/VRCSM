import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import {
  Copy,
  ExternalLink,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  MailOpen,
  RefreshCw,
  Search,
  UserPlus,
  Users,
  Video,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserPopupBadge } from "@/components/UserPopupBadge";
import { WorldPopupBadge } from "@/components/WorldPopupBadge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { qk } from "@/lib/query-keys";
import { openVrchatUserProfile, openVrchatWorldPage } from "@/lib/shell-api";
import {
  LEDGER_KINDS,
  LEDGER_RANGE_PRESETS,
  fetchLedger,
  ledgerEntryMatchesKeyword,
  ledgerOccurredAfter,
  parseLedgerTime,
  type LedgerEntry,
  type LedgerKind,
  type LedgerRangePreset,
} from "@/lib/activity-ledger";

const PAGE_SIZE = 80;

function kindIcon(kind: LedgerKind) {
  switch (kind) {
    case "join":
      return <LogIn className="size-3.5 text-emerald-400" />;
    case "leave":
      return <LogOut className="size-3.5 text-zinc-400" />;
    case "meet":
      return <Users className="size-3.5 text-sky-400" />;
    case "invite":
      return <Mail className="size-3.5 text-violet-400" />;
    case "inviteResponse":
      return <MailOpen className="size-3.5 text-violet-300" />;
    case "requestInvite":
      return <Mail className="size-3.5 text-cyan-400" />;
    case "friendRequest":
      return <UserPlus className="size-3.5 text-amber-400" />;
    case "video":
      return <Video className="size-3.5 text-rose-400" />;
    default:
      return <HelpCircle className="size-3.5 text-[hsl(var(--muted-foreground))]" />;
  }
}

function defaultKindLabel(kind: LedgerKind): string {
  switch (kind) {
    case "join":
      return "Join";
    case "leave":
      return "Leave";
    case "meet":
      return "Meet";
    case "invite":
      return "Invite";
    case "inviteResponse":
      return "Invite response";
    case "requestInvite":
      return "Request invite";
    case "friendRequest":
      return "Friend request";
    case "video":
      return "Video";
    default:
      return "Other";
  }
}

function defaultRangeLabel(preset: LedgerRangePreset): string {
  switch (preset) {
    case "recent":
      return "Recent";
    case "7d":
      return "7d";
    case "30d":
      return "30d";
    default:
      return "All";
  }
}

function formatOccurredAt(value: string | null): string {
  const parsed = parseLedgerTime(value);
  if (!parsed) return value || "—";
  return parsed.toLocaleString();
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function LedgerRow({
  entry,
  onCopy,
  onOpen,
}: {
  entry: LedgerEntry;
  onCopy: (entry: LedgerEntry) => void;
  onOpen: (entry: LedgerEntry) => void;
}) {
  const { t } = useTranslation();
  const kindLabel = t(`activityLedger.kind.${entry.kind}`, {
    defaultValue: defaultKindLabel(entry.kind),
  });
  const hasUser = entry.userId?.startsWith("usr_") ?? false;
  const hasWorld = entry.worldId?.startsWith("wrld_") ?? false;
  const showDetail =
    !!entry.detail &&
    lower(entry.detail) !== lower(entry.kind) &&
    lower(entry.detail) !== lower(entry.eventType);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onCopy(entry)}
      onDoubleClick={() => onOpen(entry)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onCopy(entry);
        }
      }}
      className="flex w-full items-start gap-3 rounded-[var(--radius-sm)] border border-[hsl(var(--border)/0.65)] bg-[hsl(var(--surface))] p-3 text-left hover:bg-[hsl(var(--surface-raised))]"
    >
      <div className="mt-0.5">{kindIcon(entry.kind)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          <span className="rounded-full border border-[hsl(var(--border))] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
            {kindLabel}
          </span>
          {hasUser ? (
            <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <UserPopupBadge
                userId={entry.userId!}
                displayName={entry.displayName ?? undefined}
                compact
              />
            </span>
          ) : entry.displayName ? (
            <span className="font-medium text-[hsl(var(--foreground))]">{entry.displayName}</span>
          ) : (
            <span className="text-[hsl(var(--muted-foreground))]">—</span>
          )}
          {hasWorld ? (
            <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <WorldPopupBadge worldId={entry.worldId!} />
            </span>
          ) : null}
        </div>
        {showDetail ? (
          <p className="mt-0.5 truncate text-[11px] text-[hsl(var(--muted-foreground))]">
            {entry.detail}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]">
          {formatOccurredAt(entry.occurredAt)}
        </span>
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="rounded p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            title={t("activityLedger.copyId", { defaultValue: "Copy id" })}
            onClick={() => onCopy(entry)}
          >
            <Copy className="size-3" />
          </button>
          {hasUser || hasWorld ? (
            <button
              type="button"
              className="rounded p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              title={t("activityLedger.open", { defaultValue: "Open" })}
              onClick={() => onOpen(entry)}
            >
              <ExternalLink className="size-3" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function lower(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export default function ActivityLedger() {
  const { t } = useTranslation();
  const { status: authStatus } = useAuth();
  const selfUserId = authStatus.userId;
  const [kinds, setKinds] = useState<Set<LedgerKind>>(new Set());
  const [range, setRange] = useState<LedgerRangePreset>("7d");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);

  const selectedKinds = useMemo(
    () => (kinds.size === 0 ? undefined : [...kinds]),
    [kinds],
  );
  const occurredAfter = ledgerOccurredAfter(range);

  const ledgerQuery = useInfiniteQuery({
    queryKey: qk.feed.unified({
      surface: "activity-ledger",
      kinds: selectedKinds ?? null,
      range,
      selfUserId: selfUserId ?? null,
    }),
    queryFn: ({ pageParam = 0 }) =>
      fetchLedger({
        limit: PAGE_SIZE,
        offset: pageParam as number,
        kinds: selectedKinds,
        occurredAfter,
        selfUserId,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.exhausted ? undefined : lastPage.nextOffset,
    staleTime: 30_000,
  });

  const entries = useMemo(
    () => ledgerQuery.data?.pages.flatMap((p) => p.entries) ?? [],
    [ledgerQuery.data],
  );

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => ledgerEntryMatchesKeyword(e, q));
  }, [entries, debouncedSearch]);

  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 64,
    overscan: 8,
    getItemKey: (index) => filtered[index]?.key ?? index,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (!last) return;
    if (
      last.index >= filtered.length - 1 &&
      ledgerQuery.hasNextPage &&
      !ledgerQuery.isFetchingNextPage
    ) {
      void ledgerQuery.fetchNextPage();
    }
  }, [virtualItems, filtered.length, ledgerQuery]);

  const toggleKind = useCallback((kind: LedgerKind) => {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  const onCopy = useCallback(
    async (entry: LedgerEntry) => {
      const ok = await copyText(entry.copyId);
      if (ok) {
        toast.success(t("common.copied", { defaultValue: "Copied" }));
      } else {
        toast.error(t("common.copyFailed", { defaultValue: "Copy failed" }));
      }
    },
    [t],
  );

  const onOpen = useCallback(
    (entry: LedgerEntry) => {
      if (entry.userId?.startsWith("usr_")) {
        void openVrchatUserProfile(entry.userId);
        return;
      }
      if (entry.worldId?.startsWith("wrld_")) {
        void openVrchatWorldPage(entry.worldId);
      }
    },
    [],
  );

  const loading = ledgerQuery.isLoading;
  const loadingMore = ledgerQuery.isFetchingNextPage;

  return (
    <div className="animate-fade-in space-y-4">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("activityLedger.title", { defaultValue: "Activity Ledger" })}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("activityLedger.subtitle", {
              defaultValue:
                "Historical join, meet, invite, friend-request and video events from the unified log feed.",
            })}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-[12px]"
          disabled={loading}
          onClick={() => void ledgerQuery.refetch()}
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          {t("common.refresh")}
        </Button>
      </header>

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-[13px] font-semibold">
              {t("activityLedger.title", { defaultValue: "Activity Ledger" })}
            </CardTitle>
            <div className="relative w-full max-w-[220px]">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("activityLedger.searchPlaceholder", {
                  defaultValue: "Search name, id, world…",
                })}
                className="h-8 pl-7 text-[12px]"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {LEDGER_RANGE_PRESETS.map((preset) => (
              <FilterChip
                key={preset}
                active={range === preset}
                onClick={() => setRange(preset)}
              >
                {t(`activityLedger.range.${preset}`, {
                  defaultValue: defaultRangeLabel(preset),
                })}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={kinds.size === 0} onClick={() => setKinds(new Set())}>
              {t("activityLedger.kind.all", { defaultValue: "All" })}
            </FilterChip>
            {LEDGER_KINDS.map((kind) => (
              <FilterChip
                key={kind}
                active={kinds.has(kind)}
                onClick={() => toggleKind(kind)}
              >
                {t(`activityLedger.kind.${kind}`, {
                  defaultValue: defaultKindLabel(kind),
                })}
              </FilterChip>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex min-h-[160px] items-center justify-center text-[hsl(var(--muted-foreground))]">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : ledgerQuery.isError ? (
            <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("activityLedger.loadFailed", {
                defaultValue: "Could not load the activity ledger.",
              })}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => void ledgerQuery.refetch()}
              >
                {t("common.retry", { defaultValue: "Retry" })}
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[120px] items-center justify-center text-center text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("activityLedger.empty", {
                defaultValue: "No matching historical events in this range.",
              })}
            </div>
          ) : (
            <>
              <div ref={scrollParentRef} className="max-h-[560px] overflow-y-auto">
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
                        <LedgerRow entry={entry} onCopy={onCopy} onOpen={onOpen} />
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
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
          : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]",
      )}
    >
      {children}
    </button>
  );
}
