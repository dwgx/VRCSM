import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/ipc";
import type { SteamVrLinkBackupItem, SteamVrLinkDiagnostic, SteamVrLinkRepairPlan, SteamVrLinkRepairResult, SteamVrLinkSettingsProfile } from "@/lib/types";
import { toast } from "sonner";
import { AlertTriangle, FileSearch, Lock, RefreshCw, ShieldCheck, Unlock, Wrench } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

const SUMMARY_KEY_BY_TEXT: Record<string, string> = {
  "VRLink session mismatch: Quest packets reached the PC, but SteamVR rejected the wireless HMD session.": "vrlinkSessionMismatch",
  "SteamVR beta or user-level beta markers are present; this can keep SteamVR on a VRLink build with broken pairing state.": "betaMarkers",
  "Recent logs include SteamVR Ready and no invalid-session burst in the scanned tail.": "readyNoInvalid",
  "SteamVR shut down after losing its master process; check VRLink pairing and runtime process stability.": "lostMaster",
  "Steam Link / Quest pairing records are present; stale entries can be reset safely after backup.": "pairingRecords",
  "No decisive VRLink failure signature found in the scanned SteamVR logs.": "noSignature",
};

const RECOMMENDATION_KEY_BY_TEXT: Record<string, string> = {
  "Reset Steam Link / Quest pairing cache and re-pair from the headset.": "resetPairing",
  "Remove SteamVR BetaKey and validate AppID 250820 to return to the stable branch.": "removeManifestBeta",
  "Remove user-level 250820-beta / BetaKey markers from Steam localconfig.vdf.": "removeUserBeta",
  "Back up localconfig.vdf, then remove stale Oculus Quest / Steam Link streaming devices.": "removeQuestDevices",
  "Let Steam finish SteamVR update/validation before retrying Steam Link.": "finishUpdate",
  "Retry from the headset first; if it fails, run dry-run repair and compare the new log tail.": "retryThenDryRun",
};

const PLAN_ACTION_KEY_BY_TEXT: Record<string, string> = {
  "Stop SteamVR/Steam": "stopSteamVrSteam",
  "Back up localconfig.vdf": "backupLocalconfig",
  "Remove Quest streaming device blocks": "removeQuestBlocks",
  "Clear SteamVR htmlcache": "clearHtmlcache",
  "Stop Steam/SteamVR": "stopSteamSteamVr",
  "Back up appmanifest/localconfig/SteamVR settings": "backupAll",
  "Move steamvr.vrsettings and vrstats": "moveRuntimeState",
  "Move config/vrlink and remoteclients.vdf": "moveVrlinkConfig",
  "Archive old VRLink logs": "archiveLogs",
  "Open steam://validate/250820": "openValidate",
  "Back up config/vrlink and remoteclients.vdf": "backupVrlinkConfig",
  "Back up SteamVR htmlcache": "backupHtmlcache",
  "Back up appmanifest/localconfig": "backupManifestLocalconfig",
  "Remove BetaKey / 250820-beta markers": "removeBetaMarkers",
  "Back up steamvr.vrsettings": "backupVrsettings",
  "Set 80 Mbps automatic bandwidth": "set80Auto",
  "Set 1.0x supersampling": "set1x",
  "Set 72 Hz": "set72hz",
  "Disable motion smoothing": "disableMotionSmoothing",
};

