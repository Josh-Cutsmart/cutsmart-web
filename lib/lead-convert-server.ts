import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { saveClientForProject } from "@/lib/clients-server";
import { SCHEDULED_COLUMN_MOVE_DUE_FIELD, SCHEDULED_COLUMN_MOVE_FIELD, type BoardSpot } from "@/lib/column-automations";
import type { CompanyLeadRow } from "@/lib/firestore-data";
import { normalizeLeadForms } from "@/lib/lead-forms";
import { normalizeLeadNotes } from "@/lib/lead-row";
import {
  buildLeadProjectPrefill,
  getLeadDynamicFields,
  leadFieldLayoutFor,
  mergeLeadFieldLayout,
  normalizeLeadFieldLayout,
} from "@/lib/lead-project-prefill";

// A lead made into a project by a column automation (a Leads column moving what enters it on to one of the
// Dashboard's — lib/column-automations-server.ts): the project Leads › Create Project would make from it (the New
// Project pop-up, filled in from the lead — lib/lead-project-prefill.ts): its name and client, phone, email and address,
// notes, photos, who it's assigned to and the lead's other answers — straight into that Dashboard column, its client
// saved to a contact card, and the lead archived as converted (Reports' conversions), as Create Project leaves it. The
// lead's own notes (its pop-up's Notes) go into the project's notes too, a bullet each — as the New Project pop-up's
// "Import from Notes" puts them.

const str = (value: unknown) => String(value ?? "").trim();

