import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  HardDrive,
  Link2,
  Loader2,
  Play,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { cn, formatBytes } from "@/lib/utils";
import { useReport } from "@/lib/report-context";
import type {
  CategorySummary,
  MigratePhase,
  MigratePlan,
  MigrateProgress,
} from "@/lib/types";

/* ================================================================== */
/*  Constants                                                         */
/* ================================================================== */

const TARGET_FOLDER_NAMES: Record<string, string> = {
  cache_windows_player: "Cache-WindowsPlayer",
  http_cache: "HTTPCache-WindowsPlayer",
  texture_cache: "TextureCache-WindowsPlayer",
};

function suggestTargetPath(category?: Pick<CategorySummary, "key" | "resolved_path">) {
  if (!category) return "";

  const folderName = TARGET_FOLDER_NAMES[category.key];
  if (!folderName) return "";

  const driveMatch = category.resolved_path.match(/^[A-Za-z]:/);
  if (driveMatch) {
    return `${driveMatch[0]}\\VRChatCache\\${folderName}`;
  }

  return `VRChatCache\\${folderName}`;
}

/* ================================================================== */
/*  Main Component                                                    */
/* ================================================================== */

function Migrate() {
  const { t } = useTranslation();
  const { report } = useReport();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Category / target state ─────────────────────────────────────
  const [categoryKey, setCategoryKey] = useState("cache_windows_player");
  const [target, setTarget] = useState("");

  // ── Preflight & plan ────────────────────────────────────────────
  const [plan, setPlan] = useState<MigratePlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  // ── Migration progress ──────────────────────────────────────────
  const [progress, setProgress] = useState<MigrateProgress | null>(null);
  const [running, setRunning] = useState(false);

  // ── Junction repair ─────────────────────────────────────────────
  const [repairing, setRepairing] = useState(false);

  // ── Advanced options ────────────────────────────────────────────
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Hydrate from query param (e.g. Dashboard "Repair" button) ──
  const prefilled = useRef(false);

  /* ─── Derived data ──────────────────────────────────────────────── */

  const migratable = useMemo<CategorySummary[]>(() => {
    if (!report) return [];
    return report.category_summaries.filter(
      (c) =>
        c.key === "cache_windows_player" ||
        c.key === "http_cache" ||
        c.key === "texture_cache",
    );
  }, [report]);

  const selected = useMemo<CategorySummary | undefined>(
    () => migratable.find((c) => c.key === categoryKey),
    [migratable, categoryKey],
  );

  const pct =
    progress && progress.bytesTotal > 0
      ? Math.min(
          100,
          Math.round((progress.bytesDone / progress.bytesTotal) * 100),
        )
      : 0;

  const hasBlockers =
    plan !== null && (plan.blockers.length > 0 || plan.vrcRunning);

  /* ─── Helpers ───────────────────────────────────────────────────── */

  const phaseLabel = useCallback(
    (phase: MigratePhase): string => {
      const key = `migrate.phase.${phase}`;
      return t(key, { defaultValue: phase });
    },
    [t],
  );

  const onPickCategory = useCallback(
    (key: string) => {
      setCategoryKey(key);
      const next = migratable.find((item) => item.key === key);
      setTarget(suggestTargetPath(next));
      setPlan(null);
      setProgress(null);
    },
    [migratable],
  );

  /* ─── Hydrate from ?category=... ────────────────────────────────── */

  useEffect(() => {
    if (prefilled.current) return;
    if (!report) return;
    const cat = searchParams.get("category");
    if (cat && TARGET_FOLDER_NAMES[cat]) {
      onPickCategory(cat);
    }
    prefilled.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete("category");
    setSearchParams(next, { replace: true });
  }, [report, searchParams, setSearchParams, onPickCategory]);

  useEffect(() => {
    if (target.trim()) return;
    setTarget(suggestTargetPath(selected));
  }, [selected, target]);

  /* ─── Progress event subscription ───────────────────────────────── */

  useEffect(() => {
    const off = ipc.on<MigrateProgress>("migrate.progress", (data) => {
      setProgress(data);
      if (data.phase === "done") {
        setRunning(false);
        toast.success(
          data.message ??
            t("migrate.complete", { defaultValue: "Migration complete" }),
        );
      } else if (data.phase === "error") {
        setRunning(false);
        toast.error(
          data.message ??
            t("migrate.failed", { defaultValue: "Migration failed" }),
        );
      }
    });
    return off;
  }, [t]);

  /* ─── IPC actions ───────────────────────────────────────────────── */

  const browseTarget = async () => {
    try {
      const res = await ipc.pickFolder({
        title: t("migrate.target", { defaultValue: "Target" }),
        initialDir: target,
      });
      if (res.cancelled || !res.path) {
        toast.info(
          t("migrate.browseCancelled", {
            defaultValue: "No folder selected",
          }),
        );
        return;
      }
      setTarget(res.path);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(
        `${t("migrate.browseError", { defaultValue: "Folder picker not available" })}: ${msg}`,
      );
    }
  };

  const migrateOneClick = async () => {
    if (!selected || !target.trim()) return;
    setPlanLoading(true);
    setProgress(null);
    setPlan(null);
    try {
      const res = await ipc.call<
        { source: string; target: string },
        MigratePlan
      >("migrate.preflight", { source: selected.resolved_path, target });
      setPlan(res);
      if (res.sourceIsJunction) {
        setPlanLoading(false);
        return;
      }
      if (res.vrcRunning || res.blockers.length > 0) {
        setPlanLoading(false);
        return;
      }
      setPlanLoading(false);
      setRunning(true);
      setProgress({ phase: "copy", bytesDone: 0, bytesTotal: res.sourceBytes, filesDone: 0, filesTotal: 0 });
      await ipc.call<{ source: string; target: string }, { ok: true }>(
        "migrate.execute",
        { source: res.source, target: res.target },
      );
    } catch (e: unknown) {
      setRunning(false);
      setPlanLoading(false);
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("migrate.executeFailed", { error: msg, defaultValue: "Migration failed: {{error}}" }));
    }
  };

  const repairJunction = async () => {
    if (!selected) return;
    setRepairing(true);
    try {
      await ipc.call<{ source: string; target: string }, { ok: true }>(
        "junction.repair",
        { source: selected.resolved_path, target },
      );
      toast.success(
        t("migrate.repairSuccess", {
          defaultValue: "Junction repaired successfully",
        }),
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(
        t("migrate.repairFailed", {
          error: msg,
          defaultValue: "Repair failed: {{error}}",
        }),
      );
    } finally {
      setRepairing(false);
    }
  };

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {/* ─── Header ──────────────────────────────────────────── */}
      <header className="flex items-center gap-2">
        <div className="unity-panel-header inline-flex items-center gap-2 border-0 bg-transparent px-0 py-0 normal-case tracking-normal">
          <span className="text-[11px] uppercase tracking-[0.08em]">
            {t("migrate.title", { defaultValue: "Migrate" })}
          </span>
        </div>
        <span className="h-[11px] w-px bg-[hsl(var(--border-strong))]" />
        <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("migrate.subtitle", {
            defaultValue:
              "Move a cache directory to another drive and replace it with a junction.",
          })}
        </span>
      </header>

      {/* ─── Category selector ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("migrate.selectCategory", {
              defaultValue: "Cache category",
            })}
          </CardTitle>
          <CardDescription>
            {t("migrate.selectCategoryDesc", {
              defaultValue:
                "Select which VRChat cache directory to migrate to another drive.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pt-0 md:grid-cols-3">
          {migratable.map((c) => {
            const isJunction = c.lexists && !c.exists;
            const state = c.exists
              ? t("migrate.present", { defaultValue: "present" })
              : isJunction
                ? t("migrate.brokenJunction", {
                    defaultValue: "junction (broken)",
                  })
                : t("migrate.missing", { defaultValue: "missing" });
            const active = categoryKey === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => onPickCategory(c.key)}
                className={cn(
                  "flex flex-col gap-1.5 rounded-[var(--radius-md)] border p-4 text-left transition-colors",
                  active
                    ? "border-[hsl(var(--primary)/0.6)] bg-[color-mix(in_srgb,hsl(var(--primary))_12%,transparent)]"
                    : "border-[hsl(var(--border)/0.7)] bg-[hsl(var(--surface)/0.4)] hover:bg-[hsl(var(--surface-raised)/0.6)]",
                )}
              >
                <div className="flex items-center gap-2">
                  <HardDrive
                    className={cn(
                      "size-4",
                      active
                        ? "text-[hsl(var(--primary))]"
                        : "text-[hsl(var(--muted-foreground))]",
                    )}
                  />
                  <span
                    className={cn(
                      "text-[12px] font-medium",
                      active
                        ? "text-[hsl(var(--primary))]"
                        : "text-[hsl(var(--foreground))]",
                    )}
                  >
                    {c.name}
                  </span>
                </div>
                <span className="text-[12px] font-mono text-[hsl(var(--muted-foreground))]">
                  {c.bytes_human}
                  <span className="ml-2 text-[10px]">
                    ({c.file_count}{" "}
                    {t("migrate.files", { defaultValue: "files" })})
                  </span>
                </span>
                <Badge
                  variant={
                    c.exists ? "success" : isJunction ? "warning" : "muted"
                  }
                  className="mt-0.5 w-fit text-[10px]"
                >
                  {state}
                </Badge>
              </button>
            );
          })}
          {migratable.length === 0 ? (
            <div className="col-span-3 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-4 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("migrate.noCategories", {
                defaultValue: "Scanning... no migratable categories found yet.",
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ─── Source & Target ─────────────────────────────────── */}
      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {t("migrate.pathConfig", {
                defaultValue: "Source & target",
              })}
            </CardTitle>
            <CardDescription>
              {t("migrate.pathConfigDesc", {
                defaultValue:
                  "Source is the current cache location. Pick or type a target on another drive.",
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            {/* Source (read-only) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                {t("migrate.source", { defaultValue: "Source" })}
              </label>
              <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2">
                <span className="flex-1 truncate font-mono text-[12px] text-[hsl(var(--muted-foreground))]">
                  {selected.resolved_path}
                </span>
                <Badge variant="muted" className="shrink-0 font-mono text-[10px]">
                  {selected.bytes_human}
                </Badge>
              </div>
            </div>

            {/* Target (editable) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                {t("migrate.target", { defaultValue: "Target" })}
              </label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="flex-1 font-mono text-[12px]"
                  placeholder={t("migrate.targetPlaceholder", {
                    defaultValue: "X:\\VRChatCache\\...",
                  })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void browseTarget()}
                  className="shrink-0 gap-1.5"
                >
                  <FolderOpen className="size-3.5" />
                  {t("common.browse", { defaultValue: "Browse..." })}
                </Button>
              </div>
            </div>

            {/* Advanced options (collapsible) */}
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            >
              {showAdvanced ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              {t("migrate.advancedOptions", {
                defaultValue: "Advanced options",
              })}
            </button>

            {showAdvanced ? (
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-3">
                <div className="flex flex-col gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                  <p>
                    {t("migrate.advancedHint", {
                      defaultValue:
                        "The migration pipeline runs: preflight check, file copy, hash verification, source removal, and NTFS junction creation. All phases are mandatory for data safety.",
                    })}
                  </p>
                  <div className="flex flex-col gap-1 font-mono text-[10px]">
                    <div>
                      <span className="text-[hsl(var(--muted-foreground))]">
                        source:{" "}
                      </span>
                      <span className="text-[hsl(var(--foreground))]">
                        {selected.resolved_path}
                      </span>
                    </div>
                    <div>
                      <span className="text-[hsl(var(--muted-foreground))]">
                        target:{" "}
                      </span>
                      <span className="text-[hsl(var(--foreground))]">
                        {target || "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Junction state (source is already a junction) */}
            {plan?.sourceIsJunction ? (
              <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.08)] p-3">
                <Link2 className="size-4 shrink-0 text-[hsl(var(--warning))]" />
                <div className="flex-1 text-[12px]">
                  <div className="font-medium text-[hsl(var(--foreground))]">
                    {t("migrate.junctionState", { defaultValue: "Existing junction detected" })}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                    {t("migrate.pointsTo", { defaultValue: "points to" })}{" "}
                    {plan.target}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={repairing}
                  onClick={() => void repairJunction()}
                  className="shrink-0 gap-1.5"
                >
                  {repairing ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Wrench className="size-3" />
                  )}
                  {t("common.repair", { defaultValue: "Repair" })}
                </Button>
              </div>
            ) : null}

            {/* Inline blockers (auto-detected from preflight) */}
            {plan && !plan.sourceIsJunction && plan.vrcRunning ? (
              <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.45)] bg-[hsl(var(--destructive)/0.08)] p-3">
                <AlertTriangle className="size-4 shrink-0 text-[hsl(var(--destructive))]" />
                <span className="text-[12px] text-[hsl(var(--destructive))]">
                  {t("migrate.vrcRunningBlocker", {
                    defaultValue: "VRChat is running. Close it before migrating.",
                  })}
                </span>
              </div>
            ) : null}
            {plan && !plan.sourceIsJunction && plan.blockers.length > 0 ? (
              <div className="flex flex-col gap-2">
                {plan.blockers.map((b, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.45)] bg-[hsl(var(--destructive)/0.08)] p-3"
                  >
                    <ShieldAlert className="size-4 shrink-0 text-[hsl(var(--destructive))]" />
                    <span className="text-[12px] text-[hsl(var(--destructive))]">{b}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Preflight summary (inline, compact) */}
            {plan && !plan.sourceIsJunction && !hasBlockers ? (
              <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--success)/0.4)] bg-[hsl(var(--success)/0.08)] p-3">
                <Check className="size-4 shrink-0 text-[hsl(var(--success))]" />
                <span className="text-[12px] text-[hsl(var(--success))]">
                  {t("migrate.noBlockers", { defaultValue: "Ready to migrate." })}
                  {" "}
                  <span className="font-mono text-[10px]">
                    {formatBytes(plan.sourceBytes)} → {formatBytes(plan.targetFreeBytes)} {t("migrate.free", { defaultValue: "free" })}
                  </span>
                </span>
              </div>
            ) : null}

            {/* Progress (inline) */}
            {progress && progress.phase !== "idle" && progress.phase !== "done" && progress.phase !== "error" ? (
              <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-3">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-[hsl(var(--foreground))]">
                    {phaseLabel(progress.phase)}
                  </span>
                  <span className="font-mono text-[hsl(var(--muted-foreground))]">{pct}%</span>
                </div>
                <Progress value={pct} />
                <div className="flex items-center justify-between text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
                  <span>{formatBytes(progress.bytesDone)} / {formatBytes(progress.bytesTotal)}</span>
                  <span>
                    {progress.filesDone} {t("migrate.files", { defaultValue: "files" })}
                    {progress.filesTotal > 0 ? ` / ${progress.filesTotal}` : ""}
                  </span>
                </div>
                {progress.message ? (
                  <div className="truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{progress.message}</div>
                ) : null}
              </div>
            ) : null}

            {progress?.phase === "done" ? (
              <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--success)/0.4)] bg-[hsl(var(--success)/0.08)] p-3">
                <Check className="size-4 shrink-0 text-[hsl(var(--success))]" />
                <span className="text-[12px] font-medium text-[hsl(var(--success))]">
                  {t("migrate.complete", { defaultValue: "Migration complete" })}
                </span>
              </div>
            ) : null}
            {progress?.phase === "error" ? (
              <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.45)] bg-[hsl(var(--destructive)/0.08)] p-3">
                <AlertTriangle className="size-4 shrink-0 text-[hsl(var(--destructive))]" />
                <span className="text-[12px] text-[hsl(var(--destructive))]">
                  {progress.message ?? t("migrate.failed", { defaultValue: "Migration failed" })}
                </span>
              </div>
            ) : null}

            {/* Single migrate button */}
            <div className="flex items-center justify-end gap-2">
              <Button
                onClick={() => void migrateOneClick()}
                disabled={planLoading || !target.trim() || running}
                className="gap-1.5"
              >
                {planLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : running ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                {planLoading
                  ? t("migrate.checking", { defaultValue: "Checking..." })
                  : running
                    ? t("migrate.running", { defaultValue: "Migrating..." })
                    : t("migrate.execute", { defaultValue: "Migrate" })}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default Migrate;

/* ================================================================== */
/*  Subcomponents                                                     */
/* ================================================================== */
