import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBarProps {
  breadcrumb: string[];
  cacheTotal: string;
  currentPageLabel: string;
  vrcRunning: boolean;
  version: string;
}

export function StatusBar({
  breadcrumb,
  cacheTotal,
  currentPageLabel,
  vrcRunning,
  version,
}: StatusBarProps) {
  const { t } = useTranslation();

  return (
    <footer className="unity-statusbar flex h-[22px] items-center gap-3 px-3 text-[11px]">
      <div className="min-w-0 truncate text-[hsl(var(--muted-foreground))]">
        <span className="text-[hsl(var(--foreground))]">{currentPageLabel}</span>
        <span className="mx-2 text-[hsl(var(--border-strong))]">/</span>
        <span>{breadcrumb.join(" / ")}</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
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
