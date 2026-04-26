import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/ipc";
import { toast } from "sonner";
import { Lock, RefreshCw, Unlock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SettingRow } from "./components/SettingRow";

// HMD native per-eye render-target resolution lookup. Steam Link's
// "Encoder Resolution" number is this × supersampleScale (per eye),
// which is why that value doesn't appear as a standalone key in
// steamvr.vrsettings. Numbers are SteamVR render targets (include
// barrel-distortion padding), not the raw panel pixels.
const HMD_NATIVE_PER_EYE: Array<{ match: RegExp; w: number; h: number; name: string }> = [
  { match: /quest\s*3s/i,          w: 1832, h: 1920, name: "Quest 3S" },
  { match: /quest\s*3/i,           w: 2064, h: 2208, name: "Quest 3" },
  { match: /quest\s*pro/i,         w: 1800, h: 1920, name: "Quest Pro" },
  { match: /quest\s*2/i,           w: 1832, h: 1920, name: "Quest 2" },
  { match: /quest/i,               w: 1440, h: 1600, name: "Quest" },
  { match: /valve\s*index|index/i, w: 1440, h: 1600, name: "Valve Index" },
  { match: /pico\s*4/i,            w: 2160, h: 2160, name: "Pico 4" },
  { match: /pimax\s*crystal/i,     w: 2880, h: 2880, name: "Pimax Crystal" },
  { match: /vive\s*pro\s*2/i,      w: 2448, h: 2448, name: "Vive Pro 2" },
  { match: /vive\s*pro/i,          w: 1440, h: 1600, name: "Vive Pro" },
  { match: /vive/i,                w: 1080, h: 1200, name: "Vive" },
];

function lookupHmdNative(model: string | undefined | null): { w: number; h: number; name: string } | null {
  if (!model) return null;
  for (const entry of HMD_NATIVE_PER_EYE) {
    if (entry.match.test(model)) return { w: entry.w, h: entry.h, name: entry.name };
  }
  return null;
}

