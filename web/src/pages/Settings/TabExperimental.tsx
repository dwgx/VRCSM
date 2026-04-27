import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EXPERIMENTAL_FLAGS,
  FLAG_AVATAR_VISUAL_SEARCH,
  useExperimentalFlag,
} from "@/lib/experimental";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ipc } from "@/lib/ipc";
import {
  ensureEmbeddingPipeline,
  embedImage,
  MODEL_VERSION,
} from "@/lib/avatar-embedding";
import { VisualSearchDialog } from "@/components/VisualSearchDialog";

function ToggleRow({
  flag,
}: {
  flag: (typeof EXPERIMENTAL_FLAGS)[number];
}) {
  const { t } = useTranslation();
  const [value, setValue] = useExperimentalFlag(flag.key);
  return (
    <div className="unity-panel border border-[hsl(var(--border))] p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[12px] font-medium">{t(flag.nameKey)}</div>
          <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
            {t(flag.descriptionKey)}
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
          <span className="font-mono text-[11px] uppercase tracking-wider">
            {value
              ? t("settings.experimental.toggleOn", { defaultValue: "ON" })
              : t("settings.experimental.toggleOff", { defaultValue: "OFF" })}
          </span>
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => setValue(e.target.checked)}
            className={cn(
              "w-4 h-4 cursor-pointer",
              "border border-[hsl(var(--border-strong))]",
            )}
          />
        </label>
      </div>
      {flag.warningKey && (
        <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] font-mono border-l-2 border-[hsl(var(--warning,var(--border-strong)))] pl-2">
          ⚠ {t(flag.warningKey)}
        </div>
      )}
    </div>
  );
}

function VisualSearchPanel() {
  const { t } = useTranslation();
  const [enabled] = useExperimentalFlag(FLAG_AVATAR_VISUAL_SEARCH);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null;

  async function rebuildIndex() {
    setIndexing(true);
    setError(null);
    setLastRun(null);
    setProgress(0);
    setStage(t("settings.experimental.visualSearch.stageLoadingModel"));
    try {
      await ensureEmbeddingPipeline({
        onProgress: (pct, label) => {
          // Reserve first 20% of the bar for model load; the remaining
          // 80% is the per-avatar embed loop below.
          setProgress(pct * 0.2);
          setStage(label);
        },
      });

      setStage(t("settings.experimental.visualSearch.stageEnumerating"));
      const { avatar_ids } = await ipc.vectorGetUnindexed();
      if (avatar_ids.length === 0) {
        setStage(t("settings.experimental.visualSearch.stageNothingToIndex"));
        setProgress(100);
        setLastRun(
          t("settings.experimental.visualSearch.noUnindexed", {
            time: new Date().toLocaleTimeString(),
          }),
        );
        return;
      }

      // Fetch thumbnail URLs for everything in one batch so we can parallelise
      // network I/O cheaply while embedding is sequential on CPU.
      setStage(
        t("settings.experimental.visualSearch.stageResolvingThumbs", {
          count: avatar_ids.length,
        }),
      );
      const thumbs = await ipc.call<
        { ids: string[]; downloadImages?: boolean },
        { results: { id: string; url: string | null; localUrl?: string | null; error: string | null }[] }
      >("thumbnails.fetch", { ids: avatar_ids, downloadImages: true });

      let done = 0;
      let failed = 0;
      for (const item of thumbs.results) {
        try {
          const imageUrl = item.localUrl ?? item.url;
          if (!imageUrl) throw new Error(item.error ?? "no thumbnail");
          const vec = await embedImage(imageUrl);
          await ipc.vectorUpsertEmbedding({
            avatar_id: item.id,
            embedding: Array.from(vec),
            model_version: MODEL_VERSION,
          });
        } catch (e) {
          failed += 1;
          console.warn(`[visual-search] embed failed for ${item.id}`, e);
        }
        done += 1;
        setProgress(20 + (done / thumbs.results.length) * 80);
        setStage(
          failed
            ? t("settings.experimental.visualSearch.embedProgressSkipped", {
                done,
                total: thumbs.results.length,
                skipped: failed,
              })
            : t("settings.experimental.visualSearch.embedProgress", {
                done,
                total: thumbs.results.length,
              }),
        );
      }
      setLastRun(
        failed
          ? t("settings.experimental.visualSearch.indexedSummarySkipped", {
              count: done - failed,
              skipped: failed,
              time: new Date().toLocaleTimeString(),
            })
          : t("settings.experimental.visualSearch.indexedSummary", {
              count: done - failed,
              time: new Date().toLocaleTimeString(),
            }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIndexing(false);
    }
  }

  return (
    <div className="unity-panel border border-[hsl(var(--border))] p-3 flex flex-col gap-3">
      <div className="font-mono text-[12px] font-medium">
        {t("settings.experimental.visualSearch.title")}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
          {t("settings.experimental.visualSearch.openSearch")}
        </Button>
        <Button variant="outline" size="sm" onClick={rebuildIndex} disabled={indexing}>
          {indexing
            ? t("settings.experimental.visualSearch.indexing")
            : t("settings.experimental.visualSearch.rebuildIndex")}
        </Button>
      </div>
      {indexing && (
        <div className="flex flex-col gap-1">
          <Progress value={progress} />
          <p className="text-[10.5px] text-[hsl(var(--muted-foreground))] font-mono">
            {stage}
          </p>
        </div>
      )}
      {lastRun && !indexing && (
        <p className="text-[10.5px] text-[hsl(var(--muted-foreground))] font-mono">
          {lastRun}
        </p>
      )}
      {error && (
        <p className="text-[10.5px] text-[hsl(var(--destructive,red))] font-mono">
          {error}
        </p>
      )}
      <VisualSearchDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

export function TabExperimental() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="unity-panel-header">
        {t("settings.experimental.heading", { defaultValue: "Experimental Features" })}
      </div>
      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
        {t("settings.experimental.blurb", {
          defaultValue:
            "These features are in active development. Expect rough edges, unexpected resource usage, and occasional breakage. They can be turned off anytime — state persists locally.",
        })}
      </p>
      <div className="flex flex-col gap-2">
        {EXPERIMENTAL_FLAGS.map((flag) => (
          <ToggleRow key={flag.key} flag={flag} />
        ))}
      </div>
      <VisualSearchPanel />
    </div>
  );
}
