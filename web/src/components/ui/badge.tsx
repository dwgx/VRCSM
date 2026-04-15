import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Unity-style tag / label — small rectangular badge, 1 px border.
 */
const badgeVariants = cva(
  [
    "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5",
    "text-[11px] font-medium tracking-wide",
    "transition-colors focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]",
    "[&_svg]:size-3 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-[hsl(var(--primary)/0.18)] text-[hsl(var(--primary))] border border-[hsl(var(--primary)/0.45)]",
        tonal:
          "bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))] border border-[hsl(var(--primary)/0.40)]",
        secondary:
          "bg-[hsl(var(--surface-bright))] text-[hsl(var(--secondary-foreground))] border border-[hsl(var(--border-strong))]",
        destructive:
          "bg-[hsl(var(--destructive)/0.16)] text-[hsl(var(--destructive))] border border-[hsl(var(--destructive)/0.45)]",
        outline:
          "border border-[hsl(var(--border-strong))] text-[hsl(var(--foreground))]",
        success:
          "bg-[hsl(var(--success)/0.16)] text-[hsl(var(--success))] border border-[hsl(var(--success)/0.45)]",
        warning:
          "bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning))] border border-[hsl(var(--warning)/0.45)]",
        muted:
          "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border-strong))]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
