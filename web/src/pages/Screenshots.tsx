import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderOpen,
  RefreshCcw,
  Image as ImageIcon,
  Calendar,
  Clock,
  CheckSquare,
  XSquare,
  Copy,
  Trash2,
  Eye,
  FolderSearch,
  Loader2,
  Layers,
  LogIn,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { WorldPopupBadge } from "@/components/WorldPopupBadge";
import { ipc } from "@/lib/ipc";
import { listWorldVisits } from "@/lib/history-api";
import { rejoinLocationFromVisit, openVrchatLocation } from "@/lib/shell-api";
import {
  groupShotsByVisit,
  metadataHasPlayer,
  parseLiberalTimestamp,
  parseScreenshotPlayers,
  type ScreenshotPlayer,
} from "@/lib/screenshot-visits";
import type { DbWorldVisit } from "@/lib/types";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useUiPrefBoolean } from "@/lib/ui-prefs";
import { cn } from "@/lib/utils";

const GROUP_BY_VISIT_PREF = "vrcsm.screenshots.groupByVisit";
const VISIT_LIST_LIMIT = 2000;
const META_SWEEP_CONCURRENCY = 4;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Screenshot {
  path: string;
  filename: string;
  /** ISO date string */
  created_at: string;
  size_bytes: number;
  /** Original full-res URL served over `screenshots.local`. */
  url: string;
  /**
   * Pre-generated JPEG thumbnail URL served over `screenshot-thumbs.local`.
   * May 404 for a brief window after first scan while the host's thumb
   * pool catches up — the tile falls back to `url` in that case.
   */
  thumb_url?: string;
}

interface ScreenshotsResult {
  screenshots: Screenshot[];
  folder: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  shot: Screenshot;
}

