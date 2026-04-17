import type { ReactNode } from "react";

export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-[hsl(var(--foreground))]">
          {label}
        </div>
        {hint ? (
          <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {hint}
          </div>
        ) : null}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function SettingGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))]">
      <header className="unity-panel-header">{title}</header>
      <div className="flex flex-col divide-y divide-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
        {children}
      </div>
    </section>
  );
}
