import { useTranslation } from "react-i18next";
import {
  Columns2,
  Columns3,
  LayoutGrid,
  LayoutList,
  Rows3,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUiPrefString } from "@/lib/ui-prefs";

export type LayoutMode = "default" | "grid-3" | "grid-2" | "row" | "list";

export const LAYOUT_MODES: LayoutMode[] = ["default", "grid-3", "grid-2", "row", "list"];

const ICONS: Record<LayoutMode, LucideIcon> = {
  "default": LayoutGrid,
  "grid-3": Columns3,
  "grid-2": Columns2,
  "row": Rows3,
  "list": LayoutList,
};

const LABELS: Record<LayoutMode, { key: string; fallback: string }> = {
  "default": { key: "layout.default", fallback: "默认" },
  "grid-3": { key: "layout.grid3", fallback: "九宫格" },
  "grid-2": { key: "layout.grid2", fallback: "四宫格" },
  "row": { key: "layout.row", fallback: "一排" },
  "list": { key: "layout.list", fallback: "一列" },
};

export function useLayoutMode(prefKey: string, fallback: LayoutMode = "default") {
  const [value, setValue] = useUiPrefString(`vrcsm.layout.${prefKey}.mode`, fallback);
  return [value as LayoutMode, setValue as (next: LayoutMode) => void] as const;
}

export function LayoutModeSwitcher({
  value,
  onChange,
  modes = LAYOUT_MODES,
  className,
}: {
  value: LayoutMode;
  onChange: (next: LayoutMode) => void;
  modes?: LayoutMode[];
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-0.5",
        className,
      )}
      role="radiogroup"
      aria-label={t("layout.switcher", { defaultValue: "切换布局" })}
    >
      {modes.map((mode) => {
        const Icon = ICONS[mode];
        const { key, fallback } = LABELS[mode];
        const active = value === mode;
        return (
          <Button
            key={mode}
            variant={active ? "secondary" : "ghost"}
            size="icon"
            className="size-7"
            onClick={() => onChange(mode)}
            title={t(key, { defaultValue: fallback })}
            aria-label={t(key, { defaultValue: fallback })}
            aria-pressed={active}
          >
            <Icon className="size-3.5" />
          </Button>
        );
      })}
    </div>
  );
}
