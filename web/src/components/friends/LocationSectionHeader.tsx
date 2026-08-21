import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * One virtual-list section header for the Friends Locations workspace.
 * Presentational: the page owns i18n strings and collapse state.
 */
export function LocationSectionHeader({
  title,
  subtitle,
  count,
  collapsed,
  pinnedLabel,
  onToggle,
}: {
  title: string;
  subtitle?: string;
  count: number;
  collapsed: boolean;
  pinnedLabel?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 px-1 py-0.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
    >
      {collapsed ? (
        <ChevronRight className="size-3 shrink-0" />
      ) : (
        <ChevronDown className="size-3 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">
        {title}
        {subtitle ? (
          <span className="ml-1.5 font-normal normal-case tracking-normal opacity-70">
            {subtitle}
          </span>
        ) : null}
      </span>
      {pinnedLabel ? (
        <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[9px] normal-case tracking-normal">
          {pinnedLabel}
        </Badge>
      ) : null}
      <Badge
        variant="muted"
        className="h-4 shrink-0 rounded-full px-1.5 font-mono text-[9px] normal-case tracking-normal"
      >
        {count}
      </Badge>
    </button>
  );
}
