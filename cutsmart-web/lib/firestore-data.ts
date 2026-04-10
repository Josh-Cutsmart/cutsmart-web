import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
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

function normalizeProject(id: string, data: Record<string, unknown>): Project {
  return {
    id,
    companyId: String(data.companyId ?? ""),
    name: String(data.name ?? "Untitled Project"),
    customer: String(data.customer ?? "Unknown Customer"),
    status: (String(data.status ?? "draft") as Project["status"]),
    priority: (String(data.priority ?? "medium") as Project["priority"]),
    updatedAt: toIsoString(data.updatedAt, new Date().toISOString()),
    dueDate: String(data.dueDate ?? ""),
    estimatedSheets: Number(data.estimatedSheets ?? 0),
    assignedTo: String(data.assignedTo ?? "Unassigned"),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
  };
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
            label: String(item.label ?? "Part"),
            material: String(item.material ?? "Unknown"),
            qty: Number(item.qty ?? 1),
            length: Number(item.length ?? 0),
            width: Number(item.width ?? 0),
            edgeBanding: Boolean(item.edgeBanding),
          };
        })
      : [],
  };
}

export async function fetchProjects(): Promise<Project[]> {
  if (!db) {
    return mockProjects;
  }

  try {
    const snap = await getDocs(collection(db, "projects"));
    if (snap.empty) {
      return mockProjects;
    }
    return snap.docs.map((item) => normalizeProject(item.id, item.data() as Record<string, unknown>));
  } catch {
    return mockProjects;
  }
}

export async function fetchProjectById(projectId: string): Promise<Project | null> {
  if (!db) {
    return mockProjects.find((project) => project.id === projectId) ?? null;
  }

  try {
    const ref = doc(db, "projects", projectId);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      return normalizeProject(snap.id, snap.data() as Record<string, unknown>);
    }

    return null;
  } catch {
    return mockProjects.find((project) => project.id === projectId) ?? null;
  }
}

export async function fetchQuotes(): Promise<SalesQuote[]> {
  if (!db) {
    return mockQuotes;
  }

  try {
    const snap = await getDocs(collection(db, "quotes"));
    if (snap.empty) {
      return mockQuotes;
    }
    return snap.docs.map((item) => normalizeQuote(item.id, item.data() as Record<string, unknown>));
  } catch {
    return mockQuotes;
  }
}

export async function fetchChanges(projectId: string): Promise<ProjectChange[]> {
  if (!db) {
    return mockChanges.filter((change) => change.projectId === projectId);
  }

  try {
    const snap = await getDocs(collection(db, "changelog"));
    if (snap.empty) {
      return mockChanges.filter((change) => change.projectId === projectId);
    }

    return snap.docs
      .map((item) => normalizeChange(item.id, item.data() as Record<string, unknown>))
      .filter((change) => change.projectId === projectId);
  } catch {
    return mockChanges.filter((change) => change.projectId === projectId);
  }
}

export async function fetchCutlists(projectId?: string): Promise<Cutlist[]> {
  if (!db) {
    return projectId ? mockCutlists.filter((item) => item.projectId === projectId) : mockCutlists;
  }

  try {
    const snap = await getDocs(collection(db, "cutlists"));
    if (snap.empty) {
      return projectId ? mockCutlists.filter((item) => item.projectId === projectId) : mockCutlists;
    }

    const all = snap.docs.map((item) => normalizeCutlist(item.id, item.data() as Record<string, unknown>));
    return projectId ? all.filter((item) => item.projectId === projectId) : all;
  } catch {
    return projectId ? mockCutlists.filter((item) => item.projectId === projectId) : mockCutlists;
  }
}
