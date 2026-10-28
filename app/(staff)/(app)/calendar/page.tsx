"use client";

// The Calendar tab — a shared, Teamup-style company calendar. Month / week / day / list views;
// click a day (or a time in week/day view) to add an event; drag events to move them, drag an
// event's bottom edge in week/day view to change its length. Events sync live between everyone
// (lib/calendar-data.ts). Categories (with colours) are managed in Company Settings > Calendar and can
// be shown/hidden here per person. Opening the tab needs calendar.view; who can edit / view / not see each
// category is set per role on the category (Company Settings > Calendar).

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { WheelDatePicker, WheelTimePicker } from "@/components/wheel-date-picker";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Copy, ExternalLink, Filter, FolderKanban, GripVertical, Hammer, MapPin, MoreHorizontal, Pencil, Plus, Search, Trash2, Users, X } from "lucide-react";
import { SubscribeBellIcon } from "@/components/subscribe-bell-icon";
import { useAuth } from "@/lib/auth-context";
import { haptic } from "@/lib/haptics";
import { fetchCompanyDoc, fetchCompanyMembers, fetchProjects } from "@/lib/firestore-data";
import { isProjectArchived } from "@/lib/project-archive";
import { glassShineStyle } from "@/lib/glass-shine";
import { matchProjectsToText, titleNamesProject } from "@/lib/project-match";
import { hasPermissionKey, isOwnerOrAdmin, useCompanyAccess } from "@/lib/use-company-access";
import { normalizeRoleKey } from "@/lib/company-roles";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { DragGhostLayer, useDragGhost } from "@/lib/use-drag-ghost";
import { activeDate, activeDateRange, useCompanyFormats } from "@/lib/company-formats";
import { useAppTabs } from "@/lib/app-tabs-context";
import { useCalendarAppMode } from "@/lib/calendar-app-mode";
import { normalizeNzHolidayRegion, nzPublicHolidayName, type NzHolidayRegion } from "@/lib/nz-public-holidays";
import { useUndo } from "@/components/undo-bar";
import { deleteCalendarEventKeepingCopy, restoreCalendarEventDoc } from "@/lib/undo-restore-leads-calendar";
import {
  fetchCalendarEvent,
  newCalendarId,
  archiveOldCalendarEvents,
  calendarRetentionCutoffMs,
  normalizeCalendarCategories,
  normalizeCalendarRetention,
  normalizeCalendarShowNonWorkdays,
  normalizeCalendarWorkdays,
  fetchUserCalendarShowNonWorkdays,
  projectEventStaffUids,
  DEFAULT_CALENDAR_WORKDAYS,
  saveCalendarEvent,
  setCalendarEventSubscribed,
  subscribeCalendarEvents,
  subscribeProjectLinkedCalendarEvents,
  calendarCategoryLevel,
  type CalendarAccessLevel,
  type CalendarCategory,
  type CalendarEvent,
} from "@/lib/calendar-data";
import { GlassActionMenu, GlassDropdown, type GlassActionMenuItem } from "@/components/glass-dropdown";
import { GlassScrollbarThumb } from "@/components/glass-scrollbar-thumb";
import {
  GlassSwitch,
  Segmented,
  glassFieldClass,
  iconRemoveButtonClass,
  modalCloseButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
  smallButtonClass,
} from "@/components/settings-ui";
import type { Project } from "@/lib/types";
import { SMALL_JOB_COLOR } from "@/lib/small-jobs";

// The toolbar's Today and Categories: fully rounded, and the view switcher's height beside them — 34px, or 40px
// with bigger text on a phone (Segmented sm / lg).
const pillButtonClass = `${smallButtonClass.replace("rounded-[10px]", "rounded-full").replace("h-8", "h-[34px]")} max-md:h-10 max-md:gap-2 max-md:px-4 max-md:text-[14px]`;
// Phones: the toolbar's Previous / Next, either side of the title.
// Computers: the same, a little smaller, tinted on hover.
const desktopStepButtonClass =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-main)] transition hover:bg-[color-mix(in_srgb,var(--text-main)_7%,transparent)]";
// The event pop-up's "…" (beside its X): the same size, tinted on hover rather than red.
// Plain, like the close button beside it (modalCloseButtonClass) — its dots the same main text colour as that X.
const eventMenuButtonClass =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-main)] transition hover:bg-[color-mix(in_srgb,var(--text-main)_7%,transparent)]";
const mobileStepButtonClass =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--text-main)] transition active:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)]";

type CalendarView = "year" | "month" | "week" | "day" | "list";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_PX = 48;
const SNAP_MIN = 15;
const UNCATEGORISED: CalendarCategory = { id: "__none", name: "Uncategorised", color: "#94A3B8" };
const VIEW_STORAGE_KEY = "cutsmart_calendar_view";
const HIDDEN_STORAGE_KEY = "cutsmart_calendar_hidden_categories";
const LIST_DAYS = 60;
const CALENDAR_VIEW_OPTIONS: Array<{ value: CalendarView; label: string }> = [
  { value: "year", label: "Year" },
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "list", label: "List" },
];
// The toolbar search's text, kept for this browser session (sessionStorage) — see openEventSearch.
const EVENT_SEARCH_STORAGE_KEY = "cutsmart_calendar_event_search";

// ---------------------------------------------------------------- date helpers (local time)
function startOfDay(d: Date | number): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date | number, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
// Weeks start on Monday.
function startOfWeek(d: Date | number): Date {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7;
  return addDays(x, -dow);
}
function startOfMonth(d: Date | number): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}
function sameDay(a: Date | number, b: Date | number) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}
function timeText(ms: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(ms))
    .toLowerCase()
    .replace(/\s+/g, "");
}
function weekdayShort(d: Date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d);
}
function monthYear(d: Date) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(d);
}
function toDateInput(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function toTimeInput(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fromDateTimeInputs(date: string, time: string): number {
  const [y, m, dd] = date.split("-").map(Number);
  const [hh, mi] = (time || "00:00").split(":").map(Number);
  return new Date(y, (m || 1) - 1, dd || 1, hh || 0, mi || 0, 0, 0).getTime();
}
function textOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#FFFFFF";
  const v = parseInt(m[1], 16);
  const lum = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return lum > 0.68 ? "#0F172A" : "#FFFFFF";
}
// The visible range for a view (end exclusive).
// The month view's scroller (all screen sizes): one continuous run of weeks covering the previous, current and next month
// (each week appears once, so the days either side of a month never show twice). `starts` are the row
// indexes of the week holding each month's 1st — the snap points, with 6 rows showing at a time.
function mobileMonthWeeks(cursor: Date): { weeks: Date[]; starts: [number, number, number]; months: [Date, Date, Date] } {
  const cur = startOfMonth(cursor);
  const prev = startOfMonth(cursor);
  prev.setMonth(prev.getMonth() - 1);
  const next = startOfMonth(cursor);
  next.setMonth(next.getMonth() + 1);
  const first = startOfWeek(prev);
  const rowOf = (m: Date) => Math.round((startOfWeek(m).getTime() - first.getTime()) / (7 * DAY_MS));
  const starts: [number, number, number] = [0, rowOf(cur), rowOf(next)];
  const weeks = Array.from({ length: starts[2] + 6 }, (_, i) => addDays(first, i * 7));
  return { weeks, starts, months: [prev, cur, next] };
}

// Phones' day / week swipe (onDaySwipeMove), once the view under the finger has changed: the new day (week)
// placed beside the copy of the one it started on, where the drag has got to — or, after a drag that sprang
// back, the copy gone now the day (week) it started on is showing again.
function placeDaySwipeView(wrap: HTMLElement | null, drag: { dir: number; dist: number; dx: number } | undefined, reverted: HTMLElement | null) {
  const first = wrap?.firstElementChild as HTMLElement | null;
  const live = first && !first.dataset.calSlideGhost ? first : null;
  if (drag && live) live.style.transform = `translateX(${drag.dir * drag.dist + drag.dx}px)`;
  if (reverted) {
    reverted.remove();
    if (live) live.style.transform = "";
    if (wrap) wrap.style.overflow = "";
  }
}

function viewRange(view: CalendarView, cursor: Date): { from: Date; to: Date } {
  if (view === "year") {
    // 12 months starting with the cursor's month (a rolling year, like Teamup), plus the 12 either side
    // that the year view's continuous scroller also holds.
    const from = startOfMonth(cursor);
    from.setMonth(from.getMonth() - 12);
    const to = startOfMonth(cursor);
    to.setMonth(to.getMonth() + 24);
    return { from, to };
  }
  if (view === "month") {
    // The month plus the ones either side, so swiping to the next/previous month (mobile) shows its
    // events straight away.
    const prev = startOfMonth(cursor);
    prev.setMonth(prev.getMonth() - 1);
    const next = startOfMonth(cursor);
    next.setMonth(next.getMonth() + 1);
    return { from: startOfWeek(prev), to: addDays(startOfWeek(next), 42) };
  }
  if (view === "week") {
    const from = startOfWeek(cursor);
    return { from, to: addDays(from, 7) };
  }
  if (view === "day") {
    const from = startOfDay(cursor);
    return { from, to: addDays(from, 1) };
  }
  const from = startOfDay(cursor);
  return { from, to: addDays(from, LIST_DAYS) };
}
// The year view's pinned weekday-letter row, which month rows scroll in under.
function yearHeaderHeight(scroller: HTMLElement): number {
  return scroller.querySelector<HTMLElement>("[data-year-header]")?.offsetHeight ?? 0;
}

function overlapsDay(e: CalendarEvent, day: Date) {
  const s = startOfDay(day).getTime();
  return e.startMs < s + DAY_MS && e.endMs > s;
}

// Side-by-side layout for overlapping timed events within one day column.
function layoutDay(segments: Array<{ event: CalendarEvent; start: number; end: number }>) {
  const sorted = [...segments].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Array<{ event: CalendarEvent; start: number; end: number; lane: number; lanes: number }> = [];
  let cluster: typeof out = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    cluster.forEach((c) => (c.lanes = lanes));
    out.push(...cluster);
    cluster = [];
  };
  for (const seg of sorted) {
    if (seg.start >= clusterEnd && cluster.length) flush();
    const laneEnds: number[] = [];
    cluster.forEach((c) => (laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? -Infinity, c.end)));
    let lane = laneEnds.findIndex((end) => end <= seg.start);
    if (lane < 0) lane = laneEnds.length;
    cluster.push({ ...seg, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, seg.end);
  }
  if (cluster.length) flush();
  return out;
}

// All-day events and anything running across more than one day draw as one continuous bar across
// the days they cover (month view, and the all-day row of week/day view), not a piece per day.
function isBarEvent(e: CalendarEvent) {
  return e.allDay || startOfDay(e.startMs).getTime() !== startOfDay(e.endMs - 1).getTime();
}
type BarSlot = { event: CalendarEvent; startCol: number; endCol: number; lane: number; contBefore: boolean; contAfter: boolean };
// Lays the events of one row of `cols` days (starting rowStart) into stacked lanes, top to bottom in
// category order (rank = the category's position in Company Settings). Each event takes the highest lane
// free across all its days, so on any one day an event never sits above one from an earlier category.
// withSingleDay: also lay out single-day timed events (month view); otherwise just the bar events.
// dayCols: which day (days after rowStart) each column is, when some days are left out (Company Settings >
// Calendar, non-work days hidden); otherwise column n is rowStart + n. An event across a left-out day draws
// straight across the gap; one only on left-out days isn't shown.
function layoutBars(
  rowStart: Date,
  cols: number,
  evs: CalendarEvent[],
  rank: (e: CalendarEvent) => number,
  withSingleDay = false,
  dayCols?: number[],
): { bars: BarSlot[]; lanes: number } {
  const rowStartMs = startOfDay(rowStart).getTime();
  const dayOf = (ms: number) => Math.round((startOfDay(ms).getTime() - rowStartMs) / DAY_MS);
  const shown = dayCols ?? Array.from({ length: cols }, (_, i) => i);
  const items = evs
    .filter((e) => withSingleDay || isBarEvent(e))
    .map((event) => {
      const first = dayOf(event.startMs);
      const last = isBarEvent(event) ? dayOf(event.endMs - 1) : first;
      // The first and last columns showing a day the event covers.
      const startCol = shown.findIndex((day) => day >= first);
      let endCol = -1;
      for (let c = shown.length - 1; c >= 0; c--) {
        if (shown[c] <= last) {
          endCol = c;
          break;
        }
      }
      return { event, first, last, startCol, endCol };
    })
    .filter((it) => it.startCol >= 0 && it.endCol >= it.startCol)
    .sort(
      (a, b) =>
        rank(a.event) - rank(b.event) ||
        a.startCol - b.startCol ||
        Number(isBarEvent(b.event)) - Number(isBarEvent(a.event)) ||
        b.endCol - b.startCol - (a.endCol - a.startCol) ||
        a.event.startMs - b.event.startMs,
    );
  const taken: boolean[][] = [];
  const bars: BarSlot[] = items.map((it) => {
    let lane = 0;
    const free = (l: number) => {
      for (let c = it.startCol; c <= it.endCol; c++) if (taken[l]?.[c]) return false;
      return true;
    };
    while (!free(lane)) lane++;
    taken[lane] = taken[lane] ?? [];
    for (let c = it.startCol; c <= it.endCol; c++) taken[lane][c] = true;
    // Square ends where the event carries on past the first/last day shown (before/after this row, or
    // into a left-out day).
    return { event: it.event, startCol: it.startCol, endCol: it.endCol, lane, contBefore: it.first < shown[it.startCol], contAfter: it.last > shown[it.endCol] };
  });
  return { bars, lanes: taken.length };
}
// Every day of a Monday-start week, as offsets from the Monday (0 = Monday … 6 = Sunday).
const ALL_WEEK_COLS = [0, 1, 2, 3, 4, 5, 6];
// One event "slot" in the week and day views' all-day row: an 18px event plus a 2px gap.
const BAR_H = 20;
// One in a month day — tighter: a 16px event plus a 2px gap.
const MONTH_SLOT_H = 18;
const MONTH_SLOT_GAP = 2;
const PREVIEW_SUFFIX = "__preview";

// The next half-hour mark from now — where "New event" starts.
function nextHalfHourMs(): number {
  const now = Date.now();
  return now - (now % (30 * 60000)) + 30 * 60000;
}

// e.g. "Monday 6 Oct 2026 · 9:00am – 10:30am", "Mon 6 Oct – Wed 8 Oct 2026 · All day".
function eventWhenText(e: CalendarEvent, fmtDate: (d: Date) => string): { primary: string; secondary: string } {
  const weekday = (ms: number, style: "long" | "short") => new Intl.DateTimeFormat(undefined, { weekday: style }).format(new Date(ms));
  const lastDayMs = e.allDay ? e.endMs - DAY_MS : e.endMs;
  const oneDay = startOfDay(e.startMs).getTime() === startOfDay(e.allDay ? lastDayMs : e.endMs - 1).getTime();
  if (oneDay) {
    return {
      primary: `${weekday(e.startMs, "long")} ${fmtDate(new Date(e.startMs))}`,
      secondary: e.allDay ? "All day" : `${timeText(e.startMs)} – ${timeText(e.endMs)}`,
    };
  }
  if (e.allDay) {
    const days = Math.round((startOfDay(lastDayMs).getTime() - startOfDay(e.startMs).getTime()) / DAY_MS) + 1;
    return {
      primary: `${weekday(e.startMs, "short")} ${fmtDate(new Date(e.startMs))} – ${weekday(lastDayMs, "short")} ${fmtDate(new Date(lastDayMs))}`,
      secondary: `All day · ${days} days`,
    };
  }
  return {
    primary: `${weekday(e.startMs, "short")} ${fmtDate(new Date(e.startMs))}, ${timeText(e.startMs)}`,
    secondary: `until ${weekday(e.endMs, "short")} ${fmtDate(new Date(e.endMs))}, ${timeText(e.endMs)}`,
  };
}

// Today, lightly in the brand blue — lighter than a day's "+2 more" pill (--brand-soft).
const TODAY_TINT = "color-mix(in srgb, var(--brand) 6%, transparent)";
// Today's outline: the brand blue, a step heavier than the calendar's 1px lines (inset — the sides of a column as
// TODAY_SIDES, the top or bottom added where it starts or ends).
const TODAY_RING = "inset 0 0 0 2px var(--brand)";
const TODAY_SIDES = "inset 2px 0 0 var(--brand), inset -2px 0 0 var(--brand)";

type Draft = {
  id: string;
  isNew: boolean;
  title: string;
  categoryId: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  notes: string;
  projectId: string;
  projectName: string;
  showToClient: boolean;
  createdByUid: string;
  createdByName: string;
  createdAtIso: string;
  updatedAtIso: string;
  updatedByUid: string;
  updatedByName: string;
  // Its staff — null for one saved before events had staff (see CalendarEvent's staffUids and draftStaffUids).
  staffUids: string[] | null;
};

function draftFromEvent(e: CalendarEvent): Draft {
  // All-day end is exclusive internally; the form shows the last day.
  const endShown = e.allDay ? Math.max(e.startMs, e.endMs - DAY_MS) : e.endMs;
  return {
    id: e.id,
    isNew: false,
    title: e.title,
    categoryId: e.categoryId,
    allDay: e.allDay,
    startDate: toDateInput(e.startMs),
    startTime: toTimeInput(e.startMs),
    endDate: toDateInput(endShown),
    endTime: toTimeInput(e.endMs),
    location: e.location,
    notes: e.notes,
    projectId: e.projectId,
    projectName: e.projectName,
    showToClient: e.showToClient,
    createdByUid: e.createdByUid,
    createdByName: e.createdByName,
    createdAtIso: e.createdAtIso,
    updatedAtIso: e.updatedAtIso,
    updatedByUid: e.updatedByUid,
    updatedByName: e.updatedByName,
    staffUids: e.staffUids,
  };
}

// Whether any field of two drafts differs (all are plain values, but the staff list).
function draftsDiffer(a: Draft, b: Draft): boolean {
  return (Object.keys(a) as Array<keyof Draft>).some((key) =>
    key === "staffUids" ? (a.staffUids ?? []).join(",") !== (b.staffUids ?? []).join(",") || !a.staffUids !== !b.staffUids : a[key] !== b[key],
  );
}

function eventFromDraft(d: Draft): CalendarEvent | null {
  let startMs: number;
  let endMs: number;
  if (d.allDay) {
    startMs = fromDateTimeInputs(d.startDate, "00:00");
    endMs = addDays(fromDateTimeInputs(d.endDate || d.startDate, "00:00"), 1).getTime();
  } else {
    startMs = fromDateTimeInputs(d.startDate, d.startTime);
    endMs = fromDateTimeInputs(d.endDate || d.startDate, d.endTime);
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs <= startMs) endMs = d.allDay ? startMs + DAY_MS : startMs + 60 * 60 * 1000;
  return {
    id: d.id,
    title: d.title.trim() || "Untitled event",
    categoryId: d.categoryId,
    allDay: d.allDay,
    startMs,
    endMs,
    location: d.location.trim(),
    notes: d.notes,
    projectId: d.projectId,
    projectName: d.projectName,
    // Only meaningful with a linked project.
    showToClient: Boolean(d.projectId) && d.showToClient,
    createdByUid: d.createdByUid,
    createdByName: d.createdByName,
    // A new one is added now; saveCalendarEvent sets updatedAtIso.
    createdAtIso: d.isNew ? new Date().toISOString() : d.createdAtIso,
    updatedAtIso: d.updatedAtIso,
    updatedByUid: d.updatedByUid,
    updatedByName: d.updatedByName,
    staffUids: d.staffUids,
  };
}

// Something taken off, put back where it was (the Undo bar).
function insertAt<T>(list: T[], index: number, item: T): T[] {
  const at = Math.min(Math.max(index, 0), list.length);
  return [...list.slice(0, at), item, ...list.slice(at)];
}

// A name's initials for a staff emblem ("?" without one).
function nameInitials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

// The time now, for event handlers (opening the event pop-up) — a module function, as the React Compiler lint
// takes a bare Date.now() in the component for a call during render.
function nowMs(): number {
  return Date.now();
}

// How long before asOfMs, for the event pop-up's "Added by" / "Modified by": "just now", then minutes until it's an
// hour, hours until it's a day, days until it's a week, weeks until it's a month, months until it's a year, then
// years. "" if unknown.
function timeAgo(iso: string, asOfMs: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.floor((asOfMs - at) / 60000));
  if (minutes < 1) return "just now";
  const days = Math.floor(minutes / (60 * 24));
  const [count, unit] =
    minutes < 60
      ? [minutes, "minute"]
      : minutes < 60 * 24
        ? [Math.floor(minutes / 60), "hour"]
        : days < 7
          ? [days, "day"]
          : days < 30
            ? [Math.floor(days / 7), "week"]
            : days < 365
              ? [Math.max(1, Math.floor(days / 30.44)), "month"]
              : [Math.floor(days / 365), "year"];
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

const cardStyle: CSSProperties = {
  borderColor: "var(--glass-border)",
  backgroundColor: "var(--glass-bg-strong)",
  backdropFilter: "blur(20px) saturate(180%)",
  WebkitBackdropFilter: "blur(20px) saturate(180%)",
  boxShadow: "inset 0 1px 0 var(--glass-highlight), var(--shadow-glass)",
};

