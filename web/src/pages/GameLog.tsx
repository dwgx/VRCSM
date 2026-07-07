import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play, Search, Trash2, ArrowDownToLine, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ipc } from "@/lib/ipc";
import { isLogNoise } from "@/lib/log-noise";
import { useUiPrefBoolean } from "@/lib/ui-prefs";
import { cn } from "@/lib/utils";
import type { LogStreamChunk, LogStreamLevel, LogStreamStartResult } from "@/lib/types";

// Cap retained lines so a long session can't grow the array unbounded.
// The raw GameLog is chatty; 5k lines is plenty of scrollback while keeping
// the DOM/array cheap. Older lines roll off the top.
const MAX_LINES = 5000;

type Level = LogStreamLevel | "system";

interface GameLogLine {
  id: number;
  line: string;
  level: Level;
  timestamp?: string;
  source?: string;
}

function isLogStreamChunk(value: unknown): value is LogStreamChunk {
  return !!value && typeof value === "object";
}

function chunkText(chunk: LogStreamChunk): string {
  return chunk.line ?? chunk.message ?? chunk.text ?? "";
}

const LEVEL_FILTERS: { key: Level | "all"; labelKey: string; fallback: string }[] = [
  { key: "all", labelKey: "gameLog.level.all", fallback: "All" },
  { key: "info", labelKey: "gameLog.level.info", fallback: "Info" },
  { key: "warn", labelKey: "gameLog.level.warn", fallback: "Warn" },
  { key: "error", labelKey: "gameLog.level.error", fallback: "Error" },
];

function levelClass(level: Level): string {
  switch (level) {
    case "error":
      return "text-rose-400";
    case "warn":
      return "text-amber-400";
    case "system":
      return "text-sky-400";
    default:
      return "text-[hsl(var(--muted-foreground))]";
  }
}

interface GameLogPanelProps {
  /** When embedded in another page (Radar tab) skip the standalone header. */
  embedded?: boolean;
}

