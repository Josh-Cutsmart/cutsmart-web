import { notificationText, notificationWords } from "@/lib/notification-messages";
import { pushNotificationBody, pushNotificationUrl } from "@/lib/push-notification-types";

// Dev mode's test notifications (the "test" buttons in User Settings → app/api/push/dev-test): one of every kind,
// worded exactly like the real ones but about a made-up client and project, so a Dev user can see how
// each looks on their own phone or computer. Nothing is stored — they never reach the Notifications list.
// Shared by the app and the server.

const CLIENT = "Jane Smith";
const PROJECT = "Smith Kitchen";
const TEAMMATE = "Sam Taylor";

// When to send a test — later gives time to lock the phone or switch away and see it arrive.
export const DEV_TEST_DELAYS: readonly { seconds: number; label: string }[] = [
  { seconds: 0, label: "Now" },
  { seconds: 5, label: "In 5 seconds" },
  { seconds: 10, label: "In 10 seconds" },
  { seconds: 30, label: "In 30 seconds" },
  { seconds: 60, label: "In 1 minute" },
];

// The test unlock request's Approve / Deny buttons send this instead of a real request's signed token.
export const DEV_TEST_ACTION_TOKEN = "dev-test";
export const DEV_TEST_REQUESTER = TEAMMATE;
export const DEV_TEST_UNLOCK_HOURS = 2;

// [title, message] of each kind's test, as the real one words it.
const asSample = ({ title, message }: { title: string; message: string }): [string, string] => [title, message];
const SAMPLE_TEXT: Record<string, [string, string]> = {
  project_access: asSample(notificationText("project_access.added", { person: TEAMMATE, project: PROJECT, role: "an editor" })),
  project_assigned: asSample(notificationText("project_assigned", { project: PROJECT })),
  project_unassigned: asSample(notificationText("project_unassigned", { project: PROJECT })),
  production_unlock_request: asSample(notificationText("production_unlock_request", { person: TEAMMATE, project: PROJECT })),
  column_automation: asSample(notificationText("column_automation.enters", { thing: `"${PROJECT}"`, column: "Production" })),
  production_unlock_response: asSample(
    notificationText("production_unlock_response.accepted", { person: TEAMMATE, project: PROJECT, hours: `${DEV_TEST_UNLOCK_HOURS} hours` }),
  ),
  lead_new: asSample(notificationText("lead_new.form", { name: CLIENT })),
  lead_access: asSample(notificationText("lead_access", { person: TEAMMATE, lead: CLIENT })),
  quote_accepted: asSample(notificationText("quote_accepted", { client: CLIENT, project: PROJECT, price: "$18,450.00" })),
  quote_declined: asSample(notificationText("quote_declined", { client: CLIENT, project: PROJECT, reason: "We've decided to go with a different layout." })),
  specs_submitted: asSample(notificationText("specs_submitted", { client: CLIENT, project: PROJECT, accepted: 12, total: 15 })),
  quote_sent: asSample(notificationText("quote_sent", { person: TEAMMATE, project: PROJECT })),
  specs_sent: asSample(notificationText("specs_sent", { person: TEAMMATE, project: PROJECT })),
  quote_pending: asSample(notificationText("quote_pending", { client: CLIENT, project: PROJECT, ago: "2 days ago" })),
  specs_pending: asSample(notificationText("specs_pending", { client: CLIENT, project: PROJECT, ago: "2 days ago" })),
  // An event's own name, as a real one shows it (not just "Install", which reads like its category).
  calendar_reminder: asSample(notificationText("calendar_reminder", { event: "Benchtop install", project: PROJECT, when: "in 1 hour" })),
  role_change: asSample(notificationText("role_change", { company: "Taylor Joinery", old_role: "Staff", new_role: "Manager" })),
  other: ["Test notification", "This is how a CutSmart notification looks on this device."],
};

// Dev mode's "test in … s" at the top of Notifications (components/global-app-tabs-bar.tsx): a real notification
// added to the user's own list — one of these kinds, at random, with its made-up title and message.
export const DEV_TEST_LIST_KINDS: readonly string[] = Object.keys(SAMPLE_TEXT);
export function devTestListSample(kind: string): { title: string; message: string } | null {
  const text = SAMPLE_TEXT[kind];
  return text ? { title: text[0], message: text[1] } : null;
}

// Whether a notification is one of those tests by its words alone — for ones added before tests were marked
// (UserNotificationRow.devTest), which are cleared away once seen just the same. Matches only a test's exact title
// and message (today's, or the earlier wording of the quote / specs / calendar ones), with its made-up client and project.
const EARLIER_SAMPLE_TEXT: ReadonlyArray<readonly [string, string]> = [
  ["Upcoming: Install", `"Install" for ${PROJECT} is in 1 hour.`],
  ["Quote accepted", `${CLIENT} accepted quote for ${PROJECT}`],
  ["Specifications submitted", `${CLIENT} submitted specs for ${PROJECT} with 12/15 accepted`],
];
export function isDevTestNotificationText(title: string, message: string): boolean {
  return [...Object.values(SAMPLE_TEXT), ...EARLIER_SAMPLE_TEXT].some(([sampleTitle, sampleMessage]) => sampleTitle === title && sampleMessage === message);
}

// A kind's test: its title, its text as a phone shows it, and where tapping it goes (pages that exist —
// the made-up project doesn't). `appVersion` is the current version, for the New version one.
export function devTestSample(type: string, appVersion: string): { title: string; body: string; url: string } | null {
  if (type === "app_version") {
    const title = notificationWords("app_version", "title", { version: appVersion || "v1.0.0" });
    return { title, body: pushNotificationBody({ type }), url: pushNotificationUrl({ type, title, appVersion: appVersion || "v1.0.0" }) };
  }
  const text = SAMPLE_TEXT[type];
  if (!text) return null;
  const [title, message] = text;
  return {
    title,
    body: pushNotificationBody({ type, message }),
    url: type === "calendar_reminder" ? "/calendar" : pushNotificationUrl({ type }),
  };
}

// Grouped tests — what "Time between notifications" sends when several come in together.
export type DevTestGroup = { id: string; total: number; held: Array<{ type: string; title: string; message: string }> };

export const DEV_TEST_GROUPS: readonly DevTestGroup[] = [
  {
    // "10 new leads"
    id: "group_same",
    total: 10,
    held: [
      { type: "lead_new", title: "New Lead", message: "From Form: Liam Brown" },
      { type: "lead_new", title: "New Lead", message: "From Email: olivia.wilson@example.com" },
      { type: "lead_new", title: "New Lead", message: `From Zapier: ${CLIENT}` },
    ],
  },
  {
    // "5 new notifications" — 3 new leads · 1 quote accepted · 1 specification submitted
    id: "group_mixed",
    total: 5,
    held: [
      { type: "lead_new", title: "New Lead", message: "From Form: Liam Brown" },
      { type: "lead_new", title: "New Lead", message: "From Email: olivia.wilson@example.com" },
      { type: "quote_accepted", title: `Quote accepted for ${PROJECT}`, message: `${CLIENT} accepted your quote for $18,450.00` },
      { type: "lead_new", title: "New Lead", message: "From Form: Noah Clarke" },
      { type: "specs_submitted", title: `Specifications Submitted for ${PROJECT}`, message: `${CLIENT} submitted the specifications (12/15) accepted` },
    ],
  },
];