// The event pop-up is themed by the event's category: a wash of its colour over the glass. The colour is a
// registered custom property, so it can be animated — picking another category fades the wash over to the
// new colour instead of snapping. Browsers without CSS.registerProperty just switch straight to it.
const POPUP_TINT_VAR = "--cal-popup-tint";
let popupTintRegistered = false;
function registerPopupTint() {
  if (popupTintRegistered || typeof CSS === "undefined" || typeof CSS.registerProperty !== "function") return;
  popupTintRegistered = true;
  try {
    CSS.registerProperty({ name: POPUP_TINT_VAR, syntax: "<color>", inherits: false, initialValue: "transparent" });
  } catch {
    // already registered (e.g. after a hot reload)
  }
}
// color "" = no category yet: no wash. The glass shine's look (lib/glass-shine.ts), well coloured: the whole pop-up a
// wash of it (lighter top left, deeper bottom right), a glow of it in each of those corners, a fine edge of it and the
// white top highlight.
function popupTintStyle(color: string): CSSProperties {
  const tint = `var(${POPUP_TINT_VAR})`;
  return {
    [POPUP_TINT_VAR]: color || "transparent",
    transition: `${POPUP_TINT_VAR} 360ms ease`,
    borderRadius: "inherit",
    backgroundImage: [
      `radial-gradient(120% 70% at 0% 0%, color-mix(in srgb, ${tint} 34%, transparent), transparent 70%)`,
      `radial-gradient(90% 60% at 100% 100%, color-mix(in srgb, ${tint} 24%, transparent), transparent 70%)`,
      `linear-gradient(145deg, color-mix(in srgb, ${tint} 14%, transparent), color-mix(in srgb, ${tint} 28%, transparent))`,
    ].join(", "),
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tint} 30%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.6)`,
  } as CSSProperties;
}
// The pop-up's main button (Edit / Save / Add event) in the category's colour.
function categoryButtonStyle(color: string): CSSProperties {
  return { backgroundColor: color, color: textOn(color), boxShadow: `0 6px 16px color-mix(in srgb, ${color} 35%, transparent)` };
}

// useSearchParams (for /calendar?event=<id>, opened from a calendar reminder) needs a Suspense boundary.
// A dropdown under a field in the event pop-up (the title's suggestions, the Project field's), floating over the top of
// the pop-up — on the page, fixed under the field — not inside it: never cut off by it, nor making it scroll as it pops
// out. It follows the field every frame while it's open (the pop-up growing in, scrolling, the window changing size), and
// opens upwards when there's more room above the field than the little below it. (Placed straight onto it, before it's
// drawn — nothing to render.)
const FLOAT_GAP = 6;
function FloatingUnderField({
  anchorRef,
  children,
  className,
  style,
  role,
  ariaLabel,
}: {
  anchorRef: { current: HTMLElement | null };
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  role?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current;
      const el = ref.current;
      if (!anchor || !el) return;
      const r = anchor.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - FLOAT_GAP - 12;
      const above = r.top - FLOAT_GAP - 12;
      const up = below < 180 && above > below;
      el.style.left = `${r.left}px`;
      el.style.width = `${r.width}px`;
      el.style.top = up ? "" : `${r.bottom + FLOAT_GAP}px`;
      el.style.bottom = up ? `${window.innerHeight - r.top + FLOAT_GAP}px` : "";
      el.style.maxHeight = `${Math.max(120, up ? above : below)}px`;
      el.style.transformOrigin = up ? "50% 100%" : "50% 0%";
    };
    let frame = 0;
    const follow = () => {
      place();
      frame = window.requestAnimationFrame(follow);
    };
    place();
    frame = window.requestAnimationFrame(follow);
    return () => window.cancelAnimationFrame(frame);
  }, [anchorRef]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref} role={role} aria-label={ariaLabel} className={`glass-bubble-pop fixed z-[1750] overflow-y-auto ${className ?? ""}`} style={style}>
      {children}
    </div>,
    document.body,
  );
}

// The Schedule panel's width (with the 12px gap before it, its padding).
const SCHEDULE_PANEL_W = 292;

// The Calendar's Schedule panel (beside the calendar, on a computer — the sidebar's Schedule a project): the company's
// projects and small jobs, to drag onto a day. Those with nothing on the calendar yet at the top, then those booked (with
// what's on now, their next date, or their last). Dropped, a new event opens on that day (at that time, in the Week and
// Day views' hours) linked to it, as if it was linked in the event's pop-up — to change from there, then add. Clicked: the
// same, on the day being looked at.
function ProjectSchedulePanel({
  projects,
  linkedEvents,
  loaded,
  onClose,
  onDragStart,
  onDragEnd,
  onPick,
}: {
  projects: Project[];
  linkedEvents: CalendarEvent[];
  loaded: boolean;
  onClose: () => void;
  onDragStart: (project: Project, e: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onPick: (project: Project, e: ReactMouseEvent<HTMLElement>) => void;
}) {
  const [search, setSearch] = useState("");
  const { unscheduled, scheduled } = useMemo(() => {
    const at = nowMs();
    // Each project's events: one on now, the soonest still to come, the latest gone.
    const booked = new Map<string, { current: boolean; next: number | null; last: number }>();
    for (const ev of linkedEvents) {
      const entry = booked.get(ev.projectId) ?? { current: false, next: null, last: 0 };
      if (ev.endMs <= at) entry.last = Math.max(entry.last, ev.startMs);
      else if (ev.startMs <= at) entry.current = true;
      else entry.next = entry.next == null ? ev.startMs : Math.min(entry.next, ev.startMs);
      booked.set(ev.projectId, entry);
    }
    const q = search.trim().toLowerCase();
    const shown = projects.filter((p) => !q || [p.name, p.customer, p.clientAddress].join(" ").toLowerCase().includes(q));
    return {
      // Newest first.
      unscheduled: shown.filter((p) => !booked.has(p.id)).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
      // On now, then what's coming soonest, then what's been longest since.
      scheduled: shown
        .flatMap((p) => {
          const entry = booked.get(p.id);
          return entry ? [{ project: p, ...entry }] : [];
        })
        .sort((a, b) => {
          const rank = (x: { current: boolean; next: number | null }) => (x.current ? 0 : x.next != null ? 1 : 2);
          if (rank(a) !== rank(b)) return rank(a) - rank(b);
          if (a.next != null && b.next != null) return a.next - b.next;
          return b.last - a.last;
        }),
    };
  }, [linkedEvents, projects, search]);

  const row = (p: Project, note: string) => {
    const color = p.isSmallJob ? SMALL_JOB_COLOR : "var(--brand)";
    return (
      <button
        key={p.id}
        // (The drag's pill grows out of it — beginProjectDrag.)
        id={`cal_schedule_${p.id}`}
        type="button"
        draggable
        onDragStart={(e) => onDragStart(p, e)}
        onDragEnd={onDragEnd}
        onClick={(e) => onPick(p, e)}
        title="Drag onto a day to schedule it"
        className="flex w-full min-w-0 cursor-grab items-center gap-2.5 rounded-[12px] px-2 py-1.5 text-left transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] active:cursor-grabbing"
      >
        <span
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
        >
          {p.isSmallJob ? <Hammer size={14} /> : <FolderKanban size={14} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>{p.name || "Untitled project"}</span>
          <span className="block truncate text-[11px]" style={{ color: "var(--text-muted)" }}>{note}</span>
        </span>
        <GripVertical size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
      </button>
    );
  };
  const sectionHeading = (title: string, count: number) => (
    <p className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.8px]" style={{ color: "var(--text-muted)" }}>
      {title}
      <span className="font-medium">{count}</span>
    </p>
  );
  const kindOf = (p: Project) => (p.isSmallJob ? "Small job" : "");
  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5 rounded-[20px] border p-3.5" style={cardStyle}>
      <div className="flex items-center gap-2 pl-1.5">
        <FolderKanban size={17} strokeWidth={2.1} style={{ color: "var(--text-main)" }} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold" style={{ color: "var(--text-main)" }}>Schedule</span>
        <button type="button" onClick={onClose} className={modalCloseButtonClass} aria-label="Close the Schedule panel">
          <X size={15} />
        </button>
      </div>
      <p className="px-1.5 text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>Drag a project or small job onto a day to book it in.</p>
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects"
          aria-label="Search projects"
          className={glassFieldClass}
          // Inline: glassFieldClass's px-3 beat a pl-… class.
          style={{ paddingLeft: 32 }}
        />
      </div>
      <div className="-mx-1.5 min-h-0 flex-1 overflow-y-auto px-1.5">
        {!loaded ? (
          <p className="px-2 py-3 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>Loading…</p>
        ) : unscheduled.length === 0 && scheduled.length === 0 ? (
          <p className="px-2 py-3 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>{search.trim() ? "No projects match." : "No projects yet."}</p>
        ) : (
          <>
            {unscheduled.length ? (
              <>
                {sectionHeading("Not scheduled", unscheduled.length)}
                {unscheduled.map((p) => row(p, [kindOf(p), p.customer].filter(Boolean).join(" · ") || "Nothing booked yet"))}
              </>
            ) : null}
            {scheduled.length ? (
              <>
                {sectionHeading("Scheduled", scheduled.length)}
                {scheduled.map(({ project: p, current, next, last }) =>
                  row(p, [current ? "On now" : next != null ? `Next ${activeDate(next)}` : `Last ${activeDate(last)}`, kindOf(p), p.customer].filter(Boolean).join(" · ")),
                )}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarPageContent />
    </Suspense>
  );
}

function CalendarPageContent() {
  const { user } = useAuth();
  // The Undo bar along the bottom, after an event's deleted or someone's taken off one (components/undo-bar.tsx).
  const offerUndo = useUndo();
  const access = useCompanyAccess();
  useCompanyFormats();
  const companyId = access.companyId;
  // calendar.edit is a dropped permission; old roles that still carry it can open the tab.
  const canView =
    access.status === "ready" &&
    (isOwnerOrAdmin(access.role) || hasPermissionKey(access.permissionKeys, "calendar.view") || hasPermissionKey(access.permissionKeys, "calendar.edit"));

  // Opened from the Calendar's own home-screen icon: just the calendar, without the app around it (no
  // sidebars, tab bar, pull-down menu or side drawers — AppShell drops them all while chromeHidden is on).
  // Not while access says this person can't see the calendar, so they aren't left on a dead end.
  const calendarApp = useCalendarAppMode();
  const chromeless = calendarApp && (access.status === "loading" || canView);
  const { setChromeHidden } = useAppTabs();
  // An event's project (its Open link). On a computer: a new Chrome tab, leaving the calendar here. It's
  // opened blank and then pointed at the project — with CutSmart installed as an app, Chrome sends a link
  // that opens one of its pages in a new tab to the app's own window instead ("link capturing"), which
  // was a whole new window. On a phone: the link as usual, in this tab.
  const openEventProject = (event: React.MouseEvent<HTMLAnchorElement>, projectId: string) => {
    if (isMobile || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const url = `/projects/${projectId}`;
    const tab = window.open("", "_blank");
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.open(url, "_blank", "noopener");
    }
  };
  // Before paint, so the tab bar and sidebar don't flash up for a frame as the app opens.
  useLayoutEffect(() => {
    if (!chromeless) return;
    setChromeHidden(true);
    return () => setChromeHidden(false);
  }, [chromeless, setChromeHidden]);

  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()));
  const [categories, setCategories] = useState<CalendarCategory[]>([]);
  // Company Settings > Calendar > Workdays. Other days are drawn hatched ("crossed out").
  const [workdays, setWorkdays] = useState<number[]>(DEFAULT_CALENDAR_WORKDAYS);
  // Company Settings > Calendar: when off, the month and week views leave the non-work days out.
  const [showNonWorkdays, setShowNonWorkdays] = useState(true);
  // Company Settings > Calendar > Public holidays: whose are shown (the region's, the national ones, or none).
  const [holidayRegion, setHolidayRegion] = useState<NzHolidayRegion>("nz");
  // Their own choice (User Settings > Preferences), over the company's above; null = "Company setting".
  const [myShowNonWorkdays, setMyShowNonWorkdays] = useState<boolean | null>(null);
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    void fetchUserCalendarShowNonWorkdays(user.uid).then((value) => {
      if (!cancelled) setMyShowNonWorkdays(value);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadError, setLoadError] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  // Company Settings > Calendar > Archive events after: 0 = never, else events that ended before this go.
  const [archiveCutoffMs, setArchiveCutoffMs] = useState(0);
  // Company Settings > Calendar > Client portal: "Show on client portal" starts on when linking a project.
  const [showToClientDefault, setShowToClientDefault] = useState(false);
  // Staff colours, for the "Added by" emblem in the event pop-up.
  const [memberColorByUid, setMemberColorByUid] = useState<Record<string, string>>({});
  // The company's staff, for the event pop-up's Staff section (who's on it, and Add staff).
  const [staffMembers, setStaffMembers] = useState<Array<{ uid: string; name: string }>>([]);

  // Per-person view + hidden categories, remembered on this device.
  useEffect(() => {
    // Restoring a device-local preference after mount (not during render) keeps server and client
    // renders identical.
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const v = window.localStorage.getItem(VIEW_STORAGE_KEY) as CalendarView | null;
      if (v && ["year", "month", "week", "day", "list"].includes(v)) setView(v);
      const h = JSON.parse(window.localStorage.getItem(HIDDEN_STORAGE_KEY) || "[]");
      if (Array.isArray(h)) setHidden(new Set(h.map(String)));
    } catch {
      // storage unavailable
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  const changeView = (next: CalendarView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };
  const toggleHidden = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Categories (company doc) and the company's projects (for linking).
  useEffect(() => {
    if (!companyId || !canView) return;
    let cancelled = false;
    void fetchCompanyDoc(companyId).then((docData) => {
      if (cancelled) return;
      setCategories(normalizeCalendarCategories((docData as Record<string, unknown> | null)?.calendarCategories));
      setWorkdays(normalizeCalendarWorkdays((docData as Record<string, unknown> | null)?.calendarWorkdays));
      setShowNonWorkdays(normalizeCalendarShowNonWorkdays((docData as Record<string, unknown> | null)?.calendarShowNonWorkdays));
      setHolidayRegion(normalizeNzHolidayRegion((docData as Record<string, unknown> | null)?.calendarHolidayRegion));
      const cutoff = calendarRetentionCutoffMs(normalizeCalendarRetention((docData as Record<string, unknown> | null)?.calendarEventRetention));
      setArchiveCutoffMs(cutoff);
      setShowToClientDefault((docData as Record<string, unknown> | null)?.calendarShowToClientDefault === true);
      if (cutoff) void archiveOldCalendarEvents(companyId, cutoff);
    });
    void fetchCompanyMembers(companyId).then((members) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const m of members) map[m.uid] = String(m.userColor || m.badgeColor || "").trim();
      setMemberColorByUid(map);
      setStaffMembers(
        members
          .map((m) => ({ uid: m.uid, name: String(m.displayName || m.email || "").trim() }))
          .filter((m) => m.uid && m.name)
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    });
    if (user?.uid) {
      // Archived projects too: events already linked to one keep their details (see restrictedIds) —
      // they're just not offered in the project picker any more.
      void fetchProjects(user.uid, [companyId], { lightweight: true, archived: "include" }).then((rows) => {
        if (cancelled) return;
        setProjects(rows.filter((p) => !p.deletedAt && (!p.companyId || p.companyId === companyId)));
        setProjectsLoaded(true);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [canView, companyId, user?.uid]);

  const range = useMemo(() => viewRange(view, cursor), [view, cursor]);
  useEffect(() => {
    if (!companyId || !canView) return;
    return subscribeCalendarEvents(
      companyId,
      range.from.getTime(),
      range.to.getTime(),
      (next) => {
        setEvents(next);
        setLoadError("");
      },
      () => setLoadError("Couldn't load events — check your connection."),
    );
  }, [canView, companyId, range.from, range.to]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const categoryOf = useCallback((e: CalendarEvent) => categoryById.get(e.categoryId) ?? UNCATEGORISED, [categoryById]);
  // Per-category access (Company Settings > Calendar > a category > Access). Owners/admins always edit;
  // otherwise the category's setting for this role, or View when it hasn't been set.
  const isAdmin = access.status === "ready" && isOwnerOrAdmin(access.role);
  const roleKey = normalizeRoleKey(access.roleId || access.role);
  // The same rule as Notifications' calendar reminders and the server's (lib/calendar-categories.ts).
  const levelOf = useCallback(
    (categoryId: string): CalendarAccessLevel =>
      calendarCategoryLevel(categoryById.get(categoryId), { isAdmin, roleKey, canViewCalendar: canView }),
    [canView, categoryById, isAdmin, roleKey],
  );
  // Events linked to a project this person can't open (fetchProjects only returns the ones they can) show
  // just the basics — title, time, category — and can't be edited. Until projects load, linked events
  // are treated as restricted so details never flash up.
  const accessibleProjectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  // An event's staff — for one saved before events had staff, its linked project's assignee, or its creator with no
  // one assigned (as the server counts them for its reminders).
  const draftStaffUids = (d: Pick<Draft, "staffUids" | "projectId">): string[] => d.staffUids ?? projectEventStaffUids(projectById.get(d.projectId));
  const restrictedIds = useMemo(
    () =>
      new Set(
        isAdmin
          ? []
          : events.filter((e) => e.projectId && (!projectsLoaded || !accessibleProjectIds.has(e.projectId))).map((e) => e.id),
      ),
    [accessibleProjectIds, events, isAdmin, projectsLoaded],
  );
  const canEditEvent = (event: { id: string; categoryId: string }) => levelOf(event.categoryId) === "edit" && !restrictedIds.has(event.id);
  const editableCategories = categories.filter((cat) => levelOf(cat.id) === "edit");
  // Can add events at all: there's a category they can edit (or no categories, with the edit permission).
  const canCreate = isAdmin || editableCategories.length > 0;
  // Events run top to bottom in the order the categories are listed in Company Settings > Calendar.
  const categoryRank = useMemo(() => new Map(categories.map((c, i) => [c.id, i])), [categories]);
  const rankOf = useCallback((e: CalendarEvent) => categoryRank.get(e.categoryId) ?? categories.length, [categories.length, categoryRank]);
  // Live preview while dragging in week/day view.
  const [dragPreview, setDragPreview] = useState<{ id: string; startMs: number; endMs: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  // The view switcher's height (Segmented lg on a phone, sm otherwise) — the search button beside it is a
  // circle that size.
  const searchPillPx = isMobile ? 40 : 34;
  // The toolbar's search (the round button beside the view switcher): only events whose title, location, notes,
  // project or category has it — checked after what they can't see is cleared, so it can't find that. Only while
  // it's open. With something typed it stays open, so the calendar can be browsed for what was found: a tap
  // anywhere else just puts the keyboard away. Its X clears and closes it; once it's empty (the X, or the text
  // deleted), a tap anywhere else closes it. What was typed is kept for when it's opened again — this browser
  // session, even after leaving the calendar (sessionStorage).
  const [isEventSearchOpen, setIsEventSearchOpen] = useState(false);
  const [eventSearch, setEventSearch] = useState("");
  const eventSearchInputRef = useRef<HTMLInputElement | null>(null);
  const eventSearchRowRef = useRef<HTMLDivElement | null>(null);
  const changeEventSearch = (text: string) => {
    setEventSearch(text);
    try {
      if (text) window.sessionStorage.setItem(EVENT_SEARCH_STORAGE_KEY, text);
      else window.sessionStorage.removeItem(EVENT_SEARCH_STORAGE_KEY);
    } catch {
      // no storage — kept until the page is left
    }
  };
  const openEventSearch = () => {
    if (!eventSearch) {
      try {
        const kept = window.sessionStorage.getItem(EVENT_SEARCH_STORAGE_KEY);
        if (kept) setEventSearch(kept);
      } catch {
        // no storage
      }
    }
    setIsEventSearchOpen(true);
    // In the tap itself, so a phone brings up its keyboard.
    eventSearchInputRef.current?.focus({ preventScroll: true });
  };
  // Its X: cleared and closed. A tap elsewhere (or Escape): closed if it's empty — with something in it, it stays
  // open (and searching), just without the keyboard.
  const closeEventSearch = (clear: boolean) => {
    if (clear) changeEventSearch("");
    setIsEventSearchOpen(false);
    eventSearchInputRef.current?.blur();
  };
  const leaveEventSearch = () => {
    if (eventSearch.trim()) eventSearchInputRef.current?.blur();
    else closeEventSearch(false);
  };
  const leaveEventSearchRef = useRef(leaveEventSearch);
  useEffect(() => {
    leaveEventSearchRef.current = leaveEventSearch;
  });
  useEffect(() => {
    if (!isEventSearchOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (eventSearchRowRef.current?.contains(event.target as Node)) return;
      leaveEventSearchRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [isEventSearchOpen]);
  // A phone's search only filters while it's open; a computer's is always open.
  const eventSearchTerm = isEventSearchOpen || !isMobile ? eventSearch.trim().toLowerCase() : "";
  const visibleEvents = useMemo(
    () =>
      events
        .filter((e) => !hidden.has(categoryOf(e).id) && levelOf(e.categoryId) !== "none" && !(archiveCutoffMs && e.endMs <= archiveCutoffMs))
        .map((e) => (restrictedIds.has(e.id) ? { ...e, location: "", notes: "", projectId: "", projectName: "" } : e))
        .filter((e) => !eventSearchTerm || `${e.title} ${e.location} ${e.notes} ${e.projectName} ${categoryOf(e).name}`.toLowerCase().includes(eventSearchTerm))
        .map((e) => (dragPreview && dragPreview.id === e.id ? { ...e, startMs: dragPreview.startMs, endMs: dragPreview.endMs } : e))
        .sort((a, b) => rankOf(a) - rankOf(b) || Number(b.allDay) - Number(a.allDay) || a.startMs - b.startMs || b.endMs - a.endMs),
    [archiveCutoffMs, categoryOf, dragPreview, eventSearchTerm, events, hidden, levelOf, rankOf, restrictedIds],
  );

  // ---------------------------------------------------------------- event pop-up
  const [draft, setDraft] = useState<Draft | null>(null);
  const [modalOrigin, setModalOrigin] = useState<GlassModalOrigin>(null);
  const modalPanelRef = useRef<HTMLDivElement | null>(null);
  const shouldRenderModal = useGlassModalPopOrigin(Boolean(draft), modalOrigin, modalPanelRef);
  // What the pop-up shows while it animates closed (draft is already null by then).
  const [renderedDraft, setRenderedDraft] = useState<Draft | null>(null);
  // When the pop-up was opened: its "Added by" / "Modified by" times are as of then, not updated while it's open.
  const [popupOpenedAtMs, setPopupOpenedAtMs] = useState(0);
  // A new event (New event or Duplicate) as it was when it opened — to tell whether it's been changed since.
  const [newDraftStart, setNewDraftStart] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The pop-up and the events as they are now — for an Undo pressed after they've moved on.
  const draftRef = useRef(draft);
  const eventsRef = useRef(events);
  useEffect(() => {
    draftRef.current = draft;
    eventsRef.current = events;
  });
  const [projectQuery, setProjectQuery] = useState("");
  // The new event whose title has already been focused (so re-renders don't steal focus back).
  const focusedDraftIdRef = useRef("");
  // The projects its title sounds like (under the title, while no project's linked): the one picked with the arrow keys,
  // and the event they've been put away for ("Not now").
  const [titleSuggestIndex, setTitleSuggestIndex] = useState(-1);
  const [titleSuggestDismissedFor, setTitleSuggestDismissedFor] = useState("");
  // The new event whose title has been left once (its suggestions don't come back after), and the one whose Project
  // field is in use (its dropdown showing).
  const [titleLeftFor, setTitleLeftFor] = useState("");
  const [projectFieldFor, setProjectFieldFor] = useState("");
  // The new event whose title has been typed in (left before that — the pop-up opening — doesn't count), and the one whose
  // Project dropdown is showing every project (Show all).
  const [titleTypedFor, setTitleTypedFor] = useState("");
  const [projectFieldShowAllFor, setProjectFieldShowAllFor] = useState("");
  // The new event whose title's suggestions are showing every project too (their Show all — until the title changes).
  const [titleSuggestShowAllFor, setTitleSuggestShowAllFor] = useState("");
  // The title and the Project field — what their dropdowns float under (FloatingUnderField).
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const projectFieldInputRef = useRef<HTMLInputElement | null>(null);
  // Clicking an event opens it read-only ("view"); Edit switches the same pop-up to the form.
  const [eventMode, setEventMode] = useState<"view" | "edit">("edit");
  // Lets the pop-up's category wash fade between colours (popupTintStyle).
  useEffect(() => registerPopupTint(), []);

  // New event (the + / New event button): all day, on the day being looked at in the Day view, otherwise
  // today — with the next half hour as its time if All day is switched off.
  const newEventStartMs = () => {
    const nextMs = nextHalfHourMs();
    if (view !== "day" || startOfDay(cursor).getTime() === startOfDay(new Date()).getTime()) return nextMs;
    const next = new Date(nextMs);
    const onDay = new Date(cursor);
    onDay.setHours(next.getHours(), next.getMinutes(), 0, 0);
    return onDay.getTime();
  };

  // Linking a project to the event (from its search, from what its title sounds like, or by dropping it from the Schedule
  // panel): its people go on as staff (its assignee — its creator, with no one assigned), its address as where it is if
  // there's none yet, and its name as the title only if there's no title — the title typed stays as it is.
  const withProjectLinked = (prev: Draft, p: Project): Draft => ({
    ...prev,
    projectId: p.id,
    projectName: p.name,
    showToClient: showToClientDefault,
    staffUids: Array.from(new Set([...draftStaffUids(prev), ...projectEventStaffUids(p)])),
    title: prev.title || p.name,
    location: prev.location || String(p.clientAddress || ""),
  });
  // project: a project dropped on the day (or clicked) in the Schedule panel — the new event opens linked to it.
  const openNew = (
    startMs: number,
    allDay: boolean,
    e?: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement> | ReactDragEvent<HTMLElement>,
    project?: Project,
  ) => {
    if (!canCreate) return;
    // An all-day event ends the same day; its times (used if All day is switched off) still span an hour.
    const timedEndMs = startMs + 60 * 60 * 1000;
    const endMs = allDay ? startMs : timedEndMs;
    setModalOrigin(e ? captureGlassModalOrigin(e as ReactMouseEvent<HTMLElement>) : null);
    setModalError("");
    setConfirmDelete(false);
    setProjectQuery("");
    setEventMode("edit");
    const blank: Draft = {
      id: newCalendarId("evt"),
      isNew: true,
      title: "",
      // None to start with: they choose one (it's needed to add it).
      categoryId: "",
      allDay,
      startDate: toDateInput(startMs),
      startTime: toTimeInput(startMs),
      endDate: toDateInput(endMs),
      endTime: toTimeInput(timedEndMs),
      location: "",
      notes: "",
      projectId: "",
      projectName: "",
      showToClient: false,
      createdByUid: String(user?.uid || ""),
      createdByName: String(user?.displayName || ""),
      createdAtIso: "",
      updatedAtIso: "",
      updatedByUid: "",
      updatedByName: "",
      staffUids: [],
    };
    const next = project ? withProjectLinked(blank, project) : blank;
    setDraft(next);
    setRenderedDraft(next);
    setNewDraftStart(next);
    setPopupOpenedAtMs(nowMs());
  };
  const openExisting = (event: CalendarEvent, e?: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>) => {
    setModalOrigin(e ? captureGlassModalOrigin(e as ReactMouseEvent<HTMLElement>) : null);
    setModalError("");
    setConfirmDelete(false);
    setProjectQuery("");
    setEventMode("view");
    const next = draftFromEvent(event);
    setDraft(next);
    setRenderedDraft(next);
    setPopupOpenedAtMs(nowMs());
  };
  const closeModal = () => setDraft(null);
  // A new event (New event or Duplicate) that's been filled in or changed since it opened (a project search typed
  // counts too): clicking off it, or Escape, doesn't close it then — only its X or Cancel — so nothing typed is lost
  // by accident. Changed back to how it opened, it closes on a click off again.
  const newDraftEdited = Boolean(draft?.isNew && newDraftStart && (projectQuery.trim() !== "" || draftsDiffer(draft, newDraftStart)));
  const closeModalUnlessEdited = () => {
    if (!newDraftEdited) closeModal();
  };

  // /calendar?event=<id> (a calendar reminder notification, or the bell's entry for one): go to that
  // event's day and open it, then tidy the address so a reload doesn't open it again.
  const eventParam = useSearchParams().get("event") || "";
  useEffect(() => {
    if (!eventParam || !companyId) return;
    let cancelled = false;
    void fetchCalendarEvent(companyId, eventParam).then((event) => {
      if (cancelled) return;
      window.history.replaceState(window.history.state, "", window.location.pathname);
      if (!event) return;
      setCursor(startOfDay(new Date(event.startMs)));
      // What openExisting does (without a button to grow from).
      setModalOrigin(null);
      setModalError("");
      setConfirmDelete(false);
      setProjectQuery("");
      setEventMode("view");
      const next = draftFromEvent(event);
      setDraft(next);
      setRenderedDraft(next);
      setPopupOpenedAtMs(nowMs());
    });
    return () => {
      cancelled = true;
    };
  }, [eventParam, companyId]);
  // An existing event as changed by them: "Modified by <them>" (saveCalendarEvent stamps the time).
  const editedByMe = (event: CalendarEvent): CalendarEvent => ({
    ...event,
    updatedByUid: String(user?.uid || ""),
    updatedByName: String(user?.displayName || ""),
  });
  const submitDraft = async () => {
    if (!draft || !companyId) return;
    // Every event needs a title and a category (adding one or saving changes).
    const needsTitle = !draft.title.trim();
    const needsCategory = !draft.categoryId;
    if (needsTitle || needsCategory) {
      setModalError(
        needsCategory && editableCategories.length === 0
          ? "Add a category in Company Settings > Calendar first."
          : needsTitle && needsCategory
            ? "Add a title and choose a category."
            : needsTitle
              ? "Add a title."
              : "Choose a category.",
      );
      return;
    }
    if (!canEditEvent(draft)) return;
    const event = eventFromDraft({ ...draft, staffUids: draftStaffUids(draft) });
    if (!event) {
      setModalError("Check the dates and times.");
      return;
    }
    setSaving(true);
    setModalError("");
    const result = await saveCalendarEvent(companyId, draft.isNew ? event : editedByMe(event));
    setSaving(false);
    if (!result.ok) {
      setModalError(result.error === "permission-denied" ? "You don't have permission to save events." : "Couldn't save — try again.");
      return;
    }
    closeModal();
  };
  // The event pop-up's … > Duplicate: a new event with this one's details — title, times, location, notes,
  // project — but no category (they choose one), opened ready to add.
  const duplicateDraft = () => {
    if (!draft || !canCreate) return;
    setModalError("");
    setConfirmDelete(false);
    setProjectQuery("");
    setEventMode("edit");
    const next: Draft = {
      ...draft,
      id: newCalendarId("evt"),
      isNew: true,
      categoryId: "",
      staffUids: draftStaffUids(draft),
      createdByUid: String(user?.uid || ""),
      createdByName: String(user?.displayName || ""),
      createdAtIso: "",
      updatedAtIso: "",
      updatedByUid: "",
      updatedByName: "",
    };
    setDraft(next);
    setRenderedDraft(next);
    setNewDraftStart(next);
    setPopupOpenedAtMs(nowMs());
  };
  // Deleting the event (asks first) — and the Undo bar, bringing it back exactly as it was: its whole doc, kept as it's
  // deleted (lib/undo-restore-leads-calendar.ts), or what the calendar had of it should that not have been read.
  const removeDraft = async () => {
    if (!draft || !companyId || !canEditEvent(draft)) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const shown = events.find((e) => e.id === draft.id) ?? null;
    setSaving(true);
    const result = await deleteCalendarEventKeepingCopy(companyId, draft.id);
    setSaving(false);
    if (!result.ok) {
      setModalError("Couldn't delete — try again.");
      return;
    }
    closeModal();
    const { saved } = result;
    offerUndo(`${draft.title.trim() || "Event"} deleted`, async () => {
      const ok = saved ? await restoreCalendarEventDoc(saved) : shown ? (await saveCalendarEvent(companyId, shown)).ok : false;
      if (!ok) throw new Error("couldn't restore the event");
    });
  };
  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !newDraftEdited && !document.querySelector('[data-glass-dropdown-menu="true"]')) setDraft(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [draft, newDraftEdited]);

  // Moving an event to new times (drag in any view).
  const moveEvent = async (event: CalendarEvent, startMs: number, endMs: number) => {
    if (!companyId || !canEditEvent(event)) return;
    setEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, startMs, endMs } : e)));
    const result = await saveCalendarEvent(companyId, editedByMe({ ...event, startMs, endMs }));
    if (!result.ok) setLoadError("Couldn't move that event — try again.");
  };

  // The event view's bell: subscribes whoever's looking (anyone — they don't need to be on it) so they're reminded
  // before it at their own reminder times (User Settings), or unsubscribes them. Saves straight away.
  const [subscribingEventId, setSubscribingEventId] = useState("");
  // Bumped by each click on it — its wobble (as the project's own bell); 0: never clicked, so opening doesn't play it.
  const [eventBellWobbleKey, setEventBellWobbleKey] = useState(0);
  const setEventSubscribed = async (eventId: string, on: boolean) => {
    const me = String(user?.uid || "").trim();
    if (!companyId || !me || subscribingEventId) return;
    const apply = (value: boolean) =>
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? { ...e, subscriberUids: value ? Array.from(new Set([...(e.subscriberUids ?? []), me])) : (e.subscriberUids ?? []).filter((id) => id !== me) }
            : e,
        ),
      );
    setSubscribingEventId(eventId);
    apply(on);
    const ok = await setCalendarEventSubscribed(companyId, eventId, me, on);
    if (!ok) {
      apply(!on);
      setModalError(on ? "Couldn't subscribe you to it — try again." : "Couldn't unsubscribe you — try again.");
    }
    setSubscribingEventId("");
  };

  // The event view's "Show on client portal" switch: saves straight away, without opening Edit.
  const setEventShowToClient = async (eventId: string, on: boolean) => {
    const event = events.find((e) => e.id === eventId);
    if (!companyId || !event || !event.projectId || !canEditEvent(event)) return;
    const apply = (value: boolean) => {
      setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, showToClient: value } : e)));
      setDraft((prev) => (prev && prev.id === eventId ? { ...prev, showToClient: value } : prev));
      setRenderedDraft((prev) => (prev && prev.id === eventId ? { ...prev, showToClient: value } : prev));
    };
    apply(on);
    const edited = editedByMe({ ...event, showToClient: on });
    const result = await saveCalendarEvent(companyId, edited);
    if (!result.ok) {
      apply(event.showToClient);
      setModalError("Couldn't update the client portal setting — try again.");
      return;
    }
    // The open pop-up's "Modified by" line.
    const stamp = (prev: Draft | null) =>
      prev && prev.id === eventId ? { ...prev, updatedByUid: edited.updatedByUid, updatedByName: edited.updatedByName, updatedAtIso: new Date().toISOString() } : prev;
    setDraft(stamp);
    setRenderedDraft(stamp);
  };

  // The days of the week the month and week views show as columns (offsets from Monday). All seven, unless
  // non-work days are switched off in Company Settings > Calendar (and there's at least one workday).
  const weekCols = useMemo(() => {
    if (myShowNonWorkdays ?? showNonWorkdays) return ALL_WEEK_COLS;
    const cols = ALL_WEEK_COLS.filter((i) => workdays.includes((i + 1) % 7));
    return cols.length ? cols : ALL_WEEK_COLS;
  }, [myShowNonWorkdays, showNonWorkdays, workdays]);
  const isLeftOutDay = (day: Date) => !weekCols.includes((day.getDay() + 6) % 7);

  // ---------------------------------------------------------------- navigation
  // Previous / Next slide the view sideways — the next day, week, month, list or year in from the right, the previous
  // from the left — on phones and computers alike. The outgoing view is a static copy of the current DOM that slides
  // out while the new one slides in (see the effect below). (Scrolling a month or year view still moves up and down.)
  const viewWrapRef = useRef<HTMLDivElement | null>(null);
  const pendingSlideRef = useRef<{ ghost: HTMLElement; axis: "x" | "y"; dir: -1 | 1 } | null>(null);
  // A static copy of the current view, laid over it in viewWrapRef: the outgoing side of a slide.
  const makeSlideGhost = () => {
    const wrap = viewWrapRef.current;
    if (!wrap) return null;
    wrap.querySelectorAll("[data-cal-slide-ghost]").forEach((el) => el.remove());
    const live = wrap.firstElementChild as HTMLElement | null;
    if (!live) return null;
    const ghost = live.cloneNode(true) as HTMLElement;
    // Keep inner scroll positions (e.g. the week grid scrolled to the morning).
    const from = live.querySelectorAll<HTMLElement>("*");
    const to = ghost.querySelectorAll<HTMLElement>("*");
    from.forEach((el, i) => {
      if (el.scrollTop > 0 && to[i]) to[i].dataset.calScrollTop = String(el.scrollTop);
    });
    ghost.dataset.calSlideGhost = "true";
    ghost.setAttribute("aria-hidden", "true");
    ghost.removeAttribute("id");
    Object.assign(ghost.style, { position: "absolute", top: "0", left: "0", width: `${live.offsetWidth}px`, height: `${live.offsetHeight}px`, pointerEvents: "none" });
    wrap.appendChild(ghost);
    ghost.querySelectorAll<HTMLElement>("[data-cal-scroll-top]").forEach((el) => (el.scrollTop = Number(el.dataset.calScrollTop)));
    return ghost;
  };
  // (Not with reduced motion: then the view just changes.)
  const beginSlide = (dir: -1 | 1) => {
    const wrap = viewWrapRef.current;
    if (!wrap || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ghost = makeSlideGhost();
    if (!ghost) return;
    pendingSlideRef.current = { ghost, axis: "x", dir };
  };
  useLayoutEffect(() => {
    const slide = pendingSlideRef.current;
    if (!slide) return;
    pendingSlideRef.current = null;
    const wrap = viewWrapRef.current;
    const live = wrap?.firstElementChild as HTMLElement | null;
    if (!wrap || !live || live === slide.ghost) {
      slide.ghost.remove();
      return;
    }
    const dist = (slide.axis === "y" ? wrap.clientHeight : wrap.clientWidth) + 18;
    const move = (v: number) => (slide.axis === "y" ? `translateY(${v}px)` : `translateX(${v}px)`);
    const timing = { duration: 420, easing: "cubic-bezier(0.22, 0.8, 0.24, 1)" };
    wrap.style.overflow = "hidden";
    live.animate([{ transform: move(dist * slide.dir) }, { transform: move(0) }], timing);
    const out = slide.ghost.animate([{ transform: move(0) }, { transform: move(-dist * slide.dir) }], { ...timing, fill: "forwards" });
    out.onfinish = () => {
      slide.ghost.remove();
      if (!wrap.querySelector("[data-cal-slide-ghost]")) wrap.style.overflow = "";
    };
  }, [cursor]);

  const step = (dir: -1 | 1) => {
    // A month view's wheel glide still going: stopped where it is (the month it's on is re-centred with the step).
    if (monthAnimRef.current) {
      cancelAnimationFrame(monthAnimRef.current);
      monthAnimRef.current = null;
      if (monthScrollerRef.current) monthScrollerRef.current.style.scrollSnapType = "";
    }
    beginSlide(dir);
    setCursor((prev) => shiftCursor(prev, dir));
  };
  // The date one step on (dir 1) or back (-1) in the current view.
  const shiftCursor = (prev: Date, dir: -1 | 1) => {
    if (view === "year") {
      const x = startOfMonth(prev);
      x.setMonth(x.getMonth() + 12 * dir);
      return x;
    }
    if (view === "month") {
      const x = startOfMonth(prev);
      x.setMonth(x.getMonth() + dir);
      return x;
    }
    if (view === "week") return addDays(prev, 7 * dir);
    if (view === "day") {
      // Skips the non-work days when the calendar leaves them out.
      let next = addDays(prev, dir);
      for (let i = 0; i < 6 && isLeftOutDay(next); i++) next = addDays(next, dir);
      return next;
    }
    return addDays(prev, LIST_DAYS * dir);
  };
  const title = (() => {
    if (view === "year") {
      const last = startOfMonth(cursor);
      last.setMonth(last.getMonth() + 11);
      return `${monthYear(startOfMonth(cursor))} – ${monthYear(last)}`;
    }
    if (view === "month") return monthYear(cursor);
    if (view === "week") {
      // The first and last days shown (Mon – Fri when the weekend is left out), the year once: "Oct 5 – Oct 9, 2026".
      const s = startOfWeek(cursor);
      return activeDateRange(addDays(s, weekCols[0]), addDays(s, weekCols[weekCols.length - 1]));
    }
    if (view === "day") return `${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(cursor)} ${activeDate(cursor)}`;
    return activeDateRange(range.from, addDays(range.to, -1));
  })();

  // ---------------------------------------------------------------- month view (HTML5 drag between days)
  const ghost = useDragGhost();
  const [monthDragId, setMonthDragId] = useState("");
  const [monthDropDay, setMonthDropDay] = useState<number | null>(null);
  // The Schedule panel (ProjectSchedulePanel): open; the events linked to projects (while it's open — which tells the
  // projects with something booked from those without); a project being dragged from it, and the time it'd go at in
  // the Week/Day views' hours.
  const [schedulePanelOpen, setSchedulePanelOpen] = useState(false);
  const [linkedEvents, setLinkedEvents] = useState<CalendarEvent[]>([]);
  const [linkedEventsLoaded, setLinkedEventsLoaded] = useState(false);
  useEffect(() => {
    if (!companyId || !canView || !schedulePanelOpen) return;
    return subscribeProjectLinkedCalendarEvents(companyId, (next) => {
      setLinkedEvents(next);
      setLinkedEventsLoaded(true);
    });
  }, [canView, companyId, schedulePanelOpen]);
  const scheduleProjects = useMemo(() => projects.filter((p) => !isProjectArchived(p)), [projects]);
  const [projectDragId, setProjectDragId] = useState("");
  const [projectDropSlot, setProjectDropSlot] = useState<{ dayMs: number; minutes: number } | null>(null);
  // The event it's over (lit up — dropped there, it's linked to that event).
  const [projectDropEventId, setProjectDropEventId] = useState("");
  const beginProjectDrag = (project: Project, e: ReactDragEvent<HTMLElement>) => {
    setProjectDragId(project.id);
    e.dataTransfer.effectAllowed = "copyLink";
    e.dataTransfer.setData("text/plain", project.name);
    // The Items board's drag (lib/use-drag-ghost.tsx): a pill of it hanging from the pointer, swinging as it moves —
    // grown out of its row — rather than the browser's picture of the row.
    const img = ghost.transparentImageRef.current;
    if (img) e.dataTransfer.setDragImage(img, 0, 0);
    const color = project.isSmallJob ? SMALL_JOB_COLOR : "var(--brand)";
    ghost.spawn(e, `cal_schedule_${project.id}`, { label: project.name || "Untitled project", color, tint: color });
  };
  const endProjectDrag = () => {
    setProjectDragId("");
    setMonthDropDay(null);
    setProjectDropSlot(null);
    setProjectDropEventId("");
    ghost.end();
  };
  // Where in a Week/Day column of hours the pointer is: on the half hour (as a click there), up to 11pm.
  const slotMinutesAt = (e: ReactDragEvent<HTMLElement>) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.min(23 * 60, Math.max(0, Math.floor((((e.clientY - rect.top) / HOUR_PX) * 60) / 30) * 30));
  };
  const today = startOfDay(new Date());
  // A day off: not a workday, or a New Zealand public holiday (lib/nz-public-holidays.ts — its name shows on the day).
  const isOffDay = (day: Date) => !workdays.includes(day.getDay()) || Boolean(nzPublicHolidayName(day, holidayRegion));
  // The "crossed out" look for days off.
  const offDayHatch = "repeating-linear-gradient(135deg, color-mix(in srgb, var(--text-main) 6%, transparent) 0 2px, transparent 2px 9px)";

  // How many days into the event the user grabbed it (so dropping keeps that day under the cursor).
  const [grabOffsetDays, setGrabOffsetDays] = useState(0);
  const beginDayDrag = (e: ReactDragEvent<HTMLElement>, event: CalendarEvent, elementId: string, grabDayMs: number) => {
    e.stopPropagation();
    setMonthDragId(event.id);
    setGrabOffsetDays(Math.round((startOfDay(grabDayMs).getTime() - startOfDay(event.startMs).getTime()) / DAY_MS));
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", event.id);
    // No floating drag image: the event itself is drawn at full length where it would land (see
    // dragPreviewEvent below) as the pointer moves across days.
    const img = ghost.transparentImageRef.current;
    if (img) e.dataTransfer.setDragImage(img, 0, 0);
    void elementId;
  };
  const endDayDrag = () => {
    setMonthDragId("");
    setMonthDropDay(null);
    ghost.end();
  };
  // The event being dragged, moved to where it would land — same length, same number of days — drawn
  // live while dragging (the original stays faded in place until it's dropped).
  const shiftToDay = (event: CalendarEvent, dayMs: number) => {
    const newStartDay = addDays(dayMs, -grabOffsetDays).getTime();
    const startMs = newStartDay + (event.startMs - startOfDay(event.startMs).getTime());
    return { startMs, endMs: startMs + (event.endMs - event.startMs) };
  };
  const dragPreviewEvent = (() => {
    if (!monthDragId || monthDropDay == null) return null;
    const event = events.find((x) => x.id === monthDragId);
    if (!event) return null;
    return { ...event, ...shiftToDay(event, monthDropDay), id: `${event.id}${PREVIEW_SUFFIX}` };
  })();
  const dayLayoutEvents = dragPreviewEvent ? [...visibleEvents, dragPreviewEvent] : visibleEvents;

  // Drop targets: a day cell (month) or an all-day column (week/day).
  // A project from the Schedule panel dropped on an event: linked to it, as linking it in its pop-up would — its people on
  // as staff, its address if it has none, its name as the title if it has none — saved straight away, with Undo putting
  // the event back as it was. (Events they can edit; dropped on one they can't, it goes to the day under it.)
  const linkProjectToEvent = async (event: CalendarEvent, project: Project) => {
    if (!companyId || !canEditEvent(event) || event.projectId === project.id) return;
    const linked: CalendarEvent = {
      ...event,
      projectId: project.id,
      projectName: project.name,
      showToClient: event.projectId ? event.showToClient : showToClientDefault,
      staffUids: Array.from(new Set([...draftStaffUids(event), ...projectEventStaffUids(project)])),
      title: event.title || project.name,
      location: event.location || String(project.clientAddress || ""),
    };
    const result = await saveCalendarEvent(companyId, editedByMe(linked));
    if (!result.ok) {
      setLoadError("Couldn't link the project to that event — try again.");
      return;
    }
    offerUndo(`${project.name} linked to ${event.title || "the event"}`, () => saveCalendarEvent(companyId, editedByMe(event)));
  };
  const projectDropOnEventProps = (event: CalendarEvent) => ({
    // (Over it: it's lit up, not the day under it.)
    onDragOver: (e: ReactDragEvent<HTMLElement>) => {
      if (!projectDragId || !canEditEvent(event)) return false;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "link";
      if (projectDropEventId !== event.id) setProjectDropEventId(event.id);
      if (monthDropDay != null) setMonthDropDay(null);
      if (projectDropSlot) setProjectDropSlot(null);
      return true;
    },
    onDrop: (e: ReactDragEvent<HTMLElement>) => {
      if (!projectDragId || !canEditEvent(event)) return false;
      e.preventDefault();
      e.stopPropagation();
      const project = projectById.get(projectDragId);
      endProjectDrag();
      if (project) void linkProjectToEvent(event, project);
      return true;
    },
  });
  // An event lit up with a project over it (projectDropEventId): ringed in the brand blue.
  const projectDropRing = (event: CalendarEvent): CSSProperties =>
    projectDragId && projectDropEventId === event.id
      ? { outline: "2px solid var(--brand)", outlineOffset: 1, boxShadow: "0 0 0 5px color-mix(in srgb, var(--brand) 22%, transparent)", zIndex: 6 }
      : {};
  // While a project's being dragged from the Schedule panel: the events with no project linked yet whose title names it — its
  // name or its client's (titleNamesProject: whole words, stricter than the pop-up's suggestions) — lifted a little and
  // glowing, so they're easy to find.
  // (Not on a staff member's first name — "Josh & Rob Meeting" is them, whoever the client is.)
  const projectDragged = projectDragId ? projectById.get(projectDragId) : undefined;
  const staffFirstNames = new Set(staffMembers.map((m) => m.name.trim().split(/\s+/)[0].toLowerCase()).filter(Boolean));
  const projectMatchIds = new Set(
    projectDragged
      ? events.filter((ev) => !ev.projectId && titleNamesProject(ev.title, projectDragged, staffFirstNames)).map((ev) => ev.id)
      : [],
  );
  const projectMatchLift = (event: CalendarEvent): CSSProperties =>
    projectMatchIds.has(event.id)
      ? {
          transform: "translateY(-2px) scale(1.04)",
          boxShadow: "0 8px 18px color-mix(in srgb, var(--brand) 34%, transparent), 0 0 0 2px color-mix(in srgb, var(--brand) 55%, transparent)",
          zIndex: 5,
        }
      : {};
  const dayDropProps = (dayMs: number) => ({
    onDragOver: (e: ReactDragEvent<HTMLElement>) => {
      // A project from the Schedule panel: a new all-day event for it, on this day.
      if (projectDragId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (monthDropDay !== dayMs) setMonthDropDay(dayMs);
        if (projectDropEventId) setProjectDropEventId("");
        return;
      }
      if (!monthDragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (monthDropDay !== dayMs) setMonthDropDay(dayMs);
    },
    onDrop: (e: ReactDragEvent<HTMLElement>) => {
      e.preventDefault();
      if (projectDragId) {
        const project = projectById.get(projectDragId);
        endProjectDrag();
        if (project) openNew(dayMs, true, e, project);
        return;
      }
      const id = e.dataTransfer.getData("text/plain") || monthDragId;
      const event = events.find((x) => x.id === id);
      if (!event) {
        endDayDrag();
        return;
      }
      const { startMs, endMs } = shiftToDay(event, dayMs);
      endDayDrag();
      if (startMs !== event.startMs) void moveEvent(event, startMs, endMs);
    },
  });

  // dayCols: the day each column is, when some days are left out (see layoutBars).
  const dayUnderPointer = (e: ReactDragEvent<HTMLElement>, rowStart: Date, cols: number, dayCols?: number[]) => {
    const row = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    const colWidth = row ? row.width / cols : 1;
    const col = row ? Math.min(cols - 1, Math.max(0, Math.floor((e.clientX - row.left) / colWidth))) : 0;
    return addDays(rowStart, dayCols ? dayCols[col] : col).getTime();
  };

  // A single-day timed event in a month cell: coloured dot, time, title.
  // `place` positions it in a week row's lanes overlay (month view); it then passes drops to its day.
  const renderChip = (event: CalendarEvent, day: Date, place?: CSSProperties) => {
    const cat = categoryOf(event);
    const chipId = `cal_chip_${event.id}_${startOfDay(day).getTime()}`;
    const drop = dayDropProps(startOfDay(day).getTime());
    return (
      <button
        key={chipId}
        id={chipId}
        type="button"
        draggable={canEditEvent(event)}
        onDragStart={(e) => beginDayDrag(e, event, chipId, event.startMs)}
        onDragEnd={endDayDrag}
        // (A project from the Schedule panel over it: linked to it.)
        onDragOver={(e) => {
          if (projectDropOnEventProps(event).onDragOver(e)) return;
          if (place) drop.onDragOver(e);
        }}
        onDrop={(e) => {
          if (projectDropOnEventProps(event).onDrop(e)) return;
          if (place) drop.onDrop(e);
        }}
        onClick={(e) => {
          e.stopPropagation();
          openExisting(event, e);
        }}
        className={`flex h-[18px] min-w-0 shrink-0 items-center gap-1.5 truncate rounded-[6px] px-1.5 text-left text-[10.5px] font-normal transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] max-md:text-clip ${place ? "pointer-events-auto absolute" : "w-full"}`}
        style={{
          ...place,
          color: "var(--text-main)",
          opacity: monthDragId === event.id ? 0.35 : 1,
          pointerEvents: event.id.endsWith(PREVIEW_SUFFIX) ? "none" : undefined,
          backgroundColor: event.id.endsWith(PREVIEW_SUFFIX) || (projectDragId && projectDropEventId === event.id) ? "var(--brand-soft)" : undefined,
          ...projectMatchLift(event),
          ...projectDropRing(event),
        }}
        title={`${event.title}${event.location ? ` · ${event.location}` : ""}`}
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cat.color }} />
        <span className="shrink-0 opacity-70">{timeText(event.startMs)}</span>
        <span className="truncate max-md:text-clip">{event.title || "Untitled event"}</span>
      </button>
    );
  };

  // One continuous bar per event across the days it covers in a row of `cols` days. Square ends mark
  // where it carries on into the previous / next row. dayCols as for layoutBars. slotH / gap: each event's
  // slot, and the gap at its foot (the month view's tighter than the all-day row's).
  const renderBars = (bars: BarSlot[], rowStart: Date, cols: number, maxLanes: number, dayCols?: number[], slotH = BAR_H, gap = 2) =>
    bars
      .filter((b) => b.lane < maxLanes)
      .map((b) => {
        if (!isBarEvent(b.event)) {
          return renderChip(b.event, addDays(rowStart, dayCols ? dayCols[b.startCol] : b.startCol), {
            top: b.lane * slotH,
            height: slotH - gap,
            left: `calc(${(b.startCol / cols) * 100}% + 2px)`,
            width: `calc(${(1 / cols) * 100}% - 4px)`,
            zIndex: b.event.id.endsWith(PREVIEW_SUFFIX) ? 5 : undefined,
          });
        }
        const cat = categoryOf(b.event);
        const barId = `cal_bar_${b.event.id}_${startOfDay(rowStart).getTime()}`;
        const span = b.endCol - b.startCol + 1;
        return (
          <button
            key={barId}
            id={barId}
            type="button"
            draggable={canEditEvent(b.event)}
            onDragStart={(e) => {
              // Which day of the bar was grabbed: from the pointer's position across the row.
              const row = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
              const colWidth = row ? row.width / cols : 1;
              const grabCol = row ? Math.min(cols - 1, Math.max(0, Math.floor((e.clientX - row.left) / colWidth))) : b.startCol;
              beginDayDrag(e, b.event, barId, addDays(rowStart, dayCols ? dayCols[grabCol] : grabCol).getTime());
            }}
            onDragEnd={endDayDrag}
            // A bar covers the day cells under it, so it passes drops on to the day under the pointer — but a project from
            // the Schedule panel, which is linked to it.
            onDragOver={(e) => {
              if (projectDropOnEventProps(b.event).onDragOver(e)) return;
              dayDropProps(dayUnderPointer(e, rowStart, cols, dayCols)).onDragOver(e);
            }}
            onDrop={(e) => {
              if (projectDropOnEventProps(b.event).onDrop(e)) return;
              dayDropProps(dayUnderPointer(e, rowStart, cols, dayCols)).onDrop(e);
            }}
            onClick={(e) => {
              e.stopPropagation();
              openExisting(b.event, e);
            }}
            className="pointer-events-auto absolute flex items-center gap-1 truncate px-2 text-left text-[11px] font-normal transition hover:brightness-95 max-md:text-clip"
            style={{
              top: b.lane * slotH,
              height: slotH - gap,
              left: `calc(${(b.startCol / cols) * 100}% + ${b.contBefore ? 0 : 2}px)`,
              width: `calc(${(span / cols) * 100}% - ${(b.contBefore ? 0 : 2) + (b.contAfter ? 0 : 2)}px)`,
              backgroundColor: cat.color,
              color: textOn(cat.color),
              borderRadius: `${b.contBefore ? 0 : 6}px ${b.contAfter ? 0 : 6}px ${b.contAfter ? 0 : 6}px ${b.contBefore ? 0 : 6}px`,
              opacity: monthDragId === b.event.id ? 0.35 : 1,
              // The live drag preview: not interactive, lifted with a shadow.
              pointerEvents: b.event.id.endsWith(PREVIEW_SUFFIX) ? "none" : undefined,
              boxShadow: b.event.id.endsWith(PREVIEW_SUFFIX) ? "0 6px 18px rgba(15,23,42,0.28), 0 0 0 2px var(--panel-bg)" : undefined,
              zIndex: b.event.id.endsWith(PREVIEW_SUFFIX) ? 5 : undefined,
              ...projectMatchLift(b.event),
              ...projectDropRing(b.event),
            }}
            title={`${b.event.title}${b.event.location ? ` · ${b.event.location}` : ""}`}
          >
            {b.contBefore ? <span className="shrink-0 opacity-80">←</span> : null}
            {!b.event.allDay && !b.contBefore ? <span className="shrink-0 opacity-85">{timeText(b.event.startMs)}</span> : null}
            <span className="truncate max-md:text-clip">{b.event.title || "Untitled event"}</span>
            {b.contAfter ? <span className="ml-auto shrink-0 opacity-80">→</span> : null}
          </button>
        );
      });

  // ---- Month view. Every day is the same height (6 equal rows filling the space); each day shows as
  // many events as fit and "+N more" for the rest.
  const [monthRowsHeight, setMonthRowsHeight] = useState(0);
  const monthRowsObserverRef = useRef<ResizeObserver | null>(null);
  const monthRowsRef = useCallback((el: HTMLDivElement | null) => {
    monthRowsObserverRef.current?.disconnect();
    monthRowsObserverRef.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setMonthRowsHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    monthRowsObserverRef.current = observer;
  }, []);
  // Day number row (2px padding + 20px + 1px) sits above the event slots.
  const DAY_HEADER_PX = 23;
  const slotsPerDay = Math.max(1, Math.floor((monthRowsHeight / 6 - DAY_HEADER_PX - 2) / MONTH_SLOT_H));

  // One week of the month view. `month` is the month being shown — days outside it are greyed (they fade
  // as that changes). `place` sizes/snaps the row in the month view's continuous week scroller.
  // windowMonths: the scroller's three months (prev / current / next). Each day is tagged with which one
  // it's in (data-mi); app/globals.css greys the days that aren't in the month in view (data-live).
  const weekRow = (weekStart: Date, windowMonths: Date[], place?: { className?: string; style?: CSSProperties }) => {
    const S = slotsPerDay;
    // The week's days, less any left-out non-work days (weekCols).
    const cols = weekCols.length;
    const days = weekCols.map((i) => addDays(weekStart, i));
    // Every event (bars and single-day chips) in category-ordered lanes.
    const { bars, lanes } = layoutBars(weekStart, cols, dayLayoutEvents, rankOf, true, weekCols);
    // Lanes shown in this row — every slot can hold an event, since the "+N" count sits up in the
    // day's header rather than taking a slot.
    const L = Math.min(lanes, S);
    return (
      <div
        key={weekStart.getTime()}
        className={`relative grid min-h-0 overflow-hidden border-b ${place ? place.className ?? "" : "last:border-b-0"}`}
        style={{ borderColor: "var(--glass-border)", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, ...place?.style }}
      >
        {days.map((dd, col) => {
          const dayMs = dd.getTime();
          const isToday = sameDay(dd, today);
          const monthIdx = windowMonths.findIndex((m) => m.getFullYear() === dd.getFullYear() && m.getMonth() === dd.getMonth());
          const more = bars.filter((b) => b.lane >= L && b.startCol <= col && b.endCol >= col).length;
          const holiday = nzPublicHolidayName(dd, holidayRegion);
          return (
            <div
              key={dayMs}
              data-mi={monthIdx}
              onClick={() => {
                setCursor(startOfDay(dd));
                changeView("day");
              }}
              {...dayDropProps(dayMs)}
              title={holiday ? `${holiday} — open this day` : "Open this day"}
              className={`cal-day group relative flex min-h-0 min-w-0 cursor-pointer flex-col gap-0.5 overflow-hidden px-1 pb-1 pt-0.5 transition-colors duration-300 hover:bg-[color-mix(in_srgb,var(--text-main)_3%,transparent)] ${col === cols - 1 ? "" : "border-r"}`}
              style={{
                borderColor: "var(--glass-border)",
                backgroundColor: monthDropDay === dayMs ? "var(--brand-soft)" : isToday ? TODAY_TINT : "var(--cal-day-bg, transparent)",
                backgroundImage: isOffDay(dd) && monthDropDay !== dayMs ? offDayHatch : undefined,
                // A project from the Schedule panel over it: ringed as well.
                boxShadow: projectDragId && monthDropDay === dayMs ? "inset 0 0 0 2px var(--brand)" : undefined,
              }}
            >
              <div className="flex h-5 shrink-0 items-center justify-between px-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCursor(startOfDay(dd));
                    changeView("day");
                  }}
                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[12px] font-semibold transition duration-300 hover:bg-[color-mix(in_srgb,var(--text-main)_7%,transparent)]"
                  style={isToday ? { backgroundImage: "var(--brand-gradient)", color: "#fff" } : { color: "var(--cal-day-num, var(--text-main))" }}
                  title="Open this day"
                >
                  {dd.getDate()}
                </button>
                {/* A public holiday: its name, beside the number. */}
                {holiday ? (
                  <span
                    className="ml-1 min-w-0 flex-1 truncate text-[10px] font-medium max-md:text-clip"
                    style={{ color: "var(--cal-day-num, var(--text-main))" }}
                  >
                    {holiday}
                  </span>
                ) : null}
                {more > 0 ? (
                  // Events that don't fit: the count, in a pill at the right of the day's header. Opens the day.
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCursor(startOfDay(dd));
                      changeView("day");
                    }}
                    className="inline-flex h-[18px] shrink-0 items-center rounded-full px-1.5 text-[10.5px] font-semibold transition hover:brightness-95"
                    style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                    title={`${more} more event${more === 1 ? "" : "s"} — open this day`}
                  >
                    +{more}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {/* Today, outlined — over the day cells but under the events (they come after it), so a bar across it sits on top. */}
        {(() => {
          const todayCol = days.findIndex((dd) => sameDay(dd, today));
          if (todayCol < 0) return null;
          return (
            <div
              className="pointer-events-none absolute inset-y-0"
              style={{ left: `${(todayCol / cols) * 100}%`, width: `${(1 / cols) * 100}%`, boxShadow: TODAY_RING }}
            />
          );
        })()}
        {/* The week's events (continuous bars and single-day chips), positioned under the day numbers. */}
        <div className="pointer-events-none absolute inset-x-0" style={{ top: DAY_HEADER_PX, height: L * MONTH_SLOT_H }}>
          {renderBars(bars, weekStart, cols, L, weekCols, MONTH_SLOT_H, MONTH_SLOT_GAP)}
        </div>
      </div>
    );
  };

  // ---- Mobile: swipe up/down between months. Three months are rendered stacked (previous, current,
  // next), the scroller snaps to whole months, and once it settles on the previous or next one the
  // cursor moves and the scroller is put back on the middle — so there's always a loaded month on
  // each side and it can never rest between two months.

  const monthScrollerRef = useRef<HTMLDivElement | null>(null);
  const monthSettleTimerRef = useRef<number | null>(null);
  // Which of the three months (0 prev, 1 current, 2 next) the scroller is nearest to, so the greyed days
  // fade over to the month coming into view. Written straight onto the scroller as data-live (styled in
  // app/globals.css), not React state — re-rendering the calendar mid-scroll is what made it stutter.
  const setLiveMonth = (el: HTMLDivElement, idx: number) => {
    if (el.dataset.live !== String(idx)) el.dataset.live = String(idx);
  };
  // The running wheel / Previous / Next glide (a requestAnimationFrame id), if any.
  const monthAnimRef = useRef<number | null>(null);
  // Nearest month snap point to the scroller's position.
  const nearestMonthIdx = (el: HTMLDivElement) => {
    const rowH = el.clientHeight / 6;
    const { starts } = mobileMonthWeeks(cursor);
    let best = 0;
    starts.forEach((row, i) => {
      if (Math.abs(el.scrollTop - row * rowH) < Math.abs(el.scrollTop - starts[best] * rowH)) best = i;
    });
    return best;
  };
  useLayoutEffect(() => {
    if (view !== "month") return;
    const el = monthScrollerRef.current;
    if (!el) return;
    el.scrollTop = (mobileMonthWeeks(cursor).starts[1] * el.clientHeight) / 6;
    setLiveMonth(el, 1);
  }, [cursor, isMobile, monthRowsHeight, view]);
  const settleMonthScroller = () => {
    const el = monthScrollerRef.current;
    if (!el || !el.clientHeight) return;
    const idx = nearestMonthIdx(el);
    if (idx === 1) return;
    // The month itself, not "one on from whatever the cursor is now": scrollend and the settle timer can
    // both fire before the re-render, and a relative step would then move two months.
    const target = mobileMonthWeeks(cursor).months[idx];
    setCursor(target);
  };
  // A smooth glide to `top` (wheel / Previous / Next): one steady ease-in-out driven frame by frame, with
  // snapping paused so the browser's own snap animation can't fight it, then settle once at the end.
  const animateMonthScroll = (el: HTMLDivElement, top: number) => {
    if (monthAnimRef.current) cancelAnimationFrame(monthAnimRef.current);
    const from = el.scrollTop;
    const distance = top - from;
    if (Math.abs(distance) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.scrollTop = top;
      monthAnimRef.current = null;
      settleMonthScroller();
      return;
    }
    el.style.scrollSnapType = "none";
    const startedAt = performance.now();
    const DURATION_MS = 420;
    const tick = (now: number) => {
      const p = Math.min(1, (now - startedAt) / DURATION_MS);
      const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      el.scrollTop = from + distance * eased;
      setLiveMonth(el, nearestMonthIdx(el));
      if (p < 1) {
        monthAnimRef.current = requestAnimationFrame(tick);
        return;
      }
      monthAnimRef.current = null;
      el.style.scrollSnapType = "";
      settleMonthScroller();
    };
    monthAnimRef.current = requestAnimationFrame(tick);
  };
  const onMonthScroll = () => {
    const el = monthScrollerRef.current;
    if (el && el.clientHeight) setLiveMonth(el, nearestMonthIdx(el));
    // A glide settles itself when it finishes.
    if (monthAnimRef.current) return;
    // Settles on `scrollend` (below) where the browser has it; a timer only as the fallback. A timer
    // could fire in the gap between a scroll and the snap animation after it, recentre mid-animation,
    // and the animation would then carry on into the month after (skipping one).
    if (el && "onscrollend" in el) return;
    if (monthSettleTimerRef.current) window.clearTimeout(monthSettleTimerRef.current);
    monthSettleTimerRef.current = window.setTimeout(settleMonthScroller, 200);
  };
  // Mouse wheel / trackpad: exactly one month per gesture, smoothly — rather than leaving it to the
  // browser's snapping, which could run a fast wheel or a trackpad flick's momentum past several months.
  // The gesture's further wheel events (a flick keeps firing them for a moment) are ignored until it
  // has been quiet for a beat. Touch (phones) keeps its native swipe, which doesn't fire wheel events.
  // The gesture lock lives in a ref: the listener is re-attached when the month changes (so the glide and
  // settle see the current month), and a flick's trailing events must stay ignored across that.
  const monthWheelRef = useRef<{ locked: boolean; accumulated: number; quietTimer: number | null }>({ locked: false, accumulated: 0, quietTimer: null });
  useEffect(() => {
    if (view !== "month") return;
    const el = monthScrollerRef.current;
    if (!el) return;
    const gesture = monthWheelRef.current;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      if (gesture.quietTimer) window.clearTimeout(gesture.quietTimer);
      gesture.quietTimer = window.setTimeout(() => {
        gesture.locked = false;
        gesture.accumulated = 0;
      }, 180);
      if (gesture.locked) return;
      gesture.accumulated += e.deltaY;
      if (Math.abs(gesture.accumulated) < 24) return;
      gesture.locked = true;
      // The month starts (snap rows) in the scroller, top to bottom; go to the next/previous one from
      // wherever it's resting.
      const current = el.scrollTop;
      const elTop = el.getBoundingClientRect().top;
      const tops = Array.from(el.querySelectorAll<HTMLElement>(":scope > .snap-start")).map(
        (row) => current + row.getBoundingClientRect().top - elTop,
      );
      const target =
        gesture.accumulated > 0 ? tops.find((top) => top > current + 2) : [...tops].reverse().find((top) => top < current - 2);
      if (target === undefined) return;
      animateMonthScroll(el, target);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });
  useEffect(() => {
    const el = monthScrollerRef.current;
    if (!el || !("onscrollend" in el)) return;
    const onEnd = () => {
      if (monthAnimRef.current) return;
      if (monthSettleTimerRef.current) window.clearTimeout(monthSettleTimerRef.current);
      settleMonthScroller();
    };
    el.addEventListener("scrollend", onEnd);
    return () => el.removeEventListener("scrollend", onEnd);
  });

  // Phones: views run edge to edge (no floating card), like the month view. Desktop: the glass card.
  const viewShell = isMobile
    ? { className: "-mx-3 border-y", style: { borderColor: "var(--glass-border)", backgroundColor: "var(--glass-bg-strong)" } as CSSProperties }
    : { className: "rounded-[20px] border", style: cardStyle };
  const weekdayHeader = (
    <div className="grid shrink-0 border-b" style={{ borderColor: "var(--glass-border)", gridTemplateColumns: `repeat(${weekCols.length}, minmax(0, 1fr))` }}>
      {weekCols.map((i) => addDays(startOfWeek(cursor), i)).map((day) => (
        <div key={day.getTime()} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
          {weekdayShort(day)}
        </div>
      ))}
    </div>
  );

  // One continuous run of weeks, snapping month to month (see mobileMonthWeeks) — on every screen size,
  // so the days either side of a month never show twice and wheel/trackpad/swipe scrolling moves between
  // months. Phones: edge to edge. Tablet/desktop: in the glass card, filling the column on desktop.
  const monthView = () => {
    const { weeks, starts, months } = mobileMonthWeeks(cursor);
    const scroller = (className: string, style?: CSSProperties) => (
      <div
        ref={(el) => {
          monthScrollerRef.current = el;
          monthRowsRef(el);
        }}
        onScroll={onMonthScroll}
        className={`cal-month-scroller snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
        style={style}
      >
        {weeks.map((weekStart, i) =>
          weekRow(weekStart, months, {
            className: starts.includes(i) ? "snap-start [scroll-snap-stop:always]" : "",
            style: { height: "calc(100% / 6)" },
          }),
        )}
      </div>
    );
    if (isMobile) {
      // Fills the rest of the screen under the toolbar (however many lines it wraps to), so all six weeks
      // fit — the page around it is laid out for that while the month view is on (see fillMonth).
      return (
        <div className="-mx-3 flex min-h-0 flex-1 flex-col border-y" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--glass-bg-strong)" }}>
          {weekdayHeader}
          {scroller("min-h-0 flex-1")}
        </div>
      );
    }
    return (
      <div className="flex flex-col overflow-hidden rounded-[20px] border lg:min-h-0 lg:flex-1" style={cardStyle}>
        {weekdayHeader}
        {scroller(chromeless ? "h-[max(540px,calc(100svh-120px))] lg:h-auto lg:min-h-0 lg:flex-1" : "h-[max(540px,calc(100svh-168px))] lg:h-auto lg:min-h-0 lg:flex-1")}
      </div>
    );
  };

  // ---------------------------------------------------------------- week / day time grid
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const columnsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if ((view === "week" || view === "day") && gridScrollRef.current) gridScrollRef.current.scrollTop = HOUR_PX * 7;
  }, [view]);
  const pointerDragRef = useRef<{
    event: CalendarEvent;
    mode: "move" | "resize";
    x: number;
    y: number;
    colWidth: number;
    // Week view: the column the event starts in (-1 if it isn't one of the columns shown).
    col: number;
    moved: boolean;
  } | null>(null);

  const onEventPointerDown = (e: ReactPointerEvent<HTMLElement>, event: CalendarEvent, mode: "move" | "resize") => {
    e.stopPropagation();
    if (!canEditEvent(event) || e.button !== 0) return;
    const cols = columnsRef.current;
    const colCount = view === "week" ? weekCols.length : 1;
    pointerDragRef.current = {
      event,
      mode,
      x: e.clientX,
      y: e.clientY,
      colWidth: cols ? cols.getBoundingClientRect().width / colCount : 1,
      col: weekCols.indexOf(Math.round((startOfDay(event.startMs).getTime() - range.from.getTime()) / DAY_MS)),
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onEventPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = pointerDragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    drag.moved = true;
    const minutes = Math.round(((dy / HOUR_PX) * 60) / SNAP_MIN) * SNAP_MIN;
    let days = view === "week" ? Math.round(dx / drag.colWidth) : 0;
    // With non-work days left out, columns aren't consecutive days: move by columns, within the week.
    if (view === "week" && weekCols.length < 7 && drag.col >= 0) {
      const to = Math.min(weekCols.length - 1, Math.max(0, drag.col + days));
      days = weekCols[to] - weekCols[drag.col];
    }
    const { event } = drag;
    if (drag.mode === "move") {
      const delta = minutes * 60000 + days * DAY_MS;
      setDragPreview({ id: event.id, startMs: event.startMs + delta, endMs: event.endMs + delta });
    } else {
      const endMs = Math.max(event.startMs + SNAP_MIN * 60000, event.endMs + minutes * 60000);
      setDragPreview({ id: event.id, startMs: event.startMs, endMs });
    }
  };
  const onEventPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = pointerDragRef.current;
    pointerDragRef.current = null;
    if (!drag) return;
    if (!drag.moved) {
      setDragPreview(null);
      openExisting(drag.event, e);
      return;
    }
    const preview = dragPreview;
    setDragPreview(null);
    if (preview && (preview.startMs !== drag.event.startMs || preview.endMs !== drag.event.endMs)) {
      // (A small buzz as it lands — on a phone.)
      haptic("land");
      void moveEvent(drag.event, preview.startMs, preview.endMs);
    }
  };

  // Phones, day and week views: a sideways drag slides to the next or previous day (week) with the finger —
  // the one it started on going off with it and the next coming in beside it — and on letting go carries
  // on over (dragged a quarter of the way, or flicked) or springs back. Up and down still scrolls the hours
  // (touch-action pan-y — globals.css, data-cal-swipe-area); a drag that starts on an event is that event
  // being dragged. Pointer events, captured by viewWrapRef once it's going sideways: the view under the
  // finger is swapped for the next one mid-drag, and the element it started on can go with it.
  type DaySwipe = {
    id: number;
    x: number;
    y: number;
    at: number;
    // The latest move, for how fast it's going on letting go.
    lastX: number;
    lastAt: number;
    v: number;
    // Once it's going sideways: which way, the copy of the day (week) it started on, that date, how far a
    // whole slide is, and how far it's been dragged.
    drag?: { dir: -1 | 1; ghost: HTMLElement; from: Date; dist: number; dx: number };
  };
  const daySwipeRef = useRef<DaySwipe | null>(null);
  // The settle after letting go, finished at once if another drag starts first.
  const daySwipeSettleRef = useRef<(() => void) | null>(null);
  // A drag that sprang back: the copy goes once the day (week) it started on is showing again.
  const daySwipeRevertRef = useRef<HTMLElement | null>(null);
  const liveDayView = () => {
    const live = viewWrapRef.current?.firstElementChild as HTMLElement | null;
    return live && !live.dataset.calSlideGhost ? live : null;
  };
  const placeDaySwipe = (drag: NonNullable<DaySwipe["drag"]>) => {
    drag.ghost.style.transform = `translateX(${drag.dx}px)`;
    const live = liveDayView();
    if (live) live.style.transform = `translateX(${drag.dir * drag.dist + drag.dx}px)`;
  };
  // The new day (week) in place under the finger as soon as it renders — before it's painted.
  useLayoutEffect(() => {
    const reverted = daySwipeRevertRef.current;
    daySwipeRevertRef.current = null;
    placeDaySwipeView(viewWrapRef.current, daySwipeRef.current?.drag, reverted);
  }, [cursor]);
  const onDaySwipeDown = (e: React.PointerEvent<HTMLElement>) => {
    const target = e.target as HTMLElement | null;
    if (!isMobile || e.pointerType !== "touch" || (view !== "day" && view !== "week") || target?.closest("[data-cal-event]")) return;
    daySwipeSettleRef.current?.();
    const now = performance.now();
    daySwipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: now, lastX: e.clientX, lastAt: now, v: 0 };
  };
  const onDaySwipeMove = (e: React.PointerEvent<HTMLElement>) => {
    const swipe = daySwipeRef.current;
    if (!swipe || e.pointerId !== swipe.id) return;
    const now = performance.now();
    if (now > swipe.lastAt) swipe.v = (e.clientX - swipe.lastX) / (now - swipe.lastAt);
    swipe.lastX = e.clientX;
    swipe.lastAt = now;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    if (!swipe.drag) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        daySwipeRef.current = null;
        return;
      }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      // Reduced motion: no sliding — it just changes on letting go (onDaySwipeUp).
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const wrap = viewWrapRef.current;
      const ghost = makeSlideGhost();
      if (!wrap || !ghost) return;
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch {
        // The pointer's already gone — its pointerup / pointercancel still ends this.
      }
      wrap.style.overflow = "hidden";
      const dir = dx < 0 ? 1 : -1;
      swipe.drag = { dir, ghost, from: cursor, dist: wrap.clientWidth + 18, dx: 0 };
      setCursor((prev) => shiftCursor(prev, dir));
    }
    const drag = swipe.drag;
    // Only the way it started: back past where it began stays there.
    drag.dx = drag.dir === 1 ? Math.max(-drag.dist, Math.min(0, dx)) : Math.min(drag.dist, Math.max(0, dx));
    placeDaySwipe(drag);
  };
  const onDaySwipeUp = (e: React.PointerEvent<HTMLElement>) => {
    const swipe = daySwipeRef.current;
    if (!swipe || e.pointerId !== swipe.id) return;
    daySwipeRef.current = null;
    const drag = swipe.drag;
    if (!drag) {
      // Reduced motion: a plain swipe, changing on letting go.
      const dx = e.clientX - swipe.x;
      const dy = e.clientY - swipe.y;
      if (e.type === "pointerup" && Math.abs(dx) >= 50 && Math.abs(dx) >= Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
      return;
    }
    const wrap = viewWrapRef.current;
    const live = liveDayView();
    const flicked = Math.abs(swipe.v) > 0.35 && Math.sign(swipe.v) === -drag.dir && Math.abs(drag.dx) > 20;
    const over = e.type === "pointerup" && (Math.abs(drag.dx) > drag.dist * 0.25 || flicked);
    const toDx = over ? -drag.dir * drag.dist : 0;
    const timing = { duration: Math.round(Math.max(160, Math.min(360, (Math.abs(toDx - drag.dx) / drag.dist) * 420))), easing: "cubic-bezier(0.22, 0.8, 0.24, 1)" };
    const ghostAnim = drag.ghost.animate([{ transform: `translateX(${drag.dx}px)` }, { transform: `translateX(${toDx}px)` }], { ...timing, fill: "forwards" });
    const liveAnim = live?.animate(
      [{ transform: `translateX(${drag.dir * drag.dist + drag.dx}px)` }, { transform: `translateX(${drag.dir * drag.dist + toDx}px)` }],
      { ...timing, fill: "forwards" },
    );
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      daySwipeSettleRef.current = null;
      ghostAnim.cancel();
      liveAnim?.cancel();
      if (over) {
        drag.ghost.remove();
        if (live) live.style.transform = "";
        if (wrap) wrap.style.overflow = "";
      } else {
        // Back to the day (week) it started on; the copy goes once that's showing (the layout effect above).
        drag.ghost.style.transform = "";
        daySwipeRevertRef.current = drag.ghost;
        setCursor(drag.from);
      }
    };
    daySwipeSettleRef.current = settle;
    ghostAnim.onfinish = settle;
  };

  const timeGrid = () => {
    // Week: the days in weekCols (non-work days may be left out); day: just the one.
    const dayCols = view === "week" ? weekCols : undefined;
    const days = dayCols ? dayCols.map((i) => addDays(range.from, i)) : [range.from];
    const dayCount = days.length;
    const gridCols = { gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` };
    return (
      <div
        className={`flex min-h-0 flex-col overflow-hidden lg:flex-1 ${viewShell.className}`}
        style={viewShell.style}
        data-cal-swipe-area={isMobile ? "true" : undefined}
      >
        {/* Day headers, then the all-day row (all-day and multi-day events as continuous bars). */}
        {(() => {
          const { bars, lanes } = layoutBars(range.from, dayCount, dayLayoutEvents, rankOf, false, dayCols);
          return (
            <div className="border-b" style={{ borderColor: "var(--glass-border)" }}>
              <div className="flex">
                <div className="w-14 shrink-0" />
                <div className="grid min-w-0 flex-1" style={gridCols}>
                  {days.map((d) => {
                    const isToday = sameDay(d, today);
                    const holiday = nzPublicHolidayName(d, holidayRegion);
                    return (
                      <button
                        key={d.getTime()}
                        type="button"
                        onClick={() => {
                          setCursor(startOfDay(d));
                          changeView("day");
                        }}
                        title={holiday || undefined}
                        className="flex w-full min-w-0 items-center justify-center gap-1.5 border-l px-1 py-1.5 text-[12px] font-semibold first:border-l-0"
                        style={{
                          color: isToday ? "var(--brand-strong)" : "var(--text-main)",
                          borderColor: "var(--glass-border)",
                          backgroundColor: isToday ? TODAY_TINT : undefined,
                          // Today, outlined down its column (not in Day view — the whole view's the one day).
                          boxShadow: isToday && dayCount > 1 ? `${TODAY_SIDES}, inset 0 2px 0 var(--brand)` : undefined,
                        }}
                      >
                        <span style={{ color: "var(--text-muted)" }}>{weekdayShort(d)}</span>
                        <span
                          className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1"
                          style={isToday ? { backgroundImage: "var(--brand-gradient)", color: "#fff" } : undefined}
                        >
                          {d.getDate()}
                        </span>
                        {/* A public holiday: its name, after the date. */}
                        {holiday ? <span className="min-w-0 truncate text-[11px] font-medium">{holiday}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex">
                <div className="flex w-14 shrink-0 items-center justify-end pr-2 text-[10px]" style={{ color: "var(--text-muted)" }}>all day</div>
                <div className="relative grid min-w-0 flex-1" style={{ ...gridCols, minHeight: Math.max(26, lanes * BAR_H + 6) }}>
                  {days.map((d) => (
                    <div
                      key={d.getTime()}
                      onClick={(e) => openNew(d.getTime(), true, e)}
                      {...dayDropProps(d.getTime())}
                      className={`border-l first:border-l-0 ${canCreate ? "cursor-pointer hover:bg-[color-mix(in_srgb,var(--text-main)_3%,transparent)]" : ""}`}
                      style={{
                        borderColor: "var(--glass-border)",
                        backgroundColor: monthDropDay === d.getTime() ? "var(--brand-soft)" : sameDay(d, today) ? TODAY_TINT : undefined,
                        backgroundImage: isOffDay(d) && monthDropDay !== d.getTime() ? offDayHatch : undefined,
                        boxShadow:
                          projectDragId && monthDropDay === d.getTime()
                            ? "inset 0 0 0 2px var(--brand)"
                            : sameDay(d, today) && dayCount > 1
                              ? TODAY_SIDES
                              : undefined,
                      }}
                      title={canCreate ? "Add an all-day event" : undefined}
                    />
                  ))}
                  <div className="pointer-events-none absolute inset-x-0" style={{ top: 3, height: lanes * BAR_H }}>
                    {renderBars(bars, range.from, dayCount, 99, dayCols)}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
        {/* Hours */}
        {/* The floating glass scrollbar, not a native one: a native scrollbar takes width here but not in
            the date/all-day rows above, which pushed the hour columns out of line with them. */}
        {/* The thumb is portaled outside this page's markup (so outside data-app-gesture-exempt): dragging it
            down would otherwise also pull down the app's top menu. React passes its touches up through here. */}
        <div className="contents" onTouchStart={(e) => e.stopPropagation()}>
          <GlassScrollbarThumb scrollRef={gridScrollRef} refreshKey={view} />
        </div>
        <div
          ref={gridScrollRef}
          // The calendar app (no 48px tab bar over it) has that much more room.
          className={`hide-native-scrollbar relative min-h-0 flex-1 overflow-y-auto lg:max-h-none ${chromeless ? "max-h-[calc(100svh-174px)]" : "max-h-[calc(100svh-222px)]"}`}
        >
          <div className="flex" style={{ height: HOUR_PX * 24 }}>
            <div className="relative w-14 shrink-0">
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="absolute right-2 -translate-y-1/2 text-[10.5px]" style={{ top: h * HOUR_PX, color: "var(--text-muted)" }}>
                  {h === 0 ? "" : timeText(new Date(2000, 0, 1, h).getTime())}
                </span>
              ))}
            </div>
            <div ref={columnsRef} className="relative grid min-w-0 flex-1" style={gridCols}>
              {days.map((d) => {
                const dayStart = d.getTime();
                const dayEnd = dayStart + DAY_MS;
                const segments = visibleEvents
                  .filter((ev) => !isBarEvent(ev) && ev.startMs < dayEnd && ev.endMs > dayStart)
                  .map((ev) => ({ event: ev, start: Math.max(ev.startMs, dayStart), end: Math.min(ev.endMs, dayEnd) }));
                const laid = layoutDay(segments);
                const isToday = sameDay(d, today);
                const nowTop = ((Date.now() - dayStart) / 3600000) * HOUR_PX;
                return (
                  <div
                    key={dayStart}
                    className={`relative border-l first:border-l-0 ${canCreate ? "cursor-pointer" : ""}`}
                    style={{
                      borderColor: "var(--glass-border)",
                      backgroundColor: isToday ? TODAY_TINT : undefined,
                      backgroundImage: [
                        `repeating-linear-gradient(to bottom, var(--glass-border) 0, var(--glass-border) 1px, transparent 1px, transparent ${HOUR_PX}px)`,
                        ...(isOffDay(d) ? [offDayHatch] : []),
                      ].join(", "),
                      boxShadow: isToday && dayCount > 1 ? `${TODAY_SIDES}, inset 0 -2px 0 var(--brand)` : undefined,
                    }}
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const minutes = Math.floor((((e.clientY - rect.top) / HOUR_PX) * 60) / 30) * 30;
                      openNew(dayStart + minutes * 60000, false, e);
                    }}
                    // A project from the Schedule panel: a new hour-long event for it, at the half hour it's dropped on.
                    onDragOver={
                      projectDragId
                        ? (e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "copy";
                            const minutes = slotMinutesAt(e);
                            if (projectDropSlot?.dayMs !== dayStart || projectDropSlot.minutes !== minutes) setProjectDropSlot({ dayMs: dayStart, minutes });
                            if (projectDropEventId) setProjectDropEventId("");
                          }
                        : undefined
                    }
                    onDrop={
                      projectDragId
                        ? (e) => {
                            e.preventDefault();
                            const minutes = slotMinutesAt(e);
                            const project = projectById.get(projectDragId);
                            endProjectDrag();
                            if (project) openNew(dayStart + minutes * 60000, false, e, project);
                          }
                        : undefined
                    }
                  >
                    {/* Where a project being dragged from the Schedule panel would go: its hour, dashed. */}
                    {projectDragId && projectDropSlot?.dayMs === dayStart ? (
                      <div
                        className="pointer-events-none absolute inset-x-[2px] z-[4] overflow-hidden rounded-[8px] px-1.5 py-1 text-[11.5px] leading-tight"
                        style={{
                          top: (projectDropSlot.minutes / 60) * HOUR_PX,
                          height: HOUR_PX - 2,
                          backgroundColor: "var(--brand-soft)",
                          outline: "2px dashed var(--brand)",
                          outlineOffset: -2,
                          color: "var(--brand-strong)",
                        }}
                      >
                        <p className="truncate font-medium">{projectById.get(projectDragId)?.name || "New event"}</p>
                        <p className="truncate opacity-85">
                          {timeText(dayStart + projectDropSlot.minutes * 60000)} – {timeText(dayStart + (projectDropSlot.minutes + 60) * 60000)}
                        </p>
                      </div>
                    ) : null}
                    {isToday && nowTop >= 0 && nowTop <= HOUR_PX * 24 ? (
                      <div className="pointer-events-none absolute inset-x-0 z-[3] h-[2px]" style={{ top: nowTop, backgroundColor: "var(--danger)" }}>
                        <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full" style={{ backgroundColor: "var(--danger)" }} />
                      </div>
                    ) : null}
                    {laid.map(({ event, start, end, lane, lanes }) => {
                      const cat = categoryOf(event);
                      const top = ((start - dayStart) / 3600000) * HOUR_PX;
                      const height = Math.max(20, ((end - start) / 3600000) * HOUR_PX - 2);
                      const dragging = dragPreview?.id === event.id;
                      return (
                        <div
                          key={`${event.id}_${dayStart}`}
                          role="button"
                          tabIndex={0}
                          // A swipe starting on an event is it being dragged, not the day changing (onDaySwipe).
                          data-cal-event="true"
                          onPointerDown={(e) => onEventPointerDown(e, event, "move")}
                          onPointerMove={onEventPointerMove}
                          onPointerUp={onEventPointerUp}
                          // A project from the Schedule panel over it: linked to it (not a new event in its hour).
                          onDragOver={projectDragId ? (e) => void projectDropOnEventProps(event).onDragOver(e) : undefined}
                          onDrop={projectDragId ? (e) => void projectDropOnEventProps(event).onDrop(e) : undefined}
                          onClick={(e) => {
                            // Editors open the event from pointer-up (so a drag doesn't also open it);
                            // view-only users just click.
                            e.stopPropagation();
                            if (!canEditEvent(event)) openExisting(event, e);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") openExisting(event);
                          }}
                          className={`absolute z-[2] overflow-hidden rounded-[8px] px-1.5 py-1 text-left text-[11.5px] leading-tight shadow-[0_2px_8px_rgba(15,23,42,0.12)] ${canEditEvent(event) ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                          style={{
                            top,
                            height,
                            left: `calc(${(lane / lanes) * 100}% + 2px)`,
                            width: `calc(${100 / lanes}% - 4px)`,
                            backgroundColor: cat.color,
                            color: textOn(cat.color),
                            opacity: dragging ? 0.85 : 1,
                            touchAction: "none",
                            outline: dragging ? "2px solid var(--text-main)" : undefined,
                            transition: "transform 180ms ease, box-shadow 180ms ease",
                            ...projectMatchLift(event),
                            ...projectDropRing(event),
                          }}
                        >
                          <p className="truncate font-normal max-md:text-clip">{event.title || "Untitled event"}</p>
                          {height > 30 ? (
                            <p className="truncate opacity-85 max-md:text-clip">
                              {timeText(event.startMs)} – {timeText(event.endMs)}
                            </p>
                          ) : null}
                          {height > 46 && event.location ? <p className="truncate opacity-80 max-md:text-clip">{event.location}</p> : null}
                          {canEditEvent(event) ? (
                            <span
                              onPointerDown={(e) => onEventPointerDown(e, event, "resize")}
                              className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                              title="Drag to change the end time"
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------- list view
  // ---------------------------------------------------------------- year view
  // A Teamup-style year: one row per month (12, starting with the cursor's month), each day in the
  // column of its weekday — 37 columns, M T W T F S S repeating, so every month lines up. Days outside
  // a month are greyed, non-workdays crossed out (hatched) like the other views. Events are coloured bars across their days, stacked into
  // lanes (the row grows to fit). Click a bar to open the event, a day number for that day, a month
  // name for that month, or an empty part of a day to add an all-day event there.
  // The year view is one continuous scroller of month rows: 12 before the cursor's month, the 12 shown,
  // and 12 after, so scrolling just carries on into the previous/next year. When scrolling stops, the
  // month at the top becomes the cursor (the title follows) and the rows are re-centred on it, keeping
  // exactly the same months on screen (yearAnchorRef).
  const yearScrollerRef = useRef<HTMLDivElement | null>(null);
  const yearAnchorRef = useRef<{ monthMs: number; offset: number } | null>(null);
  const yearSettleTimerRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (view !== "year") return;
    const el = yearScrollerRef.current;
    if (!el) return;
    const anchor = yearAnchorRef.current;
    yearAnchorRef.current = null;
    const row = el.querySelector<HTMLElement>(`[data-month-ms="${anchor ? anchor.monthMs : startOfMonth(cursor).getTime()}"]`);
    if (!row) return;
    el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - yearHeaderHeight(el) - (anchor ? anchor.offset : 0);
  }, [cursor, view, isMobile]);
  const settleYearScroller = () => {
    const el = yearScrollerRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + yearHeaderHeight(el);
    const rows = Array.from(el.querySelectorAll<HTMLElement>("[data-month-ms]"));
    const topRow = rows.find((row) => row.getBoundingClientRect().bottom > top + 1);
    if (!topRow) return;
    const monthMs = Number(topRow.dataset.monthMs);
    if (monthMs === startOfMonth(cursor).getTime()) return;
    yearAnchorRef.current = { monthMs, offset: topRow.getBoundingClientRect().top - top };
    setCursor(new Date(monthMs));
  };
  const onYearScroll = () => {
    const el = yearScrollerRef.current;
    if (el && "onscrollend" in el) return;
    if (yearSettleTimerRef.current) window.clearTimeout(yearSettleTimerRef.current);
    yearSettleTimerRef.current = window.setTimeout(settleYearScroller, 200);
  };
  useEffect(() => {
    const el = yearScrollerRef.current;
    if (!el || !("onscrollend" in el)) return;
    el.addEventListener("scrollend", settleYearScroller);
    return () => el.removeEventListener("scrollend", settleYearScroller);
  });

  const YEAR_COLS = 37;
  const YEAR_BAR_H = 17;
  const yearView = () => {
    const first = startOfMonth(cursor);
    const months = Array.from({ length: 36 }, (_, i) => {
      const m = new Date(first);
      m.setMonth(m.getMonth() + i - 12);
      return m;
    });
    const weekdayLetters = Array.from({ length: 7 }, (_, i) => weekdayShort(addDays(startOfWeek(first), i)).slice(0, 1));
    // Narrow enough to fit a laptop-width calendar; narrower screens scroll sideways.
    const cols = { gridTemplateColumns: `repeat(${YEAR_COLS}, minmax(18px, 1fr))` };
    return (
      <div
        ref={yearScrollerRef}
        onScroll={onYearScroll}
        className={`overflow-auto overscroll-contain lg:h-auto lg:min-h-0 lg:flex-1 ${
          // The calendar app (no 48px tab bar over it) has that much more room.
          chromeless
            ? "h-[calc(100svh-96px-env(safe-area-inset-bottom,0px))] md:h-[max(540px,calc(100svh-120px))]"
            : "h-[calc(100svh-144px-env(safe-area-inset-bottom,0px))] md:h-[max(540px,calc(100svh-168px))]"
        } ${viewShell.className}`}
        style={viewShell.style}
      >
        <div className="min-w-[760px]">
          {/* Weekday letters, pinned while scrolling. */}
          <div data-year-header="true" className="sticky top-0 z-[3] flex border-b" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--glass-bg-strong)" }}>
            <div className="w-[76px] shrink-0" />
            <div className="grid flex-1" style={cols}>
              {Array.from({ length: YEAR_COLS }, (_, i) => (
                <span key={i} className="py-1.5 text-center text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
                  {weekdayLetters[i % 7]}
                </span>
              ))}
            </div>
          </div>
          {months.map((monthStart) => {
            const offset = (monthStart.getDay() + 6) % 7;
            const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
            const monthEvents = visibleEvents.filter(
              (e) => e.startMs < addDays(monthStart, daysInMonth).getTime() && e.endMs > monthStart.getTime(),
            );
            const { bars, lanes } = layoutBars(monthStart, daysInMonth, monthEvents, rankOf, true);
            const isThisMonth = monthStart.getFullYear() === today.getFullYear() && monthStart.getMonth() === today.getMonth();
            return (
              <div key={monthStart.getTime()} data-month-ms={monthStart.getTime()} className="flex border-b last:border-b-0" style={{ borderColor: "var(--glass-border)" }}>
                <button
                  type="button"
                  onClick={() => {
                    setCursor(monthStart);
                    changeView("month");
                  }}
                  className="w-[76px] shrink-0 border-r px-2 pt-1.5 text-left text-[12.5px] font-medium transition hover:text-[var(--brand-strong)]"
                  style={{ borderColor: "var(--glass-border)", color: isThisMonth ? "var(--brand-strong)" : "var(--text-main)" }}
                  title="Open this month"
                >
                  {new Intl.DateTimeFormat(undefined, { month: "long" }).format(monthStart)}
                  {monthStart.getMonth() === 0 ? (
                    <span className="block text-[11px] font-normal" style={{ color: "var(--text-muted)" }}>{monthStart.getFullYear()}</span>
                  ) : null}
                </button>
                <div className="relative grid flex-1" style={{ ...cols, minHeight: Math.max(50, 22 + lanes * YEAR_BAR_H + 6) }}>
                  {Array.from({ length: YEAR_COLS }, (_, col) => {
                    const dayIndex = col - offset;
                    const inMonth = dayIndex >= 0 && dayIndex < daysInMonth;
                    if (!inMonth) {
                      return (
                        <div
                          key={col}
                          className="border-r last:border-r-0"
                          style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--text-main) 5%, transparent)" }}
                        />
                      );
                    }
                    const day = addDays(monthStart, dayIndex);
                    const dayMs = day.getTime();
                    const isToday = sameDay(day, today);
                    return (
                      <div
                        key={col}
                        onClick={(e) => {
                          if (canCreate) {
                            openNew(dayMs, true, e);
                            return;
                          }
                          setCursor(day);
                          changeView("day");
                        }}
                        className={`border-r last:border-r-0 ${canCreate ? "cursor-pointer" : ""}`}
                        style={{
                          borderColor: "var(--glass-border)",
                          backgroundColor: isToday ? "color-mix(in srgb, var(--accent-amber) 22%, transparent)" : undefined,
                          boxShadow: isToday ? TODAY_RING : undefined,
                          // Non-workdays crossed out, the same as the other views.
                          backgroundImage: isOffDay(day) ? offDayHatch : undefined,
                        }}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCursor(day);
                            changeView("day");
                          }}
                          className="block w-full px-1 pt-1 text-right text-[11.5px] leading-none hover:text-[var(--brand-strong)]"
                          style={{ color: isToday ? "var(--text-main)" : "var(--text-muted)", fontWeight: isToday ? 600 : 400 }}
                          title={nzPublicHolidayName(day, holidayRegion) ? `${nzPublicHolidayName(day, holidayRegion)} — open this day` : "Open this day"}
                        >
                          {day.getDate()}
                        </button>
                      </div>
                    );
                  })}
                  {/* The month's events: bars across their days, over just this month's columns. */}
                  <div
                    className="pointer-events-none absolute"
                    style={{ top: 21, left: `${(offset / YEAR_COLS) * 100}%`, width: `${(daysInMonth / YEAR_COLS) * 100}%`, height: lanes * YEAR_BAR_H }}
                  >
                    {bars.map((bar) => {
                      const cat = categoryOf(bar.event);
                      const span = bar.endCol - bar.startCol + 1;
                      return (
                        <button
                          key={`${bar.event.id}_${monthStart.getTime()}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openExisting(bar.event, e);
                          }}
                          className="pointer-events-auto absolute truncate px-1 text-left text-[11px] leading-[15px] transition hover:brightness-95 max-md:text-clip"
                          style={{
                            top: bar.lane * YEAR_BAR_H,
                            height: YEAR_BAR_H - 2,
                            left: `calc(${(bar.startCol / daysInMonth) * 100}% + 1px)`,
                            width: `calc(${(span / daysInMonth) * 100}% - 2px)`,
                            backgroundColor: cat.color,
                            color: textOn(cat.color),
                            borderRadius: `${bar.contBefore ? 0 : 4}px ${bar.contAfter ? 0 : 4}px ${bar.contAfter ? 0 : 4}px ${bar.contBefore ? 0 : 4}px`,
                          }}
                          title={`${bar.event.title}${bar.event.allDay ? "" : ` · ${timeText(bar.event.startMs)}`}`}
                        >
                          {!bar.event.allDay && !bar.contBefore ? `${timeText(bar.event.startMs)} ` : ""}
                          {bar.event.title || "Untitled event"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const listView = () => {
    const days = Array.from({ length: LIST_DAYS }, (_, i) => addDays(range.from, i));
    const groups = days
      .map((d) => ({ day: d, items: visibleEvents.filter((e) => overlapsDay(e, d)) }))
      .filter((g) => g.items.length);
    return (
      <div className={`overflow-hidden lg:min-h-0 lg:flex-1 lg:overflow-y-auto ${viewShell.className}`} style={viewShell.style}>
        {groups.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
            No events in the next {LIST_DAYS} days.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.day.getTime()} className="border-b last:border-b-0" style={{ borderColor: "var(--glass-border)" }}>
              <p
                className="sticky top-0 px-4 py-2 text-[12px] font-semibold"
                style={{
                  color: sameDay(g.day, today) ? "var(--brand-strong)" : "var(--text-main)",
                  backgroundColor: sameDay(g.day, today) ? TODAY_TINT : "color-mix(in srgb, var(--text-main) 3%, transparent)",
                }}
              >
                {new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(g.day)} {activeDate(g.day)}
                {sameDay(g.day, today) ? " · Today" : ""}
              </p>
              {g.items.map((e) => {
                const cat = categoryOf(e);
                return (
                  <button
                    key={`${e.id}_${g.day.getTime()}`}
                    type="button"
                    onClick={(ev) => openExisting(e, ev)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)]"
                  >
                    <span className="w-[92px] shrink-0 text-[12px]" style={{ color: "var(--text-muted)" }}>
                      {e.allDay || e.endMs - e.startMs >= DAY_MS ? "All day" : `${timeText(e.startMs)} – ${timeText(e.endMs)}`}
                    </span>
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: cat.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-normal" style={{ color: "var(--text-main)" }}>{e.title || "Untitled event"}</span>
                      <span className="block truncate text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                        {[cat.name, e.location, e.projectName].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------- category filter
  const allCategories = useMemo(() => {
    const hasUncategorised = events.some((e) => !categoryById.has(e.categoryId) && levelOf(e.categoryId) !== "none");
    const seen = categories.filter((cat) => levelOf(cat.id) !== "none");
    return hasUncategorised ? [...seen, UNCATEGORISED] : seen;
  }, [categories, categoryById, events, levelOf]);
  const categoryFilter = (
    <div className="grid gap-0.5">
      {allCategories.map((c) => {
        const on = !hidden.has(c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => toggleHidden(c.id)}
            className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left text-[13px] font-medium transition hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)]"
            style={{ color: on ? "var(--text-main)" : "var(--text-muted)" }}
          >
            <span
              className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 transition"
              style={{ borderColor: c.color, backgroundColor: on ? c.color : "transparent" }}
            >
              {on ? <span className="text-[11px] font-bold" style={{ color: textOn(c.color) }}>✓</span> : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
          </button>
        );
      })}
      {allCategories.length === 0 ? (
        <p className="px-2 text-[12px]" style={{ color: "var(--text-muted)" }}>No categories yet — add them in Company Settings › Calendar.</p>
      ) : null}
    </div>
  );
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  // The phone's category list (in the toolbar) closes on a press anywhere outside the toolbar.
  useEffect(() => {
    if (!mobileFilterOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (toolbarRef.current?.contains(event.target as Node)) return;
      setMobileFilterOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [mobileFilterOpen]);

  // ---------------------------------------------------------------- render
  if (access.status === "loading") {
    return <div className="p-6 text-[13px]" style={{ color: "var(--text-muted)" }}>Checking access...</div>;
  }
  if (!canView) {
    return (
      <div className="m-4 rounded-[16px] border p-6 text-[13px] font-semibold" style={{ ...cardStyle, color: "var(--text-muted)" }}>
        You don&apos;t have access to the calendar. Ask an admin to give your role the &ldquo;View Calendar&rdquo; permission.
      </div>
    );
  }

  const filteredProjects = projects
    .filter((p) => {
      if (isProjectArchived(p)) return false;
      const q = projectQuery.trim().toLowerCase();
      if (!q) return true;
      return [p.name, p.customer, p.clientAddress].join(" ").toLowerCase().includes(q);
    })
    .slice(0, 8);
  const d = draft ?? renderedDraft;
  const readOnly = !d || (d.isNew ? !canCreate : !canEditEvent(d));
  // Linking a project to the event, in its pop-up (withProjectLinked).
  const linkDraftProject = (p: Project) => {
    setDraft((prev) => (prev ? withProjectLinked(prev, p) : prev));
    setProjectFieldFor("");
    setProjectQuery("");
    setTitleSuggestIndex(-1);
  };
  // Someone taken off the event, or its project unlinked, in the pop-up — and the Undo bar, putting it back: into the
  // pop-up while it's still open on that event; closed by then (saved without it), onto the saved event — but only if
  // the saved event had it (closed without saving, nothing changed). putBackOnSaved: null when it's back already.
  const offerDraftUndo = (
    message: string,
    eventId: string,
    savedHad: boolean,
    putBackInDraft: (draft: Draft) => Draft,
    putBackOnSaved: (event: CalendarEvent) => CalendarEvent | null,
  ) =>
    offerUndo(message, () => {
      if (draftRef.current?.id === eventId) {
        setDraft((prev) => (prev && prev.id === eventId ? putBackInDraft(prev) : prev));
        return;
      }
      const saved = savedHad ? eventsRef.current.find((e) => e.id === eventId) : undefined;
      const next = saved ? putBackOnSaved(saved) : null;
      if (next && companyId) return saveCalendarEvent(companyId, editedByMe(next));
    });
  const takeDraftStaffOff = (uid: string, name: string) => {
    if (!draft) return;
    const eventId = draft.id;
    const index = draftStaffUids(draft).indexOf(uid);
    const saved = events.find((e) => e.id === eventId);
    const putBack = (uids: string[]) => (uids.includes(uid) ? uids : insertAt(uids, index, uid));
    setDraft((prev) => (prev ? { ...prev, staffUids: draftStaffUids(prev).filter((v) => v !== uid) } : prev));
    offerDraftUndo(
      `${name} removed`,
      eventId,
      Boolean(saved && draftStaffUids(saved).includes(uid)),
      (prev) => ({ ...prev, staffUids: putBack(draftStaffUids(prev)) }),
      (event) => (draftStaffUids(event).includes(uid) ? null : { ...event, staffUids: putBack(draftStaffUids(event)) }),
    );
  };
  // Unlinking its project: its people stay on as staff (each can be taken off on their own).
  const unlinkDraftProject = () => {
    if (!draft || !draft.projectId) return;
    const { id: eventId, projectId, projectName, showToClient } = draft;
    const saved = events.find((e) => e.id === eventId);
    setDraft((prev) => (prev ? { ...prev, projectId: "", projectName: "", showToClient: false, staffUids: draftStaffUids(prev) } : prev));
    offerDraftUndo(
      `${projectName || "Project"} unlinked`,
      eventId,
      saved?.projectId === projectId,
      (prev) => (prev.projectId ? prev : { ...prev, projectId, projectName, showToClient }),
      (event) => (event.projectId ? null : { ...event, projectId, projectName, showToClient }),
    );
  };
  // What its title sounds like: the projects (not archived) it's most likely about, best first — only while a new event's
  // title is first being typed (not an event being edited, nor once the title's been left — passed over, they don't keep
  // coming back), with no project linked and them not put away ("Not now").
  const titleSuggestions =
    d && !readOnly && d.isNew && !d.projectId && titleSuggestDismissedFor !== d.id && titleLeftFor !== d.id
      ? matchProjectsToText(
          d.title,
          projects.filter((p) => !isProjectArchived(p)),
          3,
        )
      : [];
  // The Project field's dropdown, while it's in use. Typing: what matches. Nothing typed: the projects the title sounds
  // like, best first, then Show all for every other project under them — or, with none like it, the first few projects
  // (Show all for the rest).
  const projectFieldOpen = Boolean(d && !readOnly && !d.projectId && projectFieldFor === d.id);
  const projectFieldBrowsing = projectFieldOpen && !projectQuery.trim();
  const unarchivedProjects = projects.filter((p) => !isProjectArchived(p));
  const projectFieldTitleMatches = projectFieldBrowsing && d ? matchProjectsToText(d.title, unarchivedProjects, 5).map((m) => m.project) : [];
  const projectFieldShowsTitleMatches = projectFieldTitleMatches.length > 0;
  const projectFieldOthers = projectFieldBrowsing ? unarchivedProjects.filter((p) => !projectFieldTitleMatches.includes(p)) : [];
  const projectFieldOptions = !projectFieldOpen
    ? []
    : !projectFieldBrowsing
      ? filteredProjects
      : projectFieldShowsTitleMatches
        ? projectFieldTitleMatches
        : projectFieldOthers.slice(0, 8);
  const projectFieldMore = !projectFieldBrowsing ? [] : projectFieldShowsTitleMatches ? projectFieldOthers : projectFieldOthers.slice(8);
  const projectFieldShowAll = Boolean(d && projectFieldShowAllFor === d.id);
  // The title's suggestions' Show all: every other project, under them.
  const titleSuggestOthers = titleSuggestions.length ? unarchivedProjects.filter((p) => !titleSuggestions.some((m) => m.project === p)) : [];
  const titleSuggestShowAll = Boolean(d && titleSuggestShowAllFor === d.id);
  // The event view's "…" menu: Duplicate (not for an event whose project they can't open — its details are
  // hidden) and Delete Event (asks first, in the bottom bar).
  const eventMenuItems: GlassActionMenuItem[] =
    d && !d.isNew
      ? [
          ...(canCreate && !restrictedIds.has(d.id) ? [{ key: "duplicate", label: "Duplicate", icon: <Copy size={14} />, onSelect: duplicateDraft }] : []),
          ...(!readOnly
            ? [{ key: "delete", label: "Delete Event", icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirmDelete(true) }]
            : []),
        ]
      : [];
  const draftCategory = d ? categoryById.get(d.categoryId) ?? UNCATEGORISED : UNCATEGORISED;
  // A person's emblem: their initials on their colour.
  const staffEmblem = (uid: string, name: string, title?: string) => (
    <span
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
      style={{ backgroundColor: (uid === user?.uid ? String(user?.userColor || "") : "") || memberColorByUid[uid] || "#7D99B3" }}
      title={title}
    >
      {nameInitials(name)}
    </span>
  );
  // The event's staff, by name (anyone no longer in the company left out).
  const staffNameByUid = new Map(staffMembers.map((m) => [m.uid, m.name]));
  const draftStaff = d
    ? draftStaffUids(d)
        .map((uid) => ({ uid, name: staffNameByUid.get(uid) || (uid === user?.uid ? String(user?.displayName || "") : "") }))
        .filter((m) => m.name)
    : [];
  // Add staff: everyone not on it yet — each with their coloured initials (staffEmblem), as on the event.
  const staffOptions = d
    ? staffMembers
        .filter((m) => !draftStaffUids(d).includes(m.uid))
        .map((m) => ({ value: m.uid, label: m.name, icon: staffEmblem(m.uid, m.name) }))
    : [];
  // Existing events open read-only first (and always, for people who can't edit).
  const viewingEvent = Boolean(d && !d.isNew && (eventMode === "view" || readOnly));
  const viewEvent = d && viewingEvent ? eventFromDraft(d) : null;
  // The pop-up is themed by the event's category — viewing or editing it, and a new event by the category
  // chosen for it ("" = it has none: the plain pop-up).
  const themeColor = d ? (d.isNew ? categoryById.get(d.categoryId)?.color ?? "" : draftCategory.color) : "";
  // A project in the Project field's dropdown: its name ("Best match" by the title's closest), its client and address,
  // and Link.
  const projectFieldRow = (p: Project, bestMatch: boolean) => (
    <button
      key={p.id}
      type="button"
      role="option"
      aria-selected={false}
      // (Not taking the focus from the field, which would close the dropdown first.)
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => linkDraftProject(p)}
      className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--brand)_9%,transparent)]"
    >
      <FolderKanban size={15} className="shrink-0" style={{ color: themeColor || "var(--brand-strong)" }} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
            {p.name}
          </span>
          {bestMatch ? (
            <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.5px]" style={{ color: "var(--brand-strong)" }}>
              Best match
            </span>
          ) : null}
        </span>
        <span className="block truncate text-[11.5px] font-normal" style={{ color: "var(--text-muted)" }}>
          {[p.customer, p.clientAddress].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="glass-shine shrink-0 rounded-full border px-3 py-0.5 text-[11.5px] font-semibold text-white" style={glassShineStyle(themeColor || "var(--brand)")}>
        Link
      </span>
    </button>
  );
  // Phones, month view: the page is laid out to exactly fill the screen, so the month's six weeks fit
  // under the toolbar with 20px clear at the bottom (where the phone's rounded corners cut in).
  const fillMonth = isMobile && view === "month";
  // "Added by <name> · <how long ago>" with the person's emblem, and under it "Modified by <name> · <how long ago>"
  // once someone's changed it (hover either for the date), as of when the pop-up opened — in its bottom bar. compact (the edit
  // form's bottom bar, which is busy): just the "Added by" line, and on phones just the emblem.
  const addedBy = (className: string, compact = false) => {
    if (!d) return null;
    const auditLine = (label: string, name: string, iso: string) => {
      const ago = timeAgo(iso, popupOpenedAtMs);
      return (
        <span className="min-w-0 truncate" title={`${label} ${name}${ago ? ` on ${activeDate(iso)}` : ""}`}>
          {label} {name}
          {ago ? <span> · {ago}</span> : null}
        </span>
      );
    };
    return (
      <div className={`flex items-center gap-2 text-[12.5px] font-medium ${className}`} style={{ color: "var(--text-main)" }}>
        {staffEmblem(d.createdByUid, d.createdByName, `Added by ${d.createdByName}`)}
        <span className={`min-w-0 flex-col leading-[1.35] ${compact ? "hidden md:flex" : "flex"}`}>
          {auditLine("Added by", d.createdByName, d.createdAtIso)}
          {!compact && d.updatedByUid ? auditLine("Modified by", d.updatedByName || "someone", d.updatedAtIso) : null}
        </span>
      </div>
    );
  };

  return (
    <div
      // Swipes here are the calendar's own (months, drags): never the app's pull-down menu or side drawers.
      data-app-gesture-exempt="true"
      // Cancels app-shell's own <main> padding (12px / safe area at the sides, set inline there; 12px/16px
      // on top; 12px at the bottom on phones only), so the 12px gap below is the only gap on every side.
      // The calendar app (chromeless): <main> has no padding then, so there's nothing to cancel — just keep
      // clear of the notch / rounded corners, and cover all of <main> so every touch on it is the
      // calendar's (never the app's pull-down menu).
      className={chromeless ? "flex min-h-full flex-col" : "-mt-3 flex flex-col md:-mt-4 max-lg:-mb-3"}
      style={
        chromeless
          ? {
              paddingTop: "env(safe-area-inset-top, 0px)",
              paddingLeft: "env(safe-area-inset-left, 0px)",
              paddingRight: "env(safe-area-inset-right, 0px)",
              height: fillMonth ? "100%" : undefined,
            }
          : {
              marginLeft: "calc(-1 * max(12px, env(safe-area-inset-left)))",
              marginRight: "calc(-1 * max(12px, env(safe-area-inset-right)))",
              // fillMonth: exactly <main>'s height — its 12px top padding and its bottom padding (12px, or the
              // home-indicator area) taken back.
              ...(fillMonth
                ? {
                    height: "calc(100% + 12px + max(12px, env(safe-area-inset-bottom)))",
                    marginBottom: "calc(-1 * max(12px, env(safe-area-inset-bottom)))",
                  }
                : {}),
            }
      }
    >
      {/* Desktop: exactly fills the space under the 48px top bar (min 640px on a very short window); the
          calendar app has no top bar. Phones in month view: fills the screen, 20px clear at the bottom. */}
      <div
        // A computer: the sidebar, the calendar, and the Schedule panel's column (as wide as the panel — none while it's
        // closed). The gaps are the sidebar's margin and the panel's padding, so a closed panel leaves none.
        className={`grid w-full gap-3 lg:grid-cols-[252px_minmax(0,1fr)_auto] lg:gap-x-0 ${fillMonth ? "min-h-0 flex-1 grid-rows-[minmax(0,1fr)] px-3 pb-5 pt-3" : "p-3"} ${
          chromeless ? "lg:h-[max(640px,100dvh)]" : "lg:h-[max(640px,calc(100dvh-48px))]"
        }`}
      >
        {/* Sidebar: categories to show/hide (desktop). */}
        <aside className={`hidden h-fit flex-col gap-3 rounded-[20px] border p-3.5 lg:sticky lg:mr-3 lg:flex ${chromeless ? "lg:top-3" : "lg:top-[60px]"}`} style={cardStyle}>
          <div className="flex items-center gap-2 px-1.5 text-[18px] font-bold" style={{ color: "var(--text-main)" }}>
            <CalendarDays size={18} strokeWidth={2.1} />
            Calendar
          </div>
          {canCreate ? (
            <button
              type="button"
              onClick={(e) => openNew(newEventStartMs(), true, e)}
              // (Round-ended, with the glass shine in the brand blue — as the sidebar's New Project.)
              className="glass-shine inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-[12.5px] font-semibold text-white transition hover:brightness-105"
              style={glassShineStyle("var(--brand)")}
            >
              <Plus size={15} /> New event
            </button>
          ) : null}
          {canCreate ? (
            <button
              type="button"
              onClick={() => setSchedulePanelOpen((v) => !v)}
              aria-pressed={schedulePanelOpen}
              className={`${pillButtonClass} h-9`}
              style={schedulePanelOpen ? { borderColor: "var(--brand)", color: "var(--brand-strong)" } : undefined}
            >
              <FolderKanban size={14} /> Schedule a project
            </button>
          ) : null}
          <p className="px-2 pt-1 text-[10.5px] font-bold uppercase tracking-[0.8px]" style={{ color: "var(--text-muted)" }}>Categories</p>
          {categoryFilter}
        </aside>

        {/* The Schedule panel (a computer): the grid's third column, after the calendar — its width slides open from
            nothing, the calendar giving way as it does. (Its width, not the grid's columns: Chrome doesn't animate those
            here.) Its 12px padding before it is the gap; out past the grid's top, bottom and right by its padding, so its
            shadow isn't cut off there. Faded out as it closes. */}
        <div
          className="hidden min-h-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none lg:col-start-3 lg:row-start-1 lg:block"
          style={{
            width: schedulePanelOpen ? SCHEDULE_PANEL_W + 12 : 0,
            marginTop: -12,
            marginBottom: -12,
            marginRight: -12,
            paddingTop: 12,
            paddingBottom: 12,
          }}
          inert={!schedulePanelOpen}
          aria-hidden={!schedulePanelOpen}
        >
          <div
            className="h-full transition-opacity duration-200 motion-reduce:transition-none"
            style={{ width: SCHEDULE_PANEL_W + 12, paddingLeft: 12, paddingRight: 12, opacity: schedulePanelOpen ? 1 : 0 }}
          >
            <ProjectSchedulePanel
              projects={scheduleProjects}
              linkedEvents={linkedEvents}
              loaded={linkedEventsLoaded && projectsLoaded}
              onClose={() => setSchedulePanelOpen(false)}
              onDragStart={beginProjectDrag}
              onDragEnd={endProjectDrag}
              onPick={(project, e) => openNew(newEventStartMs(), true, e, project)}
            />
          </div>
        </div>

        {/* A <div>, not a <main>: app/globals.css locks every <main> (overflow-y hidden) while a pop-up is
            open on phones, which on this one also made it clip sideways — cutting 12px off each edge of the
            edge-to-edge views (the bar that showed behind the event pop-up's blur). App-shell's own <main>
            is the page's main. */}
        <div className={`flex min-w-0 flex-col gap-3 lg:min-h-0 ${fillMonth ? "min-h-0" : ""}`}>
          {/* Toolbar */}
          {/* (On a phone: snug — 6px round it, out into the page's 12px and the gaps above and below it, and less padding in it.) */}
          <div ref={toolbarRef} className="rounded-[20px] border px-3 py-2.5 max-md:-mx-1.5 max-md:-my-1.5 max-md:p-2" style={cardStyle}>
          {/* A phone wraps the view switcher onto its own row; a computer keeps one row, the search box giving up
              some width (down to 150px) before the title truncates. */}
          {/* (With the Schedule panel open on a narrow window, it wraps rather than running under the panel.) */}
          <div className={`flex flex-wrap items-center gap-2 md:flex-nowrap ${schedulePanelOpen ? "lg:flex-wrap" : ""}`}>
            <button type="button" onClick={() => setCursor(startOfDay(new Date()))} className={pillButtonClass}>
              Today
            </button>
            {isMobile ? (
              // Phone: Previous and Next either side of the title, centred between them — big enough to tap easily.
              <div className="flex min-w-0 flex-1 items-center">
                <button type="button" onClick={() => step(-1)} className={mobileStepButtonClass} aria-label="Previous">
                  <ChevronLeft size={24} />
                </button>
                <h1 className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold" style={{ color: "var(--text-main)" }}>{title}</h1>
                <button type="button" onClick={() => step(1)} className={mobileStepButtonClass} aria-label="Next">
                  <ChevronRight size={24} />
                </button>
              </div>
            ) : (
              // Computer: Previous and Next either side of the title, the three centred in the space between Today and
              // the view switcher. It takes the spare width, and gives up almost none while the search box can.
              <div className="flex min-w-0 flex-[1_0.05_auto] items-center justify-center gap-1">
                <button type="button" onClick={() => step(-1)} className={desktopStepButtonClass} aria-label="Previous">
                  <ChevronLeft size={20} />
                </button>
                <h1 className="min-w-0 truncate text-center text-[17px] font-semibold" style={{ color: "var(--text-main)" }}>{title}</h1>
                <button type="button" onClick={() => step(1)} className={desktopStepButtonClass} aria-label="Next">
                  <ChevronRight size={20} />
                </button>
              </div>
            )}
            {/* On a phone, just the filter icon (a round button, as tall as Today), the size of the search button's.
                (Without the pill's phone padding, which squeezed the icon to a sliver.) */}
            <button
              type="button"
              onClick={() => setMobileFilterOpen((v) => !v)}
              className={`${pillButtonClass.replace("max-md:px-4", "max-md:px-0")} max-md:w-10 lg:hidden`}
              aria-label="Categories"
              title="Categories"
            >
              <Filter size={14} className="shrink-0 max-md:h-4 max-md:w-4" />
              <span className="max-md:hidden">Categories</span>
            </button>
            {/* The view in use in the blue fill, so it's clear which it is; fully rounded, like Today. On a phone
                it's its own row across the toolbar, filling it. At its right, the round search button: tapped, it
                widens to the left across the row (its search icon riding its left edge), covering the switcher, and
                is the search box from there; its X closes it back the same way, clearing the search (a tap elsewhere
                only does once it's empty — see leaveEventSearch). */}
{isMobile ? (
            <div ref={eventSearchRowRef} className={`relative flex items-center gap-2 ${isMobile ? "w-full" : ""}`}>
              <div className={isMobile ? "min-w-0 flex-1" : ""} inert={isEventSearchOpen}>
                <Segmented
                  size={isMobile ? "lg" : "sm"}
                  tone="brand"
                  pill
                  fill={isMobile}
                  strongText
                  value={view}
                  options={CALENDAR_VIEW_OPTIONS}
                  onChange={changeView}
                />
              </div>
              {/* The search button's own place in the row — a circle the switcher's height (bigger on a phone). */}
              <span aria-hidden className="shrink-0" style={{ width: searchPillPx, height: searchPillPx }} />
              <div
                // z-[2]: over the switcher's options (z-[1]) as it slides across them. Its own outline is only
                // while it's the round button on its own: once it joins the switcher, the row's outline (below)
                // is the one outline round both, so its curved edge never shows crossing the switcher.
                className="peer absolute inset-y-0 right-0 z-[2] flex items-center overflow-hidden rounded-full border"
                style={{
                  width: isEventSearchOpen ? "100%" : searchPillPx,
                  transition: "width 320ms cubic-bezier(0.22, 1, 0.36, 1), border-color 120ms ease",
                  borderColor: isEventSearchOpen ? "transparent" : "var(--glass-border)",
                  backgroundColor: "var(--panel-bg)",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!isEventSearchOpen) openEventSearch();
                  }}
                  className="inline-flex h-full shrink-0 items-center justify-center"
                  style={{ width: searchPillPx - 2, color: isEventSearchOpen ? "var(--text-muted)" : "var(--text-main)", cursor: isEventSearchOpen ? "default" : undefined }}
                  aria-label="Search events"
                  title="Search events"
                  tabIndex={isEventSearchOpen ? -1 : 0}
                >
                  <Search size={16} />
                </button>
                <input
                  ref={eventSearchInputRef}
                  value={eventSearch}
                  onChange={(e) => changeEventSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") leaveEventSearch();
                  }}
                  placeholder="Search events"
                  aria-label="Search events"
                  autoComplete="off"
                  tabIndex={isEventSearchOpen ? 0 : -1}
                  className="h-full min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none max-md:text-[15px]"
                  style={{ color: "var(--text-main)", opacity: isEventSearchOpen ? 1 : 0, transition: "opacity 180ms ease 120ms" }}
                />
                <button
                  type="button"
                  onClick={() => closeEventSearch(true)}
                  className="mr-1 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full transition hover:bg-[color-mix(in_srgb,var(--text-main)_7%,transparent)]"
                  style={{ color: "var(--text-muted)", opacity: isEventSearchOpen ? 1 : 0, transition: "opacity 180ms ease 120ms", pointerEvents: isEventSearchOpen ? undefined : "none" }}
                  aria-label="Clear search"
                  title="Clear search"
                  tabIndex={isEventSearchOpen ? 0 : -1}
                >
                  <X size={15} />
                </button>
              </div>
              {/* While searching: one outline round the switcher and the search together (blue while typing). */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 z-[3] rounded-full border border-[var(--glass-border)] transition-[opacity,border-color] duration-150 peer-focus-within:border-[var(--brand)]"
                style={{ opacity: isEventSearchOpen ? 1 : 0 }}
              />
            </div>
            ) : (
              // Computer: the view switcher, and right of it the search box — always open.
              <div className="flex min-w-0 items-center gap-2">
                <div className="shrink-0">
                  <Segmented size="sm" tone="brand" pill strongText value={view} options={CALENDAR_VIEW_OPTIONS} onChange={changeView} />
                </div>
                <label
                  className="flex h-[34px] w-[240px] min-w-[150px] items-center gap-2 rounded-full border border-[var(--glass-border)] px-3 transition-colors focus-within:border-[var(--brand)]"
                  style={{ backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}
                >
                  <Search size={15} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                  <input
                    value={eventSearch}
                    onChange={(e) => changeEventSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") changeEventSearch("");
                    }}
                    placeholder="Search events"
                    aria-label="Search events"
                    autoComplete="off"
                    className="h-full min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none"
                    style={{ color: "var(--text-main)" }}
                  />
                  {eventSearch ? (
                    <button
                      type="button"
                      onClick={() => changeEventSearch("")}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition hover:bg-[color-mix(in_srgb,var(--text-main)_7%,transparent)]"
                      style={{ color: "var(--text-muted)" }}
                      aria-label="Clear search"
                      title="Clear search"
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                </label>
              </div>
            )}
          </div>
          {/* Phones/tablets: Categories opens the category list here, in the toolbar under the view switcher, sliding
              down (and back up on Categories again, or a press anywhere outside the toolbar). */}
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none lg:hidden"
            style={{ gridTemplateRows: mobileFilterOpen ? "1fr" : "0fr" }}
            inert={!mobileFilterOpen}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="pt-2.5" style={{ opacity: mobileFilterOpen ? 1 : 0, transition: "opacity 200ms ease" }}>
                {categoryFilter}
              </div>
            </div>
          </div>
          </div>
          {loadError ? (
            <p className="rounded-[12px] px-3 py-2 text-[12.5px] font-medium" style={{ backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}>{loadError}</p>
          ) : null}

          <div
            ref={viewWrapRef}
            className={`relative lg:flex lg:min-h-0 lg:flex-1 lg:flex-col ${fillMonth ? "flex min-h-0 flex-1 flex-col" : ""}`}
            onPointerDown={onDaySwipeDown}
            onPointerMove={onDaySwipeMove}
            onPointerUp={onDaySwipeUp}
            onPointerCancel={onDaySwipeUp}
          >
            {view === "year" ? yearView() : view === "month" ? monthView() : view === "list" ? listView() : timeGrid()}
          </div>
        </div>
      </div>

      {/* Phones/tablets: New event, as a floating round + at the bottom right of the screen (portalled so
          it's fixed to the screen whatever the page around it does). */}
      {canCreate && typeof document !== "undefined"
        ? createPortal(
            <button data-bottom-bar=""
              type="button"
              onClick={(e) => openNew(newEventStartMs(), true, e)}
              // (The glass shine in the brand blue — its float shadow kept, with the shine's highlight along its top.)
              className="glass-shine fixed right-4 z-[60] inline-flex h-14 w-14 items-center justify-center rounded-full text-white transition hover:brightness-105 active:scale-95 lg:hidden"
              style={glassShineStyle("var(--brand)", {
                bottom: "calc(20px + env(safe-area-inset-bottom))",
                boxShadow: "0 10px 28px rgba(15,23,42,0.28), inset 0 1px 0 rgba(255,255,255,0.5)",
              })}
              aria-label="New event"
              title="New event"
            >
              <Plus size={28} strokeWidth={2.4} />
            </button>,
            document.body,
          )
        : null}

      {/* Event pop-up */}
      {shouldRenderModal && d && typeof document !== "undefined"
        ? createPortal(
            <div
              data-app-gesture-exempt="true"
              // Phones: a new event focuses its title straight away, so the keyboard comes up at once — that
              // pop-up sits at the top, clear of it. Viewing or editing an event (nothing focused) opens
              // centred. Moving and sizing it to the visible area once the keyboard is up is
              // .glass-modal-panel's job (app/globals.css), the same as every other pop-up — in either spot.
              className={`fixed inset-0 z-[1700] flex justify-center px-3 py-3 md:items-center md:px-4 md:py-4 ${d.isNew ? "items-start" : "items-center"}`}
            >
              <button type="button" aria-label="Close" onClick={closeModalUnlessEdited} className="glass-modal-backdrop absolute inset-0" />
              <div
                ref={modalPanelRef}
                className="glass-modal-panel relative z-[1701] flex max-h-full w-full max-w-[560px] flex-col overflow-hidden md:max-h-[calc(100svh-32px)]"
              >
                {/* Themed by the event's category: a wash of its colour over the glass, behind everything
                    in the pop-up (the panel is its own stacking context). Fades between colours as the
                    category is changed. */}
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={popupTintStyle(themeColor)} />
                {viewingEvent && viewEvent ? (
                  <>
                    <div className="relative px-5 pb-4 pt-5">
                      <div className="absolute right-3 top-3 flex items-center gap-1">
                        {(() => {
                          // Its bell: subscribed (reminded before it at your own reminder times), or not. Someone on
                          // it is reminded anyway — theirs just shows it.
                          const me = String(user?.uid || "").trim();
                          const live = events.find((e) => e.id === d.id);
                          const onIt = Boolean(me && live?.staffUids?.includes(me));
                          const subscribed = onIt || Boolean(me && live?.subscriberUids?.includes(me));
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                setEventBellWobbleKey((prev) => prev + 1);
                                void setEventSubscribed(d.id, !subscribed);
                              }}
                              disabled={!me || onIt || subscribingEventId === d.id}
                              aria-pressed={subscribed}
                              aria-label={subscribed ? "Unsubscribe from this event" : "Subscribe to this event"}
                              title={
                                onIt
                                  ? "You're on this event, so you're reminded before it already."
                                  : subscribed
                                    ? "Subscribed — you'll be reminded before it at your reminder times (User Settings). Click to unsubscribe."
                                    : "Subscribe — get reminded before it at your reminder times (User Settings)."
                              }
                              className={`${eventMenuButtonClass} disabled:cursor-default`}
                            >
                              <span key={eventBellWobbleKey} className={eventBellWobbleKey > 0 ? "inline-flex bell-wobble" : "inline-flex"}>
                                <SubscribeBellIcon on={subscribed} />
                              </span>
                            </button>
                          );
                        })()}
                        {eventMenuItems.length ? (
                          <GlassActionMenu items={eventMenuItems} ariaLabel="More options" openWithOneItem menuMinWidth={180} triggerClassName={eventMenuButtonClass}>
                            <MoreHorizontal size={16} />
                          </GlassActionMenu>
                        ) : null}
                        <button type="button" onClick={closeModal} className={modalCloseButtonClass} aria-label="Close">
                          <X size={16} />
                        </button>
                      </div>
                      <span
                        className="inline-flex max-w-[calc(100%-100px)] items-center gap-1.5 truncate rounded-full border px-2.5 py-[3px] text-[12px] font-medium"
                        style={{
                          borderColor: `color-mix(in srgb, ${draftCategory.color} 45%, transparent)`,
                          backgroundColor: `color-mix(in srgb, ${draftCategory.color} 18%, transparent)`,
                          color: "var(--text-main)",
                        }}
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: draftCategory.color }} />
                        {draftCategory.name}
                      </span>
                      <h2 className="mt-2.5 pr-24 text-[22px] font-semibold leading-tight" style={{ color: "var(--text-main)" }}>
                        {viewEvent.title || "Untitled event"}
                      </h2>
                      {(() => {
                        const when = eventWhenText(viewEvent, (date) => activeDate(date));
                        return (
                          <div className="mt-2 flex items-start gap-2.5">
                            <span
                              className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
                              style={{ backgroundColor: draftCategory.color, color: textOn(draftCategory.color) }}
                            >
                              <Clock size={17} />
                            </span>
                            <div className="min-w-0">
                              <p className="text-[15px] font-medium" style={{ color: "var(--text-main)" }}>{when.primary}</p>
                              <p className="text-[13.5px]" style={{ color: "var(--text-main)" }}>{when.secondary}</p>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 pb-4">
                      {viewEvent.location ? (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(viewEvent.location)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 rounded-[14px] border px-3 py-2.5 transition hover:brightness-95"
                          style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}
                        >
                          <MapPin size={17} className="shrink-0" style={{ color: draftCategory.color }} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[11px] font-semibold uppercase tracking-[0.5px]" style={{ color: "var(--text-main)" }}>Location</span>
                            <span className="block truncate text-[14px]" style={{ color: "var(--text-main)" }}>{viewEvent.location}</span>
                          </span>
                          <ExternalLink size={14} style={{ color: "var(--text-muted)" }} />
                        </a>
                      ) : null}
                      {viewEvent.projectId ? (
                        <div
                          className="overflow-hidden rounded-[14px] border"
                          style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}
                        >
                          {/* On a computer, the project opens in a new Chrome tab (openEventProject). */}
                          <Link
                            href={`/projects/${viewEvent.projectId}`}
                            onClick={(event) => openEventProject(event, viewEvent.projectId)}
                            className="flex items-center gap-3 px-3 py-2.5 transition hover:brightness-95"
                          >
                            <FolderKanban size={17} className="shrink-0" style={{ color: draftCategory.color }} />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[11px] font-semibold uppercase tracking-[0.5px]" style={{ color: "var(--text-main)" }}>Project</span>
                              <span className="block truncate text-[14px]" style={{ color: "var(--text-main)" }}>{viewEvent.projectName || "Linked project"}</span>
                            </span>
                            <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
                          </Link>
                          {/* Saves straight away; people who can't edit this event just see its state. */}
                          <div className="flex items-center justify-between gap-3 border-t px-3 py-2" style={{ borderColor: "var(--glass-border)" }}>
                            <span className="min-w-0 text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                              Show on client portal
                            </span>
                            <GlassSwitch
                              checked={viewEvent.showToClient}
                              disabled={readOnly}
                              onChange={(on) => void setEventShowToClient(viewEvent.id, on)}
                              ariaLabel="Show on client portal"
                            />
                          </div>
                        </div>
                      ) : null}
                      {draftStaff.length ? (
                        <div
                          className="flex items-start gap-3 rounded-[14px] border px-3 py-2.5"
                          style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}
                        >
                          <Users size={17} className="mt-0.5 shrink-0" style={{ color: draftCategory.color }} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.5px]" style={{ color: "var(--text-main)" }}>Staff</p>
                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
                              {draftStaff.map((m) => (
                                <span key={m.uid} className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-[14px]" style={{ color: "var(--text-main)" }}>
                                  {staffEmblem(m.uid, m.name)}
                                  <span className="truncate">{m.name}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {modalError ? (
                        <p className="text-[12px] font-medium" style={{ color: "var(--danger-strong)" }}>{modalError}</p>
                      ) : null}
                      {viewEvent.notes.trim() ? (
                        <div className="rounded-[14px] border px-3 py-2.5" style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.5px]" style={{ color: "var(--text-main)" }}>Notes</p>
                          <p className="mt-0.5 whitespace-pre-wrap text-[14px]" style={{ color: "var(--text-main)" }}>{viewEvent.notes}</p>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
                      {confirmDelete && !readOnly ? (
                        // … > Delete Event: asks first.
                        <>
                          <p className="mr-auto min-w-0 truncate text-[13.5px] font-medium" style={{ color: "var(--text-main)" }}>
                            Delete this event?
                          </p>
                          <button type="button" onClick={() => setConfirmDelete(false)} disabled={saving} className={secondaryButtonClass}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeDraft()}
                            disabled={saving}
                            className={primaryButtonClass}
                            style={{ backgroundImage: "var(--danger-gradient)" }}
                          >
                            <Trash2 size={14} /> {saving ? "Deleting..." : "Delete"}
                          </button>
                        </>
                      ) : (
                      <>
                      {d.createdByName ? addedBy("mr-auto min-w-0") : <span className="mr-auto" />}
                      {!readOnly ? (
                        // On a phone, just the pencil (a square button).
                        <button
                          type="button"
                          onClick={() => setEventMode("edit")}
                          className={`${primaryButtonClass} max-md:w-9 max-md:px-0`}
                          style={categoryButtonStyle(draftCategory.color)}
                          aria-label="Edit"
                          title="Edit"
                        >
                          <Pencil size={14} className="max-md:h-4 max-md:w-4" />
                          <span className="max-md:hidden">Edit</span>
                        </button>
                      ) : null}
                      </>
                      )}
                    </div>
                  </>
                ) : (
                <>
                <GlassModalHeader
                  title={d.isNew ? "New event" : readOnly ? "Event" : "Edit event"}
                  icon={<span className="block h-3.5 w-3.5 rounded-full transition-colors" style={{ backgroundColor: draftCategory.color }} />}
                  onClose={closeModal}
                />
                <form
                  className="flex min-h-0 flex-1 flex-col"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitDraft();
                  }}
                >
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                    {/* The title, with its suggestions dropping down over what's under it (not pushing it down). */}
                    <div className="relative">
                      <input
                        ref={(el) => {
                          titleInputRef.current = el;
                          // New event: the cursor goes in the title straight away, without scrolling the page.
                          if (el && d.isNew && focusedDraftIdRef.current !== d.id) {
                            focusedDraftIdRef.current = d.id;
                            el.focus({ preventScroll: true });
                          }
                        }}
                        readOnly={readOnly}
                        value={d.title}
                        onChange={(e) => {
                          setDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev));
                          setModalError("");
                          setTitleSuggestIndex(-1);
                          setTitleTypedFor(d.id);
                          setTitleSuggestShowAllFor("");
                        }}
                        // Its suggestions (under it): ↑ / ↓ through them, Enter links the one picked, Esc puts them away.
                        onKeyDown={(e) => {
                          if (!titleSuggestions.length) return;
                          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                            e.preventDefault();
                            setTitleSuggestIndex((index) =>
                              e.key === "ArrowDown" ? Math.min(titleSuggestions.length - 1, index + 1) : Math.max(-1, index - 1),
                            );
                          } else if (e.key === "Enter" && titleSuggestions[titleSuggestIndex]) {
                            e.preventDefault();
                            linkDraftProject(titleSuggestions[titleSuggestIndex].project);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            setTitleSuggestDismissedFor(d.id);
                          }
                        }}
                        onBlur={() => {
                          if (titleTypedFor === d.id) setTitleLeftFor(d.id);
                        }}
                        placeholder="Event title"
                        aria-autocomplete="list"
                        className={`${glassFieldClass} h-11 text-[15px]`}
                      />
                      {/* The projects its title sounds like — picking one links it (the title stays as typed) and brings
                          its details: its address, its people. "Not now" puts them away for this event. A dropdown under
                          the title, floating over the pop-up (FloatingUnderField). */}
                      {titleSuggestions.length ? (
                        <FloatingUnderField
                          anchorRef={titleInputRef}
                          className="rounded-[14px] border p-1.5"
                          style={{
                            borderColor: "var(--glass-border)",
                            // Nearly solid: the fields it's over don't read through it.
                            backgroundColor: "color-mix(in srgb, var(--panel-bg) 94%, transparent)",
                            backdropFilter: "blur(16px) saturate(200%)",
                            WebkitBackdropFilter: "blur(16px) saturate(200%)",
                            boxShadow: "var(--shadow-md)",
                          }}
                          role="listbox"
                          ariaLabel="Projects this event could be for"
                        >
                          <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-0.5">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: "var(--text-main)" }}>
                              <FolderKanban size={12} />
                              Link a project?
                            </span>
                            <button
                              type="button"
                              onClick={() => setTitleSuggestDismissedFor(d.id)}
                              className="rounded-full px-2 py-0.5 text-[11.5px] font-medium transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]"
                              style={{ color: "var(--text-muted)" }}
                            >
                              Not now
                            </button>
                          </div>
                          {titleSuggestions.map(({ project: p }, index) => (
                            <button
                              key={p.id}
                              type="button"
                              role="option"
                              aria-selected={index === titleSuggestIndex}
                              // (Not taking the focus from the title — typing carries on.)
                              onMouseDown={(e) => e.preventDefault()}
                              onMouseEnter={() => setTitleSuggestIndex(index)}
                              onClick={() => linkDraftProject(p)}
                              className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors"
                              style={{ backgroundColor: index === titleSuggestIndex ? "color-mix(in srgb, var(--brand) 9%, transparent)" : undefined }}
                            >
                              <FolderKanban size={15} className="shrink-0" style={{ color: themeColor || "var(--brand-strong)" }} />
                              <span className="min-w-0 flex-1">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                                    {p.name}
                                  </span>
                                  {index === 0 ? (
                                    <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.5px]" style={{ color: "var(--brand-strong)" }}>
                                      Best match
                                    </span>
                                  ) : null}
                                </span>
                                <span className="block truncate text-[11.5px] font-normal" style={{ color: "var(--text-muted)" }}>
                                  {[p.customer, p.clientAddress].filter(Boolean).join(" · ")}
                                </span>
                              </span>
                              <span
                                className="glass-shine shrink-0 rounded-full border px-3 py-0.5 text-[11.5px] font-semibold text-white"
                                style={glassShineStyle(themeColor || "var(--brand)")}
                              >
                                Link
                              </span>
                            </button>
                          ))}
                          {/* Every other project too, as the Project field's: under Show all, until it's pressed. */}
                          {titleSuggestOthers.length ? (
                            titleSuggestShowAll ? (
                              <>
                                <p
                                  className="flex items-center gap-2 px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.6px]"
                                  style={{ color: "var(--text-muted)" }}
                                >
                                  <span className="shrink-0">Other projects</span>
                                  <span aria-hidden="true" className="h-px min-w-0 flex-1" style={{ backgroundColor: "var(--glass-border)" }} />
                                </p>
                                {titleSuggestOthers.map((p) => projectFieldRow(p, false))}
                              </>
                            ) : (
                              <button
                                type="button"
                                // (Not taking the focus from the title — typing carries on.)
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setTitleSuggestShowAllFor(d.id)}
                                className="mt-0.5 flex w-full items-center justify-center gap-1.5 rounded-[10px] px-2.5 py-2 text-[12px] font-semibold transition-colors hover:bg-[color-mix(in_srgb,var(--brand)_9%,transparent)]"
                                style={{ color: "var(--brand-strong)" }}
                              >
                                Show all
                                <span className="font-medium" style={{ color: "var(--text-muted)" }}>
                                  ({titleSuggestOthers.length} more)
                                </span>
                              </button>
                            )
                          ) : null}
                        </FloatingUnderField>
                      ) : null}
                    </div>
                    {/* When — straight under the title: a row each, its name on the left and its switch / boxes to the
                        right of it. */}
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5 text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                      <span>All day</span>
                      <div className="flex h-9 items-center">
                        <GlassSwitch
                          checked={d.allDay}
                          disabled={readOnly}
                          onChange={(on) => setDraft((prev) => (prev ? { ...prev, allDay: on } : prev))}
                          ariaLabel="All day"
                        />
                      </div>
                      {([
                        ["Starts", "startDate", "startTime"],
                        ["Ends", "endDate", "endTime"],
                      ] as const).map(([label, dateKey, timeKey]) => [
                        <span key={`${label}-name`}>{label}</span>,
                        <div key={label} className="flex min-w-0 gap-2">
                          {(() => {
                            const setDate = (value: string) =>
                              setDraft((prev) => {
                                if (!prev) return prev;
                                const next = { ...prev, [dateKey]: value };
                                // Keep the end on/after the start when the start date moves.
                                if (dateKey === "startDate" && next.endDate < value) next.endDate = value;
                                return next;
                              });
                            // A phone: its date on three wheels — day, month, year (WheelDatePicker). A computer: the
                            // usual date field.
                            return isMobile ? (
                              <WheelDatePicker
                                value={d[dateKey]}
                                disabled={readOnly}
                                ariaLabel={`${label} date`}
                                onChange={setDate}
                                // Just wide enough for the date (can still shrink on a narrow phone); not faded when it can't be changed.
                                className={`${glassFieldClass} min-w-0 disabled:opacity-100`}
                                style={{ width: 148 }}
                              />
                            ) : (
                              <input
                                type="date"
                                readOnly={readOnly}
                                value={d[dateKey]}
                                onChange={(e) => setDate(e.target.value)}
                                // Just wide enough for the date.
                                className={`${glassFieldClass} min-w-0`}
                                style={{ width: 148 }}
                              />
                            );
                          })()}
                          {!d.allDay ? (
                            // A phone: its time on wheels too — hour, minute, am/pm (WheelTimePicker), as the date. A
                            // computer: the usual time field.
                            isMobile ? (
                              <WheelTimePicker
                                value={d[timeKey]}
                                disabled={readOnly}
                                ariaLabel={`${label} time`}
                                onChange={(value) => setDraft((prev) => (prev ? { ...prev, [timeKey]: value } : prev))}
                                className={`${glassFieldClass} shrink-0 disabled:opacity-100`}
                                style={{ width: 112 }}
                              />
                            ) : (
                              <input
                                type="time"
                                // Any minute.
                                step={60}
                                readOnly={readOnly}
                                value={d[timeKey]}
                                onChange={(e) => setDraft((prev) => (prev ? { ...prev, [timeKey]: e.target.value } : prev))}
                                // Inline width: glassFieldClass carries w-full, which beat a w-[…] class.
                                className={`${glassFieldClass} shrink-0`}
                                style={{ width: 112 }}
                              />
                            )
                          ) : null}
                        </div>,
                      ])}
                    </div>
                    <div className="grid gap-3">
                      <label className="grid gap-1.5 text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                        Category
                        <GlassDropdown
                          value={d.categoryId}
                          options={[
                            ...editableCategories.map((c) => ({ value: c.id, label: c.name, color: c.color })),
                            // An existing event's category they can't choose (e.g. one deleted since): shown as it
                            // is. With none, the prompt shows instead.
                            ...(editableCategories.some((c) => c.id === d.categoryId) || !d.categoryId
                              ? []
                              : [{ value: d.categoryId, label: (categoryById.get(d.categoryId) ?? UNCATEGORISED).name, color: (categoryById.get(d.categoryId) ?? UNCATEGORISED).color }]),
                          ]}
                          onChange={(next) => {
                            setDraft((prev) => (prev ? { ...prev, categoryId: next } : prev));
                            setModalError("");
                          }}
                          ariaLabel="Category"
                          placeholder={editableCategories.length ? "Choose a category" : "No categories"}
                          disabled={readOnly}
                          triggerClassName={`${glassFieldClass} justify-between`}
                          // Its menu: always down from the field, as far as the bottom of the screen when it has the categories to fill it.
                          menuFillBelow
                        />
                      </label>
                    </div>
                    {/* Optional link to a project */}
                    <div className="grid gap-1.5 text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                      Project
                      {d.projectId ? (
                        <div className="flex items-center gap-2 rounded-[11px] border px-3 py-2" style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}>
                          <FolderKanban size={15} className="transition-colors" style={{ color: themeColor || "var(--brand-strong)" }} />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{d.projectName || "Linked project"}</span>
                          {/* On a computer, the project opens in a new Chrome tab (openEventProject). */}
                          <Link
                            href={`/projects/${d.projectId}`}
                            onClick={(event) => openEventProject(event, d.projectId)}
                            className="inline-flex items-center gap-1 text-[12px] font-semibold"
                            style={{ color: "var(--brand-strong)" }}
                          >
                            Open <ExternalLink size={13} />
                          </Link>
                          {!readOnly ? (
                            <button
                              type="button"
                              // Its people stay on as staff (taken off one by one below).
                              onClick={unlinkDraftProject}
                              className={iconRemoveButtonClass}
                              aria-label="Unlink project"
                            >
                              <X size={14} />
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {d.projectId ? (
                        <div className="flex items-center justify-between gap-3 rounded-[11px] border px-3 py-2" style={{ borderColor: "var(--glass-border)" }}>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium">Show on client portal</span>
                            <span className="block text-[11.5px] font-normal" style={{ color: "var(--text-main)" }}>
                              In the project&apos;s Schedule tab — just the title, time and category.
                            </span>
                          </span>
                          <GlassSwitch
                            checked={d.showToClient}
                            disabled={readOnly}
                            onChange={(on) => setDraft((prev) => (prev ? { ...prev, showToClient: on } : prev))}
                            ariaLabel="Show on client portal"
                          />
                        </div>
                      ) : !readOnly ? (
                        // Its dropdown, while it's in use (projectFieldOptions): straight away, the projects the title sounds
                        // like (best first); typing, what matches. Floating over the pop-up, as the title's.
                        <div className="relative">
                          <span className="relative flex items-center">
                            <Search size={15} className="pointer-events-none absolute left-3" style={{ color: "var(--text-muted)" }} />
                            <input
                              ref={projectFieldInputRef}
                              value={projectQuery}
                              onChange={(e) => setProjectQuery(e.target.value)}
                              onFocus={() => setProjectFieldFor(d.id)}
                              onBlur={() => {
                                setProjectFieldFor("");
                                setProjectFieldShowAllFor("");
                              }}
                              // Enter links the top one (rather than adding the event); Esc closes the dropdown.
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && projectFieldOptions.length) {
                                  e.preventDefault();
                                  linkDraftProject(projectFieldOptions[0]);
                                } else if (e.key === "Escape" && projectFieldFor) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  e.currentTarget.blur();
                                }
                              }}
                              placeholder="Link a project (optional) — search by name, client or address"
                              className={`${glassFieldClass} pl-9`}
                            />
                          </span>
                          {projectFieldOpen && (projectFieldOptions.length || projectQuery.trim()) ? (
                            <FloatingUnderField
                              anchorRef={projectFieldInputRef}
                              className="rounded-[14px] border p-1.5"
                              style={{
                                borderColor: "var(--glass-border)",
                                // Nearly solid: the fields it's over don't read through it.
                                backgroundColor: "color-mix(in srgb, var(--panel-bg) 94%, transparent)",
                                backdropFilter: "blur(16px) saturate(200%)",
                                WebkitBackdropFilter: "blur(16px) saturate(200%)",
                                boxShadow: "var(--shadow-md)",
                              }}
                              role="listbox"
                              ariaLabel="Projects to link"
                            >
                              {projectFieldShowsTitleMatches ? (
                                <p className="inline-flex items-center gap-1.5 px-2 pb-1 pt-0.5 text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: "var(--text-main)" }}>
                                  <FolderKanban size={12} />
                                  Closest to the title
                                </p>
                              ) : null}
                              {projectFieldOptions.length === 0 ? (
                                <p className="px-2 py-1.5 text-[12px] font-normal" style={{ color: "var(--text-main)" }}>No matching projects.</p>
                              ) : (
                                projectFieldOptions.map((p, index) => projectFieldRow(p, projectFieldShowsTitleMatches && index === 0))
                              )}
                              {/* Every other project too: under Show all, until it's pressed. */}
                              {projectFieldMore.length ? (
                                projectFieldShowAll ? (
                                  <>
                                    {projectFieldShowsTitleMatches ? (
                                      <p
                                        className="flex items-center gap-2 px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.6px]"
                                        style={{ color: "var(--text-muted)" }}
                                      >
                                        <span className="shrink-0">Other projects</span>
                                        <span aria-hidden="true" className="h-px min-w-0 flex-1" style={{ backgroundColor: "var(--glass-border)" }} />
                                      </p>
                                    ) : null}
                                    {projectFieldMore.map((p) => projectFieldRow(p, false))}
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => setProjectFieldShowAllFor(d.id)}
                                    className="mt-0.5 flex w-full items-center justify-center gap-1.5 rounded-[10px] px-2.5 py-2 text-[12px] font-semibold transition-colors hover:bg-[color-mix(in_srgb,var(--brand)_9%,transparent)]"
                                    style={{ color: "var(--brand-strong)" }}
                                  >
                                    Show all
                                    <span className="font-medium" style={{ color: "var(--text-muted)" }}>
                                      ({projectFieldMore.length} more)
                                    </span>
                                  </button>
                                )
                              ) : null}
                            </FloatingUnderField>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-[12.5px] font-normal" style={{ color: "var(--text-main)" }}>None</p>
                      )}
                    </div>
                    {/* Who's on it — each is reminded before it (their Notifications > Upcoming events). A linked
                        project's assignee goes on when it's linked (its creator, with no one assigned); anyone can be
                        taken off. */}
                    <div className="grid gap-1.5 text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                      Staff
                      {draftStaff.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {draftStaff.map((m) => (
                            <span
                              key={m.uid}
                              className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border py-1 pl-1 pr-2 text-[13px] font-medium"
                              style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}
                            >
                              {staffEmblem(m.uid, m.name)}
                              <span className="truncate">{m.name}</span>
                              {!readOnly ? (
                                <button
                                  type="button"
                                  onClick={() => takeDraftStaffOff(m.uid, m.name)}
                                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)]"
                                  aria-label={`Take ${m.name} off this event`}
                                  title="Remove"
                                >
                                  <X size={13} />
                                </button>
                              ) : null}
                            </span>
                          ))}
                        </div>
                      ) : readOnly ? (
                        <p className="text-[12.5px] font-normal" style={{ color: "var(--text-muted)" }}>None</p>
                      ) : null}
                      {!readOnly && staffOptions.length ? (
                        <GlassDropdown
                          value=""
                          options={staffOptions}
                          onChange={(uid) =>
                            setDraft((prev) => (prev ? { ...prev, staffUids: [...draftStaffUids(prev).filter((v) => v !== uid), uid] } : prev))
                          }
                          ariaLabel="Add staff"
                          placeholder="Add staff"
                          triggerClassName={`${glassFieldClass} justify-between`}
                        />
                      ) : null}
                    </div>
                    <label className="grid gap-1.5 text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                      Location
                      <span className="relative flex items-center">
                        <MapPin size={15} className="pointer-events-none absolute left-3" style={{ color: "var(--text-muted)" }} />
                        <input
                          readOnly={readOnly}
                          value={d.location}
                          onChange={(e) => setDraft((prev) => (prev ? { ...prev, location: e.target.value } : prev))}
                          placeholder="Address or place"
                          className={`${glassFieldClass} pl-9`}
                        />
                      </span>
                    </label>
                    <label className="grid gap-1.5 text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                      Notes
                      <textarea
                        readOnly={readOnly}
                        value={d.notes}
                        onChange={(e) => setDraft((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
                        rows={3}
                        className={`${glassFieldClass} h-auto py-2`}
                      />
                    </label>
                    {modalError ? (
                      <p className="text-[12px] font-medium" style={{ color: "var(--danger-strong)" }}>{modalError}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 border-t px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
                    {!d.isNew && d.createdByName ? addedBy("min-w-0", true) : null}
                    {!d.isNew && !readOnly ? (
                      <button
                        type="button"
                        onClick={() => void removeDraft()}
                        disabled={saving}
                        className={smallButtonClass}
                        style={confirmDelete ? { backgroundImage: "var(--danger-gradient)", color: "#fff", borderColor: "transparent" } : undefined}
                      >
                        <Trash2 size={14} /> {confirmDelete ? "Click again to delete" : "Delete"}
                      </button>
                    ) : null}
                    <span className="flex-1" />
                    {/* Round-ended, with the glass shine: Cancel plain, Add event / Save in the category's colour (the brand
                        blue until one's chosen), its words dark on a light one. */}
                    {!readOnly ? (
                      <button
                        type="button"
                        onClick={closeModal}
                        className="glass-shine glass-shine-neutral inline-flex h-9 shrink-0 items-center justify-center rounded-full px-4 text-[12.5px] font-semibold text-[var(--text-main)] transition hover:brightness-95"
                      >
                        Cancel
                      </button>
                    ) : null}
                    {!readOnly ? (
                      <button
                        type="submit"
                        disabled={saving}
                        className="glass-shine inline-flex h-9 shrink-0 items-center justify-center rounded-full px-4 text-[12.5px] font-semibold transition hover:brightness-105 disabled:opacity-60"
                        style={glassShineStyle(themeColor || "var(--brand)", { color: themeColor ? textOn(themeColor) : "#FFFFFF" })}
                      >
                        {saving ? "Saving..." : d.isNew ? "Add event" : "Save"}
                      </button>
                    ) : null}
                  </div>
                </form>
                </>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
      <DragGhostLayer controller={ghost} />
    </div>
  );
}
