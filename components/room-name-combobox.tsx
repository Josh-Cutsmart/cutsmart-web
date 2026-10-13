"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

// The glass dropdown menus' look (the project page's GLASS_DROPDOWN_MENU_STYLE).
const MENU_STYLE: CSSProperties = {
  borderColor: "var(--glass-border)",
  backgroundColor: "var(--glass-modal-bg)",
  backdropFilter: "blur(12px) saturate(220%)",
  WebkitBackdropFilter: "blur(12px) saturate(220%)",
  boxShadow: "inset 0 0 0 999px color-mix(in srgb, var(--panel-bg) 22%, transparent), var(--shadow-glass)",
};

// A room's name: one of the company's rooms (Company Settings › Rooms) picked from its dropdown, or typed in. Typing
// after a picked one adds to it after a colon — "Misc" then "TV Cabinet" is "Misc: TV Cabinet"; taking the added part
// away leaves the picked room, and editing the picked room's own name makes it a typed name again.
export function RoomNameCombobox({
  value,
  onChange,
  options,
  placeholder,
  autoFocus,
  onEnter,
  onEscape,
  className,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  onEscape?: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  // A name that starts out as one of the rooms counts as picked.
  const [picked, setPicked] = useState(() => (options.includes(value) ? value : ""));
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // The picked room, while the name still starts with it (a cleared or retyped name has none).
  const prefix = picked && (value === picked || value.startsWith(`${picked}: `)) ? picked : "";
  const query = prefix ? "" : value.trim().toLowerCase();
  const shown = options.filter((option) => !query || option.toLowerCase().includes(query));
  const isOpen = open && shown.length > 0;

  // The menu follows the field every frame while it's open — it's usually in a pop-up that's still growing out of
  // the button that opened it, and it opens above the field when there's no room below.
  useLayoutEffect(() => {
    if (!isOpen) return;
    let frame = 0;
    const place = () => {
      const menu = menuRef.current;
      const wrap = wrapRef.current;
      if (menu && wrap) {
        const box = wrap.getBoundingClientRect();
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const height = menu.offsetHeight;
        const below = box.bottom + 4;
        const above = box.top - 4 - height;
        menu.style.left = `${box.left}px`;
        menu.style.width = `${box.width}px`;
        menu.style.top = `${below + height > viewportHeight - 8 && above >= 8 ? above : below}px`;
      }
      frame = window.requestAnimationFrame(place);
    };
    place();
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  // Focused as it opens, without the page scrolling toward it — the pop-ups it's in grow out of the button that opened
  // them, so at that moment it's still a tiny copy of itself over that button (often low, where the keyboard opens).
  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const openMenu = () => setOpen(true);
  const closeMenu = () => {
    setOpen(false);
    setHighlight(-1);
  };
  // Picking a room keeps what was added after the one picked before ("Misc: TV Cabinet" → "Kitchen: TV Cabinet").
  const pick = (option: string) => {
    const added = prefix ? value.slice(prefix.length).replace(/^:\s*/, "") : "";
    setPicked(option);
    onChange(added ? `${option}: ${added}` : option);
    closeMenu();
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });
  };
  const onType = (raw: string) => {
    if (prefix && raw.startsWith(prefix)) {
      const added = raw.slice(prefix.length).replace(/^\s*:?\s*/, "");
      onChange(added ? `${prefix}: ${added}` : prefix);
      return;
    }
    if (prefix) setPicked("");
    onChange(raw);
    setHighlight(-1);
    if (options.length) openMenu();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!options.length) return;
      e.preventDefault();
      if (!isOpen) {
        openMenu();
        setHighlight(0);
        return;
      }
      setHighlight((prev) => {
        const next = prev + (e.key === "ArrowDown" ? 1 : -1);
        return next < 0 ? shown.length - 1 : next >= shown.length ? 0 : next;
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (isOpen && highlight >= 0 && shown[highlight]) {
        pick(shown[highlight]);
        return;
      }
      closeMenu();
      onEnter?.();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (isOpen) {
        e.stopPropagation();
        closeMenu();
        return;
      }
      onEscape?.();
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (options.length && !value.trim()) openMenu();
        }}
        onBlur={(e) => {
          if (!menuRef.current?.contains(e.relatedTarget as Node | null)) closeMenu();
        }}
        placeholder={placeholder}
        role={options.length ? "combobox" : undefined}
        aria-expanded={options.length ? isOpen : undefined}
        aria-autocomplete={options.length ? "list" : undefined}
        className={`${className ?? ""} ${options.length ? "pr-10" : ""}`}
        style={style}
      />
      {options.length ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Rooms"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (isOpen) closeMenu();
            else {
              openMenu();
              inputRef.current?.focus({ preventScroll: true });
            }
          }}
          className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full transition hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)]"
          style={{ color: "var(--text-muted)" }}
        >
          <ChevronDown size={15} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </button>
      ) : null}
      {isOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              className="glass-scroll fixed z-[2147483647] max-h-[260px] overflow-auto rounded-[12px] border p-1 max-md:max-h-[340px]"
              style={MENU_STYLE}
            >
              {shown.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={option === prefix}
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => pick(option)}
                  className="flex w-full items-center rounded-[8px] px-2.5 py-2 text-left text-[13px] font-medium max-md:py-2.5 max-md:text-[15px]"
                  style={{
                    color: "var(--text-main)",
                    backgroundColor:
                      index === highlight
                        ? "color-mix(in srgb, var(--brand) 12%, transparent)"
                        : option === prefix
                          ? "color-mix(in srgb, var(--brand) 8%, transparent)"
                          : undefined,
                  }}
                >
                  {option}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
