"use client";

// The Calendar tab — a shared, Teamup-style company calendar. Month / week / day / list views;
// click a day (or a time in week/day view) to add an event; drag events to move them, drag an
// event's bottom edge in week/day view to change its length. Events sync live between everyone
// (lib/calendar-data.ts). Categories (with colours) are managed in Company Settings > Calendar and can
// be shown/hidden here per person. Opening the tab needs calendar.view; who can edit / view / not see each
// category is set per role on the category (Company Settings > Calendar).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, ExternalLink, Filter, FolderKanban, MapPin, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyDoc, fetchCompanyMembers, fetchProjects } from "@/lib/firestore-data";
import { hasPermissionKey, isOwnerOrAdmin, useCompanyAccess } from "@/lib/use-company-access";
import { normalizeRoleKey } from "@/lib/company-roles";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { DragGhostLayer, useDragGhost } from "@/lib/use-drag-ghost";
import { activeDate, useCompanyFormats } from "@/lib/company-formats";
import {
  deleteCalendarEvent,
  newCalendarId,
  normalizeCalendarCategories,
  normalizeCalendarWorkdays,
  DEFAULT_CALENDAR_WORKDAYS,
  saveCalendarEvent,
  subscribeCalendarEvents,
  type CalendarAccessLevel,
  type CalendarCategory,
  type CalendarEvent,
} from "@/lib/calendar-data";
import { GlassDropdown } from "@/components/glass-dropdown";
import {
  GlassSwitch,
  Segmented,
  glassFieldClass,
  iconRemoveButtonClass,
  primaryButtonClass,
  primaryButtonStyle,
  secondaryButtonClass,
  smallButtonClass,
} from "@/components/settings-ui";
import type { Project } from "@/lib/types";

type CalendarView = "month" | "week" | "day" | "list";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_PX = 48;
const SNAP_MIN = 15;
const UNCATEGORISED: CalendarCategory = { id: "__none", name: "Uncategorised", color: "#94A3B8" };
const VIEW_STORAGE_KEY = "cutsmart_calendar_view";
const HIDDEN_STORAGE_KEY = "cutsmart_calendar_hidden_categories";
const LIST_DAYS = 60;

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
// The phone's month scroller: one continuous run of weeks covering the previous, current and next month
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

function viewRange(view: CalendarView, cursor: Date): { from: Date; to: Date } {
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
function layoutBars(
  rowStart: Date,
  cols: number,
  evs: CalendarEvent[],
  rank: (e: CalendarEvent) => number,
  withSingleDay = false,
): { bars: BarSlot[]; lanes: number } {
  const rowStartMs = startOfDay(rowStart).getTime();
  const col = (ms: number) => Math.round((startOfDay(ms).getTime() - rowStartMs) / DAY_MS);
  const items = evs
    .filter((e) => withSingleDay || isBarEvent(e))
    .map((event) => {
      const first = col(event.startMs);
      const last = isBarEvent(event) ? col(event.endMs - 1) : first;
      return { event, first, last, startCol: Math.max(0, first), endCol: Math.min(cols - 1, last) };
    })
    .filter((it) => it.endCol >= 0 && it.startCol <= cols - 1)
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
    return { event: it.event, startCol: it.startCol, endCol: it.endCol, lane, contBefore: it.first < 0, contAfter: it.last > cols - 1 };
  });
  return { bars, lanes: taken.length };
}
// One event "slot" in a month day: an 18px event plus a 2px gap.
const BAR_H = 20;
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
  createdByUid: string;
  createdByName: string;
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
    createdByUid: e.createdByUid,
    createdByName: e.createdByName,
  };
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
    createdByUid: d.createdByUid,
    createdByName: d.createdByName,
    updatedAtIso: "",
  };
}

const cardStyle: CSSProperties = {
  borderColor: "var(--glass-border)",
  backgroundColor: "var(--glass-bg-strong)",
  backdropFilter: "blur(20px) saturate(180%)",
  WebkitBackdropFilter: "blur(20px) saturate(180%)",
  boxShadow: "inset 0 1px 0 var(--glass-highlight), var(--shadow-glass)",
};

