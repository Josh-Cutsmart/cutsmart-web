import { adminDb } from "@/lib/firebase-admin";
import { apiHasPermission, listCompanyMemberAccess } from "@/lib/api-company-access";
import { addNotificationAndPush } from "@/lib/push-server";
import { leadClientDisplayName } from "@/lib/lead-name";
import { leadFormFieldLayout, normalizeLeadForms } from "@/lib/lead-forms";

// "New Lead" notifications — a lead from the leads email inbox (app/api/leads/email-inbound), one of the company's
// lead forms (app/api/lead-forms/submit), Zapier (app/api/leads) or Create Lead on the Leads page
// (app/api/leads/manual).

function toStr(value: unknown) {
  return String(value ?? "").trim();
}

// A lead's name for a notification: its client's name (the lead's form's questions, else the company's Zapier
// lead field mapping), else what came in with it, else `fallback`.
export async function leadNameForNotification(companyId: string, lead: Record<string, unknown>, fallback = "A new lead"): Promise<string> {
  let fieldLayout: unknown = null;
  try {
    const companyData = (await adminDb!.collection("companies").doc(companyId).get()).data() ?? {};
    const formId = toStr(lead.formId);
    const form = formId ? normalizeLeadForms(companyData.leadForms).find((row) => row.id === formId) : undefined;
    if (form) {
      fieldLayout = leadFormFieldLayout(form, (lead.formFieldKeys ?? undefined) as Record<string, string> | undefined);
    } else {
      const integrations = (companyData.integrations ?? {}) as Record<string, unknown>;
      fieldLayout = ((integrations.zapierLeads ?? {}) as Record<string, unknown>).fieldLayout ?? null;
    }
  } catch {
    fieldLayout = null;
  }
  return leadClientDisplayName(lead.rawFields, fieldLayout) || toStr(lead.name) || toStr(lead.email) || toStr(lead.phone) || fallback;
}

// Every new lead's notification reads the same way — "New Lead", then where it came from and who:
//   From Email: jane@example.com        (the leads email inbox — the sender's address)
//   From Form: Jane Smith               (one of the company's lead forms — their first and last name)
//   From Zapier: Jane Smith
//   From Create Lead: Jane Smith        (added on the Leads page)
function newLeadMessage(lead: Record<string, unknown>, name: string) {
  const source = toStr(lead.source);
  if (source === "email") return `From Email: ${toStr(lead.email) || name}`;
  if (source === "web-form") return `From Form: ${name}`;
  if (source === "manual") return `From Create Lead: ${name}`;
  return `From Zapier: ${name}`;
}

// "New Lead" to everyone who can see it — the owner/admins and anyone allowed to see others' leads
// (leads.view.others), the same rule as the Leads page. addedBy: a lead someone added by hand — they aren't told
// about their own lead, and whoever they assigned it to hears they were added to it.
export async function notifyNewLead(
  companyId: string,
  leadId: string,
  lead: Record<string, unknown>,
  siteOrigin: string,
  addedBy?: { uid: string; name: string },
) {
  try {
    const [members, name] = await Promise.all([listCompanyMemberAccess(companyId), leadNameForNotification(companyId, lead, "no name given")]);
    const assigneeUid = toStr(lead.assignedToUid);
    await Promise.all(
      members
        .filter((member) => member.access.uid !== addedBy?.uid)
        .filter((member) => apiHasPermission(member.access, "leads.view.others") || (addedBy && member.access.uid === assigneeUid))
        .map((member) => {
          const isAssignee = Boolean(addedBy) && member.access.uid === assigneeUid;
          return addNotificationAndPush(
            member.access.uid,
            {
              title: isAssignee ? "Added to a lead" : "New Lead",
              message: isAssignee && addedBy ? `${addedBy.name} added you to the lead "${name}".` : newLeadMessage(lead, name),
              type: isAssignee ? "lead_access" : "lead_new",
              leadId,
              companyId,
            },
            siteOrigin,
          );
        }),
    );
    // In at its first column: that column's automations — "enters" ones told, and moved on if it moves things
    // (lib/column-automations-server.ts — imported here as it's used, as it uses this file's leadNameForNotification).
    const { runLeadColumnAutomations } = await import("@/lib/column-automations-server");
    await runLeadColumnAutomations({
      companyId,
      leadId,
      leadName: name,
      from: null,
      to: { status: toStr(lead.status), subStage: "" },
      actorUid: addedBy?.uid,
      siteOrigin,
    });
  } catch (error) {
    console.error("[leads] new-lead notifications failed:", error);
  }
}
