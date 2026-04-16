import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, RefreshCcw, Image as ImageIcon, Calendar, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ipc } from "@/lib/ipc";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { cn } from "@/lib/utils";

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function ScreenshotTile({
  shot,
  onOpen,
}: {
  shot: Screenshot;
  onOpen: (s: Screenshot) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onOpen(shot)}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-[var(--radius-sm)]",
        "border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]",
        "hover:border-[hsl(var(--border-strong))] hover:shadow-md transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--primary))]",
      )}
      title={shot.filename}
    >
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
            打开
          </span>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
        <Calendar className="size-3 shrink-0" />
        <span className="truncate">{formatDate(shot.created_at)}</span>
        <Clock className="size-3 shrink-0" />
        <span className="shrink-0">{formatTime(shot.created_at)}</span>
        <span className="ml-auto shrink-0 font-mono">{formatBytes(shot.size_bytes)}</span>
      </div>
    </button>
  );
}

export default function Screenshots() {
  const { t } = useTranslation();
  const [data, setData] = useState<ScreenshotsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebouncedValue(filter, 150);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    ipc
      .call<undefined, ScreenshotsResult>("screenshots.list", undefined)
      .then(setData)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openShot(shot: Screenshot) {
    void ipc.call("screenshots.open", { path: shot.path });
  }

  function openFolder() {
    if (data?.folder) {
      void ipc.call("screenshots.folder", { path: data.folder });
    }
  }

  const filtered = data?.screenshots.filter((s) =>
    debouncedFilter
      ? s.filename.toLowerCase().includes(debouncedFilter.toLowerCase())
      : true,
  ) ?? [];

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("screenshots.title", { defaultValue: "截图" })}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {data?.folder ?? t("screenshots.subtitle", { defaultValue: "VRChat 截图浏览器" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openFolder} disabled={!data}>
            <FolderOpen />
            {t("screenshots.openFolder", { defaultValue: "打开文件夹" })}
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
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
            placeholder={t("screenshots.filter", { defaultValue: "按文件名过滤…" })}
            className="h-7 text-[12px]"
          />
        </div>
        {data && (
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {filtered.length} 张
          </span>
        )}
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
            {t("screenshots.empty", { defaultValue: "没有截图" })}
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {filtered.map((shot) => (
            <ScreenshotTile key={shot.path} shot={shot} onOpen={openShot} />
          ))}
        </div>
      )}
    </div>
  );
}
