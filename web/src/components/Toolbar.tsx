import {
  createContext,
  useContext,
  type PropsWithChildren,
} from "react";
import { useTranslation } from "react-i18next";
import { Activity, RefreshCcw, Search } from "lucide-react";
import { AuthChip } from "@/components/AuthChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { APP_ICON_URL } from "@/lib/assets";

interface ToolbarSearchContextValue {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
}

interface ToolbarSearchProviderProps extends PropsWithChildren {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
}

interface ToolbarProps {
  currentPageLabel: string;
  isRescanning: boolean;
  vrcRunning: boolean;
  onRescan?: () => void;
  onOpenCommandPalette?: () => void;
}

const fallbackContext: ToolbarSearchContextValue = {
  searchQuery: "",
  setSearchQuery: () => undefined,
};

const ToolbarSearchContext = createContext<ToolbarSearchContextValue | null>(
  null,
);

export function ToolbarSearchProvider({
  children,
  searchQuery,
  onSearchQueryChange,
}: ToolbarSearchProviderProps) {
  return (
    <ToolbarSearchContext.Provider
      value={{ searchQuery, setSearchQuery: onSearchQueryChange }}
    >
      {children}
    </ToolbarSearchContext.Provider>
  );
}

export function useToolbarSearch(): ToolbarSearchContextValue {
  return useContext(ToolbarSearchContext) ?? fallbackContext;
}

export function Toolbar({
  currentPageLabel,
  isRescanning,
  vrcRunning,
  onRescan,
  onOpenCommandPalette,
}: ToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="unity-toolbar flex h-9 items-center gap-2 px-3">
      <div className="flex items-center gap-2 border-r border-[hsl(var(--border))] pr-3">
        <img
          src={APP_ICON_URL}
          alt=""
          width={18}
          height={18}
          className="shrink-0 select-none"
          draggable={false}
        />
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
          workspace
        </span>
      </div>

      <Badge
        variant={vrcRunning ? "success" : "muted"}
        className="h-6 rounded-[var(--radius-sm)] px-2.5"
      >
        <Activity className="size-3.5" />
        {vrcRunning ? t("toolbar.vrcRunning") : t("toolbar.vrcIdle")}
      </Badge>

      <Button
        variant="outline"
        size="sm"
        onClick={onRescan}
        disabled={isRescanning}
      >
        <RefreshCcw className={isRescanning ? "animate-spin" : undefined} />
        {t("toolbar.rescan")}
      </Button>

      <button
        type="button"
        onClick={() => onOpenCommandPalette?.()}
        className="group relative ml-1 flex h-7 min-w-[240px] max-w-[420px] flex-1 items-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] pl-2.5 pr-2 text-left text-[12px] text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--primary)/0.5)] hover:text-[hsl(var(--foreground))]"
        aria-label={t("toolbar.search")}
      >
        <Search className="size-3.5" />
        <span className="flex-1 truncate">
          {t("toolbar.searchPrompt", {
            defaultValue: "Search {{page}} and jump anywhere…",
            page: currentPageLabel,
          })}
        </span>
        <span className="shrink-0 rounded border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-1.5 py-0.5 font-mono text-[10px]">
          Ctrl K
        </span>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <AuthChip />
        <Badge variant="outline" className="rounded-[var(--radius-sm)] px-2.5">
          LOCAL
        </Badge>
      </div>
    </div>
  );
}
