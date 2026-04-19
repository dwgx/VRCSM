import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Search,
  LayoutDashboard,
  Radio,
  FileText,
  Package,
  Library as LibraryIcon,
  Shirt,
  Globe,
  Users,
  User,
  Camera,
  Settings as SettingsIcon,
  Shuffle,
  RefreshCcw,
  Info,
  UserPlus,
  UserMinus,
  ExternalLink,
  PanelLeftClose,
  PanelBottomClose,
  Plug,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ipc } from "@/lib/ipc";
import { useUiPrefBoolean } from "@/lib/ui-prefs";
import { useInstalledPanelPlugins } from "@/lib/plugin-context";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRescan?: () => void;
  onOpenAbout?: () => void;
}

interface CommandEntry {
  id: string;
  label: string;
  section: string;
  icon: React.ReactNode;
  shortcut?: string;
  hint?: string;
  keywords?: string;
  action: () => void;
}

interface LogEntry {
  id: string | number;
  label: string;
  detail: string;
  section: string;
  kind: "joined" | "left" | string;
  keywords: string;
  action: () => void;
}

const MAX_LOGS = 500;

function matchScore(haystack: string, query: string): number {
  if (!query) return 1;
  const h = haystack.toLowerCase();
  const q = query.toLowerCase();
  if (h === q) return 1000;
  if (h.startsWith(q)) return 500;
  if (h.includes(q)) return 100;
  // Subsequence match (loose fuzzy)
  let i = 0;
  for (const ch of h) {
    if (ch === q[i]) i++;
    if (i === q.length) return 50;
  }
  return 0;
}

