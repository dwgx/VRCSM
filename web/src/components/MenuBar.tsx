import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface MenuBarProps {
  onRescan?: () => void;
  onResetLayout?: () => void;
  onOpenAbout?: () => void;
}

interface MenuItemDef {
  id: string;
  label: string;
  action: () => void;
  shortcut?: string;
}

interface MenuDef {
  id: string;
  label: string;
  items: MenuItemDef[];
}

export function MenuBar({ onRescan, onResetLayout, onOpenAbout }: MenuBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [activeItemIndex, setActiveItemIndex] = useState(0);

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
          id: "edit-dashboard",
          label: t("nav.dashboard"),
          action: () => navigate("/"),
        },
        {
          id: "edit-logs",
          label: t("nav.logs"),
          action: () => navigate("/logs"),
        },
        {
          id: "edit-settings",
          label: t("nav.settings"),
          action: () => navigate("/settings"),
        },
      ],
    },
    {
      id: "assets",
      label: t("menu.assets"),
      items: [
        {
          id: "assets-bundles",
          label: t("nav.bundles"),
          action: () => navigate("/bundles"),
        },
        {
          id: "assets-avatars",
          label: t("nav.avatars"),
          action: () => navigate("/avatars"),
        },
        {
          id: "assets-worlds",
          label: t("nav.worlds"),
          action: () => navigate("/worlds"),
        },
      ],
    },
    {
      id: "window",
      label: t("menu.window"),
      items: [
        {
          id: "window-dashboard",
          label: t("nav.dashboard"),
          action: () => navigate("/"),
        },
        {
          id: "window-reset-layout",
          label: t("menu.windowResetLayout"),
          action: () => onResetLayout?.(),
        },
        {
          id: "window-settings",
          label: t("nav.settings"),
          action: () => navigate("/settings"),
        },
      ],
    },
    {
      id: "help",
      label: t("menu.help"),
      items: [
        {
          id: "help-about",
          label: t("menu.helpAbout"),
          action: () => onOpenAbout?.(),
        },
        {
          id: "help-docs",
          label: t("menu.helpDocs"),
          action: () => onOpenAbout?.(),
        },
        {
          id: "help-check-updates",
          label: t("menu.helpCheckUpdates"),
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

  const openMenu = (index: number, itemIndex = 0) => {
    setOpenIndex(index);
    setActiveItemIndex(itemIndex);
    window.requestAnimationFrame(() => {
      itemRefs.current[itemIndex]?.focus();
    });
  };

  const moveTriggerFocus = (currentIndex: number, delta: number) => {
    const next = (currentIndex + delta + menus.length) % menus.length;
    focusTrigger(next);
    if (openIndex !== null) {
      openMenu(next);
    }
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
        const next = (activeItemIndex + 1) % items.length;
        setActiveItemIndex(next);
        itemRefs.current[next]?.focus();
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        const next = (activeItemIndex - 1 + items.length) % items.length;
        setActiveItemIndex(next);
        itemRefs.current[next]?.focus();
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
        setActiveItemIndex(0);
        itemRefs.current[0]?.focus();
        break;
      case "End": {
        event.preventDefault();
        const next = items.length - 1;
        setActiveItemIndex(next);
        itemRefs.current[next]?.focus();
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
                className="absolute left-0 top-[calc(100%+1px)] z-30 min-w-52 overflow-hidden rounded-[var(--radius-md)] m3-surface-bright animate-scale-in"
                onKeyDown={(event) => handleMenuKeyDown(event, menuIndex)}
              >
                {menu.items.map((item, itemIndex) => (
                  <button
                    key={item.id}
                    ref={(node) => {
                      itemRefs.current[itemIndex] = node;
                    }}
                    type="button"
                    role="menuitem"
                    className={cn(
                      "flex w-full items-center justify-between gap-6 px-3 py-2 text-left text-[12px]",
                      "hover:bg-[hsl(var(--surface-raised))]",
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
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