export default function CalendarPage() {
  const { user } = useAuth();
  const access = useCompanyAccess();
  useCompanyFormats();
  const companyId = access.companyId;
  // calendar.edit is a dropped permission; old roles that still carry it can open the tab.
  const canView =
    access.status === "ready" &&
    (isOwnerOrAdmin(access.role) || hasPermissionKey(access.permissionKeys, "calendar.view") || hasPermissionKey(access.permissionKeys, "calendar.edit"));

  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()));
  const [categories, setCategories] = useState<CalendarCategory[]>([]);
  // Company Settings > Calendar > Workdays. Other days are drawn hatched ("crossed out").
  const [workdays, setWorkdays] = useState<number[]>(DEFAULT_CALENDAR_WORKDAYS);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadError, setLoadError] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  // Staff colours, for the "Added by" emblem in the event pop-up.
  const [memberColorByUid, setMemberColorByUid] = useState<Record<string, string>>({});

  // Per-person view + hidden categories, remembered on this device.
  useEffect(() => {
    // Restoring a device-local preference after mount (not during render) keeps server and client
    // renders identical.
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const v = window.localStorage.getItem(VIEW_STORAGE_KEY) as CalendarView | null;
      if (v && ["month", "week", "day", "list"].includes(v)) setView(v);
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
    });
    void fetchCompanyMembers(companyId).then((members) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const m of members) map[m.uid] = String(m.userColor || m.badgeColor || "").trim();
      setMemberColorByUid(map);
    });
    if (user?.uid) {
      void fetchProjects(user.uid, [companyId], { lightweight: true }).then((rows) => {
        if (!cancelled) setProjects(rows.filter((p) => !p.deletedAt && (!p.companyId || p.companyId === companyId)));
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
  const levelOf = useCallback(
    (categoryId: string): CalendarAccessLevel => {
      if (isAdmin) return "edit";
      const category = categoryById.get(categoryId);
      if (category) return category.access?.[roleKey] ?? (canView ? "view" : "none");
      // Category deleted since: only owners/admins (handled above) can change these.
      return canView ? "view" : "none";
    },
    [canView, categoryById, isAdmin, roleKey],
  );
  const canEditEvent = (event: { categoryId: string }) => levelOf(event.categoryId) === "edit";
  const editableCategories = categories.filter((cat) => levelOf(cat.id) === "edit");
  // Can add events at all: there's a category they can edit (or no categories, with the edit permission).
  const canCreate = isAdmin || editableCategories.length > 0;
  // Events run top to bottom in the order the categories are listed in Company Settings > Calendar.
  const categoryRank = useMemo(() => new Map(categories.map((c, i) => [c.id, i])), [categories]);
  const rankOf = useCallback((e: CalendarEvent) => categoryRank.get(e.categoryId) ?? categories.length, [categories.length, categoryRank]);
  // Live preview while dragging in week/day view.
  const [dragPreview, setDragPreview] = useState<{ id: string; startMs: number; endMs: number } | null>(null);
  const visibleEvents = useMemo(
    () =>
      events
        .filter((e) => !hidden.has(categoryOf(e).id) && levelOf(e.categoryId) !== "none")
        .map((e) => (dragPreview && dragPreview.id === e.id ? { ...e, startMs: dragPreview.startMs, endMs: dragPreview.endMs } : e))
        .sort((a, b) => rankOf(a) - rankOf(b) || Number(b.allDay) - Number(a.allDay) || a.startMs - b.startMs || b.endMs - a.endMs),
    [categoryOf, dragPreview, events, hidden, levelOf, rankOf],
  );

  // ---------------------------------------------------------------- event pop-up
  const [draft, setDraft] = useState<Draft | null>(null);
  const [modalOrigin, setModalOrigin] = useState<GlassModalOrigin>(null);
  const modalPanelRef = useRef<HTMLDivElement | null>(null);
  const shouldRenderModal = useGlassModalPopOrigin(Boolean(draft), modalOrigin, modalPanelRef);
  // What the pop-up shows while it animates closed (draft is already null by then).
  const [renderedDraft, setRenderedDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  // Clicking an event opens it read-only ("view"); Edit switches the same pop-up to the form.
  const [eventMode, setEventMode] = useState<"view" | "edit">("edit");

  const openNew = (startMs: number, allDay: boolean, e?: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>) => {
    if (!canCreate) return;
    const endMs = allDay ? startMs : startMs + 60 * 60 * 1000;
    setModalOrigin(e ? captureGlassModalOrigin(e as ReactMouseEvent<HTMLElement>) : null);
    setModalError("");
    setConfirmDelete(false);
    setProjectQuery("");
    setEventMode("edit");
    const next: Draft = {
      id: newCalendarId("evt"),
      isNew: true,
      title: "",
      categoryId: editableCategories.find((c) => !hidden.has(c.id))?.id ?? editableCategories[0]?.id ?? "",
      allDay,
      startDate: toDateInput(startMs),
      startTime: toTimeInput(startMs),
      endDate: toDateInput(endMs),
      endTime: toTimeInput(endMs),
      location: "",
      notes: "",
      projectId: "",
      projectName: "",
      createdByUid: String(user?.uid || ""),
      createdByName: String(user?.displayName || ""),
    };
    setDraft(next);
    setRenderedDraft(next);
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
  };
  const closeModal = () => setDraft(null);
  const submitDraft = async () => {
    if (!draft || !companyId || !canEditEvent(draft)) return;
    const event = eventFromDraft(draft);
    if (!event) {
      setModalError("Check the dates and times.");
      return;
    }
    setSaving(true);
    setModalError("");
    const result = await saveCalendarEvent(companyId, event);
    setSaving(false);
    if (!result.ok) {
      setModalError(result.error === "permission-denied" ? "You don't have permission to save events." : "Couldn't save — try again.");
      return;
    }
    closeModal();
  };
  const removeDraft = async () => {
    if (!draft || !companyId || !canEditEvent(draft)) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    const result = await deleteCalendarEvent(companyId, draft.id);
    setSaving(false);
    if (!result.ok) {
      setModalError("Couldn't delete — try again.");
      return;
    }
    closeModal();
  };
  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[data-glass-dropdown-menu="true"]')) setDraft(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [draft]);

  // Moving an event to new times (drag in any view).
  const moveEvent = async (event: CalendarEvent, startMs: number, endMs: number) => {
    if (!companyId || !canEditEvent(event)) return;
    setEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, startMs, endMs } : e)));
    const result = await saveCalendarEvent(companyId, { ...event, startMs, endMs });
    if (!result.ok) setLoadError("Couldn't move that event — try again.");
  };

  // ---------------------------------------------------------------- navigation
  // Desktop: Previous / Next slide the view — month up/down, week/day/list left/right. The outgoing view
  // is a static copy of the current DOM that slides out while the new one slides in (see the effect below).
  const viewWrapRef = useRef<HTMLDivElement | null>(null);
  const pendingSlideRef = useRef<{ ghost: HTMLElement; axis: "x" | "y"; dir: -1 | 1 } | null>(null);
  const beginSlide = (dir: -1 | 1) => {
    const wrap = viewWrapRef.current;
    if (!wrap || window.matchMedia("(max-width: 767px), (prefers-reduced-motion: reduce)").matches) return;
    wrap.querySelectorAll("[data-cal-slide-ghost]").forEach((el) => el.remove());
    const live = wrap.firstElementChild as HTMLElement | null;
    if (!live) return;
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
    pendingSlideRef.current = { ghost, axis: view === "month" ? "y" : "x", dir };
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
    beginSlide(dir);
    setCursor((prev) => {
      if (view === "month") {
        const x = startOfMonth(prev);
        x.setMonth(x.getMonth() + dir);
        return x;
      }
      if (view === "week") return addDays(prev, 7 * dir);
      if (view === "day") return addDays(prev, dir);
      return addDays(prev, LIST_DAYS * dir);
    });
  };
  const title = (() => {
    if (view === "month") return monthYear(cursor);
    if (view === "week") {
      const s = startOfWeek(cursor);
      return `${activeDate(s)} – ${activeDate(addDays(s, 6))}`;
    }
    if (view === "day") return `${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(cursor)} ${activeDate(cursor)}`;
    return `${activeDate(range.from)} – ${activeDate(addDays(range.to, -1))}`;
  })();

  // ---------------------------------------------------------------- month view (HTML5 drag between days)
  const ghost = useDragGhost();
  const [monthDragId, setMonthDragId] = useState("");
  const [monthDropDay, setMonthDropDay] = useState<number | null>(null);
  const today = startOfDay(new Date());
  const isOffDay = (day: Date) => !workdays.includes(day.getDay());
  // The "crossed out" look for days that aren't workdays.
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
  const dayDropProps = (dayMs: number) => ({
    onDragOver: (e: ReactDragEvent<HTMLElement>) => {
      if (!monthDragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (monthDropDay !== dayMs) setMonthDropDay(dayMs);
    },
    onDrop: (e: ReactDragEvent<HTMLElement>) => {
      e.preventDefault();
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

  const dayUnderPointer = (e: ReactDragEvent<HTMLElement>, rowStart: Date, cols: number) => {
    const row = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    const colWidth = row ? row.width / cols : 1;
    const col = row ? Math.min(cols - 1, Math.max(0, Math.floor((e.clientX - row.left) / colWidth))) : 0;
    return addDays(rowStart, col).getTime();
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
        onDragOver={place ? drop.onDragOver : undefined}
        onDrop={place ? drop.onDrop : undefined}
        onClick={(e) => {
          e.stopPropagation();
          openExisting(event, e);
        }}
        className={`flex h-[18px] min-w-0 shrink-0 items-center gap-1.5 truncate rounded-[6px] px-1.5 text-left text-[10.5px] font-normal transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] ${place ? "pointer-events-auto absolute" : "w-full"}`}
        style={{
          ...place,
          color: "var(--text-main)",
          opacity: monthDragId === event.id ? 0.35 : 1,
          pointerEvents: event.id.endsWith(PREVIEW_SUFFIX) ? "none" : undefined,
          backgroundColor: event.id.endsWith(PREVIEW_SUFFIX) ? "var(--brand-soft)" : undefined,
        }}
        title={`${event.title}${event.location ? ` · ${event.location}` : ""}`}
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cat.color }} />
        <span className="shrink-0 opacity-70">{timeText(event.startMs)}</span>
        <span className="truncate">{event.title || "Untitled event"}</span>
      </button>
    );
  };

  // One continuous bar per event across the days it covers in a row of `cols` days. Square ends mark
  // where it carries on into the previous / next row.
  const renderBars = (bars: BarSlot[], rowStart: Date, cols: number, maxLanes: number) =>
    bars
      .filter((b) => b.lane < maxLanes)
      .map((b) => {
        if (!isBarEvent(b.event)) {
          return renderChip(b.event, addDays(rowStart, b.startCol), {
            top: b.lane * BAR_H,
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
              beginDayDrag(e, b.event, barId, addDays(rowStart, grabCol).getTime());
            }}
            onDragEnd={endDayDrag}
            // A bar covers the day cells under it, so it passes drops on to the day under the pointer.
            onDragOver={(e) => dayDropProps(dayUnderPointer(e, rowStart, cols)).onDragOver(e)}
            onDrop={(e) => dayDropProps(dayUnderPointer(e, rowStart, cols)).onDrop(e)}
            onClick={(e) => {
              e.stopPropagation();
              openExisting(b.event, e);
            }}
            className="pointer-events-auto absolute flex items-center gap-1 truncate px-2 text-left text-[11px] font-normal transition hover:brightness-95"
            style={{
              top: b.lane * BAR_H,
              height: BAR_H - 2,
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
            }}
            title={`${b.event.title}${b.event.location ? ` · ${b.event.location}` : ""}`}
          >
            {b.contBefore ? <span className="shrink-0 opacity-80">←</span> : null}
            {!b.event.allDay && !b.contBefore ? <span className="shrink-0 opacity-85">{timeText(b.event.startMs)}</span> : null}
            <span className="truncate">{b.event.title || "Untitled event"}</span>
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
  // Day number row (4px padding + 24px + 2px) sits above the event slots.
  const DAY_HEADER_PX = 30;
  const slotsPerDay = Math.max(1, Math.floor((monthRowsHeight / 6 - DAY_HEADER_PX - 2) / BAR_H));

  // One week of the month view. `month` is the month being shown — days outside it are greyed (they fade
  // as that changes). `place` sizes/snaps the row when it's in the phone's continuous week scroller.
  const weekRow = (weekStart: Date, month: number, place?: { className?: string; style?: CSSProperties }) => {
    const S = slotsPerDay;
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    // Every event (bars and single-day chips) in category-ordered lanes.
    const { bars, lanes } = layoutBars(weekStart, 7, dayLayoutEvents, rankOf, true);
    // Lanes shown in this row — every slot can hold an event, since the "+N" count sits up in the
    // day's header rather than taking a slot.
    const L = Math.min(lanes, S);
    return (
      <div
        key={weekStart.getTime()}
        className={`relative grid min-h-0 grid-cols-7 overflow-hidden border-b ${place ? place.className ?? "" : "last:border-b-0"}`}
        style={{ borderColor: "var(--glass-border)", ...place?.style }}
      >
        {days.map((dd, col) => {
          const dayMs = dd.getTime();
          const isToday = sameDay(dd, today);
          const inMonth = dd.getMonth() === month;
          const more = bars.filter((b) => b.lane >= L && b.startCol <= col && b.endCol >= col).length;
          return (
            <div
              key={dayMs}
              onClick={(e) => openNew(dayMs, true, e)}
              {...dayDropProps(dayMs)}
              className={`group relative flex min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden border-r p-1 transition-colors duration-300 [&:nth-child(7)]:border-r-0 ${canCreate ? "cursor-pointer hover:bg-[color-mix(in_srgb,var(--text-main)_3%,transparent)]" : ""}`}
              style={{
                borderColor: "var(--glass-border)",
                backgroundColor: monthDropDay === dayMs ? "var(--brand-soft)" : inMonth ? undefined : "color-mix(in srgb, var(--text-main) 2.5%, transparent)",
                backgroundImage: isOffDay(dd) && monthDropDay !== dayMs ? offDayHatch : undefined,
              }}
            >
              <div className="flex h-6 shrink-0 items-center justify-between px-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCursor(startOfDay(dd));
                    changeView("day");
                  }}
                  className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] font-semibold transition duration-300 hover:bg-[color-mix(in_srgb,var(--text-main)_7%,transparent)]"
                  style={isToday ? { backgroundImage: "var(--brand-gradient)", color: "#fff" } : { color: inMonth ? "var(--text-main)" : "var(--text-muted)" }}
                  title="Open this day"
                >
                  {dd.getDate()}
                </button>
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
                ) : canCreate ? (
                  <Plus size={13} className="opacity-0 transition group-hover:opacity-60" style={{ color: "var(--text-muted)" }} />
                ) : null}
              </div>
            </div>
          );
        })}
        {/* The week's events (continuous bars and single-day chips), positioned under the day numbers. */}
        <div className="pointer-events-none absolute inset-x-0" style={{ top: DAY_HEADER_PX, height: L * BAR_H }}>
          {renderBars(bars, weekStart, 7, L)}
        </div>
      </div>
    );
  };

  const monthGrid = (monthDate: Date) => {
    const firstWeek = startOfWeek(startOfMonth(monthDate));
    const weeks = Array.from({ length: 6 }, (_, w) => addDays(firstWeek, w * 7));
    return <div className="grid h-full grid-rows-6">{weeks.map((weekStart) => weekRow(weekStart, monthDate.getMonth()))}</div>;
  };

  // ---- Mobile: swipe up/down between months. Three months are rendered stacked (previous, current,
  // next), the scroller snaps to whole months, and once it settles on the previous or next one the
  // cursor moves and the scroller is put back on the middle — so there's always a loaded month on
  // each side and it can never rest between two months.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const monthScrollerRef = useRef<HTMLDivElement | null>(null);
  const monthSettleTimerRef = useRef<number | null>(null);
  // Which of the three months (0 prev, 1 current, 2 next) the scroller is nearest to while swiping, so
  // the greyed days fade over to the month coming into view.
  const [liveMonthIdx, setLiveMonthIdx] = useState(1);
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
    if (view !== "month" || !isMobile) return;
    const el = monthScrollerRef.current;
    if (el) el.scrollTop = (mobileMonthWeeks(cursor).starts[1] * el.clientHeight) / 6;
  }, [cursor, isMobile, monthRowsHeight, view]);
  const settleMonthScroller = () => {
    const el = monthScrollerRef.current;
    if (!el || !el.clientHeight) return;
    const idx = nearestMonthIdx(el);
    if (idx === 1) return;
    setLiveMonthIdx(1);
    setCursor((prev) => {
      const next = startOfMonth(prev);
      next.setMonth(next.getMonth() + (idx === 0 ? -1 : 1));
      return next;
    });
  };
  const onMonthScroll = () => {
    const el = monthScrollerRef.current;
    if (el && el.clientHeight) {
      const idx = nearestMonthIdx(el);
      if (idx !== liveMonthIdx) setLiveMonthIdx(idx);
    }
    if (monthSettleTimerRef.current) window.clearTimeout(monthSettleTimerRef.current);
    monthSettleTimerRef.current = window.setTimeout(settleMonthScroller, 110);
  };
  useEffect(() => {
    const el = monthScrollerRef.current;
    if (!el || !("onscrollend" in el)) return;
    const onEnd = () => {
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
    <div className="grid shrink-0 grid-cols-7 border-b" style={{ borderColor: "var(--glass-border)" }}>
      {Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i)).map((day) => (
        <div key={day.getTime()} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
          {weekdayShort(day)}
        </div>
      ))}
    </div>
  );

  const monthView = () => {
    if (isMobile) {
      const { weeks, starts, months } = mobileMonthWeeks(cursor);
      const shownMonth = months[liveMonthIdx].getMonth();
      // Edge to edge on a phone: no floating card, it spans the full width.
      return (
        <div className="-mx-3 flex flex-col border-y" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--glass-bg-strong)" }}>
          {weekdayHeader}
          <div
            ref={(el) => {
              monthScrollerRef.current = el;
              monthRowsRef(el);
            }}
            onScroll={onMonthScroll}
            className="snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ height: "calc(100svh - 168px - env(safe-area-inset-bottom, 0px))" }}
          >
            {weeks.map((weekStart, i) =>
              weekRow(weekStart, shownMonth, {
                className: starts.includes(i) ? "snap-start [scroll-snap-stop:always]" : "",
                style: { height: "calc(100% / 6)" },
              }),
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col overflow-hidden rounded-[20px] border" style={cardStyle}>
        {weekdayHeader}
        <div ref={monthRowsRef} style={{ height: "max(540px, calc(100svh - 196px))" }}>
          {monthGrid(cursor)}
        </div>
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
    moved: boolean;
  } | null>(null);

  const onEventPointerDown = (e: ReactPointerEvent<HTMLElement>, event: CalendarEvent, mode: "move" | "resize") => {
    e.stopPropagation();
    if (!canEditEvent(event) || e.button !== 0) return;
    const cols = columnsRef.current;
    const colCount = view === "week" ? 7 : 1;
    pointerDragRef.current = {
      event,
      mode,
      x: e.clientX,
      y: e.clientY,
      colWidth: cols ? cols.getBoundingClientRect().width / colCount : 1,
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
    const days = view === "week" ? Math.round(dx / drag.colWidth) : 0;
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
      void moveEvent(drag.event, preview.startMs, preview.endMs);
    }
  };

  const timeGrid = () => {
    const dayCount = view === "week" ? 7 : 1;
    const days = Array.from({ length: dayCount }, (_, i) => addDays(range.from, i));
    const gridCols = { gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` };
    return (
      <div className={`flex min-h-0 flex-col overflow-hidden ${viewShell.className}`} style={viewShell.style}>
        {/* Day headers, then the all-day row (all-day and multi-day events as continuous bars). */}
        {(() => {
          const { bars, lanes } = layoutBars(range.from, dayCount, dayLayoutEvents, rankOf);
          return (
            <div className="border-b" style={{ borderColor: "var(--glass-border)" }}>
              <div className="flex">
                <div className="w-14 shrink-0" />
                <div className="grid min-w-0 flex-1" style={gridCols}>
                  {days.map((d) => {
                    const isToday = sameDay(d, today);
                    return (
                      <button
                        key={d.getTime()}
                        type="button"
                        onClick={() => {
                          setCursor(startOfDay(d));
                          changeView("day");
                        }}
                        className="flex w-full items-center justify-center gap-1.5 border-l py-1.5 text-[12px] font-semibold first:border-l-0"
                        style={{ color: isToday ? "var(--brand-strong)" : "var(--text-main)", borderColor: "var(--glass-border)" }}
                      >
                        <span style={{ color: "var(--text-muted)" }}>{weekdayShort(d)}</span>
                        <span
                          className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1"
                          style={isToday ? { backgroundImage: "var(--brand-gradient)", color: "#fff" } : undefined}
                        >
                          {d.getDate()}
                        </span>
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
                        backgroundColor: monthDropDay === d.getTime() ? "var(--brand-soft)" : undefined,
                        backgroundImage: isOffDay(d) && monthDropDay !== d.getTime() ? offDayHatch : undefined,
                      }}
                      title={canCreate ? "Add an all-day event" : undefined}
                    />
                  ))}
                  <div className="pointer-events-none absolute inset-x-0" style={{ top: 3, height: lanes * BAR_H }}>
                    {renderBars(bars, range.from, dayCount, 99)}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
        {/* Hours */}
        <div ref={gridScrollRef} className="glass-scroll relative min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: "calc(100svh - 250px)" }}>
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
                      backgroundImage: [
                        `repeating-linear-gradient(to bottom, var(--glass-border) 0, var(--glass-border) 1px, transparent 1px, transparent ${HOUR_PX}px)`,
                        ...(isOffDay(d) ? [offDayHatch] : []),
                      ].join(", "),
                    }}
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const minutes = Math.floor((((e.clientY - rect.top) / HOUR_PX) * 60) / 30) * 30;
                      openNew(dayStart + minutes * 60000, false, e);
                    }}
                  >
                    {isToday && nowTop >= 0 && nowTop <= HOUR_PX * 24 ? (
                      <div className="pointer-events-none absolute inset-x-0 z-[3] h-[2px]" style={{ top: nowTop, backgroundColor: "#DC2626" }}>
                        <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full" style={{ backgroundColor: "#DC2626" }} />
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
                          onPointerDown={(e) => onEventPointerDown(e, event, "move")}
                          onPointerMove={onEventPointerMove}
                          onPointerUp={onEventPointerUp}
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
                          }}
                        >
                          <p className="truncate font-normal">{event.title || "Untitled event"}</p>
                          {height > 30 ? (
                            <p className="truncate opacity-85">
                              {timeText(event.startMs)} – {timeText(event.endMs)}
                            </p>
                          ) : null}
                          {height > 46 && event.location ? <p className="truncate opacity-80">{event.location}</p> : null}
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
  const listView = () => {
    const days = Array.from({ length: LIST_DAYS }, (_, i) => addDays(range.from, i));
    const groups = days
      .map((d) => ({ day: d, items: visibleEvents.filter((e) => overlapsDay(e, d)) }))
      .filter((g) => g.items.length);
    return (
      <div className={`overflow-hidden ${viewShell.className}`} style={viewShell.style}>
        {groups.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
            No events in the next {LIST_DAYS} days.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.day.getTime()} className="border-b last:border-b-0" style={{ borderColor: "var(--glass-border)" }}>
              <p
                className="sticky top-0 px-4 py-2 text-[12px] font-semibold"
                style={{ color: sameDay(g.day, today) ? "var(--brand-strong)" : "var(--text-main)", backgroundColor: "color-mix(in srgb, var(--text-main) 3%, transparent)" }}
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
      const q = projectQuery.trim().toLowerCase();
      if (!q) return true;
      return [p.name, p.customer, p.clientAddress].join(" ").toLowerCase().includes(q);
    })
    .slice(0, 8);
  const d = draft ?? renderedDraft;
  const readOnly = !d || !canEditEvent(d);
  const draftCategory = d ? categoryById.get(d.categoryId) ?? UNCATEGORISED : UNCATEGORISED;
  // Existing events open read-only first (and always, for people who can't edit).
  const viewingEvent = Boolean(d && !d.isNew && (eventMode === "view" || readOnly));
  const viewEvent = d && viewingEvent ? eventFromDraft(d) : null;
  // "Added by <name>" with the person's emblem — in the bottom bar on desktop, in the body on phones.
  // compact: just the emblem on phones (the edit form's bottom bar is busy there).
  const addedBy = (className: string, compact = false) =>
    d ? (
      <p className={`flex items-center gap-2 text-[12.5px] font-medium ${className}`} style={{ color: "var(--text-main)" }} title={`Added by ${d.createdByName}`}>
        <span
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ backgroundColor: (d.createdByUid === user?.uid ? String(user?.userColor || "") : "") || memberColorByUid[d.createdByUid] || "#7D99B3" }}
        >
          {d.createdByName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?"}
        </span>
        <span className={`min-w-0 truncate ${compact ? "hidden md:inline" : ""}`}>Added by {d.createdByName}</span>
      </p>
    ) : null;

  return (
    <div
      // Swipes here are the calendar's own (months, drags): never the app's pull-down menu or side drawers.
      data-app-gesture-exempt="true"
      className="flex flex-col"
      style={{ marginLeft: "calc(-1 * max(12px, env(safe-area-inset-left)))", marginRight: "calc(-1 * max(12px, env(safe-area-inset-right)))" }}
    >
      <div className="grid w-full gap-[18px] p-3 md:p-[18px] lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Sidebar: categories to show/hide (desktop). */}
        <aside className="hidden h-fit flex-col gap-3 rounded-[20px] border p-3.5 lg:sticky lg:top-[68px] lg:flex" style={cardStyle}>
          <div className="flex items-center gap-2 px-1.5 text-[18px] font-bold" style={{ color: "var(--text-main)" }}>
            <CalendarDays size={18} strokeWidth={2.1} />
            Calendar
          </div>
          {canCreate ? (
            <button type="button" onClick={(e) => openNew(nextHalfHourMs(), false, e)} className={primaryButtonClass} style={primaryButtonStyle}>
              <Plus size={15} /> New event
            </button>
          ) : null}
          <p className="px-2 pt-1 text-[10.5px] font-bold uppercase tracking-[0.8px]" style={{ color: "var(--text-muted)" }}>Categories</p>
          {categoryFilter}
        </aside>

        <main className="flex min-w-0 flex-col gap-3">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 rounded-[20px] border px-3 py-2.5" style={cardStyle}>
            <button type="button" onClick={() => setCursor(startOfDay(new Date()))} className={smallButtonClass}>
              Today
            </button>
            <div className="flex items-center">
              <button type="button" onClick={() => step(-1)} className={iconRemoveButtonClass} aria-label="Previous">
                <ChevronLeft size={18} />
              </button>
              <button type="button" onClick={() => step(1)} className={iconRemoveButtonClass} aria-label="Next">
                <ChevronRight size={18} />
              </button>
            </div>
            <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold" style={{ color: "var(--text-main)" }}>{title}</h1>
            <button type="button" onClick={() => setMobileFilterOpen((v) => !v)} className={`${smallButtonClass} lg:hidden`}>
              <Filter size={14} /> Categories
            </button>
            <Segmented
              size="sm"
              value={view}
              options={[
                { value: "month", label: "Month" },
                { value: "week", label: "Week" },
                { value: "day", label: "Day" },
                { value: "list", label: "List" },
              ]}
              onChange={changeView}
            />
            {canCreate ? (
              <button
                type="button"
                onClick={(e) => openNew(nextHalfHourMs(), false, e)}
                className={`${primaryButtonClass} lg:hidden`}
                style={primaryButtonStyle}
                aria-label="New event"
              >
                <Plus size={15} />
              </button>
            ) : null}
          </div>
          {mobileFilterOpen ? (
            <div className="rounded-[20px] border p-2.5 lg:hidden" style={cardStyle}>
              {categoryFilter}
            </div>
          ) : null}
          {loadError ? (
            <p className="rounded-[12px] px-3 py-2 text-[12.5px] font-medium" style={{ backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}>{loadError}</p>
          ) : null}

          <div ref={viewWrapRef} className="relative">
            {view === "month" ? monthView() : view === "list" ? listView() : timeGrid()}
          </div>
        </main>
      </div>

      {/* Event pop-up */}
      {shouldRenderModal && d && typeof document !== "undefined"
        ? createPortal(
            <div data-app-gesture-exempt="true" className="fixed inset-0 z-[1700] flex items-center justify-center px-4 py-4">
              <button type="button" aria-label="Close" onClick={closeModal} className="glass-modal-backdrop absolute inset-0" />
              <div
                ref={modalPanelRef}
                className="glass-modal-panel relative z-[1701] flex max-h-[calc(100svh-32px)] w-full max-w-[560px] flex-col overflow-hidden"
                style={
                  viewingEvent
                    ? {
                        // Themed by the event's category: a wash of its colour over the glass.
                        backgroundImage: [
                          `radial-gradient(120% 70% at 0% 0%, color-mix(in srgb, ${draftCategory.color} 30%, transparent), transparent 70%)`,
                          `radial-gradient(90% 60% at 100% 100%, color-mix(in srgb, ${draftCategory.color} 14%, transparent), transparent 70%)`,
                          `linear-gradient(to bottom, color-mix(in srgb, ${draftCategory.color} 10%, transparent), color-mix(in srgb, ${draftCategory.color} 5%, transparent))`,
                        ].join(", "),
                      }
                    : undefined
                }
              >
                {viewingEvent && viewEvent ? (
                  <>
                    <div className="relative px-5 pb-4 pt-5">
                      <button type="button" onClick={closeModal} className={`${iconRemoveButtonClass} absolute right-3 top-3`} aria-label="Close">
                        <X size={16} />
                      </button>
                      <span
                        className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2.5 py-[3px] text-[12px] font-medium"
                        style={{
                          borderColor: `color-mix(in srgb, ${draftCategory.color} 45%, transparent)`,
                          backgroundColor: `color-mix(in srgb, ${draftCategory.color} 18%, transparent)`,
                          color: "var(--text-main)",
                        }}
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: draftCategory.color }} />
                        {draftCategory.name}
                      </span>
                      <h2 className="mt-2.5 pr-8 text-[22px] font-semibold leading-tight" style={{ color: "var(--text-main)" }}>
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
                              <p className="text-[13.5px]" style={{ color: "var(--text-muted)" }}>{when.secondary}</p>
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
                            <span className="block text-[11px] font-semibold uppercase tracking-[0.5px]" style={{ color: "var(--text-muted)" }}>Location</span>
                            <span className="block truncate text-[14px]" style={{ color: "var(--text-main)" }}>{viewEvent.location}</span>
                          </span>
                          <ExternalLink size={14} style={{ color: "var(--text-muted)" }} />
                        </a>
                      ) : null}
                      {viewEvent.projectId ? (
                        <Link
                          href={`/projects/${viewEvent.projectId}`}
                          className="flex items-center gap-3 rounded-[14px] border px-3 py-2.5 transition hover:brightness-95"
                          style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}
                        >
                          <FolderKanban size={17} className="shrink-0" style={{ color: draftCategory.color }} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[11px] font-semibold uppercase tracking-[0.5px]" style={{ color: "var(--text-muted)" }}>Project</span>
                            <span className="block truncate text-[14px]" style={{ color: "var(--text-main)" }}>{viewEvent.projectName || "Linked project"}</span>
                          </span>
                          <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
                        </Link>
                      ) : null}
                      {viewEvent.notes.trim() ? (
                        <div className="rounded-[14px] border px-3 py-2.5" style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.5px]" style={{ color: "var(--text-muted)" }}>Notes</p>
                          <p className="mt-0.5 whitespace-pre-wrap text-[14px]" style={{ color: "var(--text-main)" }}>{viewEvent.notes}</p>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
                      {d.createdByName ? addedBy("mr-auto min-w-0") : <span className="mr-auto" />}
                      {/* Phones already have the X in the top-right corner. */}
                      <button type="button" onClick={closeModal} className={`${secondaryButtonClass} hidden md:inline-flex`}>Close</button>
                      {!readOnly ? (
                        <button
                          type="button"
                          onClick={() => setEventMode("edit")}
                          className={primaryButtonClass}
                          style={{ backgroundColor: draftCategory.color, color: textOn(draftCategory.color), boxShadow: `0 6px 16px color-mix(in srgb, ${draftCategory.color} 35%, transparent)` }}
                        >
                          <Pencil size={14} /> Edit
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : (
                <>
                <div className="glass-modal-header flex items-center gap-2.5 px-4 py-3">
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: draftCategory.color }} />
                  <p className="flex-1 truncate text-[13px] font-extrabold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>
                    {d.isNew ? "New event" : readOnly ? "Event" : "Edit event"}
                  </p>
                  <button type="button" onClick={closeModal} className={iconRemoveButtonClass} aria-label="Close">
                    <X size={16} />
                  </button>
                </div>
                <form
                  className="flex min-h-0 flex-1 flex-col"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitDraft();
                  }}
                >
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                    <input
                      autoFocus={d.isNew}
                      readOnly={readOnly}
                      value={d.title}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                      placeholder="Event title"
                      className={`${glassFieldClass} h-11 text-[15px]`}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1.5 text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                        Category
                        <GlassDropdown
                          value={d.categoryId}
                          options={[
                            ...editableCategories.map((c) => ({ value: c.id, label: c.name, color: c.color })),
                            ...(editableCategories.some((c) => c.id === d.categoryId)
                              ? []
                              : [{ value: d.categoryId, label: (categoryById.get(d.categoryId) ?? UNCATEGORISED).name, color: (categoryById.get(d.categoryId) ?? UNCATEGORISED).color }]),
                          ]}
                          onChange={(next) => setDraft((prev) => (prev ? { ...prev, categoryId: next } : prev))}
                          ariaLabel="Category"
                          disabled={readOnly}
                          triggerClassName={`${glassFieldClass} justify-between`}
                        />
                      </label>
                      <div className="grid gap-1.5 text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                        All day
                        <div className="flex h-9 items-center">
                          <GlassSwitch
                            checked={d.allDay}
                            disabled={readOnly}
                            onChange={(on) => setDraft((prev) => (prev ? { ...prev, allDay: on } : prev))}
                            ariaLabel="All day"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {([
                        ["Starts", "startDate", "startTime"],
                        ["Ends", "endDate", "endTime"],
                      ] as const).map(([label, dateKey, timeKey]) => (
                        <div key={label} className="grid gap-1.5 text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                          {label}
                          <div className="flex gap-2">
                            <input
                              type="date"
                              readOnly={readOnly}
                              value={d[dateKey]}
                              onChange={(e) => {
                                const value = e.target.value;
                                setDraft((prev) => {
                                  if (!prev) return prev;
                                  const next = { ...prev, [dateKey]: value };
                                  // Keep the end on/after the start when the start date moves.
                                  if (dateKey === "startDate" && next.endDate < value) next.endDate = value;
                                  return next;
                                });
                              }}
                              className={`${glassFieldClass} min-w-0 flex-1`}
                            />
                            {!d.allDay ? (
                              <input
                                type="time"
                                step={SNAP_MIN * 60}
                                readOnly={readOnly}
                                value={d[timeKey]}
                                onChange={(e) => setDraft((prev) => (prev ? { ...prev, [timeKey]: e.target.value } : prev))}
                                className={`${glassFieldClass} w-[118px] shrink-0`}
                              />
                            ) : null}
                          </div>
                        </div>
                      ))}
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
                    {/* Optional link to a project */}
                    <div className="grid gap-1.5 text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                      Project
                      {d.projectId ? (
                        <div className="flex items-center gap-2 rounded-[11px] border px-3 py-2" style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}>
                          <FolderKanban size={15} style={{ color: "var(--brand-strong)" }} />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{d.projectName || "Linked project"}</span>
                          <Link href={`/projects/${d.projectId}`} className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: "var(--brand-strong)" }}>
                            Open <ExternalLink size={13} />
                          </Link>
                          {!readOnly ? (
                            <button
                              type="button"
                              onClick={() => setDraft((prev) => (prev ? { ...prev, projectId: "", projectName: "" } : prev))}
                              className={iconRemoveButtonClass}
                              aria-label="Unlink project"
                            >
                              <X size={14} />
                            </button>
                          ) : null}
                        </div>
                      ) : !readOnly ? (
                        <div className="grid gap-1">
                          <span className="relative flex items-center">
                            <Search size={15} className="pointer-events-none absolute left-3" style={{ color: "var(--text-muted)" }} />
                            <input
                              value={projectQuery}
                              onChange={(e) => setProjectQuery(e.target.value)}
                              placeholder="Link a project (optional) — search by name, client or address"
                              className={`${glassFieldClass} pl-9`}
                            />
                          </span>
                          {projectQuery.trim() ? (
                            <div className="grid max-h-[220px] gap-0.5 overflow-y-auto rounded-[12px] border p-1" style={{ borderColor: "var(--glass-border)" }}>
                              {filteredProjects.length === 0 ? (
                                <p className="px-2 py-1.5 text-[12px] font-normal" style={{ color: "var(--text-muted)" }}>No matching projects.</p>
                              ) : (
                                filteredProjects.map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => {
                                      setDraft((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              projectId: p.id,
                                              projectName: p.name,
                                              title: prev.title || p.name,
                                              location: prev.location || String(p.clientAddress || ""),
                                            }
                                          : prev,
                                      );
                                      setProjectQuery("");
                                    }}
                                    className="flex flex-col items-start rounded-[9px] px-2.5 py-1.5 text-left transition hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)]"
                                  >
                                    <span className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>{p.name}</span>
                                    <span className="text-[11.5px] font-normal" style={{ color: "var(--text-muted)" }}>{[p.customer, p.clientAddress].filter(Boolean).join(" · ")}</span>
                                  </button>
                                ))
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-[12.5px] font-normal" style={{ color: "var(--text-muted)" }}>None</p>
                      )}
                    </div>
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
                    <button type="button" onClick={closeModal} className={secondaryButtonClass}>
                      {readOnly ? "Close" : "Cancel"}
                    </button>
                    {!readOnly ? (
                      <button type="submit" disabled={saving} className={primaryButtonClass} style={primaryButtonStyle}>
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