function splitName(fullName: string) {
  const parts = fullName.split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

// The company's default spacing for a new project's cabinets (Company Settings), as the New Project pop-up copies it.
function gapAllowances(raw: unknown) {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const keys = [
    "baseBelowBenchToTopOfDoorDrawer",
    "baseHorizontalGapNormalHandles",
    "baseHorizontalGapWrapOverHandles",
    "baseVerticalGapDoorsPanels",
    "tallTopOfDoorToTopWithScribers",
    "tallTopOfDoorToTopNoScribers",
    "tallVerticalGapDoorsPanels",
  ];
  return Object.fromEntries(keys.map((key) => [key, str(row[key])]));
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// The project's notes (as the notes editor keeps them, HTML): the lead's notes field, then its notes, a bullet each.
function projectNotesHtml(fieldNotes: string, leadNotes: string[]): string {
  const field = fieldNotes ? `<p>${escapeHtml(fieldNotes).replace(/\n/g, "<br />")}</p>` : "";
  const list = leadNotes.length ? `<ul>${leadNotes.map((text) => `<li>${escapeHtml(text).replace(/\n/g, "<br />")}</li>`).join("")}</ul>` : "";
  return field + list;
}

function createProjectId() {
  return `prj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// The project made (its id, name, and stored fields), or null — the lead gone, archived, no longer where it was
// (`isStillThere`), or a timed move no longer this one (`scheduledDueAtIso`); its timer's cleared then.
export async function convertLeadToProject(input: {
  companyId: string;
  leadRef: DocumentReference;
  to: BoardSpot;
  isStillThere: (leadStatus: string) => boolean;
  scheduledDueAtIso?: string;
  actorUid?: string;
}): Promise<{ projectId: string; name: string; data: Record<string, unknown> } | null> {
  if (!adminDb) return null;
  const db = adminDb;
  const { companyId, leadRef, to } = input;
  const leadSnap = await leadRef.get();
  if (!leadSnap.exists) return null;
  const leadData = (leadSnap.data() ?? {}) as Record<string, unknown>;
  const companyData = ((await db.collection("companies").doc(companyId).get()).data() ?? {}) as Record<string, unknown>;

  // What it fills in — as the Leads page lays this lead out (its form's questions, the email inbox's, else the
  // company's Zapier lead fields).
  const lead = { ...leadData, id: leadRef.id, companyId } as unknown as CompanyLeadRow;
  const formsById = new Map(normalizeLeadForms(companyData.leadForms).map((form) => [form.id, form] as const));
  const zapierLayout = normalizeLeadFieldLayout(
    ((companyData.integrations as Record<string, unknown> | undefined)?.zapierLeads as Record<string, unknown> | undefined)?.fieldLayout,
  );
  const defaultLayout = mergeLeadFieldLayout(
    getLeadDynamicFields(lead).map((field) => ({ key: field.key, label: field.label })),
    zapierLayout,
  );
  const prefill = buildLeadProjectPrefill(lead, leadFieldLayoutFor(lead, formsById, defaultLayout));
  const fallbackName = splitName(str(prefill.clientName));
  const firstName = str(prefill.clientFirstName) || fallbackName.firstName;
  const lastName = str(prefill.clientLastName) || fallbackName.lastName;
  const customer = [firstName, lastName].filter(Boolean).join(" ") || str(leadData.name) || str(leadData.email) || str(leadData.phone);
  const name = str(prefill.projectName) || customer || "New project";

  // Who set it off makes it (as if they'd pressed Create Project) — none: the scheduled job did ("Automation").
  const actorUid = str(input.actorUid);
  const [actorMembership, actorUser] = actorUid
    ? await Promise.all([
        db.collection("companies").doc(companyId).collection("memberships").doc(actorUid).get().catch(() => null),
        db.collection("users").doc(actorUid).get().catch(() => null),
      ])
    : [null, null];
  const actorName = str(actorMembership?.data()?.displayName ?? actorMembership?.data()?.name ?? actorUser?.data()?.displayName) || "Automation";
  const notifyAsCreator = actorUid && actorUser?.data()?.notifyAsCreator !== false;

  const quoteExtras = Array.isArray(companyData.quoteExtras) ? (companyData.quoteExtras as unknown[]) : [];
  const defaultExtras = Array.from(
    new Set(
      quoteExtras
        .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : null))
        .filter((item): item is Record<string, unknown> => Boolean(item) && Boolean(item?.defaultIncluded ?? item?.default))
        .map((item) => str(item.id ?? item.name))
        .filter(Boolean),
    ),
  );
  const imageItems = (prefill.projectImageItems ?? []).filter((item) => str(item.url)).slice(0, 10);
  const projectId = createProjectId();
  const nowIso = new Date().toISOString();
  const projectSettings = { boardTypes: [], projectPermissions: {}, gapAllowancesSettings: gapAllowances(companyData.gapAllowancesSettings) };
  const project: Record<string, unknown> = {
    id: projectId,
    companyId,
    name,
    customer,
    clientFirstName: firstName,
    clientLastName: lastName,
    clientName: customer,
    client: customer,
    clientNumber: str(prefill.clientPhone),
    clientPhone: str(prefill.clientPhone),
    clientEmail: str(prefill.clientEmail),
    clientAddress: str(prefill.projectAddress),
    notes: projectNotesHtml(
      str(prefill.projectNotes),
      normalizeLeadNotes(leadData.notes)
        .map((note) => str(note.text))
        .filter(Boolean),
    ),
    createdByUid: actorUid,
    createdByName: actorName,
    assignedTo: str(prefill.assignedToName),
    assignedToName: str(prefill.assignedToName),
    assignedToUid: str(prefill.assignedToUid),
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    status: to.status,
    dashboardSubStageId: to.subStage,
    statusHistory: [{ status: to.status, subStage: to.subStage, atIso: nowIso }],
    sourceLeadId: leadRef.id,
    tags: [],
    isDeleted: false,
    projectImages: imageItems.map((item) => str(item.url)),
    projectImageItems: imageItems,
    cutlist: { rows: [] },
    cutlistJson: { rows: [] },
    projectSettings,
    sales: { rooms: [], quoteExtrasIncluded: defaultExtras },
    ...(notifyAsCreator ? { notifySubscriptionOverrides: { [actorUid]: true } } : {}),
    ...(prefill.leadCustomFields?.length ? { leadCustomFields: prefill.leadCustomFields } : {}),
  };
  const projectRef = db.collection("companies").doc(companyId).collection("jobs").doc(projectId);
  const clearSchedule = { [SCHEDULED_COLUMN_MOVE_FIELD]: FieldValue.delete(), [SCHEDULED_COLUMN_MOVE_DUE_FIELD]: FieldValue.delete() };

  // The project made and the lead archived together — only if the lead's still there, as it was.
  const made = await db
    .runTransaction(async (tx) => {
      const snap = await tx.get(leadRef);
      if (!snap.exists) return false;
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      if (input.scheduledDueAtIso && str(data[SCHEDULED_COLUMN_MOVE_DUE_FIELD]) !== input.scheduledDueAtIso) return false;
      if (data.isDeleted === true || data.isArchived === true || data.isPurged === true || !input.isStillThere(str(data.status))) {
        if (input.scheduledDueAtIso) tx.update(leadRef, clearSchedule);
        return false;
      }
      tx.set(projectRef, project);
      tx.update(leadRef, {
        ...clearSchedule,
        isDeleted: true,
        deletedAt: FieldValue.serverTimestamp(),
        deletedAtIso: nowIso,
        convertedProjectId: projectId,
        convertedAtIso: nowIso,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtIso: nowIso,
      });
      return true;
    })
    .catch((error) => {
      console.error("[lead-convert] converting failed:", error);
      return false;
    });
  if (!made) return null;

  // Its client, on a contact card (as the New Project pop-up saves it) — the project's still made if this can't be.
  if (customer || str(prefill.clientEmail) || str(prefill.clientPhone)) {
    await saveClientForProject(companyId, {
      projectId,
      projectName: name,
      customer,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      createdByUid: actorUid,
      createdByName: actorName,
      assignedToUid: project.assignedToUid,
      assignedToName: project.assignedToName,
      assignedTo: project.assignedTo,
      statusLabel: to.status,
      tags: [],
      // (The card's own notes are plain text: just the lead's notes field.)
      notes: str(prefill.projectNotes),
      clientPhone: project.clientPhone,
      clientEmail: project.clientEmail,
      clientAddress: project.clientAddress,
    }).catch((error) => console.error("[lead-convert] contact card failed:", error));
  }
  return { projectId, name, data: project };
}
