import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Cpu, Monitor, HardDrive, Zap, Loader2, RefreshCw,
  CheckCircle2, AlertTriangle, MonitorSmartphone,
} from "lucide-react";

interface HwReport {
  cpuName?: string;
  cpuCores?: number;
  cpuThreads?: number;
  cpuClockMhz?: number;
  gpuName?: string;
  gpuVramBytes?: number;
  gpuDriver?: string;
  ramBytes?: number;
  hmdModel?: string;
  hmdManufacturer?: string;
  osBuild?: string;
}

interface HwRecommendation {
  tier: string;
  score: number;
  cpuScore: number;
  gpuScore: number;
  gpuVramMultiplier: number;
  ramBonus: number;
  hmdProfileName?: string;
  targetBandwidth: number;
  supersampleScale: number;
  preferredRefreshRate: number;
  motionSmoothing: boolean;
  allowFiltering: boolean;
  ffrLevel: number;
  rationale?: string;
  fromCommunity?: boolean;
  communityAuthor?: string;
}

function formatVram(bytes?: number): string {
  if (!bytes || bytes === 0) return "—";
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatRam(bytes?: number): string {
  if (!bytes) return "—";
  return `${(bytes / 1024 / 1024 / 1024).toFixed(0)} GB`;
}

function formatMhz(mhz?: number): string {
  if (!mhz) return "—";
  return `${(mhz / 1000).toFixed(1)} GHz`;
}

function tierColor(tier: string): string {
  switch (tier) {
    case "ultra": return "text-purple-400";
    case "high": return "text-emerald-400";
    case "balanced": return "text-blue-400";
    case "low": return "text-amber-400";
    default: return "text-[hsl(var(--muted-foreground))]";
  }
}

function tierBg(tier: string): string {
  switch (tier) {
    case "ultra": return "bg-purple-400/15 border-purple-400/40";
    case "high": return "bg-emerald-400/15 border-emerald-400/40";
    case "balanced": return "bg-blue-400/15 border-blue-400/40";
    case "low": return "bg-amber-400/15 border-amber-400/40";
    default: return "bg-[hsl(var(--muted)/0.15)] border-[hsl(var(--border))]";
  }
}

export default function TabHardware() {
  const { t } = useTranslation();
  const [detecting, setDetecting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [report, setReport] = useState<HwReport | null>(null);
  const [recommendation, setRecommendation] = useState<HwRecommendation | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function detect() {
    setDetecting(true);
    setError(null);
    try {
      const r = await ipc.call<undefined, { report: HwReport; recommendation: HwRecommendation }>("hw.recommend");
      setReport(r.report);
      setRecommendation(r.recommendation);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetecting(false);
    }
  }

  useEffect(() => { void detect(); }, []);

  async function applyPreset() {
    if (!recommendation) return;
    setApplying(true);
    try {
      await ipc.call<{ tier: string }, { ok: boolean }>("hw.applyPreset", { tier: recommendation.tier });
      toast.success(t("settings.hardware.applied", { defaultValue: "Settings applied! Restart SteamVR." }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  const rec = recommendation;

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header>
        <h2 className="text-[16px] font-semibold">{t("settings.hardware.title", { defaultValue: "Hardware & GPU" })}</h2>
        <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
          {t("settings.hardware.subtitle", { defaultValue: "Detect GPU and CPU to compute recommended VRChat settings for Steam Link / Quest." })}
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" disabled={detecting} onClick={() => void detect()}>
          {detecting ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          {detecting ? t("common.detecting", { defaultValue: "Detecting…" }) : t("settings.hardware.refresh", { defaultValue: "Re-detect" })}
        </Button>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.35)] bg-[hsl(var(--destructive)/0.06)] px-3 py-2.5 text-[12px] text-[hsl(var(--destructive))] flex items-center gap-2">
          <AlertTriangle className="size-4" />
          {error}
        </div>
      ) : null}

      {detecting && !report ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Loader2 className="size-6 mx-auto mb-2 text-[hsl(var(--primary))] animate-spin" />
            <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("settings.hardware.detecting", { defaultValue: "Detecting hardware…" })}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {report && (
        <>
          {/* Hardware overview */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<Cpu className="size-4 text-blue-400" />} label={t("settings.hardware.cpu", { defaultValue: "CPU" })} value={report.cpuName ?? "—"}>
              <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                {report.cpuCores}C/{report.cpuThreads}T · {formatMhz(report.cpuClockMhz)}
              </span>
            </StatCard>
            <StatCard icon={<Monitor className="size-4 text-emerald-400" />} label={t("settings.hardware.gpu", { defaultValue: "GPU" })} value={report.gpuName ?? "—"}>
              <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                {formatVram(report.gpuVramBytes)} VRAM
              </span>
            </StatCard>
            <StatCard icon={<HardDrive className="size-4 text-amber-400" />} label={t("settings.hardware.ram", { defaultValue: "RAM" })} value={formatRam(report.ramBytes)} />
            <StatCard icon={<MonitorSmartphone className="size-4 text-purple-400" />} label={t("settings.hardware.hmd", { defaultValue: "HMD" })} value={report.hmdModel || report.hmdManufacturer || "—"} />
          </div>

          {/* Recommendation card */}
          {rec && (
            <Card className={cn("border", tierBg(rec.tier))}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-[13px]">
                  <Zap className={cn("size-4", tierColor(rec.tier))} />
                  <span className={tierColor(rec.tier)}>
                    {t("settings.hardware.recommendedTier", { tier: rec.tier.toUpperCase(), defaultValue: `${rec.tier.toUpperCase()} Tier Recommended` })}
                  </span>
                  {rec.fromCommunity ? (
                    <Badge variant="outline" className="text-[9px] h-4 gap-1">
                      <UsersIcon className="size-2.5" />
                      {t("settings.hardware.community", { defaultValue: "Community" })}
                    </Badge>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-3 mb-3">
                  <MiniStat label={t("settings.hardware.bandwidth", { defaultValue: "Bandwidth" })} value={`${rec.targetBandwidth} Mbps`} />
                  <MiniStat label={t("settings.hardware.supersampling", { defaultValue: "Supersampling" })} value={`${rec.supersampleScale.toFixed(2)}x`} />
                  <MiniStat label={t("settings.hardware.refreshRate", { defaultValue: "Refresh Rate" })} value={`${rec.preferredRefreshRate} Hz`} />
                  <MiniStat label={t("settings.hardware.motionSmoothing", { defaultValue: "Motion Smoothing" })} value={rec.motionSmoothing ? "On" : "Off"} />
                  <MiniStat label={t("settings.hardware.ffr", { defaultValue: "FFR Level" })} value={`FFR ${rec.ffrLevel}`} />
                  <MiniStat label={t("settings.hardware.score", { defaultValue: "HW Score" })} value={`${rec.score}/200`} />
                </div>
                {rec.rationale ? (
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed mb-3">{rec.rationale}</p>
                ) : null}
                <Button size="sm" className="h-7 text-[11px] gap-1.5" disabled={applying} onClick={() => void applyPreset()}>
                  {applying ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                  {applying
                    ? t("settings.hardware.applying", { defaultValue: "Applying…" })
                    : t("settings.hardware.apply", { defaultValue: "Apply recommended settings" })}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Component scores */}
          {rec && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-[12px]">{t("settings.hardware.scoreBreakdown", { defaultValue: "Score Breakdown" })}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  <ScoreBar label={t("settings.hardware.cpuScore", { defaultValue: "CPU" })} score={rec.cpuScore} max={100} color="bg-blue-400" />
                  <ScoreBar label={t("settings.hardware.gpuScore", { defaultValue: "GPU" })} score={rec.gpuScore} max={100} color="bg-emerald-400" />
                  <ScoreBar label={t("settings.hardware.vramBonus", { defaultValue: "VRAM" })} score={Math.round((rec.gpuVramMultiplier - 1) * 100)} max={15} color="bg-purple-400" />
                  <ScoreBar label={t("settings.hardware.ramBonus", { defaultValue: "RAM" })} score={rec.ramBonus} max={10} color="bg-amber-400" />
                  <div className="flex items-center justify-between pt-1 border-t border-[hsl(var(--border)/0.4)]">
                    <span className="text-[11px] font-semibold">{t("settings.hardware.totalScore", { defaultValue: "Total" })}</span>
                    <span className="text-[12px] font-bold">{rec.score}/200</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, children }: { icon: React.ReactNode; label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
      <div className="flex items-center gap-1.5 mb-0.5 text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className="text-[12px] font-semibold truncate">{value}</div>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-xs)] bg-[hsl(var(--canvas))] px-2.5 py-1.5">
      <div className="text-[9px] text-[hsl(var(--muted-foreground))] uppercase">{label}</div>
      <div className="text-[12px] font-semibold">{value}</div>
    </div>
  );
}

function ScoreBar({ label, score, max, color }: { label: string; score: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round((score / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-[10px] text-[hsl(var(--muted-foreground))]">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-[hsl(var(--canvas))] overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-[10px] font-mono text-[hsl(var(--muted-foreground))]">{score}</span>
    </div>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
