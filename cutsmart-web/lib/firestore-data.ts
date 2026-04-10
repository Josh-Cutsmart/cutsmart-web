import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  type QueryDocumentSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db, hasFirebaseConfig } from "@/lib/firebase";
import { mockChanges, mockCutlists, mockProjects, mockQuotes } from "@/lib/mock-data";
import type { Cutlist, Project, ProjectChange, SalesQuote } from "@/lib/types";

function toIsoString(value: unknown, fallback = "") {
  if (!value) {
    return fallback;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object" && value !== null && "toDate" in value) {
    const maybeTimestamp = value as { toDate: () => Date };
    return maybeTimestamp.toDate().toISOString();
  }

  return fallback;
}

function toProjectStatus(raw: unknown): Project["status"] {
  const value = String(raw ?? "").toLowerCase();
  if (value.includes("complete")) {
    return "complete";
  }
  if (value.includes("production") || value.includes("running") || value.includes("cnc")) {
    return "in-production";
  }
  if (value.includes("approved")) {
    return "approved";
  }
  if (value.includes("quote") || value.includes("new") || value.includes("draft")) {
    return "quoted";
  }
  return "draft";
}

function normalizeProject(id: string, data: Record<string, unknown>): Project {
  const rows =
    typeof data.cutlist === "object" && data.cutlist !== null && Array.isArray((data.cutlist as { rows?: unknown[] }).rows)
      ? ((data.cutlist as { rows: unknown[] }).rows ?? [])
      : [];

  return {
    id,
    companyId: String(data.companyId ?? ""),
    name: String(data.name ?? "Untitled Project"),
    customer: String(data.customer ?? data.clientName ?? data.client ?? "Unknown Customer"),
    createdAt: toIsoString(data.createdAtIso ?? data.createdAt, new Date().toISOString()),
    createdByName: String(data.createdByName ?? "Unknown"),
    status: toProjectStatus(data.status),
    statusLabel: String(data.status ?? "New"),
    priority: (String(data.priority ?? "medium") as Project["priority"]),
    updatedAt: toIsoString(data.updatedAtIso ?? data.updatedAt, new Date().toISOString()),
    dueDate: String(data.dueDate ?? data.due ?? ""),
    estimatedSheets: Number(data.estimatedSheets ?? rows.length ?? 0),
    assignedTo: String(data.assignedTo ?? data.createdByName ?? "Unassigned"),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
  };
}

function normalizeJobProject(companyId: string, docSnap: QueryDocumentSnapshot): Project {
  const data = (docSnap.data() ?? {}) as Record<string, unknown>;
  const projectId = String(data.id ?? docSnap.id);
  const normalized = normalizeProject(projectId, data);
  normalized.companyId = companyId;
  return normalized;
}

function normalizeQuote(id: string, data: Record<string, unknown>): SalesQuote {
  return {
    id,
    projectId: String(data.projectId ?? ""),
    value: Number(data.value ?? 0),
    currency: (String(data.currency ?? "NZD") as SalesQuote["currency"]),
    stage: (String(data.stage ?? "lead") as SalesQuote["stage"]),
    updatedAt: toIsoString(data.updatedAt, new Date().toISOString()),
  };
}

function normalizeChange(id: string, data: Record<string, unknown>): ProjectChange {
  return {
    id,
    projectId: String(data.projectId ?? ""),
    actor: String(data.actor ?? "System"),
    action: String(data.action ?? "Updated"),
    at: toIsoString(data.at, new Date().toISOString()),
  };
}

function normalizeCutlist(id: string, data: Record<string, unknown>): Cutlist {
  return {
    id,
    projectId: String(data.projectId ?? ""),
    type: (String(data.type ?? "initial") as Cutlist["type"]),
    revision: Number(data.revision ?? 1),
    generatedAt: toIsoString(data.generatedAt, new Date().toISOString()),
    parts: Array.isArray(data.parts)
      ? data.parts.map((part, index) => {
          const item = (part ?? {}) as Record<string, unknown>;
          return {
            id: String(item.id ?? `part_${index + 1}`),
            label: String(item.label ?? item.Name ?? "Part"),
            material: String(item.material ?? item.Board ?? "Unknown"),
            qty: Number(item.qty ?? item.Quantity ?? 1),
            length: Number(item.length ?? item.Height ?? 0),
            width: Number(item.width ?? item.Width ?? 0),
            edgeBanding: Boolean(item.edgeBanding),
          };
        })
      : [],
  };
}

async function fetchCompanyIdsForUser(uid: string): Promise<string[]> {
  if (!db || !uid) {
    return [];
  }

  try {
    const snap = await getDocs(query(collectionGroup(db, "memberships"), where("uid", "==", uid)));
    const ids = new Set<string>();

    for (const docSnap of snap.docs) {
      const parent = docSnap.ref.parent.parent;
      if (parent) {
        ids.add(parent.id);
      }
    }

    return Array.from(ids);
  } catch {
    return [];
  }
}

