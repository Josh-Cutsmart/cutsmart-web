"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GLASS_MENU_ROW_CLASS, GlassMenuOption } from "@/components/glass-dropdown";

// A status menu's rows, inside a glass menu (a list row's status pill — the Dashboard's): each status, the current one in
// the brand blue. A status with sub-statuses shows a › and slides the menu over to them — a small back arrow and the
// status's name at the top — to pick one there; the others are picked straight away. It can open already at a
// status's sub-statuses (startAtSubStatus — the pill's sub-status half pressed).

export type StatusMenuStatus = { name: string; color: string; subStages?: Array<{ name: string; color: string }> };

const same = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
const SLIDE = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";

export function StatusMenuPanels({
  statuses,
  currentStatus,
  currentSubStage,
  disabled,
  startAtSubStatus,
  onSelect,
}: {
  statuses: StatusMenuStatus[];
  currentStatus: string;
  currentSubStage: string;
  disabled?: boolean;
  // Open at this status's sub-statuses (back arrow to the rest).
  startAtSubStatus?: string;
  // A status (one without sub-statuses), or a status and one of its sub-statuses.
  onSelect: (status: string, subStage?: string) => void;
}) {
  // Which panel's showing, and the status whose sub-statuses the second panel holds (kept as it slides back).
  const [showingSub, setShowingSub] = useState(Boolean(startAtSubStatus));
  const [subStatusName, setSubStatusName] = useState(startAtSubStatus ?? "");
  const subStatus = statuses.find((status) => same(status.name, subStatusName) && (status.subStages?.length ?? 0) > 0) ?? null;
  const onSub = showingSub && Boolean(subStatus);
  const rowClass = `${GLASS_MENU_ROW_CLASS} h-8 max-md:h-11`;

  return (
    // The panel showing sets the height; the other sits beside it, out of sight, as they slide.
    <div className="relative overflow-hidden">
      <div
        aria-hidden={onSub}
        className={onSub ? "pointer-events-none absolute inset-x-0 top-0" : "relative"}
        style={{ transform: onSub ? "translateX(-100%)" : "translateX(0)", transition: SLIDE }}
      >
        {statuses.map((status) => {
          const selected = same(status.name, currentStatus);
          if (!status.subStages?.length) {
            return (
              <GlassMenuOption
                key={status.name}
                label={status.name}
                color={status.color}
                selected={selected}
                disabled={disabled}
                onSelect={() => onSelect(status.name)}
              />
            );
          }
          return (
            <button
              key={status.name}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={disabled}
              onClick={() => {
                setSubStatusName(status.name);
                setShowingSub(true);
              }}
              className={`${rowClass} disabled:cursor-wait disabled:opacity-60`}
              style={{ backgroundImage: selected ? "var(--brand-gradient)" : "none", color: selected ? "#FFFFFF" : "var(--text-main)" }}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: status.color, boxShadow: selected ? "0 0 0 1.5px rgba(255,255,255,0.85)" : undefined }}
              />
              <span className="min-w-0 flex-1 truncate">{status.name}</span>
              <ChevronRight size={14} className="shrink-0 opacity-70" />
            </button>
          );
        })}
      </div>
      <div
        aria-hidden={!onSub}
        className={onSub ? "relative" : "pointer-events-none absolute inset-x-0 top-0"}
        style={{ transform: onSub ? "translateX(0)" : "translateX(100%)", transition: SLIDE }}
      >
        {subStatus ? (
          <>
            <button
              type="button"
              onClick={() => setShowingSub(false)}
              className={rowClass}
              style={{ color: "var(--text-main)" }}
              aria-label="Back to the statuses"
              title="Back"
            >
              <ChevronLeft size={15} className="shrink-0" style={{ color: "var(--text-muted)" }} />
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: subStatus.color }} />
              <span className="min-w-0 flex-1 truncate font-semibold">{subStatus.name}</span>
            </button>
            <div className="mx-2 my-1 h-px" style={{ backgroundColor: "var(--glass-border)" }} />
            {(subStatus.subStages ?? []).map((stage) => (
              <GlassMenuOption
                key={stage.name}
                label={stage.name}
                color={stage.color}
                selected={same(subStatus.name, currentStatus) && same(stage.name, currentSubStage)}
                disabled={disabled}
                onSelect={() => onSelect(subStatus.name, stage.name)}
              />
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}

// How many rows its taller panel has — for working out whether the menu fits below its pill.
export function statusMenuRowCount(statuses: StatusMenuStatus[]): number {
  return Math.max(statuses.length, ...statuses.map((status) => (status.subStages?.length ? status.subStages.length + 1 : 0)));
}
