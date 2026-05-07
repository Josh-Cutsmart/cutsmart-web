import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  documentId,
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
import { fetchCompanyAccess, type CompanyAccessInfo } from "@/lib/membership";
import { mockChanges, mockCutlists, mockProjects, mockQuotes } from "@/lib/mock-data";
import type { Cutlist, Project, ProjectChange, ProjectImageItem, SalesQuote } from "@/lib/types";
import type { UpdateChangelogEntry } from "@/lib/update-notes-utils";

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

function normalizeChangelogVersionId(version: string): string {
  return String(version || "").trim().toLowerCase();
}

function appChangelogVersionsCollectionRef() {
  return collection(db!, "Application", "changelog", "versions");
}

function appChangelogReportsCollectionRef() {
  return collection(db!, "Application", "changelog", "Reports");
}

function appChangelogSuggestedFeaturesCollectionRef() {
  return collection(db!, "Application", "changelog", "Suggested feature");
}

function appChangelogCollectionRefForKind(kind: AppReportKind) {
  return kind === "feature"
    ? appChangelogSuggestedFeaturesCollectionRef()
    : appChangelogReportsCollectionRef();
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readStringCandidate(value: unknown): string {
  if (value == null) return "";
  const text = String(value).trim();
  return text;
}

function pickFirstString(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = readStringCandidate(data[key]);
    if (value) return value;
  }
  return "";
}

