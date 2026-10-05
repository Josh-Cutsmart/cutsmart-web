// Company calendar (the Calendar tab — a shared, Teamup-style calendar). Events live in
// companies/{companyId}/calendarEvents/{eventId}; the categories (Teamup's "sub-calendars") are a
// colour list on the company doc, managed in Company Settings > Calendar.
//
// Times are stored as epoch milliseconds. An all-day event runs from local midnight of its first day
// to local midnight of the day after its last day (end is exclusive), so a one-day all-day event is
// exactly 24h long and multi-day spans are easy to lay out.

import { collection, deleteDoc, doc, getDocs, onSnapshot, query, setDoc, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Per-category access, keyed by normalized role id (normalizeRoleKey). A role with no entry gets View;
// owners and admins can always edit everything.
export type CalendarAccessLevel = "edit" | "view" | "none";
export type CalendarCategory = { id: string; name: string; color: string; access?: Record<string, CalendarAccessLevel> };

export function isCalendarAccessLevel(value: unknown): value is CalendarAccessLevel {
  return value === "edit" || value === "view" || value === "none";
}

export type CalendarEvent = {
  id: string;
  title: string;
  categoryId: string;
  allDay: boolean;
  startMs: number;
  endMs: number;
  location: string;
  notes: string;
  projectId: string;
  projectName: string;
  createdByUid: string;
  createdByName: string;
  updatedAtIso: string;
  // With a linked project: shown on that project's client portal (Schedule tab).
  showToClient: boolean;
};

// What the client portal's Schedule tab gets for one event (app/api/specs-share/[shareId]/schedule) —
// never the location, notes or who added it.
export type ClientScheduleEvent = {
  id: string;
  title: string;
  allDay: boolean;
  startMs: number;
  endMs: number;
  categoryName: string;
  color: string;
};

export const DEFAULT_CALENDAR_CATEGORIES: CalendarCategory[] = [
  { id: "installs", name: "Installs", color: "#16A34A" },
  { id: "measures", name: "Measures", color: "#2F6BFF" },
  { id: "deliveries", name: "Deliveries", color: "#F2A33C" },
  { id: "meetings", name: "Meetings", color: "#8B5CF6" },
  { id: "leave", name: "Leave", color: "#DC2626" },
];

export function newCalendarId(prefix = "cal") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Workdays: day-of-week numbers as Date.getDay() gives them (0 = Sunday ... 6 = Saturday). Defaults to
// Monday–Friday. The other days are shown crossed out (hatched) on the calendar.
export const DEFAULT_CALENDAR_WORKDAYS = [1, 2, 3, 4, 5];
export function normalizeCalendarWorkdays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return DEFAULT_CALENDAR_WORKDAYS;
  return Array.from(new Set(raw.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 0 && v <= 6))).sort();
}

// Company Settings > Calendar > "Archive events after": events that ended longer ago than this are
// archived (kept in the database, no longer shown on the calendar).
export type CalendarRetention = "never" | "1w" | "1m" | "3m" | "6m" | "1y" | "2y";
export const CALENDAR_RETENTION_OPTIONS: Array<{ value: CalendarRetention; label: string }> = [
  { value: "never", label: "Never" },
  { value: "1w", label: "1 week" },
  { value: "1m", label: "1 month" },
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
  { value: "1y", label: "1 year" },
  { value: "2y", label: "2 years" },
];
export function normalizeCalendarRetention(raw: unknown): CalendarRetention {
  return CALENDAR_RETENTION_OPTIONS.some((o) => o.value === raw) ? (raw as CalendarRetention) : "never";
}
// The cut-off (epoch ms) for a retention setting: events that ended before it are archived. 0 = never.
export function calendarRetentionCutoffMs(retention: CalendarRetention, now = Date.now()): number {
  if (retention === "never") return 0;
  const d = new Date(now);
  if (retention === "1w") d.setDate(d.getDate() - 7);
  else if (retention === "1m") d.setMonth(d.getMonth() - 1);
  else if (retention === "3m") d.setMonth(d.getMonth() - 3);
  else if (retention === "6m") d.setMonth(d.getMonth() - 6);
  else if (retention === "1y") d.setFullYear(d.getFullYear() - 1);
  else d.setFullYear(d.getFullYear() - 2);
  return d.getTime();
}

export function normalizeCalendarCategories(raw: unknown): CalendarCategory[] {
  if (!Array.isArray(raw)) return DEFAULT_CALENDAR_CATEGORIES;
  const seen = new Set<string>();
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      const name = String(row.name ?? "").trim();
      let id = String(row.id ?? "").trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      while (id && seen.has(id)) id = `${id}_2`;
      if (id) seen.add(id);
      const access: Record<string, CalendarAccessLevel> = {};
      if (row.access && typeof row.access === "object") {
        for (const [roleKey, level] of Object.entries(row.access as Record<string, unknown>)) {
          if (roleKey && isCalendarAccessLevel(level)) access[roleKey] = level;
        }
      }
      return { id, name, color: String(row.color ?? "").trim() || "#7D99B3", ...(Object.keys(access).length ? { access } : {}) };
    })
    .filter((row) => row.id && row.name);
}

