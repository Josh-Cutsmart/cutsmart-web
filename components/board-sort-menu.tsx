"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowUpDown, Check, Users } from "lucide-react";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";
import { BOARD_SORT_LABELS, BOARD_SORT_MODES, UNASSIGNED_USER_FILTER_ID, type BoardSortMode } from "@/lib/board-drop-order";

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
// (Squeezing out of its button as it opens — .glass-menu-squeeze, app/globals.css.)
const MENU_CLASS =
  "glass-menu-squeeze fixed z-[2147483647] overflow-hidden rounded-[10px] border shadow-[0_12px_30px_rgba(15,23,42,0.14)] max-md:rounded-[14px]";

// (originX: where across it its button is — what it squeezes out of.)
type MenuPos = { left: number; top: number; originX: number };

// Under its button: on a computer, from its left edge (a column's, from its right); on mobile, centred on it. Kept on
// screen either way.
function menuPosUnder(el: HTMLElement, alignRight = false): MenuPos {
  const rect = el.getBoundingClientRect();
  const centred = window.matchMedia("(max-width: 1023px)").matches;
  const left = centred ? rect.left + rect.width / 2 - MENU_WIDTH / 2 : alignRight ? rect.right - MENU_WIDTH : rect.left;
  const clamped = Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8));
  return { left: clamped, top: rect.bottom + 6, originX: Math.min(MENU_WIDTH, Math.max(0, rect.left + rect.width / 2 - clamped)) };
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
            className={`flex h-9 w-full items-center justify-between gap-2 px-3 text-left text-[12px] font-semibold transition-colors hover:bg-[color-mix(in_srgb,var(--text-main)_7%,transparent)] max-md:h-11 max-md:px-4 max-md:text-[15px] ${index > 0 ? "border-t" : ""}`}
            style={{ borderColor: "var(--glass-border)", color: isActive ? "var(--brand-strong)" : "var(--text-main)" }}
          >
            <span className="truncate">{labelFor(mode)}</span>
            {isActive ? <Check size={14} className="shrink-0 max-md:h-[17px] max-md:w-[17px]" /> : null}
          </button>
        );
      })}
    </>
  );
}

// One person in the Users filter (or Everyone / Unassigned): their initial in their colour, a tick when they're showing.
// Several can be ticked at once, so picking one leaves the menu open.
function UserFilterRow({ label, color, checked, onPick }: { label: string; color?: string; checked: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      role="menuitemcheckbox"
      aria-checked={checked}
      className="flex h-9 w-full items-center gap-2 border-t px-3 text-left text-[12px] font-medium transition-colors hover:bg-[color-mix(in_srgb,var(--text-main)_7%,transparent)] max-md:h-11 max-md:px-4 max-md:text-[15px]"
      style={{ borderColor: "var(--glass-border)", color: checked ? "var(--brand-strong)" : "var(--text-main)" }}
    >
      {color ? (
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white max-md:h-6 max-md:w-6 max-md:text-[11px]"
          style={{ backgroundColor: color }}
        >
          {label.trim().charAt(0).toUpperCase() || "?"}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked ? <Check size={14} className="shrink-0 max-md:h-[17px] max-md:w-[17px]" /> : null}
    </button>
  );
}

// A person the board's cards can be assigned to, for the Users filter.
export type BoardFilterUser = { id: string; name: string; color?: string };

// The sort button at the right of a column's header: Custom order / Oldest – Newest / Newest – Oldest /
// A – Z / Z – A, for this column. `overriddenBy` is the board-wide sort when one is set (the column's own
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
          else setMenuPos(menuPosUnder(e.currentTarget, true));
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
            <div ref={menuRef} className={MENU_CLASS} style={{ ...MENU_STYLE, transformOrigin: `${Math.round(menuPos.originX)}px 0%`, left: menuPos.left, top: menuPos.top, width: MENU_WIDTH }}>
              {/* The toolbar's Sort set for the whole board: said so, with what it's set to. (A choice below is kept for this
                  column, for once the board's back to Per column.) */}
              {overriddenBy && overriddenBy !== "custom" ? (
                <p
                  className="border-b px-3 py-2 text-[12px] font-medium leading-snug max-md:px-4 max-md:py-2.5 max-md:text-[14px]"
                  style={{ borderColor: "var(--glass-border)", color: "var(--text-main)" }}
                >
                  Column sorted by board setting:{" "}
                  <span className="font-semibold" style={{ color: "var(--brand-strong)" }}>
                    {BOARD_SORT_LABELS[overriddenBy]}
                  </span>
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
        className={className ?? "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-semibold transition hover:brightness-95"}
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
            <div ref={menuRef} className={MENU_CLASS} style={{ ...MENU_STYLE, transformOrigin: `${Math.round(menuPos.originX)}px 0%`, left: menuPos.left, top: menuPos.top, width: MENU_WIDTH }}>
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

// The Dashboard's and Leads' Users filter, its own button in their toolbars (beside Sort): only the projects or leads
// assigned to the people ticked, and/or nobody's (Unassigned) — Everyone (none ticked) shows them all. Several at once,
// so picking one leaves the menu open. Lit up (the blue fill) while it's filtering.
export function BoardUserFilterButton({
  users,
  value,
  onChange,
  className,
  labelClassName,
  style,
}: {
  users: BoardFilterUser[];
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
  // On the button's text — e.g. hiding it on a phone for an icon-only button.
  labelClassName?: string;
  style?: CSSProperties;
}) {
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useCloseOnOutsidePress(Boolean(menuPos), [buttonRef, menuRef], () => setMenuPos(null));
  const isFiltering = value.length > 0;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((other) => other !== id) : [...value, id]);
  // "All users"; the one person (or Unassigned) when it's just them; else how many.
  const onlyOne = value.length === 1 ? value[0] : "";
  const label = !isFiltering
    ? "All users"
    : onlyOne
      ? onlyOne === UNASSIGNED_USER_FILTER_ID
        ? "Unassigned"
        : users.find((user) => user.id === onlyOne)?.name || "1 user"
      : `${value.length} users`;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          if (menuPos) setMenuPos(null);
          else setMenuPos(menuPosUnder(e.currentTarget));
        }}
        className={className ?? "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition hover:brightness-95"}
        style={
          isFiltering
            ? { ...style, backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)", color: "#fff" }
            : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)", ...style }
        }
        title="Show only some people's"
        aria-label={`Filter by user: ${label}`}
      >
        <Users size={14} className="shrink-0" />
        <span className={`max-w-[140px] truncate ${labelClassName ?? ""}`}>{label}</span>
      </button>
      {menuPos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className={MENU_CLASS}
              style={{
                ...MENU_STYLE,
                transformOrigin: `${Math.round(menuPos.originX)}px 0%`,
                left: menuPos.left,
                top: menuPos.top,
                width: MENU_WIDTH,
                // (With a long list of people: scrolls, rather than running off the screen.)
                maxHeight: `calc(100dvh - ${Math.round(menuPos.top) + 12}px)`,
                overflowY: "auto",
              }}
            >
              <div className="[&>button:first-child]:border-t-0">
                <UserFilterRow label="Everyone" checked={!isFiltering} onPick={() => onChange([])} />
                {users.map((user) => (
                  <UserFilterRow key={user.id} label={user.name} color={user.color || "#64748B"} checked={value.includes(user.id)} onPick={() => toggle(user.id)} />
                ))}
                <UserFilterRow label="Unassigned" checked={value.includes(UNASSIGNED_USER_FILTER_ID)} onPick={() => toggle(UNASSIGNED_USER_FILTER_ID)} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
