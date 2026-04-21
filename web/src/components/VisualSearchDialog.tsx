import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ipc } from "@/lib/ipc";
import {
  ensureEmbeddingPipeline,
  embedImage,
  MODEL_VERSION,
} from "@/lib/avatar-embedding";

type Match = { avatar_id: string; distance: number };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Drop / paste an image → CLIP embed → sqlite-vec k-NN search →
 * grid of matching avatar ids with similarity distances.
 *
 * MVP scope: uses already-indexed avatars only. If the index is empty
 * the user sees a "No indexed avatars yet — run Rebuild Index in
 * Settings" empty state. No thumbnails yet (v0.12) — results show ids
 * and open-in-browser links so users can cross-reference with VRChat's
 * web UI.
 */
export function VisualSearchDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const [image, setImage] = useState<string | null>(null); // data URL preview
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  // Reset transient state whenever the dialog reopens so stale results
  // from a previous search don't flash back in.
  useEffect(() => {
    if (open) {
      setImage(null);
      setImageBlob(null);
      setResults([]);
      setError(null);
      setBusy(false);
      setStage("");
      setProgress(0);
    }
  }, [open]);

  // Clipboard paste handler — active only while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            setImageFromBlob(blob);
            e.preventDefault();
          }
          break;
        }
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [open]);

  function setImageFromBlob(blob: Blob) {
    setImageBlob(blob);
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result as string);
    reader.readAsDataURL(blob);
    setResults([]);
    setError(null);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      setImageFromBlob(file);
    }
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      setImageFromBlob(file);
    }
  }

  async function runSearch() {
    if (!imageBlob) return;
    setBusy(true);
    setError(null);
    setResults([]);
    try {
      setStage(t("settings.experimental.visualSearch.stagePreparingModel"));
      await ensureEmbeddingPipeline({
        onProgress: (pct, label) => {
          setProgress(pct);
          setStage(label);
        },
      });
      setStage(t("settings.experimental.visualSearch.stageEmbedding"));
      setProgress(97);
      const vec = await embedImage(imageBlob);
      setStage(t("settings.experimental.visualSearch.stageSearching"));
      setProgress(98);
      const { matches } = await ipc.vectorSearch(Array.from(vec), 25);
      setResults(matches);
      setStage(t("settings.experimental.visualSearch.stageDone"));
      setProgress(100);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {t("settings.experimental.visualSearch.dialogTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Input area */}
          <div
            ref={dropRef}
            onDrop={onDrop}
            onDragOver={onDragOver}
            className="border-2 border-dashed rounded-lg p-6 flex items-center gap-4 min-h-[140px]"
          >
            {image ? (
              <img
                src={image}
                alt="query"
                className="w-24 h-24 object-cover rounded border"
              />
            ) : (
              <div className="w-24 h-24 rounded border bg-[hsl(var(--muted))] flex items-center justify-center text-[hsl(var(--muted-foreground))] text-[10px]">
                {t("settings.experimental.visualSearch.noImage")}
              </div>
            )}
            <div className="flex-1 flex flex-col gap-2 min-w-0">
              <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
                {t("settings.experimental.visualSearch.dropPrompt")}
              </p>
              <label className="inline-flex items-center gap-2 cursor-pointer text-[12px] font-mono">
                <input type="file" accept="image/*" className="hidden" onChange={onFilePick} />
                <span className="underline">
                  {t("settings.experimental.visualSearch.chooseFile")}
                </span>
              </label>
              <p className="text-[10.5px] text-[hsl(var(--muted-foreground))] font-mono">
                {t("settings.experimental.visualSearch.modelFooter", {
                  version: MODEL_VERSION,
                })}
              </p>
            </div>
            <Button onClick={runSearch} disabled={!imageBlob || busy}>
              {busy
                ? t("settings.experimental.visualSearch.searching")
                : t("settings.experimental.visualSearch.search")}
            </Button>
          </div>

          {/* Progress */}
          {busy && (
            <div className="flex flex-col gap-2">
              <Progress value={progress} />
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono">
                {stage}
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-[11px] text-[hsl(var(--destructive,red))] font-mono border-l-2 border-[hsl(var(--destructive,red))] pl-2">
              {error}
            </div>
          )}

          {/* Results */}
          <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto">
            {results.length === 0 && !busy && !error && image && (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                {t("settings.experimental.visualSearch.noResults")}
              </p>
            )}
            {results.map((m) => (
              <div
                key={m.avatar_id}
                className="flex items-center justify-between gap-4 p-2 border rounded text-[11px] font-mono"
              >
                <span className="truncate flex-1" title={m.avatar_id}>
                  {m.avatar_id}
                </span>
                <Badge variant="secondary">
                  d={m.distance.toFixed(3)}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const url = `https://vrchat.com/home/avatar/${m.avatar_id}`;
                    void ipc.call<{ url: string }, { ok: boolean }>("shell.openUrl", { url });
                  }}
                >
                  {t("settings.experimental.visualSearch.openInWeb")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(m.avatar_id);
                  }}
                >
                  {t("settings.experimental.visualSearch.copyId")}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
