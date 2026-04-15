import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Lock,
  RefreshCw,
  Trash2,
  Undo2,
  Unlock,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { ipc } from "@/lib/ipc";
import type {
  AppVersion,
  ProcessStatus,
  VrcSettingEntry,
  VrcSettingsReport,
  VrcSettingType,
  VrcSettingValueSnapshot,
} from "@/lib/types";
import { getSemantic, type SemanticEditor } from "@/lib/vrcSettingsSemantics";
import { SUPPORTED_LANGUAGES, changeLanguage } from "@/i18n";

type Draft = Record<string, VrcSettingValueSnapshot>;

// IMPORTANT: must match the kGroups whitelist in
// src/core/VrcSettings.cpp exactly — the backend emits keys under these
// literal group names and any mismatch here causes that bucket to
// silently fall through to "other".
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

function snapshotFromEntry(entry: VrcSettingEntry): VrcSettingValueSnapshot {
  const snap: VrcSettingValueSnapshot = { type: entry.type };
  if (entry.intValue !== undefined) snap.intValue = entry.intValue;
  if (entry.floatValue !== undefined) snap.floatValue = entry.floatValue;
  if (entry.stringValue !== undefined) snap.stringValue = entry.stringValue;
  if (entry.boolValue !== undefined) snap.boolValue = entry.boolValue;
  if (entry.raw !== undefined) snap.raw = entry.raw;
  return snap;
}

function snapshotsEqual(
  a: VrcSettingValueSnapshot,
  b: VrcSettingValueSnapshot,
): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "int":
      return (a.intValue ?? 0) === (b.intValue ?? 0);
    case "float":
      return (a.floatValue ?? 0) === (b.floatValue ?? 0);
    case "string":
      return (a.stringValue ?? "") === (b.stringValue ?? "");
    case "bool":
      return (a.boolValue ?? false) === (b.boolValue ?? false);
    default:
      return JSON.stringify(a.raw ?? []) === JSON.stringify(b.raw ?? []);
  }
}

function displayForEntry(entry: VrcSettingEntry): string {
  switch (entry.type) {
    case "int":
      return String(entry.intValue ?? 0);
    case "float":
      return (entry.floatValue ?? 0).toString();
    case "string":
      return entry.stringValue ?? "";
    case "bool":
      return entry.boolValue ? "true" : "false";
    default:
      return `[${(entry.raw ?? []).length} B]`;
  }
}

