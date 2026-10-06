export type UserRole = string;

export interface Company {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  ownerId: string;
}

export interface CompanyMember {
  userId: string;
  companyId: string;
  role: UserRole;
  displayName: string;
  email: string;
}

export interface ProjectImageAnnotation {
  id: string;
  x: number;
  y: number;
  xPx?: number;
  yPx?: number;
  note: string;
  createdByName?: string;
  createdByColor?: string;
}

export interface ProjectImageItem {
  url: string;
  name: string;
  annotations?: ProjectImageAnnotation[];
}

// A lead's custom form field, snapshotted onto the project at the moment a lead is converted —
// not a live join back to the source lead, which may be archived/deleted afterward, and whose
// field labels can be renamed later in Company Settings independent of what the client actually
// saw when they submitted it.
export interface LeadCustomFieldSnapshot {
  key: string;
  label: string;
  value: string;
}

export interface Project {
  id: string;
  companyId: string;
  clientId?: string;
  name: string;
  customer: string;
  createdAt: string;
  createdByUid?: string;
  createdByName: string;
  assignedToUid?: string;
  assignedToName?: string;
  // uid -> explicit subscribe(true)/unsubscribe(false) choice for this project's
  // notifications, overriding the "assigned user is subscribed by default" rule.
  // Absent for a uid = follow the default (subscribed iff assignedToUid === uid).
  notifySubscriptionOverrides?: Record<string, boolean>;
  status: "draft" | "quoted" | "approved" | "in-production" | "complete";
  statusLabel: string;
  priority: "low" | "medium" | "high";
  updatedAt: string;
  deletedAt?: string;
  // Set by updateProjectStatus() the moment status first flips to a "complete" status; stays put
  // across later status changes/edits unless status leaves and re-enters "complete". Empty string
  // when the project has never been marked complete.
  completedAtIso?: string;
  dueDate: string;
  estimatedSheets: number;
  assignedTo: string;
  tags: string[];
  notes?: string;
  productionNotes?: string;
  remedials?: string;
  // Archiving (lib/project-archive.ts): a project archived by hand, or left in a completed status past
  // Company Settings' "Archive completed projects after", is filed in the Archived list — never deleted
  // automatically (only by someone deleting it permanently from there).
  isArchived?: boolean;
  archivedAtIso?: string;
  archiveRestoredAtIso?: string;
  contractorNotes?: Record<string, string>;
  clientFirstName?: string;
  clientLastName?: string;
  clientPhone?: string;
  clientEmail?: string;
  clientAddress?: string;
  region?: string;
  projectFiles?: Array<Record<string, unknown>>;
  projectImages?: string[];
  projectImageItems?: ProjectImageItem[];
  dashboardCompleteStatusId?: string;
  // Plain sub-stage name (matches a company's projectStatuses[].subStages[].name for the status
  // this project CURRENTLY has), used only by the Dashboard board's sub-column drill-down — not a
  // stable id, and never meaningful outside the context of the project's current statusLabel.
  // Reset by updateProjectStatus() whenever the real status changes — to the destination status's
  // sub-stage marked "Default" in Company Settings, or "" (lands in the sub-board's "Other"
  // column) if it has none marked.
  dashboardSubStageId?: string;
  // Its place in its Dashboard board column once someone has dragged it there (see
  // lib/board-drop-order.ts) — unset until then, when it sits by date like any other card.
  dashboardBoardOrder?: number;
  projectSettings?: Record<string, unknown>;
  cutlist?: Record<string, unknown>;
  checklists?: ProjectChecklist[];
  // Custom form fields the client filled in on the source lead, that weren't already mapped to one
  // of the fixed fields above (clientName/Email/Phone/clientAddress/notes) — see
  // buildLeadProjectPrefill in app/(staff)/(app)/leads/page.tsx. Absent for a project not created
  // from a lead, or one whose lead had no unmapped custom fields.
  leadCustomFields?: LeadCustomFieldSnapshot[];
}

export interface ProjectChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface ProjectChecklist {
  id: string;
  name: string;
  items: ProjectChecklistItem[];
  addedAt?: string;
}

export interface ChecklistTemplateItem {
  id: string;
  text: string;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  items: ChecklistTemplateItem[];
  updatedAt?: string;
}

export interface ProjectChange {
  id: string;
  projectId: string;
  actor: string;
  action: string;
  // Full, untruncated version of the change — set only when `action` itself is a short summary
  // (e.g. "Cutlist updated — 3 rows changed") rather than the complete description. Newline-
  // separated, one changed field/row per line. Falls back to `action` when absent.
  details?: string;
  at: string;
}

export interface SalesQuote {
  id: string;
  projectId: string;
  value: number;
  currency: "NZD" | "USD";
  stage: "lead" | "quote-sent" | "won" | "lost";
  updatedAt: string;
}

export interface CutPart {
  id: string;
  label: string;
  material: string;
  qty: number;
  length: number;
  width: number;
  edgeBanding: boolean;
  partType?: string;
  room?: string;
  depth?: number;
  clashing?: string;
  fixedShelf?: string;
  adjustableShelf?: string;
  fixedShelfDrilling?: string;
  adjustableShelfDrilling?: string;
  information?: string;
  grain?: boolean;
}

export interface Cutlist {
  id: string;
  projectId: string;
  type: "initial" | "production";
  revision: number;
  parts: CutPart[];
  generatedAt: string;
}

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  mobile?: string;
  userColor?: string;
  role: UserRole;
  companyId?: string;
  permissions?: string[];
  verified?: boolean;
  // "Notifications as Creator" (User Settings) — see lib/membership.ts's UserProfileSummary.
  notifyAsCreator?: boolean;
}
