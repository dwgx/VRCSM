import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CircleOff, Eraser, ScrollText, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc } from "@/lib/ipc";
import { getTrueCacheLabel } from "@/lib/report-metrics";
import { cn, formatDate } from "@/lib/utils";
import type { LogStreamChunk, Report } from "@/lib/types";

type DockTab = "console" | "output" | "problems";

interface BottomDockProps {
  report: Report | null;
  resetToken?: number;
}

interface ConsoleLine {
  id: string;
  level: "info" | "warn" | "error" | "system";
  message: string;
  timestamp?: string;
  source?: string;
}

function isLogStreamChunk(value: unknown): value is LogStreamChunk {
  return (
    typeof value === "object" &&
    value !== null &&
    ("line" in value || "message" in value || "text" in value)
  );
}

export function BottomDock({ report, resetToken = 0 }: BottomDockProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<DockTab>("console");
  const [height, setHeight] = useState(180);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const resizeState = useRef<{ startY: number; startHeight: number } | null>(
    null,
  );
  const consoleViewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveTab("console");
    setHeight(180);
  }, [resetToken]);

  useEffect(() => {
    const appendLine = (line: ConsoleLine) => {
      setConsoleLines((prev) => [...prev.slice(-399), line]);
    };

    const off = ipc.on<LogStreamChunk | string>("logs.stream", (payload) => {
      if (typeof payload === "string") {
        appendLine({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          level: "info",
          message: payload,
        });
        return;
      }
      if (!isLogStreamChunk(payload)) return;
      appendLine({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        level:
          payload.level === "warn" || payload.level === "error"
            ? payload.level
            : "info",
        message: payload.line ?? payload.message ?? payload.text ?? "",
        timestamp: payload.timestamp,
        source: payload.source,
      });
    });

    void ipc.call<undefined, { ok?: boolean }>("logs.stream.start").catch(
      () => undefined,
    );

    return () => {
      off();
      void ipc.call<undefined, { ok?: boolean }>("logs.stream.stop").catch(
        () => undefined,
      );
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "console") return;
    const viewport = consoleViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [activeTab, consoleLines]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeState.current) return;
      const deltaY = event.clientY - resizeState.current.startY;
      const nextHeight = Math.max(
        140,
        Math.min(420, resizeState.current.startHeight - deltaY),
      );
      setHeight(nextHeight);
    };
    const handlePointerUp = () => {
      resizeState.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const problems = report?.broken_links ?? [];

  const outputLines = useMemo(() => {
    if (!report) return [];
    return [
      `Scan generated: ${formatDate(report.generated_at)}`,
      `Base dir: ${report.base_dir}`,
      `Cache total: ${getTrueCacheLabel(report)}`,
      `Categories present: ${report.existing_category_count}`,
      `Log files: ${report.logs.log_count}`,
    ];
  }, [report]);

  return (
    <section
      className="unity-dock flex min-w-0 overflow-x-hidden shrink-0 flex-col border-t border-[hsl(var(--border))] bg-[hsl(var(--surface))]"
      style={{ height }}
    >
      <button
        type="button"
        className="unity-splitter h-1 w-full cursor-row-resize"
        aria-label="Resize bottom dock"
        onPointerDown={(event) => {
          resizeState.current = {
            startY: event.clientY,
            startHeight: height,
          };
          document.body.style.cursor = "row-resize";
          document.body.style.userSelect = "none";
        }}
      />

      <div className="flex h-8 items-center border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-2">
        <div className="flex min-w-0 items-center gap-1">
          {([
            ["console", t("dock.console"), Terminal],
            ["output", t("dock.output"), ScrollText],
            ["problems", t("dock.problems"), AlertTriangle],
          ] satisfies Array<[DockTab, string, typeof Terminal]>).map(
            ([tab, label, Icon]) => (
              <button
                key={tab}
                type="button"
                className={cn(
                  "unity-tab flex items-center gap-1.5",
                  activeTab === tab && "unity-tab-active",
                )}
                onClick={() => setActiveTab(tab)}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ),
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-[11px]"
          onClick={() => setConsoleLines([])}
        >
          <Eraser className="size-3.5" />
          {t("dock.clear")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 bg-[hsl(var(--canvas))]">
        {activeTab === "console" ? (
          <div
            ref={consoleViewportRef}
            className="scrollbar-thin h-full overflow-y-auto px-3 py-2 font-mono text-[11px]"
          >
            {consoleLines.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[hsl(var(--muted-foreground))]">
                <div className="flex items-center gap-2">
                  <CircleOff className="size-4" />
                  <span>{t("common.none")}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {consoleLines.map((line) => (
                  <div
                    key={line.id}
                    className={cn(
                      "flex gap-3 rounded-[var(--radius-sm)] px-2 py-1",
                      line.level === "error" &&
                        "bg-[hsl(var(--destructive)/0.12)] text-[hsl(var(--destructive))]",
                      line.level === "warn" &&
                        "bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))]",
                      (line.level === "info" || line.level === "system") &&
                        "text-[hsl(var(--foreground))]",
                    )}
                  >
                    <span className="w-16 shrink-0 text-[hsl(var(--muted-foreground))]">
                      {line.timestamp
                        ? new Date(line.timestamp).toLocaleTimeString()
                        : "tail"}
                    </span>
                    <span className="flex-1 break-all">{line.message}</span>
                    {line.source ? (
                      <span className="shrink-0 text-[hsl(var(--muted-foreground))]">
                        {line.source}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {activeTab === "output" ? (
          <div className="scrollbar-thin h-full overflow-y-auto px-3 py-2 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            {outputLines.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                {t("common.loading")}
              </div>
            ) : (
              <div className="space-y-1.5">
                {outputLines.map((line) => (
                  <div
                    key={line}
                    className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1.5"
                  >
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {activeTab === "problems" ? (
          <div className="scrollbar-thin h-full overflow-y-auto px-3 py-2 text-[12px]">
            {problems.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[hsl(var(--muted-foreground))]">
                {t("common.none")}
              </div>
            ) : (
              <div className="space-y-2">
                {problems.map((problem) => (
                  <div
                    key={`${problem.category}-${problem.logical_path}`}
                    className="rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.35)] bg-[hsl(var(--destructive)/0.12)] px-3 py-2"
                  >
                    <div className="flex items-center gap-2 text-[hsl(var(--destructive))]">
                      <AlertTriangle className="size-3.5" />
                      <span className="font-medium">{problem.category}</span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-[hsl(var(--foreground))]">
                      {problem.logical_path}
                    </div>
                    <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                      {problem.reason}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
