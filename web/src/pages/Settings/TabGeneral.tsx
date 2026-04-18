import { useMemo, useState } from "react";
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
import { useUiPrefBoolean } from "@/lib/ui-prefs";
import { cn } from "@/lib/utils";
import { useReport } from "@/lib/report-context";
import type { AppVersion } from "@/lib/types";

export function TabGeneral({ version }: { version: AppVersion | null }) {
  const { t, i18n } = useTranslation();
  const { report, refresh } = useReport();
  const currentLang = i18n.resolvedLanguage ?? i18n.language;

  const [factoryResetOpen, setFactoryResetOpen] = useState(false);
  const [factoryResetting, setFactoryResetting] = useState(false);
  const [liveRefresh, setLiveRefresh] = useState(() => localStorage.getItem("vrcsm.friends.liveRefresh") === "true");
  const [showWorldInspector, setShowWorldInspector] = useUiPrefBoolean("vrcsm.layout.worlds.inspector.visible", true);
  const [showProfileContext, setShowProfileContext] = useUiPrefBoolean("vrcsm.layout.profile.context.visible", true);
  const [showRadarTimeline, setShowRadarTimeline] = useUiPrefBoolean("vrcsm.layout.radar.timeline.visible", true);
  const [showVrchatSidebar, setShowVrchatSidebar] = useUiPrefBoolean("vrcsm.layout.vrchat.sidebar.visible", true);
  const [showFriendsDetail, setShowFriendsDetail] = useUiPrefBoolean("vrcsm.layout.friends.detail.visible", true);

  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [clearCacheWorking, setClearCacheWorking] = useState(false);
  const [selectedCacheKeys, setSelectedCacheKeys] = useState<Set<string>>(new Set(["cache_windows_player", "http_cache"]));

  const CACHE_CATEGORIES = useMemo(() => ([
    {
      key: "cache_windows_player",
      name: t("settings.app.cacheCategories.cacheWindowsPlayer.name", {
        defaultValue: "Avatars & Worlds (Cache-WindowsPlayer)",
      }),
      desc: t("settings.app.cacheCategories.cacheWindowsPlayer.desc", {
        defaultValue: "Main VRChat cache folder taking up the most space.",
      }),
    },
    {
      key: "http_cache",
      name: t("settings.app.cacheCategories.httpCache.name", {
        defaultValue: "Image Cache (HTTPCache)",
      }),
      desc: t("settings.app.cacheCategories.httpCache.desc", {
        defaultValue: "Thumbnails and UI images.",
      }),
    },
    {
      key: "texture_cache",
      name: t("settings.app.cacheCategories.textureCache.name", {
        defaultValue: "Texture Cache",
      }),
      desc: t("settings.app.cacheCategories.textureCache.desc", {
        defaultValue: "Cached textures for avatars and worlds.",
      }),
    },
    {
      key: "local_avatar_data",
      name: t("settings.app.cacheCategories.localAvatarData.name", {
        defaultValue: "Local Avatar Data",
      }),
      desc: t("settings.app.cacheCategories.localAvatarData.desc", {
        defaultValue: "Local avatar configuration files.",
      }),
    },
    {
      key: "local_player_moderations",
      name: t("settings.app.cacheCategories.localPlayerModerations.name", {
        defaultValue: "Local Moderations",
      }),
      desc: t("settings.app.cacheCategories.localPlayerModerations.desc", {
        defaultValue: "Local instance mutes, blocks, and show-avatar toggles.",
      }),
    },
  ]), [t]);
  const runtimeSummary = useMemo(() => {
    const parsedEnv = report?.logs.environment;
    const probeText = `${parsedEnv?.xr_device ?? ""} ${parsedEnv?.device_model ?? ""} ${parsedEnv?.platform ?? ""}`.toLowerCase();
    if (parsedEnv?.xr_device || /quest|vive|index|oculus|pimax|openxr|openvr|xr/.test(probeText)) {
      return {
        label: t("settings.general.runtimeVr", { defaultValue: "VR" }),
        detail: parsedEnv?.xr_device ?? parsedEnv?.device_model ?? parsedEnv?.platform ?? t("common.none"),
      };
    }
    if (parsedEnv?.platform?.toLowerCase().includes("android")) {
      return {
        label: t("settings.general.runtimeStandalone", { defaultValue: "Standalone" }),
        detail: parsedEnv.device_model ?? parsedEnv.platform,
      };
    }
    return {
      label: t("settings.general.runtimeDesktop", { defaultValue: "Desktop" }),
      detail: parsedEnv?.platform ?? parsedEnv?.store ?? parsedEnv?.device_model ?? t("common.none"),
    };
  }, [report?.logs.environment, t]);

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
        const result = await ipc.call<
          { category: string },
          { deleted?: number; error?: { code: string; message: string } }
        >("delete.execute", { category: key });
        if (result.error) {
          throw new Error(`${result.error.code}: ${result.error.message}`);
        }
        successCount++;
      }
      await refresh();
      toast.success(t("settings.app.clearCacheSuccess", {
        defaultValue: "Successfully cleared {{count}} cache categories.",
        count: successCount,
      }));
      setClearCacheOpen(false);
    } catch (e: any) {
      toast.error(t("settings.app.clearCacheError", {
        defaultValue: "Clear failed: {{error}}",
        error: e.message || e,
      }));
    } finally {
      setClearCacheWorking(false);
    }
  };

  const runFactoryReset = async () => {
    setFactoryResetting(true);
    try {
      await ipc.call("app.factoryReset");
      toast.success(t("settings.app.factoryResetOkToast", {
        defaultValue: "VRCSM has been reset. Wait a moment...",
      }));
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("settings.app.factoryResetFailed", {
        defaultValue: "Factory reset failed: {{error}}",
        error: msg,
      }));
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

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.general.layoutTitle", { defaultValue: "Workspace Layout" })}</CardTitle>
          <CardDescription>
            {t("settings.general.layoutDesc", {
              defaultValue: "Control which side panels stay visible by default across the app.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <SettingRow
            label={t("settings.general.worldInspector", { defaultValue: "Worlds inspector" })}
            hint={t("settings.general.worldInspectorHint", {
              defaultValue: "Keep the resizable world inspector open beside the map list.",
            })}
          >
            <Button size="sm" variant={showWorldInspector ? "default" : "outline"} onClick={() => setShowWorldInspector((current) => !current)}>
              {showWorldInspector
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          <SettingRow
            label={t("settings.general.profileContext", { defaultValue: "Profile live context" })}
            hint={t("settings.general.profileContextHint", {
              defaultValue: "Show the right-side live avatar and world context on My Profile.",
            })}
          >
            <Button size="sm" variant={showProfileContext ? "default" : "outline"} onClick={() => setShowProfileContext((current) => !current)}>
              {showProfileContext
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          <SettingRow
            label={t("settings.general.radarTimeline", { defaultValue: "Radar timeline" })}
            hint={t("settings.general.radarTimelineHint", {
              defaultValue: "Keep the live timeline dock visible on Radar & Log.",
            })}
          >
            <Button size="sm" variant={showRadarTimeline ? "default" : "outline"} onClick={() => setShowRadarTimeline((current) => !current)}>
              {showRadarTimeline
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          <SettingRow
            label={t("settings.general.friendsDetail", { defaultValue: "Friends detail pane" })}
            hint={t("settings.general.friendsDetailHint", {
              defaultValue: "Show the right-side profile detail pane on the Friends page.",
            })}
          >
            <Button size="sm" variant={showFriendsDetail ? "default" : "outline"} onClick={() => setShowFriendsDetail((current) => !current)}>
              {showFriendsDetail
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          <SettingRow
            label={t("settings.general.vrchatSidebar", { defaultValue: "VRChat workspace side stack" })}
            hint={t("settings.general.vrchatSidebarHint", {
              defaultValue: "When disabled, the right column folds below the main VRChat workspace instead of staying side-by-side.",
            })}
          >
            <Button size="sm" variant={showVrchatSidebar ? "default" : "outline"} onClick={() => setShowVrchatSidebar((current) => !current)}>
              {showVrchatSidebar
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.general.runtimeTitle", { defaultValue: "Runtime Detection" })}</CardTitle>
          <CardDescription>
            {t("settings.general.runtimeDesc", {
              defaultValue: "Heuristic environment summary parsed from VRChat logs on this machine.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pt-0 sm:grid-cols-2">
          <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
              {t("settings.general.runtimeMode", { defaultValue: "Runtime mode" })}
            </div>
            <div className="mt-1 text-[18px] font-semibold text-[hsl(var(--foreground))]">
              {runtimeSummary.label}
            </div>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
              {t("settings.general.runtimeDetail", { defaultValue: "Detected detail" })}
            </div>
            <div className="mt-1 break-all text-[12px] text-[hsl(var(--foreground))]">
              {runtimeSummary.detail}
            </div>
          </div>
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
              {liveRefresh
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
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
