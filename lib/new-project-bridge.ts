export const OPEN_NEW_PROJECT_EVENT = "cutsmart:open-new-project";

export type NewProjectPrefillPayload = {
  projectName?: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  projectAddress?: string;
  projectNotes?: string;
};
