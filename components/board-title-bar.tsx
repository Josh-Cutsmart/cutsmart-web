"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { glassShineStyle } from "@/lib/glass-shine";

type Crumb = { label: string; color: string; count: number };

// Which board this is, over its columns (the Dashboard's and Leads' kanban boards): a glass pill with the board's icon
// on a tile in its colour (Projects blue, Leads purple), its name, and how many are on it — so the two boards, alike
// otherwise, can't be mistaken for each other. Inside a column's sub-board (the Dashboard's sub-statuses) it's the way
// back too: a round back arrow in the icon's place (inside the pill, so nothing moves over for it), the board's name
// (back to it as well), then the column's own dot, name and count.
//
// Going into a sub-board and back out slides rather than jumps: the icon's tile shrinks away as the back arrow grows in
// on the same spot, and the count slides over to the end — its number fading to the column's — uncovering the
// column's name from behind it as it goes. The other way round on the way back: the count slides back over the name,
// fading back to the board's number.
//
// Over the board's scroller, which reaches up under it (its columns' shadows need the room — the scroller cuts off
// whatever's past its edge): so it's above it, and only its own buttons take the pointer, not the row it's in.
export function BoardTitleBar({
  icon: Icon,
  title,
  color,
  count,
  crumb,
  onBack,
  className,
}: {
  icon: LucideIcon;
  title: string;
  // Its colour: the icon's tile and the pill's light wash.
  color: string;
  count: number;
  // Inside a column (the sub-board): that column.
  crumb?: Crumb | null;
  onBack?: () => void;
  className?: string;
}) {
  const inSub = Boolean(crumb);
  // The last column it was in — still shown while the count slides back over it on the way out.
  const [shownCrumb, setShownCrumb] = useState<Crumb | null>(crumb ?? null);
  if (crumb && (crumb.label !== shownCrumb?.label || crumb.color !== shownCrumb?.color || crumb.count !== shownCrumb?.count)) {
    setShownCrumb(crumb);
  }
  // Both numbers in the one spot, fading between: the board's, then the column's while in one.
  const countNumber = (value: number | undefined, shown: boolean) => (
    <span
      aria-hidden={!shown}
      className="col-start-1 row-start-1 transition-opacity duration-300 ease-out motion-reduce:transition-none"
      style={{ opacity: shown ? 1 : 0 }}
    >
      {value}
    </span>
  );
  return (
    <div className={`pointer-events-none relative z-[2] flex shrink-0 items-center ${className ?? ""}`}>
      <div
        className="pointer-events-auto relative z-[1] inline-flex h-10 min-w-0 items-center rounded-full border pl-1 pr-1"
        style={{
          borderColor: `color-mix(in srgb, ${color} 30%, var(--glass-border))`,
          backgroundColor: `color-mix(in srgb, ${color} 9%, var(--panel-bg))`,
          backdropFilter: "blur(16px) saturate(180%)",
          WebkitBackdropFilter: "blur(16px) saturate(180%)",
        }}
      >
        {/* The board's icon on its tile — or, inside a column, the back arrow on the same spot. */}
        <span className="relative grid h-8 w-8 shrink-0 place-items-center">
          {/* (Not in the way of the back arrow once it's faded out: shrinking, it's drawn over it.) */}
          <span
            aria-hidden={inSub}
            className="glass-shine col-start-1 row-start-1 inline-flex h-8 w-8 items-center justify-center rounded-full border transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none"
            style={glassShineStyle(color, { opacity: inSub ? 0 : 1, pointerEvents: inSub ? "none" : undefined })}
          >
            <span
              className="inline-flex transition-transform duration-300 ease-out motion-reduce:transition-none"
              style={{ transform: inSub ? "scale(0.6)" : "none" }}
            >
              <Icon size={16} color="#ffffff" strokeWidth={2.3} aria-hidden="true" />
            </span>
          </span>
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              disabled={!inSub}
              tabIndex={inSub ? 0 : -1}
              aria-hidden={!inSub}
              aria-label={`Back to ${title}`}
              title={`Back to ${title}`}
              // The same tile in the board's colour, its icon now the back arrow (the folder's fades out as it fades in).
              className="glass-shine relative z-[1] col-start-1 row-start-1 inline-flex h-8 w-8 items-center justify-center rounded-full border text-white transition-[opacity,filter] duration-300 ease-out enabled:hover:brightness-105 disabled:pointer-events-none motion-reduce:transition-none"
              style={glassShineStyle(color, { opacity: inSub ? 1 : 0 })}
            >
              <span
                className="inline-flex transition-transform duration-300 ease-out motion-reduce:transition-none"
                style={{ transform: inSub ? "none" : "translateX(6px) scale(0.6)" }}
              >
                <ChevronLeft size={18} strokeWidth={2.5} aria-hidden="true" />
              </span>
            </button>
          ) : null}
        </span>
        {onBack ? (
          // The board's name: back to it too while in a column (muted then — the column's name is where you are).
          <button
            type="button"
            onClick={onBack}
            disabled={!inSub}
            tabIndex={inSub ? 0 : -1}
            className="ml-2.5 mr-2.5 shrink-0 text-[16px] font-medium transition-[color,opacity] duration-300 enabled:hover:opacity-75 motion-reduce:transition-none"
            style={{ color: inSub ? "var(--text-muted)" : "var(--text-main)" }}
          >
            {title}
          </button>
        ) : (
          <span className="ml-2.5 mr-2.5 min-w-0 truncate text-[16px] font-medium" style={{ color: "var(--text-main)" }}>
            {title}
          </span>
        )}
        {/* The column's part: a one-column grid going between none of its width (0fr) and all of it (1fr), cut off
            along its right edge — right where the count starts (the gap before the count is its own pr-2.5), so the
            count sliding over uncovers it from behind. There (shut, empty) from the start wherever there's a way back,
            so it slides open the first time too. */}
        {onBack || shownCrumb ? (
          <span
            aria-hidden={!inSub}
            className="grid min-w-0 transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none"
            style={{ gridTemplateColumns: inSub ? "minmax(0, 1fr)" : "minmax(0, 0fr)" }}
          >
            <span className="flex min-w-0 items-center overflow-hidden whitespace-nowrap">
              {shownCrumb ? (
                <>
                  <ChevronRight size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} aria-hidden="true" />
                  <span className="ml-2.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: shownCrumb.color }} aria-hidden="true" />
                  <span className="ml-2.5 min-w-0 truncate pr-2.5 text-[16px] font-medium" style={{ color: "var(--text-main)" }}>
                    {shownCrumb.label}
                  </span>
                </>
              ) : null}
            </span>
          </span>
        ) : null}
        {/* The size of the icon's circle at the other end (32px — wider for a long number). */}
        <span
          className="inline-grid h-8 min-w-8 shrink-0 place-items-center rounded-full px-2 text-[13px] font-semibold"
          style={{ backgroundColor: "color-mix(in srgb, var(--text-main) 8%, transparent)", color: "var(--text-main)" }}
        >
          {countNumber(count, !inSub)}
          {/* There from the start too (empty until there's a column), so it fades in the first time as well. */}
          {onBack || shownCrumb ? countNumber(shownCrumb?.count, inSub) : null}
        </span>
      </div>
    </div>
  );
}
