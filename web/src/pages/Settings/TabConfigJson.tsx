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

export function TabConfigJson({ vrcRunning }: { vrcRunning: boolean }) {
  const [config, setConfig] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(() => {
    setLoading(true);
    ipc
      .readConfig()
      .then((c) => setConfig(c))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("Failed to read config.json: " + msg);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const setField = (key: string, val: any) => {
    setConfig((prev) => ({ ...prev, [key]: val }));
  };

  const setNumberString = (key: string, val: string) => {
    if (!val) return;
    const n = Number(val);
    if (!isNaN(n)) setField(key, n);
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      await ipc.writeConfig({ config });
      toast.success("Successfully updated config.json!");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Failed to save config.json: " + msg);
    } finally {
      setSaving(false);
    }
  };

  const configKeys = [
    { key: "cache_directory", type: "string", label: "Cache Directory", hint: "Absolute path to Custom Cache directory" },
    { key: "cache_size", type: "number", label: "Cache Size (GB)", hint: "Maximum size of VRChat cache in gigabytes" },
    { key: "custom_load_screen_logo", type: "string", label: "Custom Loading Screen Logo", hint: "Absolute Path to a custom PNG logo for the loading screen" },
    { key: "camera_res_height", type: "number", label: "Camera Photo Height", hint: "Resolution of camera photos" },
    { key: "camera_res_width", type: "number", label: "Camera Photo Width", hint: "Resolution of camera photos" },
    { key: "fps_limit_desktop", type: "number", label: "FPS Limit (Desktop)", hint: "Maximum framerate in Desktop mode (0 = unlimited)" },
    { key: "fps_limit_vr", type: "number", label: "FPS Limit (VR)", hint: "Maximum framerate in VR mode (0 = unlimited)" },
    { key: "desktop_reticle", type: "boolean", label: "Desktop Reticle", hint: "Show center dot crosshair in Desktop mode" },
    { key: "ignore_particles", type: "boolean", label: "Ignore Particles", hint: "Dramatically improves performance in crowded worlds" },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>App Config (config.json)</CardTitle>
            <CardDescription className="max-w-[60ch]">
              Core Engine parameters located in AppData/LocalLow. Make sure to Save changes.
            </CardDescription>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {vrcRunning ? (
              <Badge variant="warning" className="gap-1">
                <Lock className="size-3" />
                VRChat is Running
              </Badge>
            ) : (
              <Badge variant="success" className="gap-1">
                <Unlock className="size-3" />
                VRChat is Idle
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={fetchConfig} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin size-3 mr-2" : "size-3 mr-2"} />
              Reload
            </Button>
            <Button size="sm" onClick={saveConfig} disabled={saving || vrcRunning}>
              {saving ? "Saving..." : "Save Config"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="grid gap-3 sm:grid-cols-2">
          {configKeys.map(({ key, type, label, hint }) => (
            <SettingRow key={key} label={label} hint={hint}>
              {type === "boolean" ? (
                <Button
                  size="sm"
                  variant={config[key] ? "default" : "outline"}
                  disabled={vrcRunning}
                  onClick={() => setField(key, !config[key])}
                  className={config[key] ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.25)] border-[hsl(var(--primary)/0.3)]" : ""}
                >
                  {config[key] ? "Enabled" : "Disabled"}
                </Button>
              ) : type === "string" ? (
                <Input
                  className="w-full h-8 text-[12px]"
                  value={config[key] ?? ""}
                  disabled={vrcRunning}
                  placeholder="(default)"
                  onChange={(e) => setField(key, e.target.value)}
                />
              ) : (
                <Input
                  className="w-24 h-8 text-[12px]"
                  type="number"
                  value={config[key] ?? ""}
                  disabled={vrcRunning}
                  placeholder="(default)"
                  onChange={(e) => setNumberString(key, e.target.value)}
                />
              )}
            </SettingRow>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
