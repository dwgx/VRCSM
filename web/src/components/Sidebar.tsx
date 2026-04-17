import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  User,
  UserCircle2,
  Camera,
  ScrollText,
  MoveRight,
  Settings as SettingsIcon,
  Languages,
  Check,
  Globe2,
  Users,
  Radio,
  FileClock,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SUPPORTED_LANGUAGES, changeLanguage } from "@/i18n";
import { ipc } from "@/lib/ipc";
import type { AppVersion } from "@/lib/types";

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
}

const items: NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { to: "/profile", labelKey: "nav.profile", icon: UserCircle2 },
  { to: "/friends", labelKey: "nav.friends", icon: Users },
  { to: "/friend-log", labelKey: "nav.friendLog", icon: FileClock },
  { to: "/radar", labelKey: "nav.radar", icon: Radio },
  { to: "/bundles", labelKey: "nav.bundles", icon: Package },
  { to: "/avatars", labelKey: "nav.avatars", icon: User },
  { to: "/worlds", labelKey: "nav.worlds", icon: Globe2 },
  { to: "/screenshots", labelKey: "nav.screenshots", icon: Camera },
  { to: "/logs", labelKey: "nav.logs", icon: ScrollText },
  { to: "/migrate", labelKey: "nav.migrate", icon: MoveRight },
  { to: "/settings", labelKey: "nav.settings", icon: SettingsIcon },
];

function LanguageMenu() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [open]);

  const current = i18n.resolvedLanguage ?? i18n.language;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5",
          "text-[12px] font-medium text-[hsl(var(--muted-foreground))]",
          "border border-transparent",
          "hover:bg-[hsl(var(--surface-bright))] hover:text-[hsl(var(--foreground))]",
          "transition-colors",
          open &&
            "bg-[hsl(var(--surface-bright))] text-[hsl(var(--foreground))] border-[hsl(var(--border-strong))]",
        )}
      >
        <Languages className="size-[14px]" aria-hidden />
        <span className="flex-1 text-left">{t("nav.language")}</span>
        <span className="text-[10px] font-mono uppercase text-[hsl(var(--muted-foreground))]">
          {current}
        </span>
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 mb-1.5 w-full overflow-hidden rounded-[var(--radius-sm)] m3-surface-bright animate-scale-in">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const active = current === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => {
                  void changeLanguage(lang.code);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px]",
                  "hover:bg-[hsl(var(--surface-raised))]",
                  active
                    ? "text-[hsl(var(--primary))]"
                    : "text-[hsl(var(--foreground))]",
                )}
              >
                <span>{lang.native}</span>
                {active ? <Check className="size-3.5" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function VersionFooter() {
  const [ver, setVer] = useState<AppVersion | null>(null);
  useEffect(() => {
    let alive = true;
    ipc.version().then((v) => { if (alive) setVer(v); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const label = ver ? `v${ver.version} · ${ver.build}` : "v0.5.0";
  return (
    <div className="px-2.5 pt-0.5 text-[10px] font-mono tracking-tight text-[hsl(var(--muted-foreground))]">
      {label}
    </div>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  return (
    <aside
      className={cn(
        "flex h-full w-full flex-col overflow-hidden",
        "bg-[hsl(var(--surface))]",
        "border-r border-[hsl(var(--border))]",
      )}
    >
      {/* App header — app icon + product name */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))]">
        <img
          src="/app-icon.png"
          alt=""
          width={22}
          height={22}
          className="shrink-0 select-none"
          draggable={false}
        />
        <div className="flex min-w-0 flex-col leading-none">
          <span className="text-[13px] font-semibold tracking-tight text-[hsl(var(--foreground))]">
            {t("app.name")}
          </span>
          <span className="mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
            {t("app.tagline")}
          </span>
        </div>
      </div>

      {/* Navigation — Unity ReorderableList style */}
      <nav className="flex flex-1 flex-col gap-px px-1.5 py-1.5">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "relative flex items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5",
                "text-[12.5px] font-medium",
                "text-[hsl(var(--muted-foreground))]",
                "border border-transparent",
                "hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]",
                "transition-colors",
                isActive && [
                  "bg-[hsl(var(--primary)/0.22)]",
                  "text-[hsl(var(--foreground))]",
                  "border-[hsl(var(--primary)/0.55)]",
                ].join(" "),
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[hsl(var(--primary))]"
                  />
                ) : null}
                <item.icon className="size-[14px] shrink-0" aria-hidden />
                <span>{t(item.labelKey)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer — language + version */}
      <div className="flex flex-col gap-1 border-t border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-1.5 py-2">
        <LanguageMenu />
        <VersionFooter />
      </div>
    </aside>
  );
}
