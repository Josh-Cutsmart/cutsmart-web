"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GLASS_MENU_STYLE } from "@/components/glass-dropdown";
import { activeDate } from "@/lib/company-formats";
import { glassShineStyle } from "@/lib/glass-shine";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";

// A date field that opens three wheels — the day, the month, the year — scrolled (or tapped, or arrowed) to pick it,
// as a phone's own date wheels, the date's weekday over them. The field shows the date in the company's format. Each
// wheel snaps to its rows; the row in the band across the middle is the pick, saved as the wheel settles (onChange —
// "YYYY-MM-DD", as a date input's). The days carry on into the months either side (greyed) — scrolled onto one of
// theirs, the date moves into that month, the month wheel with it — and the months into the years either side the same
// way. The days follow the month and year (no 31st in a 30-day month: the day comes back to the last). Done, a tap
// outside, Escape or a scroll of the page behind closes it.

const ROW_H = 36;
// Rows showing in each wheel: the middle one's the pick, two either side.
const ROWS_SHOWN = 5;
const WHEEL_H = ROW_H * ROWS_SHOWN;
const PANEL_W = 264;
// (Its weekday over the wheels, and Today / Done under them.)
const WEEKDAY_H = 26;
const PANEL_H = WEEKDAY_H + WHEEL_H + 16 + 48;
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

// An endless wheel's rows: its items over and over, this many times — it sits in the middle lot, and goes back there
// (to the same item, unseen) each time it settles, so it can always carry on round either way.
const LOOP_COPIES = 7;

// One wheel: its rows in a snapping scroller, padded two rows top and bottom so the first and last can reach the middle.
// `muted`: rows greyed out — the days of the months either side, the months of the years either side. `keys`: each row's
// own — its date, not its place — so when the rows are laid out afresh round a new pick (a day scrolled into the next
// month), the row it's settled on stays the same row, and the browser's snapping (which holds on to the row it snapped
// to) keeps it in the middle rather than taking whatever's now where it was — and picking again. `loop`: endless — after
// its last item comes its first again (the time's hours and minutes).
function Wheel({
  items,
  index,
  onPick,
  label,
  width,
  autoFocus,
  muted,
  keys,
  loop,
}: {
  items: string[];
  index: number;
  onPick: (index: number) => void;
  label: string;
  width: number;
  autoFocus?: boolean;
  muted?: boolean[];
  keys?: string[];
  loop?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const count = items.length;
  const copies = loop && count > 1 ? LOOP_COPIES : 1;
  const middle = Math.floor(copies / 2);
  const rowCount = count * copies;
  // An item's row (in the middle lot), and a row's item.
  const rowOf = (i: number) => middle * count + i;
  const itemOf = (row: number) => ((row % count) + count) % count;
  // The row in the middle while it's moving (none when it's still — then it's the pick, which changes once it settles).
  const [movingRow, setMovingRow] = useState<number | null>(null);
  const liveIndex = movingRow == null ? index : itemOf(movingRow);
  // The pick in the middle: when it opens, and when it changes from outside (the day brought back by a shorter month). An
  // endless wheel: in its middle lot when it opens, and left on the row it's on when that's the pick already.
  const placedRef = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = (middle * count + index) * ROW_H;
    if (copies === 1) {
      if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
    } else {
      const row = Math.round(el.scrollTop / ROW_H);
      if (!placedRef.current || ((row % count) + count) % count !== index) el.scrollTop = target;
    }
    placedRef.current = true;
  }, [index, count, copies, middle]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  useEffect(
    () => () => {
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    },
    [],
  );
  const nearest = (el: HTMLDivElement) => Math.max(0, Math.min(rowCount - 1, Math.round(el.scrollTop / ROW_H)));
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setMovingRow(nearest(el));
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      const row = nearest(el);
      const at = itemOf(row);
      // (Endless: back to the same item in the middle lot — the same rows showing, so it doesn't look to move.)
      if (copies > 1 && row !== rowOf(at)) el.scrollTop = rowOf(at) * ROW_H;
      if (at !== index) onPick(at);
      setMovingRow(null);
    }, 120);
  };
  const scrollToRow = (row: number) => {
    const el = ref.current;
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: Math.max(0, Math.min(rowCount - 1, row)) * ROW_H, behavior: reduceMotion ? "auto" : "smooth" });
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const el = ref.current;
    scrollToRow((el ? nearest(el) : rowOf(index)) + (event.key === "ArrowDown" ? 1 : -1));
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
      {Array.from({ length: rowCount }, (_, row) => {
        const i = itemOf(row);
        const item = items[i];
        const lot = Math.floor(row / count);
        return (
          <button
            key={`${lot}_${keys?.[i] ?? `${item}_${i}`}`}
            type="button"
            role="option"
            aria-selected={i === index}
            tabIndex={-1}
            onClick={() => scrollToRow(row)}
            className="flex w-full snap-center items-center justify-center text-[15px] transition-[color,font-weight] duration-150"
            style={{
              height: ROW_H,
              color: i === liveIndex ? "var(--text-main)" : "var(--text-muted)",
              fontWeight: i === liveIndex ? 700 : 500,
              opacity: i !== liveIndex && muted?.[i] ? 0.4 : 1,
            }}
          >
            {item}
          </button>
        );
      })}
      <div style={{ height: ROW_H * 2 }} aria-hidden="true" />
    </div>
  );
}

