"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, Search, X } from "lucide-react";
import { LengthField } from "@/components/settings-ui";
import { useCompanyFormats } from "@/lib/company-formats";
import { glassShineStyle } from "@/lib/glass-shine";

// The edge tape picker: a search (with the app's clear X), a round + that adds a new tape to the company's library (its
// name or colour, thickness and width), and the tapes — Matching first. The same one wherever an edge tape is picked: an
// edge of a piece on its drawing in the cutlist (opened at the pointer, by a right-click) and a board's Edging in Board
// Settings (opened under the field). Like every dropdown it floats over the page itself (portalled to <body>), so its
// glass looks the same as theirs.

export type EdgeTapeMenuOption = { id: string; label: string };
export type NewEdgeTape = { name: string; thicknessMm: number; widthMm: number };

const SCREEN_EDGE_PX = 8;
const MENU_WIDTH_PX = 230;
// Every dropdown's open panel in the app (the project page's GLASS_DROPDOWN_MENU_STYLE).
const MENU_STYLE: CSSProperties = {
  borderColor: "var(--glass-border)",
  backgroundColor: "var(--glass-modal-bg)",
  backdropFilter: "blur(12px) saturate(220%)",
  WebkitBackdropFilter: "blur(12px) saturate(220%)",
  boxShadow: "inset 0 0 0 999px color-mix(in srgb, var(--panel-bg) 22%, transparent), var(--shadow-glass)",
};
// The search box's look — the staff picker's — for every box in it.
const FIELD_CLASS =
  "h-7 w-full min-w-0 flex-1 rounded-[6px] border px-2 text-[12px] font-medium outline-none max-md:h-10 max-md:rounded-[10px] max-md:text-[15px]";
const FIELD_STYLE: CSSProperties = {
  borderColor: "var(--glass-border)",
  backgroundColor: "color-mix(in srgb, var(--panel-bg) 45%, transparent)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  color: "var(--text-main)",
};
const ROW_CLASS =
  "flex w-full min-w-0 items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] font-medium transition hover:bg-[color-mix(in_srgb,var(--text-main)_7%,transparent)] max-md:gap-3 max-md:rounded-[10px] max-md:px-3 max-md:py-2.5 max-md:text-[15px]";

