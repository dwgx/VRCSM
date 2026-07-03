import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import type { DataUsage } from "@/lib/ipc";
import { cn, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ── Target descriptors ────────────────────────────────────────────────
// Each item maps a data.clear target key to how its size is derived from
// the DataUsage payload: either a single on-disk cache key (bytes) or a
// set of DB tables whose row counts are summed.

type GroupId = "cache" | "history" | "experimental" | "danger";

interface DiskItem {
  key: string;
  kind: "disk";
  diskKey: string;
}

interface TableItem {
  key: string;
  kind: "table";
  /** Explicit table names summed for the row count. */
  tables?: string[];
  /** Also include every table whose name starts with this prefix. */
  tablePrefix?: string;
}

type DataItem = DiskItem | TableItem;

interface DataGroup {
  id: GroupId;
  items: DataItem[];
  /** Danger groups render collapsed and require an extra acknowledgement. */
  danger?: boolean;
  /** History + danger deletions are unrecoverable. */
  irreversible?: boolean;
}

const GROUPS: DataGroup[] = [
  {
    id: "cache",
    items: [
      { key: "cache.thumbnails", kind: "disk", diskKey: "cache.thumbnails" },
      { key: "cache.previews", kind: "disk", diskKey: "cache.previews" },
      { key: "cache.screenshotThumbs", kind: "disk", diskKey: "cache.screenshotThumbs" },
      { key: "cache.updates", kind: "disk", diskKey: "cache.updates" },
      { key: "cache.pluginFeed", kind: "disk", diskKey: "cache.pluginFeed" },
      { key: "cache.index", kind: "disk", diskKey: "cache.index" },
      { key: "cache.assetCache", kind: "table", tables: ["asset_cache"] },
      { key: "cache.benchmark", kind: "table", tables: ["avatar_benchmark"] },
      { key: "cache.onlineMirror", kind: "table", tables: ["owned_avatars"], tablePrefix: "online_" },
    ],
  },
  {
    id: "history",
    irreversible: true,
    items: [
      { key: "history.worldVisits", kind: "table", tables: ["world_visits"] },
      { key: "history.playerEvents", kind: "table", tables: ["player_events", "player_encounters"] },
      { key: "history.avatarHistory", kind: "table", tables: ["avatar_history"] },
      { key: "history.friendLog", kind: "table", tables: ["friend_log", "friend_presence_events"] },
      { key: "history.sessions", kind: "table", tables: ["sessions"] },
      { key: "history.logEvents", kind: "table", tables: ["log_events"] },
    ],
  },
  {
    id: "experimental",
    items: [
      { key: "experimental.embeddings", kind: "table", tables: ["avatar_embeddings_meta"] },
    ],
  },
  {
    id: "danger",
    danger: true,
    irreversible: true,
    items: [
      { key: "assets.favorites", kind: "table", tables: ["local_favorites"] },
    ],
  },
];

function tableCount(usage: DataUsage, item: TableItem): number {
  let sum = 0;
  for (const name of item.tables ?? []) {
    sum += usage.tables[name] ?? 0;
  }
  if (item.tablePrefix) {
    for (const [name, count] of Object.entries(usage.tables)) {
      if (name.startsWith(item.tablePrefix)) sum += count;
    }
  }
  return sum;
}

export function TabData() {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<DataUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dangerOpen, setDangerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dangerAck, setDangerAck] = useState(false);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const u = await ipc.dataUsage();
      setUsage(u);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedKeys = useMemo(() => Array.from(selected), [selected]);

  // Whether the confirmation involves unrecoverable (history/danger) data.
  const confirmIrreversible = useMemo(() => {
    for (const group of GROUPS) {
      if (!group.irreversible) continue;
      if (group.items.some((it) => selected.has(it.key))) return true;
    }
    return false;
  }, [selected]);

  const confirmHasDanger = useMemo(() => {
    const dangerKeys = GROUPS.find((g) => g.danger)?.items.map((it) => it.key) ?? [];
    return dangerKeys.some((k) => selected.has(k));
  }, [selected]);

  async function runClear() {
    if (selectedKeys.length === 0) return;
    setWorking(true);
    try {
      const res = await ipc.dataClear(selectedKeys);
      const results = res.results ?? {};
      const failed = Object.entries(results).filter(([, r]) => r && !r.ok);
      if (failed.length > 0) {
        toast.error(
          t("settings.data.clearPartial", {
            defaultValue: "Cleared with {{count}} failure(s).",
            count: failed.length,
          }),
        );
      } else {
        toast.success(
          t("settings.data.clearSuccess", {
            defaultValue: "Cleared {{count}} item(s).",
            count: selectedKeys.length,
          }),
        );
      }
      setSelected(new Set());
      await refresh();
    } catch (e: unknown) {
      toast.error(
        t("settings.data.clearError", {
          defaultValue: "Cleanup failed: {{error}}",
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setWorking(false);
      setConfirmOpen(false);
      setDangerAck(false);
    }
  }

  function itemSize(item: DataItem): string {
    if (!usage) return "—";
    if (item.kind === "disk") {
      return formatBytes(usage.disk[item.diskKey] ?? 0);
    }
    return t("settings.data.rowCount", {
      defaultValue: "{{count}} rows",
      count: tableCount(usage, item),
    });
  }

  const groupLabel: Record<GroupId, string> = {
    cache: t("settings.data.group.cache", { defaultValue: "Rebuildable caches" }),
    history: t("settings.data.group.history", { defaultValue: "History & analytics data" }),
    experimental: t("settings.data.group.experimental", { defaultValue: "Experimental feature data" }),
    danger: t("settings.data.group.danger", { defaultValue: "Danger zone" }),
  };

  const groupDesc: Record<GroupId, string> = {
    cache: t("settings.data.group.cacheDesc", {
      defaultValue: "Safe to clear. VRCSM regenerates these automatically as needed.",
    }),
    history: t("settings.data.group.historyDesc", {
      defaultValue: "Locally recorded activity. Clearing is permanent and cannot be undone.",
    }),
    experimental: t("settings.data.group.experimentalDesc", {
      defaultValue: "Data produced by experimental features.",
    }),
    danger: t("settings.data.group.dangerDesc", {
      defaultValue: "Your own assets. Clearing permanently deletes favorites, notes and tags.",
    }),
  };

  function itemLabel(key: string): string {
    return t(`settings.data.item.${key}`, { defaultValue: key });
  }

  function renderItem(item: DataItem) {
    const checked = selected.has(item.key);
    return (
      <label
        key={item.key}
        className="unity-panel border border-[hsl(var(--border))] p-2.5 flex items-center justify-between gap-4 cursor-pointer select-none"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggle(item.key)}
            className={cn("w-4 h-4 cursor-pointer border border-[hsl(var(--border-strong))]")}
          />
          <span className="font-mono text-[12px] truncate">{itemLabel(item.key)}</span>
        </div>
        <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))] shrink-0 tabular-nums">
          {itemSize(item)}
        </span>
      </label>
    );
  }

  function renderGroup(group: DataGroup) {
    const body = (
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{groupDesc[group.id]}</p>
        {group.items.map(renderItem)}
      </div>
    );

    if (group.danger) {
      return (
        <div key={group.id} className="flex flex-col gap-2">
          <button
            onClick={() => setDangerOpen((v) => !v)}
            className="unity-panel-header flex items-center gap-2 text-left text-[hsl(var(--destructive,red))]"
          >
            <span>{dangerOpen ? "▾" : "▸"}</span>
            {groupLabel[group.id]}
          </button>
          {dangerOpen && body}
        </div>
      );
    }

    return (
      <div key={group.id} className="flex flex-col gap-2">
        <div className="unity-panel-header">{groupLabel[group.id]}</div>
        {body}
      </div>
    );
  }

  const canClear = selectedKeys.length > 0 && !working;
  const confirmDisabled = working || (confirmHasDanger && !dangerAck);

  return (
    <div className="flex flex-col gap-3">
      <div className="unity-panel-header">
        {t("settings.data.heading", { defaultValue: "Data Management" })}
      </div>
      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
        {t("settings.data.blurb", {
          defaultValue:
            "Review and clear the caches and data VRCSM stores on this machine. Rebuildable caches are safe to clear; history and asset data are removed permanently.",
        })}
      </p>

      {usage && (
        <p className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("settings.data.dbSize", {
            defaultValue: "Database file (vrcsm.db): {{size}}",
            size: formatBytes(usage.dbFileBytes),
          })}
        </p>
      )}

      {loading && (
        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("settings.data.loading", { defaultValue: "Loading usage…" })}
        </p>
      )}

      {error && (
        <p className="text-[11px] text-[hsl(var(--destructive,red))] font-mono">
          {t("settings.data.loadError", {
            defaultValue: "Failed to load usage: {{error}}",
            error,
          })}
        </p>
      )}

      {!loading && !error && (
        <div className="flex flex-col gap-4">{GROUPS.map(renderGroup)}</div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-[hsl(var(--border))] pt-3">
        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("settings.data.selectedCount", {
            defaultValue: "{{count}} selected",
            count: selectedKeys.length,
          })}
        </span>
        <Button
          variant="destructive"
          size="sm"
          disabled={!canClear}
          onClick={() => {
            setDangerAck(false);
            setConfirmOpen(true);
          }}
        >
          {t("settings.data.clearSelected", { defaultValue: "Clear selected" })}
        </Button>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!working) {
            setConfirmOpen(open);
            if (!open) setDangerAck(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("settings.data.confirmTitle", { defaultValue: "Confirm cleanup" })}
            </DialogTitle>
            <DialogDescription>
              {confirmIrreversible
                ? t("settings.data.confirmIrreversible", {
                    defaultValue:
                      "The following items will be permanently removed. This cannot be undone.",
                  })
                : t("settings.data.confirmSafe", {
                    defaultValue: "The following items will be cleared. Caches regenerate automatically.",
                  })}
            </DialogDescription>
          </DialogHeader>

          <ul className="flex flex-col gap-1 max-h-52 overflow-auto font-mono text-[12px]">
            {selectedKeys.map((k) => (
              <li key={k} className="flex items-center gap-2">
                <span className="text-[hsl(var(--muted-foreground))]">•</span>
                {itemLabel(k)}
              </li>
            ))}
          </ul>

          {confirmHasDanger && (
            <label className="flex items-start gap-2 cursor-pointer select-none text-[11px] text-[hsl(var(--destructive,red))]">
              <input
                type="checkbox"
                checked={dangerAck}
                onChange={(e) => setDangerAck(e.target.checked)}
                className="w-4 h-4 mt-0.5 cursor-pointer border border-[hsl(var(--border-strong))]"
              />
              <span>
                {t("settings.data.dangerAck", {
                  defaultValue:
                    "I understand this permanently deletes my own assets (favorites, notes, tags).",
                })}
              </span>
            </label>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={working}
              onClick={() => {
                setConfirmOpen(false);
                setDangerAck(false);
              }}
            >
              {t("settings.data.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={confirmDisabled}
              onClick={() => void runClear()}
            >
              {working
                ? t("settings.data.clearing", { defaultValue: "Clearing…" })
                : t("settings.data.confirmClear", { defaultValue: "Clear now" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
