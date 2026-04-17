import { useState } from "react";
import { ipc } from "@/lib/ipc";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, Check, Trash2 } from "lucide-react";
import { SUPPORTED_LANGUAGES, changeLanguage } from "@/i18n";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingRow } from "./components/SettingRow";
import { cn } from "@/lib/utils";
import type { AppVersion } from "@/lib/types";

export function TabGeneral({ version }: { version: AppVersion | null }) {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.resolvedLanguage ?? i18n.language;

  const [factoryResetOpen, setFactoryResetOpen] = useState(false);
  const [factoryResetting, setFactoryResetting] = useState(false);
  const [liveRefresh, setLiveRefresh] = useState(() => localStorage.getItem("vrcsm.friends.liveRefresh") === "true");

  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [clearCacheWorking, setClearCacheWorking] = useState(false);
  const [selectedCacheKeys, setSelectedCacheKeys] = useState<Set<string>>(new Set(["cache_windows_player", "http_cache"]));

  const CACHE_CATEGORIES = [
    { key: "cache_windows_player", name: "Avatars & Worlds (Cache-WindowsPlayer)", desc: "Main VRChat cache folder taking up the most space." },
    { key: "http_cache", name: "Image Cache (HTTPCache)", desc: "Thumbnails and UI images." },
    { key: "texture_cache", name: "Texture Cache", desc: "Cached textures for avatars and worlds." },
    { key: "local_avatar_data", name: "Local Avatar Data", desc: "Local avatar configuration files." },
    { key: "local_player_moderations", name: "Local Moderations", desc: "Local instance mutes, blocks, and show-avatar toggles." },
    { key: "osc", name: "OSC Data", desc: "OSC log files and cache." }
  ];

  const handleToggleCache = (key: string) => {
    setSelectedCacheKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleExecuteCacheClear = async () => {
    if (selectedCacheKeys.size === 0) return;
    setClearCacheWorking(true);
    let successCount = 0;
    try {
      for (const key of selectedCacheKeys) {
        await ipc.call("delete.execute", { category: key });
        successCount++;
      }
      toast.success(t("settings.app.clearCacheSuccess", { defaultValue: `Successfully cleared ${successCount} cache categories.` }));
      setClearCacheOpen(false);
    } catch (e: any) {
      toast.error(t("settings.app.clearCacheError", { defaultValue: `Clear failed: ${e.message || e}` }));
    } finally {
      setClearCacheWorking(false);
    }
  };

  const runFactoryReset = async () => {
    setFactoryResetting(true);
    try {
      await ipc.call("factory_reset");
      toast.success("VRCSM has been reset. Wait a moment...");
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Factory reset failed: " + msg);
      setFactoryResetting(false);
      setFactoryResetOpen(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {/* ─── VRCSM shell preferences ────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>{t("settings.app.sectionTitle")}</CardTitle>
              <CardDescription>
                {t("settings.app.sectionDesc")}
              </CardDescription>
            </div>
            {version ? (
              <Badge variant="muted" className="font-mono">
                {t("app.version", {
                  version: version.version,
                  build: version.build,
                })}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <SettingRow label={t("settings.language")} hint={t("settings.languageHint")}>
            <div className="flex flex-wrap gap-2">
              {SUPPORTED_LANGUAGES.map((lang) => {
                const active = currentLang === lang.code;
                return (
                  <Button
                    key={lang.code}
                    size="sm"
                    variant={active ? "tonal" : "outline"}
                    onClick={() => void changeLanguage(lang.code)}
                  >
                    {active ? <Check className="size-3" /> : null}
                    {lang.native}
                  </Button>
                );
              })}
            </div>
          </SettingRow>
          <SettingRow label={t("settings.appTheme")} hint={t("settings.appThemeHint")}>
            <Badge variant="muted">{t("settings.dark")}</Badge>
          </SettingRow>
          <SettingRow
            label={t("settings.app.factoryResetLabel", {
              defaultValue: "Factory reset",
            })}
            hint={t("settings.app.factoryResetHint", {
              defaultValue:
                "Wipe VRCSM's saved session, thumbnail cache and logs. Does NOT touch VRChat's own data.",
            })}
          >
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFactoryResetOpen(true)}
              className="border-[hsl(var(--destructive)/0.55)] text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/0.12)]"
            >
              <Trash2 className="size-3 mr-1.5" />
              {t("settings.app.factoryResetLabel", {
                defaultValue: "Factory reset",
              })}
            </Button>
          </SettingRow>
          <SettingRow
            label={t("settings.app.clearVrcCacheLabel", {
              defaultValue: "Clear VRC Cache",
            })}
            hint={t("settings.app.clearVrcCacheHint", {
              defaultValue: "Selectively wipe VRChat caches like Avatars, Worlds, and Textures.",
            })}
          >
            <Button
              size="sm"
              variant="outline"
              onClick={() => setClearCacheOpen(true)}
              className="border-[hsl(var(--destructive)/0.55)] text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/0.12)]"
            >
              <Trash2 className="size-3 mr-1.5" />
              {t("settings.app.clearVrcCacheLabel", {
                defaultValue: "一键清理缓存",
              })}
            </Button>
          </SettingRow>
        </CardContent>
      </Card>

      {/* ─── Social & Tracking ────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.social.sectionTitle", { defaultValue: "Social & Tracking" })}</CardTitle>
          <CardDescription>
            {t("settings.social.sectionDesc", { defaultValue: "Configure live tracker and background polling for your friend list." })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <SettingRow
            label={t("settings.social.liveRefreshLabel", { defaultValue: "Live Friends Tracker" })}
            hint={t("settings.social.liveRefreshHint", { defaultValue: "Automatically query VRChat servers in the background to detect when friends come online or switch instances." })}
          >
            <Button
              size="sm"
              variant={liveRefresh ? "default" : "outline"}
              className={liveRefresh ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.25)] border-[hsl(var(--primary)/0.3)]" : ""}
              onClick={() => {
                const current = localStorage.getItem("vrcsm.friends.liveRefresh") === "true";
                localStorage.setItem("vrcsm.friends.liveRefresh", (!current).toString());
                setLiveRefresh(!current);
              }}
            >
              {liveRefresh ? "Enabled" : "Disabled"}
            </Button>
          </SettingRow>
          <SettingRow
            label={t("settings.social.refreshIntervalLabel", { defaultValue: "Polling Interval (Seconds)" })}
            hint={t("settings.social.refreshIntervalHint", { defaultValue: "How often the background tracker refreshes data. Lower values update faster but may trigger VRChat API rate limits (429)." })}
          >
            <Input
              type="number"
              min={10}
              max={600}
              defaultValue={parseInt(localStorage.getItem("vrcsm.friends.refreshInterval") || "60", 10)}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val >= 10) {
                  localStorage.setItem("vrcsm.friends.refreshInterval", val.toString());
                }
              }}
              className="w-24 h-8 text-[12px]"
            />
          </SettingRow>
        </CardContent>
      </Card>

      {/* Factory reset confirmation — destructive action, explicit opt-in. */}
      <Dialog
        open={factoryResetOpen}
        onOpenChange={(open) => {
          if (factoryResetting) return;
          setFactoryResetOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-[hsl(var(--destructive))]" />
              {t("settings.app.factoryResetConfirmTitle", {
                defaultValue: "Factory reset VRCSM?",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("settings.app.factoryResetConfirmBody", {
                defaultValue:
                  "This wipes VRCSM's saved VRChat session, thumbnail cache and logs under %LocalAppData%\\VRCSM. VRChat's own avatars, cache and registry settings are NOT affected. This action cannot be undone.",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFactoryResetOpen(false)}
              disabled={factoryResetting}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              variant="default"
              onClick={() => void runFactoryReset()}
              disabled={factoryResetting}
              className="bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:bg-[hsl(var(--destructive)/0.9)]"
            >
              {factoryResetting
                ? t("settings.app.factoryResetting", {
                    defaultValue: "Wiping…",
                  })
                : t("settings.app.factoryResetConfirm", {
                    defaultValue: "Wipe VRCSM data",
                  })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear VRC Cache Selection Dialog */}
      <Dialog
        open={clearCacheOpen}
        onOpenChange={(open) => {
          if (clearCacheWorking) return;
          setClearCacheOpen(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="size-4 text-[hsl(var(--destructive))]" />
              {t("settings.app.clearCacheTitle", { defaultValue: "一键清理缓存 (Clear VRC Cache)" })}
            </DialogTitle>
            <DialogDescription>
              {t("settings.app.clearCacheBody", { defaultValue: "Select which VRChat cache categories you want to safely wipe. Useful if the cache is taking up a massive amount of space or you want a fresh start." })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-4">
            {CACHE_CATEGORIES.map(cat => {
              const selected = selectedCacheKeys.has(cat.key);
              return (
                <div key={cat.key} className="flex items-start gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-[hsl(var(--muted))]">
                  <Button
                    size="icon"
                    variant={selected ? "default" : "outline"}
                    className={cn("size-4 mt-0.5 shrink-0 rounded-sm border p-0", selected && "bg-[hsl(var(--primary))] border-[hsl(var(--primary))]")}
                    onClick={() => handleToggleCache(cat.key)}
                  >
                    {selected && <Check className="size-3 text-primary-foreground stroke-[3]" />}
                  </Button>
                  <div className="flex flex-col min-w-0 flex-1 cursor-pointer" onClick={() => handleToggleCache(cat.key)}>
                    <span className={cn("text-[13px] font-medium leading-none", selected ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]")}>{cat.name}</span>
                    <span className="text-[11px] text-[hsl(var(--muted-foreground))] leading-snug mt-1">{cat.desc}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setClearCacheOpen(false)}
              disabled={clearCacheWorking}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              variant="default"
              onClick={() => void handleExecuteCacheClear()}
              disabled={clearCacheWorking || selectedCacheKeys.size === 0}
              className="bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:bg-[hsl(var(--destructive)/0.9)]"
            >
              {clearCacheWorking
                ? t("settings.app.factoryResetting", { defaultValue: "Wiping…" })
                : t("settings.app.executeClear", { defaultValue: "Clear Selected" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
