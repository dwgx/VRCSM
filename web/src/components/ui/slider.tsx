import * as React from "react";
import { cn } from "@/lib/utils";

export interface SliderProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "defaultValue" | "onChange"
  > {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  unit?: string;
  formatValue?: (value: number) => string;
  showValue?: boolean;
}

export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  (
    {
      className,
      value,
      defaultValue,
      min = 0,
      max = 100,
      step = 1,
      disabled,
      unit,
      formatValue,
      showValue = true,
      onValueChange,
      ...props
    },
    ref,
  ) => {
    const numericMin = typeof min === "string" ? Number(min) : (min ?? 0);
    const numericMax = typeof max === "string" ? Number(max) : (max ?? 100);
    const resolved: number =
      value !== undefined
        ? value
        : defaultValue !== undefined
          ? defaultValue
          : numericMin;
    const pct = Math.max(
      0,
      Math.min(
        100,
        ((resolved - numericMin) / Math.max(1e-9, numericMax - numericMin)) * 100,
      ),
    );
    const display =
      formatValue != null ? formatValue(resolved) : `${resolved}${unit ?? ""}`;
    return (
      <div
        className={cn("flex items-center gap-2 w-full", className)}
        data-slot="slider-root"
      >
        <div className="relative flex-1 h-5 flex items-center">
          <div className="absolute inset-x-0 h-[3px] rounded-full bg-[hsl(var(--muted))]" />
          <div
            className={cn(
              "absolute left-0 h-[3px] rounded-full transition-[width]",
              disabled
                ? "bg-[hsl(var(--muted-foreground)/0.4)]"
                : "bg-[hsl(var(--primary))]",
            )}
            style={{ width: `${pct}%` }}
          />
          <input
            ref={ref}
            type="range"
            min={min}
            max={max}
            step={step}
            value={resolved}
            disabled={disabled}
            onChange={(e) => onValueChange?.(Number(e.target.value))}
            className={cn(
              "absolute inset-0 w-full appearance-none bg-transparent cursor-pointer",
              "[&::-webkit-slider-thumb]:appearance-none",
              "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4",
              "[&::-webkit-slider-thumb]:rounded-full",
              "[&::-webkit-slider-thumb]:bg-[hsl(var(--primary))]",
              "[&::-webkit-slider-thumb]:border-2",
              "[&::-webkit-slider-thumb]:border-[hsl(var(--surface))]",
              "[&::-webkit-slider-thumb]:shadow",
              "[&::-webkit-slider-thumb]:transition-transform",
              "hover:[&::-webkit-slider-thumb]:scale-110",
              "active:[&::-webkit-slider-thumb]:scale-95",
              "disabled:opacity-60 disabled:cursor-not-allowed",
              "disabled:[&::-webkit-slider-thumb]:bg-[hsl(var(--muted-foreground))]",
              "focus:outline-none focus-visible:[&::-webkit-slider-thumb]:ring-2",
              "focus-visible:[&::-webkit-slider-thumb]:ring-[hsl(var(--primary))]",
              "focus-visible:[&::-webkit-slider-thumb]:ring-offset-2",
              "focus-visible:[&::-webkit-slider-thumb]:ring-offset-[hsl(var(--surface))]",
            )}
            {...props}
          />
        </div>
        {showValue && (
          <span className="text-[11px] tabular-nums whitespace-nowrap min-w-[40px] text-right text-[hsl(var(--muted-foreground))]">
            {display}
          </span>
        )}
      </div>
    );
  },
);
Slider.displayName = "Slider";
