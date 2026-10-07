import { WHATS_NEW_URL_PARAM } from "@/lib/update-notes-utils";

// The kinds of notification CutSmart puts in the bell's Notifications list — each one can also go to
// the user's phone/desktop (web push: lib/push-client.ts, lib/push-server.ts), and each user picks which
// kinds they want there (User Settings > Phone & Desktop Notifications), grouped into the categories
// below. Shared by the app and the server.

export type PushNotificationTypeOption = { type: string; label: string; description: string };
export type PushNotificationCategory = { id: string; label: string; types: readonly PushNotificationTypeOption[] };

// Any kind not listed here (a new one added later) falls under "other".
export const OTHER_PUSH_NOTIFICATION_TYPE = "other";

export const PUSH_NOTIFICATION_CATEGORIES: readonly PushNotificationCategory[] = [
  {
    id: "projects",
    label: "Projects",
    types: [
      { type: "project_access", label: "Added to a project", description: "You're given editor or viewer access to a project." },
      { type: "project_assigned", label: "Assigned to a project", description: "A project is assigned to you." },
      { type: "project_unassigned", label: "Removed from a project", description: "A project you were assigned to goes to someone else." },
      {
        type: "production_unlock_request",
        label: "Production unlock requests",
        description: "Someone asks to unlock a project's production — on Android and computers you can approve or deny it right from the notification.",
      },
      { type: "production_unlock_response", label: "Unlock request answered", description: "Your request to unlock a project's production is approved or denied." },
    ],
  },
  {
    id: "leads",
    label: "Leads",
    types: [
      { type: "lead_new", label: "New leads", description: "A new lead comes in (only leads you can see)." },
      { type: "lead_access", label: "Added to a lead", description: "A lead is assigned to you." },
    ],
  },
  {
    id: "client_portal",
    label: "Client Portal",
    types: [
      { type: "quote_accepted", label: "Quote accepted", description: "A client accepts a quote." },
      { type: "quote_declined", label: "Quote declined", description: "A client declines a quote." },
      { type: "specs_submitted", label: "Specifications submitted", description: "A client submits their specifications answers." },
      { type: "quote_sent", label: "Quote sent to a client", description: "A teammate sends a quote for a project you follow." },
      { type: "specs_sent", label: "Specifications sent to a client", description: "A teammate sends specifications for a project you follow." },
      {
        type: "quote_pending",
        label: "Quote not accepted yet",
        description: "A quote sent to a client still hasn't been accepted — choose after how long below.",
      },
      {
        type: "specs_pending",
        label: "Specifications not submitted yet",
        description: "Specifications sent to a client still haven't been submitted — choose after how long below.",
      },
    ],
  },
  {
    id: "calendar",
    label: "Calendar",
    types: [
      { type: "calendar_reminder", label: "Upcoming project events", description: "An event for a project assigned to you is coming up — choose how far ahead below (add as many as you like)." },
    ],
  },
  {
    id: "cutsmart",
    label: "CutSmart",
    types: [
      { type: "app_version", label: "New versions", description: "CutSmart has been updated." },
      { type: "role_change", label: "Role changes", description: "Your role in the company changes." },
      { type: OTHER_PUSH_NOTIFICATION_TYPE, label: "Everything else", description: "Any other notification." },
    ],
  },
];

export const PUSH_NOTIFICATION_TYPES: readonly PushNotificationTypeOption[] = PUSH_NOTIFICATION_CATEGORIES.flatMap((category) => category.types);

const KNOWN_TYPES = new Set(PUSH_NOTIFICATION_TYPES.map((option) => option.type));

// Which of the list above a notification counts as.
export function pushNotificationTypeKey(type: unknown): string {
  const key = String(type ?? "").trim();
  return KNOWN_TYPES.has(key) ? key : OTHER_PUSH_NOTIFICATION_TYPE;
}

// A user's choices are stored as { [type]: false } for the kinds they've turned off — every kind is on
// until they turn it off.
export function isPushNotificationTypeEnabled(choices: unknown, type: unknown): boolean {
  if (!choices || typeof choices !== "object") return true;
  return (choices as Record<string, unknown>)[pushNotificationTypeKey(type)] !== false;
}

// Which category a kind of notification is in.
export function pushNotificationCategoryOf(type: unknown): string {
  const key = pushNotificationTypeKey(type);
  return PUSH_NOTIFICATION_CATEGORIES.find((category) => category.types.some((option) => option.type === key))?.id ?? "";
}

