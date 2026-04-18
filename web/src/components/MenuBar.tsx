import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ipc } from "@/lib/ipc";
import { useUiPrefBoolean, writeUiPrefBoolean } from "@/lib/ui-prefs";

interface MenuBarProps {
  onRescan?: () => void;
  onResetLayout?: () => void;
  onOpenAbout?: () => void;
  onOpenCommandPalette?: () => void;
}

type MenuItemDef =
  | {
      kind?: "item";
      id: string;
      label: string;
      action: () => void;
      shortcut?: string;
      disabled?: boolean;
    }
  | {
      kind: "separator";
      id: string;
    };

interface MenuDef {
  id: string;
  label: string;
  items: MenuItemDef[];
}

function adjustZoom(delta: number) {
  const current = parseFloat(document.body.style.zoom || "1") || 1;
  const next = Math.max(0.6, Math.min(1.6, current + delta));
  document.body.style.zoom = String(next);
  writeUiPrefBoolean("vrcsm.layout.zoom", true);
}

function resetZoom() {
  document.body.style.zoom = "1";
}

export function MenuBar({
  onRescan,
  onResetLayout,
  onOpenAbout,
  onOpenCommandPalette,
}: MenuBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [, setSidebarHidden] = useUiPrefBoolean("vrcsm.layout.sidebar.hidden", false);
  const [, setDockHidden] = useUiPrefBoolean("vrcsm.layout.dock.hidden", false);

  const menus: MenuDef[] = [
    {
      id: "file",
      label: t("menu.file"),
      items: [
        {
          id: "file-rescan",
          label: t("menu.fileRescan"),
          shortcut: "F5",
          action: () => onRescan?.(),
        },
        {
          id: "file-export",
          label: t("menu.fileExportReport"),
          shortcut: "Ctrl+R",
          action: () => navigate("/logs"),
        },
        { kind: "separator", id: "file-sep1" },
        {
          id: "file-exit",
          label: t("menu.fileExit"),
          action: () => window.close(),
        },
      ],
    },
    {
      id: "edit",
      label: t("menu.edit"),
      items: [
        {
          id: "edit-find",
          label: t("menu.editFind"),
          shortcut: "Ctrl+K",
          action: () => onOpenCommandPalette?.(),
        },
        {
          id: "edit-preferences",
          label: t("menu.editPreferences"),
          shortcut: "Ctrl+,",
          action: () => navigate("/settings"),
        },
      ],
    },
    {
      id: "view",
      label: t("menu.view"),
      items: [
        {
          id: "view-toggle-sidebar",
          label: t("menu.viewToggleSidebar"),
          shortcut: "Ctrl+B",
          action: () => setSidebarHidden((current) => !current),
        },
        {
          id: "view-toggle-dock",
          label: t("menu.viewToggleDock"),
          action: () => setDockHidden((current) => !current),
        },
        {
          id: "view-reset-layout",
          label: t("menu.viewResetLayout"),
          action: () => onResetLayout?.(),
        },
        { kind: "separator", id: "view-sep1" },
        {
          id: "view-zoom-in",
          label: t("menu.viewZoomIn"),
          shortcut: "Ctrl++",
          action: () => adjustZoom(0.1),
        },
        {
          id: "view-zoom-out",
          label: t("menu.viewZoomOut"),
          shortcut: "Ctrl+-",
          action: () => adjustZoom(-0.1),
        },
        {
          id: "view-zoom-reset",
          label: t("menu.viewZoomReset"),
          shortcut: "Ctrl+0",
          action: () => resetZoom(),
        },
      ],
    },
    {
      id: "go",
      label: t("menu.go"),
      items: [
        { id: "go-dashboard", label: t("menu.goDashboard"), shortcut: "Ctrl+1", action: () => navigate("/") },
        { id: "go-radar", label: t("menu.goRadar"), shortcut: "Ctrl+2", action: () => navigate("/radar") },
        { id: "go-logs", label: t("menu.goLogs"), shortcut: "Ctrl+3", action: () => navigate("/logs") },
        { kind: "separator", id: "go-sep1" },
        { id: "go-bundles", label: t("menu.goBundles"), action: () => navigate("/bundles") },
        { id: "go-library", label: t("menu.goLibrary"), action: () => navigate("/library") },
        { id: "go-avatars", label: t("menu.goAvatars"), action: () => navigate("/avatars") },
        { id: "go-worlds", label: t("menu.goWorlds"), action: () => navigate("/worlds") },
        { id: "go-screenshots", label: t("menu.goScreenshots"), action: () => navigate("/screenshots") },
        { kind: "separator", id: "go-sep2" },
        { id: "go-friends", label: t("menu.goFriends"), action: () => navigate("/friends") },
        { id: "go-profile", label: t("menu.goProfile"), action: () => navigate("/profile") },
        { id: "go-vrchat", label: t("menu.goVrchat"), action: () => navigate("/vrchat") },
      ],
    },
    {
      id: "tools",
      label: t("menu.tools"),
      items: [
        { id: "tools-migrate", label: t("menu.toolsMigrate"), action: () => navigate("/migrate") },
        { id: "tools-settings", label: t("menu.toolsSettings"), action: () => navigate("/settings") },
        { id: "tools-config", label: t("menu.toolsConfig"), action: () => navigate("/settings") },
        { id: "tools-steamvr", label: t("menu.toolsSteamVR"), action: () => navigate("/settings") },
      ],
    },
    {
      id: "help",
      label: t("menu.help"),
      items: [
        {
          id: "help-docs",
          label: t("menu.helpDocs"),
          action: () => void ipc.call("shell.openUrl", { url: "https://github.com/dwgx/vrcsm" }),
        },
        {
          id: "help-check-updates",
          label: t("menu.helpCheckUpdates"),
          action: () => void ipc.call("shell.openUrl", { url: "https://github.com/dwgx/vrcsm/releases" }),
        },
        {
          id: "help-report-issue",
          label: t("menu.helpReportIssue"),
          action: () => void ipc.call("shell.openUrl", { url: "https://github.com/dwgx/vrcsm/issues/new" }),
        },
        { kind: "separator", id: "help-sep1" },
        {
          id: "help-keyboard",
          label: t("menu.helpKeyboard"),
          shortcut: "Ctrl+K",
          action: () => onOpenCommandPalette?.(),
        },
        {
          id: "help-about",
          label: t("menu.helpAbout"),
          action: () => onOpenAbout?.(),
        },
      ],
    },
  ];

  const focusTrigger = (index: number) => {
    triggerRefs.current[index]?.focus();
  };

  const closeMenu = (focusIndex?: number) => {
    setOpenIndex(null);
    setActiveItemIndex(0);
    if (focusIndex !== undefined) {
      window.requestAnimationFrame(() => focusTrigger(focusIndex));
    }
  };

  const firstActionableIndex = (menuIndex: number) => {
    const items = menus[menuIndex]?.items ?? [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind !== "separator") return i;
    }
    return 0;
  };

  const openMenu = (index: number, itemIndex?: number) => {
    const targetIndex = itemIndex ?? firstActionableIndex(index);
    setOpenIndex(index);
    setActiveItemIndex(targetIndex);
    window.requestAnimationFrame(() => {
      itemRefs.current[targetIndex]?.focus();
    });
  };

  const moveTriggerFocus = (currentIndex: number, delta: number) => {
    const next = (currentIndex + delta + menus.length) % menus.length;
    focusTrigger(next);
    if (openIndex !== null) {
      openMenu(next);
    }
  };

  const moveActiveItem = (menuIndex: number, delta: number) => {
    const items = menus[menuIndex]?.items ?? [];
    if (items.length === 0) return;
    let next = activeItemIndex;
    for (let step = 0; step < items.length; step++) {
      next = (next + delta + items.length) % items.length;
      if (items[next].kind !== "separator") break;
    }
    setActiveItemIndex(next);
    itemRefs.current[next]?.focus();
  };

  useEffect(() => {
    if (openIndex === null) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    };
    const handleWindowBlur = () => closeMenu();
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [openIndex]);

  const handleTriggerKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    menuIndex: number,
  ) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        moveTriggerFocus(menuIndex, 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveTriggerFocus(menuIndex, -1);
        break;
      case "ArrowDown":
      case "Enter":
      case " ":
        event.preventDefault();
        openMenu(menuIndex);
        break;
      case "Escape":
        event.preventDefault();
        closeMenu(menuIndex);
        break;
      default:
        break;
    }
  };

  const handleMenuKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    menuIndex: number,
  ) => {
    const items = menus[menuIndex]?.items ?? [];
    if (items.length === 0) return;
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        moveActiveItem(menuIndex, 1);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        moveActiveItem(menuIndex, -1);
        break;
      }
      case "ArrowRight":
        event.preventDefault();
        moveTriggerFocus(menuIndex, 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveTriggerFocus(menuIndex, -1);
        break;
      case "Home":
        event.preventDefault();
        setActiveItemIndex(firstActionableIndex(menuIndex));
        itemRefs.current[firstActionableIndex(menuIndex)]?.focus();
        break;
      case "End": {
        event.preventDefault();
        let last = items.length - 1;
        while (last > 0 && items[last].kind === "separator") last--;
        setActiveItemIndex(last);
        itemRefs.current[last]?.focus();
        break;
      }
      case "Escape":
        event.preventDefault();
        closeMenu(menuIndex);
        break;
      case "Tab":
        closeMenu();
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={rootRef}
      className="unity-menubar flex h-7 items-center gap-0.5 px-2"
      role="menubar"
      aria-label="Application menu"
    >
      {menus.map((menu, menuIndex) => {
        const isOpen = openIndex === menuIndex;
        return (
          <div
            key={menu.id}
            className="relative"
            onMouseEnter={() => {
              if (openIndex !== null && openIndex !== menuIndex) {
                openMenu(menuIndex);
              }
            }}
          >
            <button
              ref={(node) => {
                triggerRefs.current[menuIndex] = node;
              }}
              type="button"
              role="menuitem"
              aria-haspopup="true"
              aria-expanded={isOpen}
              aria-controls={`${menuId}-${menu.id}`}
              className={cn(
                "unity-menubar-trigger flex h-6 items-center gap-1 rounded-[var(--radius-sm)] px-2.5",
                "text-[12px] text-[hsl(var(--foreground))]",
                "hover:bg-[hsl(var(--surface-bright))]",
                isOpen && "bg-[hsl(var(--surface-bright))]",
              )}
              onClick={() => {
                if (isOpen) {
                  closeMenu(menuIndex);
                } else {
                  openMenu(menuIndex);
                }
              }}
              onKeyDown={(event) => handleTriggerKeyDown(event, menuIndex)}
            >
              <span>{menu.label}</span>
              <ChevronDown className="size-3 text-[hsl(var(--muted-foreground))]" />
            </button>

            {isOpen ? (
              <div
                id={`${menuId}-${menu.id}`}
                role="menu"
                aria-label={menu.label}
                className="absolute left-0 top-[calc(100%+1px)] z-30 min-w-56 overflow-hidden rounded-[var(--radius-md)] m3-surface-bright animate-scale-in py-1"
                onKeyDown={(event) => handleMenuKeyDown(event, menuIndex)}
              >
                {menu.items.map((item, itemIndex) => {
                  if (item.kind === "separator") {
                    return (
                      <div
                        key={item.id}
                        role="separator"
                        className="my-1 h-px bg-[hsl(var(--border)/0.5)]"
                      />
                    );
                  }
                  return (
                    <button
                      key={item.id}
                      ref={(node) => {
                        itemRefs.current[itemIndex] = node;
                      }}
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      className={cn(
                        "flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px]",
                        "hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50",
                        itemIndex === activeItemIndex &&
                          "bg-[hsl(var(--surface-raised))] text-[hsl(var(--foreground))]",
                      )}
                      onMouseEnter={() => setActiveItemIndex(itemIndex)}
                      onClick={() => {
                        item.action();
                        closeMenu(menuIndex);
                      }}
                    >
                      <span>{item.label}</span>
                      {item.shortcut ? (
                        <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                          {item.shortcut}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
