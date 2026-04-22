import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useReport } from "@/lib/report-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gauge, AlertTriangle, CheckCircle2, Info } from "lucide-react";

interface AvatarItem {
  avatar_id: string;
  display_name?: string;
  parameter_count: number;
  modified_at?: string;
}

function perfRank(params: number): { label: string; color: string; tier: string } {
  if (params <= 8) return { label: "Excellent", color: "text-emerald-400", tier: "S" };
  if (params <= 16) return { label: "Good", color: "text-green-400", tier: "A" };
  if (params <= 32) return { label: "Medium", color: "text-yellow-400", tier: "B" };
  if (params <= 64) return { label: "Poor", color: "text-orange-400", tier: "C" };
  return { label: "Very Poor", color: "text-red-400", tier: "D" };
}

export default function AvatarBenchmark() {
  const { t } = useTranslation();
  const { report } = useReport();

  const avatars = useMemo(() => {
    if (!report) return [];
    const items = report.local_avatar_data?.recent_items ?? [];
    return (items as AvatarItem[])
      .filter((a) => a.parameter_count > 0)
      .sort((a, b) => b.parameter_count - a.parameter_count);
  }, [report]);

  const histogram = useMemo(() => {
    const h = { S: 0, A: 0, B: 0, C: 0, D: 0 };
    for (const a of avatars) {
      const { tier } = perfRank(a.parameter_count);
      h[tier as keyof typeof h] += 1;
    }
    return h;
  }, [avatars]);

  return (
    <div className="flex flex-col gap-4 animate-fade-in max-w-5xl mx-auto w-full">
      <header className="flex items-center gap-2">
        <Gauge className="size-4" />
        <span className="text-[11px] uppercase tracking-[0.08em] font-semibold">
          {t("benchmark.title", { defaultValue: "Avatar Performance Benchmark" })}
        </span>
        <Badge variant="secondary">{avatars.length} avatars</Badge>
      </header>

      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
        {t("benchmark.desc", {
          defaultValue: "Estimates VRChat performance rank based on synced parameter count from LocalAvatarData. Lower parameter count = better network performance. Full mesh/material analysis coming in v0.13.",
        })}
      </p>

      <div className="grid gap-3 md:grid-cols-5">
        {(["S", "A", "B", "C", "D"] as const).map((tier) => {
          const r = perfRank(tier === "S" ? 1 : tier === "A" ? 10 : tier === "B" ? 20 : tier === "C" ? 40 : 80);
          return (
            <Card key={tier} className="unity-panel">
              <CardContent className="p-3 text-center">
                <div className={`text-[20px] font-bold ${r.color}`}>{tier}</div>
                <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{r.label}</div>
                <div className="text-[16px] font-semibold mt-1">{histogram[tier]}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="unity-panel">
        <CardHeader className="pb-2">
          <CardTitle className="text-[12px] font-mono uppercase tracking-wider">
            {t("benchmark.breakdown", { defaultValue: "Avatar Breakdown" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-0.5 max-h-[500px] overflow-y-auto">
          {avatars.map((a) => {
            const r = perfRank(a.parameter_count);
            return (
              <div key={a.avatar_id} className="flex items-center gap-2 text-[11px] font-mono py-1 border-b border-[hsl(var(--border)/0.3)]">
                <Badge variant="outline" className={`w-8 justify-center text-[9px] ${r.color}`}>
                  {r.tier}
                </Badge>
                <span className="flex-1 truncate">{a.display_name || a.avatar_id}</span>
                <span className="text-[hsl(var(--muted-foreground))]">{a.parameter_count} params</span>
                {a.parameter_count > 64 ? (
                  <AlertTriangle className="size-3 text-red-400" />
                ) : a.parameter_count <= 16 ? (
                  <CheckCircle2 className="size-3 text-emerald-400" />
                ) : (
                  <Info className="size-3 text-[hsl(var(--muted-foreground))]" />
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
