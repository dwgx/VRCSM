import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  LogIn,
  RefreshCw,
  Users,
  Shirt,
  Globe2,
  Ban,
  Sparkles,
  LayoutDashboard,
} from "lucide-react";

import { LoginForm } from "@/components/LoginForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";


import { ipc } from "@/lib/ipc";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

const TabOverview = lazy(() => import("./workspace/TabOverview"));
const TabFriends = lazy(() => import("./workspace/TabFriends"));
const TabAvatars = lazy(() => import("./workspace/TabAvatars"));
const TabWorlds = lazy(() => import("./workspace/TabWorlds"));
const TabSocial = lazy(() => import("./workspace/TabSocial"));
const TabVrcPlus = lazy(() => import("./workspace/TabVrcPlus"));

type WorkspaceTab = "overview" | "friends" | "avatars" | "worlds" | "social" | "vrcplus";

const TABS: Array<{ key: WorkspaceTab; labelKey: string; icon: typeof Users }> = [
  { key: "overview", labelKey: "vrchatWorkspace.tabs.overview", icon: LayoutDashboard },
  { key: "friends", labelKey: "vrchatWorkspace.tabs.friends", icon: Users },
  { key: "avatars", labelKey: "vrchatWorkspace.tabs.avatars", icon: Shirt },
  { key: "worlds", labelKey: "vrchatWorkspace.tabs.worlds", icon: Globe2 },
  { key: "social", labelKey: "vrchatWorkspace.tabs.social", icon: Ban },
  { key: "vrcplus", labelKey: "vrchatWorkspace.tabs.vrcPlus", icon: Sparkles },
];

function usePersistedTab(): [WorkspaceTab, (tab: WorkspaceTab) => void] {
  const [tab, setTabState] = useState<WorkspaceTab>(() => {
    const saved = localStorage.getItem("vrcsm.workspace.activeTab");
    return (saved as WorkspaceTab) || "overview";
  });
  const setTab = (next: WorkspaceTab) => {
    setTabState(next);
    localStorage.setItem("vrcsm.workspace.activeTab", next);
  };
  return [tab, setTab];
}

export default function VrchatWorkspace() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { status: authStatus } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [syncingOfficial, setSyncingOfficial] = useState(false);
  const [lastOfficialSyncAt, setLastOfficialSyncAt] = useState<string | null>(null);
  const [tab, setTab] = usePersistedTab();

  async function handleOfficialSync() {
    if (!authStatus.authed || syncingOfficial) {
      if (!authStatus.authed) setLoginOpen(true);
      return;
    }
    setSyncingOfficial(true);
    try {
      const result = await ipc.favoriteSyncOfficial();
      setLastOfficialSyncAt(result.synced_at);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["favorites.lists"] }),
        queryClient.invalidateQueries({ queryKey: ["favorites.items"] }),
      ]);
      toast.success(t("library.officialSyncSuccess", {
        count: result.imported, avatars: result.avatars, worlds: result.worlds,
      }));
    } catch (error) {
      toast.error(t("library.officialSyncFailed", { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSyncingOfficial(false);
    }
  }

  const tabFallback = (
    <div className="flex items-center justify-center py-20 text-[hsl(var(--muted-foreground))]">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("vrchatWorkspace.title", { defaultValue: "VRChat Workspace" })}
          </h1>
          <p className="mt-1.5 max-w-3xl text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("profile.quickActionsDesc", {
              defaultValue: "Native join flow, favorites sync, local friend pins, and recent-world shortcuts.",
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={authStatus.authed ? "outline" : "tonal"}
            size="sm"
            onClick={() => authStatus.authed ? handleOfficialSync() : setLoginOpen(true)}
            disabled={syncingOfficial}
          >
            {syncingOfficial ? <Loader2 className="size-4 animate-spin" /> : authStatus.authed ? <RefreshCw className="size-4" /> : <LogIn className="size-4" />}
            {authStatus.authed
              ? syncingOfficial ? t("library.officialSyncing") : t("library.officialSync")
              : t("auth.signInWithVrchat")}
          </Button>
          <Badge variant={authStatus.authed ? "success" : "muted"}>
            {authStatus.authed ? t("auth.signedIn") : t("profile.notSignedIn")}
          </Badge>
          {lastOfficialSyncAt ? (
            <Badge variant="muted">{t("library.officialLastSync", { date: formatDate(lastOfficialSyncAt) })}</Badge>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-1.5">
        {TABS.map(({ key, labelKey, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-[12px] font-medium transition-colors",
              tab === key
                ? "bg-[hsl(var(--primary)/0.18)] text-[hsl(var(--primary))] shadow-sm"
                : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]",
            )}
          >
            <Icon className="size-3.5" />
            {t(labelKey, { defaultValue: key })}
          </button>
        ))}
      </div>

      <Suspense fallback={tabFallback}>
        {tab === "overview" && <TabOverview />}
        {tab === "friends" && <TabFriends />}
        {tab === "avatars" && <TabAvatars />}
        {tab === "worlds" && <TabWorlds />}
        {tab === "social" && <TabSocial />}
        {tab === "vrcplus" && <TabVrcPlus />}
      </Suspense>

      <LoginForm open={loginOpen} onOpenChange={setLoginOpen} />
    </div>
  );
}
