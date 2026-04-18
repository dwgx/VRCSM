import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
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
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ipc } from "@/lib/ipc";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Screenshot {
  path: string;
  filename: string;
  /** ISO date string */
  created_at: string;
  size_bytes: number;
  /** virtual URL served over preview.local */
  url: string;
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
}: {
  shot: Screenshot;
  selected: boolean;
  locale: string;
  onOpen: (s: Screenshot) => void;
  onClick: (s: Screenshot, e: React.MouseEvent) => void;
  onContextMenu: (s: Screenshot, e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  return (
    <button
      type="button"
      onClick={(e) => onClick(shot, e)}
      onDoubleClick={() => onOpen(shot)}
      onContextMenu={(e) => onContextMenu(shot, e)}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-[var(--radius-sm)]",
        "border-2 bg-[hsl(var(--canvas))]",
        selected
          ? "border-[hsl(var(--primary))] ring-1 ring-[hsl(var(--primary)/0.4)]"
          : "border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))]",
        "hover:shadow-md transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--primary))]",
      )}
      title={shot.filename}
    >
      {/* Selection indicator */}
      {selected && (
        <div className="absolute top-1.5 left-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-white shadow-sm">
          <CheckSquare className="size-3" />
        </div>
      )}

      {/* Thumbnail */}
      <div className="relative aspect-video w-full overflow-hidden bg-[hsl(var(--canvas))]">
        {!error ? (
          <img
            src={shot.url}
            alt={shot.filename}
            loading="lazy"
            decoding="async"
            className={cn(
              "h-full w-full object-cover transition-opacity duration-300",
              loaded ? "opacity-100" : "opacity-0",
            )}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
          />
        ) : null}
        {(!loaded || error) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon className="size-8 text-[hsl(var(--muted-foreground)/0.4)]" />
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
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

  const [data, setData] = useState<ScreenshotsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebouncedValue(filter, 150);

  // Selection state
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  /* ---- Data loading ---- */

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    ipc
      .call<undefined, ScreenshotsResult>("screenshots.list", undefined)
      .then((result) => {
        setData(result);
        // Clear selection when data reloads
        setSelectedSet(new Set());
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered =
    data?.screenshots.filter((s) =>
      debouncedFilter
        ? s.filename.toLowerCase().includes(debouncedFilter.toLowerCase())
        : true,
    ) ?? [];

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
        load();
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
    // Prevent selection when double-click will open
    if (e.detail >= 2) return;

    setSelectedSet((prev) => {
      const next = new Set(prev);

      if (e.shiftKey && lastClickedRef.current) {
        // Range select
        const lastIdx = filtered.findIndex(
          (s) => s.path === lastClickedRef.current,
        );
        const curIdx = filtered.findIndex((s) => s.path === shot.path);
        if (lastIdx !== -1 && curIdx !== -1) {
          const [from, to] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
          for (let i = from; i <= to; i++) {
            next.add(filtered[i].path);
          }
        }
      } else if (e.ctrlKey || e.metaKey) {
        // Toggle individual
        if (next.has(shot.path)) {
          next.delete(shot.path);
        } else {
          next.add(shot.path);
        }
      } else {
        // Simple click: toggle single (clear others)
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
    setSelectedSet(new Set(filtered.map((s) => s.path)));
  }

  function clearSelection() {
    setSelectedSet(new Set());
  }

  /* ---- Context menu ---- */

  function handleContextMenu(shot: Screenshot, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Auto-select the right-clicked item if it isn't already selected
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
    const selected = filtered.filter((s) => selectedSet.has(s.path));
    for (const shot of selected) {
      void ipc.call("screenshots.open", { path: shot.path });
    }
  }

  function copySelectedPaths() {
    const paths = filtered
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
        // Click on empty space clears context menu
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
            onClick={load}
            disabled={loading}
          >
            <RefreshCcw className={loading ? "animate-spin" : undefined} />
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
            {filtered.length}{" "}
            {t("screenshots.countSuffix", { defaultValue: "shots" })}
          </span>
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
            disabled={filtered.length === 0}
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
        <div className="py-12 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
          {t("common.loading")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-[hsl(var(--muted-foreground))]">
          <ImageIcon className="size-10 opacity-30" />
          <span className="text-[12px]">
            {t("screenshots.empty", { defaultValue: "No screenshots" })}
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {filtered.map((shot) => (
            <ScreenshotTile
              key={shot.path}
              shot={shot}
              selected={selectedSet.has(shot.path)}
              locale={locale}
              onOpen={openShot}
              onClick={handleTileClick}
              onContextMenu={handleContextMenu}
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
