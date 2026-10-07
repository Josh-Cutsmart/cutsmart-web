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
  lead_new: ["New lead", `${CLIENT} came in from Website Contact Form.`],
  lead_access: ["Added to a lead", `${TEAMMATE} added you to the lead "${CLIENT}".`],
  quote_accepted: ["Quote accepted", `${CLIENT} accepted quote for ${PROJECT}`],
  quote_declined: ["Quote declined", `${CLIENT} declined quote for ${PROJECT}: "We've decided to go with a different layout."`],
  specs_submitted: ["Specifications submitted", `${CLIENT} submitted specs for ${PROJECT} with 12/15 accepted`],
  quote_sent: ["Quote sent to client", `${TEAMMATE} sent a Quote for "${PROJECT}" to the client.`],
  specs_sent: ["Specifications sent to client", `${TEAMMATE} sent Specifications for "${PROJECT}" to the client.`],
  quote_pending: ["Quote not accepted yet", `${CLIENT} hasn't accepted the quote for ${PROJECT} yet — sent 2 days ago.`],
  specs_pending: ["Specifications not submitted yet", `${CLIENT} hasn't submitted the specifications for ${PROJECT} yet — sent 2 days ago.`],
  calendar_reminder: ["Upcoming: Install", `"Install" for ${PROJECT} is in 1 hour.`],
  role_change: ["Role updated", `Your role in Taylor Joinery changed from "Staff" to "Manager".`],
  other: ["Test notification", "This is how a CutSmart notification looks on this device."],
};

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
      { type: "lead_new", title: "New lead", message: "Liam Brown came in from Website Contact Form." },
      { type: "lead_new", title: "New lead", message: "Olivia Wilson just came in." },
      { type: "lead_new", title: "New lead", message: `${CLIENT} came in from Facebook.` },
    ],
  },
  {
    // "5 new notifications" — 3 new leads · 1 quote accepted · 1 specification submitted
    id: "group_mixed",
    total: 5,
    held: [
      { type: "lead_new", title: "New lead", message: "Liam Brown came in from Website Contact Form." },
      { type: "lead_new", title: "New lead", message: "Olivia Wilson just came in." },
      { type: "quote_accepted", title: "Quote accepted", message: `${CLIENT} accepted quote for ${PROJECT}` },
      { type: "lead_new", title: "New lead", message: "Noah Clarke came in from Facebook." },
      { type: "specs_submitted", title: "Specifications submitted", message: `${CLIENT} submitted specs for ${PROJECT} with 12/15 accepted` },
    ],
  },
];
