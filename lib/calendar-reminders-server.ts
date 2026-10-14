import { FieldPath } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { calendarCategoryLevel, normalizeCalendarCategories, type CalendarCategory } from "@/lib/calendar-categories";
import { hasPermissionKey, resolveMemberAccess } from "@/lib/company-access-server";
import {
  calendarReminderLeadForCategory,
  DEFAULT_REMINDER_AT,
  isDayReminderUnit,
  normalizeCalendarCategoryReminders,
  normalizeCalendarReminderLead,
  type CalendarReminderRow,
} from "@/lib/push-notification-types";
import { isCompanyMemberUid, pushStoredNotification } from "@/lib/push-server";

// Calendar reminders: "<event> for <project> is in 2 days" ("<event> is in 2 days" with no project). An event
// reminds each of its staff (staffUids — linking a project puts that project's creator and assignee on it; an event
// saved before events had staff: its linked project's assignee and creator), as far ahead as they chose (User
// Settings > Phone & Desktop Notifications > Upcoming events) — each calendar category's own reminders, or their usual ones
// (users/{uid}.calendarReminderCategories / calendarReminderLead), one list for timed and all-day events: minutes
// and hours exactly that long before a timed event (an all-day event: 8am on the day); days, weeks and months on
// that day before the event at the reminder's own time — local time, the company's time zone (Company Settings). Not for a category they've switched off,
// nor one they can't see (no access to it — the same rule as the Calendar, lib/calendar-categories.ts). Each reminder goes in their
// Notifications list and to their devices (if they want that kind). It runs from
// app/api/cron/calendar-reminders (a scheduled call every few minutes) and, as a fallback, whenever
// someone in the company has the app open (app/api/push/reminders-tick).
//
// Each of a person's reminder times is sent once per event time: the event remembers it
// (remindersSent.{uid}_m{minutes} / {uid}_d{days} / {uid}_mo{months} — with _HHMM when not at 8am — = the startMs it was sent for), so moving the event
// to a new time sends fresh ones. If several fall due at once (an event made at short notice), only the
// nearest is sent — the rest are just marked done. (remindersSent.{uid} alone is from before there could
// be several: those count as already sent.)

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// The furthest ahead anyone can ask to be told (1 month — CALENDAR_REMINDER_UNITS' most), plus a couple of days.
const LOOKAHEAD_MS = 33 * DAY_MS;
// The company's time zone when it hasn't set one (Company Settings' own default).
const DEFAULT_TIME_ZONE = "Pacific/Auckland";

// An instant's date and time on the clock in a time zone.
function zonedParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(ms));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute") };
}
// The instant a date and time on the clock is, in a time zone (checked twice, for the hours around a daylight-saving
// change).
function zonedTimeToMs(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (ms: number) => {
    const p = zonedParts(ms, timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / MINUTE_MS) * MINUTE_MS;
  };
  const first = wall - offsetAt(wall);
  return wall - offsetAt(first);
}
// When each of someone's reminders for an event falls due, keyed as the event remembers it's been sent. Minutes and
// hours: exactly that long before a timed event; on an all-day event, 8am on its day. Days, weeks and months: that
// many before the event's day (its date in the company's time zone), at the reminder's time there. Several landing
// on the same moment are the one reminder.
function reminderTimes(uid: string, startMs: number, allDay: boolean, reminders: CalendarReminderRow[], timeZone: string) {
  const eventDay = zonedParts(startMs, timeZone);
  const atTime = (date: Date, at: string) => {
    const [hours, minutes] = at.split(":").map(Number);
    return zonedTimeToMs(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hours || 0, minutes || 0, timeZone);
  };
  const byKey = new Map<string, { key: string; remindAt: number }>();
  for (const reminder of reminders) {
    if (!isDayReminderUnit(reminder.unit)) {
      const minutes = reminder.amount * (reminder.unit === "hours" ? 60 : 1);
      const time = allDay
        ? { key: `${uid}_d0`, remindAt: atTime(new Date(Date.UTC(eventDay.year, eventDay.month - 1, eventDay.day)), DEFAULT_REMINDER_AT) }
        : { key: `${uid}_m${minutes}`, remindAt: startMs - minutes * MINUTE_MS };
      byKey.set(time.key, time);
      continue;
    }
    const date = new Date(Date.UTC(eventDay.year, eventDay.month - 1, eventDay.day));
    if (reminder.unit === "months") date.setUTCMonth(date.getUTCMonth() - reminder.amount);
    else date.setUTCDate(date.getUTCDate() - reminder.amount * (reminder.unit === "weeks" ? 7 : 1));
    const base = reminder.unit === "months" ? `${uid}_mo${reminder.amount}` : `${uid}_d${reminder.amount * (reminder.unit === "weeks" ? 7 : 1)}`;
    const key = `${base}${reminder.at === DEFAULT_REMINDER_AT ? "" : `_${reminder.at.replace(":", "")}`}`;
    byKey.set(key, { key, remindAt: atTime(date, reminder.at) });
  }
  return [...byKey.values()];
}