export function TabSteamVR({ vrcRunning }: { vrcRunning: boolean }) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const pendingRefresh = useRef<number | null>(null);

  const fetchConfig = useCallback((preserveDirty = false) => {
    setLoading(true);
    ipc
      .readSteamVrConfig()
      .then((c) => {
        if ((c as any).error) {
          if ((c as any).error.code !== "not_found") {
            toast.error(t("settings.steamvr.errorRead", { defaultValue: "Failed to read steamvr.vrsettings: {{msg}}", msg: (c as any).error.message }));
          }
        } else {
          setConfig(c);
          if (!preserveDirty) setDirty(false);
        }
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(t("settings.steamvr.errorRead", { defaultValue: "Failed to read steamvr.vrsettings: {{msg}}", msg }));
      })
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Cleanup the deferred-refetch timeout on unmount. Must be declared
  // unconditionally ABOVE any early-return or React's hook-counting
  // breaks on re-renders (React error #310) — see the crash from v0.8.1
  // when config flipped from null → loaded mid-lifetime.
  useEffect(() => {
    return () => {
      if (pendingRefresh.current) {
        window.clearTimeout(pendingRefresh.current);
        pendingRefresh.current = null;
      }
    };
  }, []);

  if (!config || !config.ok) {
    return null;
  }

  const steamVrProcRunning = config.steamvr_running === true;
  // Only SteamVR itself blocks a safe write — its rolling autosave
  // races with our atomic rename. VRChat running is irrelevant when it's
  // in desktop mode; when it's in VR mode, SteamVR is already up and
  // steamVrProcRunning covers it. Locking on vrcRunning too was an
  // overcautious blanket ban that surprised users.
  const locked = steamVrProcRunning;
  void vrcRunning;
  const knownDevices: string[] = Array.isArray(config.knownDevices) ? config.knownDevices : [];

  const setField = (section: string, key: string, val: any) => {
    setDirty(true);
    setConfig((prev: any) => {
      const next = { ...prev };
      if (!next[section]) next[section] = {};
      next[section] = { ...next[section], [key]: val };
      return next;
    });
  };

  const applyPreset = (bandwidth: number, scale: number, refresh: number, smoothing: boolean, autoBandwidth: boolean, allowFiltering: boolean) => {
    setDirty(true);
    setConfig((prev: any) => {
      const next = { ...prev };
      next.driver_vrlink = {
        ...(prev.driver_vrlink ?? {}),
        targetBandwidth: bandwidth,
        automaticBandwidth: autoBandwidth,
      };
      next.steamvr = {
        ...(prev.steamvr ?? {}),
        supersampleScale: scale,
        preferredRefreshRate: refresh,
        motionSmoothing: smoothing,
        allowSupersampleFiltering: allowFiltering,
      };
      return next;
    });
    toast.success(t("settings.steamvr.presetApplied", { defaultValue: "Applied preset — click Save Settings to persist." }));
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
         toast.error(t("settings.steamvr.errorSave", { defaultValue: "Failed to save steamvr.vrsettings: {{msg}}", msg: (res as any).error.message }));
         return;
      }
      toast.success(t("settings.steamvr.successSave", { defaultValue: "Saved — SteamVR must be restarted for changes to take effect." }));
      setDirty(false);
      // Defer the refetch: SteamVR's rolling autosave can race with our
      // atomic rename if we re-read immediately. A 1 s gap + a "preserve
      // dirty state" flag means the user's in-flight edits don't blink
      // back to the on-disk baseline while we confirm the write landed.
      if (pendingRefresh.current) window.clearTimeout(pendingRefresh.current);
      pendingRefresh.current = window.setTimeout(() => {
        pendingRefresh.current = null;
        fetchConfig(false);
      }, 1000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("settings.steamvr.errorSave", { defaultValue: "Failed to save steamvr.vrsettings: {{msg}}", msg }));
    } finally {
      setSaving(false);
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
            <CardTitle className="flex items-center gap-2">
              {t("settings.steamvr.title", { defaultValue: "VR Streaming (Steam Link / SteamVR)" })}
            </CardTitle>
            <CardDescription className="max-w-[60ch]">
              {hw.gpuVendor || t("settings.steamvr.unknownGpu", { defaultValue: "Unknown GPU" })}
              {hw.hmdModel ? ` | ${hw.hmdModel}${hw.hmdSerial ? ` (${hw.hmdSerial})` : ""} via ${hw.hmdDriver || "?"}` : ""}
            </CardDescription>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {steamVrProcRunning ? (
              <Badge variant="warning" className="gap-1">
                <Lock className="size-3" />
                {t("settings.steamvr.vrRunning", { defaultValue: "VR Runtime Active" })}
              </Badge>
            ) : (
              <Badge variant="success" className="gap-1">
                <Unlock className="size-3" />
                {t("settings.steamvr.vrIdle", { defaultValue: "VR Runtime Idle" })}
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => fetchConfig()} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin size-3 mr-2" : "size-3 mr-2"} />
              {t("settings.steamvr.reload", { defaultValue: "Reload" })}
            </Button>
            <Button size="sm" onClick={saveConfig} disabled={saving || locked || !dirty} className={dirty && !saving && !locked ? "relative after:absolute after:top-1 after:right-1 after:size-1.5 after:rounded-full after:bg-[hsl(var(--primary))]" : ""}>
              {saving ? t("settings.steamvr.saving", { defaultValue: "Saving..." }) : dirty ? t("settings.steamvr.saveDirty", { defaultValue: "Save Settings *" }) : t("settings.steamvr.save", { defaultValue: "Save Settings" })}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {knownDevices.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-2 rounded bg-[hsl(var(--surface-raised))] border border-[hsl(var(--border))]">
            <span className="text-[12px] font-medium text-[hsl(var(--muted-foreground))] mr-1">
              {t("settings.steamvr.knownDevices", { defaultValue: "Detected VR Devices:" })}
            </span>
            {knownDevices.map((d) => (
              <Badge key={d} variant="secondary" className="text-[11px]">{d}</Badge>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 mb-2 p-2 rounded bg-[hsl(var(--surface-raised))] border border-[hsl(var(--border))]">
          <span className="text-[12px] font-medium text-[hsl(var(--muted-foreground))] mr-2">{t("settings.steamvr.quickPresets", { defaultValue: "Quick Presets:" })}</span>
          <Button size="sm" variant="secondary" onClick={() => applyPreset(50, 0.8, 90, true, true, true)} disabled={locked}>{t("settings.steamvr.presetPerformance", { defaultValue: "Performance (50Mbps)" })}</Button>
          <Button size="sm" variant="secondary" onClick={() => applyPreset(100, 1.0, 72, false, true, true)} disabled={locked}>{t("settings.steamvr.presetBalanced", { defaultValue: "Balanced (100Mbps)" })}</Button>
          <Button size="sm" variant="secondary" onClick={() => applyPreset(150, 1.5, 72, false, false, true)} disabled={locked}>{t("settings.steamvr.presetQuality", { defaultValue: "Quality (150Mbps)" })}</Button>
          <Button size="sm" variant="secondary" onClick={() => applyPreset(150, 1.2, 90, false, true, true)} disabled={locked} title={t("settings.steamvr.presetQuest3Hint", { defaultValue: "Tuned for Quest 3 via Steam Link" })}>{t("settings.steamvr.presetQuest3", { defaultValue: "Quest 3 Optimized" })}</Button>
        </div>

        {/* Quest 3 troubleshooting hint — shown when hardware looks like Quest */}
        {(hw.hmdModel?.toLowerCase().includes("quest") || knownDevices.some((d) => d.toLowerCase().includes("quest"))) && (
          <div className="rounded-[var(--radius-md)] border border-[hsl(var(--primary)/0.35)] bg-[hsl(var(--primary)/0.06)] px-4 py-3 text-[12px]">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--primary))]">
              {t("settings.steamvr.questSection.title", { defaultValue: "Quest troubleshooting" })}
            </div>
            <p className="mb-2 leading-relaxed text-[hsl(var(--muted-foreground))]">
              {t("settings.steamvr.questSection.body", {
                defaultValue:
                  "Edge jitter, blurriness or black-screen stalls on Quest are almost always runtime-layer (Steam Link / Virtual Desktop / Oculus Link), not VRChat itself. Try the Quest 3 Optimized preset above, lower Encoder Resolution if jitter persists, disable Space Warp / Motion Smoothing if double-image ghosting shows up, and confirm Windows GPU Scheduling is on.",
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void ipc.call("shell.openUrl", { url: "https://developer.oculus.com/documentation/tools/tools-ode/" })}>
                {t("settings.steamvr.questSection.odt", { defaultValue: "Oculus Debug Tool" })}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void ipc.call("shell.openUrl", { url: "ms-settings:display-advancedgraphics" })}>
                {t("settings.steamvr.questSection.gpuScheduling", { defaultValue: "GPU scheduling" })}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void ipc.call("shell.openUrl", { url: "https://github.com/dwgx/VRCSM#quest-3" })}>
                {t("settings.steamvr.questSection.guide", { defaultValue: "VRCSM guide" })}
              </Button>
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <SettingRow label={t("settings.steamvr.targetBandwidth.label", { defaultValue: "Target Bandwidth (Mbps)" })} hint={t("settings.steamvr.targetBandwidth.hint", { defaultValue: "Bitrate limit for Steam Link. Up to 150-200 for good routers." })}>
            <div className="w-[200px]">
              <Slider
                min={20}
                max={200}
                step={10}
                disabled={locked}
                value={link.targetBandwidth ?? 90}
                unit=" Mbps"
                onValueChange={(v) => setField("driver_vrlink", "targetBandwidth", v)}
              />
            </div>
          </SettingRow>
          <SettingRow label={t("settings.steamvr.automaticBandwidth.label", { defaultValue: "Automatic Bandwidth" })} hint={t("settings.steamvr.automaticBandwidth.hint", { defaultValue: "Let SteamVR dynamically drop bitrate on poor signal." })}>
            <Button size="sm" onClick={() => setField("driver_vrlink", "automaticBandwidth", !link.automaticBandwidth)} disabled={locked} variant={link.automaticBandwidth ? "default" : "outline"} className={link.automaticBandwidth ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.3)]" : ""}>
               {link.automaticBandwidth ? t("settings.steamvr.enabled", { defaultValue: "Enabled" }) : t("settings.steamvr.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          <SettingRow label={t("settings.steamvr.supersampleScale.label", { defaultValue: "Supersampling Scale" })} hint={t("settings.steamvr.supersampleScale.hint", { defaultValue: "Render scale (1.0 = native, 1.5 = high clarity, requires good GPU)" })}>
            <div className="w-[200px]">
              <Slider
                min={0.5}
                max={2.0}
                step={0.1}
                disabled={locked}
                value={steamvr.supersampleScale ?? 1.0}
                formatValue={(v) => `${v.toFixed(1)}×`}
                onValueChange={(v) => setField("steamvr", "supersampleScale", v)}
              />
            </div>
          </SettingRow>
          <SettingRow label={t("settings.steamvr.supersampleManualOverride.label", { defaultValue: "Supersample Manual Override" })} hint={t("settings.steamvr.supersampleManualOverride.hint", { defaultValue: "Forces custom scale instead of auto-adjusting." })}>
            <Button size="sm" onClick={() => setField("steamvr", "supersampleManualOverride", !steamvr.supersampleManualOverride)} disabled={locked} variant={steamvr.supersampleManualOverride ? "default" : "outline"} className={steamvr.supersampleManualOverride ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.3)]" : ""}>
               {steamvr.supersampleManualOverride ? t("settings.steamvr.enabled", { defaultValue: "Enabled" }) : t("settings.steamvr.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          <SettingRow label={t("settings.steamvr.refreshRate.label", { defaultValue: "Refresh Rate (Hz)" })} hint={t("settings.steamvr.refreshRate.hint", { defaultValue: "Must match the headset's allowed refresh rates (72, 80, 90, 120)" })}>
             <Input type="number" step="1" className="w-24 h-8 text-[12px]" disabled={locked} value={steamvr.preferredRefreshRate ?? 72} onChange={(e) => setField("steamvr", "preferredRefreshRate", Number(e.target.value))} />
          </SettingRow>
          <SettingRow label={t("settings.steamvr.motionSmoothing.label", { defaultValue: "Motion Smoothing" })} hint={t("settings.steamvr.motionSmoothing.hint", { defaultValue: "Synthesizes frames on lag. Good for poor frametimes, but can cause ghosting artifacts." })}>
            <Button size="sm" onClick={() => setField("steamvr", "motionSmoothing", !steamvr.motionSmoothing)} disabled={locked} variant={steamvr.motionSmoothing ? "default" : "outline"} className={steamvr.motionSmoothing ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.3)]" : ""}>
               {steamvr.motionSmoothing ? t("settings.steamvr.enabled", { defaultValue: "Enabled" }) : t("settings.steamvr.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          <SettingRow label={t("settings.steamvr.supersampleFiltering.label", { defaultValue: "Supersample Filtering" })} hint={t("settings.steamvr.supersampleFiltering.hint", { defaultValue: "Reduces aliasing at the cost of slight blur" })}>
            <Button size="sm" onClick={() => setField("steamvr", "allowSupersampleFiltering", !steamvr.allowSupersampleFiltering)} disabled={locked} variant={steamvr.allowSupersampleFiltering ? "default" : "outline"} className={steamvr.allowSupersampleFiltering ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.3)]" : ""}>
               {steamvr.allowSupersampleFiltering ? t("settings.steamvr.enabled", { defaultValue: "Enabled" }) : t("settings.steamvr.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          {(() => {
            const native = lookupHmdNative(hw.hmdModel);
            const scale = Number(steamvr.supersampleScale ?? 1.0);
            const w = native ? Math.round(native.w * scale) : null;
            const h = native ? Math.round(native.h * scale) : null;
            const applyScaleFrom = (targetPixels: number, nativePixels: number) => {
              if (!native || !targetPixels || Number.isNaN(targetPixels)) return;
              const raw = targetPixels / nativePixels;
              const clamped = Math.min(2.0, Math.max(0.5, raw));
              const snapped = Math.round(clamped * 10) / 10;
              setField("steamvr", "supersampleScale", snapped);
            };
            return (
              <SettingRow
                label={t("settings.steamvr.effectiveResolution.label", { defaultValue: "有效渲染分辨率 (每眼)" })}
                hint={t("settings.steamvr.effectiveResolution.hint", {
                  defaultValue:
                    "Steam Link 显示的 Encoder Resolution 就是这个值。改任一字段会反推 Supersampling Scale (0.5–2.0, 步进 0.1)。",
                })}
              >
                {native ? (
                  <div className="flex items-center gap-1.5 font-mono text-[12px]">
                    <Input
                      type="number"
                      min={Math.round(native.w * 0.5)}
                      max={Math.round(native.w * 2.0)}
                      step={Math.round(native.w * 0.1)}
                      className="w-20 h-7 text-right text-[12px]"
                      disabled={locked}
                      value={w ?? 0}
                      onChange={(e) => applyScaleFrom(Number(e.target.value), native.w)}
                    />
                    <span className="text-[hsl(var(--muted-foreground))]">×</span>
                    <Input
                      type="number"
                      min={Math.round(native.h * 0.5)}
                      max={Math.round(native.h * 2.0)}
                      step={Math.round(native.h * 0.1)}
                      className="w-20 h-7 text-right text-[12px]"
                      disabled={locked}
                      value={h ?? 0}
                      onChange={(e) => applyScaleFrom(Number(e.target.value), native.h)}
                    />
                    <span
                      className="ml-1 text-[10px] text-[hsl(var(--muted-foreground))]"
                      title={`${native.name} native ${native.w}×${native.h} × ${scale.toFixed(2)}×`}
                    >
                      {native.name} · {scale.toFixed(2)}×
                    </span>
                  </div>
                ) : (
                  <span className="text-[12px] text-[hsl(var(--muted-foreground))]">
                    {t("settings.steamvr.effectiveResolution.unknown", { defaultValue: "未知 HMD" })}
                  </span>
                )}
              </SettingRow>
            );
          })()}
        </div>
      </CardContent>
    </Card>
  );
}
