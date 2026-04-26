import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Wifi, Volume2, AlertTriangle, CheckCircle2, RefreshCcw, Cpu } from "lucide-react";

interface DiagResult {
  adapters: Array<{ name: string; description: string; ipAddress: string; isVirtual: boolean; isUp: boolean }>;
  networkWarnings: string[];
  steamvrRunning: boolean;
  hmdModel: string;
  hmdDriver: string;
  preferredRefreshRate: number;
  supersampleScale: number;
  targetBandwidth: number;
  motionSmoothing: boolean;
  allowSupersampleFiltering: boolean;
  preferredCodec: string;
  gpuName: string;
  gpuVramBytes: number;
  gpuDriverVersion: string;
  defaultPlaybackDevice: string;
  defaultRecordingDevice: string;
  steamSpeakersFound: boolean;
  steamMicFound: boolean;
  vrlinkErrors: string[];
  vrlinkBadLinkEvents: number;
  vrlinkDroppedFrames: number;
  vrlinkAvgBitrateMbps: number;
  vrlinkMaxLatencyMs: number;
}

function formatVram(bytes: number): string {
  if (!bytes) return "—";
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(1)} GiB` : `${(bytes / (1024 * 1024)).toFixed(0)} MiB`;
}

export function TabVrDiag() {
  const { t } = useTranslation();
  const [result, setResult] = useState<DiagResult | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      const r = await ipc.vrDiagnose();
      setResult(r as unknown as DiagResult);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  const switchAudio = useCallback(async (deviceId: string, role: string) => {
    try {
      await ipc.vrAudioSwitch(deviceId, role);
      toast.success(t("settings.vrDiag.audioSwitched", { defaultValue: "Audio device switched" }));
      void run();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [run, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="unity-panel-header flex items-center justify-between">
        <span>{t("settings.vrDiag.heading", { defaultValue: "VR Diagnostics" })}</span>
        <Button variant="outline" size="sm" onClick={() => void run()} disabled={running}>
          <RefreshCcw className={running ? "size-3 animate-spin" : "size-3"} />
          {t("settings.vrDiag.runDiag", { defaultValue: "Run Diagnostics" })}
        </Button>
      </div>
      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
        {t("settings.vrDiag.blurb", {
          defaultValue: "Scans network adapters, SteamVR settings, audio routing, and vrlink connection status. Use this to troubleshoot Quest wireless streaming issues.",
        })}
      </p>

      {!result && !running && (
        <Card className="unity-panel">
          <CardContent className="p-6 text-center">
            <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("settings.vrDiag.clickToStart", { defaultValue: "Click 'Run Diagnostics' to start." })}
            </p>
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          {/* SteamVR Status */}
          <Card className="unity-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-[12px] font-mono uppercase tracking-wider flex items-center gap-2">
                <Activity className="size-3" />
                SteamVR
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-[11px] font-mono">
              <div className="flex justify-between">
                <span>Status</span>
                <Badge variant={result.steamvrRunning ? "default" : "outline"}>
                  {result.steamvrRunning ? "Running" : "Stopped"}
                </Badge>
              </div>
              {result.hmdModel && (
                <div className="flex justify-between"><span>HMD</span><span>{result.hmdModel}</span></div>
              )}
              {result.hmdDriver && (
                <div className="flex justify-between"><span>Driver</span><span>{result.hmdDriver}</span></div>
              )}
              {result.preferredRefreshRate > 0 && (
                <div className="flex justify-between"><span>Refresh Rate</span><span>{result.preferredRefreshRate} Hz</span></div>
              )}
              {result.supersampleScale > 0 && (
                <div className="flex justify-between"><span>Supersampling</span><span>{result.supersampleScale}x</span></div>
              )}
              {result.targetBandwidth > 0 && (
                <div className="flex justify-between"><span>Target Bandwidth</span><span>{result.targetBandwidth} Mbps</span></div>
              )}
              <div className="flex justify-between">
                <span>Motion Smoothing</span>
                <span>{result.motionSmoothing ? "On" : "Off"}</span>
              </div>
              <div className="flex justify-between">
                <span>Supersample Filtering</span>
                <span>{result.allowSupersampleFiltering ? "On" : "Off"}</span>
              </div>
              {result.preferredCodec && (
                <div className="flex justify-between"><span>Preferred Codec</span><span>{result.preferredCodec}</span></div>
              )}
            </CardContent>
          </Card>

          {/* GPU */}
          {(result.gpuName || result.gpuVramBytes > 0) && (
            <Card className="unity-panel">
              <CardHeader className="pb-2">
                <CardTitle className="text-[12px] font-mono uppercase tracking-wider flex items-center gap-2">
                  <Cpu className="size-3" />
                  GPU
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-[11px] font-mono">
                {result.gpuName && (
                  <div className="flex justify-between gap-3">
                    <span>Adapter</span>
                    <span className="text-right">{result.gpuName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>VRAM</span>
                  <span>{formatVram(result.gpuVramBytes)}</span>
                </div>
                {result.gpuDriverVersion && (
                  <div className="flex justify-between">
                    <span>Driver</span>
                    <span>{result.gpuDriverVersion}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Network */}
          <Card className="unity-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-[12px] font-mono uppercase tracking-wider flex items-center gap-2">
                <Wifi className="size-3" />
                {t("settings.vrDiag.network", { defaultValue: "Network" })}
                {result.networkWarnings.length > 0 ? (
                  <Badge variant="destructive">{result.networkWarnings.length} warnings</Badge>
                ) : (
                  <Badge variant="default"><CheckCircle2 className="size-2.5 mr-1" />OK</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-[11px] font-mono">
              {result.networkWarnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-[hsl(var(--destructive))]">
                  <AlertTriangle className="size-3 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
              {result.adapters.filter(a => a.isUp).map((a, i) => (
                <div key={i} className="flex justify-between">
                  <span className={a.isVirtual ? "text-[hsl(var(--destructive))]" : ""}>
                    {a.name} {a.isVirtual && "⚠ virtual"}
                  </span>
                  <span>{a.ipAddress || "—"}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Audio */}
          <Card className="unity-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-[12px] font-mono uppercase tracking-wider flex items-center gap-2">
                <Volume2 className="size-3" />
                {t("settings.vrDiag.audio", { defaultValue: "Audio" })}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-[11px] font-mono">
              <div className="flex justify-between items-center">
                <span>Playback</span>
                <span>{result.defaultPlaybackDevice || "—"}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Recording</span>
                <span>{result.defaultRecordingDevice || "—"}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Steam Streaming Speakers</span>
                <Badge variant={result.steamSpeakersFound ? "default" : "destructive"}>
                  {result.steamSpeakersFound ? "Found" : "Missing"}
                </Badge>
              </div>
              <div className="flex justify-between items-center">
                <span>Steam Streaming Microphone</span>
                <Badge variant={result.steamMicFound ? "default" : "destructive"}>
                  {result.steamMicFound ? "Found" : "Missing"}
                </Badge>
              </div>
              {result.steamSpeakersFound && !result.defaultPlaybackDevice.includes("Steam Streaming") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit mt-1"
                  onClick={() => void switchAudio("{0.0.0.00000000}.{a6f25809-2ac9-4127-be4f-6ab45a4048c5}", "playback")}
                >
                  {t("settings.vrDiag.switchToSteamSpeakers", { defaultValue: "Switch playback to Steam Streaming Speakers" })}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* vrlink link quality */}
          {(result.vrlinkAvgBitrateMbps > 0 ||
            result.vrlinkMaxLatencyMs > 0 ||
            result.vrlinkDroppedFrames > 0) && (
            <Card className="unity-panel">
              <CardHeader className="pb-2">
                <CardTitle className="text-[12px] font-mono uppercase tracking-wider flex items-center gap-2">
                  <Activity className="size-3" />
                  {t("settings.vrDiag.linkQuality", { defaultValue: "Link Quality" })}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-[11px] font-mono">
                {result.vrlinkAvgBitrateMbps > 0 && (
                  <div className="flex justify-between">
                    <span>{t("settings.vrDiag.avgBitrate", { defaultValue: "Avg Bitrate" })}</span>
                    <span>{result.vrlinkAvgBitrateMbps.toFixed(1)} Mbps</span>
                  </div>
                )}
                {result.vrlinkMaxLatencyMs > 0 && (
                  <div className="flex justify-between">
                    <span>{t("settings.vrDiag.maxLatency", { defaultValue: "Max Latency" })}</span>
                    <span>{result.vrlinkMaxLatencyMs.toFixed(1)} ms</span>
                  </div>
                )}
                {result.vrlinkDroppedFrames > 0 && (
                  <div className="flex justify-between">
                    <span>{t("settings.vrDiag.droppedFrames", { defaultValue: "Dropped Frames" })}</span>
                    <Badge variant="destructive">{result.vrlinkDroppedFrames}</Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* vrlink errors */}
          {result.vrlinkErrors.length > 0 && (
            <Card className="unity-panel">
              <CardHeader className="pb-2">
                <CardTitle className="text-[12px] font-mono uppercase tracking-wider flex items-center gap-2">
                  <AlertTriangle className="size-3" />
                  vrlink Issues
                  <Badge variant="destructive">{result.vrlinkErrors.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-[10px] font-mono max-h-[200px] overflow-y-auto">
                {result.vrlinkErrors.map((e, i) => (
                  <div key={i} className="text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border)/0.3)] py-0.5 last:border-0">
                    {e}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
