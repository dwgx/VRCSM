import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Activity, RotateCcw, Settings2 } from "lucide-react";

interface TrackerStatus {
  name: string;
  driftCm: number;
  lastUpdate: number;
}

export default function FbtMonitor() {
  const { t } = useTranslation();
  const [monitoring, setMonitoring] = useState(false);
  const [trackers] = useState<Map<string, TrackerStatus>>(new Map());
  const [thresholdMinor, setThresholdMinor] = useState(3);
  const [thresholdMajor, setThresholdMajor] = useState(7);

  async function startMonitor() {
    try {
      await ipc.oscSend("/chatbox/typing", [true]);
      setMonitoring(true);
      toast.success(t("fbt.started", { defaultValue: "FBT drift monitoring started" }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function stopMonitor() {
    try {
      await ipc.oscSend("/chatbox/typing", [false]);
      setMonitoring(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function sendCalibrationNudge() {
    try {
      await ipc.oscSend("/chatbox/input", [
        "⚠ FBT drift detected — please recalibrate", true, true,
      ]);
      toast.success(t("fbt.nudgeSent", { defaultValue: "Calibration nudge sent to chatbox" }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  const trackerList = Array.from(trackers.values());

  return (
    <div className="flex flex-col gap-4 animate-fade-in max-w-5xl mx-auto w-full">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Activity className="size-4" />
          <span className="text-[11px] uppercase tracking-[0.08em] font-semibold">
            {t("fbt.title", { defaultValue: "FBT Calibration Monitor" })}
          </span>
        </div>
        <div className="flex gap-2">
          {monitoring ? (
            <Button size="sm" variant="destructive" onClick={() => void stopMonitor()}>
              {t("fbt.stop", { defaultValue: "Stop" })}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void startMonitor()}>
              <Activity className="size-3" />
              {t("fbt.start", { defaultValue: "Start Monitoring" })}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void sendCalibrationNudge()}>
            <RotateCcw className="size-3" />
            {t("fbt.nudge", { defaultValue: "Send Nudge" })}
          </Button>
        </div>
      </header>

      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
        {t("fbt.desc", {
          defaultValue: "Monitors VRChat tracker OSC data for position drift. When drift exceeds thresholds, sends a chatbox reminder to recalibrate. Requires OSC to be enabled in VRChat (Settings → OSC → Enabled).",
        })}
      </p>

      <Card className="unity-panel">
        <CardHeader className="pb-2">
          <CardTitle className="text-[12px] font-mono uppercase tracking-wider flex items-center gap-2">
            <Settings2 className="size-3" />
            {t("fbt.thresholds", { defaultValue: "Drift Thresholds" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[11px]">
              {t("fbt.minor", { defaultValue: "Minor" })}:
            </span>
            <Input
              type="number"
              value={thresholdMinor}
              onChange={(e) => setThresholdMinor(Number(e.target.value))}
              className="h-7 w-16 text-[12px]"
            />
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("common.centimeters", { defaultValue: "cm" })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px]">
              {t("fbt.major", { defaultValue: "Major" })}:
            </span>
            <Input
              type="number"
              value={thresholdMajor}
              onChange={(e) => setThresholdMajor(Number(e.target.value))}
              className="h-7 w-16 text-[12px]"
            />
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("common.centimeters", { defaultValue: "cm" })}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="unity-panel">
        <CardHeader className="pb-2">
          <CardTitle className="text-[12px] font-mono uppercase tracking-wider">
            {t("fbt.trackerStatus", { defaultValue: "Tracker Status" })}
            {monitoring && (
              <Badge variant="default" className="ml-2 animate-pulse">
                {t("common.live", { defaultValue: "Live" })}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!monitoring && trackerList.length === 0 && (
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("fbt.notMonitoring", { defaultValue: "Start monitoring to see tracker data. Make sure OSC is enabled in VRChat and you have trackers connected." })}
            </p>
          )}
          {trackerList.length > 0 && (
            <div className="flex flex-col gap-1">
              {trackerList.map((tr) => (
                <div key={tr.name} className="flex items-center gap-3 text-[11px] font-mono py-1 border-b border-[hsl(var(--border)/0.3)]">
                  <span className="w-20 font-medium">{tr.name}</span>
                  <div className="flex-1 h-2 bg-[hsl(var(--muted))] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        tr.driftCm > thresholdMajor ? "bg-red-500" :
                        tr.driftCm > thresholdMinor ? "bg-yellow-500" :
                        "bg-emerald-500"
                      }`}
                      style={{ width: `${Math.min(100, (tr.driftCm / 15) * 100)}%` }}
                    />
                  </div>
                  <span className={
                    tr.driftCm > thresholdMajor ? "text-red-400" :
                    tr.driftCm > thresholdMinor ? "text-yellow-400" :
                    "text-emerald-400"
                  }>
                    {tr.driftCm.toFixed(1)} {t("common.centimeters", { defaultValue: "cm" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
