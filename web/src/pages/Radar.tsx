/**
 * Radar page — thin shell that routes between three tabs:
 *   1. Live Instance Radar (RadarEngine)
 *   2. Historical Analysis (RadarHistoryAnalysis)
 *   3. Friend Log (FriendLogPanel)
 *
 * The heavy lifting lives in the split sub-modules under ./radar/.
 */

import { useState } from "react";
import {
  Globe,
  Radio,
  BarChart3,
  FileClock,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useVrcProcess } from "@/lib/vrc-context";
import { useUiPrefBoolean } from "@/lib/ui-prefs";
import { FriendLogPanel } from "@/pages/FriendLog";

import type { RadarTab } from "./radar/radar-types";
import { RadarEngine } from "./radar/RadarEngine";
import { RadarHistoryAnalysis } from "./radar/RadarHistoryAnalysis";
import { InstanceRoster } from "./radar/InstanceRoster";

// Re-export for any external consumers
export type { RadarPlayer } from "./radar/radar-types";

export default function Radar() {
  const { t } = useTranslation();
  const { status: vrcProcessStatus, loading } = useVrcProcess();
  const vrcRunning = loading ? null : vrcProcessStatus.running;
  const [tab, setTab] = useState<RadarTab>("live");
  const [showTimeline, setShowTimeline] = useUiPrefBoolean("vrcsm.layout.radar.timeline.visible", true);

  return (
    <div className="flex flex-col gap-4 animate-fade-in pb-12">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("nav.radar")}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("radar.subtitle", {
              defaultValue: "Real-time player monitoring via log tailing",
            })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
              tab === "live"
                ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]",
            )}
            onClick={() => setTab("live")}
          >
            <Radio className="size-3.5" />
            {t("radar.title", { defaultValue: "Live Instance Radar" })}
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
              tab === "analysis"
                ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]",
            )}
            onClick={() => setTab("analysis")}
          >
            <BarChart3 className="size-3.5" />
            {t("radar.analysis.tab", { defaultValue: "Historical Analysis" })}
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
              tab === "history"
                ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]",
            )}
            onClick={() => setTab("history")}
          >
            <FileClock className="size-3.5" />
            {t("nav.friendLog")}
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
              tab === "roster"
                ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]",
            )}
            onClick={() => setTab("roster")}
          >
            <Users className="size-3.5" />
            {t("radar.rosterTab", { defaultValue: "Instance Roster" })}
          </button>
        </div>
      </header>

      {tab === "roster" ? (
        <InstanceRoster />
      ) : tab === "history" ? (
        <FriendLogPanel embedded />
      ) : tab === "analysis" ? (
        <RadarHistoryAnalysis />
      ) : vrcRunning === false ? (
        <div className="flex flex-col gap-4">
          <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.1)] p-8 text-center text-[hsl(var(--muted-foreground))] opacity-70">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
              <Globe className="size-6 text-[hsl(var(--muted-foreground)/0.5)]" />
            </div>
            <h3 className="mb-1 text-sm font-semibold text-[hsl(var(--foreground))]">{t("radar.vrcNotRunning")}</h3>
            <p className="text-xs">{t("radar.vrcNotRunningHint")}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 h-7 text-[11px]"
              onClick={() => setTab("analysis")}
            >
              <BarChart3 className="size-3 mr-1.5" />
              {t("radar.analysis.openFromOffline", { defaultValue: "Browse historical analysis" })}
            </Button>
          </div>
        </div>
      ) : vrcRunning === null ? null : (
        <RadarEngine
          onOpenHistory={() => setTab("history")}
          showTimeline={showTimeline}
          onToggleTimeline={() => setShowTimeline((current) => !current)}
        />
      )}
    </div>
  );
}
