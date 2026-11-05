import { FieldPath, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import {
  columnAutomationColumnLabel,
  columnAutomationDurationLabel,
  COLUMN_AUTOMATION_MAX_EMAILS,
  defaultAutomationEmail,
  fillAutomationEmail,
  isAutomationEmail,
  type BoardSpot,
  type ColumnAutomation,
} from "@/lib/column-automations";
import { formatDate, normalizeDateFormat } from "@/lib/date-format";
import { recordColumnAutomationRun } from "@/lib/column-automation-runs-server";
import { sendAutomationEmails } from "@/lib/email";

// An email automation's email (lib/column-automations.ts): to the staff and addresses saved on it, its own subject and body
// — only ever what's saved, never anything from a request — the placeholders in them filled in from the project as it is
// now. Its staff by their email as it is now, if they're still in the company.
// Each addressee gets their own copy, so they don't see each other. From the app's move (app/api/automations/email) and the
// server's own (lib/column-automations-server.ts).

const str = (value: unknown) => String(value ?? "").trim();
// One automation emails about one project at most this often: a project dragged back and forth, or a request sent over and
// over, can't flood anyone (or use up the company's sending allowance).
const AT_MOST_EVERY_MS = 60 * 1000;
const SENT_FIELD = "columnAutomationEmailsSent";

async function staffEmails(db: Firestore, companyId: string, uids: string[]): Promise<string[]> {
  const company = db.collection("companies").doc(companyId);
  const emails = await Promise.all(
    uids.map(async (uid) => {
      const [membership, user] = await Promise.all([company.collection("memberships").doc(uid).get(), db.collection("users").doc(uid).get()]);
      if (!membership.exists) return "";
      return (str(membership.data()?.email) || str(user.data()?.email)).toLowerCase();
    }),
  ).catch(() => [] as string[]);
  return emails.filter(isAutomationEmail);
}

// Today, in the company's own time zone and date format.
function todayFor(companyData: Record<string, unknown>): string {
  const format = normalizeDateFormat(companyData.dateFormat);
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: str(companyData.timeZone) || "Pacific/Auckland", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date());
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
    return formatDate(new Date(part("year"), part("month") - 1, part("day")), format);
  } catch {
    return formatDate(new Date(), format);
  }
}

// What its placeholders are filled in with.
function placeholderValues(input: {
  data: Record<string, unknown>;
  companyData: Record<string, unknown>;
  automation: ColumnAutomation;
  projectId: string;
  projectName: string;
  siteOrigin: string;
  movedTo?: BoardSpot | null;
}): Record<string, string> {
  const { data, companyData, automation } = input;
  const customer = str(data.customer) === "Unknown Customer" ? "" : str(data.customer);
  const here: BoardSpot = input.movedTo ?? { status: str(data.status), subStage: str(data.dashboardSubStageId) };
  return {
    project: input.projectName,
    client: customer || str(data.clientName) || str(data.client),
    client_phone: str(data.clientPhone) || str(data.clientNumber),
    client_email: str(data.clientEmail),
    address: str(data.clientAddress),
    column: columnAutomationColumnLabel(automation),
    status: columnAutomationColumnLabel(here),
    time_in_column: columnAutomationDurationLabel(automation),
    assigned_to: str(data.assignedToName) || str(data.assignedTo),
    created_by: str(data.createdByName),
    tags: Array.isArray(data.tags) ? data.tags.map(str).filter(Boolean).join(", ") : "",
    company: str(companyData.companyName) || str(companyData.name),
    date: todayFor(companyData),
    link: input.siteOrigin ? `${input.siteOrigin.replace(/\/+$/, "")}/projects/${input.projectId}` : "",
  };
}

export async function sendColumnAutomationEmail(input: {
  db: Firestore;
  companyId: string;
  companyData: Record<string, unknown>;
  automation: ColumnAutomation;
  projectRef: DocumentReference;
  projectName: string;
  siteOrigin: string;
  // A move out: where it is now.
  movedTo?: BoardSpot | null;
}): Promise<boolean> {
  const { db, automation, projectRef } = input;
  if (automation.action !== "email") return false;
  // (Who it's assigned to, and who created it, as the project has them now.)
  const current = ((await projectRef.get().catch(() => null))?.data() ?? {}) as Record<string, unknown>;
  const uids = [...automation.notifyUids, ...(automation.notifyAssignee ? [str(current.assignedToUid)] : []), ...(automation.notifyCreator ? [str(current.createdByUid)] : [])].filter(Boolean);
  const recipients = Array.from(new Set([...(await staffEmails(db, input.companyId, Array.from(new Set(uids)))), ...automation.notifyEmails])).slice(0, COLUMN_AUTOMATION_MAX_EMAILS);
  const item = { id: projectRef.id, name: input.projectName };
  const note = (fields: Parameters<typeof recordColumnAutomationRun>[5]) =>
    recordColumnAutomationRun(db, input.companyId, automation, item, automation.trigger, { toEmails: recipients, ...fields });
  if (!recipients.length) {
    await note({ outcome: "failed", note: "No one to send it to: no one's assigned, or they have no email address, or have left." });
    return false;
  }
  const now = Date.now();
  const claimed = await db
    .runTransaction(async (tx) => {
      const snap = await tx.get(projectRef);
      if (!snap.exists) return null;
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      const sent = (data[SENT_FIELD] ?? {}) as Record<string, unknown>;
      const last = Date.parse(str(sent[automation.id]));
      if (Number.isFinite(last) && now - last < AT_MOST_EVERY_MS) return "held back" as const;
      tx.update(projectRef, new FieldPath(SENT_FIELD, automation.id), new Date(now).toISOString());
      return data;
    })
    .catch(() => null);
  if (claimed === "held back") {
    await note({ outcome: "skipped", note: "One went out for this project less than a minute ago." });
    return false;
  }
  if (!claimed) {
    await note({ outcome: "failed", note: "Couldn't read the project." });
    return false;
  }

  const values = placeholderValues({
    data: claimed,
    companyData: input.companyData,
    automation,
    projectId: str(claimed.id) || projectRef.id,
    projectName: input.projectName,
    siteOrigin: input.siteOrigin,
    movedTo: input.movedTo,
  });
  const usual = defaultAutomationEmail(automation.trigger);
  const result = await sendAutomationEmails({
    to: recipients,
    companyName: values.company,
    subject: fillAutomationEmail(automation.emailSubject || usual.subject, values),
    body: fillAutomationEmail(automation.emailBody || usual.body, values),
  });
  if (!result.ok) console.error("[column-automations] email failed:", result.error);
  await note(result.ok ? {} : { outcome: "failed", note: result.error });
  return result.ok;
}
