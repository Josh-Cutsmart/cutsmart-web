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
const SAMPLE_TEXT: Record<string, [string, string]> = {
  project_access: ["Added to a project", `${TEAMMATE} added you to "${PROJECT}" as an editor.`],
  project_assigned: ["Assigned to a project", `You were assigned to "${PROJECT}".`],
  project_unassigned: ["Removed from a project", `You were removed from "${PROJECT}".`],
  production_unlock_request: ["Production unlock request", `${TEAMMATE} asked to unlock production on "${PROJECT}".`],
  production_unlock_response: [
    "Production unlocked",
    `${TEAMMATE} approved your request — you can edit production on "${PROJECT}" for ${DEV_TEST_UNLOCK_HOURS} hours.`,
  ],
  lead_new: ["New Lead", `From Form: ${CLIENT}`],
  lead_access: ["Added to a lead", `${TEAMMATE} added you to the lead "${CLIENT}".`],
  quote_accepted: [`Quote accepted for ${PROJECT}`, `${CLIENT} accepted your quote for $18,450.00`],
  quote_declined: ["Quote declined", `${CLIENT} declined quote for ${PROJECT}: "We've decided to go with a different layout."`],
  specs_submitted: [`Specifications Submitted for ${PROJECT}`, `${CLIENT} submitted the specifications (12/15) accepted`],
  quote_sent: ["Quote sent to client", `${TEAMMATE} sent a Quote for "${PROJECT}" to the client.`],
  specs_sent: ["Specifications sent to client", `${TEAMMATE} sent Specifications for "${PROJECT}" to the client.`],
  quote_pending: ["Quote not accepted yet", `${CLIENT} hasn't accepted the quote for ${PROJECT} yet — sent 2 days ago.`],
  specs_pending: ["Specifications not submitted yet", `${CLIENT} hasn't submitted the specifications for ${PROJECT} yet — sent 2 days ago.`],
  // An event's own name, as a real one shows it (not just "Install", which reads like its category).
  calendar_reminder: ["Upcoming: Benchtop install", `"Benchtop install" for ${PROJECT} is in 1 hour.`],
  role_change: ["Role updated", `Your role in Taylor Joinery changed from "Staff" to "Manager".`],
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
    const title = `New version ${appVersion || "v1.0.0"}`;
    return { title, body: pushNotificationBody({ type }), url: pushNotificationUrl({ type, title }) };
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
