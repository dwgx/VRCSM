import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, ExternalLink, RefreshCw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ipc } from "@/lib/ipc";
import {
  checkUpdate,
  downloadUpdate,
  formatBytes,
  installUpdate,
  onUpdateProgress,
  skipVersion,
  type UpdateCheckResult,
  type UpdateProgressEvent,
} from "@/lib/update";

export interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fetched result — skips the initial check call. */
  initial?: UpdateCheckResult | null;
}

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; info: UpdateCheckResult }
  | { kind: "downloading"; info: UpdateCheckResult; progress: UpdateProgressEvent }
  | { kind: "ready"; info: UpdateCheckResult; msiPath: string }
  | { kind: "up_to_date"; info: UpdateCheckResult }
  | { kind: "error"; message: string };

export function UpdateDialog({ open, onOpenChange, initial }: UpdateDialogProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>(() =>
    initial
      ? initial.available
        ? initial.currentMsiPath
          ? { kind: "ready", info: initial, msiPath: initial.currentMsiPath }
          : { kind: "available", info: initial }
        : { kind: "up_to_date", info: initial }
      : { kind: "idle" },
  );

  useEffect(() => {
    if (!open) return;
    if (phase.kind !== "idle") return;
    let cancelled = false;
    setPhase({ kind: "checking" });
    checkUpdate(false)
      .then((info) => {
        if (cancelled) return;
        if (info.currentMsiPath) {
          setPhase({ kind: "ready", info, msiPath: info.currentMsiPath });
        } else if (info.available) {
          setPhase({ kind: "available", info });
        } else {
          setPhase({ kind: "up_to_date", info });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [open, phase.kind]);

  useEffect(() => {
    return onUpdateProgress((event) => {
      setPhase((current) => {
        if (current.kind !== "downloading") return current;
        if (event.phase === "done") {
          // The actual path comes back via the download promise resolution;
          // keep the downloading phase until download() resolves and we can
          // set kind:"ready" with the real path.
          return { ...current, progress: event };
        }
        return { ...current, progress: event };
      });
    });
  }, []);

  const percentDone = useMemo(() => {
    if (phase.kind !== "downloading") return 0;
    const { done, total } = phase.progress;
    if (!total) return 0;
    return Math.min(100, Math.round((done / total) * 100));
  }, [phase]);

  async function handleDownload() {
    if (phase.kind !== "available") return;
    const { info } = phase;
    if (!info.downloadUrl || !info.latest) return;
    setPhase({
      kind: "downloading",
      info,
      progress: { done: 0, total: info.size ?? 0, phase: "download" },
    });
    try {
      const res = await downloadUpdate({
        url: info.downloadUrl,
        size: info.size ?? 0,
        sha256: info.sha256 ?? null,
        version: info.latest,
      });
      setPhase({ kind: "ready", info, msiPath: res.path });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("update.downloadFailed", { defaultValue: "Download failed: {{msg}}", msg }));
      setPhase({ kind: "available", info });
    }
  }

  async function handleInstall() {
    if (phase.kind !== "ready") return;
    try {
      await installUpdate(phase.msiPath);
      // Window will close imminently as the C++ side posts WM_QUIT.
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("update.installFailed", { defaultValue: "Install failed: {{msg}}", msg }));
    }
  }

  async function handleSkip() {
    if (phase.kind !== "available" && phase.kind !== "ready") return;
    const version = phase.info.latest;
    if (!version) return;
    try {
      await skipVersion(version);
      toast.success(t("update.skipped", { defaultValue: "Skipped version {{version}}", version }));
      onOpenChange(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("update.skipFailed", { defaultValue: "Failed to skip: {{msg}}", msg }));
    }
  }

  function handleOpenReleasePage() {
    if (phase.kind === "available" || phase.kind === "ready" || phase.kind === "downloading" || phase.kind === "up_to_date") {
      const url = phase.info.releaseUrl;
      if (url) void ipc.call("shell.openUrl", { url });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => {
      // Block close while download is active to avoid orphaning the stream.
      if (!o && phase.kind === "downloading") return;
      onOpenChange(o);
    }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="size-4 text-[hsl(var(--primary))]" />
            {t("update.title", { defaultValue: "VRCSM Update" })}
          </DialogTitle>
          <DialogDescription>
            {renderDescription()}
          </DialogDescription>
        </DialogHeader>

        {/* Body */}
        {phase.kind === "available" || phase.kind === "downloading" || phase.kind === "ready" ? (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-[hsl(var(--muted-foreground))]">
                {t("update.currentLabel", { defaultValue: "Current" })}
              </span>
              <code className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                {phase.info.current}
              </code>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-medium text-[hsl(var(--primary))]">
                {t("update.latestLabel", { defaultValue: "Available" })}
              </span>
              <code className="font-mono text-[11px] font-semibold text-[hsl(var(--primary))]">
                {phase.info.latest ?? "—"}
              </code>
            </div>
            {phase.info.size ? (
              <div className="flex items-center justify-between text-[11px] text-[hsl(var(--muted-foreground))]">
                <span>{t("update.sizeLabel", { defaultValue: "Download size" })}</span>
                <span className="font-mono">{formatBytes(phase.info.size)}</span>
              </div>
            ) : null}
            {phase.kind === "downloading" ? (
              <div className="flex flex-col gap-1 pt-1">
                <Progress value={percentDone} />
                <div className="flex items-center justify-between text-[10.5px] text-[hsl(var(--muted-foreground))]">
                  <span>
                    {phase.progress.phase === "verify"
                      ? t("update.verifying", { defaultValue: "Verifying SHA-256…" })
                      : t("update.downloading", {
                          defaultValue: "Downloading {{done}} / {{total}}",
                          done: formatBytes(phase.progress.done),
                          total: formatBytes(phase.progress.total || phase.info.size || 0),
                        })}
                  </span>
                  <span className="font-mono tabular-nums">{percentDone}%</span>
                </div>
              </div>
            ) : null}
            {phase.info.releaseNotes ? (
              <div className="max-h-[180px] overflow-y-auto rounded border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-2 text-[11px] whitespace-pre-wrap leading-relaxed text-[hsl(var(--muted-foreground))]">
                {phase.info.releaseNotes}
              </div>
            ) : null}
          </div>
        ) : phase.kind === "error" ? (
          <div className="rounded border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.08)] px-3 py-2 text-[12px] text-[hsl(var(--destructive))]">
            {phase.message}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          {(phase.kind === "available" || phase.kind === "ready") && phase.info.releaseUrl ? (
            <Button variant="ghost" size="sm" onClick={handleOpenReleasePage}>
              <ExternalLink className="size-3.5" />
              {t("update.viewNotes", { defaultValue: "Release notes" })}
            </Button>
          ) : null}
          {(phase.kind === "available" || phase.kind === "ready") && phase.info.latest ? (
            <Button variant="outline" size="sm" onClick={handleSkip}>
              <SkipForward className="size-3.5" />
              {t("update.skip", { defaultValue: "Skip this version" })}
            </Button>
          ) : null}
          {phase.kind === "up_to_date" || phase.kind === "error" ? (
            <Button variant="outline" size="sm" onClick={() => setPhase({ kind: "idle" })}>
              <RefreshCw className="size-3.5" />
              {t("update.retry", { defaultValue: "Re-check" })}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={phase.kind === "downloading"}>
            {t("update.later", { defaultValue: "Later" })}
          </Button>
          {phase.kind === "available" ? (
            <Button variant="tonal" size="sm" onClick={handleDownload}>
              <Download className="size-3.5" />
              {t("update.download", { defaultValue: "Download & install" })}
            </Button>
          ) : null}
          {phase.kind === "ready" ? (
            <Button variant="tonal" size="sm" onClick={handleInstall}>
              <Download className="size-3.5" />
              {t("update.installNow", { defaultValue: "Install now (restart)" })}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  function renderDescription(): string {
    switch (phase.kind) {
      case "checking":
        return t("update.checking", { defaultValue: "Checking for updates…" });
      case "available":
        return t("update.availableDesc", {
          defaultValue: "A newer VRCSM is available. Install now or stay on the current version.",
        });
      case "ready":
        return t("update.readyDesc", {
          defaultValue: "The installer is downloaded and verified. Click Install to apply — VRCSM will restart.",
        });
      case "downloading":
        return t("update.downloadingDesc", {
          defaultValue: "Downloading — do not close VRCSM until this completes.",
        });
      case "up_to_date":
        return t("update.upToDateDesc", {
          defaultValue: "You're on the latest version.",
        });
      case "error":
        return t("update.errorDesc", {
          defaultValue: "Could not check for updates right now.",
        });
      default:
        return "";
    }
  }
}
