import type { LeadCustomFieldSnapshot, ProjectImageItem } from "@/lib/types";

export const OPEN_NEW_PROJECT_EVENT = "cutsmart:open-new-project";
export const LEAD_PROJECT_CREATED_EVENT = "cutsmart:lead-project-created";

export type NewProjectPrefillPayload = {
  projectName?: string;
  clientFirstName?: string;
  clientLastName?: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  projectAddress?: string;
  projectNotes?: string;
  projectImages?: string[];
  projectImageItems?: ProjectImageItem[];
  assignedToUid?: string;
  assignedToName?: string;
  sourceLeadId?: string;
  sourceLeadCompanyId?: string;
  // Lead custom fields not already captured by one of the fixed fields above — see
  // buildLeadProjectPrefill in lib/lead-project-prefill.ts.
  leadCustomFields?: LeadCustomFieldSnapshot[];
  // The lead's notes (the lead pop-up's Notes), oldest first — the Notes box's "Import from Notes" adds them, a bullet
  // each.
  leadNotes?: string[];
};
