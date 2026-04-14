import { useEffect, useMemo, useState } from "react";
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
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { formatBytes } from "@/lib/utils";
import type {
  CategorySummary,
  MigratePhase,
  MigratePlan,
  MigrateProgress,
  Report,
} from "@/lib/types";

type Step = 1 | 2 | 3 | 4;

const DEFAULT_TARGETS: Record<string, string> = {
  cache_windows_player: "D:\\VRChatCache\\Cache-WindowsPlayer",
  http_cache: "D:\\VRChatCache\\HTTPCache-WindowsPlayer",
  texture_cache: "D:\\VRChatCache\\TextureCache-WindowsPlayer",
};

function phaseLabel(phase: MigratePhase): string {
  switch (phase) {
    case "preflight":
      return "Preflight";
    case "copy":
      return "Copying files";
    case "verify":
      return "Verifying";
    case "remove":
      return "Removing source";
    case "junction":
      return "Creating junction";
    case "done":
      return "Done";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

function Migrate() {
  const [report, setReport] = useState<Report | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [categoryKey, setCategoryKey] = useState("cache_windows_player");
  const [target, setTarget] = useState(DEFAULT_TARGETS.cache_windows_player ?? "");
  const [plan, setPlan] = useState<MigratePlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [progress, setProgress] = useState<MigrateProgress | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let alive = true;
    ipc
      .scan()
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Scan failed: ${msg}`);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const off = ipc.on<MigrateProgress>("migrate.progress", (data) => {
      setProgress(data);
      if (data.phase === "done") {
        setRunning(false);
        toast.success(data.message ?? "Migration complete");
      } else if (data.phase === "error") {
        setRunning(false);
        toast.error(data.message ?? "Migration failed");
      }
    });
    return off;
  }, []);

  const migratable = useMemo<CategorySummary[]>(() => {
    if (!report) return [];
    return report.category_summaries.filter((c) =>
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

  const runPreflight = async () => {
    if (!selected) return;
    setPlanLoading(true);
    try {
      const res = await ipc.call<{ source: string; target: string }, MigratePlan>(
        "migrate.preflight",
        { source: selected.resolved_path, target },
      );
      setPlan(res);
      setStep(4);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Preflight failed: ${msg}`);
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
      toast.error(`Execute failed: ${msg}`);
    }
  };

  const pct = progress && progress.bytesTotal > 0
    ? Math.min(100, Math.round((progress.bytesDone / progress.bytesTotal) * 100))
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Migrate</h1>
          <p className="text-sm text-muted-foreground">
            Move a cache directory to another drive and replace it with a junction.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {[1, 2, 3, 4].map((n) => (
            <Badge
              key={n}
              variant={step === n ? "default" : "outline"}
              className="rounded-full"
            >
              Step {n}
            </Badge>
          ))}
        </div>
      </header>

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>1. Pick a category</CardTitle>
            <CardDescription>Select which VRChat cache to relocate.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 pt-0 md:grid-cols-3">
            {migratable.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => onPickCategory(c.key)}
                className={
                  "flex flex-col gap-1 rounded-md border p-4 text-left transition-colors " +
                  (categoryKey === c.key
                    ? "border-primary/70 bg-primary/10"
                    : "border-border/50 hover:bg-accent/40")
                }
              >
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.bytes_human}</span>
                <span className="text-xs text-muted-foreground">
                  {c.exists ? "present" : c.lexists ? "junction (broken)" : "missing"}
                </span>
              </button>
            ))}
          </CardContent>
          <CardFooter className="justify-end">
            <Button onClick={() => setStep(2)} disabled={!selected}>
              Next
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>2. Source and target</CardTitle>
            <CardDescription>
              Source is read-only. Pick a target directory on another drive.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Source</label>
              <input
                type="text"
                value={selected?.resolved_path ?? ""}
                readOnly
                className="h-9 rounded-md border border-border/50 bg-background/30 px-3 font-mono text-xs text-muted-foreground"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Target</label>
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="h-9 rounded-md border border-border/60 bg-background/40 px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="D:\VRChatCache\..."
              />
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button onClick={() => setStep(3)} disabled={!target.trim()}>
              Next
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle>3. Preflight</CardTitle>
            <CardDescription>
              Check disk space, junction state, and whether VRChat is running.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0 text-sm">
            <div className="rounded-md border border-border/40 bg-background/30 p-3 font-mono text-xs">
              <div>source: {selected?.resolved_path}</div>
              <div>target: {target}</div>
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button onClick={runPreflight} disabled={planLoading}>
              {planLoading ? "Checking…" : "Run preflight"}
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === 4 && plan ? (
        <Card>
          <CardHeader>
            <CardTitle>4. Execute</CardTitle>
            <CardDescription>
              Copy → verify → remove source → create junction.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-border/40 bg-background/30 p-3 text-xs">
                <div className="text-muted-foreground">source size</div>
                <div className="font-mono text-sm">{formatBytes(plan.sourceBytes)}</div>
              </div>
              <div className="rounded-md border border-border/40 bg-background/30 p-3 text-xs">
                <div className="text-muted-foreground">target free</div>
                <div className="font-mono text-sm">{formatBytes(plan.targetFreeBytes)}</div>
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
              <Badge variant="success">no blockers</Badge>
            )}

            <Separator />

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{progress ? phaseLabel(progress.phase) : "Idle"}</span>
                <span>
                  {progress
                    ? `${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)}`
                    : ""}
                </span>
              </div>
              <Progress value={pct} />
              <div className="text-xs text-muted-foreground">
                {progress ? `${progress.filesDone} files processed` : ""}
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
              Back
            </Button>
            <Button
              onClick={execute}
              disabled={running || plan.blockers.length > 0}
            >
              {running ? "Running…" : "Execute migration"}
            </Button>
          </CardFooter>
        </Card>
      ) : null}
    </div>
  );
}

export default Migrate;