const PROJECT_ASSIGNEE_FIELDS = ["assignedToUid", "assignedUid", "projectAssignedUid"];

function str(value: unknown): string {
  return String(value ?? "").trim();
}

// "in 30 minutes", "in 2 hours", "today", "tomorrow", "in 3 days", "in 2 weeks", "in 1 month".
export function timeUntilPhrase(msUntil: number, allDay: boolean): string {
  // An all-day event reminded on its own day.
  if (allDay && msUntil <= 0) return "today";
  const plural = (count: number, unit: string) => `in ${count} ${unit}${count === 1 ? "" : "s"}`;
  const days = msUntil / DAY_MS;
  if (allDay || days >= 1) {
    const wholeDays = Math.max(1, Math.round(days));
    if (wholeDays >= 28) return plural(Math.max(1, Math.round(wholeDays / 30)), "month");
    if (wholeDays >= 7) return plural(Math.round(wholeDays / 7), "week");
    if (wholeDays === 1) return "tomorrow";
    return plural(wholeDays, "day");
  }
  const hours = msUntil / HOUR_MS;
  if (hours >= 1) return plural(Math.round(hours), "hour");
  return plural(Math.max(1, Math.round(msUntil / MINUTE_MS)), "minute");
}

type ProjectInfo = { assigneeUid: string; creatorUid: string; name: string; closed: boolean } | null;

export type CalendarReminderRunResult = { companies: number; events: number; sent: number };

