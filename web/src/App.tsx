import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
import { ipc } from "@/lib/ipc";
import type { ProcessStatus } from "@/lib/types";
import { formatDate } from "@/lib/utils";

// Lazy-load every page so navigating between tabs doesn't cost us a
// second tree of page modules upfront. The shared report context keeps
// us from re-scanning when pages mount.
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Bundles = lazy(() => import("@/pages/Bundles"));
const Avatars = lazy(() => import("@/pages/Avatars"));
const Worlds = lazy(() => import("@/pages/Worlds"));
const Logs = lazy(() => import("@/pages/Logs"));
const Migrate = lazy(() => import("@/pages/Migrate"));
const Settings = lazy(() => import("@/pages/Settings"));

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
  const [vrcRunning, setVrcRunning] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

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
      "/avatars": {
        title: t("nav.avatars"),
        breadcrumb: ["Assets", t("nav.avatars")],
      },
      "/worlds": {
        title: t("nav.worlds"),
        breadcrumb: ["Assets", t("nav.worlds")],
      },
      "/logs": {
        title: t("nav.logs"),
        breadcrumb: ["Diagnostics", t("nav.logs")],
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
  const shellVersion = "v0.1.1";

  useEffect(() => {
    setSearchQuery("");
  }, [location.pathname]);

  useEffect(() => {
    let alive = true;

    const updateProcessState = () => {
      ipc
        .call<undefined, ProcessStatus>("process.vrcRunning")
        .then((status) => {
          if (alive) {
            setVrcRunning(status.running);
          }
        })
        .catch(() => {
          if (alive) {
            setVrcRunning(false);
          }
        });
    };

    updateProcessState();
    const timer = window.setInterval(updateProcessState, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
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
                  {shellReport.total_bytes_human}
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
  }, [currentMeta.title, location.pathname, shellReport, t]);

  return (
    <ToolbarSearchProvider
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
    >
      <RightDockProvider>
        <div className="flex h-screen w-screen overflow-hidden bg-[hsl(var(--canvas))] text-[hsl(var(--foreground))]">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <TitleBar
              currentPageLabel={currentMeta.title}
              isRescanning={isRescanning}
              onRescan={refresh}
              onResetLayout={() => setLayoutResetToken((value) => value + 1)}
              onOpenAbout={() => setAboutOpen(true)}
              vrcRunning={vrcRunning}
            />

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-0 flex-1 overflow-hidden">
                <section className="unity-dock flex min-w-0 flex-1 flex-col overflow-hidden">
                  <div className="flex h-8 items-end gap-1 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-2 pt-1">
                    <div className="unity-tab unity-tab-active">
                      {currentMeta.title}
                    </div>
                  </div>
                  <main className="scrollbar-thin flex-1 overflow-y-auto bg-[hsl(var(--surface))] px-6 py-5">
                    {/*
                      `resetKey={location.pathname}` makes the boundary
                      auto-clear on tab switch — no dangling error state
                      from a page you already navigated away from.
                    */}
                    <RouteErrorBoundary resetKey={location.pathname}>
                      <Suspense fallback={<PageFallback />}>
                        <Routes>
                          <Route path="/" element={<Dashboard />} />
                          <Route path="/bundles" element={<Bundles />} />
                          <Route path="/avatars" element={<Avatars />} />
                          <Route path="/worlds" element={<Worlds />} />
                          <Route path="/logs" element={<Logs />} />
                          <Route path="/migrate" element={<Migrate />} />
                          <Route path="/settings" element={<Settings />} />
                          <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                      </Suspense>
                    </RouteErrorBoundary>
                  </main>
                </section>

                <RightDock fallback={rightDockFallback} />
              </div>

              <BottomDock report={shellReport} resetToken={layoutResetToken} />

              <StatusBar
                breadcrumb={currentMeta.breadcrumb}
                cacheTotal={shellReport?.total_bytes_human ?? "—"}
                currentPageLabel={currentMeta.title}
                version={shellVersion}
                vrcRunning={vrcRunning}
              />
            </div>
          </div>
          <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
          <Toaster />
        </div>
      </RightDockProvider>
    </ToolbarSearchProvider>
  );
}

function App() {
  return (
    <ReportProvider>
      <AppContent />
    </ReportProvider>
  );
}

export default App;
