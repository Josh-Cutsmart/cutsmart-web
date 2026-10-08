"use client";

import type { HTMLAttributes, ReactNode } from "react";

// A kanban column's frame (the Dashboard and Leads boards). While a board scrolls up into place, its
// columns' bottom edges stay on the bottom of the screen (lib/board-sticky-scroll.ts). That used to be
// done by changing each column's height on every scroll frame, which always landed a frame behind the
// scroll itself — the bottom edge wobbled. This frame does it with transforms the browser moves along
// with the scroll instead, so it never changes size:
//
//  - the slot (data-board-column): the column's place in the row, at its full height; nothing in it
//    shows itself.
//  - the lift (data-board-column-lift): moved up by however much of the column is past the bottom of
//    the screen. It holds:
//    - the window (.board-column-window in globals.css): shows only what's above its bottom edge —
//      with room around the top and sides for the column's shadow, and the column's own rounded
//      corners along the bottom — so it's where the column is cut off.
//      - the body (data-board-column-drop): the column itself (children), moved back down by the same
//        amount, so it doesn't move at all — only where it's cut off does.
//    - the cap (.board-column-cap): the column's shadow along that bottom edge (the window cuts off
//      the body's own there).
//
// Once the board is in place nothing is moved and the column shows whole.
//
// Only the body takes the pointer: the lift and window are see-through boxes reaching 48px past the
// column's sides (the shadow's room), over the edges of the columns either side of it — taking the
// pointer, they swallowed clicks on a neighbour's header buttons (its collapse button) and drops near
// its edge.
export function BoardColumnFrame({
  className,
  shadow,
  children,
  ...slotProps
}: {
  // The slot's size and place in the row (height, width, shrink, snap).
  className: string;
  // The column's box-shadow, as it would be on the column itself.
  shadow: string;
  // The column: a rounded-[16px], h-full w-full element.
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...slotProps} data-board-column="true" className={`relative ${className}`}>
      <div data-board-column-lift="true" className="pointer-events-none absolute inset-0">
        <div className="board-column-window absolute -left-12 -right-12 -top-12 bottom-0">
          <div data-board-column-drop="true" className="pointer-events-auto absolute bottom-0 left-12 right-12 top-12" style={{ borderRadius: 16, boxShadow: shadow }}>
            {children}
          </div>
        </div>
        <div aria-hidden="true" className="board-column-cap pointer-events-none absolute inset-0 rounded-[16px]" style={{ boxShadow: outerShadowsOnly(shadow) }} />
      </div>
    </div>
  );
}

// The collapse button's arrows (lucide's ChevronsRightLeft, ><), drawn so each arrow can turn round
// on its own spot: flipped, they're exactly ChevronsLeftRight (<>), the collapsed strip's expand
// button — which is how the button turns from one into the other as a column collapses or expands
// (lib/board-column-collapse.ts; the turning itself is in globals.css).
export function ColumnCollapseChevrons({ size = 14, flipped = false }: { size?: number; flipped?: boolean }) {
  return (
    <svg
      className="column-collapse-chevrons"
      data-flipped={flipped ? "true" : undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m20 17-5-5 5-5" />
      <path d="m4 17 5-5-5-5" />
    </svg>
  );
}

// Just the shadows outside the column (the cap has no background, so ones drawn inside it would show
// on top of the column rather than under it).
function outerShadowsOnly(shadow: string) {
  return shadow
    .split(/,(?![^(]*\))/)
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("inset"))
    .join(", ");
}

// A column's box as it shows right now — the slot is always its full height, even while the bottom of
// it is cut off.
export function getBoardColumnVisibleRect(slot: HTMLElement) {
  const rect = slot.getBoundingClientRect();
  const lift = slot.querySelector<HTMLElement>("[data-board-column-lift]");
  const bottom = lift ? Math.min(rect.bottom, lift.getBoundingClientRect().bottom) : rect.bottom;
  return { left: rect.left, top: rect.top, width: rect.width, height: Math.max(0, bottom - rect.top) };
}
