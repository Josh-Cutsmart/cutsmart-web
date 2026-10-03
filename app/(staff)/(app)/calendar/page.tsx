"use client";

// The Calendar tab — a shared, Teamup-style company calendar. Month / week / day / list views;
// click a day (or a time in week/day view) to add an event; drag events to move them, drag an
// event's bottom edge in week/day view to change its length. Events sync live between everyone
// (lib/calendar-data.ts). Categories (with colours) are managed in Company Settings > Calendar and can
// be shown/hidden here per person. Who can see / edit is the role's calendar.view / calendar.edit.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Filter, FolderKanban, MapPin, Plus, Search, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyDoc, fetchProjects } from "@/lib/firestore-data";
import { hasPermissionKey, isOwnerOrAdmin, useCompanyAccess } from "@/lib/use-company-access";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { DragGhostLayer, useDragGhost } from "@/lib/use-drag-ghost";
import { activeDate, useCompanyFormats } from "@/lib/company-formats";
import {
  deleteCalendarEvent,
  newCalendarId,
  normalizeCalendarCategories,
  saveCalendarEvent,
  subscribeCalendarEvents,
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
function viewRange(view: CalendarView, cursor: Date): { from: Date; to: Date } {
  if (view === "month") {
    const from = startOfWeek(startOfMonth(cursor));
    return { from, to: addDays(from, 42) };
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
// Lays the bar events of one row of `cols` days (starting rowStart) into stacked lanes.
function layoutBars(rowStart: Date, cols: number, evs: CalendarEvent[]): { bars: BarSlot[]; lanes: number } {
  const rowStartMs = startOfDay(rowStart).getTime();
  const col = (ms: number) => Math.round((startOfDay(ms).getTime() - rowStartMs) / DAY_MS);
  const items = evs
    .filter(isBarEvent)
    .map((event) => {
      const first = col(event.startMs);
      const last = col(event.endMs - 1);
      return { event, first, last, startCol: Math.max(0, first), endCol: Math.min(cols - 1, last) };
    })
    .filter((it) => it.endCol >= 0 && it.startCol <= cols - 1)
    .sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol) || a.event.startMs - b.event.startMs);
  const laneEnds: number[] = [];
  const bars: BarSlot[] = items.map((it) => {
    let lane = laneEnds.findIndex((end) => end < it.startCol);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = it.endCol;
    return { event: it.event, startCol: it.startCol, endCol: it.endCol, lane, contBefore: it.first < 0, contAfter: it.last > cols - 1 };
  });
  return { bars, lanes: laneEnds.length };
}
const BAR_H = 20;
const PREVIEW_SUFFIX = "__preview";

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
  const canEdit = access.status === "ready" && (isOwnerOrAdmin(access.role) || hasPermissionKey(access.permissionKeys, "calendar.edit"));
  const canView = access.status === "ready" && (canEdit || hasPermissionKey(access.permissionKeys, "calendar.view"));

  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()));
  const [categories, setCategories] = useState<CalendarCategory[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadError, setLoadError] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);

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
      if (!cancelled) setCategories(normalizeCalendarCategories((docData as Record<string, unknown> | null)?.calendarCategories));
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
  // Live preview while dragging in week/day view.
  const [dragPreview, setDragPreview] = useState<{ id: string; startMs: number; endMs: number } | null>(null);
  const visibleEvents = useMemo(
    () =>
      events
        .filter((e) => !hidden.has(categoryOf(e).id))
        .map((e) => (dragPreview && dragPreview.id === e.id ? { ...e, startMs: dragPreview.startMs, endMs: dragPreview.endMs } : e))
        .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startMs - b.startMs || b.endMs - a.endMs),
    [categoryOf, dragPreview, events, hidden],
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

  const openNew = (startMs: number, allDay: boolean, e?: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>) => {
    if (!canEdit) return;
    const endMs = allDay ? startMs : startMs + 60 * 60 * 1000;
    setModalOrigin(e ? captureGlassModalOrigin(e as ReactMouseEvent<HTMLElement>) : null);
    setModalError("");
    setConfirmDelete(false);
    setProjectQuery("");
    const next: Draft = {
      id: newCalendarId("evt"),
      isNew: true,
      title: "",
      categoryId: categories.find((c) => !hidden.has(c.id))?.id ?? categories[0]?.id ?? "",
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
    const next = draftFromEvent(event);
    setDraft(next);
    setRenderedDraft(next);
  };
  const closeModal = () => setDraft(null);
  const submitDraft = async () => {
    if (!draft || !companyId || !canEdit) return;
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
    if (!draft || !companyId || !canEdit) return;
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
    if (!companyId || !canEdit) return;
    setEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, startMs, endMs } : e)));
    const result = await saveCalendarEvent(companyId, { ...event, startMs, endMs });
    if (!result.ok) setLoadError("Couldn't move that event — try again.");
  };

  // ---------------------------------------------------------------- navigation
  const step = (dir: -1 | 1) => {
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
  const renderChip = (event: CalendarEvent, day: Date) => {
    const cat = categoryOf(event);
    const chipId = `cal_chip_${event.id}_${startOfDay(day).getTime()}`;
    return (
      <button
        key={chipId}
        id={chipId}
        type="button"
        draggable={canEdit}
        onDragStart={(e) => beginDayDrag(e, event, chipId, event.startMs)}
        onDragEnd={endDayDrag}
        onClick={(e) => {
          e.stopPropagation();
          openExisting(event, e);
        }}
        className="flex h-[18px] w-full min-w-0 items-center gap-1.5 truncate rounded-[6px] px-1.5 text-left text-[10.5px] font-medium transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]"
        style={{
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
        const cat = categoryOf(b.event);
        const barId = `cal_bar_${b.event.id}_${startOfDay(rowStart).getTime()}`;
        const span = b.endCol - b.startCol + 1;
        return (
          <button
            key={barId}
            id={barId}
            type="button"
            draggable={canEdit}
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
            className="pointer-events-auto absolute flex items-center gap-1 truncate px-2 text-left text-[11px] font-semibold transition hover:brightness-95"
            style={{
              top: b.lane * BAR_H,
              height: BAR_H - 3,
              left: `calc(${(b.startCol / cols) * 100}% + ${b.contBefore ? 0 : 3}px)`,
              width: `calc(${(span / cols) * 100}% - ${(b.contBefore ? 0 : 3) + (b.contAfter ? 0 : 3)}px)`,
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

  const monthView = () => {
    const from = range.from;
    const weeks = Array.from({ length: 6 }, (_, w) => addDays(from, w * 7));
    const month = cursor.getMonth();
    const MAX_LANES = 3;
    const SLOTS = 4; // bar lanes + timed chips shown per day before "+N more"
    return (
      <div className="overflow-hidden rounded-[20px] border" style={cardStyle}>
        <div className="grid grid-cols-7 border-b" style={{ borderColor: "var(--glass-border)" }}>
          {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => (
            <div key={d.getTime()} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
              {weekdayShort(d)}
            </div>
          ))}
        </div>
        {weeks.map((weekStart) => {
          const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
          const { bars, lanes } = layoutBars(weekStart, 7, dayLayoutEvents);
          const shownLanes = Math.min(lanes, MAX_LANES);
          return (
            <div key={weekStart.getTime()} className="relative grid grid-cols-7 border-b last:border-b-0" style={{ borderColor: "var(--glass-border)" }}>
              {days.map((d, col) => {
                const dayMs = d.getTime();
                const isToday = sameDay(d, today);
                const inMonth = d.getMonth() === month;
                const hiddenBars = bars.filter((b) => b.lane >= MAX_LANES && b.startCol <= col && b.endCol >= col).length;
                const chips = dayLayoutEvents.filter((e) => !isBarEvent(e) && overlapsDay(e, d));
                const lanesHere = Math.max(0, ...bars.filter((b) => b.lane < MAX_LANES && b.startCol <= col && b.endCol >= col).map((b) => b.lane + 1));
                const chipRoom = Math.max(1, SLOTS - lanesHere);
                const shownChips = chips.slice(0, chips.length > chipRoom ? chipRoom - 1 : chipRoom);
                const more = chips.length - shownChips.length + hiddenBars;
                return (
                  <div
                    key={dayMs}
                    onClick={(e) => openNew(dayMs, true, e)}
                    {...dayDropProps(dayMs)}
                    className={`group relative flex min-h-[92px] min-w-0 flex-col gap-0.5 border-r p-1 transition-colors [&:nth-child(7)]:border-r-0 md:min-h-[118px] ${canEdit ? "cursor-pointer hover:bg-[color-mix(in_srgb,var(--text-main)_3%,transparent)]" : ""}`}
                    style={{
                      borderColor: "var(--glass-border)",
                      backgroundColor: monthDropDay === dayMs ? "var(--brand-soft)" : inMonth ? undefined : "color-mix(in srgb, var(--text-main) 2.5%, transparent)",
                    }}
                  >
                    <div className="flex items-center justify-between px-0.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCursor(startOfDay(d));
                          changeView("day");
                        }}
                        className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] font-semibold transition hover:bg-[color-mix(in_srgb,var(--text-main)_7%,transparent)]"
                        style={isToday ? { backgroundImage: "var(--brand-gradient)", color: "#fff" } : { color: inMonth ? "var(--text-main)" : "var(--text-muted)" }}
                        title="Open this day"
                      >
                        {d.getDate()}
                      </button>
                      {canEdit ? <Plus size={13} className="opacity-0 transition group-hover:opacity-60" style={{ color: "var(--text-muted)" }} /> : null}
                    </div>
                    {/* Room for this row's bars, which are drawn over the whole week below. */}
                    <div className="shrink-0" style={{ height: shownLanes * BAR_H }} />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {shownChips.map((e) => renderChip(e, d))}
                      {more > 0 ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCursor(startOfDay(d));
                            changeView("day");
                          }}
                          className="px-1.5 text-left text-[11px] font-semibold"
                          style={{ color: "var(--brand-strong)" }}
                        >
                          +{more} more
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {/* The week's continuous bars, positioned under the day numbers. */}
              <div className="pointer-events-none absolute inset-x-0" style={{ top: 30, height: shownLanes * BAR_H }}>
                {renderBars(bars, weekStart, 7, MAX_LANES)}
              </div>
            </div>
          );
        })}
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
    if (!canEdit || e.button !== 0) return;
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
      <div className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border" style={cardStyle}>
        {/* Day headers, then the all-day row (all-day and multi-day events as continuous bars). */}
        {(() => {
          const { bars, lanes } = layoutBars(range.from, dayCount, dayLayoutEvents);
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
                      className={`border-l first:border-l-0 ${canEdit ? "cursor-pointer hover:bg-[color-mix(in_srgb,var(--text-main)_3%,transparent)]" : ""}`}
                      style={{ borderColor: "var(--glass-border)", backgroundColor: monthDropDay === d.getTime() ? "var(--brand-soft)" : undefined }}
                      title={canEdit ? "Add an all-day event" : undefined}
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
                    className={`relative border-l first:border-l-0 ${canEdit ? "cursor-pointer" : ""}`}
                    style={{
                      borderColor: "var(--glass-border)",
                      backgroundImage: `repeating-linear-gradient(to bottom, var(--glass-border) 0, var(--glass-border) 1px, transparent 1px, transparent ${HOUR_PX}px)`,
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
                            if (!canEdit) openExisting(event, e);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") openExisting(event);
                          }}
                          className={`absolute z-[2] overflow-hidden rounded-[8px] px-1.5 py-1 text-left text-[11.5px] leading-tight shadow-[0_2px_8px_rgba(15,23,42,0.12)] ${canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
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
                          <p className="truncate font-semibold">{event.title || "Untitled event"}</p>
                          {height > 30 ? (
                            <p className="truncate opacity-85">
                              {timeText(event.startMs)} – {timeText(event.endMs)}
                            </p>
                          ) : null}
                          {height > 46 && event.location ? <p className="truncate opacity-80">{event.location}</p> : null}
                          {canEdit ? (
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
      <div className="overflow-hidden rounded-[20px] border" style={cardStyle}>
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
                      <span className="block truncate text-[13px] font-medium" style={{ color: "var(--text-main)" }}>{e.title || "Untitled event"}</span>
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
    const hasUncategorised = events.some((e) => !categoryById.has(e.categoryId));
    return hasUncategorised ? [...categories, UNCATEGORISED] : categories;
  }, [categories, categoryById, events]);
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
  const readOnly = !canEdit;
  const draftCategory = d ? categoryById.get(d.categoryId) ?? UNCATEGORISED : UNCATEGORISED;

  return (
    <div
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
          {canEdit ? (
            <button type="button" onClick={(e) => openNew(Date.now() - (Date.now() % (30 * 60000)) + 30 * 60000, false, e)} className={primaryButtonClass} style={primaryButtonStyle}>
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
            {canEdit ? (
              <button
                type="button"
                onClick={(e) => openNew(Date.now() - (Date.now() % (30 * 60000)) + 30 * 60000, false, e)}
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

          {view === "month" ? monthView() : view === "list" ? listView() : timeGrid()}
        </main>
      </div>

      {/* Event pop-up */}
      {shouldRenderModal && d && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[1700] flex items-center justify-center px-4 py-4">
              <button type="button" aria-label="Close" onClick={closeModal} className="glass-modal-backdrop absolute inset-0" />
              <div ref={modalPanelRef} className="glass-modal-panel relative z-[1701] flex max-h-[calc(100svh-32px)] w-full max-w-[560px] flex-col overflow-hidden">
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
                            ...categories.map((c) => ({ value: c.id, label: c.name, color: c.color })),
                            ...(categoryById.has(d.categoryId) ? [] : [{ value: d.categoryId, label: UNCATEGORISED.name, color: UNCATEGORISED.color }]),
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
                    {!d.isNew && d.createdByName ? (
                      <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>Added by {d.createdByName}</p>
                    ) : null}
                    {modalError ? (
                      <p className="text-[12px] font-medium" style={{ color: "var(--danger-strong)" }}>{modalError}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 border-t px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
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
              </div>
            </div>,
            document.body,
          )
        : null}
      <DragGhostLayer controller={ghost} />
    </div>
  );
}
