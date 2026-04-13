import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type QueryDocumentSnapshot,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db, hasFirebaseConfig } from "@/lib/firebase";
import { mockChanges, mockCutlists, mockProjects, mockQuotes } from "@/lib/mock-data";
import type { Cutlist, Project, ProjectChange, SalesQuote } from "@/lib/types";

const DEFAULT_COMPANY_FALLBACK = "cmp_mykm_91647c";
const COMPANY_FALLBACK_IDS = Array.from(
  new Set(
    [
      String(process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID ?? "").trim(),
      DEFAULT_COMPANY_FALLBACK,
    ].filter(Boolean),
  ),
);

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

  const settings =
    typeof data.projectSettings === "object" && data.projectSettings !== null
      ? ({ ...(data.projectSettings as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  let salesPayload: Record<string, unknown> | null = null;
  const salesRaw = data.sales;
  if (salesRaw && typeof salesRaw === "object") {
    salesPayload = { ...(salesRaw as Record<string, unknown>) };
  } else if (typeof salesRaw === "string" && salesRaw.trim()) {
    try {
      const parsed = JSON.parse(salesRaw);
      if (parsed && typeof parsed === "object") {
        salesPayload = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      // ignore invalid legacy string payload
    }
  }
  if (!salesPayload && typeof data.salesJson === "string" && data.salesJson.trim()) {
    try {
      const parsed = JSON.parse(data.salesJson);
      if (parsed && typeof parsed === "object") {
        salesPayload = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      // ignore invalid legacy string payload
    }
  }
  if (salesPayload && !("sales" in settings)) {
    settings.sales = salesPayload;
  }

  if (typeof data.productionTempEdit === "object" && data.productionTempEdit !== null && !("productionTempEdit" in settings)) {
    settings.productionTempEdit = data.productionTempEdit as Record<string, unknown>;
  }

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
    notes: String(data.notes ?? ""),
    clientPhone: String(data.clientPhone ?? data.clientNumber ?? ""),
    clientEmail: String(data.clientEmail ?? ""),
    clientAddress: String(data.clientAddress ?? ""),
    region: String(data.region ?? ""),
    projectFiles: Array.isArray(data.projectFiles) ? (data.projectFiles as Array<Record<string, unknown>>) : [],
    projectImages: Array.isArray(data.projectImages) ? data.projectImages.map(String) : [],
    projectSettings: settings,
  };
}

async function syncCompanyProjectTagUsage(companyId: string): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) {
    return;
  }
  try {
    const jobsSnap = await getDocs(collection(db, "companies", cid, "jobs"));
    const counts = new Map<string, { value: string; count: number }>();

    for (const item of jobsSnap.docs) {
      const data = item.data() as Record<string, unknown>;
      const tags = Array.isArray(data.tags) ? data.tags : [];
      const uniqueInProject = new Set<string>();
      for (const rawTag of tags) {
        const value = String(rawTag ?? "").trim();
        if (!value) continue;
        const key = value.toLowerCase();
        if (uniqueInProject.has(key)) continue;
        uniqueInProject.add(key);
        const existing = counts.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          counts.set(key, { value, count: 1 });
        }
      }
    }

    const sorted = Array.from(counts.values()).sort(
      (a, b) => b.count - a.count || a.value.localeCompare(b.value),
    );

    await updateDoc(doc(db, "companies", cid), {
      projectTagUsage: {
        tags: sorted.map((row) => ({ value: row.value, count: row.count })),
      },
      updatedAtIso: new Date().toISOString(),
    });
  } catch {
    // Best-effort sync only.
  }
}

function normalizeTagList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 5);
}