function toEvent(id: string, data: Record<string, unknown>): CalendarEvent | null {
  const startMs = Number(data.startMs);
  const endMs = Number(data.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  // Archived (see archiveOldCalendarEvents): kept, but no longer on the calendar.
  if (data.archived === true) return null;
  return {
    id,
    title: String(data.title ?? "").trim(),
    categoryId: String(data.categoryId ?? "").trim(),
    allDay: Boolean(data.allDay),
    startMs,
    endMs: Math.max(endMs, startMs),
    location: String(data.location ?? "").trim(),
    notes: String(data.notes ?? ""),
    projectId: String(data.projectId ?? "").trim(),
    projectName: String(data.projectName ?? "").trim(),
    createdByUid: String(data.createdByUid ?? "").trim(),
    createdByName: String(data.createdByName ?? "").trim(),
    updatedAtIso: String(data.updatedAtIso ?? ""),
    showToClient: data.showToClient === true,
  };
}

// Longest event the range query reaches back for: an event that started more than this long before
// the visible range but is still running into it won't show. Generous for joinery-style bookings.
const MAX_EVENT_SPAN_MS = 120 * 24 * 60 * 60 * 1000;

// Live-updating events overlapping [fromMs, toMs). Returns an unsubscribe function.
export function subscribeCalendarEvents(
  companyId: string,
  fromMs: number,
  toMs: number,
  onEvents: (events: CalendarEvent[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  const cid = String(companyId || "").trim();
  if (!db || !cid) {
    onEvents([]);
    return () => {};
  }
  const q = query(
    collection(db, "companies", cid, "calendarEvents"),
    where("startMs", ">=", fromMs - MAX_EVENT_SPAN_MS),
    where("startMs", "<", toMs),
  );
  return onSnapshot(
    q,
    (snap) => {
      const events = snap.docs
        .map((d) => toEvent(d.id, (d.data() ?? {}) as Record<string, unknown>))
        .filter((e): e is CalendarEvent => Boolean(e) && (e as CalendarEvent).endMs > fromMs);
      onEvents(events);
    },
    (error) => onError?.(error),
  );
}

export async function saveCalendarEvent(companyId: string, event: CalendarEvent): Promise<{ ok: boolean; error?: string }> {
  const cid = String(companyId || "").trim();
  if (!db || !cid || !event.id) return { ok: false, error: "missing-company" };
  try {
    await setDoc(doc(db, "companies", cid, "calendarEvents", event.id), { ...event, companyId: cid, updatedAtIso: new Date().toISOString() }, { merge: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String((error as { code?: string })?.code || "save-failed") };
  }
}

// Marks every not-yet-archived event that ended before cutoffMs as archived. Safe to run repeatedly,
// but it reads every past event, so it's only run once a day per company per device (the calendar
// already hides anything past the cut-off immediately, so nothing waits on it).
const ARCHIVE_LAST_RUN_KEY = "cutsmart_calendar_archive_last_run_";
const ARCHIVE_RUN_EVERY_MS = 24 * 60 * 60 * 1000;
export async function archiveOldCalendarEvents(companyId: string, cutoffMs: number): Promise<number> {
  const cid = String(companyId || "").trim();
  if (!db || !cid || !cutoffMs) return 0;
  try {
    const last = Number(window.localStorage.getItem(`${ARCHIVE_LAST_RUN_KEY}${cid}`) || 0);
    if (Date.now() - last < ARCHIVE_RUN_EVERY_MS) return 0;
    window.localStorage.setItem(`${ARCHIVE_LAST_RUN_KEY}${cid}`, String(Date.now()));
  } catch {
    // storage unavailable — just run it
  }
  const database = db;
  try {
    const snap = await getDocs(query(collection(database, "companies", cid, "calendarEvents"), where("startMs", "<", cutoffMs)));
    const stale = snap.docs.filter((d) => {
      const data = d.data() ?? {};
      return data.archived !== true && Number(data.endMs) <= cutoffMs;
    });
    const archivedAtIso = new Date().toISOString();
    for (let i = 0; i < stale.length; i += 400) {
      const batch = writeBatch(database);
      stale.slice(i, i + 400).forEach((d) => batch.update(d.ref, { archived: true, archivedAtIso }));
      await batch.commit();
    }
    return stale.length;
  } catch {
    return 0;
  }
}

export async function deleteCalendarEvent(companyId: string, eventId: string): Promise<{ ok: boolean }> {
  const cid = String(companyId || "").trim();
  if (!db || !cid || !eventId) return { ok: false };
  try {
    await deleteDoc(doc(db, "companies", cid, "calendarEvents", eventId));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
