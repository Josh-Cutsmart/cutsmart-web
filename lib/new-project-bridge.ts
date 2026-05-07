import type { ProjectImageItem } from "@/lib/types";

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
};
