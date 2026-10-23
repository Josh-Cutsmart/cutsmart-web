import type { ReactNode } from "react";
import { glassShineStyle } from "@/lib/glass-shine";

// A status pill in one of its status's sub-statuses (the Dashboard's, a project page's): its status, and the sub-status
// in a smaller pill of its own colour sitting inside it at its right end — the status's colour wrapping round it. The
// pill itself (the button, in its status's glass) takes SPLIT_STATUS_PILL_CLASS in place of its own padding. Each part
// is its own press target: the status (the statuses menu), the sub-status (data-status-sub-half — straight at the
// status's sub-statuses).

// The status pill's padding: the band of its colour round the sub-status's pill. Its parts stretch to its height.
export const SPLIT_STATUS_PILL_CLASS = "items-stretch p-[3px]";

export function SplitStatusPillContent({
  status,
  subStatus,
  subStatusColor,
  subStatusTextColor,
  statusWidthPx,
  padY = "",
  lock,
  statusTitle,
  subStatusTitle,
}: {
  status: string;
  subStatus: string;
  subStatusColor: string;
  subStatusTextColor: string;
  // The status part's width — to line it up down a list (none: as wide as its name).
  statusWidthPx?: number;
  // Each part's height, for a pill without a set one (the band round the sub-status's pill already counted).
  padY?: string;
  // Before the status (a bonus period's lock).
  lock?: ReactNode;
  statusTitle?: string;
  subStatusTitle?: string;
}) {
  return (
    <>
      <span
        className={`flex min-w-0 shrink-0 items-center justify-center pl-2.5 pr-2 transition hover:brightness-110 ${padY}`}
        style={statusWidthPx ? { width: statusWidthPx } : undefined}
        title={statusTitle}
      >
        {lock}
        <span className="truncate">{status}</span>
      </span>
      <span
        data-status-sub-half="true"
        title={subStatusTitle}
        className={`glass-shine flex min-w-0 items-center justify-center rounded-full px-2.5 text-[0.9em] transition hover:brightness-110 ${padY}`}
        style={glassShineStyle(subStatusColor, {
          color: subStatusTextColor,
          // Sitting on the status's colour: a little shadow under it.
          boxShadow: "0 1px 3px rgba(15, 23, 42, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.5)",
        })}
      >
        <span className="truncate">{subStatus}</span>
      </span>
    </>
  );
}
