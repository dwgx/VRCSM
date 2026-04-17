import { useState, useEffect, useMemo, useCallback } from "react";
import { ipc } from "@/lib/ipc";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, RefreshCw, Lock, Unlock, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useRightDock, type RightDockDescriptor } from "@/components/RightDock";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import type {
  VrcSettingEntry,
  VrcSettingsReport,
  VrcSettingValueSnapshot,
} from "@/lib/types";

import { snapshotFromEntry, hexBytes } from "./utils";
import { SettingGroup } from "./components/SettingRow";
import { SettingEntryRow } from "./components/SemanticEditor";

type Draft = Record<string, VrcSettingValueSnapshot>;

const GROUP_ORDER = [
  "audio",
  "graphics",
  "network",
  "avatar",
  "input",
  "osc",
  "comfort",
  "ui",
  "privacy",
  "safety",
  "system",
  "other",
] as const;

type TabKey = "all" | (typeof GROUP_ORDER)[number];
const PAGE_SIZE = 20;

export function TabRegistry({ vrcRunning }: { vrcRunning: boolean }) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [report, setReport] = useState<VrcSettingsReport | null>(null);
  const [drafts, setDrafts] = useState<Draft>({});
  const [exporting, setExporting] = useState(false);
  const [writing, setWriting] = useState<string | null>(null);

  const [filterStr, setFilter] = useState("");
  const filter = useDebouncedValue(filterStr, 300);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [page, setPage] = useState(0);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const dirtyCount = Object.keys(drafts).length;

  const reload = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    ipc
      .readVrcSettings()
      .then((r) => {
        setReport(r);
        setDrafts({});
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setLoadError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let alive = true;
    ipc.readVrcSettings().then((r) => {
      if (alive) {
        setReport(r);
        setLoading(false);
      }
    }).catch((e: unknown) => {
      if (alive) {
        const msg = e instanceof Error ? e.message : String(e);
        setLoadError(msg);
        setLoading(false);
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  const updateDraft = (
    entry: VrcSettingEntry,
    patch: Partial<VrcSettingValueSnapshot>,
  ) => {
    setDrafts((prev) => {
      const snap = prev[entry.encodedKey] ?? snapshotFromEntry(entry);
      const next: VrcSettingValueSnapshot = { ...snap, ...patch };
      const original = snapshotFromEntry(entry);
      const isDirty =
        next.type !== original.type ||
        next.intValue !== original.intValue ||
        next.floatValue !== original.floatValue ||
        next.stringValue !== original.stringValue ||
        next.boolValue !== original.boolValue;

      const nextDrafts = { ...prev };
      if (isDirty) {
        nextDrafts[entry.encodedKey] = next;
      } else {
        delete nextDrafts[entry.encodedKey];
      }
      return nextDrafts;
    });
  };

  const revertDraft = (key: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const writeDraft = async (entry: VrcSettingEntry) => {
    const draft = drafts[entry.encodedKey];
    if (!draft) return;

    setWriting(entry.encodedKey);
    try {
      await ipc.writeVrcSetting(entry.encodedKey, draft);
      const valStr = String(
        draft.type === "int" ? draft.intValue :
        draft.type === "float" ? draft.floatValue :
        draft.type === "string" ? draft.stringValue :
        draft.boolValue
      );
      toast.success(
        t("settings.vrc.writeSuccess", {
          key: entry.key,
          value: valStr.length > 20 ? valStr.substring(0, 20) + "…" : valStr,
        }),
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[entry.encodedKey];
        return next;
      });
      reload();
    } catch (e: unknown) {
      toast.error(t("settings.vrc.writeFailed", { key: entry.key }) as string);
    } finally {
      setWriting(null);
    }
  };

  const runExport = async () => {
    setExporting(true);
    try {
      const exportedPath = await ipc.exportVrcSettings();
      toast.success(t("settings.vrc.exportSuccess", { file: exportedPath }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("settings.vrc.exportFailed", { error: msg }));
    } finally {
      setExporting(false);
    }
  };

  // ─── Filter & paginate exactly as before ───

  const filteredIndices: number[] = useMemo(() => {
    if (!report) return [];
    const q = filter.trim().toLowerCase();
    const arr: number[] = [];
    for (let i = 0; i < report.entries.length; i++) {
      const entry = report.entries[i]!;
      if (!q) {
        arr.push(i);
        continue;
      }
      const matchKey = entry.key.toLowerCase().includes(q);
      const matchVal =
        entry.stringValue?.toLowerCase().includes(q) ||
        entry.intValue?.toString().includes(q) ||
        entry.floatValue?.toString().includes(q);
      if (matchKey || matchVal) {
        arr.push(i);
      }
    }
    return arr;
  }, [report, filter]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of GROUP_ORDER) counts[g] = 0;
    if (!report) return counts;
    for (const idx of filteredIndices) {
      const entry = report.entries[idx]!;
      counts[entry.group] = (counts[entry.group] || 0) + 1;
    }
    return counts;
  }, [report, filteredIndices]);

  const tabDefinitions = useMemo(() => {
    const arr: { key: TabKey; count: number }[] = [];
    if (filteredIndices.length > 0) {
      arr.push({ key: "all", count: filteredIndices.length });
    }
    for (const g of GROUP_ORDER) {
      const c = groupCounts[g];
      if (c && c > 0) {
        arr.push({ key: g, count: c });
      }
    }
    return arr;
  }, [filteredIndices.length, groupCounts]);

  const effectiveTab = useMemo(() => {
    if (!tabDefinitions.some((t) => t.key === activeTab)) return "all";
    return activeTab;
  }, [activeTab, tabDefinitions]);

  useEffect(() => {
    setPage(0);
  }, [filter, effectiveTab]);

  const activeIndices = useMemo(() => {
    if (effectiveTab === "all") return filteredIndices;
    if (!report) return [];
    return filteredIndices.filter(
      (idx) => report.entries[idx]!.group === effectiveTab,
    );
  }, [filteredIndices, effectiveTab, report]);

  const totalMatches = activeIndices.length;
  const pageCount = Math.ceil(totalMatches / PAGE_SIZE);
  const pagedIndices = activeIndices.slice(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE,
  );

  const selectedEntry = useMemo(() => {
    if (!report || !selectedKey) return null;
    return report.entries.find((e) => e.encodedKey === selectedKey) ?? null;
  }, [report, selectedKey]);

  const dock = useMemo<RightDockDescriptor | null>(() => {
    if (!selectedEntry) return null;
    const rawType =
      selectedEntry.type === "int"
        ? "0x4 (REG_DWORD)"
        : selectedEntry.type === "string"
          ? "0x1 (REG_SZ)"
          : selectedEntry.type === "raw"
            ? "0x3 (REG_BINARY)"
            : "Unknown";

    return {
      title: t("settings.vrc.dock.title"),
      icon: "file-code",
      onClose: () => setSelectedKey(null),
      body: (
        <div className="flex flex-col gap-4 text-[12px]">
          <div>
            <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
              {t("settings.vrc.decodedKey")}
            </div>
            <div className="mt-1 font-mono text-[13px] font-semibold tracking-tight text-[hsl(var(--foreground))]">
              {selectedEntry.key}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
              {t("settings.vrc.encodedKey")}
            </div>
            <div className="mt-1 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-2 font-mono text-[11px] leading-snug text-[hsl(var(--foreground))] break-all">
              {selectedEntry.encodedKey}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
              {t("settings.vrc.rawType")}
            </div>
            <div className="mt-1 font-mono text-[11px] text-[hsl(var(--foreground))]">
              {rawType}
            </div>
          </div>
          {selectedEntry.raw && selectedEntry.raw.length ? (
            <div>
              <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                {t("settings.vrc.rawBytes")}
              </div>
              <div className="mt-1 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-2 font-mono text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))] break-all">
                {hexBytes(selectedEntry.raw)}
                {selectedEntry.raw.length > 96 ? " …" : ""}
              </div>
            </div>
          ) : null}
          {(() => {
            const localized = t(
              `settings.vrc.keys.${selectedEntry.key}.description`,
              { defaultValue: selectedEntry.description ?? "" },
            );
            return localized ? (
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-2 text-[11px] leading-snug text-[hsl(var(--muted-foreground))]">
                {localized}
              </div>
            ) : null;
          })()}
        </div>
      ),
    };
  }, [selectedEntry, t]);

  useRightDock(dock);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{t("settings.vrc.sectionTitle")}</CardTitle>
            <CardDescription className="max-w-[60ch]">
              {t("settings.vrc.sectionDesc")}
            </CardDescription>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {vrcRunning ? (
              <Badge variant="warning" className="gap-1">
                <Lock className="size-3" />
                {t("settings.vrc.vrcRunningBadge")}
              </Badge>
            ) : (
              <Badge variant="success" className="gap-1">
                <Unlock className="size-3" />
                {t("settings.vrc.vrcIdleBadge")}
              </Badge>
            )}
            {dirtyCount > 0 ? (
              <Badge variant="default">
                {t("settings.vrc.dirtyBadge", { count: dirtyCount })}
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={filterStr}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("settings.vrc.filterPlaceholder")}
            className="h-7 max-w-[320px] flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={reload}
            disabled={loading}
          >
            <RefreshCw className={loading ? "animate-spin mr-2 size-3" : "mr-2 size-3"} />
            {t("settings.vrc.reload")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runExport()}
            disabled={exporting}
          >
            <Download className="mr-2 size-3" />
            {exporting ? t("settings.vrc.exporting") : t("settings.vrc.exportReg")}
          </Button>
          {report ? (
            <Badge variant="muted" className="font-mono">
              {t("settings.vrc.count", { count: report.count })}
            </Badge>
          ) : null}
        </div>

        {loadError ? (
          <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.45)] bg-[hsl(var(--destructive)/0.1)] p-3 text-[12px] text-[hsl(var(--destructive))]">
            {t("settings.vrc.loadFailed", { error: loadError })}
          </div>
        ) : null}

        {loading && !report ? (
          <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-4 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("settings.vrc.loading")}
          </div>
        ) : null}

        {report && tabDefinitions.length > 0 ? (
          <div className="flex flex-wrap items-end gap-0.5 border-b border-[hsl(var(--border))] pb-0">
            {tabDefinitions.map(({ key, count }) => {
              const label =
                key === "all"
                  ? t("settings.vrc.tabs.all")
                  : t(`settings.vrc.groups.${key}`);
              const active = effectiveTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={cn(
                    "unity-tab flex items-center gap-1.5 px-3 py-1.5 text-[11.5px]",
                    active && "unity-tab-active",
                  )}
                >
                  <span>{label}</span>
                  <span
                    className={cn(
                      "inline-flex min-w-[18px] justify-center rounded-[var(--radius-sm)] border border-[hsl(var(--border))] px-1 font-mono text-[9.5px]",
                      active
                        ? "bg-[hsl(var(--primary)/0.18)] text-[hsl(var(--primary))]"
                        : "bg-[hsl(var(--canvas))] text-[hsl(var(--muted-foreground))]",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {report && totalMatches === 0 ? (
          <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-4 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
            {filter.trim()
              ? t("settings.vrc.noMatch")
              : t("settings.vrc.empty")}
          </div>
        ) : null}

        {report && totalMatches > 0 ? (
          <SettingGroup
            title={
              effectiveTab === "all"
                ? t("settings.vrc.tabs.all")
                : t(`settings.vrc.groups.${effectiveTab}`)
            }
          >
            {pagedIndices.map((idx) => {
              const entry = report.entries[idx];
              if (!entry) return null;
              const draft = drafts[entry.encodedKey];
              const dirty = draft !== undefined;
              const activeValue: VrcSettingValueSnapshot = dirty
                ? draft
                : snapshotFromEntry(entry);
              return (
                <SettingEntryRow
                  key={entry.encodedKey}
                  entry={entry}
                  value={activeValue}
                  dirty={dirty}
                  disabled={vrcRunning}
                  writing={writing === entry.encodedKey}
                  selected={selectedKey === entry.encodedKey}
                  writeLabel={t("settings.vrc.writeOne")}
                  writingLabel={t("settings.vrc.writing")}
                  revertLabel={t("settings.vrc.revert")}
                  lockHint={t("settings.vrc.vrcRunningLock")}
                  typeLabels={{
                    int: t("settings.vrc.types.int"),
                    float: t("settings.vrc.types.float"),
                    string: t("settings.vrc.types.string"),
                    bool: t("settings.vrc.types.bool"),
                    raw: t("settings.vrc.types.raw"),
                  }}
                  onEdit={(patch) => updateDraft(entry, patch)}
                  onSelect={() => setSelectedKey(entry.encodedKey)}
                  onApply={() => void writeDraft(entry)}
                  onRevert={() => revertDraft(entry.encodedKey)}
                />
              );
            })}
          </SettingGroup>
        ) : null}

        {report && totalMatches > PAGE_SIZE ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2 text-[11px]">
            <span className="font-mono text-[hsl(var(--muted-foreground))]">
              {t("settings.vrc.pagination.range", {
                from: page * PAGE_SIZE + 1,
                to: Math.min((page + 1) * PAGE_SIZE, totalMatches),
                total: totalMatches,
              })}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                <ChevronLeft className="size-3" />
                {t("settings.vrc.pagination.prev")}
              </Button>
              <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                {t("settings.vrc.pagination.page", {
                  page: page + 1,
                  total: pageCount,
                })}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setPage((p) => Math.min(pageCount - 1, p + 1))
                }
                disabled={page >= pageCount - 1}
              >
                {t("settings.vrc.pagination.next")}
                <ChevronRight className="size-3" />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
