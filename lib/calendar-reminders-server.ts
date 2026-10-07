import { FieldPath } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { normalizeCalendarReminderLead } from "@/lib/push-notification-types";
import { isCompanyMemberUid, pushStoredNotification } from "@/lib/push-server";

// Calendar reminders: "<event> for <project> is in 2 days". An event linked to a project reminds the
// person that project is assigned to, as far ahead as they chose (User Settings > Phone & Desktop
// Notifications > Upcoming project events — users/{uid}.calendarReminderLead): timed events by minutes
// to months; all-day events by days to months, at 8am that day. Each reminder goes in their
// Notifications list and to their devices (if they want that kind). It runs from
// app/api/cron/calendar-reminders (a scheduled call every few minutes) and, as a fallback, whenever
// someone in the company has the app open (app/api/push/reminders-tick).
//
// Each of a person's reminder times is sent once per event time: the event remembers it
// (remindersSent.{uid}_m{minutes} / {uid}_d{days} = the startMs it was sent for), so moving the event
// to a new time sends fresh ones. If several fall due at once (an event made at short notice), only the
// nearest is sent — the rest are just marked done. (remindersSent.{uid} alone is from before there could
// be several: those count as already sent.)

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// The furthest ahead anyone can ask to be told (1 month), plus a day.
const LOOKAHEAD_MS = 31 * DAY_MS;
// All-day events are reminded at 8am (the event's own local midnight + 8 hours).
const ALL_DAY_REMINDER_HOUR = 8;

const PROJECT_ASSIGNEE_FIELDS = ["assignedToUid", "assignedUid", "projectAssignedUid"];

function str(value: unknown): string {
  return String(value ?? "").trim();
}

// "in 30 minutes", "in 2 hours", "tomorrow", "in 3 days", "in 2 weeks", "in 1 month".
export function timeUntilPhrase(msUntil: number, allDay: boolean): string {
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

type ProjectInfo = { assigneeUid: string; name: string; closed: boolean } | null;

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

  // Each person's reminder timing, read once per run.
  const leadByUid = new Map<string, ReturnType<typeof normalizeCalendarReminderLead>>();
  const leadFor = async (uid: string) => {
    if (!leadByUid.has(uid)) {
      const snap = await db.collection("users").doc(uid).get();
      leadByUid.set(uid, normalizeCalendarReminderLead(snap.data()?.calendarReminderLead));
    }
    return leadByUid.get(uid)!;
  };

  for (const companyId of companyIds) {
    result.companies += 1;
    const companyRef = db.collection("companies").doc(companyId);
    let eventsSnap;
    try {
      eventsSnap = await companyRef
        .collection("calendarEvents")
        .where("startMs", ">", now)
        .where("startMs", "<=", now + LOOKAHEAD_MS)
        .get();
    } catch {
      continue;
    }
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
      if (!projectId || event.archived === true || !Number.isFinite(startMs)) continue;
      const project = await projectFor(projectId);
      if (!project || project.closed || !project.assigneeUid) continue;
      const uid = project.assigneeUid;
      const allDay = event.allDay === true;
      const lead = await leadFor(uid);
      // Each of their reminder times for this event: its key, when it's due, and how far ahead it is.
      const times = allDay
        ? lead.allDayDays.map((days) => ({ key: `${uid}_d${days}`, remindAt: startMs - days * DAY_MS + ALL_DAY_REMINDER_HOUR * HOUR_MS, ahead: days * DAY_MS }))
        : lead.timedMinutes.map((minutes) => ({ key: `${uid}_m${minutes}`, remindAt: startMs - minutes * MINUTE_MS, ahead: minutes * MINUTE_MS }));
      const sentMap = (event.remindersSent as Record<string, unknown> | undefined) ?? {};
      const due = times.filter((time) => now >= time.remindAt && sentMap[time.key] !== startMs);
      if (!due.length) continue;
      result.events += 1;
      if (!(await isCompanyMemberUid(companyId, uid))) continue;
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
      const projectName = project.name || str(event.projectName) || "your project";
      const nowIso = new Date().toISOString();
      const notificationRef = await db.collection("users").doc(uid).collection("notifications").add({
        title: `Upcoming: ${title}`,
        message: `"${title}" for ${projectName} is ${timeUntilPhrase(startMs - now, allDay)}.`,
        type: "calendar_reminder",
        projectId,
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
  return result;
}