function parseCutlistContainer(data: Record<string, unknown>): Record<string, unknown> | null {
  const rawCutlist = data.cutlist;
  const cutlistObj = rawCutlist && typeof rawCutlist === "object" ? { ...(rawCutlist as Record<string, unknown>) } : null;
  const cutlistRows = Array.isArray(cutlistObj?.rows) ? (cutlistObj?.rows as unknown[]) : [];

  const rawCutlistJson = data.cutlistJson;
  const cutlistJsonObj =
    rawCutlistJson && typeof rawCutlistJson === "object" ? { ...(rawCutlistJson as Record<string, unknown>) } : null;
  const cutlistJsonRows = Array.isArray(cutlistJsonObj?.rows) ? (cutlistJsonObj?.rows as unknown[]) : [];

  // Prefer non-empty row source. Legacy docs often keep stale empty `cutlist`
  // while live data is in `cutlistJson`.
  if (cutlistRows.length > 0) {
    return cutlistObj;
  }
  if (cutlistJsonRows.length > 0) {
    return cutlistJsonObj;
  }

  if (cutlistObj) {
    return cutlistObj;
  }
  if (cutlistJsonObj) {
    return cutlistJsonObj;
  }

  if (typeof rawCutlistJson === "string" && rawCutlistJson.trim()) {
    try {
      const parsed = JSON.parse(rawCutlistJson);
      if (Array.isArray(parsed)) {
        return { rows: parsed as unknown[] };
      }
      if (parsed && typeof parsed === "object") {
        return { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      // ignore invalid legacy cutlist json payload
    }
  }

  return null;
}

function parseCutlistRows(data: Record<string, unknown>): unknown[] {
  const container = parseCutlistContainer(data);
  if (!container) {
    return [];
  }
  return Array.isArray(container.rows) ? (container.rows as unknown[]) : [];
}

function normalizeProjectImageItems(value: unknown): ProjectImageItem[] {
  if (!Array.isArray(value)) return [];
  const items: ProjectImageItem[] = [];
  for (const item of value) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const url = String(row?.url ?? "").trim();
    if (!url) continue;
    const annotations = Array.isArray(row?.annotations)
      ? row.annotations
          .map((annotation) => {
            const next =
              annotation && typeof annotation === "object"
                ? (annotation as Record<string, unknown>)
                : null;
            const id = String(next?.id ?? "").trim();
            const note = String(next?.note ?? "").trim();
            const x = Number(next?.x);
            const y = Number(next?.y);
            if (!id || !note || !Number.isFinite(x) || !Number.isFinite(y)) return null;
            const xPx = Number(next?.xPx);
            const yPx = Number(next?.yPx);
            return {
              id,
              note,
              x: Math.min(100, Math.max(0, x)),
              y: Math.min(100, Math.max(0, y)),
              xPx: Number.isFinite(xPx) ? Math.max(0, xPx) : undefined,
              yPx: Number.isFinite(yPx) ? Math.max(0, yPx) : undefined,
              createdByName: String(next?.createdByName ?? "").trim(),
              createdByColor: String(next?.createdByColor ?? "").trim(),
            };
          })
          .filter(Boolean) as NonNullable<ProjectImageItem["annotations"]>
      : [];
    items.push({
      url,
      name: String(row?.name ?? "").trim(),
      annotations,
    });
    if (items.length >= 10) break;
  }
  return items;
}

function normalizeProject(id: string, data: Record<string, unknown>): Project {
  const rows = parseCutlistRows(data);
  const clientBlock =
    asRecord(data.clientDetails) ??
    asRecord(data.client) ??
    asRecord(data.general) ??
    asRecord(data.projectDetails) ??
    {};

  const settings =
    typeof data.projectSettings === "object" && data.projectSettings !== null
      ? ({ ...(data.projectSettings as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  if (!Object.keys(settings).length && typeof data.projectSettingsJson === "string" && data.projectSettingsJson.trim()) {
    try {
      const parsed = JSON.parse(data.projectSettingsJson);
      if (parsed && typeof parsed === "object") {
        Object.assign(settings, parsed as Record<string, unknown>);
      }
    } catch {
      // ignore legacy invalid json payload
    }
  }

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

  const customer = pickFirstString(data, ["customer", "clientName", "client", "client_name"]) ||
    pickFirstString(clientBlock, ["name", "clientName", "client", "customer"]);
  const clientPhone = pickFirstString(data, ["clientPhone", "clientNumber", "clientMobile", "phone"]) ||
    pickFirstString(clientBlock, ["phone", "mobile", "clientPhone", "clientNumber"]);
  const clientEmail = pickFirstString(data, ["clientEmail", "email"]) ||
    pickFirstString(clientBlock, ["email", "clientEmail"]);
  const clientAddress = pickFirstString(data, ["clientAddress", "projectAddress", "address"]) ||
    pickFirstString(clientBlock, ["address", "clientAddress", "projectAddress"]);
  const notes = pickFirstString(data, ["notes", "projectNotes", "description"]) ||
    pickFirstString(clientBlock, ["notes", "projectNotes", "description"]);
  const createdByName = pickFirstString(data, [
    "createdByName",
    "creatorName",
    "createdBy",
    "ownerName",
    "createdByDisplayName",
  ]);
  const projectImageItems = normalizeProjectImageItems(data.projectImageItems);
  const projectImages = Array.isArray(data.projectImages) ? data.projectImages.map(String).filter(Boolean) : [];

  return {
    id,
    companyId: String(data.companyId ?? ""),
    clientId: String(data.clientId ?? "").trim() || undefined,
    name: String(data.name ?? "Untitled Project"),
    customer: customer || "Unknown Customer",
    createdAt: toIsoString(data.createdAtIso ?? data.createdAt, new Date().toISOString()),
    createdByUid: String(data.createdByUid ?? data.ownerUid ?? ""),
    createdByName: createdByName || "Unknown",
    assignedToUid: pickFirstString(data, ["assignedToUid", "assignedUid", "projectAssignedUid"]) || undefined,
    assignedToName: pickFirstString(data, ["assignedToName", "assignedName", "projectAssignedName"]) || undefined,
    status: toProjectStatus(data.status),
    statusLabel: String(data.status ?? "New"),
    priority: (String(data.priority ?? "medium") as Project["priority"]),
    updatedAt: toIsoString(data.updatedAtIso ?? data.updatedAt, new Date().toISOString()),
    deletedAt: toIsoString(data.deletedAtIso ?? data.deletedAt, ""),
    dueDate: String(data.dueDate ?? data.due ?? ""),
    estimatedSheets: Number(data.estimatedSheets ?? rows.length ?? 0),
    assignedTo: String(
      data.assignedTo ??
        data.assignedToName ??
        data.assignedName ??
        "Unassigned",
    ),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    notes,
    clientPhone,
    clientEmail,
    clientAddress,
    region: String(data.region ?? ""),
    projectFiles: Array.isArray(data.projectFiles) ? (data.projectFiles as Array<Record<string, unknown>>) : [],
    projectImages: projectImages.length ? projectImages : projectImageItems.map((item) => item.url),
    projectImageItems,
    projectSettings: settings,
    cutlist: parseCutlistContainer(data) ?? undefined,
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

export async function updateCompanyProjectTagUsage(
  companyId: string,
  previousTags: string[],
  nextTags: string[],
): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!cid) return;
  await patchCompanyTagUsageByDelta(cid, normalizeTagList(previousTags), normalizeTagList(nextTags));
}

export async function resyncCompanyProjectTagUsage(companyId: string): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!cid) return;
  await syncCompanyProjectTagUsage(cid);
}

function normalizeJobProject(companyId: string, docSnap: QueryDocumentSnapshot): Project {
  const data = (docSnap.data() ?? {}) as Record<string, unknown>;
  const projectId = String(data.id ?? docSnap.id);
  const normalized = normalizeProject(projectId, data);
  normalized.companyId = companyId;
  return normalized;
}

function normalizeCompanyStaffDisplayNameOverrides(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [rawUid, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const uid = String(rawUid || "").trim();
    const name = String(rawValue ?? "").trim();
    if (uid && name) {
      out[uid] = name;
    }
  }
  return out;
}

function normalizeCompanyStaffRoleOverrides(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [rawUid, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const uid = String(rawUid || "").trim();
    const roleId = String(rawValue ?? "").trim().toLowerCase().replace(/\s+/g, "_");
    if (uid && roleId) {
      out[uid] = roleId;
    }
  }
  return out;
}

function applyCompanyStaffDisplayNameOverridesToProject(
  project: Project,
  displayNameOverridesByUid: Record<string, string>,
): Project {
  const createdByUid = String(project.createdByUid || "").trim();
  const assignedToUid = String(project.assignedToUid || "").trim();
  const createdByNameOverride = createdByUid ? displayNameOverridesByUid[createdByUid] : "";
  const assignedToNameOverride = assignedToUid ? displayNameOverridesByUid[assignedToUid] : "";
  if (!createdByNameOverride && !assignedToNameOverride) {
    return project;
  }
  return {
    ...project,
    createdByName: createdByNameOverride || project.createdByName,
    assignedToName: assignedToNameOverride || project.assignedToName,
    assignedTo: assignedToNameOverride || project.assignedTo,
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

  const ids = new Set<string>();

  // Primary desktop-compatible path: memberships doc id == uid.
  try {
    const byDocId = await getDocs(
      query(collectionGroup(db, "memberships"), where(documentId(), "==", uid), limit(100)),
    );
    for (const docSnap of byDocId.docs) {
      const parent = docSnap.ref.parent.parent;
      if (parent) ids.add(parent.id);
    }
  } catch {
    // continue
  }

  // Alternate shape: uid stored as field on membership doc.
  try {
    const snap = await getDocs(query(collectionGroup(db, "memberships"), where("uid", "==", uid), limit(100)));
    for (const docSnap of snap.docs) {
      const parent = docSnap.ref.parent.parent;
      if (parent) ids.add(parent.id);
    }
  } catch {
    // continue
  }

  // Alternate collection path: companies/{companyId}/members/{uid}
  try {
    const membersByDocId = await getDocs(
      query(collectionGroup(db, "members"), where(documentId(), "==", uid), limit(100)),
    );
    for (const docSnap of membersByDocId.docs) {
      const parent = docSnap.ref.parent.parent;
      if (parent) ids.add(parent.id);
    }
  } catch {
    // continue
  }

  // Profile fallback: users/{uid}.companyId / activeCompanyId
  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (userSnap.exists()) {
      const data = (userSnap.data() ?? {}) as Record<string, unknown>;
      const nestedCompany =
        typeof data.company === "object" && data.company !== null
          ? (data.company as Record<string, unknown>)
          : null;
      const companyId = String(
        data.companyId ??
          data.activeCompanyId ??
          nestedCompany?.id ??
          nestedCompany?.companyId ??
          "",
      ).trim();
      if (companyId) ids.add(companyId);
    }
  } catch {
    // ignore
  }

  return Array.from(ids);
}

async function fetchProjectsFromCompanyJobs(
  uid: string,
  includeDeleted = false,
  preferredCompanyIds?: string[],
): Promise<Project[]> {
  if (!db || !uid) {
    return [];
  }

  const companyIds = Array.from(
    new Set([
      ...(await fetchCompanyIdsForUser(uid)),
      ...((preferredCompanyIds ?? []).map((v) => String(v || "").trim()).filter(Boolean)),
    ]),
  );
  if (!companyIds.length) {
    return [];
  }

  const all: Project[] = [];
  for (const companyId of companyIds) {
    try {
      const companySnap = await getDoc(doc(db, "companies", companyId));
      const companyData = companySnap.exists() ? ((companySnap.data() ?? {}) as Record<string, unknown>) : {};
      const displayNameOverridesByUid = normalizeCompanyStaffDisplayNameOverrides(companyData.staffDisplayNamesByUid);
      const companyAccess = await fetchCompanyAccess(companyId, uid);
      const jobsSnap = await getDocs(collection(db, "companies", companyId, "jobs"));
      for (const item of jobsSnap.docs) {
        const data = (item.data() ?? {}) as Record<string, unknown>;
        if (Boolean(data.isDeleted) !== Boolean(includeDeleted)) {
          continue;
        }
        const normalized = applyCompanyStaffDisplayNameOverridesToProject(normalizeJobProject(companyId, item), displayNameOverridesByUid);
        if (!canUserViewProject(normalized, uid, companyAccess)) {
          continue;
        }
        all.push(normalized);
      }
    } catch {
      continue;
    }
  }

  all.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return all;
}

async function fetchProjectsFromLegacyUserPaths(uid: string, includeDeleted = false): Promise<Project[]> {
  if (!db || !uid) {
    return [];
  }

  const all: Project[] = [];

  // Legacy path: users/{uid}/projects
  try {
    const userProjects = await getDocs(collection(db, "users", uid, "projects"));
    for (const item of userProjects.docs) {
      const data = (item.data() ?? {}) as Record<string, unknown>;
      if (Boolean(data.isDeleted) !== Boolean(includeDeleted)) {
        continue;
      }
      const id = String(data.id ?? item.id);
      const normalized = normalizeProject(id, data);
      const companyId = String(normalized.companyId || "").trim();
      if (companyId) {
        try {
          const companyDoc = await fetchCompanyDoc(companyId);
          const displayNameOverridesByUid = normalizeCompanyStaffDisplayNameOverrides(
            (companyDoc as Record<string, unknown> | null)?.staffDisplayNamesByUid,
          );
          all.push(applyCompanyStaffDisplayNameOverridesToProject(normalized, displayNameOverridesByUid));
          continue;
        } catch {
          // fall through to unmodified row
        }
      }
      all.push(normalized);
    }
  } catch {
    // ignore
  }

  // Legacy path: companies/{companyId}/memberships/{uid}/projects
  try {
    const companyIds = await fetchCompanyIdsForUser(uid);
    for (const companyId of companyIds) {
      try {
        const companyDoc = await fetchCompanyDoc(companyId);
        const displayNameOverridesByUid = normalizeCompanyStaffDisplayNameOverrides(
          (companyDoc as Record<string, unknown> | null)?.staffDisplayNamesByUid,
        );
        const nested = await getDocs(
          collection(db, "companies", companyId, "memberships", uid, "projects"),
        );
        for (const item of nested.docs) {
          const data = (item.data() ?? {}) as Record<string, unknown>;
          if (Boolean(data.isDeleted) !== Boolean(includeDeleted)) {
            continue;
          }
          const id = String(data.id ?? item.id);
          const normalized = normalizeProject(id, data);
          normalized.companyId = companyId;
          all.push(applyCompanyStaffDisplayNameOverridesToProject(normalized, displayNameOverridesByUid));
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

export async function fetchProjects(uid?: string, preferredCompanyIds?: string[]): Promise<Project[]> {
  if (!db) {
    return mockProjects;
  }

  const userId = String(uid ?? "").trim();

  try {
    const topLevel = await getDocs(collection(db, "projects"));
    if (!topLevel.empty) {
      const rows = topLevel.docs.map((item) => normalizeProject(item.id, item.data() as Record<string, unknown>));
      const companyDocCache = new Map<string, Record<string, unknown> | null>();
      const companyAccessCache = new Map<string, CompanyAccessInfo | null>();
      return await Promise.all(
        rows.map(async (row) => {
          const companyId = String(row.companyId || "").trim();
          if (!companyId) return row;
          if (!companyDocCache.has(companyId)) {
            companyDocCache.set(companyId, await fetchCompanyDoc(companyId));
          }
          if (!companyAccessCache.has(companyId)) {
            companyAccessCache.set(companyId, userId ? await fetchCompanyAccess(companyId, userId) : null);
          }
          const displayNameOverridesByUid = normalizeCompanyStaffDisplayNameOverrides(
            (companyDocCache.get(companyId) as Record<string, unknown> | null)?.staffDisplayNamesByUid,
          );
          const normalized = applyCompanyStaffDisplayNameOverridesToProject(row, displayNameOverridesByUid);
          if (!canUserViewProject(normalized, userId, companyAccessCache.get(companyId) ?? null)) {
            return null;
          }
          return normalized;
        }),
      ).then((items) => items.filter(Boolean) as Project[]);
    }
  } catch {
    // continue into company/jobs fallback
  }

  const nested = await fetchProjectsFromCompanyJobs(String(uid ?? ""), false, preferredCompanyIds);
  if (nested.length > 0) {
    return nested;
  }

  const legacy = await fetchProjectsFromLegacyUserPaths(String(uid ?? ""));
  if (legacy.length > 0) {
    return legacy;
  }

  return hasFirebaseConfig ? [] : mockProjects;
}

export async function fetchProjectById(
  projectId: string,
  uid?: string,
  preferredCompanyIds?: string[],
): Promise<Project | null> {
  if (!db) {
    return mockProjects.find((project) => project.id === projectId) ?? null;
  }

  const userId = String(uid ?? "").trim();
  const companyIds = Array.from(
    new Set([
      ...((preferredCompanyIds ?? []).map((v) => String(v || "").trim()).filter(Boolean)),
      ...(userId ? await fetchCompanyIdsForUser(userId) : []),
    ]),
  );

  // Prefer company-scoped jobs first (source of truth for web/desktop parity).
  for (const companyId of companyIds) {
    try {
      const direct = await getDoc(doc(db, "companies", companyId, "jobs", projectId));
      if (direct.exists()) {
        const companyDoc = await fetchCompanyDoc(companyId);
        const companyAccess = userId ? await fetchCompanyAccess(companyId, userId) : null;
        const displayNameOverridesByUid = normalizeCompanyStaffDisplayNameOverrides(
          (companyDoc as Record<string, unknown> | null)?.staffDisplayNamesByUid,
        );
        const normalized = normalizeProject(projectId, direct.data() as Record<string, unknown>);
        normalized.companyId = companyId;
        const project = applyCompanyStaffDisplayNameOverridesToProject(normalized, displayNameOverridesByUid);
        return canUserViewProject(project, userId, companyAccess) ? project : null;
      }
    } catch {
      // continue
    }
  }

  const nested = await fetchProjectsFromCompanyJobs(userId, false, companyIds);
  const nestedHit = nested.find((project) => project.id === projectId) ?? null;
  if (nestedHit) {
    return nestedHit;
  }

  // Fallback to legacy top-level only if not found in company jobs.
  try {
    const ref = doc(db, "projects", projectId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const normalized = normalizeProject(snap.id, snap.data() as Record<string, unknown>);
      const companyId = String(normalized.companyId || "").trim();
      if (!companyId) {
        return canUserViewProject(normalized, userId, null) ? normalized : null;
      }
      const companyDoc = await fetchCompanyDoc(companyId);
      const companyAccess = userId ? await fetchCompanyAccess(companyId, userId) : null;
      const displayNameOverridesByUid = normalizeCompanyStaffDisplayNameOverrides(
        (companyDoc as Record<string, unknown> | null)?.staffDisplayNamesByUid,
      );
      const project = applyCompanyStaffDisplayNameOverridesToProject(normalized, displayNameOverridesByUid);
      return canUserViewProject(project, userId, companyAccess) ? project : null;
    }
  } catch {
    // continue
  }

  return null;
}

export async function fetchDeletedProjects(uid?: string, preferredCompanyIds?: string[]): Promise<Project[]> {
  if (!db) {
    return [];
  }

  const userId = String(uid ?? "").trim();

  const merged = new Map<string, Project>();
  const upsert = (items: Project[]) => {
    for (const item of items) {
      const key = `${String(item.companyId || "")}::${item.id}`;
      merged.set(key, item);
    }
  };

  try {
    const topLevel = await getDocs(collection(db, "projects"));
    if (!topLevel.empty) {
      const companyAccessCache = new Map<string, CompanyAccessInfo | null>();
      const topDeleted = await Promise.all(
        topLevel.docs
          .filter((item) => {
            const data = (item.data() ?? {}) as Record<string, unknown>;
            return Boolean(data.isDeleted);
          })
          .map(async (item) => {
            const normalized = normalizeProject(item.id, item.data() as Record<string, unknown>);
            const companyId = String(normalized.companyId || "").trim();
            if (!companyId) return normalized;
            if (!companyAccessCache.has(companyId)) {
              companyAccessCache.set(companyId, userId ? await fetchCompanyAccess(companyId, userId) : null);
            }
            const companyDoc = await fetchCompanyDoc(companyId);
            const displayNameOverridesByUid = normalizeCompanyStaffDisplayNameOverrides(
              (companyDoc as Record<string, unknown> | null)?.staffDisplayNamesByUid,
            );
            const project = applyCompanyStaffDisplayNameOverridesToProject(normalized, displayNameOverridesByUid);
            if (!canUserViewProject(project, userId, companyAccessCache.get(companyId) ?? null)) {
              return null;
            }
            return project;
          }),
      );
      upsert(topDeleted.filter(Boolean) as Project[]);
    }
  } catch {
    // continue into nested company/jobs fallback
  }

  const nested = await fetchProjectsFromCompanyJobs(String(uid ?? ""), true, preferredCompanyIds);
  upsert(nested);

  const legacy = await fetchProjectsFromLegacyUserPaths(String(uid ?? ""), true);
  upsert(legacy);

  return Array.from(merged.values()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
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

export async function fetchCutlists(
  projectId?: string,
  uid?: string,
  preferredCompanyIds?: string[],
): Promise<Cutlist[]> {
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

  const project = await fetchProjectById(projectId, uid, preferredCompanyIds);
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

      const rawRows = parseCutlistRows(data);

      const parts = rawRows.map((row, index) => {
        const item = (row ?? {}) as Record<string, unknown>;
        const clLong = String(item.clLong ?? item.clashLong ?? item.clash_left ?? "").trim();
        const clShort = String(item.clShort ?? item.clashShort ?? item.clash_right ?? "").trim();
        const clashing = String(item.Clashing ?? item.clashing ?? "").trim();
        const combinedClashing = clashing || [clLong, clShort].filter(Boolean).join(" ");
        return {
          id: String(item.id ?? `row_${index + 1}`),
          label: String(item.Name ?? item.name ?? item.partName ?? `Part ${index + 1}`),
          material: String(item.Board ?? item.board ?? item.material ?? "Unknown"),
          qty: Number(item.Quantity ?? item.qty ?? 1),
          length: Number(item.Height ?? item.height ?? item.length ?? 0),
          width: Number(item.Width ?? item.width ?? 0),
          edgeBanding: false,
          partType: String(item.partType ?? item["Part Type"] ?? item.Part ?? item.part ?? ""),
          room: String(item.room ?? item.Room ?? ""),
          depth: Number(item.depth ?? item.Depth ?? 0),
          clashing: combinedClashing,
          information: String(item.information ?? item.Information ?? item.info ?? ""),
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
  roleId?: string;
  email?: string;
  mobile?: string;
  userColor?: string;
  badgeColor?: string;
  membershipDisplayName?: string;
}

export interface UserNotificationRow {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAtIso: string;
}

export type AppReportKind = "issue" | "feature";

export interface AppReportRow {
  id: string;
  kind: AppReportKind;
  deviceType: "desktop" | "tablet" | "mobile" | "";
  subject: string;
  body: string;
  createdAtIso: string;
  appVersion: string;
  reporterEmail: string;
  reporterName: string;
  reporterUid: string;
  completed: boolean;
  completedAtIso: string;
}

function normalizeNameKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function titleCaseHandle(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function hasPermissionKey(permissionKeys: string[] | undefined, key: string): boolean {
  const target = String(key || "").trim().toLowerCase();
  if (!target) {
    return false;
  }
  return (permissionKeys ?? []).some((item) => {
    const normalized = String(item || "").trim().toLowerCase();
    return normalized === "company.*" || normalized === target;
  });
}

function projectPermissionLabelForUid(project: Project, uid: string): string {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) {
    return "";
  }
  const settings = (project.projectSettings ?? {}) as Record<string, unknown>;
  const candidateMaps = [
    settings.projectPermissionsByUid,
    settings.userAccessByUid,
    settings.memberAccessByUid,
  ];
  for (const rawMap of candidateMaps) {
    if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
      continue;
    }
    const rawValue = (rawMap as Record<string, unknown>)[cleanUid];
    const normalized = String(rawValue ?? "").trim().toLowerCase();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function canUserViewProject(project: Project, uid: string, companyAccess: CompanyAccessInfo | null): boolean {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) {
    return true;
  }
  const role = String(companyAccess?.role || "").trim().toLowerCase();
  const permissionKeys = companyAccess?.permissionKeys ?? [];
  if (role === "owner" || role === "admin") {
    return true;
  }
  if (hasPermissionKey(permissionKeys, "projects.edit.others")) {
    return true;
  }
  if (hasPermissionKey(permissionKeys, "projects.view.others")) {
    return true;
  }
  const createdByUid = String(project.createdByUid ?? "").trim();
  const assignedToUid = String(project.assignedToUid ?? "").trim();
  if (createdByUid === cleanUid || assignedToUid === cleanUid) {
    return true;
  }
  const directProjectPermission = projectPermissionLabelForUid(project, cleanUid);
  return directProjectPermission === "view" || directProjectPermission === "edit";
}

function isLikelyUneditedMembershipDisplayName(
  membershipDisplayName: string,
  email: string,
  uid: string,
  profileDisplayName: string,
): boolean {
  const current = normalizeNameKey(membershipDisplayName);
  if (!current) return true;
  if (profileDisplayName && current === normalizeNameKey(profileDisplayName)) {
    return true;
  }
  const emailLocal = String(email || "").trim().split("@")[0]?.trim() || "";
  const defaults = [emailLocal, titleCaseHandle(emailLocal), uid, titleCaseHandle(uid)];
  return defaults.some((candidate) => normalizeNameKey(candidate) === current);
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

  const nowIso = new Date().toISOString();
  const completedStatus = isCompletedClientProjectStatus(newStatus);
  const nextProjectSnapshot: Project = {
    ...project,
    statusLabel: newStatus,
    status: toProjectStatus(newStatus),
    updatedAt: nowIso,
  };

  try {
    const topLevelRef = doc(db, "projects", project.id);
    const topLevelSnap = await getDoc(topLevelRef);
    if (topLevelSnap.exists()) {
      await updateDoc(topLevelRef, {
        status: newStatus,
        updatedAtIso: nowIso,
      });
      if (normalizeClientEmail(project.clientEmail)) {
        await syncCompanyClientProfileFromProjectInternal(nextProjectSnapshot, {
          countCompletedProject: completedStatus,
          syncOnly: false,
        });
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
      status: newStatus,
      updatedAtIso: nowIso,
    });
    if (normalizeClientEmail(project.clientEmail)) {
      await syncCompanyClientProfileFromProjectInternal(nextProjectSnapshot, {
        countCompletedProject: completedStatus,
        syncOnly: false,
      });
    }
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
  const patch = {
    tags: cleanedTags,
    updatedAtIso: new Date().toISOString(),
  };

  let updated = false;

  if (project.companyId) {
    try {
      const directJobRef = doc(db, "companies", project.companyId, "jobs", project.id);
      const directJobSnap = await getDoc(directJobRef);
      if (directJobSnap.exists()) {
        await updateDoc(directJobRef, patch);
        updated = true;
      } else {
        const jobsQ = query(
          collection(db, "companies", project.companyId, "jobs"),
          where("id", "==", project.id),
          limit(1),
        );
        const jobsSnap = await getDocs(jobsQ);
        if (!jobsSnap.empty) {
          await updateDoc(jobsSnap.docs[0].ref, patch);
          updated = true;
        }
      }
      if (updated) {
        await patchCompanyTagUsageByDelta(project.companyId, previousCleaned, cleanedTags);
      }
    } catch {
      // keep trying top-level mirror/fallback
    }
  }

  try {
    const topLevelRef = doc(db, "projects", project.id);
    const topLevelSnap = await getDoc(topLevelRef);
    if (topLevelSnap.exists()) {
      await updateDoc(topLevelRef, patch);
      updated = true;
    }
  } catch {
    // ignore legacy mirror failure
  }

  return updated;
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

export async function restoreDeletedProject(project: Project): Promise<boolean> {
  if (!db || !project) {
    return false;
  }

  const patch = {
    isDeleted: false,
    deletedAtIso: "",
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

export async function permanentlyDeleteProject(project: Project): Promise<boolean> {
  if (!db || !project) {
    return false;
  }

  try {
    const topLevelRef = doc(db, "projects", project.id);
    const topLevelSnap = await getDoc(topLevelRef);
    if (topLevelSnap.exists()) {
      await deleteDoc(topLevelRef);
      return true;
    }
  } catch {
    // continue into nested company/jobs fallback
  }

  if (project.companyId) {
    try {
      const jobsQ = query(
        collection(db, "companies", project.companyId, "jobs"),
        where("id", "==", project.id),
        limit(1),
      );
      const jobsSnap = await getDocs(jobsQ);
      if (!jobsSnap.empty) {
        await deleteDoc(jobsSnap.docs[0].ref);
        return true;
      }
    } catch {
      // continue into legacy fallback
    }
  }

  try {
    const userProjectsSnap = await getDocs(query(collectionGroup(db, "projects"), where("id", "==", project.id)));
    for (const projectSnap of userProjectsSnap.docs) {
      await deleteDoc(projectSnap.ref);
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

export async function purgeExpiredDeletedProjects(uid?: string, preferredCompanyIds?: string[]): Promise<void> {
  if (!db) {
    return;
  }

  const rows = await fetchDeletedProjects(uid, preferredCompanyIds);
  if (!rows.length) {
    return;
  }

  const companyIds = Array.from(new Set(rows.map((row) => String(row.companyId || "").trim()).filter(Boolean)));
  const retentionByCompany: Record<string, number> = {};

  await Promise.all(
    companyIds.map(async (companyId) => {
      const companyDoc = await fetchCompanyDoc(companyId);
      const rawDays = Number((companyDoc as Record<string, unknown> | null)?.deletedRetentionDays ?? 90);
      retentionByCompany[companyId] = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 90;
    }),
  );

  const nowMs = Date.now();
  for (const project of rows) {
    const deletedAtIso = String(project.deletedAt || project.updatedAt || project.createdAt || "").trim();
    if (!deletedAtIso) {
      continue;
    }
    const deletedAtMs = new Date(deletedAtIso).getTime();
    if (!Number.isFinite(deletedAtMs)) {
      continue;
    }
    const retentionDays = retentionByCompany[String(project.companyId || "").trim()] ?? 90;
    const expiresAtMs = deletedAtMs + retentionDays * 24 * 60 * 60 * 1000;
    if (nowMs >= expiresAtMs) {
      await permanentlyDeleteProject(project);
    }
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
  const firestore = db;

  try {
    const [companySnap, snap] = await Promise.all([
      getDoc(doc(firestore, "companies", cid)),
      getDocs(collection(firestore, "companies", cid, "memberships")),
    ]);
    const companyData = companySnap.exists() ? ((companySnap.data() ?? {}) as Record<string, unknown>) : {};
    const displayNameOverridesByUid = normalizeCompanyStaffDisplayNameOverrides(companyData.staffDisplayNamesByUid);
    const roleOverridesByUid = normalizeCompanyStaffRoleOverrides(companyData.staffRoleIdsByUid);
    const out: CompanyMemberOption[] = [];

    for (const docSnap of snap.docs) {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      const uid = String(data.uid ?? docSnap.id ?? "").trim();
      if (!uid) {
        continue;
      }
      const membershipDisplayName = String(data.displayName ?? data.name ?? "").trim();
      const membershipRoleId = String(data.roleId ?? data.role ?? "").trim();
      const roleId = roleOverridesByUid[uid] || membershipRoleId;
      const email = String(data.email ?? "").trim();
      const mobile = String(data.mobile ?? data.phone ?? "").trim();
      const userColor = String(data.userColor ?? data.badgeColor ?? data.avatarColor ?? data.color ?? data.colour ?? "").trim();
      const badgeColor = String(data.badgeColor ?? data.userColor ?? data.avatarColor ?? data.color ?? data.colour ?? "").trim();
      const displayNameOverride = displayNameOverridesByUid[uid];
      out.push({
        uid,
        displayName: displayNameOverride || membershipDisplayName || email || uid,
        membershipDisplayName: membershipDisplayName || undefined,
        role: roleId,
        roleId: roleId || undefined,
        email,
        mobile,
        userColor: userColor || undefined,
        badgeColor: badgeColor || undefined,
      });
    }

    // Company membership displayName is the source of truth once set.
    // Only fall back to profile values when a legacy membership row has no name at all.
    await Promise.all(
      out.map(async (member) => {
        const uid = String(member.uid || "").trim();
        if (!uid) return;
        try {
          const userSnap = await getDoc(doc(firestore, "users", uid));
          if (!userSnap.exists()) return;
          const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
          const profileDisplayName = String(userData.displayName ?? userData.name ?? "").trim();
          const profileEmail = String(userData.email ?? "").trim();
          const profileMobile = String(userData.mobile ?? userData.phone ?? "").trim();
          const profileUserColor = String(
            userData.userColor ?? userData.badgeColor ?? userData.avatarColor ?? userData.color ?? userData.colour ?? "",
          ).trim();
          const profileBadgeColor = String(
            userData.badgeColor ?? userData.userColor ?? userData.avatarColor ?? userData.color ?? userData.colour ?? "",
          ).trim();
          if (!displayNameOverridesByUid[uid] && !member.membershipDisplayName && profileDisplayName) {
            member.displayName = profileDisplayName;
          }
          if (!member.email && profileEmail) member.email = profileEmail;
          if (!member.mobile && profileMobile) member.mobile = profileMobile;
          if (!member.userColor && profileUserColor) member.userColor = profileUserColor;
          if (!member.badgeColor && profileBadgeColor) member.badgeColor = profileBadgeColor;
        } catch {
          // ignore per-user profile lookup errors
        }
      }),
    );

    const resolvedColorMap = await fetchUserColorMapByUids(
      out.map((member) => String(member.uid || "").trim()).filter(Boolean),
      cid,
    );
    for (const member of out) {
      const resolved = String(resolvedColorMap[String(member.uid || "").trim()] || "").trim();
      if (!resolved) continue;
      member.badgeColor = resolved;
      member.userColor = resolved;
    }

    out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return out;
  } catch {
    return [];
  }
}

export async function saveCompanyMemberDisplayName(
  companyId: string,
  uid: string,
  displayName: string,
): Promise<{ ok: boolean; error?: string }> {
  const cid = String(companyId || "").trim();
  const userId = String(uid || "").trim();
  const nextDisplayName = String(displayName || "").trim();
  if (!db || !cid || !userId) {
    return { ok: false, error: "missing-firebase-company-or-user-id" };
  }
  if (!nextDisplayName) {
    return { ok: false, error: "display-name-empty" };
  }

  const patch: Record<string, unknown> = {
    staffDisplayNamesByUid: {
      [userId]: nextDisplayName,
    },
    updatedAt: serverTimestamp(),
    updatedAtIso: new Date().toISOString(),
  };

  try {
    await setDoc(doc(db, "companies", cid), patch, { merge: true });
    return { ok: true };
  } catch (error) {
    const message =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "company-display-name-write-failed")
        : String((error as { message?: unknown } | null)?.message ?? "company-display-name-write-failed");
    return { ok: false, error: message };
  }
}

export async function saveCompanyMemberRole(
  companyId: string,
  uid: string,
  roleId: string,
  permissionKeys: string[],
): Promise<{ ok: boolean; error?: string }> {
  const cid = String(companyId || "").trim();
  const userId = String(uid || "").trim();
  const nextRoleId = String(roleId || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (!db || !cid || !userId) {
    return { ok: false, error: "missing-firebase-company-or-user-id" };
  }
  if (!nextRoleId) {
    return { ok: false, error: "role-empty" };
  }

  const patch = {
    staffRoleIdsByUid: {
      [userId]: nextRoleId,
    },
    updatedAt: serverTimestamp(),
    updatedAtIso: new Date().toISOString(),
  };

  try {
    await setDoc(doc(db, "companies", cid), patch, { merge: true });
    return { ok: true };
  } catch (error) {
    const message =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "company-role-write-failed")
        : String((error as { message?: unknown } | null)?.message ?? "company-role-write-failed");
    return { ok: false, error: message };
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

export async function fetchAppChangelogHistory(): Promise<UpdateChangelogEntry[]> {
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/changelog?type=versions", { cache: "no-store" });
      if (res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { ok?: boolean; entries?: UpdateChangelogEntry[] }
          | null;
        if (payload?.ok && Array.isArray(payload.entries)) {
          return payload.entries;
        }
      }
    } catch {
      // fall back to direct client firestore below
    }
  }
  if (!db) {
    return [];
  }
  try {
    const snap = await getDocs(query(appChangelogVersionsCollectionRef(), orderBy("capturedAtIso", "desc"), limit(500)));
    const rows = snap.docs
      .map((docSnap) => {
        const data = (docSnap.data() ?? {}) as Record<string, unknown>;
        return {
          version: String(data.version || "").trim(),
          whatsNew: String(data.whatsNew || ""),
          capturedAtIso: String(data.capturedAtIso || ""),
        } as UpdateChangelogEntry;
      })
      .filter((row) => row.version);
    if (rows.length) {
      return rows;
    }
    const legacySnap = await getDocs(query(collection(db, "appChangelogVersions"), orderBy("capturedAtIso", "desc"), limit(500)));
    const legacyRows = legacySnap.docs
      .map((docSnap) => {
        const data = (docSnap.data() ?? {}) as Record<string, unknown>;
        return {
          version: String(data.version || "").trim(),
          whatsNew: String(data.whatsNew || ""),
          capturedAtIso: String(data.capturedAtIso || ""),
        } as UpdateChangelogEntry;
      })
      .filter((row) => row.version);
    if (legacyRows.length) {
      await syncAppChangelogHistory(legacyRows);
    }
    return legacyRows;
  } catch {
    return [];
  }
}

export async function upsertAppChangelogVersion(entry: UpdateChangelogEntry): Promise<boolean> {
  const version = String(entry.version || "").trim();
  if (!db || !version) {
    return false;
  }
  try {
    const ref = doc(appChangelogVersionsCollectionRef(), normalizeChangelogVersionId(version));
    await setDoc(
      ref,
      {
        id: normalizeChangelogVersionId(version),
        version,
        whatsNew: String(entry.whatsNew || ""),
        capturedAtIso: String(entry.capturedAtIso || "") || new Date().toISOString(),
        updatedAt: serverTimestamp(),
        updatedAtIso: new Date().toISOString(),
      },
      { merge: true },
    );
    return true;
  } catch {
    return false;
  }
}

export async function syncAppChangelogHistory(entries: UpdateChangelogEntry[]): Promise<boolean> {
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/changelog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "sync-versions",
          entries,
        }),
      });
      if (res.ok) {
        const payload = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (payload?.ok) {
          return true;
        }
      }
    } catch {
      // fall back to direct client firestore below
    }
  }
  if (!db || !Array.isArray(entries) || entries.length === 0) {
    return false;
  }
  let didWrite = false;
  for (const entry of entries) {
    const ok = await upsertAppChangelogVersion(entry);
    if (ok) {
      didWrite = true;
    }
  }
  return didWrite;
}

export type CompanyClientProjectHistoryRow = {
  projectId: string;
  projectName: string;
  createdAtIso: string;
  updatedAtIso: string;
  statusLabel: string;
  customer: string;
  clientEmail: string;
  clientPhone: string;
  clientAddress: string;
};

export type CompanyClientRow = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  emailNormalized: string;
  phone: string;
  address: string;
  notes: string;
  createdAtIso: string;
  updatedAtIso: string;
  firstProjectAtIso: string;
  lastProjectAtIso: string;
  lastProjectId: string;
  projectCount: number;
  history: CompanyClientProjectHistoryRow[];
};

function toCompanyClientSummaryRow(row: CompanyClientRow): CompanyClientRow {
  return {
    ...row,
    history: [],
  };
}

function mergeCompanyClientRows(
  existing: CompanyClientRow | undefined,
  next: CompanyClientRow,
): CompanyClientRow {
  if (!existing) return next;
  const historyByProjectId = new Map<string, CompanyClientProjectHistoryRow>();
  [...existing.history, ...next.history].forEach((row) => {
    const key = String(row.projectId || "").trim();
    if (!key) return;
    const previous = historyByProjectId.get(key);
    if (!previous) {
      historyByProjectId.set(key, row);
      return;
    }
    const prevStamp = Date.parse(previous.updatedAtIso || previous.createdAtIso || "");
    const nextStamp = Date.parse(row.updatedAtIso || row.createdAtIso || "");
    if (nextStamp >= prevStamp) {
      historyByProjectId.set(key, row);
    }
  });
  const mergedHistory = Array.from(historyByProjectId.values()).sort(
    (a, b) => Date.parse(b.updatedAtIso || b.createdAtIso || "") - Date.parse(a.updatedAtIso || a.createdAtIso || ""),
  );
  return {
    ...existing,
    ...next,
    id: existing.id || next.id,
    companyId: existing.companyId || next.companyId,
    name: existing.name || next.name,
    email: existing.email || next.email,
    emailNormalized: existing.emailNormalized || next.emailNormalized,
    phone: existing.phone || next.phone,
    address: existing.address || next.address,
    notes: next.notes || existing.notes,
    createdAtIso: existing.createdAtIso || next.createdAtIso,
    updatedAtIso: pickLaterIso(existing.updatedAtIso, next.updatedAtIso),
    firstProjectAtIso: pickEarlierIso(existing.firstProjectAtIso, next.firstProjectAtIso),
    lastProjectAtIso: pickLaterIso(existing.lastProjectAtIso, next.lastProjectAtIso),
    lastProjectId: next.lastProjectId || existing.lastProjectId,
    projectCount: Math.max(existing.projectCount, next.projectCount, mergedHistory.length),
    history: mergedHistory,
  };
}

export function normalizeClientEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeClientPhone(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\D+/g, "");
}

function normalizeClientNameKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeClientAddressKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isCompletedClientProjectStatus(value: unknown): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return normalized === "complete" || normalized === "completed";
}

function buildCompanyClientIdFromEmail(emailNormalized: string): string {
  const safe = String(emailNormalized || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `client_${safe || "unknown"}`;
}

function buildCompanyClientMatchKeyFromProject(project: Project): string {
  const emailNormalized = normalizeClientEmail(project.clientEmail);
  if (emailNormalized) {
    return buildCompanyClientIdFromEmail(emailNormalized);
  }
  const phoneNormalized = normalizeClientPhone(project.clientPhone);
  if (phoneNormalized) {
    return `client_phone_${phoneNormalized}`;
  }
  const nameKey = normalizeClientNameKey(project.customer);
  const addressKey = normalizeClientAddressKey(project.clientAddress);
  if (nameKey && addressKey) {
    return `client_${nameKey}_${addressKey}`;
  }
  if (nameKey) {
    return `client_${nameKey}`;
  }
  return `client_${String(project.id || "unknown").trim().toLowerCase()}`;
}

function createCompanyClientUid(): string {
  return `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildCompanyClientProjectHistory(project: Project): CompanyClientProjectHistoryRow {
  return {
    projectId: String(project.id || "").trim(),
    projectName: String(project.name || "").trim() || "Untitled Project",
    createdAtIso: String(project.createdAt || "").trim(),
    updatedAtIso: String(project.updatedAt || project.createdAt || "").trim(),
    statusLabel: String(project.statusLabel || project.status || "").trim() || "New",
    customer: String(project.customer || "").trim(),
    clientEmail: String(project.clientEmail || "").trim(),
    clientPhone: String(project.clientPhone || "").trim(),
    clientAddress: String(project.clientAddress || "").trim(),
  };
}

function buildCompanyClientRowFromProject(project: Project): CompanyClientRow {
  const emailNormalized = normalizeClientEmail(project.clientEmail);
  const historyRow = buildCompanyClientProjectHistory(project);
  return {
    id: String(project.clientId || buildCompanyClientMatchKeyFromProject(project)).trim(),
    companyId: String(project.companyId || "").trim(),
    name: String(project.customer || "").trim(),
    email: String(project.clientEmail || "").trim(),
    emailNormalized,
    phone: String(project.clientPhone || "").trim(),
    address: String(project.clientAddress || "").trim(),
    notes: String(project.notes || "").trim(),
    createdAtIso: String(project.createdAt || project.updatedAt || "").trim(),
    updatedAtIso: String(project.updatedAt || project.createdAt || "").trim(),
    firstProjectAtIso: String(project.createdAt || project.updatedAt || "").trim(),
    lastProjectAtIso: String(project.updatedAt || project.createdAt || "").trim(),
    lastProjectId: String(project.id || "").trim(),
    projectCount: 1,
    history: [historyRow],
  };
}

function projectMatchesClientRow(project: Project, row: CompanyClientRow): boolean {
  const projectEmail = normalizeClientEmail(project.clientEmail);
  const rowEmail = normalizeClientEmail(row.emailNormalized || row.email);
  if (projectEmail && rowEmail) {
    return projectEmail === rowEmail;
  }

  const projectPhone = normalizeClientPhone(project.clientPhone);
  const rowPhone = normalizeClientPhone(row.phone);
  if (projectPhone && rowPhone) {
    return projectPhone === rowPhone;
  }

  const projectName = normalizeClientNameKey(project.customer);
  const rowName = normalizeClientNameKey(row.name);
  const projectAddress = normalizeClientAddressKey(project.clientAddress);
  const rowAddress = normalizeClientAddressKey(row.address);
  if (projectName && rowName && projectAddress && rowAddress) {
    return projectName === rowName && projectAddress === rowAddress;
  }
  if (projectName && rowName) {
    return projectName === rowName;
  }
  return false;
}

async function findMatchingCompanyClientRow(companyId: string, project: Project): Promise<CompanyClientRow | null> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) return null;
  try {
    const snap = await getDocs(collection(db, "companies", cid, "clients"));
    for (const docSnap of snap.docs) {
      if (docSnap.id === "__meta") continue;
      const row = buildCompanyClientRowFromDoc(cid, docSnap.id, (docSnap.data() ?? {}) as Record<string, unknown>);
      if (projectMatchesClientRow(project, row)) {
        return row;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function findMatchingClientIdInMap(
  merged: Map<string, CompanyClientRow>,
  project: Project,
): string | null {
  for (const [rowId, row] of merged.entries()) {
    if (projectMatchesClientRow(project, row)) {
      return rowId;
    }
  }
  return null;
}

function pickEarlierIso(...values: Array<string | undefined>): string {
  const valid = values
    .map((value) => String(value || "").trim())
    .filter((value) => value && Number.isFinite(Date.parse(value)));
  if (!valid.length) return "";
  return valid.sort((a, b) => Date.parse(a) - Date.parse(b))[0] || "";
}

function pickLaterIso(...values: Array<string | undefined>): string {
  const valid = values
    .map((value) => String(value || "").trim())
    .filter((value) => value && Number.isFinite(Date.parse(value)));
  if (!valid.length) return "";
  return valid.sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
}

function buildCompanyClientRowFromDoc(
  companyId: string,
  id: string,
  data: Record<string, unknown>,
): CompanyClientRow {
  const rawHistory = Array.isArray(data.history) ? (data.history as Record<string, unknown>[]) : [];
  return {
    id: String(id || "").trim(),
    companyId: String(companyId || "").trim(),
    name: String(data.name ?? data.customer ?? "").trim(),
    email: String(data.email ?? "").trim(),
    emailNormalized: normalizeClientEmail(data.emailNormalized ?? data.email),
    phone: String(data.phone ?? data.clientPhone ?? "").trim(),
    address: String(data.address ?? data.clientAddress ?? "").trim(),
    notes: String(data.notes ?? "").trim(),
    createdAtIso: toIsoString(data.createdAtIso ?? data.createdAt, ""),
    updatedAtIso: toIsoString(data.updatedAtIso ?? data.updatedAt, ""),
    firstProjectAtIso: toIsoString(data.firstProjectAtIso ?? data.firstProjectAt, ""),
    lastProjectAtIso: toIsoString(data.lastProjectAtIso ?? data.lastProjectAt, ""),
    lastProjectId: String(data.lastProjectId ?? "").trim(),
    projectCount: Number(data.projectCount ?? 0) || 0,
    history: rawHistory.map((row) => ({
      projectId: String(row.projectId ?? "").trim(),
      projectName: String(row.projectName ?? "").trim(),
      createdAtIso: toIsoString(row.createdAtIso ?? row.createdAt, ""),
      updatedAtIso: toIsoString(row.updatedAtIso ?? row.updatedAt, ""),
      statusLabel: String(row.statusLabel ?? "").trim(),
      customer: String(row.customer ?? "").trim(),
      clientEmail: String(row.clientEmail ?? "").trim(),
      clientPhone: String(row.clientPhone ?? "").trim(),
      clientAddress: String(row.clientAddress ?? "").trim(),
    })),
  };
}

async function ensureCompanyClientsSection(companyId: string): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) return;
  const nowIso = new Date().toISOString();
  await setDoc(
    doc(db, "companies", cid, "clients", "__meta"),
    {
      id: "__meta",
      companyId: cid,
      type: "clients-meta",
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso,
      createdAt: serverTimestamp(),
      createdAtIso: nowIso,
    },
    { merge: true },
  );
}

async function collectCompanyProjectsForClients(companyId: string): Promise<Project[]> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) return [];
  const projectDocsById = new Map<string, Record<string, unknown>>();

  try {
    const jobsSnap = await getDocs(collection(db, "companies", cid, "jobs"));
    for (const docSnap of jobsSnap.docs) {
      projectDocsById.set(String(docSnap.id || "").trim(), (docSnap.data() ?? {}) as Record<string, unknown>);
    }
  } catch {
    // Keep going so client rows can still derive from any other available project source.
  }

  try {
    const topLevelProjectsSnap = await getDocs(query(collection(db, "projects"), where("companyId", "==", cid), limit(500)));
    for (const docSnap of topLevelProjectsSnap.docs) {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      const projectId = String(data.id ?? docSnap.id).trim();
      if (!projectId || projectDocsById.has(projectId)) continue;
      projectDocsById.set(projectId, data);
    }
  } catch {
    // Legacy mirror only. Company jobs should still be enough to populate Clients.
  }

  const projects: Project[] = [];
  for (const [docId, rawData] of projectDocsById.entries()) {
    const project = normalizeProject(docId, rawData);
    project.companyId = cid;
    if (
      !normalizeClientEmail(project.clientEmail) &&
      !normalizeClientPhone(project.clientPhone) &&
      !String(project.customer || "").trim()
    ) {
      continue;
    }
    projects.push(project);
  }
  return projects;
}

async function syncCompanyClientProfileFromProjectInternal(
  project: Project,
  options?: { countCompletedProject?: boolean; syncOnly?: boolean },
): Promise<{ ok: boolean; clientId?: string }> {
  const cid = String(project?.companyId || "").trim();
  const email = String(project?.clientEmail || "").trim();
  const emailNormalized = normalizeClientEmail(email);
  const phoneNormalized = normalizeClientPhone(project?.clientPhone);
  const customerName = String(project?.customer || "").trim();
  if (!db || !cid || (!emailNormalized && !phoneNormalized && !customerName)) {
    return { ok: false };
  }

    const nowIso = new Date().toISOString();

    try {
      await ensureCompanyClientsSection(cid);
      const matchedRow =
        String(project.clientId || "").trim()
          ? null
          : await findMatchingCompanyClientRow(cid, project);
      const clientId = String(project.clientId || matchedRow?.id || createCompanyClientUid()).trim();
      const clientRef = doc(db, "companies", cid, "clients", clientId);
      const existingSnap = await getDoc(clientRef);
      const existing = existingSnap.exists() ? ((existingSnap.data() ?? {}) as Record<string, unknown>) : null;
      const currentRow = existing
        ? buildCompanyClientRowFromDoc(cid, clientId, existing)
        : matchedRow;
    const currentHistory = currentRow?.history.slice() ?? [];
    const currentCompletedIds = Array.isArray(existing?.completedProjectIds)
      ? (existing?.completedProjectIds as unknown[]).map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    const shouldCountCompletedProject =
      Boolean(options?.countCompletedProject) && isCompletedClientProjectStatus(project.statusLabel || project.status);
    if (
      shouldCountCompletedProject &&
      String(project.id || "").trim() &&
      !currentCompletedIds.includes(String(project.id || "").trim())
    ) {
      currentCompletedIds.push(String(project.id || "").trim());
      currentHistory.push(buildCompanyClientProjectHistory(project));
    }

    const sortedHistory = currentHistory
      .slice()
      .sort((a, b) => Date.parse(b.updatedAtIso || b.createdAtIso || "") - Date.parse(a.updatedAtIso || a.createdAtIso || ""));
    const oldestHistory = currentHistory
      .slice()
      .sort((a, b) => Date.parse(a.updatedAtIso || a.createdAtIso || "") - Date.parse(b.updatedAtIso || b.createdAtIso || ""))[0];
    const latestHistory = sortedHistory[0];
    const projectCreatedIso = String(project.createdAt || project.updatedAt || "").trim();
    const projectUpdatedIso = String(project.updatedAt || project.createdAt || "").trim();
    const payload: Record<string, unknown> = {
      id: clientId,
      companyId: cid,
      name: String(project.customer || currentRow?.name || "").trim(),
      email: emailNormalized || email,
      emailNormalized,
      phone: String(project.clientPhone || currentRow?.phone || "").trim(),
      address: String(project.clientAddress || currentRow?.address || "").trim(),
      notes: String(currentRow?.notes || "").trim(),
      createdAt: existing ? (existing.createdAt ?? serverTimestamp()) : serverTimestamp(),
      createdAtIso: currentRow?.createdAtIso || nowIso,
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso,
      firstProjectAtIso: pickEarlierIso(
        oldestHistory?.createdAtIso,
        oldestHistory?.updatedAtIso,
        currentRow?.firstProjectAtIso,
        projectCreatedIso,
      ),
      lastProjectAtIso: pickLaterIso(
        projectUpdatedIso,
        latestHistory?.updatedAtIso,
        latestHistory?.createdAtIso,
        currentRow?.lastProjectAtIso,
      ),
      lastProjectId: String(project.id || "").trim() || latestHistory?.projectId || currentRow?.lastProjectId || "",
      projectCount: currentCompletedIds.length,
      completedProjectIds: currentCompletedIds,
      history: sortedHistory,
    };
    await setDoc(clientRef, payload, { merge: true });
    if (!options?.syncOnly && String(project.clientId || "").trim() !== clientId) {
      await updateProjectPatch(project, { clientId });
    }
    return { ok: true, clientId };
  } catch {
    return { ok: false };
  }
}

async function backfillCompanyClientsFromProjects(companyId: string): Promise<void> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) return;
  try {
    await ensureCompanyClientsSection(cid);
    const projects = await collectCompanyProjectsForClients(cid);
    for (const project of projects) {
      await syncCompanyClientProfileFromProjectInternal(project, {
        countCompletedProject: isCompletedClientProjectStatus(project.statusLabel || project.status),
        syncOnly: true,
      });
    }
  } catch {
    // ignore client backfill errors
  }
}

export async function fetchCompanyClients(companyId: string): Promise<CompanyClientRow[]> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) return [];

  const merged = new Map<string, CompanyClientRow>();

  try {
    const clientsSnap = await getDocs(collection(db, "companies", cid, "clients"));
    const persistedRows = clientsSnap.docs
      .map((docSnap) => buildCompanyClientRowFromDoc(cid, docSnap.id, (docSnap.data() ?? {}) as Record<string, unknown>))
      .filter((row) => row.id && row.id !== "__meta");
    for (const row of persistedRows) {
      merged.set(row.id, row);
    }
  } catch {
    // continue into project-derived merge
  }

  try {
    const projects = await collectCompanyProjectsForClients(cid);
    for (const project of projects) {
      const derived = buildCompanyClientRowFromProject(project);
      const matchId = findMatchingClientIdInMap(merged, project) || derived.id;
      merged.set(matchId, mergeCompanyClientRows(merged.get(matchId), { ...derived, id: matchId }));
    }
  } catch {
    // ignore
  }

  try {
    void backfillCompanyClientsFromProjects(cid);
  } catch {
    // background backfill only
  }

  return Array.from(merged.values()).sort((a, b) => {
    const aName = String(a.name || a.email).trim().toLowerCase();
    const bName = String(b.name || b.email).trim().toLowerCase();
    return aName.localeCompare(bName);
  });
}

export async function fetchCompanyClientById(companyId: string, clientId: string): Promise<CompanyClientRow | null> {
  const cid = String(companyId || "").trim();
  const id = String(clientId || "").trim();
  if (!db || !cid || !id) return null;
  try {
    const snap = await getDoc(doc(db, "companies", cid, "clients", id));
    if (snap.exists()) {
      return buildCompanyClientRowFromDoc(cid, snap.id, (snap.data() ?? {}) as Record<string, unknown>);
    }
    const projects = await collectCompanyProjectsForClients(cid);
    const merged = new Map<string, CompanyClientRow>();
    for (const project of projects) {
      const derived = buildCompanyClientRowFromProject(project);
      const matchId = findMatchingClientIdInMap(merged, project) || derived.id;
      merged.set(matchId, mergeCompanyClientRows(merged.get(matchId), { ...derived, id: matchId }));
    }
    return merged.get(id) ?? null;
  } catch {
    return null;
  }
}

export async function syncCompanyClientProfileFromProject(
  project: Project,
): Promise<{ ok: boolean; clientId?: string }> {
  return syncCompanyClientProfileFromProjectInternal(project, { syncOnly: false });
}

export async function upsertCompanyClientProfileOnProjectCreate(input: {
  companyId: string;
  projectId: string;
  projectName: string;
  customer: string;
  clientEmail?: string;
  clientPhone?: string;
  clientAddress?: string;
  notes?: string;
  createdAtIso: string;
  updatedAtIso?: string;
  statusLabel?: string;
  createdByUid?: string;
  createdByName?: string;
  assignedToUid?: string;
  assignedToName?: string;
  assignedTo?: string;
  tags?: string[];
  projectImages?: string[];
  projectImageItems?: ProjectImageItem[];
  projectFiles?: Array<Record<string, unknown>>;
  projectSettings?: Record<string, unknown>;
}): Promise<{ ok: boolean; clientId?: string }> {
  const projectLike: Project = {
    id: String(input.projectId || "").trim(),
    companyId: String(input.companyId || "").trim(),
    name: String(input.projectName || "").trim() || "Untitled Project",
    customer: String(input.customer || "").trim(),
    createdAt: String(input.createdAtIso || "").trim(),
    createdByUid: String(input.createdByUid || "").trim(),
    createdByName: String(input.createdByName || "").trim() || "Unknown",
    assignedToUid: String(input.assignedToUid || "").trim() || undefined,
    assignedToName: String(input.assignedToName || "").trim() || undefined,
    assignedTo: String(input.assignedTo || "").trim() || "Unassigned",
    status: "draft",
    statusLabel: String(input.statusLabel || "").trim() || "New",
    priority: "medium",
    updatedAt: String(input.updatedAtIso || input.createdAtIso || "").trim(),
    deletedAt: "",
    dueDate: "",
    estimatedSheets: 0,
    tags: Array.isArray(input.tags) ? input.tags.map((item) => String(item || "").trim()).filter(Boolean) : [],
    notes: String(input.notes || "").trim(),
    clientPhone: String(input.clientPhone || "").trim(),
    clientEmail: String(input.clientEmail || "").trim(),
    clientAddress: String(input.clientAddress || "").trim(),
    region: "",
    projectFiles: Array.isArray(input.projectFiles) ? input.projectFiles : [],
    projectImages: Array.isArray(input.projectImages) ? input.projectImages.map(String) : [],
    projectImageItems: Array.isArray(input.projectImageItems) ? input.projectImageItems : [],
    projectSettings:
      input.projectSettings && typeof input.projectSettings === "object"
        ? input.projectSettings
        : {},
    cutlist: { rows: [] },
  };

  return syncCompanyClientProfileFromProjectInternal(projectLike, { syncOnly: true });
}

export type LeadImageAnnotation = {
  id: string;
  x: number;
  y: number;
  xPx?: number;
  yPx?: number;
  note: string;
  createdByName?: string;
  createdByColor?: string;
};

export type LeadImageItem = {
  url: string;
  name: string;
  annotations?: LeadImageAnnotation[];
};

export type CompanyLeadRow = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  formName: string;
  submittedAtIso: string;
  createdAtIso: string;
  updatedAtIso?: string;
  deletedAtIso?: string;
  isDeleted?: boolean;
  source: string;
  status: string;
  assignedToUid?: string;
  assignedToName?: string;
  assignedTo?: string;
  imageItems?: LeadImageItem[];
  imageUrls?: string[];
  rawFields?: Record<string, unknown>;
};

function normalizeLeadImageItems(value: unknown): LeadImageItem[] {
  if (!Array.isArray(value)) return [];
  const items: LeadImageItem[] = [];
  for (const item of value) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const url = String(row?.url ?? "").trim();
    const name = String(row?.name ?? "").trim();
    const annotations: LeadImageAnnotation[] = [];
    if (Array.isArray(row?.annotations)) {
      for (const annotation of row.annotations) {
        const next =
          annotation && typeof annotation === "object"
            ? (annotation as Record<string, unknown>)
            : null;
        const id = String(next?.id ?? "").trim();
        const note = String(next?.note ?? "").trim();
        const x = Number(next?.x);
        const y = Number(next?.y);
        const xPx = Number(next?.xPx);
        const yPx = Number(next?.yPx);
        if (!id || !note || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        annotations.push({
          id,
          note,
          x: Math.min(100, Math.max(0, x)),
          y: Math.min(100, Math.max(0, y)),
          xPx: Number.isFinite(xPx) ? Math.max(0, xPx) : undefined,
          yPx: Number.isFinite(yPx) ? Math.max(0, yPx) : undefined,
          createdByName: String(next?.createdByName ?? "").trim(),
          createdByColor: String(next?.createdByColor ?? "").trim(),
        });
      }
    }
    if (!url) continue;
    items.push({ url, name, annotations });
    if (items.length >= 10) break;
  }
  return items;
}

function normalizeLeadStatus(value: unknown): CompanyLeadRow["status"] {
  const raw = String(value ?? "").trim();
  const normalized = raw.toLowerCase();
  if (!raw) return "New";
  if (normalized === "new") return "New";
  if (normalized === "contacted") return "Contacted";
  if (normalized === "qualified") return "Qualified";
  if (normalized === "converted") return "Converted";
  if (normalized === "archived") return "Archived";
  return raw;
}

export async function fetchCompanyLeads(companyId: string): Promise<CompanyLeadRow[]> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) return [];
  try {
    const snap = await getDocs(
      query(collection(db, "companies", cid, "leads"), orderBy("createdAt", "desc"), limit(500)),
    );
    return snap.docs.map((docSnap) => {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      const imageItems = normalizeLeadImageItems(data.imageItems);
      return {
        id: String(data.id ?? docSnap.id),
        companyId: cid,
        name: String(data.name ?? "").trim(),
        email: String(data.email ?? "").trim(),
        phone: String(data.phone ?? "").trim(),
        message: String(data.message ?? "").trim(),
        formName: String(data.formName ?? "").trim(),
        submittedAtIso: toIsoString(data.submittedAtIso ?? data.submittedAt, ""),
        createdAtIso: toIsoString(data.createdAtIso ?? data.createdAt, ""),
        updatedAtIso: toIsoString(data.updatedAtIso ?? data.updatedAt, ""),
        deletedAtIso: toIsoString(data.deletedAtIso ?? data.deletedAt, ""),
        isDeleted: Boolean(data.isDeleted),
        source: String(data.source ?? "").trim() || "zapier-form",
        status: normalizeLeadStatus(data.status),
        assignedToUid: String(data.assignedToUid ?? "").trim() || undefined,
        assignedToName: String(data.assignedToName ?? data.assignedTo ?? "").trim() || undefined,
        assignedTo: String(data.assignedTo ?? data.assignedToName ?? "").trim() || undefined,
        imageItems,
        imageUrls: imageItems.length
          ? imageItems.map((item) => item.url)
          : Array.isArray(data.imageUrls)
            ? data.imageUrls.map(String).filter(Boolean)
            : [],
        rawFields:
          data.rawFields && typeof data.rawFields === "object"
            ? (data.rawFields as Record<string, unknown>)
            : undefined,
      };
    });
  } catch {
    return [];
  }
}

export async function updateCompanyLeadStatus(
  companyId: string,
  leadId: string,
  status: CompanyLeadRow["status"],
): Promise<boolean> {
  const cid = String(companyId || "").trim();
  const lid = String(leadId || "").trim();
  if (!db || !cid || !lid) return false;
  try {
    await updateDoc(doc(db, "companies", cid, "leads", lid), {
      status,
      updatedAt: serverTimestamp(),
      updatedAtIso: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function createCompanyLead(
  companyId: string,
  payload: {
    rawFields: Record<string, unknown>;
    name?: string;
    email?: string;
    phone?: string;
    message?: string;
    formName?: string;
    source?: string;
    status?: string;
    imageItems?: Array<{ url: string; name?: string; annotations?: LeadImageAnnotation[] }>;
    imageUrls?: string[];
  },
): Promise<CompanyLeadRow | null> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) return null;
  try {
    const leadRef = doc(collection(db, "companies", cid, "leads"));
    const createdAtIso = new Date().toISOString();
    const imageItems = normalizeLeadImageItems(
      Array.isArray(payload.imageItems)
        ? payload.imageItems
        : Array.isArray(payload.imageUrls)
          ? payload.imageUrls.map((url) => ({ url, name: "" }))
          : [],
    );
    const nextLead: CompanyLeadRow = {
      id: leadRef.id,
      companyId: cid,
      name: String(payload.name ?? "").trim(),
      email: String(payload.email ?? "").trim(),
      phone: String(payload.phone ?? "").trim(),
      message: String(payload.message ?? "").trim(),
      formName: String(payload.formName ?? "").trim() || "Manual Lead",
      submittedAtIso: createdAtIso,
      createdAtIso,
      updatedAtIso: createdAtIso,
      source: String(payload.source ?? "").trim() || "manual-entry",
      status: normalizeLeadStatus(payload.status ?? "New"),
      imageItems,
      imageUrls: imageItems.map((item) => item.url),
      rawFields:
        payload.rawFields && typeof payload.rawFields === "object"
          ? payload.rawFields
          : {},
    };
    await setDoc(leadRef, {
      id: nextLead.id,
      companyId: nextLead.companyId,
      name: nextLead.name,
      email: nextLead.email,
      phone: nextLead.phone,
      message: nextLead.message,
      formName: nextLead.formName,
      submittedAtIso: nextLead.submittedAtIso,
      submittedAt: nextLead.submittedAtIso,
      source: nextLead.source,
      status: nextLead.status,
      imageItems: nextLead.imageItems,
      imageUrls: nextLead.imageUrls,
      rawFields: nextLead.rawFields,
      createdAt: serverTimestamp(),
      createdAtIso,
      updatedAt: serverTimestamp(),
      updatedAtIso: createdAtIso,
    });
    return nextLead;
  } catch {
    return null;
  }
}

export async function createCompanyInviteDetailed(
  companyId: string,
  email: string,
  meta?: { companyName?: string; companyCode?: string; invitedByUid?: string; invitedByName?: string },
): Promise<{ ok: boolean; error?: string }> {
  const cid = String(companyId || "").trim();
  const emailRaw = String(email || "").trim();
  const emailLower = emailRaw.toLowerCase();
  if (!db || !cid || !emailRaw || !emailLower.includes("@")) {
    return { ok: false, error: "invalid-invite-input" };
  }

  const inviteId = emailLower.replace(/[^a-z0-9@._-]+/g, "_");
  try {
    await setDoc(
      doc(db, "companies", cid, "invites", inviteId),
      {
        id: inviteId,
        companyId: cid,
        companyName: String(meta?.companyName || "").trim(),
        companyCode: String(meta?.companyCode || "").trim(),
        email: emailRaw,
        emailLower,
        status: "pending",
        invitedByUid: String(meta?.invitedByUid || "").trim(),
        invitedByName: String(meta?.invitedByName || "").trim(),
        createdAt: serverTimestamp(),
        createdAtIso: new Date().toISOString(),
        updatedAt: serverTimestamp(),
        updatedAtIso: new Date().toISOString(),
      },
      { merge: true },
    );
    return { ok: true };
  } catch (error) {
    const fallback = "invite-write-failed";
    const msg =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? fallback)
        : String((error as { message?: unknown } | null)?.message ?? fallback);
    return { ok: false, error: msg };
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

export async function removeTagsFromCompanyProjects(companyId: string, tagsToRemove: string[]): Promise<boolean> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) {
    return false;
  }

  const removeSet = new Set(
    (Array.isArray(tagsToRemove) ? tagsToRemove : [])
      .map((v) => String(v || "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (!removeSet.size) {
    return true;
  }

  try {
    const jobsSnap = await getDocs(collection(db, "companies", cid, "jobs"));
    let batch = writeBatch(db);
    let ops = 0;
    let changed = 0;

    for (const job of jobsSnap.docs) {
      const data = (job.data() ?? {}) as Record<string, unknown>;
      const currentTags = normalizeTagList(Array.isArray(data.tags) ? data.tags : []);
      if (!currentTags.length) continue;

      const nextTags = currentTags.filter((tag) => !removeSet.has(String(tag || "").trim().toLowerCase()));
      if (nextTags.length === currentTags.length) continue;

      batch.update(job.ref, {
        tags: nextTags,
        updatedAt: serverTimestamp(),
        updatedAtIso: new Date().toISOString(),
      });
      ops += 1;
      changed += 1;

      if (ops >= 450) {
        await batch.commit();
        batch = writeBatch(db);
        ops = 0;
      }
    }

    if (ops > 0) {
      await batch.commit();
    }

    if (changed > 0) {
      await syncCompanyProjectTagUsage(cid);
    }

    return true;
  } catch {
    return false;
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

export async function saveUserProfilePatch(
  uid: string,
  companyId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const result = await saveUserProfilePatchDetailed(uid, companyId, patch);
  return result.ok;
}

export async function saveUserProfilePatchDetailed(
  uid: string,
  companyId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const userId = String(uid || "").trim();
  const cid = String(companyId || "").trim();
  if (!db || !userId) return { ok: false, error: "missing-firebase-or-user-id" };
  let lastError = "unknown-save-error";
  let userWriteOk = false;
  let membershipWriteOk = false;
  const hasUserColor = Object.prototype.hasOwnProperty.call(patch, "userColor");
  const userColorValue = String(patch.userColor ?? "").trim();
  let userEmailForMembershipMatch = String(patch.email ?? "").trim().toLowerCase();
  const withMeta = (data: Record<string, unknown>) => ({
    ...data,
    updatedAt: serverTimestamp(),
    updatedAtIso: new Date().toISOString(),
  });
  const fullPatch = withMeta({ ...patch });
  const colorPatch = withMeta(
    hasUserColor
      ? {
          userColor: userColorValue,
          badgeColor: userColorValue,
        }
      : {},
  );
  const colorPatchRulesSafe = withMeta(
    hasUserColor
      ? {
          userColor: userColorValue,
        }
      : {},
  );

  try {
    await setDoc(doc(db, "users", userId), fullPatch, { merge: true });
    userWriteOk = true;
  } catch {
    lastError = "users-write-failed";
  }

  if (!userEmailForMembershipMatch) {
    try {
      const userSnap = await getDoc(doc(db, "users", userId));
      if (userSnap.exists()) {
        const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
        userEmailForMembershipMatch = String(userData.email ?? "").trim().toLowerCase();
      }
    } catch {
      // ignore lookup failure
    }
  }

  const targetCompanyIds = Array.from(
    new Set([
      ...((cid ? [cid] : []).filter(Boolean)),
      ...(await fetchCompanyIdsForUser(userId)),
    ]),
  );

  const writeMembershipRef = async (ref: ReturnType<typeof doc>) => {
    try {
      // Try full patch first.
      await setDoc(ref, fullPatch, { merge: true });
      return true;
    } catch (error) {
      lastError =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code ?? "membership-write-failed")
          : String((error as { message?: unknown } | null)?.message ?? "membership-write-failed");
    }
    if (!hasUserColor) {
      return false;
    }
    try {
      // Try desktop-style color fields.
      await setDoc(ref, colorPatch, { merge: true });
      return true;
    } catch {
      // keep going
    }
    try {
      // Rules-safe fallback that only touches userColor.
      await setDoc(ref, colorPatchRulesSafe, { merge: true });
      return true;
    } catch (error) {
      lastError =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code ?? "membership-color-write-failed")
          : String((error as { message?: unknown } | null)?.message ?? "membership-color-write-failed");
    }
    return false;
  };

  for (const targetCompanyId of targetCompanyIds) {
    try {
      const ok = await writeMembershipRef(doc(db, "companies", targetCompanyId, "memberships", userId));
      if (ok) {
        membershipWriteOk = true;
      }
    } catch {
      // continue fallback paths
    }

    try {
      const membershipSnap = await getDocs(
        query(
          collection(db, "companies", targetCompanyId, "memberships"),
          where("uid", "==", userId),
          limit(1),
        ),
      );
      if (!membershipSnap.empty) {
        const ok = await writeMembershipRef(membershipSnap.docs[0].ref);
        if (ok) {
          membershipWriteOk = true;
        }
      }
    } catch (error) {
      lastError =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code ?? "membership-query-write-failed")
          : String((error as { message?: unknown } | null)?.message ?? "membership-query-write-failed");
    }

    try {
      const companyMemberships = await getDocs(
        query(collection(db, "companies", targetCompanyId, "memberships"), limit(500)),
      );
      for (const membershipDoc of companyMemberships.docs) {
        const membershipData = (membershipDoc.data() ?? {}) as Record<string, unknown>;
        const membershipUid = String(membershipData.uid ?? "").trim();
        const membershipEmail = String(membershipData.email ?? "").trim().toLowerCase();
        const membershipDocId = String(membershipDoc.id ?? "").trim();
        const isMatch =
          membershipUid === userId ||
          membershipDocId === userId ||
          (!!userEmailForMembershipMatch && membershipEmail === userEmailForMembershipMatch);
        if (!isMatch) continue;
        const ok = await writeMembershipRef(membershipDoc.ref);
        if (ok) {
          membershipWriteOk = true;
        }
      }
    } catch (error) {
      lastError =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code ?? "membership-company-scan-failed")
          : String((error as { message?: unknown } | null)?.message ?? "membership-company-scan-failed");
    }
  }

  try {
    const membershipByUid = await getDocs(
      query(collectionGroup(db, "memberships"), where("uid", "==", userId), limit(5)),
    );
    if (!membershipByUid.empty) {
      for (const membershipDoc of membershipByUid.docs) {
        const ok = await writeMembershipRef(membershipDoc.ref);
        if (ok) {
          membershipWriteOk = true;
        }
      }
    }
  } catch (error) {
    lastError =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "membership-cg-query-failed")
        : String((error as { message?: unknown } | null)?.message ?? "membership-cg-query-failed");
  }

  try {
    const allMemberships = await getDocs(query(collectionGroup(db, "memberships"), limit(500)));
    for (const membershipDoc of allMemberships.docs) {
      if (String(membershipDoc.id || "").trim() !== userId) continue;
      const ok = await writeMembershipRef(membershipDoc.ref);
      if (ok) {
        membershipWriteOk = true;
      }
    }
  } catch (error) {
    lastError =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "membership-docid-query-failed")
        : String((error as { message?: unknown } | null)?.message ?? "membership-docid-query-failed");
  }

  if (hasUserColor) {
    if (membershipWriteOk) {
      return { ok: true };
    }
    return { ok: false, error: lastError || "company-membership-color-sync-failed" };
  }

  if (membershipWriteOk || userWriteOk) {
    return { ok: true };
  }

  return { ok: false, error: lastError || "membership-write-failed" };
}

function normalizeSeenUpdateNoticeVersions(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(
    new Set(
      raw
        .map((item) => String(item ?? "").trim())
        .filter(Boolean),
    ),
  );
}

export async function fetchUserUpdateNoticeSeenVersions(
  uid: string,
  companyId?: string,
): Promise<string[]> {
  const userId = String(uid || "").trim();
  const cid = String(companyId || "").trim();
  if (!db || !userId) {
    return [];
  }

  try {
    const userSnap = await getDoc(doc(db, "users", userId));
    if (userSnap.exists()) {
      const data = (userSnap.data() ?? {}) as Record<string, unknown>;
      const versions = normalizeSeenUpdateNoticeVersions(data.updateNoticeSeenVersions);
      if (versions.length) {
        return versions;
      }
    }
  } catch {
    // continue to membership fallback
  }

  const readMembershipVersions = async (ref: ReturnType<typeof doc>) => {
    try {
      const membershipSnap = await getDoc(ref);
      if (!membershipSnap.exists()) {
        return [];
      }
      const data = (membershipSnap.data() ?? {}) as Record<string, unknown>;
      return normalizeSeenUpdateNoticeVersions(data.updateNoticeSeenVersions);
    } catch {
      return [];
    }
  };

  if (cid) {
    const direct = await readMembershipVersions(doc(db, "companies", cid, "memberships", userId));
    if (direct.length) {
      return direct;
    }
    try {
      const membershipSnap = await getDocs(
        query(
          collection(db, "companies", cid, "memberships"),
          where("uid", "==", userId),
          limit(1),
        ),
      );
      if (!membershipSnap.empty) {
        const data = (membershipSnap.docs[0].data() ?? {}) as Record<string, unknown>;
        const versions = normalizeSeenUpdateNoticeVersions(data.updateNoticeSeenVersions);
        if (versions.length) {
          return versions;
        }
      }
    } catch {
      // continue
    }
  }

  try {
    const membershipByUid = await getDocs(
      query(collectionGroup(db, "memberships"), where("uid", "==", userId), limit(5)),
    );
    if (!membershipByUid.empty) {
      for (const membershipDoc of membershipByUid.docs) {
        const data = (membershipDoc.data() ?? {}) as Record<string, unknown>;
        const versions = normalizeSeenUpdateNoticeVersions(data.updateNoticeSeenVersions);
        if (versions.length) {
          return versions;
        }
      }
    }
  } catch {
    // ignore
  }

  return [];
}

export async function markUserUpdateNoticeSeen(
  uid: string,
  companyId: string,
  version: string,
): Promise<boolean> {
  const userId = String(uid || "").trim();
  const cid = String(companyId || "").trim();
  const cleanVersion = String(version || "").trim();
  if (!userId || !cleanVersion) {
    return false;
  }
  const existing = await fetchUserUpdateNoticeSeenVersions(userId, cid);
  if (existing.some((item) => item.toLowerCase() === cleanVersion.toLowerCase())) {
    return true;
  }
  const result = await saveUserProfilePatchDetailed(userId, cid, {
    updateNoticeSeenVersions: [...existing, cleanVersion],
  });
  return result.ok;
}

export async function fetchUserColorMapByUids(
  uids: string[],
  companyId?: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const cleanUids = Array.from(new Set((uids || []).map((uid) => String(uid || "").trim()).filter(Boolean)));
  if (!db || !cleanUids.length) return out;
  const firestore = db;
  const cid = String(companyId || "").trim();

  if (cid) {
    await Promise.all(
      cleanUids.map(async (uid) => {
        try {
          let membership: Record<string, unknown> | null = null;
          const membershipSnap = await getDoc(doc(firestore, "companies", cid, "memberships", uid));
          if (membershipSnap.exists()) {
            membership = (membershipSnap.data() ?? {}) as Record<string, unknown>;
          } else {
            const membershipQuery = await getDocs(
              query(
                collection(firestore, "companies", cid, "memberships"),
                where("uid", "==", uid),
                limit(1),
              ),
            );
            if (!membershipQuery.empty) {
              membership = (membershipQuery.docs[0]?.data() ?? {}) as Record<string, unknown>;
            }
          }
          if (!membership) return;
          const color = String(
            membership.badgeColor ??
              membership.userColor ??
              membership.avatarColor ??
              membership.color ??
              membership.colour ??
              "",
          ).trim();
          if (color) out[uid] = color;
        } catch {
          // ignore missing membership docs
        }
      }),
    );
  }

  await Promise.all(
    cleanUids.map(async (uid) => {
      if (out[uid]) return;
      try {
        const snap = await getDoc(doc(firestore, "users", uid));
        if (!snap.exists()) return;
        const data = (snap.data() ?? {}) as Record<string, unknown>;
        const color = String(
          data.userColor ?? data.badgeColor ?? data.avatarColor ?? data.color ?? data.colour ?? "",
        ).trim();
        if (color) out[uid] = color;
      } catch {
        // ignore missing user docs
      }
    }),
  );

  return out;
}

export async function submitAppReport(input: {
  kind: AppReportKind;
  deviceType?: "desktop" | "tablet" | "mobile" | "";
  subject: string;
  body: string;
  appVersion: string;
  reporterUid: string;
  reporterEmail: string;
  reporterName: string;
}): Promise<boolean> {
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/changelog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "submit-report",
          ...input,
        }),
      });
      if (res.ok) {
        const payload = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (payload?.ok) {
          return true;
        }
      }
    } catch {
      // fall back to direct client firestore below
    }
  }
  if (!db) return false;
  const kind = String(input.kind || "").trim().toLowerCase();
  if (kind !== "issue" && kind !== "feature") return false;
  const subject = String(input.subject || "").trim();
  const body = String(input.body || "").trim();
  const deviceTypeRaw = String(input.deviceType || "").trim().toLowerCase();
  const deviceType =
    deviceTypeRaw === "desktop" || deviceTypeRaw === "tablet" || deviceTypeRaw === "mobile"
      ? deviceTypeRaw
      : "";
  if (!subject || !body) return false;
  const reporterUid = String(input.reporterUid || "").trim();
  const reporterEmail = String(input.reporterEmail || "").trim();
  const reporterName = String(input.reporterName || "").trim();
  if (!reporterUid || !reporterEmail) return false;
  const nowIso = new Date().toISOString();
  try {
    const reportRef = doc(appChangelogCollectionRefForKind(kind as AppReportKind));
    await setDoc(reportRef, {
      id: reportRef.id,
      kind,
      deviceType,
      subject,
      body,
      appVersion: String(input.appVersion || "").trim(),
      reporterUid,
      reporterEmail,
      reporterName,
      completed: false,
      completedAtIso: "",
      createdAt: serverTimestamp(),
      createdAtIso: nowIso,
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso,
    });
    return true;
  } catch {
    return false;
  }
}

export async function fetchAppReports(): Promise<AppReportRow[]> {
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/changelog?type=reports", { cache: "no-store" });
      if (res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { ok?: boolean; reports?: AppReportRow[] }
          | null;
        if (payload?.ok && Array.isArray(payload.reports)) {
          return payload.reports;
        }
      }
    } catch {
      // fall back to direct client firestore below
    }
  }
  if (!db) return [];
  try {
    const mapReportRow = (docSnap: QueryDocumentSnapshot) => {
        const data = (docSnap.data() ?? {}) as Record<string, unknown>;
        const kindRaw = String(data.kind ?? "").trim().toLowerCase();
        const kind: AppReportKind = kindRaw === "feature" ? "feature" : "issue";
        return {
          id: String(data.id ?? docSnap.id),
          kind,
          deviceType: ((): AppReportRow["deviceType"] => {
            const raw = String(data.deviceType ?? "").trim().toLowerCase();
            return raw === "desktop" || raw === "tablet" || raw === "mobile" ? raw : "";
          })(),
          subject: String(data.subject ?? ""),
          body: String(data.body ?? ""),
          createdAtIso: toIsoString(data.createdAtIso ?? data.createdAt, ""),
          appVersion: String(data.appVersion ?? ""),
          reporterEmail: String(data.reporterEmail ?? ""),
          reporterName: String(data.reporterName ?? ""),
          reporterUid: String(data.reporterUid ?? ""),
          completed: Boolean(data.completed),
          completedAtIso: toIsoString(data.completedAtIso ?? data.completedAt, ""),
        } as AppReportRow;
    };
    const [reportSnap, featureSnap] = await Promise.all([
      getDocs(query(appChangelogReportsCollectionRef(), orderBy("createdAt", "desc"), limit(500))),
      getDocs(query(appChangelogSuggestedFeaturesCollectionRef(), orderBy("createdAt", "desc"), limit(500))),
    ]);
    const rows = [...reportSnap.docs, ...featureSnap.docs]
      .map(mapReportRow)
      .filter((row) => row.subject || row.body)
      .sort((a, b) => String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || "")));
    if (rows.length) {
      return rows;
    }
    const [legacyNestedSnap, legacyTopLevelSnap] = await Promise.all([
      getDocs(query(collection(db, "appChangelog", "global", "reports"), orderBy("createdAt", "desc"), limit(500))),
      getDocs(query(collection(db, "appReports"), orderBy("createdAt", "desc"), limit(500))),
    ]);
    const legacyRows = [...legacyNestedSnap.docs, ...legacyTopLevelSnap.docs]
      .map(mapReportRow)
      .filter((row) => row.subject || row.body);
    for (const row of legacyRows) {
      await setDoc(
        doc(appChangelogCollectionRefForKind(row.kind), row.id),
        {
          ...row,
          updatedAt: serverTimestamp(),
          updatedAtIso: new Date().toISOString(),
        },
        { merge: true },
      );
    }
    return legacyRows;
  } catch {
    return [];
  }
}

export async function setAppReportCompleted(reportId: string, completed: boolean): Promise<boolean> {
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/changelog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "set-report-completed",
          reportId,
          completed,
        }),
      });
      if (res.ok) {
        const payload = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (payload?.ok) {
          return true;
        }
      }
    } catch {
      // fall back to direct client firestore below
    }
  }
  if (!db) return false;
  const id = String(reportId || "").trim();
  if (!id) return false;
  const nowIso = new Date().toISOString();
  try {
    await updateDoc(doc(appChangelogReportsCollectionRef(), id), {
      completed: Boolean(completed),
      completedAt: Boolean(completed) ? serverTimestamp() : null,
      completedAtIso: Boolean(completed) ? nowIso : "",
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso,
    });
    return true;
  } catch {
    try {
      await updateDoc(doc(appChangelogSuggestedFeaturesCollectionRef(), id), {
        completed: Boolean(completed),
        completedAt: Boolean(completed) ? serverTimestamp() : null,
        completedAtIso: Boolean(completed) ? nowIso : "",
        updatedAt: serverTimestamp(),
        updatedAtIso: nowIso,
      });
      return true;
    } catch {
      try {
        await updateDoc(doc(db, "appChangelog", "global", "reports", id), {
          completed: Boolean(completed),
          completedAt: Boolean(completed) ? serverTimestamp() : null,
          completedAtIso: Boolean(completed) ? nowIso : "",
          updatedAt: serverTimestamp(),
          updatedAtIso: nowIso,
        });
        return true;
      } catch {
        try {
          await updateDoc(doc(db, "appReports", id), {
            completed: Boolean(completed),
            completedAt: Boolean(completed) ? serverTimestamp() : null,
            completedAtIso: Boolean(completed) ? nowIso : "",
            updatedAt: serverTimestamp(),
            updatedAtIso: nowIso,
          });
          return true;
        } catch {
          return false;
        }
      }
    }
  }
}

export async function cleanupCompletedReportsForNewVersion(currentVersion: string): Promise<boolean> {
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/changelog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "cleanup-version",
          version: currentVersion,
        }),
      });
      if (res.ok) {
        const payload = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (payload?.ok) {
          return true;
        }
      }
    } catch {
      // fall back to direct client firestore below
    }
  }
  if (!db) return false;
  const normalizedVersion = String(currentVersion || "").trim().replace(/^v+/i, "");
  if (!normalizedVersion) return false;
  const markerRef = doc(db, "appMeta", "reportsCleanup");
  try {
    const markerSnap = await getDoc(markerRef);
    const lastVersion = markerSnap.exists()
      ? String((markerSnap.data() as Record<string, unknown>).lastVersion ?? "").trim().replace(/^v+/i, "")
      : "";
    if (lastVersion === normalizedVersion) {
      return true;
    }

    // Keep completed entries so devs can review history across versions.
    await setDoc(
      markerRef,
      {
        lastVersion: normalizedVersion,
        updatedAt: serverTimestamp(),
        updatedAtIso: new Date().toISOString(),
      },
      { merge: true },
    );
    return true;
  } catch {
    return false;
  }
}
