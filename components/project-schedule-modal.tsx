"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CalendarDays, X } from "lucide-react";
import { iconRemoveButtonClass } from "@/components/settings-ui";
import { useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { activeDate } from "@/lib/company-formats";
import {
  calendarCategoryLevel,
  normalizeCalendarCategories,
  subscribeProjectCalendarEvents,
  type CalendarCategory,
  type CalendarEvent,
  type CalendarViewer,
} from "@/lib/calendar-data";

// A project's Schedule (Design tab): the Calendar's events linked to it, as a list — upcoming, then past (all its text
// the main text colour; no addresses) — only those in categories the person can see (the Calendar's own rule, lib/calendar-categories.ts). Clicking one opens it in the
// Calendar.

const DAY_MS = 24 * 60 * 60 * 1000;
const UNCATEGORISED: CalendarCategory = { id: "__none", name: "Uncategorised", color: "#94A3B8" };

function startOfDay(ms: number): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}
// The time now — a module function, as the React Compiler lint takes a bare Date.now() in a component for a call
// during render.
function nowMs(): number {
  return Date.now();
}
function timeText(ms: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(ms))
    .toLowerCase()
    .replace(/\s+/g, "");
}
function weekday(ms: number, style: "long" | "short") {
  return new Intl.DateTimeFormat(undefined, { weekday: style }).format(new Date(ms));
}
// When an event is, as the Calendar's pop-up puts it: "Monday 6 Oct 2026" / "9:00am – 10:30am", etc.
function whenText(e: CalendarEvent): { primary: string; secondary: string } {
  const lastDayMs = e.allDay ? e.endMs - DAY_MS : e.endMs;
  const oneDay = startOfDay(e.startMs).getTime() === startOfDay(e.allDay ? lastDayMs : e.endMs - 1).getTime();
  if (oneDay) {
    return {
      primary: `${weekday(e.startMs, "long")} ${activeDate(e.startMs)}`,
      secondary: e.allDay ? "All day" : `${timeText(e.startMs)} – ${timeText(e.endMs)}`,
    };
  }
  if (e.allDay) {
    const days = Math.round((startOfDay(lastDayMs).getTime() - startOfDay(e.startMs).getTime()) / DAY_MS) + 1;
    return {
      primary: `${weekday(e.startMs, "short")} ${activeDate(e.startMs)} – ${weekday(lastDayMs, "short")} ${activeDate(lastDayMs)}`,
      secondary: `All day · ${days} days`,
    };
  }
  return {
    primary: `${weekday(e.startMs, "short")} ${activeDate(e.startMs)}, ${timeText(e.startMs)}`,
    secondary: `until ${weekday(e.endMs, "short")} ${activeDate(e.endMs)}, ${timeText(e.endMs)}`,
  };
}

export function ProjectScheduleModal({
  open,
  origin,
  originElRef,
  onClose,
  companyId,
  projectId,
  calendarCategories,
  viewer,
}: {
  open: boolean;
  origin: GlassModalOrigin;
  originElRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  companyId: string;
  projectId: string;
  // The company doc's calendarCategories, as stored.
  calendarCategories: unknown;
  viewer: CalendarViewer;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shouldRender = useGlassModalPopOrigin(open, origin, panelRef, undefined, originElRef);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  // Live while it's open.
  useEffect(() => {
    if (!open || !companyId || !projectId) return;
    return subscribeProjectCalendarEvents(
      companyId,
      projectId,
      (next) => {
        setEvents(next);
        setLoaded(true);
        setLoadError("");
      },
      () => setLoadError("Couldn't load the schedule — check your connection."),
    );
  }, [open, companyId, projectId]);

  const categories = useMemo(() => normalizeCalendarCategories(calendarCategories), [calendarCategories]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const categoryOf = (e: CalendarEvent) => categoryById.get(e.categoryId) ?? UNCATEGORISED;
  // Only events in categories they can see (the Calendar's rule).
  const visibleEvents = events.filter((e) => calendarCategoryLevel(categoryById.get(e.categoryId), viewer) !== "none");

  if (!shouldRender || typeof document === "undefined") return null;

  const now = nowMs();
  const upcoming = visibleEvents.filter((e) => e.endMs > now);
  const past = visibleEvents.filter((e) => e.endMs <= now).reverse();
  const openInCalendar = (eventId: string) => {
    onClose();
    router.push(`/calendar?event=${encodeURIComponent(eventId)}`);
  };

  const renderRow = (e: CalendarEvent) => {
    const category = categoryOf(e);
    const when = whenText(e);
    return (
      <button
        key={e.id}
        type="button"
        onClick={() => openInCalendar(e.id)}
        title="Open in the Calendar"
        className="relative flex w-full items-stretch overflow-hidden rounded-[12px] border text-left transition hover:brightness-[0.98]"
        style={{
          borderColor: "var(--glass-border)",
          backgroundColor: `color-mix(in srgb, ${category.color} 8%, var(--panel-bg))`,
        }}
      >
        <span className="w-[5px] shrink-0" style={{ backgroundColor: category.color }} />
        <span className="min-w-0 flex-1 px-3 py-2.5">
          <span className="flex items-center justify-between gap-3">
            <span className="truncate text-[14px] font-semibold" style={{ color: "var(--text-main)" }}>{e.title || "Untitled event"}</span>
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-[2px] text-[11px] font-medium"
              style={{ backgroundColor: `color-mix(in srgb, ${category.color} 18%, transparent)`, color: "var(--text-main)" }}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: category.color }} />
              {category.name}
            </span>
          </span>
          <span className="mt-0.5 block text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
            {when.primary} · {when.secondary}
          </span>
        </span>
      </button>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[1700] flex items-center justify-center px-4 py-4">
      <button type="button" aria-label="Close schedule" onClick={onClose} className="glass-modal-backdrop absolute inset-0" />
      <div ref={panelRef} className="glass-modal-panel relative flex max-h-[min(760px,92vh)] w-[min(640px,96vw)] flex-col overflow-hidden">
        <div className="glass-modal-header flex h-[56px] shrink-0 items-center justify-between gap-3 px-5">
          <div className="flex min-w-0 items-center gap-2">
            <CalendarDays size={16} style={{ color: "var(--text-main)" }} />
            <p className="text-[14px] font-bold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
              Schedule
            </p>
          </div>
          <button type="button" onClick={onClose} className={iconRemoveButtonClass} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="glass-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loadError ? (
            <p className="text-[12.5px] font-medium" style={{ color: "var(--danger-strong)" }}>{loadError}</p>
          ) : !loaded ? (
            <p className="py-8 text-center text-[13px]" style={{ color: "var(--text-main)" }}>Loading…</p>
          ) : visibleEvents.length === 0 ? (
            <div className="rounded-[14px] border border-dashed px-4 py-10 text-center" style={{ borderColor: "var(--glass-border)" }}>
              <p className="text-[14px] font-medium" style={{ color: "var(--text-main)" }}>Nothing scheduled for this project.</p>
              <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-main)" }}>
                Link this project to an event in the Calendar and it shows here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>
                  Upcoming
                </p>
                {upcoming.length ? (
                  upcoming.map((e) => renderRow(e))
                ) : (
                  <p className="text-[12.5px]" style={{ color: "var(--text-main)" }}>Nothing coming up.</p>
                )}
              </div>
              {past.length ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>
                    Past
                  </p>
                  {past.map((e) => renderRow(e))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
