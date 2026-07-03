import { useEffect, useMemo, useState } from "react";
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
import { useUiPrefBoolean, useUiPrefString } from "@/lib/ui-prefs";
import { DISCORD_PREF_CLIENT_ID, DISCORD_PREF_ENABLED } from "@/lib/useDiscordPresence";
import {
  NOTIFY_PREF_FRIEND_ONLINE,
  NOTIFY_PREF_INVITE,
  NOTIFY_PREF_FRIEND_REQUEST,
  NOTIFY_PREF_VR_OVERLAY,
} from "@/lib/notifications";
import { TTS_PREF_ENABLED, TTS_PREF_SCOPE, isTtsSupported } from "@/lib/tts";
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
  // Privacy / display toggles (VRCX parity)
  const [showInstanceId, setShowInstanceId] = useUiPrefBoolean("vrcsm.privacy.showInstanceId", true);
  const [hideUnfriends, setHideUnfriends] = useUiPrefBoolean("vrcsm.friendLog.hideUnfriends", false);
  const [statusShapes, setStatusShapes] = useUiPrefBoolean("vrcsm.a11y.statusShapes", false);
  const [userColorPref, setUserColorPref] = useUiPrefBoolean("vrcsm.a11y.userColor", false);

  const [autoStart, setAutoStart] = useState(false);
  useEffect(() => {
    ipc.autoStartGet().then((r) => setAutoStart(r.enabled)).catch(() => {});
  }, []);

  // Discord Rich Presence — opt-in, requires the user to register
  // their own application at https://discord.com/developers/applications
  // and paste the snowflake here. Disabled by default.
  const [discordEnabled, setDiscordEnabled] = useUiPrefBoolean(DISCORD_PREF_ENABLED, false);
  const [discordClientId, setDiscordClientId] = useUiPrefString(DISCORD_PREF_CLIENT_ID, "");
  const [screenshotsAutoInject, setScreenshotsAutoInject] = useUiPrefBoolean("vrcsm.screenshots.autoInject", true);

  // Desktop toast notifications — opt-in per event type (default OFF). The
  // useToastPrefsSync hook in App.tsx pushes these to the native host on
  // change via notify.setPrefs.
  const [toastFriendOnline, setToastFriendOnline] = useUiPrefBoolean(NOTIFY_PREF_FRIEND_ONLINE, false);
  const [toastInvite, setToastInvite] = useUiPrefBoolean(NOTIFY_PREF_INVITE, false);
  const [toastFriendRequest, setToastFriendRequest] = useUiPrefBoolean(NOTIFY_PREF_FRIEND_REQUEST, false);
  const [toastVrOverlay, setToastVrOverlay] = useUiPrefBoolean(NOTIFY_PREF_VR_OVERLAY, false);
  // Spoken announcements (Web Speech API). Independent of the toast channel.
  const ttsSupported = isTtsSupported();
  const [ttsEnabled, setTtsEnabled] = useUiPrefBoolean(TTS_PREF_ENABLED, false);
  const [ttsScope, setTtsScope] = useUiPrefString(TTS_PREF_SCOPE, "friends");

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
    // VRChat writes literal "None" when no XR device is active. Strip that
    // before classifying — otherwise desktop users get tagged as VR with a
    // device name of "None".
    const rawXr = parsedEnv?.xr_device?.trim() ?? "";
    const xrDevice = rawXr && rawXr.toLowerCase() !== "none" ? rawXr : undefined;
    const deviceModel = parsedEnv?.device_model?.trim() || undefined;
    const platform = parsedEnv?.platform?.trim() || undefined;
    const store = parsedEnv?.store?.trim() || undefined;
    const probeText = `${xrDevice ?? ""} ${deviceModel ?? ""} ${platform ?? ""}`.toLowerCase();
    if (xrDevice || /quest|vive|index|oculus|pimax|openvr|openxr/.test(probeText)) {
      return {
        label: t("settings.general.runtimeVr", { defaultValue: "VR" }),
        detail: xrDevice ?? deviceModel ?? platform ?? t("common.none"),
      };
    }
    if (platform?.toLowerCase().includes("android")) {
      return {
        label: t("settings.general.runtimeStandalone", { defaultValue: "Standalone" }),
        detail: deviceModel ?? platform ?? t("common.none"),
      };
    }
    return {
      label: t("settings.general.runtimeDesktop", { defaultValue: "Desktop" }),
      detail: deviceModel ?? platform ?? store ?? t("common.none"),
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
      // The host process will exit immediately after this returns
      // (WM_APP_FACTORY_RESET_QUIT is posted from the C++ handler so
      // background workers + DB get torn down cleanly before exit).
      // Trying to reload would race against window destruction; the
      // native host starts a delayed relaunch helper instead.
      toast.success(t("settings.app.factoryResetOkToast", {
        defaultValue: "VRCSM has been reset. It will restart automatically.",
      }));
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
            label={t("settings.autoStart.label", { defaultValue: "Launch with Windows" })}
            hint={t("settings.autoStart.hint", { defaultValue: "Start VRCSM automatically when you log in to Windows." })}
          >
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="font-mono text-[11px] uppercase tracking-wider">
                {autoStart ? "ON" : "OFF"}
              </span>
              <input
                type="checkbox"
                checked={autoStart}
                onChange={(e) => {
                  const v = e.target.checked;
                  setAutoStart(v);
                  ipc.autoStartSet(v).catch(() => {
                    setAutoStart(!v);
                    toast.error(
                      t("settings.autoStart.errorUpdate", {
                        defaultValue: "Failed to update autostart",
                      }),
                    );
                  });
                }}
                className="w-4 h-4 cursor-pointer border border-[hsl(var(--border-strong))]"
              />
            </label>
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
                defaultValue: "Clear VRC Cache",
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
          <SettingRow
            label={t("settings.general.showInstanceId", { defaultValue: "Show instance ID" })}
            hint={t("settings.general.showInstanceIdHint", {
              defaultValue: "When off, the instance number is hidden from friend locations. World, type and region still show.",
            })}
          >
            <Button size="sm" variant={showInstanceId ? "default" : "outline"} onClick={() => setShowInstanceId((current) => !current)}>
              {showInstanceId
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          <SettingRow
            label={t("settings.general.hideUnfriends", { defaultValue: "Hide unfriend events" })}
            hint={t("settings.general.hideUnfriendsHint", {
              defaultValue: "Hide \"removed you\" / unfriend rows from the friend activity log. Other events still show.",
            })}
          >
            <Button size="sm" variant={hideUnfriends ? "default" : "outline"} onClick={() => setHideUnfriends((current) => !current)}>
              {hideUnfriends
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          <SettingRow
            label={t("settings.general.statusShapes", { defaultValue: "Colorblind status shapes" })}
            hint={t("settings.general.statusShapesHint", {
              defaultValue: "Add a distinct shape to each status indicator (join me, active, ask me, busy, offline) so they're distinguishable without relying on color.",
            })}
          >
            <Button size="sm" variant={statusShapes ? "default" : "outline"} onClick={() => setStatusShapes((current) => !current)}>
              {statusShapes
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          <SettingRow
            label={t("settings.general.userColor", { defaultValue: "Per-user name colors" })}
            hint={t("settings.general.userColorHint", {
              defaultValue: "Tint each user's name with a stable, unique color derived from their ID, making people easier to recognize at a glance across feeds and rosters.",
            })}
          >
            <Button size="sm" variant={userColorPref ? "default" : "outline"} onClick={() => setUserColorPref((current) => !current)}>
              {userColorPref
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

      {/* Discord Rich Presence — opt-in. Requires the user to register
          their own Discord app and paste the snowflake here. */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.discord.title", { defaultValue: "Discord Rich Presence" })}</CardTitle>
          <CardDescription>
            {t("settings.discord.desc", {
              defaultValue:
                "Show your current VRChat world and player count in your Discord status. Register a Discord app at discord.com/developers/applications and paste its Application ID below.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <SettingRow
            label={t("settings.discord.enabled.label", { defaultValue: "Enable Rich Presence" })}
            hint={t("settings.discord.enabled.desc", {
              defaultValue: "Push activity to Discord whenever the VRChat instance changes.",
            })}
          >
            <Button
              variant={discordEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => setDiscordEnabled(!discordEnabled)}
              className="h-7 px-3 text-[12px]"
            >
              {discordEnabled
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          <SettingRow
            label={t("settings.discord.clientId.label", { defaultValue: "Application ID" })}
            hint={t("settings.discord.clientId.desc", {
              defaultValue: "The 18-19 digit snowflake from your Discord developer dashboard.",
            })}
          >
            <Input
              value={discordClientId}
              onChange={(e) => setDiscordClientId(e.target.value.replace(/\D/g, "").slice(0, 20))}
              placeholder={t("settings.discord.clientId.placeholder", {
                defaultValue: "1234567890000000000",
              })}
              className="h-8 w-[220px] font-mono text-[12px]"
            />
          </SettingRow>
        </CardContent>
      </Card>

      {/* Desktop toast notifications — native Windows Action Center toasts
          for social Pipeline events. Opt-in per type (default OFF). */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.notify.title", { defaultValue: "Desktop Notifications" })}</CardTitle>
          <CardDescription>
            {t("settings.notify.desc", {
              defaultValue:
                "Show native Windows notifications for live VRChat events while VRCSM is running. Each type is off by default.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <SettingRow
            label={t("settings.notify.friendOnline.label", { defaultValue: "Friend Comes Online" })}
            hint={t("settings.notify.friendOnline.desc", {
              defaultValue: "Toast when a friend logs in to VRChat.",
            })}
          >
            <Button
              variant={toastFriendOnline ? "default" : "outline"}
              size="sm"
              onClick={() => setToastFriendOnline(!toastFriendOnline)}
              className="h-7 px-3 text-[12px]"
            >
              {toastFriendOnline
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          <SettingRow
            label={t("settings.notify.invite.label", { defaultValue: "Invites" })}
            hint={t("settings.notify.invite.desc", {
              defaultValue: "Toast when you receive an instance invite.",
            })}
          >
            <Button
              variant={toastInvite ? "default" : "outline"}
              size="sm"
              onClick={() => setToastInvite(!toastInvite)}
              className="h-7 px-3 text-[12px]"
            >
              {toastInvite
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          <SettingRow
            label={t("settings.notify.friendRequest.label", { defaultValue: "Friend Requests" })}
            hint={t("settings.notify.friendRequest.desc", {
              defaultValue: "Toast when someone sends you a friend request.",
            })}
          >
            <Button
              variant={toastFriendRequest ? "default" : "outline"}
              size="sm"
              onClick={() => setToastFriendRequest(!toastFriendRequest)}
              className="h-7 px-3 text-[12px]"
            >
              {toastFriendRequest
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          <SettingRow
            label={t("settings.notify.vrOverlay.label", { defaultValue: "Show in VR Headset" })}
            hint={t("settings.notify.vrOverlay.desc", {
              defaultValue:
                "Also mirror the enabled notifications above into your headset via XSOverlay. Requires XSOverlay running.",
            })}
          >
            <Button
              variant={toastVrOverlay ? "default" : "outline"}
              size="sm"
              onClick={() => setToastVrOverlay(!toastVrOverlay)}
              className="h-7 px-3 text-[12px]"
            >
              {toastVrOverlay
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          <SettingRow
            label={t("settings.notify.tts.label", { defaultValue: "Speak Notifications" })}
            hint={
              ttsSupported
                ? t("settings.notify.tts.desc", {
                    defaultValue:
                      "Read live events aloud via your system voice while you're in VR.",
                  })
                : t("settings.notify.tts.unsupported", {
                    defaultValue: "Speech synthesis isn't available in this runtime.",
                  })
            }
          >
            <Button
              variant={ttsEnabled ? "default" : "outline"}
              size="sm"
              disabled={!ttsSupported}
              onClick={() => setTtsEnabled(!ttsEnabled)}
              className="h-7 px-3 text-[12px]"
            >
              {ttsEnabled
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
          </SettingRow>
          {ttsEnabled && ttsSupported ? (
            <SettingRow
              label={t("settings.notify.ttsScope.label", { defaultValue: "What to Speak" })}
              hint={t("settings.notify.ttsScope.desc", {
                defaultValue:
                  "Friends only announces friends coming online; All also speaks invites and friend requests.",
              })}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTtsScope(ttsScope === "all" ? "friends" : "all")}
                className="h-7 px-3 text-[12px]"
              >
                {ttsScope === "all"
                  ? t("settings.notify.ttsScope.all", { defaultValue: "All events" })
                  : t("settings.notify.ttsScope.friends", { defaultValue: "Friends only" })}
              </Button>
            </SettingRow>
          ) : null}
        </CardContent>
      </Card>

      {/* Screenshot metadata — VRCX-style PNG tEXt chunk auto-tagging. */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.screenshots.title", { defaultValue: "Screenshot metadata" })}</CardTitle>
          <CardDescription>
            {t("settings.screenshots.desc", {
              defaultValue:
                "Auto-tag new VRChat captures with the world ID, instance, and player list at the moment of capture. Tags survive in the PNG and are readable by exiftool / VRCX.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <SettingRow
            label={t("settings.screenshots.autoInject.label", { defaultValue: "Inject metadata on new captures" })}
            hint={t("settings.screenshots.autoInject.desc", {
              defaultValue: "Watches %USERPROFILE%\\Pictures\\VRChat. Inject is best-effort — radar must be attached to capture players.",
            })}
          >
            <Button
              variant={screenshotsAutoInject ? "default" : "outline"}
              size="sm"
              onClick={async () => {
                const next = !screenshotsAutoInject;
                setScreenshotsAutoInject(next);
                try {
                  if (next) await ipc.screenshotsWatcherStart();
                  else await ipc.screenshotsWatcherStop();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                }
              }}
              className="h-7 px-3 text-[12px]"
            >
              {screenshotsAutoInject
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
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
              {t("settings.app.clearCacheTitle", { defaultValue: "Clear VRC Cache" })}
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
