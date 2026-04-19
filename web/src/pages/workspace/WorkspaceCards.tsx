/**
 * Small, reusable card-style UI widgets for the VRChat Workspace page.
 * Extracted from VrchatWorkspace.tsx to reduce file size.
 */

import type { Orbit } from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import { normalizeFavoriteType } from "@/lib/library";
import type { FavoriteItem } from "@/lib/types";

export function WorkspaceActionCard({
  icon: Icon,
  title,
  body,
  onClick,
}: {
  icon: typeof Orbit;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3 text-left transition-colors hover:border-[hsl(var(--primary)/0.45)] hover:bg-[hsl(var(--primary)/0.08)]"
    >
      <div className="flex size-9 items-center justify-center rounded-[var(--radius-sm)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]">
        <Icon className="size-4" />
      </div>
      <div className="space-y-1">
        <div className="text-[13px] font-semibold text-[hsl(var(--foreground))]">{title}</div>
        <div className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">{body}</div>
      </div>
    </button>
  );
}

export function CountPill({ count }: { count: number }) {
  return (
    <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[hsl(var(--secondary))] px-2 py-0.5 text-[10px] font-semibold leading-none text-[hsl(var(--secondary-foreground))]">
      {count}
    </span>
  );
}

export function SectionTitle({
  title,
  count,
}: {
  title: string;
  count: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>{title}</span>
      <CountPill count={count} />
    </div>
  );
}

export function SidebarFactCard({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: typeof Orbit;
  label: string;
  value: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Card elevation="flat">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
              {label}
            </div>
            <div className="min-w-0 text-[14px] font-semibold leading-tight text-[hsl(var(--foreground))]">
              {value}
            </div>
            {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function FavoriteTypeBadge({ item }: { item: FavoriteItem }) {
  const { t } = useTranslation();
  const type = normalizeFavoriteType(item.type);
  return (
    <Badge variant="secondary">
      {t(
        type === "avatar"
          ? "library.types.avatar"
          : type === "world"
            ? "library.types.world"
            : type === "user"
              ? "library.types.user"
              : "library.types.other",
      )}
    </Badge>
  );
}