export function GameLogPanel({ embedded = false }: GameLogPanelProps) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<GameLogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [level, setLevel] = useState<Level | "all">("all");
  const [search, setSearch] = useState("");
  const [follow, setFollow] = useState(true);
  const [hideNoise, setHideNoise] = useUiPrefBoolean("vrcsm.gamelog.hideNoise", true);
  // Stream status from the host's logs.stream.start reply — drives a specific
  // empty-state (no log dir / no log file / VRChat not running) instead of a
  // silent blank when there's nothing to tail yet.
  const [streamStatus, setStreamStatus] = useState<LogStreamStartResult | null>(null);

  const idRef = useRef(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Buffer incoming lines and flush on a timer so a burst of log activity
  // triggers one render, not one per line.
  const pendingRef = useRef<GameLogLine[]>([]);
  const flushTimerRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const incoming = pendingRef.current;
    if (incoming.length === 0) return;
    pendingRef.current = [];
    setLines((prev) => {
      const merged = prev.concat(incoming);
      return merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void ipc
      .call<undefined, LogStreamStartResult>("logs.stream.start")
      .then((res) => {
        if (cancelled) return;
        setStreamStatus(res);
        // Seed the buffer from the reply's tail snapshot. The shared tailer
        // only broadcasts its one-shot backfill to whoever was listening at
        // first attach, so a Game Log tab opened after the default dock
        // already started the tailer would otherwise be blank. We seed here
        // and ignore backfill-flagged live lines (below) so nothing double
        // counts regardless of whether we were the first subscriber.
        if (Array.isArray(res.snapshot) && res.snapshot.length > 0) {
          const seeded: GameLogLine[] = res.snapshot.map((c) => ({
            id: idRef.current++,
            line: chunkText(c),
            level: (c.level as Level) ?? "info",
            timestamp: c.timestamp,
            source: c.source,
          }));
          setLines((prev) => {
            const merged = seeded.concat(prev);
            return merged.length > MAX_LINES
              ? merged.slice(merged.length - MAX_LINES)
              : merged;
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // The host used to throw when %LocalLow%\VRChat\VRChat didn't exist,
        // which left streamStatus null and the first-run "no log folder"
        // empty state unreachable. The host now resolves with
        // baseDirExists:false for that case, but we still degrade defensively:
        // a "not found" / "log directory" rejection is treated as a missing
        // base dir so first-run users see the actionable empty state instead
        // of the generic "waiting for output" copy.
        const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
        if (msg.includes("not found") || msg.includes("log directory") || msg.includes("no vrchat")) {
          setStreamStatus({
            running: false,
            subscribers: 0,
            baseDirExists: false,
            logFound: false,
            vrcRunning: false,
          });
        }
      });

    const scheduleFlush = () => {
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = window.setTimeout(flush, 120);
    };

    const off = ipc.on<LogStreamChunk | string>("logs.stream", (payload) => {
      if (pausedRef.current) return;
      let text: string;
      let lvl: Level = "info";
      let timestamp: string | undefined;
      let source: string | undefined;
      if (typeof payload === "string") {
        text = payload;
      } else if (isLogStreamChunk(payload)) {
        // We already seeded history from the start reply's snapshot, so
        // ignore the tailer's one-shot backfill replay to avoid duplicating
        // those lines when we happen to be the first subscriber.
        if (payload.backfill) return;
        text = chunkText(payload);
        lvl = (payload.level as Level) ?? "info";
        timestamp = payload.timestamp;
        source = payload.source;
      } else {
        return;
      }
      if (!text) return;
      pendingRef.current.push({ id: idRef.current++, line: text, level: lvl, timestamp, source });
      scheduleFlush();
    });

    return () => {
      cancelled = true;
      off();
      // Drop our refcount on the shared tailer; the host tears it down only
      // when no other subscriber (Logs page, Console dock) is still attached.
      void ipc.call("logs.stream.stop").catch(() => undefined);
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [flush]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter((l) => {
      if (hideNoise && isLogNoise(l.line)) return false;
      if (level !== "all" && l.level !== level) return false;
      if (q && !l.line.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [lines, level, search, hideNoise]);

  // Choose a specific empty-state message. Distinguishes "paused",
  // "VRChat not running / no log yet" (the common cause of a blank panel),
  // and the generic waiting state, so a silent blank never looks broken.
  const emptyStateMessage = useMemo(() => {
    if (paused) {
      return t("gameLog.paused", { defaultValue: "Stream paused. Resume to capture new lines." });
    }
    // Only trust a definitive host reply; in mock/browser mode streamStatus
    // stays null and we fall through to the generic waiting copy.
    if (streamStatus) {
      if (streamStatus.baseDirExists === false) {
        return t("gameLog.noLogDir", {
          defaultValue: "No VRChat log folder found. Launch VRChat at least once to create it.",
        });
      }
      if (streamStatus.logFound === false) {
        return streamStatus.vrcRunning
          ? t("gameLog.runningNoLog", {
              defaultValue: "VRChat is running but hasn't written a log yet. Lines will appear shortly.",
            })
          : t("gameLog.notRunning", {
              defaultValue: "VRChat isn't running and no log was found. Launch VRChat to see live lines.",
            });
      }
      if (streamStatus.vrcRunning === false) {
        return t("gameLog.notRunningHaveLog", {
          defaultValue: "VRChat isn't running. Showing the tail of the last session's log; launch VRChat for live lines.",
        });
      }
    }
    return t("gameLog.waiting", {
      defaultValue: "Waiting for VRChat log output… launch VRChat to see live lines.",
    });
  }, [paused, streamStatus, t]);

  // Auto-scroll to bottom on new lines while following.
  useEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered, follow]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // If the user scrolls within ~24px of the bottom, keep following; otherwise
    // detach so reading older lines isn't yanked back down.
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setFollow(atBottom);
  }, []);

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setFollow(true);
  }, []);

  return (
    <div className={cn("space-y-4", !embedded && "animate-fade-in")}>
      {embedded ? null : (
        <header>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("gameLog.title", { defaultValue: "Game Log" })}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("gameLog.subtitle", { defaultValue: "Live raw VRChat output log tail." })}
          </p>
        </header>
      )}

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-[13px] font-semibold">
              {t("gameLog.title", { defaultValue: "Game Log" })}
              <span className="text-[10px] font-normal tabular-nums text-[hsl(var(--muted-foreground))]">
                {t("gameLog.lineCount", { defaultValue: "{{n}} lines", n: filtered.length })}
              </span>
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <div className="relative w-[200px]">
                <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("gameLog.searchPlaceholder", { defaultValue: "Filter lines…" })}
                  className="h-8 pl-7 text-[12px]"
                />
              </div>
              <Button
                variant={paused ? "default" : "outline"}
                size="sm"
                className="h-8 gap-1.5 text-[12px]"
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                {paused
                  ? t("gameLog.resume", { defaultValue: "Resume" })
                  : t("gameLog.pause", { defaultValue: "Pause" })}
              </Button>
              <Button
                variant={hideNoise ? "default" : "outline"}
                size="sm"
                className="h-8 gap-1.5 text-[12px]"
                onClick={() => setHideNoise((v) => !v)}
                title={t("gameLog.hideNoiseHint", {
                  defaultValue:
                    "Fold VRChat's EOS/Stomp telemetry retry spam (not a VRCSM error).",
                })}
              >
                <Filter className="size-3.5" />
                {hideNoise
                  ? t("gameLog.noiseHidden", { defaultValue: "Hiding noise" })
                  : t("gameLog.showAll", { defaultValue: "Show all" })}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-[12px]"
                onClick={() => {
                  setLines([]);
                  pendingRef.current = [];
                }}
              >
                <Trash2 className="size-3.5" />
                {t("gameLog.clear", { defaultValue: "Clear" })}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {LEVEL_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setLevel(f.key)}
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  level === f.key
                    ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                    : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]",
                )}
              >
                {t(f.labelKey, { defaultValue: f.fallback })}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="relative">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="h-[420px] overflow-y-auto rounded-[var(--radius-sm)] border border-[hsl(var(--border)/0.65)] bg-[hsl(var(--canvas))] p-2 font-mono text-[11px] leading-relaxed"
          >
            {filtered.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center text-[12px] text-[hsl(var(--muted-foreground))]">
                {emptyStateMessage}
              </div>
            ) : (
              filtered.map((l) => (
                <div key={l.id} className="flex gap-2 whitespace-pre-wrap break-all">
                  {l.timestamp ? (
                    <span className="shrink-0 tabular-nums text-[hsl(var(--muted-foreground)/0.7)]">
                      {l.timestamp.slice(11, 19)}
                    </span>
                  ) : null}
                  <span className={cn("min-w-0", levelClass(l.level))}>{l.line}</span>
                </div>
              ))
            )}
          </div>
          {!follow ? (
            <Button
              variant="default"
              size="sm"
              className="absolute bottom-6 right-6 h-7 gap-1.5 text-[11px] shadow-md"
              onClick={jumpToBottom}
            >
              <ArrowDownToLine className="size-3.5" />
              {t("gameLog.jumpToBottom", { defaultValue: "Jump to latest" })}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default function GameLog() {
  return <GameLogPanel />;
}