// A whole category can be turned off too (users/{uid}.pushNotificationCategories = { [id]: false }) —
// without changing the kinds' own switches, so turning it back on puts them back as they were.
export function isPushNotificationCategoryEnabled(categoryChoices: unknown, categoryId: string): boolean {
  if (!categoryChoices || typeof categoryChoices !== "object") return true;
  return (categoryChoices as Record<string, unknown>)[categoryId] !== false;
}

// Whether a kind of notification goes to someone's devices: its category and its own switch both on.
export function isPushNotificationWanted(userData: Record<string, unknown> | undefined, type: unknown): boolean {
  return (
    isPushNotificationCategoryEnabled(userData?.pushNotificationCategories, pushNotificationCategoryOf(type)) &&
    isPushNotificationTypeEnabled(userData?.pushNotificationTypes, type)
  );
}

// Where tapping the notification takes them: the event for a calendar reminder, the project it's about,
// Leads for a lead, the What's New page for a new version, or the Dashboard.
export function pushNotificationUrl(input: { type?: unknown; projectId?: unknown; leadId?: unknown; eventId?: unknown; title?: unknown }): string {
  const eventId = String(input.eventId ?? "").trim();
  if (String(input.type ?? "") === "calendar_reminder" && eventId) return `/calendar?event=${encodeURIComponent(eventId)}`;
  const projectId = String(input.projectId ?? "").trim();
  if (projectId) return `/projects/${encodeURIComponent(projectId)}`;
  if (String(input.leadId ?? "").trim() || String(input.type ?? "").startsWith("lead_")) return "/leads";
  if (String(input.type ?? "") === "app_version") {
    const version = String(input.title ?? "").replace(/^New version\s*/i, "").trim();
    return `/dashboard?${WHATS_NEW_URL_PARAM}=${encodeURIComponent(version)}`;
  }
  return "/dashboard";
}

// The notification's text as it shows on a phone: no HTML (a new version's message is the whole
// changelog — that one just says to have a look), one line, not too long.
export function pushNotificationBody(input: { type?: unknown; message?: unknown }): string {
  if (String(input.type ?? "") === "app_version") return "See what's new in CutSmart.";
  const text = String(input.message ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
}

// ---- Calendar reminders: how far ahead each user wants to hear about events for their projects — as
// many times as they like, for timed events and for all-day events (which only go by days, weeks or
// months). Stored on their profile as users/{uid}.calendarReminderLead = { timedMinutes: [...],
// allDayDays: [...] } (a single number each, from before there could be several, still reads).

export type ReminderLeadOption = { value: number; label: string };

export const TIMED_EVENT_REMINDER_OPTIONS: readonly ReminderLeadOption[] = [
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 240, label: "4 hours before" },
  { value: 24 * 60, label: "1 day before" },
  { value: 2 * 24 * 60, label: "2 days before" },
  { value: 7 * 24 * 60, label: "1 week before" },
  { value: 14 * 24 * 60, label: "2 weeks before" },
  { value: 30 * 24 * 60, label: "1 month before" },
];

export const ALL_DAY_EVENT_REMINDER_OPTIONS: readonly ReminderLeadOption[] = [
  { value: 1, label: "1 day before" },
  { value: 2, label: "2 days before" },
  { value: 3, label: "3 days before" },
  { value: 7, label: "1 week before" },
  { value: 14, label: "2 weeks before" },
  { value: 30, label: "1 month before" },
];

export const DEFAULT_TIMED_REMINDER_MINUTES = 60;
export const DEFAULT_ALL_DAY_REMINDER_DAYS = 1;
// The most reminder times one list can have.
export const MAX_REMINDER_ROWS = 6;

// A saved list of choices (or an older single number): only real options, no repeats, in order.
function normalizeChoiceList(raw: unknown, options: readonly ReminderLeadOption[], fallback: number): number[] {
  const values = (Array.isArray(raw) ? raw : [raw]).map(Number).filter((value) => options.some((option) => option.value === value));
  const unique = Array.from(new Set(values)).slice(0, MAX_REMINDER_ROWS);
  return unique.length ? unique : [fallback];
}

export type CalendarReminderLead = { timedMinutes: number[]; allDayDays: number[] };

