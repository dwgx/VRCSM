import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

/** Unity-style single-line input — flat, 1 px border, inset focus ring. */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-8 w-full rounded-[var(--radius-sm)]",
        "border border-[hsl(var(--border-strong))]",
        "bg-[hsl(var(--input))] px-3 py-1",
        "text-[13px] text-[hsl(var(--foreground))]",
        "placeholder:text-[hsl(var(--muted-foreground))]",
        "transition-[border-color] duration-120",
        "focus-visible:border-[hsl(var(--primary))] focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[hsl(var(--foreground))]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
