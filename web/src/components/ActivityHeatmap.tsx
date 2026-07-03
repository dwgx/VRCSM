import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { ipc } from "@/lib/ipc";
import { buildHeatmapModel } from "@/lib/activity-heatmap";

const DAYS = 30;
// DB day-of-week is Sun..Sat (strftime '%w'); reorder display to Mon-first,
// which reads more naturally for a weekly pattern.
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function dayLabel(dow: number): string {
  // Localize via Intl rather than a hand-maintained string table.
  // 2024-09-01 is a Sunday, so +dow hits the matching weekday.
  const d = new Date(2024, 8, 1 + dow);
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}`;
}

/**
 * World-visit activity heatmap. Reads the `db.stats.heatmap` IPC (a 7×24
 * count matrix) — previously built host-side but never surfaced — and renders
 * it with the perceptual intensity ramp from `activity-heatmap.ts`.
 */
export function ActivityHeatmap() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["db.stats.heatmap", DAYS],
    queryFn: () => ipc.dbStatsHeatmap(DAYS),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  const model = useMemo(() => buildHeatmapModel(data), [data]);

  if (isLoading) return null;
  if (model.total === 0) {
    return (
      <Card className="unity-panel">
        <CardContent className="p-3">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
            {t("worldHistory.heatmap.title")}
          </div>
          <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">
            {t("worldHistory.heatmap.empty")}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Index cells by day/hour for O(1) lookup while rendering rows.
  const byDayHour = new Map<number, number>();
  for (const cell of model.cells) {
    byDayHour.set(cell.day * 24 + cell.hour, cell.intensity);
  }

  return (
    <Card className="unity-panel">
      <CardContent className="p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[hsl(var(--foreground))]">
            {t("worldHistory.heatmap.title")}
          </div>
          <div className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
            {t("worldHistory.heatmap.subtitle", { days: DAYS })}
          </div>
        </div>

        {model.busiest && (
          <div className="mt-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
            {t("worldHistory.heatmap.busiest", {
              day: dayLabel(model.busiest.day),
              hour: `${hourLabel(model.busiest.hour)}:00`,
            })}
            {" · "}
            {t("worldHistory.heatmap.totalVisits", { count: model.total })}
          </div>
        )}

        <div className="mt-3 overflow-x-auto">
          <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: "auto repeat(24, 12px)" }}>
            {/* Hour axis */}
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={`haxis-${h}`}
                className="text-center font-mono text-[7px] leading-none text-[hsl(var(--muted-foreground))]"
              >
                {h % 6 === 0 ? hourLabel(h) : ""}
              </div>
            ))}

            {/* Day rows (Mon-first) */}
            {DISPLAY_ORDER.map((dow) => (
              <div key={`row-${dow}`} className="contents">
                <div className="pr-1 text-right font-mono text-[8px] leading-[12px] text-[hsl(var(--muted-foreground))]">
                  {dayLabel(dow)}
                </div>
                {Array.from({ length: 24 }, (_, h) => {
                  const intensity = byDayHour.get(dow * 24 + h) ?? 0;
                  const cell = model.cells[dow * 24 + h];
                  return (
                    <div
                      key={`cell-${dow}-${h}`}
                      title={t("worldHistory.heatmap.cellTooltip", {
                        day: dayLabel(dow),
                        hour: `${hourLabel(h)}:00`,
                        count: cell?.count ?? 0,
                      })}
                      className="h-[12px] w-[12px] rounded-[2px]"
                      style={{
                        backgroundColor:
                          intensity === 0
                            ? "hsl(var(--surface))"
                            : `hsl(var(--primary) / ${(0.12 + intensity * 0.88).toFixed(3)})`,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-2 flex items-center gap-1 font-mono text-[9px] text-[hsl(var(--muted-foreground))]">
          <span>{t("worldHistory.heatmap.legendLess")}</span>
          {[0, 0.25, 0.5, 0.75, 1].map((step) => (
            <span
              key={`legend-${step}`}
              className="h-[10px] w-[10px] rounded-[2px]"
              style={{
                backgroundColor:
                  step === 0
                    ? "hsl(var(--surface))"
                    : `hsl(var(--primary) / ${(0.12 + step * 0.88).toFixed(3)})`,
              }}
            />
          ))}
          <span>{t("worldHistory.heatmap.legendMore")}</span>
        </div>
      </CardContent>
    </Card>
  );
}