async function patchCompanyTagUsageByDelta(
  companyId: string,
  previousTags: string[],
  nextTags: string[],
): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) return;
  try {
    const companyRef = doc(db, "companies", cid);
    const companySnap = await getDoc(companyRef);
    const existingRaw = companySnap.exists()
      ? ((companySnap.data() as Record<string, unknown>)?.projectTagUsage as Record<string, unknown> | undefined)
      : undefined;
    const existingRows = Array.isArray(existingRaw?.tags) ? existingRaw?.tags : [];
    const usage = new Map<string, { value: string; count: number }>();
    for (const row of existingRows) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const value = String(item.value ?? "").trim();
      if (!value) continue;
      const key = value.toLowerCase();
      const count = Number(item.count ?? 0);
      usage.set(key, { value, count: Number.isFinite(count) ? count : 0 });
    }

    const prevSet = new Set(previousTags.map((v) => v.toLowerCase()));
    const nextSet = new Set(nextTags.map((v) => v.toLowerCase()));

    for (const prev of previousTags) {
      const key = prev.toLowerCase();
      if (nextSet.has(key)) continue;
      const row = usage.get(key);
      if (!row) continue;
      row.count = Math.max(0, row.count - 1);
      if (row.count <= 0) usage.delete(key);
    }

    for (const next of nextTags) {
      const key = next.toLowerCase();
      if (prevSet.has(key)) continue;
      const row = usage.get(key);
      if (row) {
        row.count += 1;
      } else {
        usage.set(key, { value: next, count: 1 });
      }
    }

    const tags = Array.from(usage.values()).sort(
      (a, b) => b.count - a.count || a.value.localeCompare(b.value),
    );

    await updateDoc(companyRef, {
      projectTagUsage: {
        tags: tags.map((row) => ({ value: row.value, count: row.count })),
      },
      updatedAtIso: new Date().toISOString(),
    });
  } catch {
    await syncCompanyProjectTagUsage(cid);
  }
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
            partType: String(item.partType ?? item["Part Type"] ?? item.Part ?? item.part ?? ""),
            room: String(item.room ?? item.Room ?? ""),
            depth: Number(item.depth ?? item.Depth ?? 0),
            clashing: String(item.clashing ?? item.Clashing ?? ""),
            fixedShelf: String(item.fixedShelf ?? item["Fixed Shelf"] ?? ""),
            adjustableShelf: String(item.adjustableShelf ?? item["Adjustable Shelf"] ?? ""),
            fixedShelfDrilling: String(item.fixedShelfDrilling ?? item["Fixed Shelf Drilling"] ?? ""),
            adjustableShelfDrilling: String(item.adjustableShelfDrilling ?? item["Adjustable Shelf Drilling"] ?? ""),
            information: String(item.information ?? item.Information ?? ""),
            grain: String(item.grain ?? item.Grain ?? "").toLowerCase() === "yes" || Boolean(item.grain),
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
    // fall through to legacy scan mode
  }

  // Legacy fallback: some memberships docs use doc ID as uid and omit `uid` field.
  try {
    const snap = await getDocs(collectionGroup(db, "memberships"));
    const ids = new Set<string>();

    for (const docSnap of snap.docs) {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      const uidField = String(data.uid ?? "");
      const docId = String(docSnap.id ?? "");
      if (uidField !== uid && docId !== uid) {
        continue;
      }
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

  let companyIds = await fetchCompanyIdsForUser(uid);
  if (!companyIds.length) {
    companyIds = [...COMPANY_FALLBACK_IDS];
  }

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

async function fetchProjectsFromLegacyUserPaths(uid: string): Promise<Project[]> {
  if (!db || !uid) {
    return [];
  }

  const all: Project[] = [];

  // Legacy path: users/{uid}/projects
  try {
    const userProjects = await getDocs(collection(db, "users", uid, "projects"));
    for (const item of userProjects.docs) {
      const data = (item.data() ?? {}) as Record<string, unknown>;
      if (Boolean(data.isDeleted)) {
        continue;
      }
      const id = String(data.id ?? item.id);
      all.push(normalizeProject(id, data));
    }
  } catch {
    // ignore
  }

  // Legacy path: companies/{companyId}/memberships/{uid}/projects
  try {
    const companyIds = await fetchCompanyIdsForUser(uid);
    for (const companyId of companyIds) {
      try {
        const nested = await getDocs(
          collection(db, "companies", companyId, "memberships", uid, "projects"),
        );
        for (const item of nested.docs) {
          const data = (item.data() ?? {}) as Record<string, unknown>;
          if (Boolean(data.isDeleted)) {
            continue;
          }
          const id = String(data.id ?? item.id);
          const normalized = normalizeProject(id, data);
          normalized.companyId = companyId;
          all.push(normalized);
        }
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }

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

  const legacy = await fetchProjectsFromLegacyUserPaths(String(uid ?? ""));
  if (legacy.length > 0) {
    return legacy;
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
          partType: String(item.partType ?? item["Part Type"] ?? item.Part ?? item.part ?? ""),
          room: String(item.room ?? item.Room ?? ""),
          depth: Number(item.depth ?? item.Depth ?? 0),
          clashing: String(item.clashing ?? item.Clashing ?? ""),
          information: String(item.information ?? item.Information ?? ""),
          grain: String(item.grain ?? item.Grain ?? "").toLowerCase() === "yes" || Boolean(item.grain),
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

export interface ProjectSourceDiagnostics {
  uid: string;
  hasFirebase: boolean;
  topLevelProjectsCount: number;
  membershipCompanyIds: string[];
  companyJobsCountByCompany: Record<string, number>;
  collectionGroupJobsCount: number;
  userProjectsCount: number;
  membershipNestedProjectsCountByCompany: Record<string, number>;
  errors: string[];
}

export interface CompanyMemberOption {
  uid: string;
  displayName: string;
  role: string;
  email?: string;
  mobile?: string;
}

export interface UserNotificationRow {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAtIso: string;
}

export async function debugProjectSources(uid?: string): Promise<ProjectSourceDiagnostics> {
  const userId = String(uid ?? "");
  const out: ProjectSourceDiagnostics = {
    uid: userId,
    hasFirebase: Boolean(db),
    topLevelProjectsCount: 0,
    membershipCompanyIds: [],
    companyJobsCountByCompany: {},
    collectionGroupJobsCount: 0,
    userProjectsCount: 0,
    membershipNestedProjectsCountByCompany: {},
    errors: [],
  };

  if (!db || !userId) {
    return out;
  }

  try {
    const top = await getDocs(collection(db, "projects"));
    out.topLevelProjectsCount = top.size;
  } catch (e) {
    out.errors.push(`top-level projects: ${String(e)}`);
  }

  let companyIds: string[] = [];
  try {
    companyIds = await fetchCompanyIdsForUser(userId);
  out.membershipCompanyIds = [...companyIds];
  } catch (e) {
    out.errors.push(`memberships lookup: ${String(e)}`);
  }

  if (!companyIds.length && COMPANY_FALLBACK_IDS.length) {
    companyIds = [...COMPANY_FALLBACK_IDS];
    out.membershipCompanyIds = [...companyIds];
  }

  for (const companyId of companyIds) {
    try {
      const jobs = await getDocs(collection(db, "companies", companyId, "jobs"));
      out.companyJobsCountByCompany[companyId] = jobs.size;
    } catch (e) {
      out.errors.push(`companies/${companyId}/jobs: ${String(e)}`);
    }

    try {
      const nested = await getDocs(collection(db, "companies", companyId, "memberships", userId, "projects"));
      out.membershipNestedProjectsCountByCompany[companyId] = nested.size;
    } catch (e) {
      out.errors.push(`companies/${companyId}/memberships/${userId}/projects: ${String(e)}`);
    }
  }

  try {
    const cg = await getDocs(collectionGroup(db, "jobs"));
    out.collectionGroupJobsCount = cg.size;
  } catch (e) {
    out.errors.push(`collectionGroup jobs: ${String(e)}`);
  }

  try {
    const up = await getDocs(collection(db, "users", userId, "projects"));
    out.userProjectsCount = up.size;
  } catch (e) {
    out.errors.push(`users/${userId}/projects: ${String(e)}`);
  }

  return out;
}

export async function updateProjectStatus(project: Project, newStatus: string): Promise<boolean> {
  if (!db || !project || !newStatus) {
    return false;
  }

  try {
    const topLevelRef = doc(db, "projects", project.id);
    const topLevelSnap = await getDoc(topLevelRef);
    if (topLevelSnap.exists()) {
      await updateDoc(topLevelRef, {
        status: newStatus,
        updatedAtIso: new Date().toISOString(),
      });
      return true;
    }
  } catch {
    // continue into nested company/jobs fallback
  }

  if (!project.companyId) {
    return false;
  }

  try {
    const jobsQ = query(
      collection(db, "companies", project.companyId, "jobs"),
      where("id", "==", project.id),
      limit(1),
    );
    const jobsSnap = await getDocs(jobsQ);
    if (jobsSnap.empty) {
      return false;
    }

    await updateDoc(jobsSnap.docs[0].ref, {
      status: newStatus,
      updatedAtIso: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function updateProjectTags(
  project: Project,
  tags: string[],
  previousTags?: string[],
): Promise<boolean> {
  if (!db || !project) {
    return false;
  }

  const cleanedTags = normalizeTagList(tags);
  const previousCleaned = normalizeTagList(previousTags ?? project.tags ?? []);

  try {
    const topLevelRef = doc(db, "projects", project.id);
    const topLevelSnap = await getDoc(topLevelRef);
    if (topLevelSnap.exists()) {
      await updateDoc(topLevelRef, {
        tags: cleanedTags,
        updatedAtIso: new Date().toISOString(),
      });
      if (project.companyId) {
        await patchCompanyTagUsageByDelta(project.companyId, previousCleaned, cleanedTags);
      }
      return true;
    }
  } catch {
    // continue into nested company/jobs fallback
  }

  if (!project.companyId) {
    return false;
  }

  try {
    const jobsQ = query(
      collection(db, "companies", project.companyId, "jobs"),
      where("id", "==", project.id),
      limit(1),
    );
    const jobsSnap = await getDocs(jobsQ);
    if (jobsSnap.empty) {
      return false;
    }

    await updateDoc(jobsSnap.docs[0].ref, {
      tags: cleanedTags,
      updatedAtIso: new Date().toISOString(),
    });
    await patchCompanyTagUsageByDelta(project.companyId, previousCleaned, cleanedTags);
    return true;
  } catch {
    return false;
  }
}

export async function softDeleteProject(project: Project): Promise<boolean> {
  if (!db || !project) {
    return false;
  }

  const patch = {
    isDeleted: true,
    deletedAtIso: new Date().toISOString(),
    updatedAtIso: new Date().toISOString(),
  };

  try {
    const topLevelRef = doc(db, "projects", project.id);
    const topLevelSnap = await getDoc(topLevelRef);
    if (topLevelSnap.exists()) {
      await updateDoc(topLevelRef, patch);
      return true;
    }
  } catch {
    // continue into nested company/jobs fallback
  }

  if (!project.companyId) {
    return false;
  }

  try {
    const jobsQ = query(
      collection(db, "companies", project.companyId, "jobs"),
      where("id", "==", project.id),
      limit(1),
    );
    const jobsSnap = await getDocs(jobsQ);
    if (jobsSnap.empty) {
      return false;
    }

    await updateDoc(jobsSnap.docs[0].ref, patch);
    return true;
  } catch {
    return false;
  }
}

export async function grantTempProductionAccess(
  project: Project,
  targetUid: string,
  hours = 6,
): Promise<string | null> {
  if (!db || !project) {
    return null;
  }

  const uid = String(targetUid || "").trim();
  if (!uid) {
    return null;
  }

  const ttlHours = Math.max(1, Math.min(168, Number(hours) || 6));
  const expiryIso = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  const patch = {
    [`projectSettings.productionTempEdit.${uid}`]: expiryIso,
    [`productionTempEdit.${uid}`]: expiryIso,
    updatedAtIso: new Date().toISOString(),
  } as Record<string, unknown>;

  try {
    const topLevelRef = doc(db, "projects", project.id);
    const topLevelSnap = await getDoc(topLevelRef);
    if (topLevelSnap.exists()) {
      await updateDoc(topLevelRef, patch);
      return expiryIso;
    }
  } catch {
    // continue into nested company/jobs fallback
  }

  if (!project.companyId) {
    return null;
  }

  try {
    const jobsQ = query(
      collection(db, "companies", project.companyId, "jobs"),
      where("id", "==", project.id),
      limit(1),
    );
    const jobsSnap = await getDocs(jobsQ);
    if (jobsSnap.empty) {
      return null;
    }

    await updateDoc(jobsSnap.docs[0].ref, patch);
    return expiryIso;
  } catch {
    return null;
  }
}

export async function updateProjectPatch(
  project: Project,
  patch: Record<string, unknown>,
): Promise<boolean> {
  if (!db || !project) {
    return false;
  }

  const nextPatch: Record<string, unknown> = {
    ...patch,
    updatedAtIso: new Date().toISOString(),
  };

  try {
    const topLevelRef = doc(db, "projects", project.id);
    const topLevelSnap = await getDoc(topLevelRef);
    if (topLevelSnap.exists()) {
      await updateDoc(topLevelRef, nextPatch);
      return true;
    }
  } catch {
    // continue into nested company/jobs fallback
  }

  if (!project.companyId) {
    return false;
  }

  try {
    const jobsQ = query(
      collection(db, "companies", project.companyId, "jobs"),
      where("id", "==", project.id),
      limit(1),
    );
    const jobsSnap = await getDocs(jobsQ);
    if (jobsSnap.empty) {
      return false;
    }

    await updateDoc(jobsSnap.docs[0].ref, nextPatch);
    return true;
  } catch {
    return false;
  }
}

export async function fetchCompanyMembers(companyId: string): Promise<CompanyMemberOption[]> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) {
    return [];
  }

  try {
    const snap = await getDocs(collection(db, "companies", cid, "memberships"));
    const out: CompanyMemberOption[] = [];

    for (const docSnap of snap.docs) {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      const uid = String(data.uid ?? docSnap.id ?? "").trim();
      if (!uid) {
        continue;
      }
      const displayName = String(data.displayName ?? data.name ?? data.email ?? uid).trim() || uid;
      const role = String(data.roleId ?? data.role ?? "viewer").trim() || "viewer";
      const email = String(data.email ?? "").trim();
      const mobile = String(data.mobile ?? data.phone ?? "").trim();
      out.push({ uid, displayName, role, email, mobile });
    }

    out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return out;
  } catch {
    return [];
  }
}

export async function fetchCompanyDoc(companyId: string): Promise<Record<string, unknown> | null> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) {
    return null;
  }
  try {
    const snap = await getDoc(doc(db, "companies", cid));
    if (!snap.exists()) {
      return null;
    }
    return (snap.data() ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function saveCompanyDocPatch(
  companyId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const result = await saveCompanyDocPatchDetailed(companyId, patch);
  return result.ok;
}

export async function saveCompanyDocPatchDetailed(
  companyId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) {
    return { ok: false, error: "missing-firebase-or-company-id" };
  }
  try {
    await setDoc(
      doc(db, "companies", cid),
      {
        ...patch,
        updatedAt: serverTimestamp(),
        updatedAtIso: new Date().toISOString(),
      },
      { merge: true },
    );
    return { ok: true };
  } catch (error) {
    const fallback = "unknown-save-error";
    const msg =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? fallback)
        : String((error as { message?: unknown } | null)?.message ?? fallback);
    return { ok: false, error: msg };
  }
}

export async function fetchUserNotifications(uid: string): Promise<UserNotificationRow[]> {
  const userId = String(uid || "").trim();
  if (!db || !userId) {
    return [];
  }
  try {
    const snap = await getDocs(
      query(collection(db, "users", userId, "notifications"), orderBy("createdAt", "desc"), limit(200)),
    );
    return snap.docs.map((docSnap) => {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      return {
        id: String(data.id ?? docSnap.id),
        title: String(data.title ?? ""),
        message: String(data.message ?? ""),
        type: String(data.type ?? "info"),
        read: Boolean(data.read),
        createdAtIso: toIsoString(data.createdAtIso ?? data.createdAt, ""),
      };
    });
  } catch {
    return [];
  }
}

export async function setAllUserNotificationsRead(uid: string, read: boolean): Promise<boolean> {
  const userId = String(uid || "").trim();
  if (!db || !userId) {
    return false;
  }
  try {
    const snap = await getDocs(collection(db, "users", userId, "notifications"));
    const batch = writeBatch(db);
    for (const docSnap of snap.docs) {
      batch.update(docSnap.ref, { read: Boolean(read), updatedAt: serverTimestamp(), updatedAtIso: new Date().toISOString() });
    }
    await batch.commit();
    return true;
  } catch {
    return false;
  }
}
