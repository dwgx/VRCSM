import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { formatBytes } from "@/lib/utils";
import { useReport } from "@/lib/report-context";
import type {
  CategorySummary,
  MigratePhase,
  MigratePlan,
  MigrateProgress,
} from "@/lib/types";

type Step = 1 | 2 | 3 | 4;

const DEFAULT_TARGETS: Record<string, string> = {
  cache_windows_player: "D:\\VRChatCache\\Cache-WindowsPlayer",
  http_cache: "D:\\VRChatCache\\HTTPCache-WindowsPlayer",
  texture_cache: "D:\\VRChatCache\\TextureCache-WindowsPlayer",
};

function Migrate() {
  const { t } = useTranslation();
  const { report } = useReport();
  const [searchParams, setSearchParams] = useSearchParams();
  const [step, setStep] = useState<Step>(1);
  const [categoryKey, setCategoryKey] = useState("cache_windows_player");
  const [target, setTarget] = useState(
    DEFAULT_TARGETS.cache_windows_player ?? "",
  );
  const [plan, setPlan] = useState<MigratePlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [progress, setProgress] = useState<MigrateProgress | null>(null);
  const [running, setRunning] = useState(false);
  const prefilled = useRef(false);

  const phaseLabel = (phase: MigratePhase): string => {
    switch (phase) {
      case "preflight":
        return t("migrate.phase.preflight");
      case "copy":
        return t("migrate.phase.copy");
      case "verify":
        return t("migrate.phase.verify");
      case "remove":
        return t("migrate.phase.remove");
      case "junction":
        return t("migrate.phase.junction");
      case "done":
        return t("migrate.phase.done");
      case "error":
        return t("migrate.phase.error");
      default:
        return t("common.idle");
    }
  };

  useEffect(() => {
    const off = ipc.on<MigrateProgress>("migrate.progress", (data) => {
      setProgress(data);
      if (data.phase === "done") {
        setRunning(false);
        toast.success(data.message ?? t("migrate.complete"));
      } else if (data.phase === "error") {
        setRunning(false);
        toast.error(data.message ?? t("migrate.failed"));
      }
    });
    return off;
  }, [t]);

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

  const onPickCategory = (key: string) => {
    setCategoryKey(key);
    const next = DEFAULT_TARGETS[key];
    if (next) setTarget(next);
    setPlan(null);
    setProgress(null);
  };

  // Hydrate from ?category=... — routed here by Dashboard "Repair" button when
  // a broken junction needs a fresh target path. Runs once report is ready so
  // the category actually exists in `migratable`.
  useEffect(() => {
    if (prefilled.current) return;
    if (!report) return;
    const cat = searchParams.get("category");
    if (!cat) {
      prefilled.current = true;
      return;
    }
    if (DEFAULT_TARGETS[cat]) {
      onPickCategory(cat);
      setStep(2);
    }
    prefilled.current = true;
    // Strip the query param so a later rescan/navigation doesn't re-trigger.
    const next = new URLSearchParams(searchParams);
    next.delete("category");
    setSearchParams(next, { replace: true });
  }, [report, searchParams, setSearchParams]);

  const browseTarget = async () => {
    try {
      const res = await ipc.pickFolder({
        title: t("migrate.target"),
        initialDir: target,
      });
      if (res.cancelled || !res.path) {
        toast.info(t("migrate.browseCancelled"));
        return;
      }
      setTarget(res.path);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`${t("migrate.browseError")}: ${msg}`);
    }
  };

  const runPreflight = async () => {
    if (!selected) return;
    setPlanLoading(true);
    try {
      const res = await ipc.call<
        { source: string; target: string },
        MigratePlan
      >("migrate.preflight", { source: selected.resolved_path, target });
      setPlan(res);
      setStep(4);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("migrate.preflightFailed", { error: msg }));
    } finally {
      setPlanLoading(false);
    }
  };

  const execute = async () => {
    if (!plan) return;
    setRunning(true);
    setProgress({
      phase: "copy",
      bytesDone: 0,
      bytesTotal: plan.sourceBytes,
      filesDone: 0,
      filesTotal: 0,
    });
    try {
      await ipc.call<{ source: string; target: string }, { ok: true }>(
        "migrate.execute",
        { source: plan.source, target: plan.target },
      );
    } catch (e: unknown) {
      setRunning(false);
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("migrate.executeFailed", { error: msg }));
    }
  };

  const pct =
    progress && progress.bytesTotal > 0
      ? Math.min(100, Math.round((progress.bytesDone / progress.bytesTotal) * 100))
      : 0;

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold tracking-tight">
              {t("migrate.title")}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              wizard
            </span>
          </div>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {t("migrate.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4].map((n) => (
            <Badge
              key={n}
              variant={step === n ? "default" : step > n ? "tonal" : "outline"}
              className="min-w-12 justify-center text-[9px] uppercase tracking-wider"
            >
              {t("migrate.step", { n })}
            </Badge>
          ))}
        </div>
      </header>

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("migrate.step1Title")}</CardTitle>
            <CardDescription>{t("migrate.step1Desc")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 pt-0 md:grid-cols-3">
            {migratable.map((c) => {
              const state = c.exists
                ? t("migrate.present")
                : c.lexists
                  ? t("migrate.brokenJunction")
                  : t("migrate.missing");
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onPickCategory(c.key)}
                  className={
                    "m3-state-layer flex flex-col gap-1.5 rounded-[var(--radius-md)] border p-4 text-left transition-colors " +
                    (categoryKey === c.key
                      ? "border-[hsl(var(--primary)/0.6)] bg-[color-mix(in_srgb,hsl(var(--primary))_16%,transparent)] text-[hsl(var(--primary))]"
                      : "border-[hsl(var(--border)/0.7)] bg-[hsl(var(--surface)/0.4)] hover:bg-[hsl(var(--surface-raised)/0.6)]")
                  }
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    {c.bytes_human}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    {state}
                  </span>
                </button>
              );
            })}
          </CardContent>
          <CardFooter className="justify-end">
            <Button onClick={() => setStep(2)} disabled={!selected}>
              {t("common.next")}
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("migrate.step2Title")}</CardTitle>
            <CardDescription>{t("migrate.step2Desc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                {t("migrate.source")}
              </label>
              <Input
                type="text"
                value={selected?.resolved_path ?? ""}
                readOnly
                className="font-mono text-xs text-[hsl(var(--muted-foreground))]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                {t("migrate.target")}
              </label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="font-mono text-xs"
                  placeholder={t("migrate.targetPlaceholder")}
                />
                <Button
                  type="button"
                  variant="tonal"
                  onClick={browseTarget}
                  className="shrink-0"
                >
                  <FolderOpen className="size-[18px]" />
                  {t("common.browse")}
                </Button>
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              {t("common.back")}
            </Button>
            <Button onClick={() => setStep(3)} disabled={!target.trim()}>
              {t("common.next")}
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("migrate.step3Title")}</CardTitle>
            <CardDescription>{t("migrate.step3Desc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0 text-sm">
            <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--canvas)/0.6)] p-4 font-mono text-[11px] leading-relaxed">
              <div>
                <span className="text-[hsl(var(--muted-foreground))]">
                  source:{" "}
                </span>
                {selected?.resolved_path}
              </div>
              <div>
                <span className="text-[hsl(var(--muted-foreground))]">
                  target:{" "}
                </span>
                {target}
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              {t("common.back")}
            </Button>
            <Button onClick={runPreflight} disabled={planLoading}>
              {planLoading ? t("migrate.checking") : t("migrate.runPreflight")}
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === 4 && plan ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("migrate.step4Title")}</CardTitle>
            <CardDescription>{t("migrate.step4Desc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--canvas)/0.5)] p-4 text-xs">
                <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                  {t("migrate.sourceBytes")}
                </div>
                <div className="mt-1 font-mono text-[15px] text-[hsl(var(--foreground))]">
                  {formatBytes(plan.sourceBytes)}
                </div>
              </div>
              <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--canvas)/0.5)] p-4 text-xs">
                <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                  {t("migrate.targetFree")}
                </div>
                <div className="mt-1 font-mono text-[15px] text-[hsl(var(--foreground))]">
                  {formatBytes(plan.targetFreeBytes)}
                </div>
              </div>
            </div>

            {plan.blockers.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {plan.blockers.map((b, i) => (
                  <Badge key={i} variant="destructive">
                    {b}
                  </Badge>
                ))}
              </div>
            ) : (
              <Badge variant="success">{t("migrate.noBlockers")}</Badge>
            )}

            <Separator />

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
                <span>{progress ? phaseLabel(progress.phase) : t("common.idle")}</span>
                <span className="font-mono">
                  {progress
                    ? `${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)}`
                    : ""}
                </span>
              </div>
              <Progress value={pct} />
              <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
                {progress
                  ? t("migrate.filesProcessed", { count: progress.filesDone })
                  : ""}
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button
              variant="outline"
              onClick={() => {
                setStep(3);
                setPlan(null);
                setProgress(null);
              }}
              disabled={running}
            >
              {t("common.back")}
            </Button>
            <Button onClick={execute} disabled={running || plan.blockers.length > 0}>
              {running ? t("migrate.running") : t("migrate.execute")}
            </Button>
          </CardFooter>
        </Card>
      ) : null}
    </div>
  );
}

export default Migrate;
