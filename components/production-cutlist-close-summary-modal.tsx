"use client";

import { useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { findMissingProductionRows, summarizeCutlistRowsByPartType, type CutlistRow } from "@/lib/cutlist-types";
import { contrastTextForFill } from "@/lib/user-profile-format";
import { useGlassModalShrinkOnClose, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";

type SheetCountEntry = { productName: string; sheetSize: string; sheetCount: number };

const UNASSIGNED_ROOM_LABEL = "Project Cutlist";

function roomLabel(row: CutlistRow): string {
  return String(row.room || "").trim() || UNASSIGNED_ROOM_LABEL;
}

export function ProductionCutlistCloseSummaryModal({
  isOpen,
  origin,
  productionRows,
  initialRows,
  partTypeColors,
  sheetCounts,
  sessionBaseline,
  onClose,
  originElRef,
}: {
  // No grow-in animation — same reasoning as InitialMeasureCloseSummaryModal's own comment: this
  // opens as a side effect of Save & Back, not a button press, so it should just already be open.
  // It still shrinks INTO the Production sidebar's "Cutlist" tab button on close, via
  // useGlassModalShrinkOnClose — `origin` must be a fresh measurement taken at the exact moment of
  // close (see that hook's own comment), not one captured back when this opened.
  isOpen: boolean;
  origin: GlassModalOrigin;
  productionRows: CutlistRow[];
  initialRows: CutlistRow[];
  partTypeColors: Record<string, string>;
  sheetCounts: SheetCountEntry[];
  sessionBaseline: Record<string, number> | null;
  onClose: () => void;
  // Push-nudge + duck-behind-the-tab close treatment — the SAME ref the caller re-measures
  // `origin` from in its own onClose handler, not a value captured once.
  originElRef?: RefObject<HTMLElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shouldRender = useGlassModalShrinkOnClose(isOpen, origin, panelRef, undefined, originElRef);
  if (typeof document === "undefined" || !shouldRender) return null;
  const summary = summarizeCutlistRowsByPartType(productionRows);
  const totalParts = summary.reduce((sum, s) => sum + s.count, 0);
  // Part types to show in the table: every type with a part right now, PLUS any type that had
  // parts at the session baseline but has since been completely removed (count now 0) — so a
  // part type wiped out mid-session still shows up, at 0, with a negative "this session" delta,
  // instead of silently vanishing from the table.
  const currentCountByType = new Map(summary.map((s) => [s.partType, s.count]));
  const displayPartTypes = Array.from(
    new Set([...currentCountByType.keys(), ...(sessionBaseline ? Object.keys(sessionBaseline) : [])]),
  ).sort((a, b) => a.localeCompare(b));
  const missing = findMissingProductionRows(initialRows, productionRows);
  const rooms = Array.from(new Set(productionRows.map(roomLabel)));
  const showRoomGroups = rooms.length > 1;
  // Per-room part-type counts for the Parts Added table, only actually needed (and only
  // computed) once there's more than one room to break down — a room-by-room row per type,
  // plus a bolded Total row underneath (which is what the session-delta comparison is against,
  // same as the single-room case).
  const roomPartTypeCounts = showRoomGroups
    ? new Map(rooms.map((room) => [room, new Map(summarizeCutlistRowsByPartType(productionRows.filter((row) => roomLabel(row) === room)).map((s) => [s.partType, s.count]))]))
    : null;

  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close summary backdrop"
        onClick={onClose}
        className="glass-modal-backdrop absolute inset-0"
        // .glass-modal-backdrop has its own built-in fade-in animation (globals.css), which fires
        // on every mount regardless of what useGlassModalShrinkOnClose does — that hook only ever
        // touches this backdrop's opacity/transition while CLOSING. Since this popup should already
        // be fully blurred in, not fade in, that animation needs suppressing specifically on open.
        style={{ animation: "none" }}
      />
      <div ref={panelRef} className="glass-modal-panel relative flex max-h-[85vh] w-full max-w-[480px] flex-col overflow-hidden">
        <div className="glass-modal-header flex h-[50px] shrink-0 items-center justify-between px-4">
          <p className="text-[15px] font-bold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
            Production Cutlist Summary
          </p>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border hover:brightness-95"
            style={{
              borderColor: "var(--danger-glass-border)",
              backgroundColor: "var(--danger-glass-bg)",
              backdropFilter: "blur(10px) saturate(180%)",
              WebkitBackdropFilter: "blur(10px) saturate(180%)",
              color: "#FFFFFF",
            }}
            aria-label="Close"
          >
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>
        <div className="glass-scroll min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {displayPartTypes.length === 0 ? (
            <p className="text-[13px]" style={{ color: "var(--text-main)" }}>
              No parts were entered into this cutlist.
            </p>
          ) : (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: "var(--text-main)" }}>
                Parts Added {totalParts ? `(${totalParts} total)` : ""}
              </p>
              <div className="overflow-hidden rounded-[10px] border" style={{ borderColor: "var(--glass-border)" }}>
                <table className="w-full table-fixed text-center text-[12px]">
                  <thead>
                    <tr>
                      {showRoomGroups && <th className="px-2 py-1.5" />}
                      {displayPartTypes.map((partType) => {
                        const bg = partTypeColors[partType] ?? "#CBD5E1";
                        return (
                          <th key={partType} className="px-2 py-1.5 font-bold" style={{ backgroundColor: bg, color: contrastTextForFill(bg) }}>
                            {partType}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {showRoomGroups &&
                      roomPartTypeCounts &&
                      rooms.map((room) => (
                        <tr key={room} className="border-b" style={{ borderColor: "var(--glass-border)" }}>
                          <td className="px-2 py-1.5 text-left text-[11px] font-bold" style={{ color: "var(--text-main)" }}>{room}</td>
                          {displayPartTypes.map((partType) => (
                            <td key={partType} className="px-2 py-1.5" style={{ color: "var(--text-main)" }}>
                              {roomPartTypeCounts.get(room)?.get(partType) ?? 0}
                            </td>
                          ))}
                        </tr>
                      ))}
                    <tr>
                      {showRoomGroups && (
                        <td className="px-2 py-2 text-left text-[11px] font-bold" style={{ color: "var(--text-main)" }}>Total</td>
                      )}
                      {displayPartTypes.map((partType) => (
                        <td key={partType} className="px-2 py-2 text-[14px] font-extrabold" style={{ color: "var(--text-main)" }}>
                          {currentCountByType.get(partType) ?? 0}
                        </td>
                      ))}
                    </tr>
                    {sessionBaseline && displayPartTypes.some((partType) => (currentCountByType.get(partType) ?? 0) - (sessionBaseline[partType] ?? 0) !== 0) && (
                      <tr>
                        {showRoomGroups && <td className="px-2 pb-2" />}
                        {displayPartTypes.map((partType) => {
                          const delta = (currentCountByType.get(partType) ?? 0) - (sessionBaseline[partType] ?? 0);
                          return (
                            <td
                              key={partType}
                              className="px-2 pb-2 text-[10px] font-normal"
                              style={{ color: delta < 0 ? "var(--danger-strong)" : "var(--success-strong)" }}
                            >
                              {delta !== 0 ? `${delta > 0 ? "+" : "-"}${Math.abs(delta)} this session` : ""}
                            </td>
                          );
                        })}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {sheetCounts.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: "var(--text-main)" }}>
                Sheet Counts
              </p>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--glass-border)" }}>
                    <th className="px-2 py-1.5 text-left" style={{ color: "var(--text-main)" }}>Product</th>
                    <th className="px-2 py-1.5 text-left" style={{ color: "var(--text-main)" }}>Sheet Size</th>
                    <th className="px-2 py-1.5 text-center" style={{ color: "var(--text-main)" }}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {sheetCounts.map((entry) => (
                    <tr key={`${entry.productName}__${entry.sheetSize}`} className="border-b last:border-none" style={{ borderColor: "var(--glass-border)" }}>
                      <td className="px-2 py-1.5" style={{ color: "var(--text-main)" }}>{entry.productName}</td>
                      <td className="px-2 py-1.5" style={{ color: "var(--text-main)" }}>{entry.sheetSize}</td>
                      <td className="px-2 py-1.5 text-center font-semibold" style={{ color: "var(--text-main)" }}>{entry.sheetCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: "var(--text-main)" }}>
              Missing From Production
            </p>
            {missing.length === 0 ? (
              <div
                className="rounded-[10px] border px-3 py-2.5 text-[13px] font-semibold"
                style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--success-strong)" }}
              >
                Every part from Initial Measure is included.
              </div>
            ) : (
              <div className="space-y-1.5">
                {missing.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-[10px] border px-3 py-2"
                    style={{ borderColor: "var(--danger-soft)", backgroundColor: "var(--danger-soft)" }}
                  >
                    <p className="text-[13px] font-semibold" style={{ color: "var(--danger-strong)" }}>{row.name}</p>
                    <p className="text-[11px]" style={{ color: "var(--danger-strong)" }}>
                      {row.room ? `${row.room} · ` : ""}
                      {row.partType || "Unassigned"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