interface DeleteConfirmState {
  paths: string[];
  count: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatTime(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatVisitInstant(raw: string | null | undefined, locale: string): string {
  const ms = parseLiberalTimestamp(raw);
  if (ms == null) return (raw ?? "").trim() || "—";
  try {
    return new Date(ms).toLocaleString(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return raw ?? "—";
  }
}

/* ------------------------------------------------------------------ */
/*  ScreenshotTile                                                     */
/* ------------------------------------------------------------------ */

function ScreenshotTile({
  shot,
  selected,
  locale,
  onOpen,
  onClick,
  onContextMenu,
  onHover,
  onPlayerClick,
  players,
  activePlayerId,
  eager,
}: {
  shot: Screenshot;
  selected: boolean;
  locale: string;
  onOpen: (s: Screenshot) => void;
  onClick: (s: Screenshot, e: React.MouseEvent) => void;
  onContextMenu: (s: Screenshot, e: React.MouseEvent) => void;
  onHover?: (s: Screenshot) => void;
  onPlayerClick?: (player: ScreenshotPlayer) => void;
  players?: ScreenshotPlayer[];
  activePlayerId?: string | null;
  /** True for above-fold tiles — lets us skip IntersectionObserver and
   * prioritise their fetch. */
  eager: boolean;
}) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  // `source` moves through: thumb_url (fast) → url (fallback if thumb
  // 404s) → error (both failed). Avoids a flash of placeholder when
  // the host thumb pool hasn't caught up yet.
  const [source, setSource] = useState<"thumb" | "full" | "error">(
    shot.thumb_url ? "thumb" : "full",
  );
  const [visible, setVisible] = useState(eager);
  const ref = useRef<HTMLButtonElement>(null);

  // Below-fold tiles wait on IntersectionObserver so we don't pay the
  // ~30 KB thumbnail fetch for everything in a 2000-item library. Above-
  // fold tiles paint immediately.
  useEffect(() => {
    if (eager || !ref.current) return;
    const el = ref.current;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eager]);

  const activeSrc =
    source === "thumb" ? shot.thumb_url
      : source === "full" ? shot.url
        : undefined;

  const playerHint =
    players && players.length > 0
      ? players.map((p) => p.displayName).join(", ")
      : shot.filename;

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-[var(--radius-sm)]",
        "border-2 bg-[hsl(var(--canvas))]",
        selected
          ? "border-[hsl(var(--primary))] ring-1 ring-[hsl(var(--primary)/0.4)]"
          : "border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))]",
        "hover:shadow-md transition-all duration-150",
      )}
      onMouseEnter={() => onHover?.(shot)}
      onContextMenu={(e) => onContextMenu(shot, e)}
    >
      <button
        ref={ref}
        type="button"
        onClick={(e) => onClick(shot, e)}
        onDoubleClick={() => onOpen(shot)}
        className={cn(
          "relative flex flex-col",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--primary))]",
        )}
        title={playerHint}
      >
        {/* Selection indicator */}
        {selected && (
          <div className="absolute top-1.5 left-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-white shadow-sm">
            <CheckSquare className="size-3" />
          </div>
        )}

        {/* Thumbnail */}
        <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-[hsl(var(--muted)/0.25)] to-[hsl(var(--muted)/0.05)]">
          {visible && activeSrc ? (
            <img
              src={activeSrc}
              alt={shot.filename}
              loading={eager ? "eager" : "lazy"}
              decoding="async"
              fetchPriority={eager ? "high" : "auto"}
              className={cn(
                "h-full w-full object-cover transition-opacity duration-300",
                loaded ? "opacity-100" : "opacity-0",
              )}
              onLoad={() => setLoaded(true)}
              onError={() => {
                // Thumb 404 → try the full-res URL once. If that also
                // fails, give up and show the placeholder.
                if (source === "thumb" && shot.url) {
                  setSource("full");
                  setLoaded(false);
                } else {
                  setSource("error");
                }
              }}
            />
          ) : null}
          {(!loaded || source === "error") && (
            <div className="absolute inset-0 flex items-center justify-center">
              <ImageIcon className="size-8 text-[hsl(var(--muted-foreground)/0.4)]" />
            </div>
          )}
          {/* Hover overlay */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm">
              {t("screenshots.openHover", { defaultValue: "Open" })}
            </span>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
          <Calendar className="size-3 shrink-0" />
          <span className="truncate">{formatDate(shot.created_at, locale)}</span>
          <Clock className="size-3 shrink-0" />
          <span className="shrink-0">{formatTime(shot.created_at, locale)}</span>
          <span className="ml-auto shrink-0 font-mono">
            {formatBytes(shot.size_bytes)}
          </span>
        </div>
      </button>

      {players && players.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 pb-1.5">
          {players.map((player) => {
            const key = player.userId || player.displayName;
            const active = Boolean(activePlayerId && player.userId === activePlayerId);
            return (
              <button
                key={key}
                type="button"
                disabled={!player.userId || !onPlayerClick}
                onClick={(e) => {
                  e.stopPropagation();
                  if (player.userId) onPlayerClick?.(player);
                }}
                title={
                  player.userId
                    ? t("screenshots.filterByPlayer", {
                        name: player.displayName,
                        defaultValue: "Show shots with {{name}}",
                      })
                    : player.displayName
                }
                className={cn(
                  "max-w-full truncate rounded-full border px-1.5 py-0 text-[10px]",
                  active
                    ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                    : "border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary)/0.4)]",
                  !player.userId && "cursor-default opacity-70",
                )}
              >
                {player.displayName}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VisitGroupHeader({
  visit,
  shotCount,
  locale,
  prefetch,
}: {
  visit: DbWorldVisit | null;
  shotCount: number;
  locale: string;
  prefetch: boolean;
}) {
  const { t } = useTranslation();
  const loc = visit
    ? rejoinLocationFromVisit(visit.world_id, visit.instance_id)
    : null;

  return (
    <header className="flex flex-wrap items-center gap-2">
      {visit?.world_id ? (
        <WorldPopupBadge worldId={visit.world_id} prefetch={prefetch} />
      ) : visit ? (
        <span className="text-[12px] font-medium">
          {t("screenshots.unknownWorld", { defaultValue: "Unknown world" })}
        </span>
      ) : (
        <span className="text-[12px] font-medium">
          {t("screenshots.ungrouped", { defaultValue: "Ungrouped" })}
        </span>
      )}
      {visit ? (
        <span className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
          {formatVisitInstant(visit.joined_at, locale)}
          {" → "}
          {visit.left_at
            ? formatVisitInstant(visit.left_at, locale)
            : t("screenshots.stillInWorld", { defaultValue: "still in world" })}
        </span>
      ) : (
        <span className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
          {t("screenshots.ungroupedHint", {
            defaultValue: "Shots that did not fall inside a logged world visit",
          })}
        </span>
      )}
      {loc ? (
        <button
          type="button"
          className="flex items-center gap-0.5 text-[10px] text-[hsl(var(--primary))] hover:underline"
          onClick={() => void openVrchatLocation(loc)}
          title={t("screenshots.rejoinHint", {
            defaultValue: "Launch VRChat into this exact instance",
          })}
        >
          <LogIn className="size-3" />
          {t("screenshots.rejoin", { defaultValue: "Rejoin" })}
        </button>
      ) : null}
      <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))]">
        {t("screenshots.visitShots", {
          defaultValue: "{{count}} shots",
          count: shotCount,
        })}
      </span>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  ContextMenu                                                        */
/* ------------------------------------------------------------------ */

import { createPortal } from "react-dom";

function ContextMenu({
  state,
  selectionCount,
  onClose,
  onOpen,
  onShowInExplorer,
  onCopyPath,
  onDelete,
  onDeleteSelected,
}: {
  state: ContextMenuState;
  selectionCount: number;
  onClose: () => void;
  onOpen: (s: Screenshot) => void;
  onShowInExplorer: (s: Screenshot) => void;
  onCopyPath: (s: Screenshot) => void;
  onDelete: (s: Screenshot) => void;
  onDeleteSelected: () => void;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside, true);
    document.addEventListener("keydown", handleEscape, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [onClose]);

  // Clamp position so the menu doesn't overflow the viewport
  const menuWidth = 200;
  const menuHeight = 160;
  const x = Math.min(state.x, window.innerWidth - menuWidth - 8);
  const y = Math.min(state.y, window.innerHeight - menuHeight - 8);

  const isMulti = selectionCount > 1;

  const items: Array<{
    label: string;
    icon: React.ReactNode;
    action: () => void;
    destructive?: boolean;
  }> = [
    {
      label: isMulti
        ? t("screenshots.openSelected", { defaultValue: "Open ({{count}})", count: selectionCount })
        : t("screenshots.open", { defaultValue: "Open" }),
      icon: <Eye className="size-3.5" />,
      action: () => {
        onOpen(state.shot);
        onClose();
      },
    },
    {
      label: t("screenshots.showInExplorer", {
        defaultValue: "Show in Explorer",
      }),
      icon: <FolderSearch className="size-3.5" />,
      action: () => {
        onShowInExplorer(state.shot);
        onClose();
      },
    },
    {
      label: isMulti
        ? t("screenshots.copyPaths", { defaultValue: "Copy paths" })
        : t("screenshots.copyPath", { defaultValue: "Copy path" }),
      icon: <Copy className="size-3.5" />,
      action: () => {
        onCopyPath(state.shot);
        onClose();
      },
    },
    {
      label: isMulti
        ? t("screenshots.deleteSelected", { defaultValue: "Delete ({{count}})", count: selectionCount })
        : t("screenshots.delete", { defaultValue: "Delete" }),
      icon: <Trash2 className="size-3.5" />,
      destructive: true,
      action: () => {
        if (isMulti) {
          onDeleteSelected();
        } else {
          onDelete(state.shot);
        }
        onClose();
      },
    },
  ];

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        "fixed z-50 min-w-[180px] rounded-[var(--radius-sm)] py-1",
        "border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] text-[hsl(var(--foreground))]",
        "shadow-xl backdrop-blur-md animate-fade-in",
      )}
      style={{ top: y, left: x }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={item.action}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]",
            "text-[hsl(var(--foreground))]",
            "hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]",
            "transition-colors duration-75",
            item.destructive && "text-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))]",
          )}
        >
          <span className={cn(
            "text-[hsl(var(--muted-foreground))]",
            item.destructive && "text-[hsl(var(--destructive))]",
          )}>
            {item.icon}
          </span>
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ */
/*  BulkActionsBar                                                     */
/* ------------------------------------------------------------------ */

function BulkActionsBar({
  count,
  onOpenSelected,
  onCopyPaths,
  onDeleteSelected,
  onClear,
}: {
  count: number;
  onOpenSelected: () => void;
  onCopyPaths: () => void;
  onDeleteSelected: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 z-40 -translate-x-1/2",
        "flex items-center gap-3 rounded-full px-5 py-2.5",
        "border border-[hsl(var(--border))] bg-[hsl(var(--popover)/0.95)]",
        "shadow-2xl backdrop-blur-lg animate-fade-in",
      )}
    >
      <span className="text-[12px] font-medium text-[hsl(var(--foreground))]">
        {t("screenshots.selectionCount", {
          defaultValue: "{{count}} selected",
          count,
        })}
      </span>
      <div className="h-4 w-px bg-[hsl(var(--border))]" />
      <Button variant="outline" size="sm" onClick={onOpenSelected}>
        <Eye className="size-3.5" />
        {t("screenshots.openSelected", {
          defaultValue: "Open ({{count}})",
          count,
        })}
      </Button>
      <Button variant="outline" size="sm" onClick={onCopyPaths}>
        <Copy className="size-3.5" />
        {t("screenshots.copyPaths", { defaultValue: "Copy paths" })}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onDeleteSelected}
        className="text-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))]"
      >
        <Trash2 className="size-3.5" />
        {t("screenshots.deleteSelected", {
          defaultValue: "Delete ({{count}})",
          count,
        })}
      </Button>
      <Button variant="outline" size="sm" onClick={onClear}>
        <XSquare className="size-3.5" />
        {t("screenshots.clearSelection", { defaultValue: "Clear" })}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function Screenshots() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const queryClient = useQueryClient();

  // React Query owns the list now: first mount hits the host, every
  // subsequent mount (tab navigate-back) renders instantly from cache
  // while a background refetch picks up any new captures. The 2000-cap
  // + recursive-dir-walk that the host does is why the cold IPC feels
  // slow on large libraries; once cached, it's free.
  const listQuery = useQuery<ScreenshotsResult>({
    queryKey: ["screenshots.list"],
    queryFn: () => ipc.call<undefined, ScreenshotsResult>("screenshots.list", undefined),
    staleTime: 5 * 60_000,
  });

  const [groupByVisit, setGroupByVisit] = useUiPrefBoolean(GROUP_BY_VISIT_PREF, true);
  const visitsQuery = useQuery({
    queryKey: ["db.worldVisits.list", { limit: VISIT_LIST_LIMIT, offset: 0 }],
    queryFn: () => listWorldVisits(VISIT_LIST_LIMIT, 0),
    staleTime: 2 * 60_000,
    gcTime: 30 * 60_000,
    enabled: groupByVisit,
  });

  const data = listQuery.data ?? null;
  const loading = listQuery.isPending;
  const refetching = listQuery.isFetching && !listQuery.isPending;
  const error = listQuery.error instanceof Error ? listQuery.error.message : null;
  const visits = (visitsQuery.data?.items ?? []) as DbWorldVisit[];
  const visitsReady = visitsQuery.isSuccess || visitsQuery.isError || !groupByVisit;

  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebouncedValue(filter, 150);
  const [playerFilter, setPlayerFilter] = useState<ScreenshotPlayer | null>(null);
  const [scanRemaining, setScanRemaining] = useState(0);

  const metaCacheRef = useRef(new Map<string, Record<string, string>>());
  const inFlightRef = useRef(new Set<string>());
  const [metaTick, setMetaTick] = useState(0);

  const rememberMeta = useCallback((path: string, meta: Record<string, string>) => {
    metaCacheRef.current.set(path, meta);
    setMetaTick((n) => n + 1);
  }, []);

  const loadMeta = useCallback(async (path: string) => {
    if (metaCacheRef.current.has(path)) return metaCacheRef.current.get(path);
    if (inFlightRef.current.has(path)) return undefined;
    inFlightRef.current.add(path);
    try {
      const res = await ipc.screenshotsReadMetadata(path);
      const meta =
        res?.metadata && typeof res.metadata === "object" ? res.metadata : {};
      rememberMeta(path, meta);
      return meta;
    } catch {
      rememberMeta(path, {});
      return {};
    } finally {
      inFlightRef.current.delete(path);
    }
  }, [rememberMeta]);

  // Selection state
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Clear selection when the underlying list changes (delete or refresh).
  useEffect(() => {
    setSelectedSet(new Set());
  }, [data]);

  function refresh() {
    void listQuery.refetch();
  }

  const filtered =
    data?.screenshots.filter((s) =>
      debouncedFilter
        ? s.filename.toLowerCase().includes(debouncedFilter.toLowerCase())
        : true,
    ) ?? [];

  const groupingActive = groupByVisit && visitsReady;
  const grouped = useMemo(
    () => (groupingActive ? groupShotsByVisit(filtered, visits) : []),
    [groupingActive, filtered, visits],
  );

  const displayGroups = useMemo(() => {
    if (!groupingActive) return grouped;
    if (!playerFilter) return grouped;
    return grouped
      .map((g) => ({
        ...g,
        shots: g.shots.filter((s) => {
          const meta = metaCacheRef.current.get(s.path);
          return meta != null && metadataHasPlayer(meta, playerFilter.userId);
        }),
      }))
      .filter((g) => g.shots.length > 0);
  }, [grouped, groupingActive, playerFilter, metaTick]);

  const visibleShots = useMemo(() => {
    const shots = groupingActive ? displayGroups.flatMap((g) => g.shots) : filtered;
    if (!playerFilter) return shots;
    return shots.filter((s) => {
      const meta = metaCacheRef.current.get(s.path);
      return meta != null && metadataHasPlayer(meta, playerFilter.userId);
    });
  }, [groupingActive, displayGroups, filtered, playerFilter, metaTick]);

  useEffect(() => {
    return ipc.on<{ path?: string; metadata?: Record<string, string> }>(
      "screenshots.new",
      (ev) => {
        if (ev?.path && ev.metadata && typeof ev.metadata === "object") {
          rememberMeta(ev.path, ev.metadata);
        }
        void queryClient.invalidateQueries({ queryKey: ["screenshots.list"] });
      },
    );
  }, [queryClient, rememberMeta]);

  useEffect(() => {
    if (!playerFilter) {
      setScanRemaining(0);
      return;
    }
    let cancelled = false;
    const pending = filtered
      .map((s) => s.path)
      .filter((path) => !metaCacheRef.current.has(path));
    setScanRemaining(pending.length);
    if (pending.length === 0) return;

    const queue = pending.slice();
    const workers = Array.from({ length: Math.min(META_SWEEP_CONCURRENCY, queue.length) }, async () => {
      while (!cancelled) {
        const path = queue.shift();
        if (!path) return;
        await loadMeta(path);
        if (!cancelled) {
          setScanRemaining(queue.length + inFlightRef.current.size);
        }
      }
    });
    void Promise.all(workers).then(() => {
      if (!cancelled) setScanRemaining(0);
    });
    return () => {
      cancelled = true;
    };
  }, [playerFilter, filtered, loadMeta]);

  const handleHover = useCallback((shot: Screenshot) => {
    void loadMeta(shot.path);
  }, [loadMeta]);

  const handlePlayerClick = useCallback((player: ScreenshotPlayer) => {
    setPlayerFilter((prev) =>
      prev?.userId === player.userId ? null : player,
    );
  }, []);

  useEffect(() => {
    if (selectedSet.size !== 1) return;
    const path = selectedSet.values().next().value;
    if (path) void loadMeta(path);
  }, [selectedSet, loadMeta]);

  const playersFor = useCallback((path: string): ScreenshotPlayer[] | undefined => {
    const meta = metaCacheRef.current.get(path);
    if (!meta) return undefined;
    return parseScreenshotPlayers(meta);
  }, [metaTick]);

  /* ---- Actions ---- */

  function openShot(shot: Screenshot) {
    void ipc.call("screenshots.open", { path: shot.path });
  }

  function openFolder() {
    if (data?.folder) {
      void ipc.call("screenshots.folder", { path: data.folder });
    }
  }

  function showInExplorer(shot: Screenshot) {
    void ipc.call("screenshots.folder", { path: shot.path });
  }

  function copyPath(shot: Screenshot) {
    navigator.clipboard
      .writeText(shot.path)
      .then(() =>
        toast(
          t("screenshots.pathCopied", { defaultValue: "Path copied to clipboard" }),
        ),
      )
      .catch(() =>
        toast.error(
          t("screenshots.copyFailed", { defaultValue: "Copy failed" }),
        ),
      );
  }

  function deleteShot(shot: Screenshot) {
    setDeleteConfirm({ paths: [shot.path], count: 1 });
  }

  function deleteSelected() {
    if (selectedSet.size === 0) return;
    setDeleteConfirm({ paths: Array.from(selectedSet), count: selectedSet.size });
  }

  async function confirmDelete() {
    if (!deleteConfirm || deleteConfirm.paths.length === 0) return;

    setDeleting(true);
    try {
      const res = await ipc.call<{paths: string[]}, {deleted: number, failed: string[]}>("screenshots.delete", {
        paths: deleteConfirm.paths,
      });

      if (res.deleted > 0) {
        if (deleteConfirm.count === 1) {
          toast.success(t("screenshots.deleteSuccess", { defaultValue: "Deleted successfully" }));
        } else {
          toast.success(t("screenshots.deleteBulkSuccess", {
            defaultValue: "Deleted {{count}} screenshots",
            count: res.deleted,
          }));
        }

        setSelectedSet((prev) => {
          const next = new Set(prev);
          for (const path of deleteConfirm.paths) {
            next.delete(path);
          }
          return next;
        });
        // Optimistically drop deleted rows from the cached list so the
        // grid updates without a full rescan round-trip. Background
        // refetch will reconcile.
        queryClient.setQueryData<ScreenshotsResult>(["screenshots.list"], (prev) => {
          if (!prev) return prev;
          const deletedSet = new Set(deleteConfirm.paths);
          return {
            ...prev,
            screenshots: prev.screenshots.filter((s) => !deletedSet.has(s.path)),
          };
        });
        void queryClient.invalidateQueries({ queryKey: ["screenshots.list"] });
      }

      if (res.failed && res.failed.length > 0) {
        toast.error(t("screenshots.deletePartial", { defaultValue: "Some files could not be deleted" }));
      }
    } catch {
      toast.error(t("screenshots.deleteFailed", { defaultValue: "Delete failed" }));
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  }

  /* ---- Selection logic ---- */

  function handleTileClick(shot: Screenshot, e: React.MouseEvent) {
    if (e.detail >= 2) return;

    setSelectedSet((prev) => {
      const next = new Set(prev);

      if (e.shiftKey && lastClickedRef.current) {
        const lastIdx = visibleShots.findIndex(
          (s) => s.path === lastClickedRef.current,
        );
        const curIdx = visibleShots.findIndex((s) => s.path === shot.path);
        if (lastIdx !== -1 && curIdx !== -1) {
          const [from, to] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
          for (let i = from; i <= to; i++) {
            next.add(visibleShots[i].path);
          }
        }
      } else if (e.ctrlKey || e.metaKey) {
        if (next.has(shot.path)) {
          next.delete(shot.path);
        } else {
          next.add(shot.path);
        }
      } else {
        if (next.has(shot.path) && next.size === 1) {
          next.clear();
        } else {
          next.clear();
          next.add(shot.path);
        }
      }

      return next;
    });

    lastClickedRef.current = shot.path;
  }

  function selectAll() {
    setSelectedSet(new Set(visibleShots.map((s) => s.path)));
  }

  function clearSelection() {
    setSelectedSet(new Set());
  }

  /* ---- Context menu ---- */

  function handleContextMenu(shot: Screenshot, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedSet.has(shot.path)) {
      setSelectedSet(new Set([shot.path]));
      lastClickedRef.current = shot.path;
    }
    setContextMenu({ x: e.clientX, y: e.clientY, shot });
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  /* ---- Bulk actions ---- */

  function openSelected() {
    const selected = visibleShots.filter((s) => selectedSet.has(s.path));
    for (const shot of selected) {
      void ipc.call("screenshots.open", { path: shot.path });
    }
  }

  function copySelectedPaths() {
    const paths = visibleShots
      .filter((s) => selectedSet.has(s.path))
      .map((s) => s.path)
      .join("\n");
    navigator.clipboard
      .writeText(paths)
      .then(() =>
        toast(
          t("screenshots.pathsCopied", {
            defaultValue: "{{count}} paths copied",
            count: selectedSet.size,
          }),
        ),
      )
      .catch(() =>
        toast.error(
          t("screenshots.copyFailed", { defaultValue: "Copy failed" }),
        ),
      );
  }

  const selectionCount = selectedSet.size;

  return (
    <div
      className="flex flex-col gap-4 animate-fade-in"
      onClick={() => {
        if (contextMenu) closeContextMenu();
      }}
    >
      {/* Header */}
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("screenshots.title", { defaultValue: "Screenshots" })}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {data?.folder ??
              t("screenshots.subtitle", {
                defaultValue: "VRChat screenshot browser",
              })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={openFolder}
            disabled={!data}
          >
            <FolderOpen />
            {t("screenshots.openFolder", { defaultValue: "Open folder" })}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading || refetching}
          >
            <RefreshCcw className={cn((loading || refetching) && "animate-spin")} />
            {t("common.refresh")}
          </Button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("screenshots.filter", {
              defaultValue: "Filter by filename...",
            })}
            className="h-7 text-[12px]"
          />
        </div>

        {data && (
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {visibleShots.length}{" "}
            {t("screenshots.countSuffix", { defaultValue: "shots" })}
            {playerFilter && visibleShots.length !== filtered.length && (
              <span className="ml-1 opacity-70">
                / {filtered.length}
              </span>
            )}
            {refetching && (
              <span className="ml-2 inline-flex items-center gap-1 opacity-60">
                <Loader2 className="size-3 animate-spin" />
                {t("common.refreshing", { defaultValue: "refreshing" })}
              </span>
            )}
            {scanRemaining > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 opacity-60">
                <Loader2 className="size-3 animate-spin" />
                {t("screenshots.scanningMetadata", {
                  defaultValue: "checking {{count}}",
                  count: scanRemaining,
                })}
              </span>
            )}
          </span>
        )}

        <Button
          variant={groupByVisit ? "default" : "outline"}
          size="sm"
          className="h-6 px-2 text-[11px]"
          aria-pressed={groupByVisit}
          onClick={() => setGroupByVisit((v) => !v)}
          title={t("screenshots.groupByVisitHint", {
            defaultValue: "Group screenshots by the world visit they were taken in",
          })}
        >
          <Layers className="size-3" />
          {t("screenshots.groupByVisit", { defaultValue: "Group by visit" })}
        </Button>

        {playerFilter && (
          <button
            type="button"
            onClick={() => setPlayerFilter(null)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
              "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]",
            )}
            title={t("screenshots.clearPlayerFilter", { defaultValue: "Clear player filter" })}
          >
            <Users className="size-3" />
            <span className="max-w-[10rem] truncate">{playerFilter.displayName}</span>
            <X className="size-3" />
          </button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {selectionCount > 0 && (
            <span className="text-[11px] font-medium text-[hsl(var(--primary))]">
              {t("screenshots.selectionCount", {
                defaultValue: "{{count}} selected",
                count: selectionCount,
              })}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={selectAll}
            disabled={visibleShots.length === 0}
            className="h-6 px-2 text-[11px]"
          >
            <CheckSquare className="size-3" />
            {t("screenshots.selectAll", { defaultValue: "Select all" })}
          </Button>
          {selectionCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              className="h-6 px-2 text-[11px]"
            >
              <XSquare className="size-3" />
              {t("screenshots.clearSelection", { defaultValue: "Clear" })}
            </Button>
          )}
        </div>
      </div>

      {/* Grid */}
      {error ? (
        <div className="py-12 text-center text-[12px] text-[hsl(var(--warn-foreground,var(--destructive)))]">
          {error}
        </div>
      ) : loading && !data ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]"
            >
              <div className="aspect-video w-full bg-gradient-to-br from-[hsl(var(--muted)/0.25)] to-[hsl(var(--muted)/0.05)] animate-pulse" />
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <div className="h-2.5 w-24 bg-[hsl(var(--muted)/0.25)] rounded animate-pulse" />
                <div className="ml-auto h-2.5 w-12 bg-[hsl(var(--muted)/0.2)] rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : visibleShots.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-[hsl(var(--muted-foreground))]">
          <ImageIcon className="size-10 opacity-30" />
          <span className="text-[12px]">
            {playerFilter
              ? t("screenshots.emptyPlayerFilter", {
                  defaultValue: "No screenshots with that player yet",
                })
              : t("screenshots.empty", { defaultValue: "No screenshots" })}
          </span>
        </div>
      ) : groupingActive ? (
        <div className="flex flex-col gap-6">
          {displayGroups.map((group, groupIdx) => (
            <section key={group.visit?.id ?? `ungrouped-${groupIdx}`} className="flex flex-col gap-2">
              <VisitGroupHeader
                visit={group.visit}
                shotCount={group.shots.length}
                locale={locale}
                prefetch={groupIdx < 12}
              />
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                {group.shots.map((shot, idx) => (
                  <ScreenshotTile
                    key={shot.path}
                    shot={shot}
                    selected={selectedSet.has(shot.path)}
                    locale={locale}
                    onOpen={openShot}
                    onClick={handleTileClick}
                    onContextMenu={handleContextMenu}
                    onHover={handleHover}
                    onPlayerClick={handlePlayerClick}
                    players={playersFor(shot.path)}
                    activePlayerId={playerFilter?.userId ?? null}
                    eager={groupIdx === 0 && idx < 16}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {visibleShots.map((shot, idx) => (
            <ScreenshotTile
              key={shot.path}
              shot={shot}
              selected={selectedSet.has(shot.path)}
              locale={locale}
              onOpen={openShot}
              onClick={handleTileClick}
              onContextMenu={handleContextMenu}
              onHover={handleHover}
              onPlayerClick={handlePlayerClick}
              players={playersFor(shot.path)}
              activePlayerId={playerFilter?.userId ?? null}
              eager={idx < 16}
            />
          ))}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          selectionCount={selectionCount}
          onClose={closeContextMenu}
          onOpen={openShot}
          onShowInExplorer={showInExplorer}
          onCopyPath={copyPath}
          onDelete={deleteShot}
          onDeleteSelected={deleteSelected}
        />
      )}

      {/* Bulk actions bar */}
      {selectionCount > 0 && (
        <BulkActionsBar
          count={selectionCount}
          onOpenSelected={openSelected}
          onCopyPaths={copySelectedPaths}
          onDeleteSelected={deleteSelected}
          onClear={clearSelection}
        />
      )}

      <ConfirmDialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteConfirm(null);
          }
        }}
        title={t("screenshots.delete", { defaultValue: "Delete" })}
        description={deleteConfirm?.count === 1
          ? t("screenshots.confirmDelete", {
              defaultValue: "Are you sure you want to delete this screenshot?",
            })
          : t("screenshots.confirmDeleteBulk", {
              defaultValue: "Are you sure you want to delete {{count}} screenshots?",
              count: deleteConfirm?.count ?? 0,
            })}
        confirmLabel={t("screenshots.delete", { defaultValue: "Delete" })}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void confirmDelete()}
        loading={deleting}
        tone="destructive"
      />
    </div>
  );
}