export function EdgeTapeMenu({
  at,
  label,
  options,
  selectedId,
  onPick,
  onClose,
  onAddTape,
  defaultThicknessMm,
  clearLabel,
  onClear,
  triggerRef,
}: {
  // Where it opens: under the pointer (a right-click), or under the field that opened it (at least as wide as it).
  at: { x: number; y: number } | { rect: DOMRect };
  label: string;
  // The tapes to pick from, in order (Matching first) — each picked by its id.
  options: EdgeTapeMenuOption[];
  // The one picked now (ticked); null for none.
  selectedId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
  // A new tape added with the +: into the company's library — the id to pick it by back (it's then picked).
  onAddTape?: (tape: NewEdgeTape) => string;
  // What a new tape's Thickness starts as (mm) — the library's most used.
  defaultThicknessMm?: string;
  // An action under the tapes (a clashed edge's "No clashing").
  clearLabel?: string;
  onClear?: () => void;
  // The field that opened it — pressing that isn't "somewhere else" (it opens and closes it itself).
  triggerRef?: RefObject<HTMLElement | null>;
}) {
  const [query, setQuery] = useState("");
  // The + pressed: a new tape being filled in, in place of the search and the list.
  const [adding, setAdding] = useState<{ name: string; thicknessMm: string; widthMm: string } | null>(null);
  const addingRef = useRef(adding);
  useEffect(() => {
    addingRef.current = adding;
  }, [adding]);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const { unit } = useCompanyFormats();
  const isAdding = adding !== null;
  const pointAt = "x" in at ? at : null;
  const rectAt = "rect" in at ? at.rect : null;

  // Placed under the pointer (across from it) or the field (from its left) — or above, when only there has room (held
  // by its bottom edge then, so it stays against what opened it as a search shortens it), kept on the screen.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    if (rectAt) el.style.width = `${Math.round(Math.max(MENU_WIDTH_PX, rectAt.width))}px`;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const anchorTop = rectAt ? rectAt.top - 4 : (pointAt?.y ?? 0) - 10;
    const anchorBottom = rectAt ? rectAt.bottom + 4 : (pointAt?.y ?? 0) + 10;
    const wantLeft = rectAt ? rectAt.left : (pointAt?.x ?? 0) - w / 2;
    el.style.left = `${Math.round(Math.min(window.innerWidth - w - SCREEN_EDGE_PX, Math.max(SCREEN_EDGE_PX, wantLeft)))}px`;
    if (anchorBottom + h > window.innerHeight - SCREEN_EDGE_PX && anchorTop - h >= SCREEN_EDGE_PX) {
      el.style.top = "auto";
      el.style.bottom = `${Math.round(window.innerHeight - anchorTop)}px`;
    } else {
      el.style.bottom = "auto";
      el.style.top = `${Math.round(Math.min(anchorBottom, Math.max(SCREEN_EDGE_PX, window.innerHeight - SCREEN_EDGE_PX - h)))}px`;
    }
    el.style.visibility = "visible";
    // (Its search, or a new tape's name, ready to type in — only once it's shown: a hidden box can't take the focus.)
    (isAdding ? nameRef.current : searchRef.current)?.focus({ preventScroll: true });
    // (Placed once as it opens, and again as the + switches it — not as it's typed in.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdding]);

  // A press anywhere else closes it; Escape goes back from a new tape, or closes it.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef?.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (addingRef.current) setAdding(null);
      else onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose, triggerRef]);

  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((option) => option.label.toLowerCase().includes(q)) : options;
  const submitAdding = () => {
    if (!adding || !onAddTape) return;
    const name = adding.name.trim();
    if (!name) {
      nameRef.current?.focus();
      return;
    }
    const id = onAddTape({ name, thicknessMm: Number(adding.thicknessMm) || 0, widthMm: Number(adding.widthMm) || 0 });
    setAdding(null);
    if (id) onPick(id);
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      data-edge-tape-menu="true"
      className="fixed left-0 top-0 flex max-h-[300px] w-[230px] flex-col overflow-hidden rounded-[8px] border max-md:max-h-[420px] max-md:w-[280px] max-md:rounded-[14px]"
      style={{ visibility: "hidden", zIndex: 2147483647, ...MENU_STYLE }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex shrink-0 items-center gap-1 border-b p-1" style={{ borderColor: "var(--glass-border)" }}>
        {adding ? (
          <input
            ref={nameRef}
            value={adding.name}
            onChange={(event) => setAdding((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitAdding();
              }
            }}
            placeholder="Name or colour"
            aria-label="New edge tape's name or colour"
            className={FIELD_CLASS}
            style={FIELD_STYLE}
          />
        ) : (
          <div className="relative min-w-0 flex-1">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 max-md:left-3" style={{ color: "var(--text-muted)" }} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // (Enter: the first one it finds.)
                if (event.key === "Enter" && shown[0]) {
                  event.preventDefault();
                  onPick(shown[0].id);
                }
              }}
              placeholder="Search colours..."
              aria-label="Search edge tapes"
              className={`${FIELD_CLASS} pl-6 max-md:pl-8`}
              style={FIELD_STYLE}
            />
          </div>
        )}
        {onAddTape ? (
          // (The cutlist Entry rows' round + — as tall as the search, so a circle. Pressed again: back.)
          <button
            type="button"
            onClick={() => {
              if (adding) {
                setAdding(null);
                return;
              }
              setAdding({ name: query.trim(), thicknessMm: defaultThicknessMm || "", widthMm: "" });
            }}
            className="glass-shine inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-semibold text-white hover:brightness-95 max-md:h-10 max-md:w-10"
            style={glassShineStyle(adding ? "var(--danger)" : "#16A34A")}
            title={adding ? "Back to the list" : "Add an edge tape"}
            aria-label={adding ? "Back to the list" : "Add an edge tape"}
          >
            {adding ? <X size={14} strokeWidth={2.8} /> : <Plus size={16} strokeWidth={2.8} />}
          </button>
        ) : null}
      </div>
      {adding ? (
        <div className="space-y-2 p-2">
          <div className="flex items-center gap-1.5">
            <LengthField
              valueMm={adding.thicknessMm}
              onChangeMm={(mm) => setAdding((prev) => (prev ? { ...prev, thicknessMm: mm } : prev))}
              unit={unit}
              placeholder="Thickness"
              width={96}
              wrapperClassName="flex-1"
              className={FIELD_CLASS}
              style={FIELD_STYLE}
            />
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>×</span>
            <LengthField
              valueMm={adding.widthMm}
              onChangeMm={(mm) => setAdding((prev) => (prev ? { ...prev, widthMm: mm } : prev))}
              unit={unit}
              placeholder="Width"
              width={96}
              wrapperClassName="flex-1"
              className={FIELD_CLASS}
              style={FIELD_STYLE}
            />
          </div>
          <button
            type="button"
            onClick={submitAdding}
            disabled={!adding.name.trim()}
            className="glass-shine flex h-8 w-full items-center justify-center gap-1.5 rounded-full border text-[12px] font-medium text-white transition hover:brightness-105 disabled:opacity-55 max-md:h-11 max-md:text-[15px]"
            style={glassShineStyle("#16A34A")}
          >
            <Plus size={14} strokeWidth={2.6} />
            Add edge tape
          </button>
        </div>
      ) : (
        <div className="glass-scroll min-h-0 flex-1 overflow-auto p-1">
          {shown.length ? (
            shown.map((option) => {
              const on = selectedId !== null && selectedId === option.id;
              return (
                <button
                  key={option.id || "matching"}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  onClick={() => onPick(option.id)}
                  className={ROW_CLASS}
                  style={{ color: "var(--text-main)", ...(on ? { backgroundColor: "color-mix(in srgb, var(--brand) 10%, transparent)" } : null) }}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {on ? <Check size={14} className="ml-auto shrink-0" style={{ color: "var(--brand)" }} /> : null}
                </button>
              );
            })
          ) : (
            <div className="px-2 py-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
              No edge tape found.
            </div>
          )}
        </div>
      )}
      {clearLabel && onClear && !adding ? (
        <div className="shrink-0 border-t p-1" style={{ borderColor: "var(--glass-border)" }}>
          <button
            type="button"
            role="menuitem"
            onClick={onClear}
            className={`${ROW_CLASS} hover:!bg-[var(--danger-soft)]`}
            style={{ color: "var(--danger-strong)" }}
          >
            {clearLabel}
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
