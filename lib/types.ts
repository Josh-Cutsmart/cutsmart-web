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
  projectSettings?: Record<string, unknown>;
  cutlist?: Record<string, unknown>;
  checklists?: ProjectChecklist[];
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
}
