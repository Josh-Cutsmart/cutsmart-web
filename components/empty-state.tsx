import type { MouseEvent, ReactNode } from "react";
import { glassShineStyle } from "@/lib/glass-shine";

// A list with nothing in it yet: a soft icon, one friendly line (and a hint under it, if it helps), and the one thing to
// do about it — "No leads yet" with Add lead. The same everywhere, so an empty page reads as ready, not broken.
//  - compact: inside a card or a column (smaller, less room around it).
//  - action: its button — the glass shine, round-ended, as New event and New Project. Its onClick has the click (for a
//    pop-up that opens from where it was pressed), as the page's own add button's.
//  - accent: the icon's and button's colour, when the page has its own (Small Jobs' orange) — the brand blue otherwise.
export function EmptyState({
  icon,
  title,
  hint,
  action,
  accent = "var(--brand)",
  compact = false,
  className = "",
}: {
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: { label: string; icon?: ReactNode; onClick: (event: MouseEvent<HTMLButtonElement>) => void; disabled?: boolean };
  accent?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "gap-1.5 px-3 py-5" : "gap-2 px-4 py-10"} ${className}`}>
      {icon ? (
        <span
          aria-hidden="true"
          className={`mb-1 grid shrink-0 place-items-center rounded-full ${compact ? "h-9 w-9" : "h-11 w-11"}`}
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 11%, transparent)`, color: accent }}
        >
          {icon}
        </span>
      ) : null}
      <p className={`font-medium ${compact ? "text-[12.5px]" : "text-[14px]"}`} style={{ color: "var(--text-main)" }}>
        {title}
      </p>
      {hint ? (
        <p className={`max-w-[340px] font-normal leading-snug ${compact ? "text-[11.5px]" : "text-[12.5px]"}`} style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      ) : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className={`glass-shine mt-2 inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold text-white transition hover:brightness-105 disabled:opacity-60 ${compact ? "h-8 px-3.5 text-[12px]" : "h-9 px-4 text-[12.5px]"}`}
          style={glassShineStyle(accent)}
        >
          {action.icon}
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
