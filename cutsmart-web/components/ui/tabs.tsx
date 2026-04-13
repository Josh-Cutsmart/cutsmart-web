"use client";

import { cn } from "@/lib/utils";

interface TabsProps {
  value: string;
  onChange: (value: string) => void;
  items: Array<{ value: string; label: string; disabled?: boolean; title?: string }>;
}

export function Tabs({ value, onChange, items }: TabsProps) {
  return (
    <div className="inline-flex rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-muted)] p-1">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          disabled={item.disabled}
          title={item.title}
          onClick={() => onChange(item.value)}
          className={cn(
            "rounded-[8px] px-3 py-1.5 text-[12px] font-bold transition",
            item.disabled && "cursor-not-allowed opacity-55",
            value === item.value
              ? "border border-[var(--panel-border)] bg-white text-[var(--text-main)] shadow-sm"
              : "text-[#64748B] hover:text-[#334155]",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