// The pop-up both wheel fields open (WheelDatePicker, WheelTimePicker): under its field — over it when there's more room
// there — its wheels side by side with the band across their middle, Done under them. Done, a tap outside, Escape or a
// scroll of the page behind closes it.
function useWheelPanel(disabled: boolean | undefined, panelWidth: number, panelHeight: number) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; originX: number } | null>(null);
  const isOpen = position !== null;

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
    const left = Math.min(Math.max(CLEARANCE, rect.left), window.innerWidth - panelWidth - CLEARANCE);
    const originX = Math.min(panelWidth, Math.max(0, rect.left + rect.width / 2 - left));
    setPosition(
      roomBelow < panelHeight + 6 && roomAbove > roomBelow
        ? { left, bottom: document.documentElement.clientHeight - rect.top + 6, originX }
        : { left, top: rect.bottom + 6, originX },
    );
  };
  const done = () => {
    setPosition(null);
    triggerRef.current?.focus({ preventScroll: true });
  };
  return { triggerRef, panelRef, position, isOpen, toggle, done };
}

function WheelPanel({
  position,
  panelRef,
  onDone,
  width,
  ariaLabel,
  header,
  footerStart,
  children,
}: {
  position: ReturnType<typeof useWheelPanel>["position"];
  panelRef: ReturnType<typeof useWheelPanel>["panelRef"];
  onDone: () => void;
  width: number;
  ariaLabel: string;
  header?: ReactNode;
  footerStart?: ReactNode;
  children: ReactNode;
}) {
  if (!position || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel}
      className="glass-menu-squeeze fixed rounded-[14px] border p-2 shadow-[var(--shadow-md)]"
      style={{
        ...GLASS_MENU_STYLE,
        left: position.left,
        top: position.top,
        bottom: position.bottom,
        width,
        transformOrigin: `${Math.round(position.originX)}px ${position.bottom !== undefined ? "100%" : "0%"}`,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {header}
      <div className="relative flex justify-between">
        {/* The band across the middle: the pick. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 rounded-[10px]"
          style={{ top: ROW_H * 2, height: ROW_H, backgroundColor: "color-mix(in srgb, var(--text-main) 7%, transparent)" }}
        />
        {children}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 px-1">
        {footerStart ?? <span />}
        <button
          type="button"
          onClick={onDone}
          className="glass-shine h-8 rounded-full px-4 text-[12px] font-semibold text-white transition hover:brightness-105"
          style={glassShineStyle("var(--brand)")}
        >
          Done
        </button>
      </div>
    </div>,
    document.body,
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
  const { triggerRef, panelRef, position, isOpen, toggle, done } = useWheelPanel(disabled, PANEL_W, PANEL_H);
  const { y, m, d } = parseDateValue(value);
  const thisYear = new Date().getFullYear();
  const firstYear = Math.min(y, thisYear) - 10;
  const years = Array.from({ length: Math.max(y, thisYear) + 10 - firstYear + 1 }, (_, i) => firstYear + i);
  const dayCount = daysInMonth(y, m);
  // The days: the month's, with the months either side's around them (greyed) — scrolled onto one of theirs, the date
  // moves into that month; the wheel's then centred on it again, the same day in the middle, so it carries straight on.
  const before = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 };
  const after = m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 };
  const dayItems = [
    ...Array.from({ length: daysInMonth(before.y, before.m) }, (_, i) => ({ ...before, d: i + 1, muted: true })),
    ...Array.from({ length: dayCount }, (_, i) => ({ y, m, d: i + 1, muted: false })),
    ...Array.from({ length: daysInMonth(after.y, after.m) }, (_, i) => ({ ...after, d: i + 1, muted: true })),
  ];
  const dayIndex = daysInMonth(before.y, before.m) + Math.min(d, dayCount) - 1;
  // The months: the year's, with the years either side's around them (greyed) — likewise, into that year.
  const monthItems = [y - 1, y, y + 1].flatMap((year) => MONTHS.map((label, month) => ({ y: year, m: month, label, muted: year !== y })));
  const weekday = new Date(y, m, Math.min(d, dayCount)).toLocaleDateString("en-NZ", { weekday: "long" });

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
      <WheelPanel
        position={position}
        panelRef={panelRef}
        onDone={done}
        width={PANEL_W}
        ariaLabel={`Choose ${ariaLabel.toLowerCase()}`}
        // (The date's weekday, over the wheels.)
        header={
          <p className="text-center text-[13px] font-medium" style={{ height: WEEKDAY_H, lineHeight: `${WEEKDAY_H - 6}px`, color: "var(--text-main)" }}>
            {weekday}
          </p>
        }
        footerStart={
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
        }
      >
        <Wheel
          items={dayItems.map((item) => String(item.d))}
          keys={dayItems.map((item) => `${item.y}-${item.m}-${item.d}`)}
          muted={dayItems.map((item) => item.muted)}
          index={dayIndex}
          onPick={(i) => pick({ y: dayItems[i].y, m: dayItems[i].m, d: dayItems[i].d })}
          label="Day"
          width={64}
          autoFocus
        />
        <Wheel
          items={monthItems.map((item) => item.label)}
          keys={monthItems.map((item) => `${item.y}-${item.m}`)}
          muted={monthItems.map((item) => item.muted)}
          index={12 + m}
          onPick={(i) => pick({ y: monthItems[i].y, m: monthItems[i].m })}
          label="Month"
          width={84}
        />
        <Wheel items={years.map(String)} keys={years.map(String)} index={years.indexOf(y)} onPick={(i) => pick({ y: years[i] })} label="Year" width={84} />
      </WheelPanel>
    </>
  );
}

// A time field that opens three wheels — the hour and the minute (every minute, or in `stepMinutes` steps), both endless
// (after 12 comes 1 again, after 59 comes 00), and am / pm — as WheelDatePicker's. The field shows the time as the app does ("9:15am"); onChange gets "HH:MM" (24-hour), as a time
// input's.
const TIME_PANEL_W = 228;
const TIME_PANEL_H = WHEEL_H + 16 + 48;
export function WheelTimePicker({
  value,
  onChange,
  disabled,
  className,
  style,
  ariaLabel = "Time",
  stepMinutes = 1,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  stepMinutes?: number;
}) {
  const { triggerRef, panelRef, position, isOpen, toggle, done } = useWheelPanel(disabled, TIME_PANEL_W, TIME_PANEL_H);
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  const hour = match ? Math.min(23, Number(match[1])) : 9;
  const minute = match ? Math.min(59, Number(match[2])) : 0;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const pm = hour >= 12;
  const step = Math.max(1, Math.min(60, Math.round(stepMinutes)));
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  const minuteIndex = Math.min(minutes.length - 1, Math.round(minute / step));
  const label = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(2000, 0, 1, hour, minute))
    .toLowerCase()
    .replace(/\s+/g, "");
  const pick = (next: { hour12?: number; minute?: number; pm?: boolean }) => {
    const h12 = next.hour12 ?? hour12;
    const h24 = (h12 % 12) + ((next.pm ?? pm) ? 12 : 0);
    onChange(`${pad(h24)}:${pad(next.minute ?? minute)}`);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`${ariaLabel}: ${label}`}
        className={`inline-flex items-center text-left ${className ?? ""}`}
        style={style}
      >
        <span className="min-w-0 truncate">{label}</span>
      </button>
      <WheelPanel position={position} panelRef={panelRef} onDone={done} width={TIME_PANEL_W} ariaLabel={`Choose ${ariaLabel.toLowerCase()}`}>
        <Wheel
          items={Array.from({ length: 12 }, (_, i) => String(i + 1))}
          index={hour12 - 1}
          onPick={(i) => pick({ hour12: i + 1 })}
          label="Hour"
          width={64}
          autoFocus
          loop
        />
        <Wheel items={minutes.map(pad)} index={minuteIndex} onPick={(i) => pick({ minute: minutes[i] })} label="Minute" width={64} loop />
        <Wheel items={["am", "pm"]} index={pm ? 1 : 0} onPick={(i) => pick({ pm: i === 1 })} label="am or pm" width={64} />
      </WheelPanel>
    </>
  );
}
