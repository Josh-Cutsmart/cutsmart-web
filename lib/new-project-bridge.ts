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
  // buildLeadProjectPrefill in app/(staff)/(app)/leads/page.tsx.
  leadCustomFields?: LeadCustomFieldSnapshot[];
};
