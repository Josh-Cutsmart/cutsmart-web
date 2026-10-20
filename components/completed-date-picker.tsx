"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { glassFieldClass } from "@/components/settings-ui";
import { glassShineStyle } from "@/lib/glass-shine";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";

// When a job was completed, on its Completed window row (components/completed-projects-modal.tsx): a pill with the date
// and time; pressed, a small glass calendar under it (above it, without the room) — the day picked from a month (not one
// after today: it can't have been completed in the future), the time, and Save. Nothing changes until Save; Cancel,
// Escape or a press anywhere else leaves it as it was.

const PANEL_WIDTH = 288;
// Always six weeks of days, so it's always this tall (and can be placed before it's drawn).
const PANEL_HEIGHT = 404;

const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const DAY_LONG = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
// Monday first (1 January 2024 was a Monday).
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(2024, 0, 1 + i)).slice(0, 2));

const pad = (n: number) => String(n).padStart(2, "0");
const dayKeyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function fromDraft(dayKey: string, time: string): Date | null {
  const [y, m, d] = dayKey.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function placeUnder(anchor: HTMLElement): { left: number; top: number } {
  const rect = anchor.getBoundingClientRect();
  const left = Math.min(Math.max(8, rect.right - PANEL_WIDTH), Math.max(8, window.innerWidth - PANEL_WIDTH - 8));
  const below = rect.bottom + 6;
  const top = below + PANEL_HEIGHT > window.innerHeight - 8 ? Math.max(8, rect.top - 6 - PANEL_HEIGHT) : below;
  return { left, top };
}

export function CompletedDatePicker({
  valueIso,
  label,
  ariaLabel,
  accent,
  saving,
  chipClassName,
  onSave,
}: {
  valueIso: string;
  // On the pill (its date and time, as the company shows them).
  label: string;
  ariaLabel: string;
  accent: string;
  saving?: boolean;
  chipClassName: string;
  onSave: (iso: string) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [dayKey, setDayKey] = useState("");
  const [time, setTime] = useState("");
  const [view, setView] = useState({ year: 0, month: 0 });
  const [now, setNow] = useState(() => new Date());
  const open = Boolean(anchor && pos);

  const close = () => {
    setAnchor(null);
    setPos(null);
  };
  const openFrom = (element: HTMLElement) => {
    const current = valueIso ? new Date(valueIso) : new Date();
    const start = Number.isNaN(current.getTime()) ? new Date() : current;
    setNow(new Date());
    setDayKey(dayKeyOf(start));
    setTime(`${pad(start.getHours())}:${pad(start.getMinutes())}`);
    setView({ year: start.getFullYear(), month: start.getMonth() });
    setAnchor(element);
    setPos(placeUnder(element));
  };

  // Kept beside the pill as the window scrolls or resizes; closed by Escape or a press anywhere else (that press doing
  // nothing else — swallowNextClick — so it doesn't also close the Completed window or open a job).
  useEffect(() => {
    if (!anchor) return;
    const follow = () => setPos(placeUnder(anchor));
    const onPress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (document.querySelector("[data-completed-date-picker]")?.contains(target) || anchor.contains(target)) return;
      setAnchor(null);
      setPos(null);
      swallowNextClick();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setAnchor(null);
      setPos(null);
    };
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    document.addEventListener("pointerdown", onPress, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
      document.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [anchor]);

  const todayKey = dayKeyOf(now);
  const draft = fromDraft(dayKey, time);
  const isFuture = Boolean(draft && draft.getTime() > now.getTime() + 60_000);
  const current = valueIso ? new Date(valueIso) : null;
  const unchanged = Boolean(
    draft && current && !Number.isNaN(current.getTime()) && Math.floor(draft.getTime() / 60_000) === Math.floor(current.getTime() / 60_000),
  );
  const canGoForward = view.year < now.getFullYear() || (view.year === now.getFullYear() && view.month < now.getMonth());
  const shiftMonth = (by: number) =>
    setView((prev) => {
      const next = new Date(prev.year, prev.month + by, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  const first = new Date(view.year, view.month, 1);
  const gridStart = new Date(view.year, view.month, 1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));

  const save = () => {
    if (!draft || isFuture || unchanged) return;
    close();
    onSave(draft.toISOString());
  };

  const iconButton =
    "inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <>
      <button
        type="button"
        disabled={saving}
        onClick={(event) => (open ? close() : openFrom(event.currentTarget))}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Change when it was completed"
        className={`${chipClassName} inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium tabular-nums transition hover:brightness-[0.97] disabled:opacity-60`}
        style={{ color: "var(--text-main)" }}
      >
        <CalendarDays size={12} className="shrink-0" style={{ color: open ? accent : "var(--text-muted)" }} />
        {saving ? "Saving…" : label || "Set date"}
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              data-completed-date-picker=""
              role="dialog"
              aria-label="When it was completed"
              className="glass-bar-pop fixed rounded-[20px] border p-3"
              style={{
                left: pos.left,
                top: pos.top,
                width: PANEL_WIDTH,
                zIndex: 1700,
                borderColor: "var(--glass-border)",
                // More solid than the window behind it, so the calendar reads cleanly over it.
                backgroundColor: "var(--glass-bg-strong)",
                backdropFilter: "blur(24px) saturate(200%)",
                WebkitBackdropFilter: "blur(24px) saturate(200%)",
                boxShadow: "inset 0 1px 0 var(--glass-highlight), var(--shadow-glass), 0 18px 44px rgba(15,23,42,0.22)",
                color: "var(--text-main)",
              }}
            >
              <div className="flex items-center justify-between">
                <button type="button" className={iconButton} onClick={() => shiftMonth(-1)} aria-label="Previous month">
                  <ChevronLeft size={16} />
                </button>
                <p className="text-[13.5px] font-medium">{MONTH_YEAR.format(first)}</p>
                <button type="button" className={iconButton} onClick={() => shiftMonth(1)} disabled={!canGoForward} aria-label="Next month">
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="mt-1 grid grid-cols-7 text-center text-[10.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                {WEEKDAYS.map((day) => (
                  <span key={day} className="py-1">
                    {day}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-0.5">
                {days.map((day) => {
                  const key = dayKeyOf(day);
                  const selected = key === dayKey;
                  const inMonth = day.getMonth() === view.month;
                  const future = key > todayKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={future}
                      onClick={() => {
                        setDayKey(key);
                        if (!inMonth) setView({ year: day.getFullYear(), month: day.getMonth() });
                      }}
                      aria-label={DAY_LONG.format(day)}
                      aria-pressed={selected}
                      className={`mx-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-[12.5px] font-medium tabular-nums transition disabled:cursor-default disabled:opacity-25 ${
                        selected ? "glass-shine" : "hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)]"
                      }`}
                      style={
                        selected
                          ? glassShineStyle(accent, { color: "#FFFFFF" })
                          : {
                              color: key === todayKey ? accent : inMonth ? "var(--text-main)" : "var(--text-muted)",
                              opacity: inMonth || future ? undefined : 0.55,
                              boxShadow: key === todayKey ? `inset 0 0 0 1.5px ${accent}` : undefined,
                            }
                      }
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="w-9 shrink-0 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                  Time
                </span>
                <input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  aria-label="Time it was completed"
                  className={`${glassFieldClass} min-w-0 flex-1 tabular-nums`}
                />
                <button
                  type="button"
                  onClick={() => {
                    const at = new Date();
                    setNow(at);
                    setDayKey(dayKeyOf(at));
                    setTime(`${pad(at.getHours())}:${pad(at.getMinutes())}`);
                    setView({ year: at.getFullYear(), month: at.getMonth() });
                  }}
                  className="glass-shine glass-shine-neutral inline-flex h-9 shrink-0 items-center rounded-full px-3 text-[12px] font-medium"
                  style={{ color: "var(--text-main)" }}
                >
                  Now
                </button>
              </div>
              <p className="mt-2 truncate px-0.5 text-[11.5px] font-medium" style={{ color: isFuture ? "var(--danger)" : "var(--text-muted)" }}>
                {isFuture ? "That's in the future — pick an earlier time." : draft ? DAY_LONG.format(draft) : ""}
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  className="glass-shine glass-shine-neutral inline-flex h-9 items-center rounded-full px-4 text-[12.5px] font-medium"
                  style={{ color: "var(--text-main)" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={!draft || isFuture || unchanged}
                  className="glass-shine inline-flex h-9 items-center rounded-full px-4 text-[12.5px] font-medium disabled:opacity-50"
                  style={glassShineStyle(accent, { color: "#FFFFFF" })}
                >
                  Save
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
