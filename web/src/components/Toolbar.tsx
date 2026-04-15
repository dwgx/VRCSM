import {
  createContext,
  useContext,
  type PropsWithChildren,
} from "react";
import { useTranslation } from "react-i18next";
import { Activity, RefreshCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
}: ToolbarProps) {
  const { t } = useTranslation();
  const { searchQuery, setSearchQuery } = useToolbarSearch();

  return (
    <div className="unity-toolbar flex h-9 items-center gap-2 px-3">
      <div className="flex items-center gap-2 border-r border-[hsl(var(--border))] pr-3">
        <img
          src="/app-icon.png"
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

      <div className="relative ml-1 min-w-[240px] max-w-[420px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
        <Input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="h-7 bg-[hsl(var(--canvas))] pl-8"
          placeholder={`${t("toolbar.search")}  ${currentPageLabel}`}
          aria-label={t("toolbar.search")}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Badge variant="outline" className="rounded-[var(--radius-sm)] px-2.5">
          LOCAL
        </Badge>
        <Badge variant="secondary" className="rounded-[var(--radius-sm)] px-2.5">
          DEFAULT
        </Badge>
      </div>
    </div>
  );
}
