import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-[8px] border px-2.5 py-1 text-[11px] font-bold",
  {
    variants: {
      variant: {
        neutral: "border-[var(--panel-border)] bg-[var(--panel-muted)] text-[var(--text-muted)]",
        success:
          "border-[color-mix(in_srgb,var(--success)_30%,var(--panel-bg))] bg-[color-mix(in_srgb,var(--success)_10%,var(--panel-bg))] text-[var(--success-strong)]",
        warning:
          "border-[color-mix(in_srgb,#E3B000_55%,var(--panel-bg))] bg-[color-mix(in_srgb,#FFD700_20%,var(--panel-bg))] text-[color-mix(in_srgb,#C08B00_60%,var(--text-main))]",
        danger: "border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger-strong)]",
        info: "border-[color-mix(in_srgb,var(--brand)_22%,var(--panel-bg))] bg-[color-mix(in_srgb,var(--brand)_8%,var(--panel-bg))] text-[var(--brand-strong)]",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