function firstNumber(text: string | undefined): number | undefined {
  const match = text?.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

export function TabSteamVR({ vrcRunning }: { vrcRunning: boolean }) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [linkDiag, setLinkDiag] = useState<SteamVrLinkDiagnostic | null>(null);
  const [linkRepair, setLinkRepair] = useState<SteamVrLinkRepairResult | null>(null);
  const [linkBusy, setLinkBusy] = useState<"diagnose" | "dryRun" | "repair" | null>(null);
  const [linkBackups, setLinkBackups] = useState<SteamVrLinkBackupItem[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<
    | { kind: "repair"; planId: string }
    | { kind: "restore"; backup: SteamVrLinkBackupItem }
    | null
  >(null);
  const [confirmPreview, setConfirmPreview] = useState<SteamVrLinkRepairResult | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
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

  const loadBackups = useCallback(async () => {
    try {
      const res = await ipc.listSteamVrLinkBackups();
      setLinkBackups(res.items ?? []);
    } catch {
      setLinkBackups([]);
    }
  }, []);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

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

  const applySettingsProfile = (profile: SteamVrLinkSettingsProfile) => {
    setDirty(true);
    setConfig((prev: any) => ({
      ...prev,
      driver_vrlink: {
        ...(prev.driver_vrlink ?? {}),
        ...(profile.updates.driver_vrlink ?? {}),
      },
      steamvr: {
        ...(prev.steamvr ?? {}),
        ...(profile.updates.steamvr ?? {}),
      },
    }));
    toast.success(t("settings.steamvr.profileApplied", {
      name: profile.title,
      defaultValue: "Applied {{name}} — click Save Settings to persist.",
    }));
  };

  const issueBadgeVariant = (severity: string | undefined) => {
    if (severity === "critical") return "destructive" as const;
    if (severity === "warning") return "warning" as const;
    if (severity === "ok") return "success" as const;
    return "secondary" as const;
  };

  const severityLabel = (severity: string | undefined) =>
    t(`settings.steamvr.linkRepair.severity.${severity ?? "info"}`, {
      defaultValue: severity ?? "info",
    });

  const riskLabel = (risk: string | undefined) =>
    t(`settings.steamvr.linkRepair.risk.${risk ?? "low"}`, {
      defaultValue: risk ?? "low",
    });

  const translateSummary = (summary: string | undefined) => {
    if (!summary) return "";
    const key = SUMMARY_KEY_BY_TEXT[summary];
    return key
      ? t(`settings.steamvr.linkRepair.summary.${key}`, { defaultValue: summary })
      : summary;
  };

  const translateRecommendation = (line: string) => {
    const key = RECOMMENDATION_KEY_BY_TEXT[line];
    return key
      ? t(`settings.steamvr.linkRepair.recommendations.${key}`, { defaultValue: line })
      : line;
  };

  const translateIssueTitle = (issue: { id: string; title: string }) =>
    t(`settings.steamvr.linkRepair.issuesMap.${issue.id}.title`, {
      defaultValue: issue.title,
    });

  const translateIssueDetail = (issue: { id: string; detail: string }) =>
    t(`settings.steamvr.linkRepair.issuesMap.${issue.id}.detail`, {
      count: firstNumber(issue.detail),
      bandwidth: firstNumber(issue.detail),
      defaultValue: issue.detail,
    });

  const translatePlanTitle = (planId: string | undefined, fallback?: string) =>
    t(`settings.steamvr.linkRepair.plans.${planId ?? "unknown"}.title`, {
      defaultValue: fallback ?? planId ?? "",
    });

  const translatePlanDescription = (plan: SteamVrLinkRepairPlan) =>
    t(`settings.steamvr.linkRepair.plans.${plan.id}.description`, {
      defaultValue: plan.description,
    });

  const translatePlanAction = (action: string) => {
    const key = PLAN_ACTION_KEY_BY_TEXT[action];
    return key
      ? t(`settings.steamvr.linkRepair.planActions.${key}`, { defaultValue: action })
      : action;
  };

  const translateProfileTitle = (profile: SteamVrLinkSettingsProfile) =>
    t(`settings.steamvr.linkRepair.profiles.${profile.id}.title`, {
      defaultValue: profile.title,
    });

  const translateProfileNote = (profile: SteamVrLinkSettingsProfile) =>
    profile.note
      ? t(`settings.steamvr.linkRepair.profiles.${profile.id}.note`, {
          defaultValue: profile.note,
        })
      : "";

  const translateRepairAction = (action: string) => {
    let match = action.match(/^Stop process (.+) \((\d+)\)$/);
    if (match) {
      return t("settings.steamvr.linkRepair.repairActions.stopProcess", {
        name: match[1],
        pid: match[2],
        defaultValue: action,
      });
    }
    match = action.match(/^Move (.+) into backup$/);
    if (match) {
      return t("settings.steamvr.linkRepair.repairActions.moveIntoBackup", {
        path: match[1],
        defaultValue: action,
      });
    }
    match = action.match(/^Archive old SteamVR log (.+)$/);
    if (match) {
      return t("settings.steamvr.linkRepair.repairActions.archiveLog", {
        path: match[1],
        defaultValue: action,
      });
    }
    match = action.match(/^Back up and remove (.+)$/);
    if (match) {
      return t("settings.steamvr.linkRepair.repairActions.backupRemove", {
        path: match[1],
        defaultValue: action,
      });
    }
    match = action.match(/^Back up (.+)$/);
    if (match) {
      return t("settings.steamvr.linkRepair.repairActions.backupPath", {
        path: match[1],
        defaultValue: action,
      });
    }
    match = action.match(/^Restore (.+) from (.+)$/);
    if (match) {
      return t("settings.steamvr.linkRepair.repairActions.restorePath", {
        path: match[1],
        backup: match[2],
        defaultValue: action,
      });
    }
    match = action.match(/^Remove BetaKey lines from (.+)$/);
    if (match) {
      return t("settings.steamvr.linkRepair.repairActions.removeManifestBeta", {
        path: match[1],
        defaultValue: action,
      });
    }
    match = action.match(/^Remove 250820-beta \/ BetaKey markers from (.+)$/);
    if (match) {
      return t("settings.steamvr.linkRepair.repairActions.removeUserBeta", {
        path: match[1],
        defaultValue: action,
      });
    }
    match = action.match(/^Remove Quest \/ Steam Link streaming device blocks from (.+)$/);
    if (match) {
      return t("settings.steamvr.linkRepair.repairActions.removeQuestBlocks", {
        path: match[1],
        defaultValue: action,
      });
    }
    if (action === "Apply safe Quest streaming settings: 80 Mbps auto bandwidth, 1.0x supersampling, 72 Hz, motion smoothing off") {
      return t("settings.steamvr.linkRepair.repairActions.applySafeStreaming", { defaultValue: action });
    }
    if (action === "Open steam://validate/250820 after repair") {
      return t("settings.steamvr.linkRepair.repairActions.openValidateAfter", { defaultValue: action });
    }
    return action;
  };

  const repairParamsForPlan = (planId: string, dryRun: boolean) => ({
    planId,
    dryRun,
    clearRuntimeConfig: planId === "full-vrlink-reset",
    clearHtmlCache: planId === "pairing-reset" || planId === "full-vrlink-reset",
    clearPairing: planId === "pairing-reset" || planId === "full-vrlink-reset",
    removeBeta: planId === "stable-validate" || planId === "full-vrlink-reset",
    stopSteam: planId !== "safe-streaming" && planId !== "quest-link-backup",
    launchValidate: !dryRun && (planId === "stable-validate" || planId === "full-vrlink-reset"),
    clearVrlinkConfig: planId === "full-vrlink-reset",
    clearRemoteClients: planId === "full-vrlink-reset",
    archiveLogs: planId === "full-vrlink-reset",
    applySafeStreamingSettings: planId === "safe-streaming",
    backupOnly: planId === "quest-link-backup",
  });

  const previewRepairRequest = async (request: typeof confirmRequest) => {
    if (!request) return;
    setConfirmBusy(true);
    setConfirmPreview(null);
    try {
      const res =
        request.kind === "repair"
          ? await ipc.repairSteamVrLink(repairParamsForPlan(request.planId, true))
          : await ipc.restoreSteamVrLinkBackup({
              backupDir: request.backup.path,
              dryRun: true,
              stopSteam: true,
            });
      setConfirmPreview(res);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("settings.steamvr.linkRepair.previewFailed", { msg, defaultValue: "Preview failed: {{msg}}" }));
      setConfirmRequest(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const openRepairDialog = (planId: string) => {
    const request = { kind: "repair" as const, planId };
    setConfirmRequest(request);
    void previewRepairRequest(request);
  };

  const openRestoreDialog = (backup: SteamVrLinkBackupItem) => {
    const request = { kind: "restore" as const, backup };
    setConfirmRequest(request);
    void previewRepairRequest(request);
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

  const diagnoseSteamLink = async () => {
    setLinkBusy("diagnose");
    try {
      const res = await ipc.diagnoseSteamVrLink();
      setLinkDiag(res);
      setLinkRepair(null);
      const invalid = res.logs?.counts?.invalid_session ?? 0;
      if (invalid > 0) {
        toast.warning(t("settings.steamvr.linkRepair.invalidSessionToast", {
          count: invalid,
          defaultValue: "VRLink invalid-session packets found: {{count}}",
        }));
      } else {
        toast.success(t("settings.steamvr.linkRepair.diagnoseDone", { defaultValue: "Steam Link diagnostics complete." }));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("settings.steamvr.linkRepair.diagnoseFailed", { msg, defaultValue: "Steam Link diagnostics failed: {{msg}}" }));
    } finally {
      setLinkBusy(null);
    }
  };

  const repairSteamLink = async (dryRun: boolean, planId = "full-vrlink-reset") => {
    setLinkBusy(dryRun ? "dryRun" : "repair");
    try {
      const res = await ipc.repairSteamVrLink(repairParamsForPlan(planId, dryRun));
      setLinkRepair(res);
      void loadBackups();
      if (dryRun) {
        toast.info(t("settings.steamvr.linkRepair.dryRunDone", { defaultValue: "Dry-run complete. Review the planned repair steps." }));
      } else if (planId === "quest-link-backup") {
        toast.success(t("settings.steamvr.linkRepair.backupDone", { defaultValue: "Quest Link settings backup created." }));
      } else {
        toast.success(t("settings.steamvr.linkRepair.repairDone", { defaultValue: "Repair applied. Steam validation has been opened." }));
        void diagnoseSteamLink();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("settings.steamvr.linkRepair.repairFailed", { msg, defaultValue: "Steam Link repair failed: {{msg}}" }));
    } finally {
      setLinkBusy(null);
    }
  };

  const restoreSteamLinkBackup = async (backupDir: string) => {
    setLinkBusy("repair");
    try {
      const res = await ipc.restoreSteamVrLinkBackup({
        backupDir,
        dryRun: false,
        stopSteam: true,
      });
      setLinkRepair(res);
      void loadBackups();
      toast.success(t("settings.steamvr.linkRepair.restoreDone", {
        count: res.restored ?? 0,
        defaultValue: "Restored {{count}} backed-up item(s).",
      }));
      void diagnoseSteamLink();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("settings.steamvr.linkRepair.restoreFailed", { msg, defaultValue: "Restore failed: {{msg}}" }));
    } finally {
      setLinkBusy(null);
    }
  };

  const confirmCurrentRequest = async () => {
    if (!confirmRequest) return;
    setConfirmBusy(true);
    try {
      if (confirmRequest.kind === "repair") {
        await repairSteamLink(false, confirmRequest.planId);
      } else {
        await restoreSteamLinkBackup(confirmRequest.backup.path);
      }
      setConfirmRequest(null);
      setConfirmPreview(null);
    } finally {
      setConfirmBusy(false);
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
          <Button size="sm" variant="secondary" onClick={() => applyPreset(50, 0.8, 72, false, true, true)} disabled={locked}>{t("settings.steamvr.presetPerformance", { defaultValue: "Performance (50Mbps)" })}</Button>
          <Button size="sm" variant="secondary" onClick={() => applyPreset(90, 1.0, 72, false, true, true)} disabled={locked}>{t("settings.steamvr.presetBalanced", { defaultValue: "Balanced (90Mbps)" })}</Button>
          <Button size="sm" variant="secondary" onClick={() => applyPreset(130, 1.2, 90, false, true, true)} disabled={locked}>{t("settings.steamvr.presetQuality", { defaultValue: "Quality (130Mbps)" })}</Button>
          <Button size="sm" variant="secondary" onClick={() => applyPreset(90, 1.0, 72, false, true, true)} disabled={locked} title={t("settings.steamvr.presetQuest3Hint", { defaultValue: "Tuned for Quest 3 via Steam Link" })}>{t("settings.steamvr.presetQuest3", { defaultValue: "Quest 3 Stable" })}</Button>
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

        <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[12px] font-semibold">
                <AlertTriangle className="size-4 text-[hsl(var(--warning))]" />
                <span>{t("settings.steamvr.linkRepair.title", { defaultValue: "Steam Link / Quest connection repair" })}</span>
              </div>
              <p className="mt-1 max-w-[72ch] text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                {t("settings.steamvr.linkRepair.body", {
                  defaultValue:
                    "Diagnoses VRLink invalid session ID, WirelessHmdNotConnected, stale Quest pairing cache, SteamVR beta markers, and incomplete SteamVR updates. Repair mode backs up first and defaults to a dry-run preview.",
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={diagnoseSteamLink} disabled={linkBusy !== null}>
                <FileSearch className={linkBusy === "diagnose" ? "mr-2 size-3 animate-spin" : "mr-2 size-3"} />
                {t("settings.steamvr.linkRepair.diagnose", { defaultValue: "Diagnose" })}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void repairSteamLink(true)} disabled={linkBusy !== null}>
                <ShieldCheck className={linkBusy === "dryRun" ? "mr-2 size-3 animate-spin" : "mr-2 size-3"} />
                {t("settings.steamvr.linkRepair.dryRun", { defaultValue: "Dry-run repair" })}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openRepairDialog("full-vrlink-reset")}
                disabled={linkBusy !== null}
              >
                <Wrench className={linkBusy === "repair" ? "mr-2 size-3 animate-spin" : "mr-2 size-3"} />
                {t("settings.steamvr.linkRepair.apply", { defaultValue: "Backup & repair" })}
              </Button>
            </div>
          </div>

          {linkDiag ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-3">
                <div className="text-[12px] font-medium">{translateSummary(linkDiag.summary)}</div>
                <div className="mt-2 grid gap-2 text-[11px] text-[hsl(var(--muted-foreground))] sm:grid-cols-2">
                  <div>
                    <span className="font-medium text-[hsl(var(--foreground))]">
                      {t("settings.steamvr.linkRepair.steamPath", { defaultValue: "Steam" })}:{" "}
                    </span>
                    <span className="break-all font-mono">{linkDiag.steamPath}</span>
                  </div>
                  <div>
                    <span className="font-medium text-[hsl(var(--foreground))]">
                      {t("settings.steamvr.linkRepair.build", { defaultValue: "Build" })}:{" "}
                    </span>
                    <span className="font-mono">{linkDiag.manifest?.fields?.buildid ?? "-"}</span>
                    {linkDiag.manifest?.isBeta ? (
                      <Badge variant="warning" className="ml-2 text-[10px]">
                        {t("settings.steamvr.linkRepair.beta", { defaultValue: "Beta" })}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        {t("settings.steamvr.linkRepair.stable", { defaultValue: "Stable" })}
                      </Badge>
                    )}
                  </div>
                  <div>
                    <span className="font-medium text-[hsl(var(--foreground))]">
                      {t("settings.steamvr.linkRepair.invalidSessions", { defaultValue: "Invalid sessions" })}:{" "}
                    </span>
                    <span className="font-mono">{linkDiag.logs?.counts?.invalid_session ?? 0}</span>
                  </div>
                  <div>
                    <span className="font-medium text-[hsl(var(--foreground))]">
                      {t("settings.steamvr.linkRepair.questPairs", { defaultValue: "Quest pairs" })}:{" "}
                    </span>
                    <span className="font-mono">
                      {(linkDiag.localconfigs ?? []).reduce((sum, item) => sum + (item.questDeviceCount ?? 0), 0)}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-[hsl(var(--foreground))]">
                      {t("settings.steamvr.linkRepair.pendingDownload", { defaultValue: "Pending update" })}:{" "}
                    </span>
                    {linkDiag.manifest?.pendingDownload ? t("common.yes", { defaultValue: "Yes" }) : t("common.no", { defaultValue: "No" })}
                  </div>
                  <div>
                    <span className="font-medium text-[hsl(var(--foreground))]">
                      {t("settings.steamvr.linkRepair.lostMaster", { defaultValue: "Lost master" })}:{" "}
                    </span>
                    <span className="font-mono">{linkDiag.logs?.counts?.lost_master ?? 0}</span>
                  </div>
                </div>
                {(linkDiag.recommendations?.length ?? 0) > 0 && (
                  <div className="mt-3 flex flex-col gap-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                    {linkDiag.recommendations?.map((line) => (
                      <div key={line} className="flex gap-2">
                        <span className="mt-[7px] size-1 rounded-full bg-[hsl(var(--primary))]" />
                        <span>{translateRecommendation(line)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {(linkDiag.issues?.length ?? 0) > 0 && (
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                      {t("settings.steamvr.linkRepair.issues", { defaultValue: "Detected issues" })}
                    </div>
                    {linkDiag.issues?.slice(0, 6).map((issue) => (
                      <div key={issue.id} className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-2 text-[11px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={issueBadgeVariant(issue.severity)} className="text-[10px]">
                            {severityLabel(issue.severity)}
                          </Badge>
                          <span className="font-medium text-[hsl(var(--foreground))]">{translateIssueTitle(issue)}</span>
                        </div>
                        <div className="mt-1 leading-relaxed text-[hsl(var(--muted-foreground))]">{translateIssueDetail(issue)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                  {t("settings.steamvr.linkRepair.evidence", { defaultValue: "Log evidence" })}
                </div>
                <div className="max-h-44 overflow-y-auto font-mono text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                  {(linkDiag.logs?.matches ?? []).slice(-8).map((match) => (
                    <div key={`${match.file}:${match.line}:${match.text}`} className="mb-1 break-words">
                      <span className="text-[hsl(var(--foreground))]">{match.file}:{match.line}</span>{" "}
                      {match.text}
                    </div>
                  ))}
                  {(linkDiag.logs?.matches?.length ?? 0) === 0 && (
                    <div>{t("settings.steamvr.linkRepair.noEvidence", { defaultValue: "No matching log lines in the scanned tail." })}</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {linkDiag?.repairPlans?.length ? (
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {linkDiag.repairPlans.map((plan: SteamVrLinkRepairPlan) => (
                <div key={plan.id} className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-3 text-[11px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{translatePlanTitle(plan.id, plan.title)}</span>
                      <Badge variant={plan.recommended ? "warning" : "secondary"} className="text-[10px]">
                        {plan.recommended ? t("settings.steamvr.linkRepair.recommended", { defaultValue: "Recommended" }) : riskLabel(plan.risk)}
                      </Badge>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => void repairSteamLink(true, plan.id)} disabled={linkBusy !== null}>
                        {t("settings.steamvr.linkRepair.dryRunShort", { defaultValue: "Dry-run" })}
                      </Button>
                      <Button
                        size="sm"
                        variant={plan.recommended ? "secondary" : "outline"}
                        onClick={() => openRepairDialog(plan.id)}
                        disabled={linkBusy !== null}
                      >
                        {t("settings.steamvr.linkRepair.applyShort", { defaultValue: "Apply" })}
                      </Button>
                    </div>
                  </div>
                  {plan.description && (
                    <div className="mt-1 leading-relaxed text-[hsl(var(--muted-foreground))]">{translatePlanDescription(plan)}</div>
                  )}
                  {(plan.actions?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {plan.actions?.slice(0, 5).map((action) => (
                        <Badge key={action} variant="secondary" className="text-[10px]">{translatePlanAction(action)}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {linkDiag?.suggestedSettings?.length ? (
            <div className="mt-3 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-3 text-[11px]">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                {t("settings.steamvr.linkRepair.settingProfiles", { defaultValue: "Stable parameter profiles" })}
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {linkDiag.suggestedSettings.map((profile: SteamVrLinkSettingsProfile) => (
                  <button
                    key={profile.id}
                    type="button"
                    disabled={locked}
                    onClick={() => applySettingsProfile(profile)}
                    className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-2 text-left transition hover:border-[hsl(var(--primary)/0.45)] disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[hsl(var(--foreground))]">{translateProfileTitle(profile)}</span>
                      {profile.recommended && (
                        <Badge variant="warning" className="text-[10px]">
                          {t("settings.steamvr.linkRepair.best", { defaultValue: "Best" })}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                      {profile.bandwidth} Mbps · {profile.supersampleScale.toFixed(1)}× · {profile.refreshRate} Hz
                    </div>
                    {profile.note && <div className="mt-1 leading-relaxed text-[hsl(var(--muted-foreground))]">{translateProfileNote(profile)}</div>}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {linkRepair ? (
            <div className="mt-3 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-3 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={linkRepair.dryRun ? "secondary" : linkRepair.ok ? "success" : "warning"} className="text-[10px]">
                  {linkRepair.dryRun
                    ? t("settings.steamvr.linkRepair.dryRunShort", { defaultValue: "Dry-run" })
                    : linkRepair.ok
                      ? t("settings.steamvr.linkRepair.applied", { defaultValue: "Applied" })
                      : t("settings.steamvr.linkRepair.partial", { defaultValue: "Partial" })}
                </Badge>
                {linkRepair.planId && (
                  <Badge variant="secondary" className="text-[10px]">
                    {translatePlanTitle(linkRepair.planId, linkRepair.planId)}
                  </Badge>
                )}
                <span className="break-all font-mono text-[hsl(var(--muted-foreground))]">{linkRepair.backupDir}</span>
              </div>
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                <div>
                  <div className="mb-1 font-medium">{t("settings.steamvr.linkRepair.actions", { defaultValue: "Planned actions" })}</div>
                  <div className="max-h-36 overflow-y-auto font-mono text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                    {(linkRepair.actions ?? []).map((action) => (
                      <div key={action}>{translateRepairAction(action)}</div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1 font-medium">{t("settings.steamvr.linkRepair.result", { defaultValue: "Result" })}</div>
                  <div className="font-mono text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                    <div>{t("settings.steamvr.linkRepair.resultBetaKey", { defaultValue: "BetaKey lines" })}: {linkRepair.manifestBetaLinesRemoved ?? 0}</div>
                    <div>{t("settings.steamvr.linkRepair.resultQuestBlocks", { defaultValue: "Quest device blocks" })}: {linkRepair.localconfigDeviceBlocksRemoved ?? 0}</div>
                    <div>{t("settings.steamvr.linkRepair.resultBetaBlocks", { defaultValue: "250820-beta blocks" })}: {linkRepair.localconfigBetaBlocksRemoved ?? 0}</div>
                    <div>{t("settings.steamvr.linkRepair.resultStopped", { defaultValue: "Stopped processes" })}: {linkRepair.stopped?.length ?? 0}</div>
                    <div>{t("settings.steamvr.linkRepair.resultBackups", { defaultValue: "Backups" })}: {linkRepair.backups?.length ?? 0}</div>
                    <div>
                      {t("settings.steamvr.linkRepair.resultSettingsApplied", { defaultValue: "Settings applied" })}:{" "}
                      {linkRepair.settingsApplied
                        ? t("common.yes", { defaultValue: "yes" })
                        : t("common.no", { defaultValue: "no" })}
                    </div>
                    {typeof linkRepair.restored === "number" && (
                      <div>{t("settings.steamvr.linkRepair.resultRestored", { defaultValue: "Restored" })}: {linkRepair.restored}</div>
                    )}
                    {linkRepair.currentBackupDir && (
                      <div className="break-all">
                        {t("settings.steamvr.linkRepair.currentBackupDir", { defaultValue: "Current files backup" })}: {linkRepair.currentBackupDir}
                      </div>
                    )}
                    {(linkRepair.failures?.length ?? 0) > 0 && (
                      <div className="mt-1 text-[hsl(var(--destructive))]">
                        {linkRepair.failures?.map((failure) => failure.error).join("; ")}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {linkBackups.length > 0 ? (
            <div className="mt-3 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-3 text-[11px]">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">
                    {t("settings.steamvr.linkRepair.backupsTitle", { defaultValue: "Backups & restore" })}
                  </div>
                  <div className="text-[hsl(var(--muted-foreground))]">
                    {t("settings.steamvr.linkRepair.backupsHint", {
                      defaultValue: "Restore-capable VRCSM backups. Restoring also backs up the current files first.",
                    })}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => void loadBackups()}>
                  <RefreshCw className="mr-2 size-3" />
                  {t("settings.steamvr.linkRepair.refreshBackups", { defaultValue: "Refresh" })}
                </Button>
              </div>
              <div className="grid gap-2">
                {linkBackups.slice(0, 5).map((backup) => (
                  <div key={backup.path} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px]">{backup.name}</span>
                        <Badge variant={backup.restorable ? "success" : "secondary"} className="text-[10px]">
                          {backup.restorable
                            ? t("settings.steamvr.linkRepair.restorable", { defaultValue: "Restorable" })
                            : t("settings.steamvr.linkRepair.metadataMissing", { defaultValue: "No metadata" })}
                        </Badge>
                        {backup.planId ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {translatePlanTitle(backup.planId, backup.planId)}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 break-all font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{backup.path}</div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!backup.restorable || linkBusy !== null}
                        onClick={() => openRestoreDialog(backup)}
                      >
                        {t("settings.steamvr.linkRepair.restore", { defaultValue: "Restore" })}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

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
        <Dialog
          open={confirmRequest !== null}
          onOpenChange={(open) => {
            if (confirmBusy || linkBusy !== null) return;
            if (!open) {
              setConfirmRequest(null);
              setConfirmPreview(null);
            }
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {confirmRequest?.kind === "restore"
                  ? t("settings.steamvr.linkRepair.restoreDialogTitle", { defaultValue: "Restore Steam Link backup" })
                  : t("settings.steamvr.linkRepair.confirmDialogTitle", {
                      name: translatePlanTitle(confirmRequest?.kind === "repair" ? confirmRequest.planId : "full-vrlink-reset"),
                      defaultValue: "Confirm {{name}}",
                    })}
              </DialogTitle>
              <DialogDescription className="leading-relaxed">
                {confirmRequest?.kind === "restore"
                  ? t("settings.steamvr.linkRepair.restoreDialogDesc", {
                      defaultValue: "VRCSM will close Steam/SteamVR, back up the current files, then restore the selected backup.",
                    })
                  : t("settings.steamvr.linkRepair.confirmDialogDesc", {
                      defaultValue: "Review the exact files and actions below. Nothing is changed until you press Execute.",
                    })}
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
              {confirmBusy && !confirmPreview ? (
                <div className="flex items-center gap-2 text-[12px] text-[hsl(var(--muted-foreground))]">
                  <RefreshCw className="size-3 animate-spin" />
                  {t("settings.steamvr.linkRepair.previewing", { defaultValue: "Generating preview..." })}
                </div>
              ) : (
                <>
                  <div className="mb-2 break-all font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                    {confirmPreview?.backupDir ?? (confirmRequest?.kind === "restore" ? confirmRequest.backup.path : "")}
                  </div>
                  <div className="max-h-64 overflow-y-auto font-mono text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                    {(confirmPreview?.actions ?? []).map((action) => (
                      <div key={action}>{translateRepairAction(action)}</div>
                    ))}
                    {(confirmPreview?.actions?.length ?? 0) === 0 && (
                      <div>{t("settings.steamvr.linkRepair.noPlannedActions", { defaultValue: "No actions in preview." })}</div>
                    )}
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={confirmBusy || linkBusy !== null}
                onClick={() => {
                  setConfirmRequest(null);
                  setConfirmPreview(null);
                }}
              >
                {t("settings.steamvr.linkRepair.confirmDialogCancel", { defaultValue: "Cancel" })}
              </Button>
              <Button
                disabled={confirmBusy || linkBusy !== null || !confirmPreview}
                onClick={() => void confirmCurrentRequest()}
              >
                {confirmBusy || linkBusy === "repair"
                  ? t("settings.steamvr.linkRepair.executing", { defaultValue: "Executing..." })
                  : confirmRequest?.kind === "restore"
                    ? t("settings.steamvr.linkRepair.restoreConfirm", { defaultValue: "Restore" })
                    : t("settings.steamvr.linkRepair.confirmDialogApply", { defaultValue: "Backup & repair" })}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
