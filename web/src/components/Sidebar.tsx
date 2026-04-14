import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  User,
  ScrollText,
  MoveRight,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const items: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/bundles", label: "Bundles", icon: Package },
  { to: "/avatars", label: "Avatars", icon: User },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/migrate", label: "Migrate", icon: MoveRight },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Sidebar() {
  return (
    <aside className="glass flex h-full w-56 shrink-0 flex-col border-r border-border/60">
      <div className="flex flex-col gap-1 px-5 py-6">
        <span className="text-lg font-semibold tracking-tight">VRCSM</span>
        <span className="text-xs text-muted-foreground">VRC Settings Manager</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                isActive && "bg-accent text-foreground shadow-sm",
              )
            }
          >
            <item.icon className="size-4" aria-hidden />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="px-5 py-4 text-[11px] text-muted-foreground/80">
        v0.1.0 · dwgx
      </div>
    </aside>
  );
}
