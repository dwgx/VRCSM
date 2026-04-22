import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { QueryClientProvider } from "@tanstack/react-query";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/sonner";
import { Sidebar } from "@/components/Sidebar";
import { TitleBar } from "@/components/TitleBar";
import { BottomDock } from "@/components/BottomDock";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import {
  RightDock,
  RightDockProvider,
  useResolvedRightDock,
  type RightDockDescriptor,
} from "@/components/RightDock";
import { StatusBar } from "@/components/StatusBar";
import { ToolbarSearchProvider } from "@/components/Toolbar";
import { AboutDialog } from "@/components/AboutDialog";
import { UpdateDialog } from "@/components/UpdateDialog";
import { FolderPickerHost } from "@/components/FolderPicker";
import { CommandPalette, useCommandPalette } from "@/components/CommandPalette";
import { ReportProvider, useReport } from "@/lib/report-context";
import { AuthProvider } from "@/lib/auth-context";
import { PluginRegistryProvider } from "@/lib/plugin-context";
import { ipc } from "@/lib/ipc";
import { getTrueCacheCategoryCount, getTrueCacheLabel } from "@/lib/report-metrics";
import { formatDate } from "@/lib/utils";
import { useUiPrefBoolean } from "@/lib/ui-prefs";
import { VrcProcessProvider, useVrcProcess } from "@/lib/vrc-context";
import { useDiscordPresence } from "@/lib/useDiscordPresence";
import { useScreenshotAutoInject } from "@/lib/useScreenshotAutoInject";
import { useFriendsPipelineSync } from "@/lib/useFriendsPipelineSync";
import { useStrangerAlert } from "@/lib/useStrangerAlert";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import { Download } from "lucide-react";

// Lazy-load every page so navigating between tabs doesn't cost us a
// second tree of page modules upfront. The shared report context keeps
// us from re-scanning when pages mount.
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Bundles = lazy(() => import("@/pages/Bundles"));
const Library = lazy(() => import("@/pages/Library"));
const Avatars = lazy(() => import("@/pages/Avatars"));
const Worlds = lazy(() => import("@/pages/Worlds"));
const Friends = lazy(() => import("@/pages/Friends"));
const Groups = lazy(() => import("@/pages/Groups"));
const Profile = lazy(() => import("@/pages/Profile"));
const VrchatWorkspace = lazy(() => import("@/pages/VrchatWorkspace"));
const Screenshots = lazy(() => import("@/pages/Screenshots"));
const Logs = lazy(() => import("@/pages/Logs"));
const Radar = lazy(() => import("@/pages/Radar"));
const Migrate = lazy(() => import("@/pages/Migrate"));
const Settings = lazy(() => import("@/pages/Settings"));
const MemoryRadar = lazy(() => import("@/pages/MemoryRadar"));
const OscTools = lazy(() => import("@/pages/OscTools"));
const PluginsMarket = lazy(() => import("@/pages/PluginsMarket"));
const PluginDetail = lazy(() => import("@/pages/PluginDetail"));
const PluginInstalled = lazy(() => import("@/pages/PluginInstalled"));
const PluginHost = lazy(() => import("@/pages/PluginHost"));
const WorldHistory = lazy(() => import("@/pages/WorldHistory"));
const CalendarPage = lazy(() => import("@/pages/Calendar"));

interface RouteShellMeta {
  breadcrumb: string[];
  title: string;
}

function PageFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center text-[12px] text-[hsl(var(--muted-foreground))]">
      {t("common.loading")}
    </div>
  );
}