export function CommandPalette({
  open,
  onOpenChange,
  onRescan,
  onOpenAbout,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [, setSidebarHidden] = useUiPrefBoolean("vrcsm.layout.sidebar.hidden", false);
  const [, setDockHidden] = useUiPrefBoolean("vrcsm.layout.dock.hidden", false);

  const close = useCallback(() => {
    onOpenChange(false);
    setQuery("");
    setActiveIndex(0);
  }, [onOpenChange]);

  const run = useCallback(
    (action: () => void) => {
      action();
      close();
    },
    [close],
  );

  const panelPlugins = useInstalledPanelPlugins();

  const commands: CommandEntry[] = useMemo(
    () => [
      // Navigation
      { id: "nav-dashboard", section: t("cmd.sections.navigate", { defaultValue: "Navigate" }), label: t("menu.goDashboard"), icon: <LayoutDashboard className="size-3.5" />, shortcut: "Ctrl+1", action: () => navigate("/"), keywords: "home dashboard" },
      { id: "nav-radar", section: t("cmd.sections.navigate", { defaultValue: "Navigate" }), label: t("menu.goRadar"), icon: <Radio className="size-3.5" />, shortcut: "Ctrl+2", action: () => navigate("/radar"), keywords: "radar live instance players" },
      { id: "nav-logs", section: t("cmd.sections.navigate", { defaultValue: "Navigate" }), label: t("menu.goLogs"), icon: <FileText className="size-3.5" />, shortcut: "Ctrl+3", action: () => navigate("/logs"), keywords: "logs output_log" },
      { id: "nav-bundles", section: t("cmd.sections.navigate", { defaultValue: "Navigate" }), label: t("menu.goBundles"), icon: <Package className="size-3.5" />, action: () => navigate("/bundles"), keywords: "bundles cache unityfs" },
      { id: "nav-library", section: t("cmd.sections.navigate", { defaultValue: "Navigate" }), label: t("menu.goLibrary"), icon: <LibraryIcon className="size-3.5" />, action: () => navigate("/library"), keywords: "library assets" },
      { id: "nav-avatars", section: t("cmd.sections.navigate", { defaultValue: "Navigate" }), label: t("menu.goAvatars"), icon: <Shirt className="size-3.5" />, action: () => navigate("/avatars"), keywords: "avatars models" },
      { id: "nav-worlds", section: t("cmd.sections.navigate", { defaultValue: "Navigate" }), label: t("menu.goWorlds"), icon: <Globe className="size-3.5" />, action: () => navigate("/worlds"), keywords: "worlds" },
      { id: "nav-friends", section: t("cmd.sections.navigate", { defaultValue: "Navigate" }), label: t("menu.goFriends"), icon: <Users className="size-3.5" />, action: () => navigate("/friends"), keywords: "friends social" },
      { id: "nav-profile", section: t("cmd.sections.navigate", { defaultValue: "Navigate" }), label: t("menu.goProfile"), icon: <User className="size-3.5" />, action: () => navigate("/profile"), keywords: "profile account me" },
      { id: "nav-vrchat", section: t("cmd.sections.navigate", { defaultValue: "Navigate" }), label: t("menu.goVrchat"), icon: <Globe className="size-3.5" />, action: () => navigate("/vrchat"), keywords: "vrchat workspace" },
      { id: "nav-screenshots", section: t("cmd.sections.navigate", { defaultValue: "Navigate" }), label: t("menu.goScreenshots"), icon: <Camera className="size-3.5" />, action: () => navigate("/screenshots"), keywords: "screenshots media" },
      { id: "nav-migrate", section: t("cmd.sections.navigate", { defaultValue: "Navigate" }), label: t("menu.toolsMigrate"), icon: <Shuffle className="size-3.5" />, action: () => navigate("/migrate"), keywords: "migrate cache junction" },
      { id: "nav-plugins", section: t("cmd.sections.navigate", { defaultValue: "Navigate" }), label: t("nav.plugins", { defaultValue: "Plugins" }), icon: <Plug className="size-3.5" />, action: () => navigate("/plugins"), keywords: "plugins market extensions" },
      { id: "nav-plugins-installed", section: t("cmd.sections.navigate", { defaultValue: "Navigate" }), label: t("plugins.installed.title", { defaultValue: "Installed plugins" }), icon: <Plug className="size-3.5" />, action: () => navigate("/plugins/installed"), keywords: "plugins installed manage" },
      { id: "nav-settings", section: t("cmd.sections.navigate", { defaultValue: "Navigate" }), label: t("menu.toolsSettings"), icon: <SettingsIcon className="size-3.5" />, shortcut: "Ctrl+,", action: () => navigate("/settings"), keywords: "settings preferences" },

      // Actions
      { id: "act-rescan", section: t("cmd.sections.actions", { defaultValue: "Actions" }), label: t("menu.fileRescan"), icon: <RefreshCcw className="size-3.5" />, shortcut: "F5", action: () => onRescan?.(), keywords: "rescan refresh reload" },
      { id: "act-toggle-sidebar", section: t("cmd.sections.actions", { defaultValue: "Actions" }), label: t("menu.viewToggleSidebar"), icon: <PanelLeftClose className="size-3.5" />, shortcut: "Ctrl+B", action: () => setSidebarHidden((v) => !v), keywords: "sidebar toggle hide" },
      { id: "act-toggle-dock", section: t("cmd.sections.actions", { defaultValue: "Actions" }), label: t("menu.viewToggleDock"), icon: <PanelBottomClose className="size-3.5" />, action: () => setDockHidden((v) => !v), keywords: "dock bottom toggle" },
      { id: "act-about", section: t("cmd.sections.actions", { defaultValue: "Actions" }), label: t("menu.helpAbout"), icon: <Info className="size-3.5" />, action: () => onOpenAbout?.(), keywords: "about version" },
      { id: "act-docs", section: t("cmd.sections.actions", { defaultValue: "Actions" }), label: t("menu.helpDocs"), icon: <ExternalLink className="size-3.5" />, action: () => void ipc.call("shell.openUrl", { url: "https://github.com/dwgx/vrcsm" }), keywords: "docs github help" },
      { id: "act-issues", section: t("cmd.sections.actions", { defaultValue: "Actions" }), label: t("menu.helpReportIssue"), icon: <ExternalLink className="size-3.5" />, action: () => void ipc.call("shell.openUrl", { url: "https://github.com/dwgx/vrcsm/issues/new" }), keywords: "report issue bug github" },

      // Dynamic: one entry per enabled panel plugin.
      ...panelPlugins.map((p) => ({
        id: `plugin-open-${p.id}`,
        section: t("cmd.sections.plugins", { defaultValue: "Plugins" }),
        label: p.name,
        icon: <Plug className="size-3.5" />,
        action: () => navigate(`/p/${encodeURIComponent(p.id)}`),
        keywords: `plugin ${p.id} ${p.name}`,
      })),
    ],
    [navigate, onRescan, onOpenAbout, setSidebarHidden, setDockHidden, t, panelPlugins],
  );

  useEffect(() => {
    if (!open) return;
    setLoadingLogs(true);
    let alive = true;
    void ipc
      .dbPlayerEvents(MAX_LOGS, 0)
      .then((res) => {
        if (!alive) return;
        const items = (res.items ?? []) as Array<{
          id: number | string;
          kind: string;
          display_name: string;
          user_id?: string | null;
          world_id?: string | null;
          instance_id?: string | null;
          occurred_at: string;
        }>;
        const mapped: LogEntry[] = items.map((event) => ({
          id: `log-${event.id}`,
          label: event.display_name,
          detail: `${event.occurred_at}  ·  ${event.kind}${event.world_id ? `  ·  ${event.world_id.slice(0, 12)}` : ""}`,
          section: t("cmd.sections.logs", { defaultValue: "Session Logs" }),
          kind: event.kind,
          keywords: [event.display_name, event.user_id ?? "", event.world_id ?? "", event.instance_id ?? "", event.kind, event.occurred_at].join(" "),
          action: () => navigate("/radar"),
        }));
        setLogs(mapped);
      })
      .catch(() => {
        if (alive) setLogs([]);
      })
      .finally(() => {
        if (alive) setLoadingLogs(false);
      });
    return () => {
      alive = false;
    };
  }, [open, navigate, t]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim();
    const allItems: Array<
      | (CommandEntry & { _type: "command"; score: number })
      | (LogEntry & { _type: "log"; score: number })
    > = [];

    for (const cmd of commands) {
      const s = Math.max(
        matchScore(cmd.label, q),
        matchScore(cmd.keywords ?? "", q),
      );
      if (q === "" || s > 0) {
        allItems.push({ ...cmd, _type: "command", score: q === "" ? 1 : s });
      }
    }

    // Only show logs when user types a query; otherwise keep the
    // palette focused on navigation/actions.
    if (q !== "") {
      for (const log of logs) {
        const s = Math.max(
          matchScore(log.label, q),
          matchScore(log.keywords, q),
        );
        if (s > 0) {
          allItems.push({ ...log, _type: "log", score: s });
        }
      }
    }

    allItems.sort((a, b) => b.score - a.score);
    return allItems.slice(0, 80);
  }, [commands, logs, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const item of filtered) {
      const key = item.section;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [filtered]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const current = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-index="${activeIndex}"]`,
    );
    current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = filtered[activeIndex];
      if (item) run(item.action);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  let rollingIndex = 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      <DialogContent
        className="max-w-[640px] gap-0 overflow-hidden p-0"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">
          {t("cmd.title", { defaultValue: "Command Palette" })}
        </DialogTitle>
        <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-3 py-2.5">
          <Search className="size-4 text-[hsl(var(--muted-foreground))]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("cmd.placeholder", {
              defaultValue: "Type a command or search logs, players, worlds…",
            })}
            className="h-7 w-full border-none bg-transparent text-[13px] outline-none placeholder:text-[hsl(var(--muted-foreground))]"
          />
          <span className="shrink-0 rounded border border-[hsl(var(--border))] px-1.5 py-0.5 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
            Esc
          </span>
        </div>

        <div
          ref={listRef}
          className="scrollbar-thin max-h-[60vh] overflow-y-auto"
          tabIndex={-1}
        >
          {grouped.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
              {loadingLogs
                ? t("cmd.loading", { defaultValue: "Loading session logs…" })
                : t("cmd.empty", { defaultValue: "No matching commands." })}
            </div>
          ) : (
            grouped.map(([section, items]) => (
              <div key={section} className="py-1">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                  {section}
                </div>
                {items.map((item) => {
                  const idx = rollingIndex++;
                  const isActive = idx === activeIndex;
                  if (item._type === "command") {
                    return (
                      <button
                        key={item.id}
                        data-index={idx}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px]",
                          "hover:bg-[hsl(var(--surface-raised))]",
                          isActive && "bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--foreground))]",
                        )}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => run(item.action)}
                      >
                        <span className="text-[hsl(var(--muted-foreground))]">{item.icon}</span>
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.shortcut ? (
                          <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                            {item.shortcut}
                          </span>
                        ) : null}
                      </button>
                    );
                  }
                  return (
                    <button
                      key={item.id}
                      data-index={idx}
                      type="button"
                      className={cn(
                        "flex w-full items-start gap-2.5 px-3 py-1.5 text-left text-[12px]",
                        "hover:bg-[hsl(var(--surface-raised))]",
                        isActive && "bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--foreground))]",
                      )}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => run(item.action)}
                    >
                      <span className="mt-0.5 text-[hsl(var(--muted-foreground))]">
                        {item.kind === "joined" ? (
                          <UserPlus className="size-3.5 text-emerald-400" />
                        ) : (
                          <UserMinus className="size-3.5 text-zinc-400" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{item.label}</div>
                        <div className="truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                          {item.detail}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
          <div className="flex items-center gap-3">
            <span>
              <span className="font-mono">↑↓</span> {t("cmd.navigate", { defaultValue: "navigate" })}
            </span>
            <span>
              <span className="font-mono">↵</span> {t("cmd.select", { defaultValue: "select" })}
            </span>
            <span>
              <span className="font-mono">Esc</span> {t("cmd.dismiss", { defaultValue: "dismiss" })}
            </span>
          </div>
          <div>
            {t("cmd.footer", {
              defaultValue: "{{count}} results",
              count: filtered.length,
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      const isAccel = event.ctrlKey || event.metaKey;
      if (isAccel && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen };
}

export default CommandPalette;
