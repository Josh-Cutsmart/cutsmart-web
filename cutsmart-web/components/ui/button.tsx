import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-[10px] border text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-55",
  {
    variants: {
      variant: {
        default: "border-[var(--brand)] bg-[var(--brand)] text-white hover:bg-[var(--brand-strong)] hover:border-[var(--brand-strong)]",
        secondary: "border-[var(--panel-border)] bg-white text-[#334155] hover:bg-[var(--panel-muted)]",
        ghost: "border-transparent bg-transparent text-[#334155] hover:bg-[#EEF2F7]",
        destructive: "border-[#F7C9CC] bg-[#FDECEC] text-[#B42318] hover:bg-[#FADCE0]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-8",
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
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