function AppContent() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { report: shellReport, loading: isRescanning, refresh } = useReport();

  // If the process was launched via a vrcsm:// or vrcx:// URL, the host
  // appended ?initialRoute=... to the entry URL. Navigate to the target
  // once mounted, then clean the query string so an in-app refresh
  // doesn't re-trigger the jump.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("initialRoute");
    if (target && target.startsWith("/")) {
      navigate(target, { replace: true });
      window.history.replaceState({}, "", target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [searchQuery, setSearchQuery] = useState("");
  const [layoutResetToken, setLayoutResetToken] = useState(0);
  const { status: vrcProcessStatus } = useVrcProcess();
  const vrcRunning = vrcProcessStatus.running;
  const [aboutOpen, setAboutOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [shellVersion, setShellVersion] = useState("…");
  const { updateAvailable, result: updateResult } = useUpdateCheck();
  const { open: commandOpen, setOpen: setCommandOpen } = useCommandPalette();
  const [sidebarHidden] = useUiPrefBoolean("vrcsm.layout.sidebar.hidden", false);
  const [dockHidden] = useUiPrefBoolean("vrcsm.layout.dock.hidden", false);

  // Discord Rich Presence — opt-in, configured under Settings → Discord.
  // No-op when disabled or no client_id is set.
  useDiscordPresence();

  // Screenshot watcher — auto-inject world/instance/players into new
  // captures. On by default, toggleable in Settings.
  useScreenshotAutoInject();

  // Pipeline → React Query bridge for the friends.list cache. Live
  // friend presence/location/profile updates propagate to TabFriends,
  // Dashboard, and any other consumer of useIpcQuery("friends.list").
  useFriendsPipelineSync();

  // Stranger-in-Private warning — toast when a non-friend joins the
  // user's non-public instance. Opt-out is per-user via dismissing the
  // toast; a more granular "always allow this user" VIP list is Tier S.
  useStrangerAlert();

  const routeMeta = useMemo<Record<string, RouteShellMeta>>(
    () => ({
      "/": {
        title: t("nav.dashboard"),
        breadcrumb: [t("nav.category.workspace", { defaultValue: "Workspace" }), t("nav.dashboard")],
      },
      "/bundles": {
        title: t("nav.bundles"),
        breadcrumb: [t("nav.category.assets", { defaultValue: "Assets" }), t("nav.bundles")],
      },
      "/library": {
        title: t("nav.library"),
        breadcrumb: [t("nav.category.assets", { defaultValue: "Assets" }), t("nav.library")],
      },
      "/avatars": {
        title: t("nav.avatars"),
        breadcrumb: [t("nav.category.assets", { defaultValue: "Assets" }), t("nav.avatars")],
      },
      "/worlds": {
        title: t("nav.worlds"),
        breadcrumb: [t("nav.category.assets", { defaultValue: "Assets" }), t("nav.worlds")],
      },
      "/friends": {
        title: t("nav.friends"),
        breadcrumb: [t("nav.category.social", { defaultValue: "Social" }), t("nav.friends")],
      },
      "/profile": {
        title: t("nav.profile"),
        breadcrumb: [t("nav.category.social", { defaultValue: "Social" }), t("nav.profile")],
      },
      "/vrchat": {
        title: t("nav.vrchat"),
        breadcrumb: [t("nav.category.social", { defaultValue: "Social" }), t("nav.vrchat")],
      },
      "/screenshots": {
        title: t("nav.screenshots"),
        breadcrumb: [t("nav.category.media", { defaultValue: "Media" }), t("nav.screenshots")],
      },
      "/logs": {
        title: t("nav.logs"),
        breadcrumb: [t("nav.category.diagnostics", { defaultValue: "Diagnostics" }), t("nav.logs")],
      },
      "/radar": {
        title: t("nav.radar"),
        breadcrumb: [t("nav.category.social", { defaultValue: "Social" }), t("nav.radar")],
      },
      "/friend-log": {
        title: t("nav.radar"),
        breadcrumb: [t("nav.category.social", { defaultValue: "Social" }), t("nav.radar")],
      },
      "/calendar": {
        title: t("nav.calendar", { defaultValue: "Calendar & Jams" }),
        breadcrumb: [
          t("nav.category.social", { defaultValue: "Social" }),
          t("nav.calendar", { defaultValue: "Calendar & Jams" }),
        ],
      },
      "/history/worlds": {
        title: t("nav.worldHistory", { defaultValue: "World History" }),
        breadcrumb: [
          t("nav.category.social", { defaultValue: "Social" }),
          t("nav.worldHistory", { defaultValue: "World History" }),
        ],
      },
      "/migrate": {
        title: t("nav.migrate"),
        breadcrumb: [t("nav.category.maintenance", { defaultValue: "Maintenance" }), t("nav.migrate")],
      },
      "/settings": {
        title: t("nav.settings"),
        breadcrumb: [t("nav.category.project", { defaultValue: "Project" }), t("nav.settings")],
      },
      "/plugins": {
        title: t("nav.plugins", { defaultValue: "Plugins" }),
        breadcrumb: [t("nav.category.plugins", { defaultValue: "Plugins" }), t("plugins.market.title", { defaultValue: "Market" })],
      },
      "/plugins/installed": {
        title: t("plugins.installed.title", { defaultValue: "Installed plugins" }),
        breadcrumb: [t("nav.category.plugins", { defaultValue: "Plugins" }), t("plugins.installed.title", { defaultValue: "Installed" })],
      },
    }),
    [t],
  );

  const currentMeta = routeMeta[location.pathname] ?? routeMeta["/"];
  const trueCacheLabel = getTrueCacheLabel(shellReport);
  const trueCacheCategoryCount = getTrueCacheCategoryCount(shellReport);

  useEffect(() => {
    setSearchQuery("");
  }, [location.pathname]);

  useEffect(() => {
    let alive = true;
    ipc.version()
      .then((info) => {
        if (alive) {
          setShellVersion(`v${info.version}`);
        }
      })
      .catch(() => {
        if (alive) {
          setShellVersion("v?");
        }
      });
    return () => {
      alive = false;
    };
  }, []);


  const rightDockFallback = useMemo<RightDockDescriptor | null>(() => {
    if (!shellReport) {
      if (
        location.pathname === "/" ||
        location.pathname === "/bundles"
      ) {
        return {
          title: currentMeta.title,
          body: (
            <div className="text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("common.loading")}
            </div>
          ),
        };
      }
      return null;
    }

    if (location.pathname === "/") {
      return {
        title: currentMeta.title,
        body: (
          <div className="space-y-3 text-[12px]">
            <div className="grid gap-2">
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                  {t("dashboard.totalCache")}
                </div>
                <div className="mt-1 text-[18px] font-semibold">
                  {trueCacheLabel}
                </div>
                <div className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                  {t("dashboard.totalCacheHint", { count: trueCacheCategoryCount })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    {t("dashboard.categories")}
                  </div>
                  <div className="mt-1 text-[15px] font-medium">
                    {shellReport.category_summaries.length}
                  </div>
                </div>
                <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    {t("dashboard.logs")}
                  </div>
                  <div className="mt-1 text-[15px] font-medium">
                    {shellReport.logs.log_count}
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-[11px] text-[hsl(var(--muted-foreground))]">
              {formatDate(shellReport.generated_at)}
            </div>
          </div>
        ),
      };
    }

    if (location.pathname === "/bundles") {
      return {
        title: currentMeta.title,
        body: (
          <div className="space-y-2 text-[12px]">
            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                {t("bundles.cardTitle")}
              </div>
              <div className="mt-1 text-[15px] font-medium">
                {t("bundles.entryCount", {
                  count: shellReport.cache_windows_player.entry_count,
                })}
              </div>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                {t("dashboard.topBundles")}
              </div>
              <div className="mt-1 text-[15px] font-medium">
                {shellReport.cache_windows_player.largest_entries.length}
              </div>
            </div>
          </div>
        ),
      };
    }

    return null;
  }, [currentMeta.title, location.pathname, shellReport, t, trueCacheCategoryCount, trueCacheLabel]);
  const resolvedRightDock = useResolvedRightDock(rightDockFallback);
  const routeAllowsRightDock =
    location.pathname === "/" ||
    location.pathname === "/bundles" ||
    location.pathname === "/settings";
  const showRightDock = routeAllowsRightDock && Boolean(resolvedRightDock);

  return (
    <ToolbarSearchProvider
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
    >
      <div className="flex h-screen w-screen overflow-hidden bg-[hsl(var(--canvas))] text-[hsl(var(--foreground))]">
        <PanelGroup orientation="horizontal">
            {sidebarHidden ? null : (
              <>
                {/* ── Resizable Sidebar ── */}
                <Panel
                  defaultSize={15}
                  minSize={5}
                  collapsible
                  collapsedSize={0}
                >
                  <Sidebar />
                </Panel>
                <PanelResizeHandle className="w-[3px] bg-[hsl(var(--border)/0.3)] hover:bg-[hsl(var(--primary)/0.5)] active:bg-[hsl(var(--primary))] transition-colors cursor-col-resize" />
              </>
            )}

            {/* ── Main content area ── */}
            <Panel defaultSize={sidebarHidden ? 100 : 85} minSize={20}>
              <div className="flex min-w-0 h-full flex-col overflow-hidden">
                <TitleBar
                  currentPageLabel={currentMeta.title}
                  isRescanning={isRescanning}
                  onRescan={refresh}
                  onResetLayout={() => setLayoutResetToken((value) => value + 1)}
                  onOpenAbout={() => setAboutOpen(true)}
                  onOpenCommandPalette={() => setCommandOpen(true)}
                  onOpenUpdate={() => setUpdateDialogOpen(true)}
                  vrcRunning={vrcRunning}
                />

                {updateAvailable && (
                  <div className="flex items-center gap-3 bg-[hsl(var(--primary)/0.15)] px-4 py-2 border-b border-[hsl(var(--primary)/0.3)]">
                    <Download className="size-4 shrink-0 text-primary" />
                    <div className="flex-1 text-sm text-[hsl(var(--foreground))]">
                      <strong>{t("updates.availableTitle", { defaultValue: "Update Available" })}</strong>
                      {" — "}
                      {t("updates.availableBody", {
                        defaultValue: "VRCSM {{version}} is now available.",
                        version: updateAvailable.latest ?? "",
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => setUpdateDialogOpen(true)}
                      className="inline-flex h-7 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      {t("updates.download", { defaultValue: "Download" })}
                    </button>
                  </div>
                )}

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <PanelGroup
                    key={showRightDock ? "with-right-dock" : "without-right-dock"}
                    orientation="horizontal"
                  >
                    <Panel defaultSize={75} minSize={20}>
                      <section className="unity-dock flex h-full flex-col overflow-hidden">
                        <div className="flex h-8 items-end gap-1 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-2 pt-1">
                          <div className="unity-tab unity-tab-active">
                            {currentMeta.title}
                          </div>
                        </div>
                        <main className="scrollbar-thin flex-1 min-w-0 overflow-x-hidden overflow-y-auto bg-[hsl(var(--surface))] px-6 py-5">
                          <RouteErrorBoundary resetKey={location.pathname}>
                            <Suspense fallback={<PageFallback />}>
                              <Routes>
                                <Route path="/" element={<Dashboard />} />
                                <Route path="/bundles" element={<Bundles />} />
                                <Route path="/library" element={<Library />} />
                                <Route path="/avatars" element={<Avatars />} />
                                <Route path="/worlds" element={<Worlds />} />
                                <Route path="/friends" element={<Friends />} />
                                <Route path="/groups" element={<Groups />} />
                                <Route path="/profile" element={<Profile />} />
                                <Route path="/vrchat" element={<VrchatWorkspace />} />
                                <Route path="/screenshots" element={<Screenshots />} />
                                <Route path="/friend-log" element={<Navigate to="/radar" replace />} />
                                <Route path="/history/worlds" element={<WorldHistory />} />
                                <Route path="/calendar" element={<CalendarPage />} />
                                <Route path="/logs" element={<Logs />} />
                                <Route path="/radar" element={<Radar />} />
                                <Route path="/migrate" element={<Migrate />} />
                                <Route path="/settings" element={<Settings />} />
                                <Route path="/tools/memory-radar" element={<MemoryRadar />} />
                                <Route path="/tools/osc" element={<OscTools />} />
                                <Route path="/plugins" element={<PluginsMarket />} />
                                <Route path="/plugins/installed" element={<PluginInstalled />} />
                                <Route path="/plugins/:id" element={<PluginDetail />} />
                                <Route path="/p/:pluginId/*" element={<PluginHost />} />
                                <Route path="*" element={<Navigate to="/" replace />} />
                              </Routes>
                            </Suspense>
                          </RouteErrorBoundary>
                        </main>
                      </section>
                    </Panel>
                    {showRightDock ? (
                      <>
                        <PanelResizeHandle className="w-[3px] bg-[hsl(var(--border)/0.3)] hover:bg-[hsl(var(--primary)/0.5)] active:bg-[hsl(var(--primary))] transition-colors cursor-col-resize" />

                        {/* ── Resizable Right Dock ── */}
                        <Panel
                          defaultSize={25}
                          minSize={5}
                          collapsible
                          collapsedSize={0}
                        >
                          <RightDock fallback={rightDockFallback} />
                        </Panel>
                      </>
                    ) : null}
                  </PanelGroup>

                  {dockHidden ? null : (
                    <BottomDock report={shellReport} resetToken={layoutResetToken} />
                  )}

                  <StatusBar
                    breadcrumb={currentMeta.breadcrumb}
                    cacheTotal={shellReport ? trueCacheLabel : "—"}
                    currentPageLabel={currentMeta.title}
                    version={shellVersion}
                    vrcRunning={vrcRunning}
                  />
                </div>
              </div>
            </Panel>
        </PanelGroup>
        <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
        <UpdateDialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen} initial={updateResult} />
        <FolderPickerHost />
        <CommandPalette
          open={commandOpen}
          onOpenChange={setCommandOpen}
          onRescan={refresh}
          onOpenAbout={() => setAboutOpen(true)}
        />
        <Toaster />
      </div>
    </ToolbarSearchProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <VrcProcessProvider>
          <ReportProvider>
            <PluginRegistryProvider>
              <RightDockProvider>
                <AppContent />
              </RightDockProvider>
            </PluginRegistryProvider>
          </ReportProvider>
        </VrcProcessProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
