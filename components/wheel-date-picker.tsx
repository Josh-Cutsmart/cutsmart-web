"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { GLASS_MENU_STYLE } from "@/components/glass-dropdown";
import { activeDate } from "@/lib/company-formats";
import { glassShineStyle } from "@/lib/glass-shine";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";

// A date field that opens three wheels — the day, the month, the year — scrolled (or tapped, or arrowed) to pick it,
// as a phone's own date wheels. The field shows the date in the company's format. Each wheel snaps to its rows; the
// row in the band across the middle is the pick, saved as the wheel settles (onChange — "YYYY-MM-DD", as a date
// input's). The days follow the month and year (no 31st in a 30-day month: the day comes back to the last). Done, a
// tap outside, Escape or a scroll of the page behind closes it.

const ROW_H = 36;
// Rows showing in each wheel: the middle one's the pick, two either side.
const ROWS_SHOWN = 5;
const WHEEL_H = ROW_H * ROWS_SHOWN;
const PANEL_W = 264;
const PANEL_H = WHEEL_H + 16 + 48;
const CLEARANCE = 8;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function parseDateValue(value: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (match) return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
}
function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate();
}
function dateValue(y: number, m: number, d: number) {
  return `${y}-${pad(m + 1)}-${pad(Math.min(d, daysInMonth(y, m)))}`;
}

// One wheel: its rows in a snapping scroller, padded two rows top and bottom so the first and last can reach the middle.
function Wheel({
  items,
  index,
  onPick,
  label,
  width,
  autoFocus,
}: {
  items: string[];
  index: number;
  onPick: (index: number) => void;
  label: string;
  width: number;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  // The row in the middle while it's moving (none when it's still — then it's the pick, which changes once it settles).
  const [movingIndex, setMovingIndex] = useState<number | null>(null);
  const liveIndex = movingIndex ?? index;
  // The pick in the middle: when it opens, and when it changes from outside (the day brought back by a shorter month).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (Math.abs(el.scrollTop - index * ROW_H) > 1) el.scrollTop = index * ROW_H;
  }, [index, items.length]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  useEffect(
    () => () => {
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    },
    [],
  );
  const nearest = (el: HTMLDivElement) => Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ROW_H)));
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setMovingIndex(nearest(el));
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      const at = nearest(el);
      if (at !== index) onPick(at);
      setMovingIndex(null);
    }, 120);
  };
  const scrollToRow = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: Math.max(0, Math.min(items.length - 1, i)) * ROW_H, behavior: reduceMotion ? "auto" : "smooth" });
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    scrollToRow(liveIndex + (event.key === "ArrowDown" ? 1 : -1));
  };
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      className="relative z-[1] shrink-0 snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-[10px] outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-[var(--brand)] [&::-webkit-scrollbar]:hidden"
      style={{
        width,
        height: WHEEL_H,
        // Rows fading out towards the top and bottom, as a wheel turning away.
        maskImage: "linear-gradient(to bottom, transparent 0%, #000 30%, #000 70%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 30%, #000 70%, transparent 100%)",
      }}
    >
      <div style={{ height: ROW_H * 2 }} aria-hidden="true" />
      {items.map((item, i) => (
        <button
          key={`${item}_${i}`}
          type="button"
          role="option"
          aria-selected={i === index}
          tabIndex={-1}
          onClick={() => scrollToRow(i)}
          className="flex w-full snap-center items-center justify-center text-[15px] transition-[color,font-weight] duration-150"
          style={{
            height: ROW_H,
            color: i === liveIndex ? "var(--text-main)" : "var(--text-muted)",
            fontWeight: i === liveIndex ? 700 : 500,
          }}
        >
          {item}
        </button>
      ))}
      <div style={{ height: ROW_H * 2 }} aria-hidden="true" />
    </div>
  );
}

