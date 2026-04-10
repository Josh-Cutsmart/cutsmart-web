export type UserRole = "owner" | "admin" | "sales" | "production" | "viewer";

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

export interface Project {
  id: string;
  companyId: string;
  name: string;
  customer: string;
  createdAt: string;
  createdByName: string;
  status: "draft" | "quoted" | "approved" | "in-production" | "complete";
  statusLabel: string;
  priority: "low" | "medium" | "high";
  updatedAt: string;
  dueDate: string;
  estimatedSheets: number;
  assignedTo: string;
  tags: string[];
}

export interface ProjectChange {
  id: string;
  projectId: string;
  actor: string;
  action: string;
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
  role: UserRole;
}