function hexBytes(bytes: number[] | undefined): string {
  if (!bytes || !bytes.length) return "—";
  return bytes
    .slice(0, 96)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

function Settings() {
  const { t, i18n } = useTranslation();

  // ─── VRCSM app section ───────────────────────────────────────────────
  const [version, setVersion] = useState<AppVersion | null>(null);
  const [factoryResetOpen, setFactoryResetOpen] = useState(false);
  const [factoryResetting, setFactoryResetting] = useState(false);

  useEffect(() => {
    let alive = true;
    ipc
      .version()
      .then((v) => {
        if (alive) setVersion(v);
      })
      .catch(() => {
        // Dev-server fallback only — prod reads IpcBridge::HandleAppVersion.
        if (alive) setVersion({ version: "0.3.0", build: "dev" });
      });
    return () => {
      alive = false;
    };
  }, []);

  // ─── VRChat settings section ─────────────────────────────────────────
  const [report, setReport] = useState<VrcSettingsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebouncedValue(filter, 150);
  const [drafts, setDrafts] = useState<Draft>({});
  const [writing, setWriting] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [vrcRunning, setVrcRunning] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [page, setPage] = useState(0);

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
        const code =
          typeof e === "object" && e !== null && "code" in e
            ? String((e as { code?: unknown }).code ?? "")
            : "";
        const display = code ? `${code}: ${msg}` : msg;
        setLoadError(display);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    let alive = true;

    // Initial fetch seeds the "VRChat running — writes disabled" warning
    // at the top of Settings. After mount, the host pushes transitions
    // via `process.vrcStatusChanged`, matching the sidebar dot in App.tsx.
    ipc
      .call<undefined, ProcessStatus>("process.vrcRunning")
      .then((status) => {
        if (alive) setVrcRunning(status.running);
      })
      .catch(() => {
        if (alive) setVrcRunning(false);
      });

    const unsubscribe = ipc.on<ProcessStatus>(
      "process.vrcStatusChanged",
      (status) => {
        if (alive) setVrcRunning(status.running);
      },
    );

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  // ─── Filtering + tab/pagination ──────────────────────────────────────
  // Index by group once per report, respecting GROUP_ORDER so that unknown
  // groups bucket into "other" and the tab strip stays stable.
  const groupedIndices = useMemo(() => {
    if (!report) return {} as Record<TabKey, number[]>;
    const out: Record<TabKey, number[]> = {
      all: [],
      audio: [],
      graphics: [],
      network: [],
      avatar: [],
      input: [],
      osc: [],
      comfort: [],
      ui: [],
      privacy: [],
      safety: [],
      system: [],
      other: [],
    };
    for (const group of GROUP_ORDER) {
      const list = report.groups[group] ?? [];
      out[group] = [...list];
    }
    const known = new Set<string>(GROUP_ORDER);
    for (const [groupName, indices] of Object.entries(report.groups)) {
      if (known.has(groupName)) continue;
      out.other.push(...indices);
    }
    for (const group of GROUP_ORDER) out.all.push(...out[group]);
    return out;
  }, [report]);

  const tabDefinitions = useMemo(() => {
    if (!report) return [] as Array<{ key: TabKey; count: number }>;
    const defs: Array<{ key: TabKey; count: number }> = [
      { key: "all", count: groupedIndices.all.length },
    ];
    for (const group of GROUP_ORDER) {
      const count = groupedIndices[group]?.length ?? 0;
      if (count > 0) defs.push({ key: group, count });
    }
    return defs;
  }, [report, groupedIndices]);

  const matches = useCallback(
    (idx: number) => {
      const trimmed = debouncedFilter.trim().toLowerCase();
      if (!trimmed) return true;
      const e = report?.entries[idx];
      if (!e) return false;
      if (e.key.toLowerCase().includes(trimmed)) return true;
      if (e.description.toLowerCase().includes(trimmed)) return true;
      if (displayForEntry(e).toLowerCase().includes(trimmed)) return true;
      return false;
    },
    [debouncedFilter, report],
  );

  // When the user types into the global search, force the "All" tab
  // so matches from every group are visible at once, then collapse on
  // tab switch. Never block entry visibility in an unrelated tab.
  const effectiveTab: TabKey =
    debouncedFilter.trim().length > 0 ? "all" : activeTab;

  const activeIndices = useMemo(() => {
    if (!report) return [] as number[];
    const list = groupedIndices[effectiveTab] ?? [];
    return list.filter(matches);
  }, [report, groupedIndices, effectiveTab, matches]);

  const totalMatches = activeIndices.length;
  const pageCount = Math.max(1, Math.ceil(totalMatches / PAGE_SIZE));

  // Keep `page` inside [0, pageCount) as filters narrow the result set.
  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  // Reset to page 0 whenever the filter text or tab changes — otherwise
  // a user searching from page 5 gets an "empty" page if their query
  // matches fewer than 5 × PAGE_SIZE entries.
  useEffect(() => {
    setPage(0);
  }, [filter, activeTab]);

  const pagedIndices = useMemo(() => {
    const start = page * PAGE_SIZE;
    return activeIndices.slice(start, start + PAGE_SIZE);
  }, [activeIndices, page]);

  const dirtyCount = Object.keys(drafts).length;

  // ─── Draft editors ───────────────────────────────────────────────────
  const updateDraft = useCallback(
    (entry: VrcSettingEntry, patch: Partial<VrcSettingValueSnapshot>) => {
      setDrafts((prev) => {
        const base: VrcSettingValueSnapshot =
          prev[entry.encodedKey] ?? snapshotFromEntry(entry);
        const next: VrcSettingValueSnapshot = { ...base, ...patch };
        const original = snapshotFromEntry(entry);
        const copy = { ...prev };
        if (snapshotsEqual(next, original)) {
          delete copy[entry.encodedKey];
        } else {
          copy[entry.encodedKey] = next;
        }
        return copy;
      });
    },
    [],
  );

  const revertDraft = useCallback((encodedKey: string) => {
    setDrafts((prev) => {
      if (!(encodedKey in prev)) return prev;
      const copy = { ...prev };
      delete copy[encodedKey];
      return copy;
    });
  }, []);

  const writeDraft = useCallback(
    async (entry: VrcSettingEntry) => {
      const draft = drafts[entry.encodedKey];
      if (!draft) return;

      setWriting(entry.encodedKey);
      try {
        await ipc.writeVrcSetting(entry.encodedKey, draft);
        toast.success(t("settings.vrc.writeOk", { key: entry.key }));
        setReport((prev) => {
          if (!prev) return prev;
          const nextEntries = prev.entries.map((e) => {
            if (e.encodedKey !== entry.encodedKey) return e;
            return { ...e, ...draft };
          });
          return { ...prev, entries: nextEntries };
        });
        setDrafts((prev) => {
          const copy = { ...prev };
          delete copy[entry.encodedKey];
          return copy;
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(t("settings.vrc.writeFailed", { error: msg }));
      } finally {
        setWriting(null);
      }
    },
    [drafts, t],
  );

  const runExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await ipc.exportVrcSettings();
      toast.success(t("settings.vrc.exported", { path: result.path }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("settings.vrc.exportFailed", { error: msg }));
    } finally {
      setExporting(false);
    }
  }, [t]);

  const runFactoryReset = useCallback(async () => {
    setFactoryResetting(true);
    try {
      // The host handler is idempotent and returns {ok, removed, skipped}.
      // We surface `removed.length` so the toast can tell the user how
      // many state files were wiped in a single sentence without leaking
      // the raw file names (they're mostly opaque, e.g. session.dat).
      const result = await ipc.call<
        undefined,
        { ok: boolean; removed: string[]; skipped: string[] }
      >("app.factoryReset");
      if (result.ok) {
        toast.success(
          t("settings.app.factoryResetOk", {
            count: result.removed.length,
            defaultValue: "Factory reset complete ({{count}} files wiped)",
          }),
        );
        // After a reset the thumbnail cache is gone — force a reload of
        // the settings report so any stale draft state doesn't linger.
        reload();
      } else {
        toast.error(
          t("settings.app.factoryResetFailed", {
            defaultValue: "Factory reset failed",
          }),
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(
        t("settings.app.factoryResetFailed", {
          error: msg,
          defaultValue: "Factory reset failed: {{error}}",
        }),
      );
    } finally {
      setFactoryResetting(false);
      setFactoryResetOpen(false);
    }
  }, [t, reload]);

  // ─── Right dock inspector ────────────────────────────────────────────
  const selectedEntry = useMemo(() => {
    if (!report || !selectedKey) return null;
    return report.entries.find((e) => e.encodedKey === selectedKey) ?? null;
  }, [report, selectedKey]);

  const dock = useMemo<RightDockDescriptor | null>(() => {
    if (!selectedEntry) {
      return {
        title: t("settings.vrc.inspectorTitle"),
        body: (
          <div className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("settings.vrc.inspectorHint")}
          </div>
        ),
      };
    }

    const rawType =
      selectedEntry.type === "int"
        ? "REG_DWORD / REG_QWORD"
        : selectedEntry.type === "float"
          ? "REG_BINARY (tag 0x03)"
          : selectedEntry.type === "string"
            ? "REG_BINARY (tag 0x02)"
            : selectedEntry.type === "bool"
              ? "REG_DWORD"
              : "REG_BINARY";

    return {
      title: t("settings.vrc.inspectorTitle"),
      body: (
        <div className="space-y-3 text-[12px]">
          <div>
            <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
              {selectedEntry.key}
            </div>
            <div className="mt-1 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-2 font-mono text-[11px] leading-snug text-[hsl(var(--foreground))]">
              {displayForEntry(selectedEntry) || "—"}
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
            // Per-key i18n lookup with graceful fallback. The C++ side
            // owns the canonical English description in
            // VrcSettingsKnownKeys.inc; if a locale hasn't translated
            // this key yet, i18next returns that English string
            // verbatim via `defaultValue` so the user never sees a raw
            // translation key. Evaluated in an IIFE so we can hoist
            // the final string above the conditional render.
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

  const currentLang = i18n.resolvedLanguage ?? i18n.language;

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {/* ─── Unity-style compact header ─────────────────────────── */}
      <header className="flex items-center gap-2">
        <div className="unity-panel-header inline-flex items-center gap-2 border-0 bg-transparent px-0 py-0 normal-case tracking-normal">
          <span className="text-[11px] uppercase tracking-[0.08em]">
            {t("settings.title")}
          </span>
        </div>
        <span className="h-[11px] w-px bg-[hsl(var(--border-strong))]" />
        <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("settings.subtitle")}
        </span>
      </header>

      {/* ─── VRCSM shell preferences ────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>{t("settings.app.sectionTitle")}</CardTitle>
              <CardDescription>
                {t("settings.app.sectionDesc")}
              </CardDescription>
            </div>
            {version ? (
              <Badge variant="muted" className="font-mono">
                {t("app.version", {
                  version: version.version,
                  build: version.build,
                })}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <SettingRow label={t("settings.language")} hint={t("settings.languageHint")}>
            <div className="flex flex-wrap gap-2">
              {SUPPORTED_LANGUAGES.map((lang) => {
                const active = currentLang === lang.code;
                return (
                  <Button
                    key={lang.code}
                    size="sm"
                    variant={active ? "tonal" : "outline"}
                    onClick={() => void changeLanguage(lang.code)}
                  >
                    {active ? <Check className="size-3" /> : null}
                    {lang.native}
                  </Button>
                );
              })}
            </div>
          </SettingRow>
          <SettingRow label={t("settings.appTheme")} hint={t("settings.appThemeHint")}>
            <Badge variant="muted">{t("settings.dark")}</Badge>
          </SettingRow>
          <SettingRow
            label={t("settings.app.factoryResetLabel", {
              defaultValue: "Factory reset",
            })}
            hint={t("settings.app.factoryResetHint", {
              defaultValue:
                "Wipe VRCSM's saved session, thumbnail cache and logs. Does NOT touch VRChat's own data.",
            })}
          >
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFactoryResetOpen(true)}
              className="border-[hsl(var(--destructive)/0.55)] text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/0.12)]"
            >
              <Trash2 className="size-3" />
              {t("settings.app.factoryResetLabel", {
                defaultValue: "Factory reset",
              })}
            </Button>
          </SettingRow>
        </CardContent>
      </Card>

      {/* ─── VRChat game settings ───────────────────────────────── */}
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
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              value={filter}
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
              <RefreshCw className={loading ? "animate-spin" : undefined} />
              {t("settings.vrc.reload")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runExport()}
              disabled={exporting}
            >
              <Download />
              {exporting ? t("settings.vrc.exporting") : t("settings.vrc.exportReg")}
            </Button>
            {report ? (
              <Badge variant="muted" className="font-mono">
                {t("settings.vrc.count", { count: report.count })}
              </Badge>
            ) : null}
          </div>

          {/* content */}
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

      {/* Factory reset confirmation — destructive action, explicit opt-in. */}
      <Dialog
        open={factoryResetOpen}
        onOpenChange={(open) => {
          if (factoryResetting) return;
          setFactoryResetOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-[hsl(var(--destructive))]" />
              {t("settings.app.factoryResetConfirmTitle", {
                defaultValue: "Factory reset VRCSM?",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("settings.app.factoryResetConfirmBody", {
                defaultValue:
                  "This wipes VRCSM's saved VRChat session, thumbnail cache and logs under %LocalAppData%\\VRCSM. VRChat's own avatars, cache and registry settings are NOT affected. This action cannot be undone.",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFactoryResetOpen(false)}
              disabled={factoryResetting}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              variant="default"
              onClick={() => void runFactoryReset()}
              disabled={factoryResetting}
              className="bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:bg-[hsl(var(--destructive)/0.9)]"
            >
              {factoryResetting
                ? t("settings.app.factoryResetting", {
                    defaultValue: "Wiping…",
                  })
                : t("settings.app.factoryResetConfirm", {
                    defaultValue: "Wipe VRCSM data",
                  })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default Settings;

/* ─────────────────────────────────────────────────────────────── */
/* Subcomponents                                                  */
/* ─────────────────────────────────────────────────────────────── */

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-[hsl(var(--foreground))]">
          {label}
        </div>
        {hint ? (
          <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {hint}
          </div>
        ) : null}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function SettingGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))]">
      <header className="unity-panel-header">{title}</header>
      <div className="flex flex-col divide-y divide-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
        {children}
      </div>
    </section>
  );
}

interface SettingEntryRowProps {
  entry: VrcSettingEntry;
  value: VrcSettingValueSnapshot;
  dirty: boolean;
  disabled: boolean;
  writing: boolean;
  selected: boolean;
  writeLabel: string;
  writingLabel: string;
  revertLabel: string;
  lockHint: string;
  typeLabels: Record<VrcSettingType, string>;
  onEdit: (patch: Partial<VrcSettingValueSnapshot>) => void;
  onSelect: () => void;
  onApply: () => void;
  onRevert: () => void;
}

function SettingEntryRow({
  entry,
  value,
  dirty,
  disabled,
  writing,
  selected,
  writeLabel,
  writingLabel,
  revertLabel,
  lockHint,
  typeLabels,
  onEdit,
  onSelect,
  onApply,
  onRevert,
}: SettingEntryRowProps) {
  const { t } = useTranslation();
  // Same per-key i18n lookup as the right dock. Looked up once per row
  // rather than for every render of the row's inner subtree — cheap,
  // but it also keeps the defaultValue fallback in one place.
  const localizedDescription = t(
    `settings.vrc.keys.${entry.key}.description`,
    { defaultValue: entry.description ?? "" },
  );
  return (
    <div
      onClick={onSelect}
      className={
        "grid cursor-pointer grid-cols-[1fr_minmax(160px,auto)_auto] items-center gap-3 px-3 py-2 transition-colors hover:bg-[hsl(var(--surface-raised))]" +
        (selected ? " bg-[hsl(var(--surface-raised))]" : "")
      }
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={
              "truncate font-mono text-[12px] " +
              (dirty
                ? "text-[hsl(var(--primary))]"
                : "text-[hsl(var(--foreground))]")
            }
          >
            {entry.key}
          </span>
          <Badge variant="outline" className="font-mono">
            {typeLabels[entry.type]}
          </Badge>
          {entry.type === "raw" ? (
            <Badge variant="muted" className="font-mono text-[10px]">
              {entry.raw?.length ?? 0}B
            </Badge>
          ) : null}
        </div>
        {localizedDescription ? (
          <div className="mt-0.5 truncate text-[11px] text-[hsl(var(--muted-foreground))]">
            {localizedDescription}
          </div>
        ) : null}
      </div>

      <div
        className="flex justify-end"
        onClick={(event) => event.stopPropagation()}
      >
        <EntryEditor
          entry={entry}
          value={value}
          disabled={disabled || writing}
          onEdit={onEdit}
        />
      </div>

      <div
        className="flex items-center gap-1.5"
        onClick={(event) => event.stopPropagation()}
      >
        {dirty ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={onRevert}
              disabled={writing}
              title={revertLabel}
            >
              <Undo2 />
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={onApply}
              disabled={disabled || writing}
              title={disabled ? lockHint : writeLabel}
            >
              {writing ? writingLabel : writeLabel}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

interface EntryEditorProps {
  entry: VrcSettingEntry;
  value: VrcSettingValueSnapshot;
  disabled: boolean;
  onEdit: (patch: Partial<VrcSettingValueSnapshot>) => void;
}

/**
 * Build the curated editor widget for a key that appears in
 * `VRC_SETTINGS_SEMANTICS`. Returns `null` when the semantic kind
 * doesn't match the entry's underlying type — the caller then falls
 * back to the raw Number/Text/Toggle editor.
 *
 * The goal of this function is to stay purely presentational: every
 * write still flows through the same `onEdit` patch callback and hits
 * the same IPC path as the raw editor, so the semantic layer can be
 * disabled by deleting the key from the semantics map without any
 * cleanup elsewhere.
 */
function renderSemanticEditor(
  editor: SemanticEditor,
  entryType: VrcSettingType,
  value: VrcSettingValueSnapshot,
  disabled: boolean,
  onEdit: (patch: Partial<VrcSettingValueSnapshot>) => void,
): ReactElement | null {
  const baseCls =
    "h-7 font-mono text-[12px]" + (disabled ? " opacity-60" : "");

  // ── float slider ─────────────────────────────────────────────────
  if (editor.kind === "slider-float") {
    if (entryType !== "float") return null;
    const current = value.floatValue ?? editor.min;
    return (
      <div className="flex items-center gap-2">
        <input
          type="range"
          disabled={disabled}
          min={editor.min}
          max={editor.max}
          step={editor.step}
          value={current}
          onChange={(e) =>
            onEdit({
              type: "float",
              floatValue: Number.parseFloat(e.target.value),
            })
          }
          className="h-2 w-[160px] cursor-pointer accent-[hsl(var(--primary))]"
        />
        <span className="w-[70px] text-right font-mono text-[11px] text-[hsl(var(--foreground))]">
          {current.toFixed(editor.step < 0.1 ? 2 : 1)}
          {editor.unit ? ` ${editor.unit}` : ""}
        </span>
      </div>
    );
  }

  // ── integer slider ──────────────────────────────────────────────
  if (editor.kind === "slider-int") {
    if (entryType !== "int") return null;
    const current = value.intValue ?? editor.min;
    return (
      <div className="flex items-center gap-2">
        <input
          type="range"
          disabled={disabled}
          min={editor.min}
          max={editor.max}
          step={editor.step ?? 1}
          value={current}
          onChange={(e) =>
            onEdit({
              type: "int",
              intValue: Number.parseInt(e.target.value, 10),
            })
          }
          className="h-2 w-[160px] cursor-pointer accent-[hsl(var(--primary))]"
        />
        <span className="w-[70px] text-right font-mono text-[11px] text-[hsl(var(--foreground))]">
          {current}
          {editor.unit ? ` ${editor.unit}` : ""}
        </span>
      </div>
    );
  }

  // ── int dropdown ────────────────────────────────────────────────
  if (editor.kind === "dropdown-int") {
    if (entryType !== "int") return null;
    const current = value.intValue ?? editor.options[0]?.value ?? 0;
    return (
      <select
        disabled={disabled}
        value={current}
        onChange={(e) =>
          onEdit({
            type: "int",
            intValue: Number.parseInt(e.target.value, 10),
          })
        }
        className={`${baseCls} w-[220px] rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 text-[hsl(var(--foreground))]`}
      >
        {editor.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label} ({opt.value})
          </option>
        ))}
      </select>
    );
  }

  // ── string dropdown ─────────────────────────────────────────────
  if (editor.kind === "dropdown-string") {
    if (entryType !== "string") return null;
    const current = value.stringValue ?? editor.options[0]?.value ?? "";
    return (
      <select
        disabled={disabled}
        value={current}
        onChange={(e) =>
          onEdit({ type: "string", stringValue: e.target.value })
        }
        className={`${baseCls} w-[220px] rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 text-[hsl(var(--foreground))]`}
      >
        {editor.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  return null;
}

function EntryEditor({ entry, value, disabled, onEdit }: EntryEditorProps) {
  // Before falling through to the raw editor, check for a curated
  // semantic in `vrcSettingsSemantics.ts`. We only honour the semantic
  // when its `kind` matches the entry's underlying storage type — a
  // mismatch (e.g. someone listed an int key with a float slider)
  // quietly falls back to the raw editor rather than writing the wrong
  // numeric type to the registry.
  const semantic = getSemantic(entry.key);
  if (semantic) {
    const widget = renderSemanticEditor(
      semantic.editor,
      entry.type,
      value,
      disabled,
      onEdit,
    );
    if (widget) return widget;
  }

  if (entry.type === "bool") {
    const on = value.boolValue ?? false;
    return (
      <div className="inline-flex items-center overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))]">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onEdit({ type: "bool", boolValue: false })}
          className={
            "px-3 py-1 text-[11px] font-medium transition-colors " +
            (!on
              ? "bg-[hsl(var(--surface-bright))] text-[hsl(var(--foreground))]"
              : "bg-[hsl(var(--canvas))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]") +
            (disabled ? " opacity-50" : "")
          }
        >
          OFF
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onEdit({ type: "bool", boolValue: true })}
          className={
            "border-l border-[hsl(var(--border-strong))] px-3 py-1 text-[11px] font-medium transition-colors " +
            (on
              ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
              : "bg-[hsl(var(--canvas))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]") +
            (disabled ? " opacity-50" : "")
          }
        >
          ON
        </button>
      </div>
    );
  }

  if (entry.type === "int") {
    return (
      <Input
        type="number"
        inputMode="numeric"
        step={1}
        disabled={disabled}
        className="h-7 w-[140px] font-mono text-[12px]"
        value={String(value.intValue ?? 0)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "" || raw === "-") {
            onEdit({ type: "int", intValue: 0 });
            return;
          }
          const parsed = Number.parseInt(raw, 10);
          if (Number.isFinite(parsed)) {
            onEdit({ type: "int", intValue: parsed });
          }
        }}
      />
    );
  }

  if (entry.type === "float") {
    return (
      <Input
        type="number"
        inputMode="decimal"
        step="any"
        disabled={disabled}
        className="h-7 w-[140px] font-mono text-[12px]"
        value={String(value.floatValue ?? 0)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "" || raw === "-" || raw === ".") {
            onEdit({ type: "float", floatValue: 0 });
            return;
          }
          const parsed = Number.parseFloat(raw);
          if (Number.isFinite(parsed)) {
            onEdit({ type: "float", floatValue: parsed });
          }
        }}
      />
    );
  }

  if (entry.type === "string") {
    return (
      <Input
        type="text"
        disabled={disabled}
        className="h-7 w-[220px] font-mono text-[12px]"
        value={value.stringValue ?? ""}
        onChange={(e) => onEdit({ type: "string", stringValue: e.target.value })}
      />
    );
  }

  // raw — display only
  return (
    <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 py-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
      {hexBytes(entry.raw).slice(0, 48)}
      {(entry.raw?.length ?? 0) > 16 ? " …" : ""}
    </div>
  );
}
