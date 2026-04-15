import * as React from "react";
import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Tonal elevation level.
   * - `flat` — base panel (no shadow)
   * - `raised` — default raised panel
   * - `bright` — brightest modal/popover surface
   */
  elevation?: "flat" | "raised" | "bright";
  /**
   * Whether the card has an interactive hover state layer.
   */
  interactive?: boolean;
}

/**
 * Unity-style panel — solid fill, 1 px hard border, tiny corner radius.
 * No blur, no shadow glow, no translateY on hover.
 */
const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    { className, elevation = "flat", interactive = false, ...props },
    ref,
  ) => {
    const base =
      elevation === "flat"
        ? "m3-surface"
        : elevation === "bright"
          ? "m3-surface-bright"
          : "m3-surface-raised";
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-[var(--radius-lg)] text-[hsl(var(--card-foreground))]",
          base,
          interactive &&
            "m3-state-layer cursor-pointer transition-colors duration-120 hover:border-[hsl(var(--primary)/0.55)]",
          className,
        )}
        {...props}
      />
    );
  },
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-1 px-5 pt-4 pb-3", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "font-semibold leading-tight tracking-tight text-[14px]",
      className,
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "text-[12px] text-[hsl(var(--muted-foreground))]",
      className,
    )}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("px-5 pb-4 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center px-5 pb-4 pt-0", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