// Checks the given companies (or every company) and sends whatever reminders are due.
export async function runCalendarReminders(options: { siteOrigin: string; companyIds?: string[]; now?: number }): Promise<CalendarReminderRunResult> {
  const result: CalendarReminderRunResult = { companies: 0, events: 0, sent: 0 };
  if (!adminDb) return result;
  const db = adminDb;
  const now = options.now ?? Date.now();
  const companyIds = options.companyIds?.length
    ? options.companyIds
    : (await db.collection("companies").select().get()).docs.map((docSnap) => docSnap.id);

  // Each person's reminder timing — their usual times and each calendar category's — read once per run.
  type ReminderPrefs = {
    usual: ReturnType<typeof normalizeCalendarReminderLead>;
    categories: ReturnType<typeof normalizeCalendarCategoryReminders>;
  };
  const prefsByUid = new Map<string, ReminderPrefs>();
  const prefsFor = async (uid: string) => {
    if (!prefsByUid.has(uid)) {
      const data = (await db.collection("users").doc(uid).get()).data();
      prefsByUid.set(uid, {
        usual: normalizeCalendarReminderLead(data?.calendarReminderLead),
        categories: normalizeCalendarCategoryReminders(data?.calendarReminderCategories),
      });
    }
    return prefsByUid.get(uid)!;
  };

  for (const companyId of companyIds) {
    result.companies += 1;
    const companyRef = db.collection("companies").doc(companyId);
    let eventsSnap;
    try {
      eventsSnap = await companyRef
        .collection("calendarEvents")
        // From a day back: an all-day event's reminder on its own day comes after it has started (midnight).
        .where("startMs", ">", now - DAY_MS)
        .where("startMs", "<=", now + LOOKAHEAD_MS)
        .get();
    } catch {
      continue;
    }
    // The company's calendar categories (who can see them) and time zone — read once per company, only when needed.
    let companyInfo: { categoryById: Map<string, CalendarCategory>; timeZone: string } | null = null;
    const loadCompanyInfo = async () => {
      if (!companyInfo) {
        const companyData = (await companyRef.get()).data();
        const savedZone = str(companyData?.timeZone);
        let timeZone = DEFAULT_TIME_ZONE;
        try {
          if (savedZone) {
            new Intl.DateTimeFormat("en-US", { timeZone: savedZone });
            timeZone = savedZone;
          }
        } catch {
          // Not a time zone this server knows — the default.
        }
        companyInfo = {
          categoryById: new Map(normalizeCalendarCategories(companyData?.calendarCategories).map((category) => [category.id, category])),
          timeZone,
        };
      }
      return companyInfo;
    };
    const categoryFor = async (categoryId: string) => (await loadCompanyInfo()).categoryById.get(categoryId);
    // Whether someone can see a category's events — per person, their role read once per company. Someone with
    // no membership record (an old account linked only by their profile) isn't held back by it.
    const accessByUid = new Map<string, Awaited<ReturnType<typeof resolveMemberAccess>>>();
    const canSeeCategory = async (uid: string, categoryId: string) => {
      if (!accessByUid.has(uid)) accessByUid.set(uid, await resolveMemberAccess(companyId, uid));
      const access = accessByUid.get(uid)!;
      if (!access.exists) return true;
      const isAdmin = access.roleId === "owner" || access.roleId === "admin";
      const canViewCalendar =
        isAdmin || hasPermissionKey(access.permissionKeys, "calendar.view") || hasPermissionKey(access.permissionKeys, "calendar.edit");
      return calendarCategoryLevel(await categoryFor(categoryId), { isAdmin, roleKey: access.roleId, canViewCalendar }) !== "none";
    };
    const projectCache = new Map<string, ProjectInfo>();
    const projectFor = async (projectId: string): Promise<ProjectInfo> => {
      if (projectCache.has(projectId)) return projectCache.get(projectId)!;
      let data: Record<string, unknown> | null = null;
      const direct = await companyRef.collection("jobs").doc(projectId).get();
      if (direct.exists) data = direct.data() ?? null;
      else {
        const found = await companyRef.collection("jobs").where("id", "==", projectId).limit(1).get();
        data = found.empty ? null : found.docs[0].data();
      }
      const info: ProjectInfo = data
        ? {
            assigneeUid: PROJECT_ASSIGNEE_FIELDS.map((field) => str(data![field])).find(Boolean) ?? "",
            creatorUid: str(data.createdByUid ?? data.ownerUid),
            name: str(data.name),
            closed: data.isArchived === true || data.isDeleted === true,
          }
        : null;
      projectCache.set(projectId, info);
      return info;
    };

    for (const eventSnap of eventsSnap.docs) {
      const event = eventSnap.data() as Record<string, unknown>;
      const projectId = str(event.projectId);
      const startMs = Number(event.startMs);
      if (event.archived === true || !Number.isFinite(startMs)) continue;
      const allDay = event.allDay === true;
      // Once it's started, a timed event gets no more reminders — nor does an all-day one once its day is over.
      if (allDay ? now >= startMs + DAY_MS : startMs <= now) continue;
      // Linked to a project that's gone, archived or deleted: none.
      const project = projectId ? await projectFor(projectId) : null;
      if (projectId && (!project || project.closed)) continue;
      // Its staff — or, saved before events had staff, its project's assignee and creator.
      const staffUids = Array.from(
        new Set((Array.isArray(event.staffUids) ? event.staffUids.map(str) : [project?.assigneeUid ?? "", project?.creatorUid ?? ""]).filter(Boolean)),
      );
      if (!staffUids.length) continue;
      const categoryId = str(event.categoryId);
      const sentMap = (event.remindersSent as Record<string, unknown> | undefined) ?? {};
      let counted = false;
      for (const uid of staffUids) {
        const prefs = await prefsFor(uid);
        // Its category's times (or their usual ones) — none if they've switched that category off.
        const lead = calendarReminderLeadForCategory(prefs.categories, categoryId, prefs.usual);
        if (!lead) continue;
        // Each of their reminders for this event: its key, and when it's due — once an all-day event's day has begun,
        // only ones for that day itself.
        const { timeZone } = await loadCompanyInfo();
        const times = reminderTimes(uid, startMs, allDay, lead.reminders, timeZone).filter(
          (time) => !(allDay && now >= startMs && time.remindAt < startMs),
        );
        const due = times.filter((time) => now >= time.remindAt && sentMap[time.key] !== startMs);
        if (!due.length) continue;
        if (!counted) {
          counted = true;
          result.events += 1;
        }
        if (!(await isCompanyMemberUid(companyId, uid))) continue;
        // Not for a category they can't see.
        if (!(await canSeeCategory(uid, categoryId))) continue;
        const legacySent = sentMap[uid] === startMs;

        // Claim them first (so two runs at once can't both send), then send the nearest one.
        const claimed = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(eventSnap.ref);
          if (!fresh.exists) return false;
          const current = (fresh.data()?.remindersSent as Record<string, unknown> | undefined) ?? {};
          const stillDue = due.filter((time) => current[time.key] !== startMs);
          if (!stillDue.length) return false;
          const [first, ...rest] = stillDue;
          tx.update(
            eventSnap.ref,
            new FieldPath("remindersSent", first.key),
            startMs,
            ...rest.flatMap((time) => [new FieldPath("remindersSent", time.key), startMs]),
          );
          return true;
        });
        if (!claimed || legacySent) continue;

        const title = str(event.title) || "Event";
        const projectName = project ? project.name || str(event.projectName) || "your project" : "";
        const when = timeUntilPhrase(startMs - now, allDay);
        const nowIso = new Date().toISOString();
        const notificationRef = await db.collection("users").doc(uid).collection("notifications").add({
          title: `Upcoming: ${title}`,
          message: projectName ? `"${title}" for ${projectName} is ${when}.` : `"${title}" is ${when}.`,
          type: "calendar_reminder",
          ...(projectId ? { projectId } : {}),
          companyId,
          eventId: eventSnap.id,
          read: false,
          createdAt: new Date(nowIso),
          createdAtIso: nowIso,
        });
        await pushStoredNotification(uid, notificationRef.id, options.siteOrigin).catch(() => undefined);
        result.sent += 1;
      }
    }
  }
  return result;
}
