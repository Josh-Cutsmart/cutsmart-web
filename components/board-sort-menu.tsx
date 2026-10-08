"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowUpDown, Check } from "lucide-react";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";
import { BOARD_SORT_LABELS, BOARD_SORT_MODES, type BoardSortMode } from "@/lib/board-drop-order";

// The Kanban boards' (Leads, Dashboard) sort menus: a sort button on each column (the sort choices,
// for that column) and a Sort button in the toolbar (the same choices, for the whole
// board — overriding every column while it's set). Both are each user's own setting.

const MENU_WIDTH = 190;
const MENU_STYLE: CSSProperties = {
  borderColor: "var(--glass-border)",
  backgroundColor: "var(--glass-modal-bg)",
  backdropFilter: "blur(16px) saturate(200%)",
  WebkitBackdropFilter: "blur(16px) saturate(200%)",
};
const MENU_CLASS = "fixed z-[2147483647] overflow-hidden rounded-[10px] border shadow-[0_12px_30px_rgba(15,23,42,0.14)]";

type MenuPos = { left: number; top: number };

function menuPosUnder(el: HTMLElement, alignRight = false): MenuPos {
  const rect = el.getBoundingClientRect();
  const left = alignRight ? rect.right - MENU_WIDTH : rect.left;
  return { left: Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8)), top: rect.bottom + 6 };
}

// Closes on a press anywhere outside the button and its menus — and that press only closes them (see
// lib/swallow-dismiss-click.ts) — or on Escape / resize.
function useCloseOnOutsidePress(open: boolean, insideRefs: Array<React.RefObject<HTMLElement | null>>, close: () => void) {
  const closeRef = useRef(close);
  const insideRefsRef = useRef(insideRefs);
  useEffect(() => {
    closeRef.current = close;
    insideRefsRef.current = insideRefs;
  });
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (insideRefsRef.current.some((ref) => ref.current?.contains(target))) return;
      closeRef.current();
      swallowNextClick();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    const onResize = () => closeRef.current();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);
}

function SortOptionRows({
  options,
  value,
  labelFor,
  onPick,
}: {
  options: readonly BoardSortMode[];
  value: BoardSortMode;
  labelFor: (mode: BoardSortMode) => string;
  onPick: (mode: BoardSortMode) => void;
}) {
  return (
    <>
      {options.map((mode, index) => {
        const isActive = mode === value;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onPick(mode)}
            className={`flex h-9 w-full items-center justify-between gap-2 px-3 text-left text-[12px] font-semibold transition-colors hover:bg-[var(--panel-muted)] ${index > 0 ? "border-t" : ""}`}
            style={{ borderColor: "var(--glass-border)", color: isActive ? "var(--brand-strong)" : "var(--text-main)" }}
          >
            <span className="truncate">{labelFor(mode)}</span>
            {isActive ? <Check size={14} className="shrink-0" /> : null}
          </button>
        );
      })}
    </>
  );
}

// The sort button left of a column's title: Custom order / Oldest – Newest / Newest – Oldest / A – Z /
// Z – A, for this column. `overriddenBy` is the board-wide sort when one is set (the column's own
// choice is kept, and applies again once the board sort is back to "Per column").
export function BoardColumnSortMenu({
  columnName,
  value,
  onChange,
  overriddenBy,
  buttonClassName,
  buttonStyle,
}: {
  columnName: string;
  value: BoardSortMode;
  onChange: (mode: BoardSortMode) => void;
  overriddenBy?: BoardSortMode;
  buttonClassName?: string;
  buttonStyle?: CSSProperties;
}) {
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useCloseOnOutsidePress(Boolean(menuPos), [buttonRef, menuRef], () => setMenuPos(null));
  const isSorted = value !== "custom";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (menuPos) setMenuPos(null);
          else setMenuPos(menuPosUnder(e.currentTarget));
        }}
        className={buttonClassName ?? "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition hover:brightness-95"}
        style={buttonStyle}
        title={isSorted ? `${columnName}: ${BOARD_SORT_LABELS[value]}` : `Sort ${columnName}`}
        aria-label={`Sort ${columnName}`}
      >
        <ArrowUpDown size={14} />
      </button>
      {menuPos && typeof document !== "undefined"
        ? createPortal(
            <div ref={menuRef} className={MENU_CLASS} style={{ ...MENU_STYLE, left: menuPos.left, top: menuPos.top, width: MENU_WIDTH }}>
              {overriddenBy && overriddenBy !== "custom" ? (
                <p className="border-b px-3 py-2 text-[11px] leading-snug" style={{ borderColor: "var(--glass-border)", color: "var(--text-muted)" }}>
                  The whole board is sorted {BOARD_SORT_LABELS[overriddenBy]} — this column&apos;s choice applies once that&apos;s back to Per column.
                </p>
              ) : null}
              <SortOptionRows
                options={BOARD_SORT_MODES}
                value={value}
                labelFor={(mode) => BOARD_SORT_LABELS[mode]}
                onPick={(mode) => {
                  onChange(mode);
                  setMenuPos(null);
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// The toolbar's Sort button: the same choices for the whole board — "Per column" hands it back to
// each column's own setting.
export function BoardSortButton({
  value,
  onChange,
  className,
  labelClassName,
  style,
}: {
  value: BoardSortMode;
  onChange: (mode: BoardSortMode) => void;
  className?: string;
  // On the button's text ("Sort", or the sort in use) — e.g. hiding it on a phone for an icon-only button.
  labelClassName?: string;
  style?: CSSProperties;
}) {
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useCloseOnOutsidePress(Boolean(menuPos), [buttonRef, menuRef], () => setMenuPos(null));
  const isSorted = value !== "custom";
  const labelFor = (mode: BoardSortMode) => (mode === "custom" ? "Per column" : BOARD_SORT_LABELS[mode]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          // Measured here, during the click — e.currentTarget is gone by the time a state updater runs.
          if (menuPos) setMenuPos(null);
          else setMenuPos(menuPosUnder(e.currentTarget));
        }}
        className={className ?? "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-bold transition hover:brightness-95"}
        style={
          isSorted
            ? { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)", color: "#fff", ...style }
            : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)", ...style }
        }
        title="Sort the whole board"
        aria-label="Sort the whole board"
      >
        <ArrowUpDown size={14} />
        <span className={labelClassName}>{isSorted ? BOARD_SORT_LABELS[value] : "Sort"}</span>
      </button>
      {menuPos && typeof document !== "undefined"
        ? createPortal(
            <div ref={menuRef} className={MENU_CLASS} style={{ ...MENU_STYLE, left: menuPos.left, top: menuPos.top, width: MENU_WIDTH }}>
              <SortOptionRows
                options={BOARD_SORT_MODES}
                value={value}
                labelFor={labelFor}
                onPick={(mode) => {
                  onChange(mode);
                  setMenuPos(null);
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
