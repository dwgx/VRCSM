import { useCallback, useEffect, useState } from "react";
import { ipc } from "@/lib/ipc";
import { toast } from "sonner";
import { Lock, RefreshCw, Unlock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SettingRow } from "./components/SettingRow";

export function TabSteamVR({ vrcRunning }: { vrcRunning: boolean }) {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(() => {
    setLoading(true);
    ipc
      .readSteamVrConfig()
      .then((c) => {
        if ((c as any).error) {
          if ((c as any).error.code !== "not_found") {
            toast.error("Failed to read steamvr.vrsettings: " + (c as any).error.message);
          }
        } else {
          setConfig(c);
        }
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("Failed to read steamvr.vrsettings: " + msg);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  if (!config || !config.ok) {
    return null; // Steam/SteamVR not found, hide completely
  }

  const steamVrProcRunning = config.steamvr_running === true;
  const locked = vrcRunning || steamVrProcRunning;

  const setField = (section: string, key: string, val: any) => {
    setConfig((prev: any) => {
      const next = { ...prev };
      if (!next[section]) next[section] = {};
      next[section][key] = val;
      return next;
    });
  };

  const applyPreset = (bandwidth: number, scale: number, refresh: number, smoothing: boolean, autoBandwidth: boolean, allowFiltering: boolean) => {
    setConfig((prev: any) => {
      const next = { ...prev };
      if (!next.driver_vrlink) next.driver_vrlink = {};
      if (!next.steamvr) next.steamvr = {};

      next.driver_vrlink.targetBandwidth = bandwidth;
      next.driver_vrlink.automaticBandwidth = autoBandwidth;
      next.steamvr.supersampleScale = scale;
      next.steamvr.preferredRefreshRate = refresh;
      next.steamvr.motionSmoothing = smoothing;
      next.steamvr.allowSupersampleFiltering = allowFiltering;

      return next;
    });
    toast.success("Applied preset.");
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const updates = {
        driver_vrlink: config.driver_vrlink,
        steamvr: config.steamvr,
      };
      const res = await ipc.writeSteamVrConfig(updates);
      if ((res as any).error) {
         toast.error("Failed to save steamvr.vrsettings: " + (res as any).error.message);
      } else {
         toast.success("Successfully updated steamvr.vrsettings!");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Failed to save steamvr.vrsettings: " + msg);
    } finally {
      setSaving(false);
      fetchConfig();
    }
  };

  const link = config.driver_vrlink || {};
  const steamvr = config.steamvr || {};
  const hw = config.hardware || {};

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>VR 串流设置 (SteamVR / Steam Link)</CardTitle>
            <CardDescription className="max-w-[60ch]">
              Hardware: {hw.gpuVendor} | {hw.hmdModel} (Driver: {hw.hmdDriver})
            </CardDescription>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {steamVrProcRunning ? (
              <Badge variant="warning" className="gap-1">
                <Lock className="size-3" />
                SteamVR is Running
              </Badge>
            ) : (
              <Badge variant="success" className="gap-1">
                <Unlock className="size-3" />
                SteamVR is Idle
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={fetchConfig} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin size-3 mr-2" : "size-3 mr-2"} />
              Reload
            </Button>
            <Button size="sm" onClick={saveConfig} disabled={saving || locked}>
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="flex flex-wrap items-center gap-2 mb-2 p-2 rounded bg-[hsl(var(--surface-raised))] border border-[hsl(var(--border))]">
          <span className="text-[12px] font-medium text-[hsl(var(--muted-foreground))] mr-2">Quick Presets:</span>
          <Button size="sm" variant="secondary" onClick={() => applyPreset(50, 0.8, 90, true, true, true)} disabled={locked}>Performance (50Mbps)</Button>
          <Button size="sm" variant="secondary" onClick={() => applyPreset(100, 1.0, 72, false, true, true)} disabled={locked}>Balanced (100Mbps)</Button>
          <Button size="sm" variant="secondary" onClick={() => applyPreset(150, 1.5, 72, false, false, true)} disabled={locked}>Quality (150Mbps)</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SettingRow label="Target Bandwidth (Mbps)" hint="Bitrate limit for Steam Link. Up to 150-200 for good routers.">
            <div className="flex items-center gap-2 w-[180px]">
               <Input type="range" min="20" max="200" step="10" className="w-full"
                 disabled={locked}
                 value={link.targetBandwidth ?? 90}
                 onChange={(e) => setField("driver_vrlink", "targetBandwidth", Number(e.target.value))} />
               <span className="text-[12px] tabular-nums whitespace-nowrap min-w-[36px]">{link.targetBandwidth ?? 90} M</span>
            </div>
          </SettingRow>
          <SettingRow label="Automatic Bandwidth" hint="Let SteamVR dynamically drop bitrate on poor signal.">
            <Button size="sm" onClick={() => setField("driver_vrlink", "automaticBandwidth", !link.automaticBandwidth)} disabled={locked} variant={link.automaticBandwidth ? "default" : "outline"} className={link.automaticBandwidth ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.3)]" : ""}>
               {link.automaticBandwidth ? "Enabled" : "Disabled"}
            </Button>
          </SettingRow>
          <SettingRow label="Supersampling Scale" hint="Render scale (1.0 = native, 1.5 = high clarity, requires good GPU)">
             <div className="flex items-center gap-2 w-[180px]">
               <Input type="range" min="0.5" max="2.0" step="0.1" className="w-full"
                 disabled={locked}
                 value={steamvr.supersampleScale ?? 1.0}
                 onChange={(e) => setField("steamvr", "supersampleScale", Number(e.target.value))} />
               <span className="text-[12px] tabular-nums whitespace-nowrap min-w-[36px]">{parseFloat((steamvr.supersampleScale ?? 1.0).toString()).toFixed(1)}x</span>
            </div>
          </SettingRow>
          <SettingRow label="Supersample Manual Override" hint="Forces custom scale instead of auto-adjusting.">
            <Button size="sm" onClick={() => setField("steamvr", "supersampleManualOverride", !steamvr.supersampleManualOverride)} disabled={locked} variant={steamvr.supersampleManualOverride ? "default" : "outline"} className={steamvr.supersampleManualOverride ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.3)]" : ""}>
               {steamvr.supersampleManualOverride ? "Enabled" : "Disabled"}
            </Button>
          </SettingRow>
          <SettingRow label="Refresh Rate (Hz)" hint="Must match the headset's allowed refresh rates (72, 80, 90, 120)">
             <Input type="number" step="1" className="w-24 h-8 text-[12px]" disabled={locked} value={steamvr.preferredRefreshRate ?? 72} onChange={(e) => setField("steamvr", "preferredRefreshRate", Number(e.target.value))} />
          </SettingRow>
          <SettingRow label="Motion Smoothing" hint="Synthesizes frames on lag. Good for poor frametimes, but can cause ghosting artifacts.">
            <Button size="sm" onClick={() => setField("steamvr", "motionSmoothing", !steamvr.motionSmoothing)} disabled={locked} variant={steamvr.motionSmoothing ? "default" : "outline"} className={steamvr.motionSmoothing ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.3)]" : ""}>
               {steamvr.motionSmoothing ? "Enabled" : "Disabled"}
            </Button>
          </SettingRow>
          <SettingRow label="Supersample Filtering" hint="Reduces aliasing at the cost of slight blur">
            <Button size="sm" onClick={() => setField("steamvr", "allowSupersampleFiltering", !steamvr.allowSupersampleFiltering)} disabled={locked} variant={steamvr.allowSupersampleFiltering ? "default" : "outline"} className={steamvr.allowSupersampleFiltering ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.3)]" : ""}>
               {steamvr.allowSupersampleFiltering ? "Enabled" : "Disabled"}
            </Button>
          </SettingRow>
        </div>
      </CardContent>
    </Card>
  );
}
