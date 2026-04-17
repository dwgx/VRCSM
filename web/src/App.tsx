import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
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
  type RightDockDescriptor,
} from "@/components/RightDock";
import { StatusBar } from "@/components/StatusBar";
import { ToolbarSearchProvider } from "@/components/Toolbar";
import { AboutDialog } from "@/components/AboutDialog";
import { ReportProvider, useReport } from "@/lib/report-context";
import { AuthProvider } from "@/lib/auth-context";
import { ipc } from "@/lib/ipc";
import { getTrueCacheCategoryCount, getTrueCacheLabel } from "@/lib/report-metrics";
import { formatDate } from "@/lib/utils";
import { VrcProcessProvider, useVrcProcess } from "@/lib/vrc-context";
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
const Profile = lazy(() => import("@/pages/Profile"));
const Screenshots = lazy(() => import("@/pages/Screenshots"));
const Logs = lazy(() => import("@/pages/Logs"));
const Radar = lazy(() => import("@/pages/Radar"));
const Migrate = lazy(() => import("@/pages/Migrate"));
const Settings = lazy(() => import("@/pages/Settings"));
const MemoryRadar = lazy(() => import("@/pages/MemoryRadar"));
const FriendLog = lazy(() => import("@/pages/FriendLog"));

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
  const { report: shellReport, loading: isRescanning, refresh } = useReport();
  const [searchQuery, setSearchQuery] = useState("");
  const [layoutResetToken, setLayoutResetToken] = useState(0);
  const { status: vrcProcessStatus } = useVrcProcess();
  const vrcRunning = vrcProcessStatus.running;
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shellVersion, setShellVersion] = useState("…");
  const { updateAvailable } = useUpdateCheck();

  const routeMeta = useMemo<Record<string, RouteShellMeta>>(
    () => ({
      "/": {
        title: t("nav.dashboard"),
        breadcrumb: ["Workspace", t("nav.dashboard")],
      },
      "/bundles": {
        title: t("nav.bundles"),
        breadcrumb: ["Assets", t("nav.bundles")],
      },
      "/library": {
        title: t("nav.library"),
        breadcrumb: ["Assets", t("nav.library")],
      },
      "/avatars": {
        title: t("nav.avatars"),
        breadcrumb: ["Assets", t("nav.avatars")],
      },
      "/worlds": {
        title: t("nav.worlds"),
        breadcrumb: ["Assets", t("nav.worlds")],
      },
      "/friends": {
        title: t("nav.friends"),
        breadcrumb: ["Social", t("nav.friends")],
      },
      "/profile": {
        title: t("nav.profile"),
        breadcrumb: ["Social", t("nav.profile")],
      },
      "/screenshots": {
        title: t("nav.screenshots"),
        breadcrumb: ["Media", t("nav.screenshots")],
      },
      "/friend-log": {
        title: t("nav.friendLog", "Friend Log"),
        breadcrumb: ["Social", t("nav.friendLog", "Friend Log")],
      },
      "/logs": {
        title: t("nav.logs"),
        breadcrumb: ["Diagnostics", t("nav.logs")],
      },
      "/radar": {
        title: "Instance Radar",
        breadcrumb: ["Social", "Instance Radar"],
      },
      "/migrate": {
        title: t("nav.migrate"),
        breadcrumb: ["Maintenance", t("nav.migrate")],
      },
      "/settings": {
        title: t("nav.settings"),
        breadcrumb: ["Project", t("nav.settings")],
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
        location.pathname === "/bundles" ||
        location.pathname === "/avatars" ||
        location.pathname === "/worlds"
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

    if (location.pathname === "/avatars") {
      return {
        title: t("avatars.inspectorPaneTitle"),
        body: (
          <div className="space-y-2 text-[12px]">
            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                {t("avatars.totalCount_other", {
                  count: shellReport.local_avatar_data.item_count,
                })}
              </div>
              <div className="mt-1 text-[15px] font-medium">
                {shellReport.local_avatar_data.item_count}
              </div>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("common.none")}
            </div>
          </div>
        ),
      };
    }

    if (location.pathname === "/worlds") {
      return {
        title: t("worlds.inspectorPaneTitle"),
        body: (
          <div className="space-y-2 text-[12px]">
            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                {t("worlds.totalCount_other", {
                  count: shellReport.logs.recent_world_ids.length,
                })}
              </div>
              <div className="mt-1 text-[15px] font-medium">
                {shellReport.logs.recent_world_ids.length}
              </div>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("common.none")}
            </div>
          </div>
        ),
      };
    }

    return null;
  }, [currentMeta.title, location.pathname, shellReport, t, trueCacheCategoryCount, trueCacheLabel]);

  return (
    <ToolbarSearchProvider
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
    >
      <RightDockProvider>
        <div className="flex h-screen w-screen overflow-hidden bg-[hsl(var(--canvas))] text-[hsl(var(--foreground))]">
          <PanelGroup orientation="horizontal">
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

            {/* ── Main content area ── */}
            <Panel defaultSize={85} minSize={20}>
              <div className="flex min-w-0 h-full flex-col overflow-hidden">
                <TitleBar
                  currentPageLabel={currentMeta.title}
                  isRescanning={isRescanning}
                  onRescan={refresh}
                  onResetLayout={() => setLayoutResetToken((value) => value + 1)}
                  onOpenAbout={() => setAboutOpen(true)}
                  vrcRunning={vrcRunning}
                />

                {updateAvailable && (
                  <div className="flex items-center gap-3 bg-[hsl(var(--primary)/0.15)] px-4 py-2 border-b border-[hsl(var(--primary)/0.3)]">
                    <Download className="size-4 shrink-0 text-primary" />
                    <div className="flex-1 text-sm text-[hsl(var(--foreground))]">
                      <strong>Update Available</strong> — VRCSM {updateAvailable.version} is now available!
                    </div>
                    <a
                      href={updateAvailable.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-7 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Download
                    </a>
                  </div>
                )}

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <PanelGroup orientation="horizontal">
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
                                <Route path="/profile" element={<Profile />} />
                                <Route path="/screenshots" element={<Screenshots />} />
                                <Route path="/friend-log" element={<FriendLog />} />
                                <Route path="/logs" element={<Logs />} />
                                <Route path="/radar" element={<Radar />} />
                                <Route path="/migrate" element={<Migrate />} />
                                <Route path="/settings" element={<Settings />} />
                                <Route path="/tools/memory-radar" element={<MemoryRadar />} />
                                <Route path="*" element={<Navigate to="/" replace />} />
                              </Routes>
                            </Suspense>
                          </RouteErrorBoundary>
                        </main>
                      </section>
                    </Panel>
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
                  </PanelGroup>

                  <BottomDock report={shellReport} resetToken={layoutResetToken} />

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
          <Toaster />
        </div>
      </RightDockProvider>
    </ToolbarSearchProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <VrcProcessProvider>
          <ReportProvider>
            <AppContent />
          </ReportProvider>
        </VrcProcessProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