async function fetchProjectsFromCompanyJobs(uid: string): Promise<Project[]> {
  if (!db || !uid) {
    return [];
  }

  const companyIds = await fetchCompanyIdsForUser(uid);
  if (!companyIds.length) {
    return [];
  }

  const all: Project[] = [];
  for (const companyId of companyIds) {
    try {
      const jobsSnap = await getDocs(collection(db, "companies", companyId, "jobs"));
      for (const item of jobsSnap.docs) {
        const data = (item.data() ?? {}) as Record<string, unknown>;
        if (Boolean(data.isDeleted)) {
          continue;
        }
        all.push(normalizeJobProject(companyId, item));
      }
    } catch {
      continue;
    }
  }

  all.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return all;
}

export async function fetchProjects(uid?: string): Promise<Project[]> {
  if (!db) {
    return mockProjects;
  }

  try {
    const topLevel = await getDocs(collection(db, "projects"));
    if (!topLevel.empty) {
      return topLevel.docs.map((item) => normalizeProject(item.id, item.data() as Record<string, unknown>));
    }
  } catch {
    // continue into company/jobs fallback
  }

  const nested = await fetchProjectsFromCompanyJobs(String(uid ?? ""));
  if (nested.length > 0) {
    return nested;
  }

  return hasFirebaseConfig ? [] : mockProjects;
}

export async function fetchProjectById(projectId: string, uid?: string): Promise<Project | null> {
  if (!db) {
    return mockProjects.find((project) => project.id === projectId) ?? null;
  }

  try {
    const ref = doc(db, "projects", projectId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return normalizeProject(snap.id, snap.data() as Record<string, unknown>);
    }
  } catch {
    // continue into company/jobs fallback
  }

  const nested = await fetchProjectsFromCompanyJobs(String(uid ?? ""));
  return nested.find((project) => project.id === projectId) ?? null;
}

export async function fetchQuotes(): Promise<SalesQuote[]> {
  if (!db) {
    return mockQuotes;
  }

  try {
    const snap = await getDocs(collection(db, "quotes"));
    if (snap.empty) {
      return hasFirebaseConfig ? [] : mockQuotes;
    }
    return snap.docs.map((item) => normalizeQuote(item.id, item.data() as Record<string, unknown>));
  } catch {
    return hasFirebaseConfig ? [] : mockQuotes;
  }
}

export async function fetchChanges(projectId: string): Promise<ProjectChange[]> {
  if (!db) {
    return mockChanges.filter((change) => change.projectId === projectId);
  }

  try {
    const snap = await getDocs(collection(db, "changelog"));
    if (snap.empty) {
      return hasFirebaseConfig ? [] : mockChanges.filter((change) => change.projectId === projectId);
    }

    return snap.docs
      .map((item) => normalizeChange(item.id, item.data() as Record<string, unknown>))
      .filter((change) => change.projectId === projectId);
  } catch {
    return hasFirebaseConfig ? [] : mockChanges.filter((change) => change.projectId === projectId);
  }
}

export async function fetchCutlists(projectId?: string, uid?: string): Promise<Cutlist[]> {
  if (!db) {
    return projectId ? mockCutlists.filter((item) => item.projectId === projectId) : mockCutlists;
  }

  try {
    const snap = await getDocs(collection(db, "cutlists"));
    if (!snap.empty) {
      const all = snap.docs.map((item) => normalizeCutlist(item.id, item.data() as Record<string, unknown>));
      return projectId ? all.filter((item) => item.projectId === projectId) : all;
    }
  } catch {
    // continue into company/jobs fallback
  }

  if (!projectId) {
    return hasFirebaseConfig ? [] : mockCutlists;
  }

  const project = await fetchProjectById(projectId, uid);
  if (!project || !project.companyId) {
    return hasFirebaseConfig ? [] : mockCutlists.filter((item) => item.projectId === projectId);
  }

  try {
    const jobsSnap = await getDocs(collection(db, "companies", project.companyId, "jobs"));
    for (const job of jobsSnap.docs) {
      const data = (job.data() ?? {}) as Record<string, unknown>;
      const id = String(data.id ?? job.id);
      if (id !== projectId) {
        continue;
      }

      const rawRows =
        typeof data.cutlist === "object" && data.cutlist !== null && Array.isArray((data.cutlist as { rows?: unknown[] }).rows)
          ? ((data.cutlist as { rows: unknown[] }).rows ?? [])
          : [];

      const parts = rawRows.map((row, index) => {
        const item = (row ?? {}) as Record<string, unknown>;
        return {
          id: String(item.id ?? `row_${index + 1}`),
          label: String(item.Name ?? item.name ?? `Part ${index + 1}`),
          material: String(item.Board ?? item.material ?? "Unknown"),
          qty: Number(item.Quantity ?? item.qty ?? 1),
          length: Number(item.Height ?? item.length ?? 0),
          width: Number(item.Width ?? item.width ?? 0),
          edgeBanding: false,
        };
      });

      const generatedAt = toIsoString(data.updatedAtIso ?? data.updatedAt, new Date().toISOString());
      const all: Cutlist[] = [
        {
          id: `${projectId}_initial`,
          projectId,
          type: "initial",
          revision: 1,
          generatedAt,
          parts,
        },
        {
          id: `${projectId}_production`,
          projectId,
          type: "production",
          revision: 1,
          generatedAt,
          parts,
        },
      ];

      return all;
    }
  } catch {
    // ignore
  }

  return hasFirebaseConfig ? [] : mockCutlists.filter((item) => item.projectId === projectId);
}
