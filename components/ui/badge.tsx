import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-[8px] border px-2.5 py-1 text-[11px] font-bold",
  {
    variants: {
      variant: {
        neutral: "border-[var(--panel-border)] bg-[var(--panel-muted)] text-[#475467]",
        success: "border-[#B7E3C1] bg-[#E9F7EE] text-[#22673A]",
        warning: "border-[#F1D46A] bg-[#FFF7CC] text-[#7A5A00]",
        danger: "border-[#F7C9CC] bg-[#FDECEC] text-[#B42318]",
        info: "border-[#C8DAFF] bg-[#EAF0FF] text-[#0064D6]",
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
