import { useTranslation } from "react-i18next";
import { Users, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useVrchatServerStatus, type ServerStatusLevel } from "@/lib/vrchat-server-status";
import { openExternalUrlQuietly } from "@/lib/shell-api";

const STATUS_DOT: Record<ServerStatusLevel, string> = {
  operational: "bg-emerald-400",
  minor: "bg-yellow-400",
  major: "bg-orange-400",
  critical: "bg-red-500 animate-pulse",
  unknown: "bg-[hsl(var(--muted-foreground))]",
};

interface StatusBarProps {
  breadcrumb: string[];
  cacheTotal: string;
  currentPageLabel: string;
  vrcRunning: boolean;
  version: string;
  /** Friends currently online; null while the friends list hasn't loaded. */
  friendsOnline?: number | null;
}

export function StatusBar({
  breadcrumb,
  cacheTotal,
  currentPageLabel,
  vrcRunning,
  version,
  friendsOnline,
}: StatusBarProps) {
  const { t } = useTranslation();
  const serverStatus = useVrchatServerStatus();

  return (
    <footer className="unity-statusbar flex min-w-0 overflow-x-hidden h-[22px] items-center gap-3 px-3 text-[11px]">
      <div className="min-w-0 truncate text-[hsl(var(--muted-foreground))]">
        <span className="text-[hsl(var(--foreground))]">{currentPageLabel}</span>
        <span className="mx-2 text-[hsl(var(--border-strong))]">/</span>
        <span>{breadcrumb.join(" / ")}</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        {serverStatus && serverStatus.level !== "unknown" && (
          <button
            type="button"
            onClick={() => openExternalUrlQuietly("https://status.vrchat.com")}
            className="flex items-center gap-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors cursor-pointer"
            title={
              serverStatus.description ||
              t("statusBar.serverStatus", { defaultValue: "VRChat server status" })
            }
            aria-label={t("statusBar.serverStatus", { defaultValue: "VRChat server status" })}
          >
            <Activity className="size-3" aria-hidden />
            <span className={cn("inline-block size-1.5 rounded-full", STATUS_DOT[serverStatus.level])} />
            {serverStatus.level !== "operational" && (
              <span className="text-[hsl(var(--foreground))] max-w-[140px] truncate">
                {serverStatus.description || t(`statusBar.serverLevel.${serverStatus.level}`, { defaultValue: serverStatus.level })}
              </span>
            )}
          </button>
        )}
        {typeof friendsOnline === "number" && (
          <span
            className="flex items-center gap-1 text-[hsl(var(--muted-foreground))]"
            title={t("statusBar.onlineCount", { count: friendsOnline, defaultValue: "{{count}} friends online" })}
          >
            <Users className="size-3" aria-hidden />
            <span className="text-[hsl(var(--foreground))]">{friendsOnline}</span>
          </span>
        )}
        <span className="text-[hsl(var(--muted-foreground))]">
          {t("statusBar.cacheTotal")}: {cacheTotal}
        </span>
        <Badge
          variant={vrcRunning ? "success" : "muted"}
          className={cn("h-5 rounded-[var(--radius-sm)] px-2", "text-[10px]")}
        >
          {vrcRunning ? t("toolbar.vrcRunning") : t("toolbar.vrcIdle")}
        </Badge>
        <span className="font-mono text-[hsl(var(--muted-foreground))]">
          {t("statusBar.version", { version })}
        </span>
      </div>
    </footer>
  );
}