export function normalizeCalendarReminderLead(raw: unknown): CalendarReminderLead {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    timedMinutes: normalizeChoiceList(row.timedMinutes, TIMED_EVENT_REMINDER_OPTIONS, DEFAULT_TIMED_REMINDER_MINUTES),
    allDayDays: normalizeChoiceList(row.allDayDays, ALL_DAY_EVENT_REMINDER_OPTIONS, DEFAULT_ALL_DAY_REMINDER_DAYS),
  };
}

// ---- A quote / specifications sent to a client and still not accepted / submitted: after how many
// days each user wants to hear about it — as many as they like (e.g. 2 days and 5 days). Stored on
// their profile as users/{uid}.clientPortalReminderDays = { quote: [...], specs: [...] }; 2 days each
// until they change it.

export const CLIENT_PORTAL_PENDING_OPTIONS: readonly ReminderLeadOption[] = [1, 2, 3, 4, 5, 6, 7].map((days) => ({
  value: days,
  label: `After ${days} day${days === 1 ? "" : "s"}`,
}));

export const DEFAULT_CLIENT_PORTAL_PENDING_DAYS = 2;

export type ClientPortalReminderDays = { quote: number[]; specs: number[] };

export function normalizeClientPortalReminderDays(raw: unknown): ClientPortalReminderDays {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    quote: normalizeChoiceList(row.quote, CLIENT_PORTAL_PENDING_OPTIONS, DEFAULT_CLIENT_PORTAL_PENDING_DAYS),
    specs: normalizeChoiceList(row.specs, CLIENT_PORTAL_PENDING_OPTIONS, DEFAULT_CLIENT_PORTAL_PENDING_DAYS),
  };
}

// "in 1 hour", "in 2 days", "in 1 week", "tomorrow" — how far off an event is, in the reminder's words.
export function reminderLeadPhrase(minutes: number): string {
  const units: Array<[number, string]> = [
    [30 * 24 * 60, "month"],
    [7 * 24 * 60, "week"],
    [24 * 60, "day"],
    [60, "hour"],
    [1, "minute"],
  ];
  if (minutes === 24 * 60) return "tomorrow";
  for (const [size, name] of units) {
    if (minutes >= size && minutes % size === 0) {
      const count = minutes / size;
      return `in ${count} ${name}${count === 1 ? "" : "s"}`;
    }
  }
  return `in ${minutes} minutes`;
}

// ---- Time between notifications (users/{uid}.pushQuietMinutes): after one reaches their devices, any
// more within this many minutes are held, then sent together as one ("10 new leads") when it's up. The
// bell's Notifications list still gets every one. 0 = off (each is sent straight away).

export const PUSH_QUIET_INTERVAL_OPTIONS: readonly ReminderLeadOption[] = [
  { value: 0, label: "Off — send each one" },
  { value: 1, label: "1 minute" },
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
];

export function normalizePushQuietMinutes(raw: unknown): number {
  const minutes = Number(raw);
  return PUSH_QUIET_INTERVAL_OPTIONS.some((option) => option.value === minutes) ? minutes : 0;
}

// How a batch of one kind reads in a grouped notification: "10 new leads", "1 quote accepted".
const PUSH_GROUP_PHRASES: Record<string, [string, string]> = {
  project_access: ["project shared with you", "projects shared with you"],
  project_assigned: ["project assigned to you", "projects assigned to you"],
  project_unassigned: ["project reassigned", "projects reassigned"],
  production_unlock_request: ["unlock request", "unlock requests"],
  production_unlock_response: ["unlock request answered", "unlock requests answered"],
  lead_new: ["new lead", "new leads"],
  lead_access: ["lead assigned to you", "leads assigned to you"],
  quote_accepted: ["quote accepted", "quotes accepted"],
  quote_declined: ["quote declined", "quotes declined"],
  specs_submitted: ["specification submitted", "specifications submitted"],
  quote_sent: ["quote sent", "quotes sent"],
  specs_sent: ["specification sent", "specifications sent"],
  calendar_reminder: ["upcoming event", "upcoming events"],
  quote_pending: ["quote waiting on a client", "quotes waiting on clients"],
  specs_pending: ["specification waiting on a client", "specifications waiting on clients"],
  app_version: ["new version", "new versions"],
  role_change: ["role change", "role changes"],
};

export function pushGroupPhrase(type: unknown, count: number): string {
  const [singular, plural] = PUSH_GROUP_PHRASES[pushNotificationTypeKey(type)] ?? ["notification", "notifications"];
  return `${count} ${count === 1 ? singular : plural}`;
}
