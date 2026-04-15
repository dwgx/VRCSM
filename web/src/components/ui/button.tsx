import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Unity editor style button — flat rectangle, 1px borders, no glow.
 */
const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
    "rounded-[var(--radius-md)] text-[13px] font-medium select-none",
    "transition-[background,color,border-color] duration-120",
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]",
    "focus-visible:ring-offset-1 focus-visible:ring-offset-[hsl(var(--canvas))]",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0",
    "active:translate-y-px",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
          "border border-[hsl(0_0%_0%/0.35)]",
          "hover:bg-[hsl(210_72%_62%)]",
          "active:bg-[hsl(210_72%_50%)]",
        ].join(" "),
        tonal: [
          "bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]",
          "border border-[hsl(var(--primary)/0.45)]",
          "hover:bg-[hsl(var(--primary)/0.24)]",
        ].join(" "),
        destructive: [
          "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]",
          "border border-[hsl(0_0%_0%/0.35)]",
          "hover:bg-[hsl(0_60%_58%)]",
          "active:bg-[hsl(0_60%_46%)]",
        ].join(" "),
        outline: [
          "bg-[hsl(var(--surface-raised))] text-[hsl(var(--foreground))]",
          "border border-[hsl(var(--border-strong))]",
          "hover:bg-[hsl(var(--surface-bright))]",
          "active:bg-[hsl(var(--surface))]",
        ].join(" "),
        secondary: [
          "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]",
          "border border-[hsl(var(--border-strong))]",
          "hover:bg-[hsl(var(--surface-bright))]",
        ].join(" "),
        ghost: [
          "text-[hsl(var(--foreground))]",
          "border border-transparent",
          "hover:bg-[hsl(var(--surface-bright))]",
        ].join(" "),
        link: [
          "text-[hsl(var(--primary))] underline-offset-4 hover:underline",
          "rounded-none border border-transparent",
        ].join(" "),
      },
      size: {
        default: "h-8 px-3.5 py-1",
        sm: "h-7 px-3 text-[12px]",
        lg: "h-9 px-5 text-[14px]",
        icon: "h-8 w-8",
        "icon-sm": "h-7 w-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
