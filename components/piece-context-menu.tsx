"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";

// A piece's (or cutlist row's) right-click menu: the CNC Cutlist's, Nesting's, the Cutlist List's and the Cutlist Entry's.
// Its name and size at the top, then its items — an item can open a list of its own beside it (Move › its rooms), on
// pointing at it or clicking it, the one it's set to ticked. Portalled to the body in every dropdown's glass, kept on
// screen; closed by clicking off it, Escape, a scroll or a resize. (role="menu": the row right-clicked lifts while it's
// open — components/context-lift.tsx.)

export type PieceMenuChoice = { key: string; label: string; checked?: boolean; disabled?: boolean; run: () => void };
export type PieceMenuItem =
  | "divider"
  | {
      key: string;
      icon: ReactNode;
      label: string;
      danger?: boolean;
      disabled?: boolean;
      run?: () => void;
      // Its own list, beside it: a heading over it, its choices, and what to say when there are none.
      submenu?: { title?: string; choices: PieceMenuChoice[]; empty?: string };
    };

const EDGE_PX = 8;
const SUBMENU_WIDTH_PX = 220;
// Every dropdown's open panel in the app (the project page's GLASS_DROPDOWN_MENU_STYLE).
const MENU_STYLE: CSSProperties = {
  borderColor: "var(--glass-border)",
  backgroundColor: "var(--glass-modal-bg)",
  backdropFilter: "blur(12px) saturate(220%)",
  WebkitBackdropFilter: "blur(12px) saturate(220%)",
  boxShadow: "inset 0 0 0 999px color-mix(in srgb, var(--panel-bg) 22%, transparent), var(--shadow-glass)",
};
const ITEM_CLASS =
  "flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] font-medium transition hover:bg-[color-mix(in_srgb,var(--brand)_12%,transparent)] disabled:pointer-events-none disabled:opacity-45";

export function PieceContextMenu({
  x,
  y,
  title,
  subtitle,
  items,
  width = 260,
  onClose,
}: {
  x: number;
  y: number;
  title: string;
  subtitle?: string;
  items: PieceMenuItem[];
  width?: number;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const subRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // The item whose list is open beside it (its key), and where that list sits.
  const [openKey, setOpenKey] = useState("");
  const [subPos, setSubPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Where it opens: at the pointer, moved in to stay on screen (its own height measured first).
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    setPos({
      left: Math.max(EDGE_PX, Math.min(x, window.innerWidth - width - EDGE_PX)),
      top: Math.max(EDGE_PX, Math.min(y, window.innerHeight - h - EDGE_PX)),
    });
  }, [x, y, width, items.length]);

  useEffect(() => {
    const close = () => onCloseRef.current();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || subRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // (Not its own list scrolling — only the page's.)
    const onScroll = (e: Event) => {
      if (subRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, []);

  // An item's list: beside the menu (on its right, or its left where there's no room), level with the item.
  const openSubmenu = (key: string, itemEl: HTMLElement) => {
    const menu = menuRef.current?.getBoundingClientRect();
    const item = itemEl.getBoundingClientRect();
    if (!menu) return;
    const fitsRight = menu.right + 4 + SUBMENU_WIDTH_PX <= window.innerWidth - EDGE_PX;
    const left = fitsRight ? menu.right + 4 : Math.max(EDGE_PX, menu.left - 4 - SUBMENU_WIDTH_PX);
    const maxHeight = Math.min(360, window.innerHeight - EDGE_PX * 2);
    setSubPos({ left, top: Math.max(EDGE_PX, item.top - 5), maxHeight });
    setOpenKey(key);
  };
  // Once open, moved up to stay on screen (its height measured).
  useLayoutEffect(() => {
    const el = subRef.current;
    if (!el || !subPos) return;
    const bottom = subPos.top + el.offsetHeight;
    if (bottom > window.innerHeight - EDGE_PX) {
      setSubPos((prev) => (prev ? { ...prev, top: Math.max(EDGE_PX, window.innerHeight - EDGE_PX - el.offsetHeight) } : prev));
    }
  }, [openKey, subPos]);

  if (typeof document === "undefined") return null;
  const open = items.find((item): item is Exclude<PieceMenuItem, "divider"> => item !== "divider" && item.key === openKey && Boolean(item.submenu));

  return createPortal(
    <>
      <div
        ref={menuRef}
        role="menu"
        aria-label={title}
        className="fixed z-[2147483647] flex flex-col rounded-[12px] border p-1"
        style={{ left: pos?.left ?? x, top: pos?.top ?? y, width, visibility: pos ? "visible" : "hidden", ...MENU_STYLE }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="px-2.5 pb-1.5 pt-1.5">
          <p className="truncate text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>
            {title}
          </p>
          {subtitle ? (
            <p className="truncate text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
              {subtitle}
            </p>
          ) : null}
        </div>
        <div className="mx-1 mb-1 h-px" style={{ backgroundColor: "var(--glass-border)" }} />
        {items.map((item, index) =>
          item === "divider" ? (
            <div key={`divider_${index}`} className="mx-1 my-1 h-px" style={{ backgroundColor: "var(--glass-border)" }} />
          ) : (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              aria-haspopup={item.submenu ? "menu" : undefined}
              aria-expanded={item.submenu ? openKey === item.key : undefined}
              disabled={item.disabled}
              onPointerEnter={(e) => {
                if (item.submenu) openSubmenu(item.key, e.currentTarget);
                else if (openKey) setOpenKey("");
              }}
              onClick={(e) => {
                if (item.submenu) {
                  if (openKey === item.key) setOpenKey("");
                  else openSubmenu(item.key, e.currentTarget);
                  return;
                }
                onClose();
                item.run?.();
              }}
              className={ITEM_CLASS}
              style={{
                color: item.danger ? "var(--danger)" : "var(--text-main)",
                ...(item.submenu && openKey === item.key ? { backgroundColor: "color-mix(in srgb, var(--brand) 12%, transparent)" } : {}),
              }}
            >
              <span className="inline-flex shrink-0">{item.icon}</span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.submenu ? <ChevronRight size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} /> : null}
            </button>
          ),
        )}
      </div>
      {open?.submenu && subPos ? (
        <div
          ref={subRef}
          role="menu"
          aria-label={open.submenu.title || open.label}
          className="fixed z-[2147483647] flex flex-col overflow-y-auto rounded-[12px] border p-1"
          style={{ left: subPos.left, top: subPos.top, width: SUBMENU_WIDTH_PX, maxHeight: subPos.maxHeight, ...MENU_STYLE }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {open.submenu.title ? (
            <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
              {open.submenu.title}
            </p>
          ) : null}
          {open.submenu.choices.length ? (
            open.submenu.choices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                role="menuitemradio"
                aria-checked={Boolean(choice.checked)}
                disabled={choice.disabled}
                onClick={() => {
                  onClose();
                  choice.run();
                }}
                className={ITEM_CLASS}
                style={{ color: "var(--text-main)" }}
              >
                <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                {choice.checked ? <Check size={14} className="shrink-0" style={{ color: "var(--brand)" }} /> : null}
              </button>
            ))
          ) : (
            <p className="px-2.5 py-2 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
              {open.submenu.empty || "Nothing to pick"}
            </p>
          )}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
