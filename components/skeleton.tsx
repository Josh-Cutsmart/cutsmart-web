import type { CSSProperties, ReactNode } from "react";

// Loading placeholders: soft shimmering shapes where what's loading will be (app/globals.css .cs-skeleton), rather than
// "Loading…" text. Each group is one status for screen readers ("Loading projects"); the shapes themselves are hidden
// from them. Still for anyone who's asked for reduced motion.

// One shape — its size and roundness from its className / style (a text line by default).
export function Skeleton({ className = "h-3 w-full", style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={`cs-skeleton block ${className}`} style={style} />;
}

// What's loading, for screen readers — around a group of shapes.
export function SkeletonGroup({ label = "Loading", className = "", children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-label={label} className={className}>
      {children}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

// Lines of text, a little uneven (the last shortest), as a paragraph would be.
const LINE_WIDTHS = ["92%", "80%", "86%", "70%", "88%", "64%"];
export function SkeletonLines({ lines = 3, className = "", lineClassName = "h-3" }: { lines?: number; className?: string; lineClassName?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={lineClassName} style={{ width: index === lines - 1 && lines > 1 ? "48%" : LINE_WIDTHS[index % LINE_WIDTHS.length] }} />
      ))}
    </div>
  );
}

// A card, as a board's or list's is: a title, a couple of lines, a row of small pills.
export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-[14px] border border-[var(--glass-border)] bg-[color-mix(in_srgb,var(--panel-bg)_70%,transparent)] p-3 ${className}`}>
      <Skeleton className="h-3.5 w-[62%]" />
      <SkeletonLines lines={2} className="mt-3" lineClassName="h-2.5" />
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-10 rounded-full" />
      </div>
    </div>
  );
}

// Cards, one under another.
export function SkeletonCards({ count = 3, label = "Loading", className = "" }: { count?: number; label?: string; className?: string }) {
  return (
    <SkeletonGroup label={label} className={`space-y-2 ${className}`}>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </SkeletonGroup>
  );
}

// List rows: a round emblem (or not), a name and a line under it, ruled off.
export function SkeletonRows({
  count = 5,
  label = "Loading",
  avatar = true,
  className = "",
}: {
  count?: number;
  label?: string;
  avatar?: boolean;
  className?: string;
}) {
  return (
    <SkeletonGroup label={label} className={className}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-[var(--glass-border)] px-3 py-3 last:border-b-0">
          {avatar ? <Skeleton className="h-8 w-8 shrink-0 rounded-full" /> : null}
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3" style={{ width: `${[58, 44, 66, 50, 38][index % 5]}%` }} />
            <Skeleton className="mt-2 h-2.5" style={{ width: `${[34, 48, 28, 40, 30][index % 5]}%` }} />
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}

// A board: columns, each a heading over a few cards.
export function SkeletonBoard({ columns = 4, label = "Loading", className = "" }: { columns?: number; label?: string; className?: string }) {
  return (
    <SkeletonGroup label={label} className={`flex h-full w-full gap-3 overflow-hidden ${className}`}>
      {Array.from({ length: columns }, (_, column) => (
        <div key={column} className="w-[280px] shrink-0 space-y-2">
          <Skeleton className="h-10 w-full rounded-[14px]" />
          {Array.from({ length: [3, 2, 4, 2, 3][column % 5] }, (_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      ))}
    </SkeletonGroup>
  );
}
