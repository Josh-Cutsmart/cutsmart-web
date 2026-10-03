// Company calendar (the Calendar tab — a shared, Teamup-style calendar). Events live in
// companies/{companyId}/calendarEvents/{eventId}; the categories (Teamup's "sub-calendars") are a
// colour list on the company doc, managed in Company Settings > Calendar.
//
// Times are stored as epoch milliseconds. An all-day event runs from local midnight of its first day
// to local midnight of the day after its last day (end is exclusive), so a one-day all-day event is
// exactly 24h long and multi-day spans are easy to lay out.

import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type CalendarCategory = { id: string; name: string; color: string };

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
      return { id, name, color: String(row.color ?? "").trim() || "#7D99B3" };
    })
    .filter((row) => row.id && row.name);
}

function toEvent(id: string, data: Record<string, unknown>): CalendarEvent | null {
  const startMs = Number(data.startMs);
  const endMs = Number(data.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
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
