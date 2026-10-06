"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";

// Row height inside the menu (a 32px button) plus the menu's own p-1 padding and 1px border, so the
// open-up/open-down decision and the flip-up anchoring use the menu's real size.
const MENU_ROW_HEIGHT_PX = 32;
const MENU_CHROME_PX = 10;
const MENU_MAX_HEIGHT_PX = 280;
const MENU_CLEARANCE_PX = 8;
const MENU_ITEM_SELECTOR = '[role="option"],[role="menuitem"]';

type MenuPosition = {
  left: number;
  // Exactly one of top / bottom is set: a menu that opens upward is anchored by its bottom edge, so it
  // hugs the trigger whatever height it ends up with.
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
};

// Shared open/position/dismiss behaviour for the glass menus below: a fixed-position menu measured from
// its trigger (flips above when there's no room below, clamped to the visible screen), closed by an
// outside press, Escape, a resize, or a scroll anywhere except inside the menu's own list. Keyboard:
// focus moves into the menu on open, Arrow/Home/End move between items, Escape/selecting returns focus
// to the trigger, Tab leaves.
function useAnchoredGlassMenu(options: {
  rowCount: number;
  minWidth: number;
  align: "left" | "center" | "right";
  matchTriggerWidth: boolean;
  disabled?: boolean;
}) {
  const { rowCount, minWidth, align, matchTriggerWidth, disabled } = options;
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isOpen = position !== null;

  const close = (restoreFocus = false) => {
    setPosition(null);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!isOpen) return;
    const closeSilently = () => setPosition(null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setPosition(null);
      // The press that dismisses the menu shouldn't also act on whatever is underneath it (e.g. a modal's
      // backdrop, which would close the whole modal and lose what was typed).
      swallowNextClick();
    };
    const onScroll = (event: Event) => {
      // Scrolling the menu's own list shouldn't dismiss it; scrolling anything else would leave
      // the fixed menu floating away from its trigger, so that does.
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return;
      closeSilently();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Registered in the capture phase and stopped here, so Escape only closes the menu — a page-level
        // Escape handler underneath (e.g. "close this contact") never sees it while a menu is open.
        event.stopPropagation();
        setPosition(null);
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", closeSilently);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", closeSilently);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [isOpen]);

  // Move focus into the menu when it opens: the selected item if there is one, otherwise the first.
  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      const menu = menuRef.current;
      if (!menu) return;
      const target =
        menu.querySelector<HTMLElement>('[aria-selected="true"]') ?? menu.querySelector<HTMLElement>(MENU_ITEM_SELECTOR);
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  const toggle = () => {
    if (disabled) return;
    if (isOpen) {
      setPosition(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = Math.min(
      matchTriggerWidth ? Math.max(minWidth, Math.round(rect.width)) : minWidth,
      window.innerWidth - MENU_CLEARANCE_PX * 2,
    );
    const contentHeight = rowCount * MENU_ROW_HEIGHT_PX + MENU_CHROME_PX;
    const wantedHeight = Math.min(contentHeight, MENU_MAX_HEIGHT_PX);
    // Measure against the visual viewport so an on-screen keyboard (which shrinks it) is respected.
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const roomBelow = viewportBottom - rect.bottom - MENU_CLEARANCE_PX - 4;
    const roomAbove = rect.top - viewportTop - MENU_CLEARANCE_PX - 4;
    const openUp = roomBelow < wantedHeight && roomAbove > roomBelow;
    const maxHeight = Math.max(MENU_ROW_HEIGHT_PX * 2, Math.min(wantedHeight, openUp ? roomAbove : roomBelow));
    const preferredLeft =
      align === "right" ? rect.right - menuWidth : align === "center" ? rect.left + rect.width / 2 - menuWidth / 2 : rect.left;
    const left = Math.min(Math.max(MENU_CLEARANCE_PX, preferredLeft), window.innerWidth - menuWidth - MENU_CLEARANCE_PX);
    setPosition(
      openUp
        ? { left, bottom: document.documentElement.clientHeight - rect.top + 4, width: menuWidth, maxHeight }
        : { left, top: rect.bottom + 4, width: menuWidth, maxHeight },
    );
  };

  return { position, isOpen, triggerRef, menuRef, toggle, close };
}

// The same glass-menu look as the dashboard's mobile filter dropdown, portalled to <body> so it can't
// be clipped by a modal/pane's overflow or re-anchored by a transformed ancestor. Only CSS variables
// are used for colour so it follows the app's light/dark theme without any JS theming.
function GlassMenuPortal({
  position,
  menuRef,
  role,
  ariaLabel,
  children,
}: {
  position: MenuPosition;
  menuRef: RefObject<HTMLDivElement | null>;
  role: "listbox" | "menu";
  ariaLabel?: string;
  children: ReactNode;
}) {
  if (typeof document === "undefined") return null;
  // Arrow / Home / End move between items; Tab simply leaves (the outside-press/blur path closes it).
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu) return;
    const items = Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR));
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else if (event.key === "ArrowUp") nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus({ preventScroll: true });
    items[nextIndex]?.scrollIntoView({ block: "nearest" });
  };
  return createPortal(
    <div
      ref={menuRef}
      role={role}
      aria-label={ariaLabel}
      data-glass-dropdown-menu="true"
      className="glass-scroll fixed overflow-y-auto rounded-[10px] border p-1 shadow-[var(--shadow-md)]"
      style={{
        left: position.left,
        top: position.top,
        bottom: position.bottom,
        width: position.width,
        maxHeight: position.maxHeight,
        zIndex: 2147483647,
        borderColor: "var(--glass-border)",
        backgroundColor: "var(--glass-modal-bg)",
        backdropFilter: "blur(12px) saturate(220%)",
        WebkitBackdropFilter: "blur(12px) saturate(220%)",
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}

const menuRowClass =
  "flex w-full items-center gap-2 rounded-[8px] px-3 text-left text-[12px] font-medium transition-colors hover:bg-[var(--panel-muted)] focus-visible:bg-[var(--panel-muted)] focus-visible:outline-none";

export type GlassDropdownOption = {
  value: string;
  label: string;
  // Optional colour dot shown to the left of the label (e.g. a contact category's colour).
  color?: string;
};

type GlassDropdownProps = {
  value: string;
  options: GlassDropdownOption[];
  onChange: (value: string) => void;
  // Sizing/shape of the trigger button is the caller's call (header chip vs full-width form field).
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  menuMinWidth?: number;
  ariaLabel?: string;
  disabled?: boolean;
  // For a trigger that's styled as something else (e.g. a pill) and shouldn't show the chevron.
  hideChevron?: boolean;
  // Where the menu sits relative to the trigger (default: left edges aligned).
  menuAlign?: "left" | "center" | "right";
};

// A select-style dropdown: the trigger shows the chosen option (with its colour dot) and a chevron.
export function GlassDropdown({
  value,
  options,
  onChange,
  triggerClassName,
  triggerStyle,
  menuMinWidth = 150,
  ariaLabel,
  disabled,
  hideChevron,
  menuAlign = "left",
}: GlassDropdownProps) {
  const { position, isOpen, triggerRef, menuRef, toggle, close } = useAnchoredGlassMenu({
    rowCount: options.length,
    minWidth: menuMinWidth,
    align: menuAlign,
    matchTriggerWidth: true,
    disabled,
  });
  const selected = options.find((option) => option.value === value) ?? options[0];
  const reserveDotSpace = options.some((option) => option.color);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        // The accessible name keeps the field's label and the current value (a bare aria-label would hide it).
        aria-label={ariaLabel ? `${ariaLabel}: ${selected?.label ?? ""}` : undefined}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`inline-flex items-center gap-2 text-left disabled:opacity-60 ${triggerClassName ?? ""}`}
        style={triggerStyle}
      >
        {selected?.color ? (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-700 ease-in-out motion-reduce:transition-none"
            style={{ backgroundColor: selected.color }}
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? ""}</span>
        {hideChevron ? null : (
          <ChevronDown
            size={14}
            className={`shrink-0 opacity-70 transition-transform duration-150 motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {position ? (
        <GlassMenuPortal position={position} menuRef={menuRef} role="listbox" ariaLabel={ariaLabel}>
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value || "__none"}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  close(true);
                  if (!isSelected) onChange(option.value);
                }}
                className={menuRowClass}
                style={{
                  height: MENU_ROW_HEIGHT_PX,
                  backgroundImage: isSelected ? "var(--brand-gradient)" : "none",
                  color: isSelected ? "#FFFFFF" : "var(--text-main)",
                }}
              >
                {option.color ? (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: option.color, boxShadow: isSelected ? "0 0 0 1.5px rgba(255,255,255,0.85)" : undefined }}
                  />
                ) : reserveDotSpace ? (
                  <span className="h-2.5 w-2.5 shrink-0" />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            );
          })}
        </GlassMenuPortal>
      ) : null}
    </>
  );
}

export type GlassActionMenuItem = {
  key: string;
  // Left column — e.g. who the number/email belongs to.
  label: string;
  // Right-hand column — e.g. the number/email itself.
  detail?: string;
  onSelect: () => void;
};

type GlassActionMenuProps = {
  items: GlassActionMenuItem[];
  // Icon (or any content) shown inside the trigger button.
  children: ReactNode;
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  ariaLabel: string;
  menuMinWidth?: number;
};

// An icon-button trigger for a "pick one, then do it" menu (e.g. which number to call). With exactly
// one item there's nothing to choose, so the button just runs it; with none the button is disabled;
// with several it opens a glass menu listing each item's label on the left and its detail on the right.
export function GlassActionMenu({
  items,
  children,
  triggerClassName,
  triggerStyle,
  ariaLabel,
  menuMinWidth = 260,
}: GlassActionMenuProps) {
  const { position, isOpen, triggerRef, menuRef, toggle, close } = useAnchoredGlassMenu({
    rowCount: items.length,
    minWidth: menuMinWidth,
    align: "right",
    matchTriggerWidth: false,
    disabled: items.length === 0,
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (items.length === 1) {
            items[0].onSelect();
            return;
          }
          toggle();
        }}
        disabled={items.length === 0}
        aria-label={ariaLabel}
        aria-haspopup={items.length > 1 ? "menu" : undefined}
        aria-expanded={items.length > 1 ? isOpen : undefined}
        className={`disabled:opacity-40 ${triggerClassName ?? ""}`}
        style={triggerStyle}
      >
        {children}
      </button>
      {position ? (
        <GlassMenuPortal position={position} menuRef={menuRef} role="menu" ariaLabel={ariaLabel}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              className={`${menuRowClass} justify-between`}
              style={{ height: MENU_ROW_HEIGHT_PX, color: "var(--text-main)" }}
            >
              <span className="min-w-0 truncate">{item.label}</span>
              {item.detail ? (
                <span className="ml-3 shrink-0 text-[12px]" style={{ color: "var(--text-muted)" }}>
                  {item.detail}
                </span>
              ) : null}
            </button>
          ))}
        </GlassMenuPortal>
      ) : null}
    </>
  );
}
