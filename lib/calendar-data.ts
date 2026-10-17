// Company calendar (the Calendar tab — a shared, Teamup-style calendar). Events live in
// companies/{companyId}/calendarEvents/{eventId}; the categories (Teamup's "sub-calendars") are a
// colour list on the company doc, managed in Company Settings > Calendar.
//
// Times are stored as epoch milliseconds. An all-day event runs from local midnight of its first day
// to local midnight of the day after its last day (end is exclusive), so a one-day all-day event is
// exactly 24h long and multi-day spans are easy to lay out.

import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where, writeBatch } from "@/lib/firestore-client";
import { db } from "@/lib/firebase";
import { invalidateUserCache, readUserDocCached } from "@/lib/firestore-cache";

// The categories themselves (names, colours, who can see them) — kept with no Firestore in them, so the server
// shares them (lib/calendar-categories.ts).
export {
  calendarCategoryLevel,
  DEFAULT_CALENDAR_CATEGORIES,
  isCalendarAccessLevel,
  normalizeCalendarCategories,
  type CalendarAccessLevel,
  type CalendarCategory,
  type CalendarViewer,
} from "@/lib/calendar-categories";

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
  // When it was added ("" if unknown), and who last changed it and when (shown as "Added by …" / "Modified
  // by …" in the event's pop-up). updatedByUid is "" until someone changes it after adding it.
  createdAtIso: string;
  updatedAtIso: string;
  updatedByUid: string;
  updatedByName: string;
  // With a linked project: shown on that project's client portal (Schedule tab).
  showToClient: boolean;
  // The staff on it (uids) — each is reminded before it (lib/calendar-reminders-server.ts). Linking a project puts
  // that project's assignee on it (its creator, when no one's assigned). null: saved before events had staff — those
  // count as its staff then (projectEventStaffUids), and it's saved with them the next time it's edited.
  staffUids: string[] | null;
};

// Who from a project goes on an event linked to it as its staff: whoever it's assigned to — or, with no one assigned,
// whoever made it. (Either can be taken off it again.)
export function projectEventStaffUids(project: { assignedToUid?: string; createdByUid?: string } | null | undefined): string[] {
  if (!project) return [];
  const assignee = String(project.assignedToUid ?? "").trim();
  const creator = String(project.createdByUid ?? "").trim();
  return assignee ? [assignee] : creator ? [creator] : [];
}

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


export function newCalendarId(prefix = "cal") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// When an id from newCalendarId was made (its first 8 characters after the prefix are the time), as an ISO
// string — "" if it isn't one. Events saved before createdAtIso was kept use it for theirs.
function calendarIdCreatedIso(id: string): string {
  const stamp = id.split("_")[1]?.slice(0, 8) ?? "";
  const ms = /^[0-9a-z]{8}$/.test(stamp) ? parseInt(stamp, 36) : NaN;
  // 2020 onwards, and not in the future.
  if (!Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms > Date.now() + 24 * 60 * 60 * 1000) return "";
  return new Date(ms).toISOString();
}

// Workdays: day-of-week numbers as Date.getDay() gives them (0 = Sunday ... 6 = Saturday). Defaults to
// Monday–Friday. The other days are shown crossed out (hatched) on the calendar.
export const DEFAULT_CALENDAR_WORKDAYS = [1, 2, 3, 4, 5];
export function normalizeCalendarWorkdays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return DEFAULT_CALENDAR_WORKDAYS;
  return Array.from(new Set(raw.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 0 && v <= 6))).sort();
}
// Company Settings > Calendar > show non-work days (company doc field calendarShowNonWorkdays). On by
// default; when off, the month and week views leave those days out altogether (the year view still shows
// them, crossed out).
export function normalizeCalendarShowNonWorkdays(raw: unknown): boolean {
  return raw !== false;
}

// User Settings > Preferences > Calendar Non-Work Days: a person's own choice (users/{uid}.calendarShowNonWorkdays) —
// Show or Hide, which beats the company's (above) for them — or null, "Company setting": the company's applies.
export async function fetchUserCalendarShowNonWorkdays(uid: string): Promise<boolean | null> {
  const data = await readUserDocCached(uid).catch(() => null);
  const value = data?.calendarShowNonWorkdays;
  return typeof value === "boolean" ? value : null;
}
export async function saveUserCalendarShowNonWorkdays(uid: string, value: boolean | null): Promise<boolean> {
  const userId = String(uid || "").trim();
  if (!db || !userId) return false;
  try {
    await setDoc(doc(db, "users", userId), { calendarShowNonWorkdays: value === null ? deleteField() : value }, { merge: true });
    invalidateUserCache(userId);
    return true;
  } catch {
    return false;
  }
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
    createdAtIso: String(data.createdAtIso ?? "") || calendarIdCreatedIso(id),
    updatedAtIso: String(data.updatedAtIso ?? ""),
    updatedByUid: String(data.updatedByUid ?? "").trim(),
    updatedByName: String(data.updatedByName ?? "").trim(),
    showToClient: data.showToClient === true,
    staffUids: Array.isArray(data.staffUids)
      ? Array.from(new Set(data.staffUids.map((uid) => String(uid ?? "").trim()).filter(Boolean)))
      : null,
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

// Live-updating events linked to one project (archived ones left out), earliest first — a project's Schedule (its
// Design tab). Returns an unsubscribe function.
export function subscribeProjectCalendarEvents(
  companyId: string,
  projectId: string,
  onEvents: (events: CalendarEvent[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  const cid = String(companyId || "").trim();
  const pid = String(projectId || "").trim();
  if (!db || !cid || !pid) {
    onEvents([]);
    return () => {};
  }
  const q = query(collection(db, "companies", cid, "calendarEvents"), where("projectId", "==", pid));
  return onSnapshot(
    q,
    (snap) => {
      const events = snap.docs
        .map((d) => toEvent(d.id, (d.data() ?? {}) as Record<string, unknown>))
        .filter((e): e is CalendarEvent => Boolean(e))
        .sort((a, b) => a.startMs - b.startMs);
      onEvents(events);
    },
    (error) => onError?.(error),
  );
}

// One event (null if it's gone or archived) — e.g. to open it from a calendar reminder notification.
export async function fetchCalendarEvent(companyId: string, eventId: string): Promise<CalendarEvent | null> {
  if (!db || !companyId || !eventId) return null;
  try {
    const snap = await getDoc(doc(db, "companies", companyId, "calendarEvents", eventId));
    return snap.exists() ? toEvent(snap.id, (snap.data() ?? {}) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function saveCalendarEvent(companyId: string, event: CalendarEvent): Promise<{ ok: boolean; error?: string }> {
  const cid = String(companyId || "").trim();
  if (!db || !cid || !event.id) return { ok: false, error: "missing-company" };
  // An event from before staff (staffUids null) keeps none saved — its project's people still count (see staffUids).
  const { staffUids, ...fields } = event;
  try {
    // updatedAt (the server's time, not this device's): how the calendar reminders job notices an event's been saved
    // since it last looked (lib/calendar-reminders-server.ts).
    await setDoc(
      doc(db, "companies", cid, "calendarEvents", event.id),
      { ...fields, ...(staffUids ? { staffUids } : {}), companyId: cid, updatedAtIso: new Date().toISOString(), updatedAt: serverTimestamp() },
      { merge: true },
    );
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
