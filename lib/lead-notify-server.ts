import { adminDb } from "@/lib/firebase-admin";
import { apiHasPermission, listCompanyMemberAccess } from "@/lib/api-company-access";
import { addNotificationAndPush } from "@/lib/push-server";
import { leadClientDisplayName } from "@/lib/lead-name";
import { leadFormFieldLayout, normalizeLeadForms } from "@/lib/lead-forms";

// "New lead" notifications — a lead that came in through Zapier (app/api/leads) or was added on the Leads page
// with Create Lead (app/api/leads/manual).

function toStr(value: unknown) {
  return String(value ?? "").trim();
}

// A lead's name for a notification: its client's name (the lead's form's questions, else the company's Zapier
// lead field mapping), else what came in with it.
export async function leadNameForNotification(companyId: string, lead: Record<string, unknown>): Promise<string> {
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
  return leadClientDisplayName(lead.rawFields, fieldLayout) || toStr(lead.name) || toStr(lead.email) || toStr(lead.phone) || "A new lead";
}

// "New lead" to everyone who can see it — the owner/admins and anyone allowed to see others' leads
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
    const [members, name] = await Promise.all([listCompanyMemberAccess(companyId), leadNameForNotification(companyId, lead)]);
    const from = toStr(lead.formName) || (toStr(lead.source) === "zapier-form" ? "" : toStr(lead.source));
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
              title: isAssignee ? "Added to a lead" : "New lead",
              message: addedBy
                ? isAssignee
                  ? `${addedBy.name} added you to the lead "${name}".`
                  : `${addedBy.name} added the lead "${name}".`
                : from
                  ? `${name} came in from ${from}.`
                  : `${name} just came in.`,
              type: isAssignee ? "lead_access" : "lead_new",
              leadId,
              companyId,
            },
            siteOrigin,
          );
        }),
    );
  } catch (error) {
    console.error("[leads] new-lead notifications failed:", error);
  }
}
