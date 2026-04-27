import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { ipc } from "@/lib/ipc";
import type { AppVersion } from "@/lib/types";
import { useVrcProcess } from "@/lib/vrc-context";
import { cn } from "@/lib/utils";

import { TabGeneral } from "./TabGeneral";
import { TabConfigJson } from "./TabConfigJson";
import { TabSteamVR } from "./TabSteamVR";
import { TabRegistry } from "./TabRegistry";
import { TabExperimental } from "./TabExperimental";
import { TabVrDiag } from "./TabVrDiag";

type SettingsTab = "general" | "config" | "steamvr" | "registry" | "experimental" | "vrdiag";

export default function SettingsLayout() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { status } = useVrcProcess();
  const vrcRunning = status.running;
  const [version, setVersion] = useState<AppVersion | null>(null);
  const initialTab = normalizeTab(searchParams.get("tab")) ?? "general";
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  function selectTab(tab: SettingsTab) {
    setActiveTab(tab);
    setSearchParams(tab === "general" ? {} : { tab }, { replace: true });
  }

  useEffect(() => {
    let alive = true;
    ipc
      .version()
      .then((v) => {
        if (alive) setVersion(v);
      })
      .catch((e: unknown) => {
        console.error("Failed to fetch version", e);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const requested = normalizeTab(searchParams.get("tab"));
    if (requested && requested !== activeTab) {
      setActiveTab(requested);
    }
  }, [activeTab, searchParams]);

  return (
    <div className="flex flex-col gap-4 animate-fade-in relative max-w-5xl mx-auto w-full">
      {/* ─── Unity-style compact header + Tab Navigation ─────────────────────────── */}
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="unity-panel-header inline-flex items-center gap-2 border-0 bg-transparent px-0 py-0 normal-case tracking-normal">
            <span className="text-[11px] uppercase tracking-[0.08em]">
              {t("settings.title", { defaultValue: "Settings" })}
            </span>
          </div>
          <span className="h-[11px] w-px bg-[hsl(var(--border-strong))]" />
          <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            {t("settings.subtitle", { defaultValue: "Preferences & Configuration" })}
          </span>
        </div>

        {/* Custom Tab Bar */}
        <div className="flex flex-wrap items-end gap-0.5 border-b border-[hsl(var(--border))] pb-0">
          <button
            onClick={() => selectTab("general")}
            className={cn("unity-tab flex items-center gap-1.5 px-4 py-2 text-[12px]", activeTab === "general" && "unity-tab-active")}
          >
            {t("settings.tabs.general", { defaultValue: "General" })}
          </button>
          <button
            onClick={() => selectTab("config")}
            className={cn("unity-tab flex items-center gap-1.5 px-4 py-2 text-[12px]", activeTab === "config" && "unity-tab-active")}
          >
            {t("settings.tabs.config", { defaultValue: "App Config (config.json)" })}
          </button>
          <button
            onClick={() => selectTab("steamvr")}
            className={cn("unity-tab flex items-center gap-1.5 px-4 py-2 text-[12px]", activeTab === "steamvr" && "unity-tab-active")}
          >
            {t("settings.tabs.steamvr", { defaultValue: "SteamVR" })}
          </button>
          <button
            onClick={() => selectTab("registry")}
            className={cn("unity-tab flex items-center gap-1.5 px-4 py-2 text-[12px]", activeTab === "registry" && "unity-tab-active")}
          >
            {t("settings.tabs.registry", { defaultValue: "VRChat Registry" })}
          </button>
          <button
            onClick={() => selectTab("experimental")}
            className={cn("unity-tab flex items-center gap-1.5 px-4 py-2 text-[12px]", activeTab === "experimental" && "unity-tab-active")}
          >
            {t("settings.tabs.experimental", { defaultValue: "Experimental" })}
          </button>
          <button
            onClick={() => selectTab("vrdiag")}
            className={cn("unity-tab flex items-center gap-1.5 px-4 py-2 text-[12px]", activeTab === "vrdiag" && "unity-tab-active")}
          >
            {t("settings.tabs.vrDiag", { defaultValue: "VR Diagnostics" })}
          </button>
        </div>
      </header>

      {/* Render Active Tab */}
      <div className="mt-2 text-left">
        {activeTab === "general" && <TabGeneral version={version} />}
        {activeTab === "config" && <TabConfigJson vrcRunning={vrcRunning} />}
        {activeTab === "steamvr" && <TabSteamVR vrcRunning={vrcRunning} />}
        {activeTab === "registry" && <TabRegistry vrcRunning={vrcRunning} />}
        {activeTab === "experimental" && <TabExperimental />}
        {activeTab === "vrdiag" && <TabVrDiag />}
      </div>
    </div>
  );
}

function normalizeTab(raw: string | null): SettingsTab | null {
  switch (raw) {
    case "general":
    case "config":
    case "steamvr":
    case "registry":
    case "experimental":
    case "vrdiag":
      return raw;
    default:
      return null;
  }
}