export function WheelDatePicker({
  value,
  onChange,
  disabled,
  className,
  style,
  ariaLabel = "Date",
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; originX: number } | null>(null);
  const isOpen = position !== null;
  const { y, m, d } = parseDateValue(value);
  const thisYear = new Date().getFullYear();
  const firstYear = Math.min(y, thisYear) - 10;
  const years = Array.from({ length: Math.max(y, thisYear) + 10 - firstYear + 1 }, (_, i) => firstYear + i);
  const dayCount = daysInMonth(y, m);
  const days = Array.from({ length: dayCount }, (_, i) => String(i + 1));

  useEffect(() => {
    if (!isOpen) return;
    const close = () => setPosition(null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setPosition(null);
      // The tap that closes it doesn't also land on what's under it (e.g. the pop-up's backdrop, closing the event).
      swallowNextClick();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setPosition(null);
      triggerRef.current?.focus({ preventScroll: true });
    };
    const onScroll = (event: Event) => {
      // Its own wheels scrolling is how it's used; anything else scrolling would leave it floating off its field.
      if (panelRef.current && event.target instanceof Node && panelRef.current.contains(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [isOpen]);

  const toggle = () => {
    if (disabled) return;
    if (isOpen) {
      setPosition(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const roomBelow = viewportBottom - rect.bottom - CLEARANCE;
    const roomAbove = rect.top - viewportTop - CLEARANCE;
    const left = Math.min(Math.max(CLEARANCE, rect.left), window.innerWidth - PANEL_W - CLEARANCE);
    const originX = Math.min(PANEL_W, Math.max(0, rect.left + rect.width / 2 - left));
    setPosition(
      roomBelow < PANEL_H + 6 && roomAbove > roomBelow
        ? { left, bottom: document.documentElement.clientHeight - rect.top + 6, originX }
        : { left, top: rect.bottom + 6, originX },
    );
  };

  const pick = (next: { y?: number; m?: number; d?: number }) => onChange(dateValue(next.y ?? y, next.m ?? m, next.d ?? d));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`${ariaLabel}: ${activeDate(new Date(y, m, d))}`}
        className={`inline-flex items-center text-left ${className ?? ""}`}
        style={style}
      >
        <span className="min-w-0 truncate">{activeDate(new Date(y, m, d))}</span>
      </button>
      {isOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={`Choose ${ariaLabel.toLowerCase()}`}
              className="glass-menu-squeeze fixed rounded-[14px] border p-2 shadow-[var(--shadow-md)]"
              style={{
                ...GLASS_MENU_STYLE,
                left: position.left,
                top: position.top,
                bottom: position.bottom,
                width: PANEL_W,
                transformOrigin: `${Math.round(position.originX)}px ${position.bottom !== undefined ? "100%" : "0%"}`,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="relative flex justify-between">
                {/* The band across the middle: the picked day, month and year. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 rounded-[10px]"
                  style={{ top: ROW_H * 2, height: ROW_H, backgroundColor: "color-mix(in srgb, var(--text-main) 7%, transparent)" }}
                />
                <Wheel items={days} index={Math.min(d, dayCount) - 1} onPick={(i) => pick({ d: i + 1 })} label="Day" width={64} autoFocus />
                <Wheel items={MONTHS} index={m} onPick={(i) => pick({ m: i })} label="Month" width={84} />
                <Wheel items={years.map(String)} index={years.indexOf(y)} onPick={(i) => pick({ y: years[i] })} label="Year" width={84} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 px-1">
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    onChange(dateValue(now.getFullYear(), now.getMonth(), now.getDate()));
                  }}
                  className="h-8 rounded-full px-3 text-[12px] font-semibold transition hover:bg-[color-mix(in_srgb,var(--text-main)_7%,transparent)]"
                  style={{ color: "var(--brand)" }}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPosition(null);
                    triggerRef.current?.focus({ preventScroll: true });
                  }}
                  className="glass-shine h-8 rounded-full px-4 text-[12px] font-semibold text-white transition hover:brightness-105"
                  style={glassShineStyle("var(--brand)")}
                >
                  Done
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
