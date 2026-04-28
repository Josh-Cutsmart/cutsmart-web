import {
  type Company,
  type CompanyMember,
  type Cutlist,
  type Project,
  type ProjectChange,
  type SalesQuote,
} from "@/lib/types";

export const mockCompany: Company = {
  id: "cmp_01",
  name: "CutSmart Joinery",
  slug: "cutsmart-joinery",
  createdAt: "2026-04-08T09:00:00Z",
  ownerId: "user_owner",
};

export const mockMembers: CompanyMember[] = [
  {
    userId: "user_owner",
    companyId: "cmp_01",
    role: "owner",
    displayName: "Taylor Owner",
    email: "owner@cutsmart.test",
  },
  {
    userId: "user_sales",
    companyId: "cmp_01",
    role: "staff",
    displayName: "Sam Sales",
    email: "sales@cutsmart.test",
  },
  {
    userId: "user_prod",
    companyId: "cmp_01",
    role: "staff",
    displayName: "Priya Production",
    email: "production@cutsmart.test",
  },
];

export const mockProjects: Project[] = [
  {
    id: "prj_1001",
    companyId: "cmp_01",
    name: "Harbour Kitchen Upgrade",
    customer: "Liam Thompson",
    createdAt: "2026-04-06T01:00:00Z",
    createdByName: "Priya Production",
    status: "in-production",
    statusLabel: "In Production",
    priority: "high",
    updatedAt: "2026-04-10T01:21:00Z",
    dueDate: "2026-04-18",
    estimatedSheets: 17,
    assignedTo: "Priya Production",
    tags: ["kitchen", "oak", "rush"],
  },
  {
    id: "prj_1002",
    companyId: "cmp_01",
    name: "West End Wardrobes",
    customer: "Ari & Jordan",
    createdAt: "2026-04-04T03:10:00Z",
    createdByName: "Sam Sales",
    status: "quoted",
    statusLabel: "Quoting",
    priority: "medium",
    updatedAt: "2026-04-09T22:14:00Z",
    dueDate: "2026-04-25",
    estimatedSheets: 9,
    assignedTo: "Sam Sales",
    tags: ["wardrobe", "melamine"],
  },
  {
    id: "prj_1003",
    companyId: "cmp_01",
    name: "Studio Fitout Batch 3",
    customer: "Northline Builders",
    createdAt: "2026-04-03T10:40:00Z",
    createdByName: "Taylor Owner",
    status: "approved",
    statusLabel: "Drafting",
    priority: "high",
    updatedAt: "2026-04-09T19:10:00Z",
    dueDate: "2026-04-20",
    estimatedSheets: 24,
    assignedTo: "Taylor Owner",
    tags: ["commercial", "fitout"],
  },
];

export const mockChanges: ProjectChange[] = [
  {
    id: "chg_01",
    projectId: "prj_1001",
    actor: "Priya Production",
    action: "Updated production cutlist to revision 3",
    at: "2026-04-10T00:05:00Z",
  },
  {
    id: "chg_02",
    projectId: "prj_1001",
    actor: "Sam Sales",
    action: "Confirmed laminate selection with customer",
    at: "2026-04-09T16:40:00Z",
  },
  {
    id: "chg_03",
    projectId: "prj_1002",
    actor: "Sam Sales",
    action: "Quote sent",
    at: "2026-04-09T03:40:00Z",
  },
];

export const mockQuotes: SalesQuote[] = [
  {
    id: "q_01",
    projectId: "prj_1001",
    value: 18950,
    currency: "NZD",
    stage: "won",
    updatedAt: "2026-04-08T06:00:00Z",
  },
  {
    id: "q_02",
    projectId: "prj_1002",
    value: 11200,
    currency: "NZD",
    stage: "quote-sent",
    updatedAt: "2026-04-09T03:40:00Z",
  },
  {
    id: "q_03",
    projectId: "prj_1003",
    value: 27500,
    currency: "NZD",
    stage: "lead",
    updatedAt: "2026-04-07T05:40:00Z",
  },
];

export const mockCutlists: Cutlist[] = [
  {
    id: "cut_01",
    projectId: "prj_1001",
    type: "initial",
    revision: 1,
    generatedAt: "2026-04-08T07:30:00Z",
    parts: [
      {
        id: "p_1",
        label: "Base Panel A",
        material: "16mm White Melamine",
        qty: 4,
        length: 720,
        width: 560,
        edgeBanding: true,
      },
      {
        id: "p_2",
        label: "Side Panel B",
        material: "16mm White Melamine",
        qty: 6,
        length: 2100,
        width: 560,
        edgeBanding: true,
      },
    ],
  },
  {
    id: "cut_02",
    projectId: "prj_1001",
    type: "production",
    revision: 3,
    generatedAt: "2026-04-10T00:05:00Z",
    parts: [
      {
        id: "p_3",
        label: "Island Face Panel",
        material: "19mm Oak Veneer",
        qty: 2,
        length: 2420,
        width: 540,
        edgeBanding: false,
      },
      {
        id: "p_4",
        label: "Drawer Front Set",
        material: "19mm Oak Veneer",
        qty: 8,
        length: 220,
        width: 520,
        edgeBanding: true,
      },
    ],
  },
];
