import { cachedValue, invalidateCompanyCache, invalidateUserCache, readCompanyDocCached, readUserDocCached } from "@/lib/firestore-cache";
import {
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  type DocumentReference,
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
} from "@/lib/firestore-client";
import { auth, db, hasFirebaseConfig } from "@/lib/firebase";
import { fetchCompanyAccess, type CompanyAccessInfo } from "@/lib/membership";
import { mockChanges, mockCutlists, mockProjects, mockQuotes } from "@/lib/mock-data";
import { normalizeSpecsGrid, normalizeSpecsGridVersion, type SpecsGrid, type SpecsGridVersion } from "@/lib/specs-grid-types";
import {
  completedStatusMatcher,
  isPastArchiveDelay,
  matchesArchivedFilter,
  normalizeProjectArchiveDelay,
  PROJECTS_ARCHIVED_EVENT,
  withProjectArchiveFields,
  type ArchivedFilter,
  type ProjectsArchivedDetail,
} from "@/lib/project-archive";
import type { ProductComparison } from "@/lib/cutlist-types";
import type { ChecklistTemplate, Cutlist, Project, ProjectChange, ProjectChecklist, ProjectImageItem, SalesQuote } from "@/lib/types";
import { normalizeWhatsNewHighlights, type UpdateChangelogEntry } from "@/lib/update-notes-utils";

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

// Exported for use-project-cutlist.ts's legacy-field fallback read — reused rather than
// reimplemented, so the `cutlist` vs `cutlistJson` priority logic only lives in one place.
export function parseCutlistRows(data: Record<string, unknown>): unknown[] {
  const container = parseCutlistContainer(data);
  if (!container) {
    return [];
  }
  return Array.isArray(container.rows) ? (container.rows as unknown[]) : [];
}

// Reads a field of the project's sales data (sales → projectSettings.sales → salesJson →
// projectSettings.salesJson, each optionally a JSON string) directly off a raw Firestore document
// instead of an already-normalized
// Project object — used by the lazy sales-grid/initial-measure-cutlist subcollection hooks' own
// legacy fallback, since normalizeProject no longer parses these fields into `project` at all.
export function extractLegacySalesFieldFromRawDoc(data: Record<string, unknown>, key: string): unknown {
  const asObject = (value: unknown): Record<string, unknown> | null => {
    if (value && typeof value === "object") return value as Record<string, unknown>;
    if (typeof value === "string" && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
    return null;
  };
  const projectSettings = asObject(data.projectSettings) ?? {};
  // The top-level `sales` first — it's the copy that's kept up to date (see withoutLegacyCopies).
  const candidates: unknown[] = [data.sales, projectSettings.sales, data.salesJson, projectSettings.salesJson];
  for (const candidate of candidates) {
    const parsed = asObject(candidate);
    if (parsed && key in parsed) return parsed[key];
  }
  return undefined;
}

// Exported for use-project-images.ts's legacy-field fallback read.
export function normalizeProjectImageItems(value: unknown): ProjectImageItem[] {
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

// Exported for use-project-checklists.ts — reused for both the legacy embedded-field fallback
// read and the (per-checklist, id-injected) new subcollection read, so the validation/shape
// logic only lives in one place.
export function normalizeProjectChecklists(value: unknown): ProjectChecklist[] {
  if (!Array.isArray(value)) return [];
  const checklists: ProjectChecklist[] = [];
  for (const entry of value) {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const id = String(row?.id ?? "").trim();
    const name = String(row?.name ?? "").trim();
    if (!id || !name) continue;
    const rawItems = Array.isArray(row?.items) ? row.items : [];
    const items = rawItems
      .map((item) => {
        const itemRow = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
        const itemId = String(itemRow?.id ?? "").trim();
        const text = String(itemRow?.text ?? "").trim();
        if (!itemId || !text) return null;
        return { id: itemId, text, checked: Boolean(itemRow?.checked) };
      })
      .filter((item): item is { id: string; text: string; checked: boolean } => item !== null);
    checklists.push({ id, name, items, addedAt: String(row?.addedAt ?? "").trim() || undefined });
  }
  return checklists;
}

function normalizeProject(id: string, data: Record<string, unknown>, options?: { lightweight?: boolean }): Project {
  const lightweight = options?.lightweight === true;
  const clientBlock =
    asRecord(data.clientDetails) ??
    asRecord(data.client) ??
    asRecord(data.general) ??
    asRecord(data.projectDetails) ??
    {};

  // Lightweight mode (dashboard list rendering) skips every field below that the dashboard
  // never reads, so opening the dashboard doesn't pay for parsing every project's full
  // cutlist/sales/checklist/image payload just to show a name and a status pill.
  const settings = lightweight
    ? ({} as Record<string, unknown>)
    : typeof data.projectSettings === "object" && data.projectSettings !== null
      ? ({ ...(data.projectSettings as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  if (!lightweight && !Object.keys(settings).length && typeof data.projectSettingsJson === "string" && data.projectSettingsJson.trim()) {
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
  if (!lightweight) {
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
    if (salesPayload) {
      // quoteGrid/specificationsGrid/initialCutlist moved to their own subcollections (see
      // fetchSalesGridData/saveSalesGridData and cutlistData's "initialMeasure" kind) — the
      // heaviest fields in this blob, stripped here so they're never parsed/held in memory on a
      // plain project open, lightweight or not. The project page fetches them itself, lazily.
      // quoteGridLastClosedVersion is deliberately NOT included here — it stays embedded (small,
      // not an ever-growing array, and tightly coupled to the Quote grid's own staleness-
      // detection logic in a way that isn't worth the risk of extracting in this pass).
      // The top-level `sales` is the one copy kept up to date (see withoutLegacyCopies), so its values
      // win over a `projectSettings.sales` left behind by older saves (merged, so nothing that's only
      // in the older copy is lost).
      const trimmedSales = { ...(asRecord(settings.sales) ?? {}), ...salesPayload };
      delete trimmedSales.quoteGrid;
      delete trimmedSales.specificationsGrid;
      delete trimmedSales.initialCutlist;
      settings.sales = trimmedSales;
    }

    if (typeof data.productionTempEdit === "object" && data.productionTempEdit !== null && !("productionTempEdit" in settings)) {
      settings.productionTempEdit = data.productionTempEdit as Record<string, unknown>;
    }
  }

  const customer = pickFirstString(data, ["customer", "clientName", "client", "client_name"]) ||
    pickFirstString(clientBlock, ["name", "clientName", "client", "customer"]);
  const clientFirstName = pickFirstString(data, ["clientFirstName", "customerFirstName", "firstName"]) ||
    pickFirstString(clientBlock, ["clientFirstName", "customerFirstName", "firstName"]);
  const clientLastName = pickFirstString(data, ["clientLastName", "customerLastName", "lastName"]) ||
    pickFirstString(clientBlock, ["clientLastName", "customerLastName", "lastName"]);
  const clientPhone = pickFirstString(data, ["clientPhone", "clientNumber", "clientMobile", "phone"]) ||
    pickFirstString(clientBlock, ["phone", "mobile", "clientPhone", "clientNumber"]);
  const clientEmail = pickFirstString(data, ["clientEmail", "email"]) ||
    pickFirstString(clientBlock, ["email", "clientEmail"]);
  const clientAddress = pickFirstString(data, ["clientAddress", "projectAddress", "address"]) ||
    pickFirstString(clientBlock, ["address", "clientAddress", "projectAddress"]);
  const notes = pickFirstString(data, ["notes", "projectNotes", "description"]) ||
    pickFirstString(clientBlock, ["notes", "projectNotes", "description"]);
  const productionNotes = pickFirstString(data, ["productionNotes"]);
  const remedials = pickFirstString(data, ["remedials"]);
  const contractorNotesRaw = asRecord(data.contractorNotes);
  const contractorNotes = contractorNotesRaw
    ? Object.fromEntries(
        Object.entries(contractorNotesRaw).map(([key, value]) => [key, String(value ?? "")]),
      )
    : undefined;
  const createdByName = pickFirstString(data, [
    "createdByName",
    "creatorName",
    "createdBy",
    "ownerName",
    "createdByDisplayName",
  ]);
  // Never parsed here anymore, lightweight or not — images/files moved to their own
  // subcollection (see fetchProjectMediaData/saveProjectImagesData/saveProjectFilesData); the
  // project page fetches and merges them into its own `project` state itself, lazily.
  const projectImageItems: ProjectImageItem[] = [];
  const projectImages: string[] = [];
  const notifySubscriptionOverridesRaw = asRecord(data.notifySubscriptionOverrides);
  const notifySubscriptionOverrides = notifySubscriptionOverridesRaw
    ? Object.fromEntries(
        Object.entries(notifySubscriptionOverridesRaw).map(([key, value]) => [key, Boolean(value)]),
      )
    : undefined;

  const project: Project = {
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
    notifySubscriptionOverrides,
    status: toProjectStatus(data.status),
    statusLabel: String(data.status ?? "New"),
    priority: (String(data.priority ?? "medium") as Project["priority"]),
    updatedAt: toIsoString(data.updatedAtIso ?? data.updatedAt, new Date().toISOString()),
    deletedAt: toIsoString(data.deletedAtIso ?? data.deletedAt, ""),
    completedAtIso: toIsoString(data.completedAtIso ?? data.completedAt, "") || undefined,
    dueDate: String(data.dueDate ?? data.due ?? ""),
    // Used to fall back to the parsed cutlist's row count when this wasn't already stored on the
    // doc — cutlist rows are no longer parsed here at all (moved to their own subcollection, see
    // fetchCutlistData/saveCutlistData), so this is now just the stored value, defaulting to 0.
    // Nothing in the project page reads this field; a live "sheets used" number is recomputed
    // from the cutlist itself and synced to a separate companyStats doc instead.
    estimatedSheets: Number(data.estimatedSheets ?? 0),
    // No assignee stored → fall back to whoever created it, rather than the literal word
    // "Unassigned" — a project always has a real point of contact even before someone
    // deliberately assigns it to a specific staff member.
    assignedTo: pickFirstString(data, ["assignedTo", "assignedToName", "assignedName"]) || createdByName || "Unknown",
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    notes,
    productionNotes,
    remedials,
    contractorNotes,
    clientFirstName,
    clientLastName,
    clientPhone,
    clientEmail,
    clientAddress,
    region: String(data.region ?? ""),
    // Never parsed here anymore either — see the projectImageItems/projectImages comment above.
    projectFiles: [],
    projectImages: projectImages.length ? projectImages : projectImageItems.map((item) => item.url),
    projectImageItems,
    dashboardCompleteStatusId: String(data.dashboardCompleteStatusId ?? "").trim() || undefined,
    dashboardSubStageId: String(data.dashboardSubStageId ?? "").trim() || undefined,
    dashboardBoardOrder:
      typeof data.dashboardBoardOrder === "number" && Number.isFinite(data.dashboardBoardOrder) ? data.dashboardBoardOrder : undefined,
    productionUnlockRequests: (() => {
      const raw = data.productionUnlockRequests;
      if (!raw || typeof raw !== "object") return undefined;
      const out: Record<string, { requestedAtIso: string; name: string }> = {};
      for (const [uid, value] of Object.entries(raw as Record<string, unknown>)) {
        const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
        const requestedAtIso = String(row.requestedAtIso ?? "").trim();
        if (uid && requestedAtIso) out[uid] = { requestedAtIso, name: String(row.name ?? "").trim() };
      }
      return Object.keys(out).length ? out : undefined;
    })(),
    projectSettings: settings,
    // Never parsed here anymore, lightweight or not — cutlist rows moved to their own
    // subcollection; the project page fetches them itself, lazily, via useProjectCutlist.
    cutlist: undefined,
    // Never parsed here anymore, lightweight or not — checklists moved to their own
    // subcollection (one doc per checklist); the project page fetches them itself, lazily, via
    // useProjectChecklists.
    checklists: [],
  };
  // isArchived/archivedAtIso/archiveRestoredAtIso (see lib/project-archive.ts) — not on the shared
  // Project type, so they're read back through that file's helpers.
  return withProjectArchiveFields(project, data);
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

    invalidateCompanyCache(cid);
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

    invalidateCompanyCache(cid);
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

function normalizeJobProject(companyId: string, docSnap: QueryDocumentSnapshot, lightweight?: boolean): Project {
  const data = (docSnap.data() ?? {}) as Record<string, unknown>;
  const projectId = String(data.id ?? docSnap.id);
  const normalized = normalizeProject(projectId, data, { lightweight });
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
  const details = String(data.details ?? "").trim();
  return {
    id,
    projectId: String(data.projectId ?? ""),
    actor: String(data.actor ?? "System"),
    action: String(data.action ?? "Updated"),
    details: details || undefined,
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
  // The user's own profile (users/{uid}.companyId / activeCompanyId), through the shared cache — the
  // same read sign-in already made. A collectionGroup("memberships") documentId() == uid query used to
  // run alongside it, but the Firestore SDK always rejects that (a collection-group documentId filter
  // needs a full document path), so it never found anything.
  try {
    const data = await readUserDocCached(uid);
    if (!data) return [];
    const nestedCompany =
      typeof data.company === "object" && data.company !== null ? (data.company as Record<string, unknown>) : null;
    const companyId = String(data.companyId ?? data.activeCompanyId ?? nestedCompany?.id ?? nestedCompany?.companyId ?? "").trim();
    return companyId ? [companyId] : [];
  } catch {
    return [];
  }
}

async function fetchProjectsFromCompanyJobs(
  uid: string,
  includeDeleted = false,
  preferredCompanyIds?: string[],
  lightweight?: boolean,
  // Set by fetchProjectById, which already merges fetchCompanyIdsForUser's result into
  // preferredCompanyIds itself before calling this — without this flag, that same 2-way
  // Firestore membership lookup ran a second time here for no new information.
  companyIdsAlreadyResolved?: boolean,
  // Archived projects (lib/project-archive.ts) are left out unless asked for.
  archived: ArchivedFilter = "exclude",
): Promise<Project[]> {
  if (!db || !uid) {
    return [];
  }
  const database = db;

  const companyIds = companyIdsAlreadyResolved
    ? Array.from(new Set((preferredCompanyIds ?? []).map((v) => String(v || "").trim()).filter(Boolean)))
    : Array.from(
        new Set([
          ...(await fetchCompanyIdsForUser(uid)),
          ...((preferredCompanyIds ?? []).map((v) => String(v || "").trim()).filter(Boolean)),
        ]),
      );
  if (!companyIds.length) {
    return [];
  }

  // Each company's own 3 lookups (company doc, access, jobs) are independent of each other, and
  // different companies are independent of one another too — this used to be a fully sequential
  // for-loop (3 awaits × N companies, one company after another), now all of it runs concurrently.
  const perCompanyResults = await Promise.all(
    companyIds.map(async (companyId) => {
      try {
        const [companyDocData, companyAccess, jobsSnap] = await Promise.all([
          fetchCompanyDoc(companyId),
          fetchCompanyAccess(companyId, uid),
          getDocs(collection(database, "companies", companyId, "jobs")),
        ]);
        const companyData = companyDocData ?? {};
        const displayNameOverridesByUid = normalizeCompanyStaffDisplayNameOverrides(companyData.staffDisplayNamesByUid);
        const rows: Project[] = [];
        const cleanups: Array<{ ref: DocumentReference; patch: Record<string, unknown> }> = [];
        for (const item of jobsSnap.docs) {
          const data = (item.data() ?? {}) as Record<string, unknown>;
          if (Boolean(data.isDeleted) !== Boolean(includeDeleted) || !matchesArchivedFilter(data, archived)) {
            continue;
          }
          const normalized = applyCompanyStaffDisplayNameOverridesToProject(normalizeJobProject(companyId, item, lightweight), displayNameOverridesByUid);
          if (!canUserViewProject(normalized, uid, companyAccess)) {
            continue;
          }
          rows.push(normalized);
          const cleanupPatch = legacyCopiesCleanupPatch(data);
          if (cleanupPatch) cleanups.push({ ref: item.ref, patch: cleanupPatch });
        }
        cleanUpLegacyProjectCopies(cleanups);
        return rows;
      } catch {
        return [];
      }
    }),
  );

  const all = perCompanyResults.flat();
  all.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return all;
}

async function fetchProjectsFromLegacyUserPaths(uid: string, includeDeleted = false, archived: ArchivedFilter = "exclude"): Promise<Project[]> {
  if (!db || !uid) {
    return [];
  }

  const all: Project[] = [];

  // Legacy path: users/{uid}/projects
  try {
    const userProjects = await getDocs(collection(db, "users", uid, "projects"));
    for (const item of userProjects.docs) {
      const data = (item.data() ?? {}) as Record<string, unknown>;
      if (Boolean(data.isDeleted) !== Boolean(includeDeleted) || !matchesArchivedFilter(data, archived)) {
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
          if (Boolean(data.isDeleted) !== Boolean(includeDeleted) || !matchesArchivedFilter(data, archived)) {
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

// Archived projects (lib/project-archive.ts) are left out by default — pass `archived: "only"` for
// just those (the Archived page) or "include" for everything.
export async function fetchProjects(
  uid?: string,
  preferredCompanyIds?: string[],
  options?: { lightweight?: boolean; archived?: ArchivedFilter },
): Promise<Project[]> {
  const archived = options?.archived ?? "exclude";
  const mocks = () => mockProjects.filter((project) => matchesArchivedFilter(project as unknown as Record<string, unknown>, archived));
  if (!db) {
    return mocks();
  }
  const database = db;

  const userId = String(uid ?? "").trim();
  const lightweight = options?.lightweight === true;

  try {
    // Scoped to the user's own companies instead of reading the whole top-level `projects`
    // collection — that used to be an unfiltered, unlimited `getDocs(collection(db,"projects"))`,
    // meaning every dashboard load downloaded every project across every company in the database,
    // not just the current one. Firestore's `in` operator caps at 30 values per query, so a user
    // in more companies than that gets chunked, queried in parallel, and merged.
    //
    // `preferredCompanyIds` (the dashboard's own localStorage-cached "last active company") costs
    // nothing to read — try the query with just that first, before paying for
    // fetchCompanyIdsForUser's own 4-way Firestore lookup. That lookup is only needed as a
    // fallback (a genuinely fresh login with nothing cached yet, or the cached id turning out to
    // be stale/wrong) — awaiting it unconditionally on every load added a real, avoidable chain of
    // round trips to the critical path before the actual projects query could even start, worst on
    // a cold first load right after auth resolves, which is exactly when it was being felt as
    // "the projects just don't show up for a long time."
    const runScopedProjectsQuery = async (companyIds: string[]): Promise<Project[]> => {
      if (!companyIds.length) return [];
      const CHUNK_SIZE = 30;
      const chunks: string[][] = [];
      for (let i = 0; i < companyIds.length; i += CHUNK_SIZE) {
        chunks.push(companyIds.slice(i, i + CHUNK_SIZE));
      }
      const snaps = await Promise.all(
        chunks.map((chunk) => getDocs(query(collection(database, "projects"), where("companyId", "in", chunk)))),
      );
      const topLevelDocs = snaps
        .flatMap((snap) => snap.docs)
        .filter((item) => matchesArchivedFilter((item.data() ?? {}) as Record<string, unknown>, archived));
      if (!topLevelDocs.length) return [];
      const rows = topLevelDocs.map((item) => normalizeProject(item.id, item.data() as Record<string, unknown>, { lightweight }));
      // Each company's doc and the user's access to it, fetched ONCE per company up front — this used
      // to look them up per project, and since every project started at the same moment none of them
      // found the others' results, so N projects meant N company-doc reads and N access checks.
      const rowCompanyIds = Array.from(new Set(rows.map((row) => String(row.companyId || "").trim()).filter(Boolean)));
      const perCompany = new Map(
        await Promise.all(
          rowCompanyIds.map(async (companyId) => {
            const [companyDoc, companyAccess] = await Promise.all([
              fetchCompanyDoc(companyId),
              userId ? fetchCompanyAccess(companyId, userId) : Promise.resolve(null),
            ]);
            return [companyId, { companyDoc, companyAccess }] as const;
          }),
        ),
      );
      return rows
        .map((row) => {
          const companyId = String(row.companyId || "").trim();
          if (!companyId) return row;
          const info = perCompany.get(companyId);
          const displayNameOverridesByUid = normalizeCompanyStaffDisplayNameOverrides(info?.companyDoc?.staffDisplayNamesByUid);
          const normalized = applyCompanyStaffDisplayNameOverridesToProject(row, displayNameOverridesByUid);
          return canUserViewProject(normalized, userId, info?.companyAccess ?? null) ? normalized : null;
        })
        .filter(Boolean) as Project[];
    };
    // Company jobs are where projects live; the top-level `projects` collection is a legacy location
    // that's normally empty. Both are loaded at once (this used to wait for the legacy query first).
    // Where a project is in both, the company job wins.
    const mergeJobsFirst = (jobs: Project[], legacyTop: Project[]) => {
      const seen = new Set<string>();
      return [...jobs, ...legacyTop].filter((project) => {
        if (seen.has(project.id)) return false;
        seen.add(project.id);
        return true;
      });
    };
    const loadFor = async (companyIds: string[]) => {
      const [jobs, legacyTop] = await Promise.all([
        fetchProjectsFromCompanyJobs(userId, false, companyIds, lightweight, true, archived),
        runScopedProjectsQuery(companyIds).catch(() => [] as Project[]),
      ]);
      return mergeJobsFirst(jobs, legacyTop);
    };

    // De-duplicated: callers often pass the same company twice (the saved company and the profile's).
    const preferredIds = Array.from(new Set((preferredCompanyIds ?? []).map((v) => String(v || "").trim()).filter(Boolean)));
    // The user's own company (from their profile — already read at sign-in, so normally instant from
    // the shared cache) is looked up at the same time as the preferred companies load.
    const resolvedIdsPromise = userId ? fetchCompanyIdsForUser(userId) : Promise.resolve([] as string[]);
    if (preferredIds.length) {
      const fast = await loadFor(preferredIds);
      if (fast.length > 0) {
        return fast;
      }
    }
    const extraIds = (await resolvedIdsPromise).filter((id) => !preferredIds.includes(id));
    if (extraIds.length) {
      const slow = await loadFor(extraIds);
      if (slow.length > 0) {
        return slow;
      }
    }
  } catch {
    // continue into the legacy fallbacks
  }

  const legacy = await fetchProjectsFromLegacyUserPaths(String(uid ?? ""), false, archived);
  if (legacy.length > 0) {
    return legacy;
  }

  return hasFirebaseConfig ? [] : mocks();
}

export async function fetchProjectById(
  projectId: string,
  uid?: string,
  preferredCompanyIds?: string[],
): Promise<Project | null> {
  if (!db) {
    return mockProjects.find((project) => project.id === projectId) ?? null;
  }
  const database = db;

  const userId = String(uid ?? "").trim();
  const preferredIds = Array.from(new Set((preferredCompanyIds ?? []).map((v) => String(v || "").trim()).filter(Boolean)));
  // The user's own company (from their profile, normally already in the shared cache) is looked up
  // alongside — not before — checking the companies the caller already knows.
  const resolvedIdsPromise = userId ? fetchCompanyIdsForUser(userId) : Promise.resolve([] as string[]);

  // Prefer company-scoped jobs first (source of truth for web/desktop parity). Each candidate
  // company is just a guess at where this project lives — checked concurrently.
  const findDirectHit = async (ids: string[]) => {
    const hits = await Promise.all(
      ids.map(async (companyId) => {
        try {
          const direct = await getDoc(doc(database, "companies", companyId, "jobs", projectId));
          return direct.exists() ? { companyId, data: direct.data() as Record<string, unknown> } : null;
        } catch {
          return null;
        }
      }),
    );
    return hits.find((hit): hit is { companyId: string; data: Record<string, unknown> } => hit !== null) ?? null;
  };
  let directHit = preferredIds.length ? await findDirectHit(preferredIds) : null;
  const extraIds = directHit ? [] : (await resolvedIdsPromise).filter((id) => !preferredIds.includes(id));
  if (!directHit && extraIds.length) directHit = await findDirectHit(extraIds);
  const companyIds = [...preferredIds, ...extraIds];
  if (directHit) {
    const [companyDoc, companyAccess] = await Promise.all([
      fetchCompanyDoc(directHit.companyId),
      userId ? fetchCompanyAccess(directHit.companyId, userId) : Promise.resolve(null),
    ]);
    const displayNameOverridesByUid = normalizeCompanyStaffDisplayNameOverrides(
      (companyDoc as Record<string, unknown> | null)?.staffDisplayNamesByUid,
    );
    const normalized = normalizeProject(projectId, directHit.data);
    normalized.companyId = directHit.companyId;
    const project = applyCompanyStaffDisplayNameOverridesToProject(normalized, displayNameOverridesByUid);
    return canUserViewProject(project, userId, companyAccess) ? project : null;
  }

  // companyIds is already the fully-resolved set (preferredCompanyIds ∪ fetchCompanyIdsForUser),
  // computed above — tell fetchProjectsFromCompanyJobs not to re-resolve it via a second,
  // redundant fetchCompanyIdsForUser call. Archived projects included — they still open from a link.
  const nested = await fetchProjectsFromCompanyJobs(userId, false, companyIds, undefined, true, "include");
  const nestedHit = nested.find((project) => project.id === projectId) ?? null;
  if (nestedHit) {
    return nestedHit;
  }

  // Fallback to legacy top-level only if not found in company jobs.
  try {
    const ref = doc(database, "projects", projectId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const normalized = normalizeProject(snap.id, snap.data() as Record<string, unknown>);
      const companyId = String(normalized.companyId || "").trim();
      if (!companyId) {
        return canUserViewProject(normalized, userId, null) ? normalized : null;
      }
      const [companyDoc, companyAccess] = await Promise.all([
        fetchCompanyDoc(companyId),
        userId ? fetchCompanyAccess(companyId, userId) : Promise.resolve(null),
      ]);
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

// Projects soft-deleted the old way (isDeleted — Recently Deleted, before it became part of Archived).
// Nothing writes that flag any more; the Archived page lists these alongside the archived ones (they
// come back marked archived, filed under their deletion date — see withProjectArchiveFields) so none
// of them are lost, and every other project list keeps leaving them out as before.
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

  const database = db;
  const companyIds = Array.from(
    new Set([
      ...(preferredCompanyIds ?? []).map((v) => String(v || "").trim()).filter(Boolean),
      ...(userId ? await fetchCompanyIdsForUser(userId) : []),
    ]),
  );

  // The legacy top-level location, scoped to the user's companies (this used to read the WHOLE
  // collection — every company's projects — on every visit), the company jobs and the older per-user
  // paths, all at once.
  const legacyTopLevel = async (): Promise<Project[]> => {
    if (!companyIds.length) return [];
    try {
      const snaps = await Promise.all(
        Array.from({ length: Math.ceil(companyIds.length / 30) }, (_, i) =>
          getDocs(query(collection(database, "projects"), where("companyId", "in", companyIds.slice(i * 30, i * 30 + 30)))),
        ),
      );
      const rows = snaps
        .flatMap((snap) => snap.docs)
        .filter((item) => Boolean(((item.data() ?? {}) as Record<string, unknown>).isDeleted))
        .map((item) => normalizeProject(item.id, item.data() as Record<string, unknown>));
      const rowCompanyIds = Array.from(new Set(rows.map((row) => String(row.companyId || "").trim()).filter(Boolean)));
      const perCompany = new Map(
        await Promise.all(
          rowCompanyIds.map(async (companyId) => {
            const [companyDoc, companyAccess] = await Promise.all([
              fetchCompanyDoc(companyId),
              userId ? fetchCompanyAccess(companyId, userId) : Promise.resolve(null),
            ]);
            return [companyId, { companyDoc, companyAccess }] as const;
          }),
        ),
      );
      return rows
        .map((row) => {
          const companyId = String(row.companyId || "").trim();
          if (!companyId) return row;
          const info = perCompany.get(companyId);
          const project = applyCompanyStaffDisplayNameOverridesToProject(
            row,
            normalizeCompanyStaffDisplayNameOverrides(info?.companyDoc?.staffDisplayNamesByUid),
          );
          return canUserViewProject(project, userId, info?.companyAccess ?? null) ? project : null;
        })
        .filter(Boolean) as Project[];
    } catch {
      return [];
    }
  };
  // A project deleted after it was archived is in the fetchProjects "only" list too — the Archived
  // page de-duplicates them.
  const [topDeleted, nested, legacy] = await Promise.all([
    legacyTopLevel(),
    fetchProjectsFromCompanyJobs(String(uid ?? ""), true, companyIds, undefined, true, "include"),
    fetchProjectsFromLegacyUserPaths(String(uid ?? ""), true, "include"),
  ]);
  upsert(topDeleted);
  upsert(nested);
  upsert(legacy);

  return Array.from(merged.values()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// Scoped to one project — this used to be an unfiltered scan of the entire app-wide `quotes`
// collection on every single project open, only to immediately filter the result down to this
// one project's items client-side (see the project page's own load effect).
export async function fetchQuotes(projectId: string): Promise<SalesQuote[]> {
  if (!db) {
    return mockQuotes.filter((quote) => quote.projectId === projectId);
  }

  try {
    const snap = await getDocs(query(collection(db, "quotes"), where("projectId", "==", projectId)));
    if (snap.empty) {
      return hasFirebaseConfig ? [] : mockQuotes.filter((quote) => quote.projectId === projectId);
    }
    return snap.docs.map((item) => normalizeQuote(item.id, item.data() as Record<string, unknown>));
  } catch {
    return hasFirebaseConfig ? [] : mockQuotes.filter((quote) => quote.projectId === projectId);
  }
}

export async function fetchChanges(projectId: string): Promise<ProjectChange[]> {
  if (!db) {
    return mockChanges.filter((change) => change.projectId === projectId);
  }

  try {
    // Filtered server-side (not "fetch the whole collection and filter client-side") — this
    // collection is shared across every project/company, and now that addProjectChange actually
    // writes to it, a full scan on every project page load would only get more expensive as usage
    // accumulates.
    const snap = await getDocs(query(collection(db, "changelog"), where("projectId", "==", projectId)));
    if (snap.empty) {
      return hasFirebaseConfig ? [] : mockChanges.filter((change) => change.projectId === projectId);
    }

    return snap.docs.map((item) => normalizeChange(item.id, item.data() as Record<string, unknown>));
  } catch {
    return hasFirebaseConfig ? [] : mockChanges.filter((change) => change.projectId === projectId);
  }
}

// Appends one entry to a project's changelog — fire-and-forget from the caller's own save
// function, purely a side-effect record of what happened. Never throws: a logging failure must
// never surface as (or be mistaken for) the real save failing.
export async function addProjectChange(projectId: string, actor: string, action: string, details?: string): Promise<boolean> {
  const pid = String(projectId || "").trim();
  const actionText = String(action || "").trim();
  if (!pid || !actionText) return false;
  if (!db) return true;
  try {
    const ref = doc(collection(db, "changelog"));
    const detailsText = String(details || "").trim();
    await setDoc(ref, {
      projectId: pid,
      actor: String(actor || "Staff").trim() || "Staff",
      action: actionText,
      ...(detailsText ? { details: detailsText } : {}),
      at: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
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
  // How they joined: the join code's key (companyJoinCodes/{key}), and "invite" / "master-code" /
  // "temporary-code" when the server recorded it (lib/company-join-codes-server.ts).
  joinCodeKey?: string;
  joinedVia?: string;
}

export interface UserNotificationRow {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAtIso: string;
  projectId?: string;
  companyId?: string;
  // A calendar reminder's event.
  eventId?: string;
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

export async function updateProjectStatus(
  project: Project,
  newStatus: string,
  nextSubStageId: string = "",
  // Saved in the same write — e.g. the Dashboard board's drop position (dashboardBoardOrder).
  extraPatch?: Record<string, unknown>,
): Promise<boolean> {
  if (!db || !project || !newStatus) {
    return false;
  }

  const nowIso = new Date().toISOString();
  // Which statuses are "completed" is the company's own call (Company Settings > Project statuses >
  // Completed), with the old name-based rule for a company that hasn't set it — see
  // completedStatusMatcher in lib/project-archive.ts.
  const companyDoc = project.companyId ? await fetchCompanyDoc(project.companyId) : null;
  const isCompletedStatus = completedStatusMatcher(companyDoc?.projectStatuses);
  const completedStatus = isCompletedStatus(newStatus);
  // "Archive completed projects after: Instantly" archives it in this same write when it moves INTO the
  // completed status (not when it's already there — e.g. a restored project being re-saved — so a
  // restore sticks). The daily background sweep (archiveDueCompletedProjects) catches anything missed.
  const archivesOnCompletion = normalizeProjectArchiveDelay(companyDoc?.projectArchiveAfter) === "instant";
  let archivedNow = false;
  // Worked out from the stored project, not the caller's copy (a page that reopened and then
  // re-completed a project can still hold the old completedAtIso): the completion date carries over
  // only while the project moves between completed statuses, and is stamped fresh when it enters one.
  // It's what the archive delay counts from.
  const statusPatchFor = (stored: Record<string, unknown>) => {
    const storedCompletedAtIso = String(stored.completedAtIso ?? "").trim();
    const keepsCompletedAt = completedStatus && isCompletedStatus(stored.status) && Boolean(storedCompletedAtIso);
    const patch: Record<string, unknown> = {
      ...(extraPatch ?? {}),
      status: newStatus,
      updatedAtIso: nowIso,
      completedAtIso: completedStatus ? (keepsCompletedAt ? storedCompletedAtIso : nowIso) : "",
      dashboardSubStageId: nextSubStageId,
    };
    if (!keepsCompletedAt) patch.completedAt = completedStatus ? serverTimestamp() : null;
    // Moving an archived project back out of a completed status reopens it: it leaves the Archived
    // list, and its client portal link works again (an old soft-deleted one too). One archived by hand
    // while it wasn't completed stays archived through status changes — only Restore brings it back.
    if (!completedStatus && isCompletedStatus(stored.status) && (stored.isArchived === true || stored.isDeleted === true)) {
      patch.isArchived = false;
      patch.archivedAtIso = "";
      if (stored.isDeleted === true) {
        patch.isDeleted = false;
        patch.deletedAtIso = "";
      }
    }
    archivedNow = false;
    if (archivesOnCompletion && completedStatus && !isCompletedStatus(stored.status) && stored.isArchived !== true) {
      patch.isArchived = true;
      patch.archivedAtIso = nowIso;
      archivedNow = true;
    }
    return patch;
  };
  const announceArchived = () => {
    if (!archivedNow || typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent<ProjectsArchivedDetail>(PROJECTS_ARCHIVED_EVENT, {
        detail: { companyId: String(project.companyId || "").trim(), projectIds: [project.id], archivedAtIso: nowIso },
      }),
    );
  };
  const syncClientProfile = async (completedAtIso: string) => {
    const nextProjectSnapshot: Project = {
      ...project,
      statusLabel: newStatus,
      status: toProjectStatus(newStatus),
      updatedAt: nowIso,
      completedAtIso,
      // A real status change always resets the dashboard board's sub-stage drill-down field — it's
      // only ever meaningful against the status the project is CURRENTLY in (see lib/types.ts). The
      // caller (dashboard/page.tsx) computes this from the destination status's OWN configured
      // sub-stages (its first one, if any) — this function stays agnostic of that config shape.
      dashboardSubStageId: nextSubStageId,
    };
    await syncCompanyClientProfileFromProjectInternal(nextProjectSnapshot, {
      countCompletedProject: completedStatus,
      syncOnly: false,
    });
  };

  try {
    const topLevelRef = doc(db, "projects", project.id);
    const topLevelSnap = await getDoc(topLevelRef);
    if (topLevelSnap.exists()) {
      const patch = statusPatchFor((topLevelSnap.data() ?? {}) as Record<string, unknown>);
      await updateDoc(topLevelRef, patch);
      announceArchived();
      await syncClientProfile(String(patch.completedAtIso ?? ""));
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

    const patch = statusPatchFor((jobsSnap.docs[0].data() ?? {}) as Record<string, unknown>);
    await updateDoc(jobsSnap.docs[0].ref, patch);
    announceArchived();
    await syncClientProfile(String(patch.completedAtIso ?? ""));
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

// Archives a project by hand — what the project page's Archive button (it used to be Delete) does. It
// leaves the Dashboard and the calendar's project picker, its client portal link closes, and it's
// filed in the Archived list, where it can be restored or deleted permanently. Nothing deletes it
// automatically. Tells an open dashboard straight away (PROJECTS_ARCHIVED_EVENT).
export async function archiveProject(project: Project): Promise<boolean> {
  const archivedAtIso = new Date().toISOString();
  const ok = await updateProjectPatch(project, { isArchived: true, archivedAtIso });
  if (ok && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<ProjectsArchivedDetail>(PROJECTS_ARCHIVED_EVENT, {
        detail: { companyId: String(project.companyId || "").trim(), projectIds: [project.id], archivedAtIso },
      }),
    );
  }
  return ok;
}

// Takes a project back out of the Archived list (lib/project-archive.ts). archiveRestoredAtIso restarts
// its archive delay, so one still sitting in a completed status gets the full delay again — and its
// client portal link works again for that long — instead of being archived straight back the next
// time the archiver runs (under "Instantly", it stays out until it's completed again). Its completion
// date is left as it was. Also clears the old soft-delete flag, for a project that was deleted before
// Recently Deleted became part of Archived (see lib/project-archive.ts).
export async function restoreArchivedProject(project: Project): Promise<boolean> {
  return updateProjectPatch(project, {
    isArchived: false,
    archivedAtIso: "",
    archiveRestoredAtIso: new Date().toISOString(),
    isDeleted: false,
    deletedAtIso: "",
  });
}

// Archives the company's projects that have sat in a completed status for longer than Company
// Settings' "Archive completed projects after" (see isPastArchiveDelay). Under "Instantly" a project is
// archived by updateProjectStatus the moment it's completed; this still catches any that weren't (e.g.
// completed before the setting was chosen) — restored ones excepted. There's no server scheduler,
// so the app shell runs this in the background — at most once a day per company on each device, and
// only for someone who can edit every project (owner/admin or projects.edit.others), since it writes
// to all of them. Nothing is deleted. The client portal doesn't wait on it: its routes check the same
// rule themselves on every request. Returns the ids it archived.
const PROJECT_ARCHIVE_LAST_RUN_KEY = "cutsmart_project_archive_last_run_";
const PROJECT_ARCHIVE_RUN_EVERY_MS = 24 * 60 * 60 * 1000;
export async function archiveDueCompletedProjects(companyId: string, uid: string): Promise<string[]> {
  const cid = String(companyId || "").trim();
  const userId = String(uid || "").trim();
  if (!db || !cid || !userId || typeof window === "undefined") {
    return [];
  }
  const database = db;
  const companyDoc = await fetchCompanyDoc(cid);
  const delay = normalizeProjectArchiveDelay(companyDoc?.projectArchiveAfter);
  // Both checked before the once-a-day mark below, so switching the setting on (or being given the
  // permission) takes effect on the next load rather than a day later.
  if (!companyDoc || delay === "never") {
    return [];
  }
  const access = await fetchCompanyAccess(cid, userId);
  const role = String(access?.role || "").trim().toLowerCase();
  if (role !== "owner" && role !== "admin" && !hasPermissionKey(access?.permissionKeys, "projects.edit.others")) {
    return [];
  }
  const lastRunKey = `${PROJECT_ARCHIVE_LAST_RUN_KEY}${cid}`;
  try {
    const last = Number(window.localStorage.getItem(lastRunKey) || 0);
    if (Date.now() - last < PROJECT_ARCHIVE_RUN_EVERY_MS) return [];
    window.localStorage.setItem(lastRunKey, String(Date.now()));
  } catch {
    // storage unavailable — just run it
  }
  try {
    const isCompletedStatus = completedStatusMatcher(companyDoc.projectStatuses);
    const nowMs = Date.now();
    const snap = await getDocs(collection(database, "companies", cid, "jobs"));
    const due = snap.docs.filter((item) => {
      const data = (item.data() ?? {}) as Record<string, unknown>;
      return data.isArchived !== true && data.isDeleted !== true && isPastArchiveDelay(data, isCompletedStatus, delay, nowMs);
    });
    if (!due.length) {
      return [];
    }
    // updatedAt is left alone — being archived isn't an edit, and shouldn't move it up "recently updated".
    const archivedAtIso = new Date(nowMs).toISOString();
    for (let i = 0; i < due.length; i += 400) {
      const batch = writeBatch(database);
      due.slice(i, i + 400).forEach((item) => batch.update(item.ref, { isArchived: true, archivedAtIso }));
      await batch.commit();
    }
    const projectIds = due.map((item) => String(((item.data() ?? {}) as Record<string, unknown>).id ?? item.id));
    window.dispatchEvent(
      new CustomEvent<ProjectsArchivedDetail>(PROJECTS_ARCHIVED_EVENT, { detail: { companyId: cid, projectIds, archivedAtIso } }),
    );
    return projectIds;
  } catch {
    return [];
  }
}

// Removes a project for good — only ever from the Archived page, by someone choosing to (archived
// projects are never deleted automatically).
export async function permanentlyDeleteProject(project: Project): Promise<boolean> {
  if (!db || !project) {
    return false;
  }

  // Its contact keeps it in their history (marked deleted), so the contact still shows it.
  await syncCompanyClientProfileFromProjectInternal(project, {
    syncOnly: true,
    historyPatch: { deleted: true, deletedAtIso: new Date().toISOString() },
  }).catch(() => undefined);

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

// The one place that resolves a project's REAL Firestore document reference — `project.id` is a
// stored field value (see normalizeProject), not guaranteed to equal the actual document ID, so
// every reader/writer has to try `projects/{id}` first, then fall back to querying
// `companies/{companyId}/jobs` by its `id` field. Extracted from what used to be duplicated inline
// in both updateProjectPatch and grantTempProductionAccess; also reused by the version-history
// subcollection helpers below, since a subcollection has to hang off whichever of these two
// locations the project doc actually lives in.
export async function resolveProjectDocRef(project: Project): Promise<DocumentReference | null> {
  if (!db || !project) return null;
  try {
    const topLevelRef = doc(db, "projects", project.id);
    if ((await getDoc(topLevelRef)).exists()) return topLevelRef;
  } catch {
    // continue into nested company/jobs fallback
  }
  if (!project.companyId) return null;
  try {
    const jobsSnap = await getDocs(
      query(collection(db, "companies", project.companyId, "jobs"), where("id", "==", project.id), limit(1)),
    );
    return jobsSnap.empty ? null : jobsSnap.docs[0].ref;
  } catch {
    return null;
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

  const ref = await resolveProjectDocRef(project);
  if (!ref) return null;
  try {
    await updateDoc(ref, patch);
    return expiryIso;
  } catch {
    return null;
  }
}

// The project's sales data is stored once, as its top-level `sales` field. Saves used to write it four
// times — `sales`, a `salesJson` text copy, `projectSettings.sales`, and again inside a
// `projectSettingsJson` text copy of the settings (the text copies were for the old desktop app) — so
// every project carried it four times over, and the dashboard downloads every project in full. Any save
// that writes sales or settings now drops the copies (deleting them from the stored project too), and
// cleanUpLegacyProjectCopies clears them from older projects.
function withoutLegacyCopies(patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...patch };
  const settings = next.projectSettings;
  if (settings && typeof settings === "object" && !Array.isArray(settings) && "sales" in settings) {
    const rest = { ...(settings as Record<string, unknown>) };
    delete rest.sales;
    next.projectSettings = rest;
  }
  if ("projectSettings" in next || "projectSettingsJson" in next) {
    next.projectSettingsJson = deleteField();
  }
  if ("sales" in next || "salesJson" in next) {
    next.salesJson = deleteField();
    // (A whole `projectSettings` written in the same save already leaves its `sales` out — and
    // Firestore won't take a field and one of its own sub-fields in the same update.)
    if (!("projectSettings" in next)) next["projectSettings.sales"] = deleteField();
  }
  return next;
}

// What a stored project needs written to drop the old copies (see withoutLegacyCopies), or null if it
// has none. Anything that only exists as a copy is kept: moved to `sales` / `projectSettings` first.
function legacyCopiesCleanupPatch(data: Record<string, unknown>): Record<string, unknown> | null {
  const settings = asRecord(data.projectSettings);
  const hasSalesJson = "salesJson" in data;
  const hasSettingsJson = "projectSettingsJson" in data;
  const hasNestedSales = Boolean(settings && "sales" in settings);
  const salesIsText = typeof data.sales === "string";
  if (!hasSalesJson && !hasSettingsJson && !hasNestedSales && !salesIsText) return null;

  const parseObject = (value: unknown): Record<string, unknown> | null => {
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value === "string" && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
    return null;
  };
  const settingsFromText = parseObject(data.projectSettingsJson);
  const patch: Record<string, unknown> = {};
  if (!asRecord(data.sales)) {
    const sales =
      parseObject(data.sales) ?? parseObject(data.salesJson) ?? parseObject(settings?.sales) ?? parseObject(settingsFromText?.sales);
    if (sales) patch.sales = sales;
  }
  if ((!settings || !Object.keys(settings).length) && settingsFromText) {
    const restored = { ...settingsFromText };
    delete restored.sales;
    patch.projectSettings = restored;
  }
  if (hasSalesJson) patch.salesJson = deleteField();
  if (hasSettingsJson) patch.projectSettingsJson = deleteField();
  if (hasNestedSales && !("projectSettings" in patch)) patch["projectSettings.sales"] = deleteField();
  return Object.keys(patch).length ? patch : null;
}

// Clears the old copies from projects that still have them, quietly in the background after a project
// list loads. Each project only ever needs it once (a cleaned project has nothing left to clear, so later
// loads skip it). Leaves updatedAt alone, so cleaned projects don't jump to the top of "recently updated".
const legacyCleanupAttempted = new Set<string>();
function cleanUpLegacyProjectCopies(items: Array<{ ref: DocumentReference; patch: Record<string, unknown> }>) {
  const pending = items.filter((item) => !legacyCleanupAttempted.has(item.ref.path));
  if (!pending.length || typeof window === "undefined") return;
  pending.forEach((item) => legacyCleanupAttempted.add(item.ref.path));
  window.setTimeout(() => {
    void (async () => {
      // A few at a time, so it never competes with what the user is doing.
      for (let i = 0; i < pending.length; i += 3) {
        await Promise.all(
          pending.slice(i, i + 3).map((item) =>
            updateDoc(item.ref, item.patch).catch((error) => {
              console.warn("[cleanUpLegacyProjectCopies] write failed:", item.ref.path, error);
            }),
          ),
        );
      }
    })();
  }, 5000);
}

export async function updateProjectPatch(
  project: Project,
  patch: Record<string, unknown>,
): Promise<boolean> {
  if (!db || !project) {
    return false;
  }

  const nextPatch: Record<string, unknown> = {
    ...withoutLegacyCopies(patch),
    updatedAtIso: new Date().toISOString(),
  };

  const ref = await resolveProjectDocRef(project);
  if (!ref) {
    console.warn("[updateProjectPatch] could not resolve a Firestore document for project", project.id);
    return false;
  }
  try {
    await updateDoc(ref, nextPatch);
    return true;
  } catch (error) {
    console.warn("[updateProjectPatch] write failed:", error);
    return false;
  }
}

export async function fetchProjectUpdatedAtMarker(project: Project): Promise<string | null> {
  if (!db || !project) return null;
  try {
    const topLevelSnap = await getDoc(doc(db, "projects", project.id));
    if (topLevelSnap.exists()) {
      const data = topLevelSnap.data() as Record<string, unknown>;
      return String(data.updatedAtIso ?? data.updatedAt ?? "").trim() || null;
    }
  } catch {
    // continue into nested company/jobs fallback
  }
  if (!project.companyId) return null;
  try {
    const jobsSnap = await getDocs(
      query(collection(db, "companies", project.companyId, "jobs"), where("id", "==", project.id), limit(1)),
    );
    if (jobsSnap.empty) return null;
    const data = jobsSnap.docs[0].data() as Record<string, unknown>;
    return String(data.updatedAtIso ?? data.updatedAt ?? "").trim() || null;
  } catch {
    return null;
  }
}

// The two manually-saved version-history lists (Quote grid's "Save Version" history and the
// Specifications sheet's own equivalent) used to live as ever-growing arrays inside the project
// doc's `sales` object — which is itself mirrored 4x per save (see persistSalesPatch in
// app/(app)/projects/[projectId]/page.tsx), so every version byte was stored 4 times. That's what
// pushed a real project past Firestore's 1MB per-document limit. Each version is now its own small
// document in a subcollection hung off the project's resolved doc ref, so the collection can grow
// without ever risking the 1MB ceiling again.
type GridVersionKind = "quoteGridVersions" | "specificationsVersions";

export async function fetchGridVersions(project: Project, kind: GridVersionKind): Promise<SpecsGridVersion[]> {
  const ref = await resolveProjectDocRef(project);
  if (!ref) return [];
  try {
    const snap = await getDocs(query(collection(ref, kind), orderBy("version", "asc")));
    const out: SpecsGridVersion[] = [];
    for (const d of snap.docs) {
      // Pass the real Firestore doc ID explicitly — normalizeSpecsGridVersion falls back to
      // minting its own id when one isn't present, which must never be relied on here since this
      // id is what addresses the document for later patch/restore operations.
      const version = normalizeSpecsGridVersion({ ...d.data(), id: d.id });
      if (version) out.push(version);
    }
    return out;
  } catch (error) {
    console.warn(`[fetchGridVersions] ${kind} read failed:`, error);
    return [];
  }
}

// Single-document equivalent of fetchGridVersions — used to pull one version fresh from Firestore
// (e.g. re-reading the exact version a client-confirmation link is bound to, to see answers the
// client has saved since this page's own hydration effect last ran; see refreshSpecsConfirmationAnswers
// in app/(app)/projects/[projectId]/page.tsx) without re-fetching every other version too.
export async function fetchGridVersion(project: Project, kind: GridVersionKind, versionId: string): Promise<SpecsGridVersion | null> {
  const ref = await resolveProjectDocRef(project);
  if (!ref || !versionId) return null;
  try {
    const snap = await getDoc(doc(ref, kind, versionId));
    if (!snap.exists()) return null;
    return normalizeSpecsGridVersion({ ...snap.data(), id: snap.id });
  } catch (error) {
    console.warn(`[fetchGridVersion] ${kind}/${versionId} read failed:`, error);
    return null;
  }
}

export async function saveGridVersion(
  project: Project,
  kind: GridVersionKind,
  input: { name: string; version: number; savedAtIso: string; savedByName?: string; grid: SpecsGrid; capturedProjectMarker?: string; sentToClient?: boolean },
): Promise<SpecsGridVersion | null> {
  const ref = await resolveProjectDocRef(project);
  if (!ref) return null;
  try {
    // Firestore-generated id, not genSpecsRowId() — that generator was only ever used as an array
    // key before (a collision there would silently overwrite a sibling array entry, which never
    // mattered in practice); now the id addresses a real document via setDoc, where a collision
    // would silently clobber a different version's document. Mirrors createCompanyLead's own
    // doc(collection(db,...)) + setDoc idiom.
    const versionRef = doc(collection(ref, kind));
    const body: SpecsGridVersion = {
      id: versionRef.id,
      name: input.name,
      version: input.version,
      savedAtIso: input.savedAtIso,
      ...(input.savedByName ? { savedByName: input.savedByName } : {}),
      ...(input.capturedProjectMarker ? { capturedProjectMarker: input.capturedProjectMarker } : {}),
      ...(input.sentToClient ? { sentToClient: true } : {}),
      grid: input.grid,
    };
    // JSON round-trip before writing — Firestore rejects a literal `undefined` property value
    // outright, and this is the same defensive pattern used everywhere else version data is written.
    await setDoc(versionRef, JSON.parse(JSON.stringify(body)));
    return body;
  } catch (error) {
    console.warn(`[saveGridVersion] ${kind} write failed:`, error);
    return null;
  }
}

export async function updateGridVersionGrid(
  project: Project,
  kind: GridVersionKind,
  versionId: string,
  grid: SpecsGrid,
): Promise<boolean> {
  const ref = await resolveProjectDocRef(project);
  if (!ref) return false;
  try {
    await updateDoc(doc(ref, kind, versionId), { grid: JSON.parse(JSON.stringify(grid)) });
    return true;
  } catch (error) {
    console.warn(`[updateGridVersionGrid] ${kind}/${versionId} write failed:`, error);
    return false;
  }
}

// Flags an EXISTING version document as sent, without touching its grid — used when staff send a
// version they're already viewing from history rather than the live draft (see sendQuoteToClient
// in app/(app)/projects/[projectId]/page.tsx), so re-sending an old version never clones a
// redundant duplicate the way sending the live draft does.
export async function markGridVersionSentToClient(project: Project, kind: GridVersionKind, versionId: string): Promise<boolean> {
  const ref = await resolveProjectDocRef(project);
  if (!ref) return false;
  try {
    await updateDoc(doc(ref, kind, versionId), { sentToClient: true });
    return true;
  } catch (error) {
    console.warn(`[markGridVersionSentToClient] ${kind}/${versionId} write failed:`, error);
    return false;
  }
}

export async function deleteGridVersion(project: Project, kind: GridVersionKind, versionId: string): Promise<boolean> {
  const ref = await resolveProjectDocRef(project);
  if (!ref) return false;
  try {
    await deleteDoc(doc(ref, kind, versionId));
    return true;
  } catch (error) {
    console.warn(`[deleteGridVersion] ${kind}/${versionId} write failed:`, error);
    return false;
  }
}

// Cutlist rows — same reasoning and pattern as the grid-version subcollections above, applied to
// the project's own cutlist (previously the top-level `cutlist`/`cutlistJson` fields on the job
// doc, re-serialized in full on every single row edit). "production" is the real Production
// Cutlist; "initialMeasure" is reserved for the Initial Measure cutlist (currently still embedded
// in `sales.initialCutlist`, migrated separately later). Read side falls back to the legacy
// embedded field when this subcollection doc doesn't exist yet (project not touched since this
// shipped) — callers are expected to self-heal via saveCutlistData once they've read that legacy
// data, rather than this module doing it implicitly.
type CutlistDataKind = "production" | "initialMeasure";

export async function fetchCutlistData(project: Project, kind: CutlistDataKind): Promise<{ rows: unknown[] } | null> {
  const ref = await resolveProjectDocRef(project);
  if (!ref) return null;
  try {
    const snap = await getDoc(doc(ref, "cutlistData", kind));
    if (!snap.exists()) return null;
    const data = snap.data() as Record<string, unknown>;
    return { rows: Array.isArray(data.rows) ? data.rows : [] };
  } catch (error) {
    console.warn(`[fetchCutlistData] ${kind} read failed:`, error);
    return null;
  }
}

// Writes the subcollection doc AND clears the legacy embedded field on the parent job doc in one
// atomic batch — never two independent awaited calls, since a partial failure between them would
// silently lose data (subcollection written but legacy field still present, or vice versa).
export async function saveCutlistData(project: Project, kind: CutlistDataKind, rows: unknown[]): Promise<boolean> {
  if (!db) return false;
  const ref = await resolveProjectDocRef(project);
  if (!ref) return false;
  try {
    const batch = writeBatch(db);
    batch.set(doc(ref, "cutlistData", kind), {
      rows: JSON.parse(JSON.stringify(rows)),
      updatedAtIso: new Date().toISOString(),
    });
    if (kind === "production") {
      batch.update(ref, { cutlist: deleteField(), cutlistJson: deleteField(), updatedAtIso: new Date().toISOString() });
    } else {
      // initialMeasure's legacy source is nested inside the sales blob (sales.initialCutlist),
      // not a top-level field — dot-path delete clears it from the live `sales`/
      // `projectSettings.sales` object copies; the `salesJson`/`projectSettingsJson` string
      // mirrors are left as inert, unread dead weight (extractSalesPayloadFromProject/
      // extractLegacySalesFieldFromRawDoc both prefer the live object fields over those strings).
      batch.update(ref, {
        "sales.initialCutlist": deleteField(),
        "projectSettings.sales.initialCutlist": deleteField(),
        updatedAtIso: new Date().toISOString(),
      });
    }
    await batch.commit();
    return true;
  } catch (error) {
    console.warn(`[saveCutlistData] ${kind} write failed:`, error);
    return false;
  }
}

// Sales — live Quote grid and Specifications grid, one document per kind (same one-doc-per-kind
// shape as cutlistData's "production"/"initialMeasure" — each is always read/written as a single
// whole SpecsGrid, never addressed cell-by-cell via Firestore). This is the single heaviest
// payload that used to ride along inside the project doc's `sales` object (a rich spreadsheet
// document with per-cell formatting), 4x-mirrored on every save by persistSalesPatch — moving it
// here is what actually fixes that. `quoteGridLastClosedVersion` deliberately stays embedded (see
// normalizeProject's own comment) — not handled here.
type SalesGridKind = "quote" | "specifications";
const SALES_GRID_LEGACY_KEY: Record<SalesGridKind, string> = {
  quote: "quoteGrid",
  specifications: "specificationsGrid",
};

export async function fetchSalesGridData(project: Project, kind: SalesGridKind): Promise<{ grid: SpecsGrid } | null> {
  const ref = await resolveProjectDocRef(project);
  if (!ref) return null;
  try {
    const snap = await getDoc(doc(ref, "salesGrids", kind));
    if (!snap.exists()) return null;
    const grid = normalizeSpecsGrid((snap.data() as Record<string, unknown>).grid);
    return grid ? { grid } : null;
  } catch (error) {
    console.warn(`[fetchSalesGridData] ${kind} read failed:`, error);
    return null;
  }
}

// Writes the subcollection doc AND clears the legacy nested field (both the live `sales`/
// `projectSettings.sales` object copies — the `salesJson`/`projectSettingsJson` string mirrors
// are left as inert, unread dead weight, same reasoning as saveCutlistData's initialMeasure
// branch) in one atomic batch.
export async function saveSalesGridData(project: Project, kind: SalesGridKind, grid: SpecsGrid): Promise<boolean> {
  if (!db) return false;
  const ref = await resolveProjectDocRef(project);
  if (!ref) return false;
  try {
    const batch = writeBatch(db);
    batch.set(doc(ref, "salesGrids", kind), {
      grid: JSON.parse(JSON.stringify(grid)),
      updatedAtIso: new Date().toISOString(),
    });
    const legacyKey = SALES_GRID_LEGACY_KEY[kind];
    batch.update(ref, {
      [`sales.${legacyKey}`]: deleteField(),
      [`projectSettings.sales.${legacyKey}`]: deleteField(),
      updatedAtIso: new Date().toISOString(),
    });
    await batch.commit();
    return true;
  } catch (error) {
    console.warn(`[saveSalesGridData] ${kind} write failed:`, error);
    return false;
  }
}

// Checklists — one document PER checklist (unlike cutlistData's one-doc-per-kind, since a
// project's checklists are naturally independent records, not one array that's always read/
// written as a whole). This is what actually fixes the write-amplification problem: toggling one
// checkbox now writes exactly the one checklist it belongs to, not every checklist on the
// project. Returns null when the subcollection is empty, which is ambiguous on its own (a
// project can genuinely have zero checklists, or simply not be migrated yet) — the caller
// resolves that by also checking the legacy `checklists` field on the job doc itself.
export async function fetchProjectChecklistsData(project: Project): Promise<ProjectChecklist[] | null> {
  const ref = await resolveProjectDocRef(project);
  if (!ref) return null;
  try {
    const snap = await getDocs(collection(ref, "checklists"));
    if (snap.empty) return null;
    return normalizeProjectChecklists(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
  } catch (error) {
    console.warn("[fetchProjectChecklistsData] read failed:", error);
    return null;
  }
}

export async function saveProjectChecklist(project: Project, checklist: ProjectChecklist): Promise<boolean> {
  if (!db) return false;
  const ref = await resolveProjectDocRef(project);
  if (!ref) return false;
  try {
    await setDoc(
      doc(ref, "checklists", checklist.id),
      JSON.parse(
        JSON.stringify({
          name: checklist.name,
          items: checklist.items,
          ...(checklist.addedAt ? { addedAt: checklist.addedAt } : {}),
        }),
      ),
    );
    return true;
  } catch (error) {
    console.warn("[saveProjectChecklist] write failed:", error);
    return false;
  }
}

export async function deleteProjectChecklist(project: Project, checklistId: string): Promise<boolean> {
  if (!db) return false;
  const ref = await resolveProjectDocRef(project);
  if (!ref) return false;
  try {
    await deleteDoc(doc(ref, "checklists", checklistId));
    return true;
  } catch (error) {
    console.warn("[deleteProjectChecklist] write failed:", error);
    return false;
  }
}

// Migrate-on-read: writes every legacy checklist as its own subcollection doc AND clears the
// legacy embedded field in one atomic batch — same reasoning as saveCutlistData.
export async function migrateLegacyProjectChecklists(project: Project, checklists: ProjectChecklist[]): Promise<boolean> {
  if (!db) return false;
  const ref = await resolveProjectDocRef(project);
  if (!ref) return false;
  try {
    const batch = writeBatch(db);
    for (const checklist of checklists) {
      batch.set(
        doc(ref, "checklists", checklist.id),
        JSON.parse(
          JSON.stringify({
            name: checklist.name,
            items: checklist.items,
            ...(checklist.addedAt ? { addedAt: checklist.addedAt } : {}),
          }),
        ),
      );
    }
    batch.update(ref, { checklists: deleteField(), updatedAtIso: new Date().toISOString() });
    await batch.commit();
    return true;
  } catch (error) {
    console.warn("[migrateLegacyProjectChecklists] write failed:", error);
    return false;
  }
}

// Images/files — one doc per kind (images vs files), same reasoning as cutlistData/salesGrids:
// both are always read/written as one whole array (image upload/delete/annotation-edit and file
// upload/delete all already rewrite the entire relevant array today, capped at 10 images/10MB
// total files — bounded enough that doc-per-item wasn't worth the extra complexity here, unlike
// checklists). Moved out of the job doc's own `projectImages`/`projectImageItems`/`projectFiles`
// fields so opening a project doesn't download this — capped or not — on every single load.
export type ProjectMediaKind = "images" | "files";

export async function fetchProjectMediaData(project: Project, kind: ProjectMediaKind): Promise<Record<string, unknown> | null> {
  const ref = await resolveProjectDocRef(project);
  if (!ref) return null;
  try {
    const snap = await getDoc(doc(ref, "projectMedia", kind));
    if (!snap.exists()) return null;
    return snap.data() as Record<string, unknown>;
  } catch (error) {
    console.warn(`[fetchProjectMediaData] ${kind} read failed:`, error);
    return null;
  }
}

export async function saveProjectImagesData(
  project: Project,
  projectImages: string[],
  projectImageItems: ProjectImageItem[],
): Promise<boolean> {
  if (!db) return false;
  const ref = await resolveProjectDocRef(project);
  if (!ref) return false;
  try {
    const batch = writeBatch(db);
    batch.set(
      doc(ref, "projectMedia", "images"),
      JSON.parse(JSON.stringify({ projectImages, projectImageItems, updatedAtIso: new Date().toISOString() })),
    );
    batch.update(ref, { projectImages: deleteField(), projectImageItems: deleteField(), updatedAtIso: new Date().toISOString() });
    await batch.commit();
    return true;
  } catch (error) {
    console.warn("[saveProjectImagesData] write failed:", error);
    return false;
  }
}

export async function saveProjectFilesData(project: Project, projectFiles: unknown[]): Promise<boolean> {
  if (!db) return false;
  const ref = await resolveProjectDocRef(project);
  if (!ref) return false;
  try {
    const batch = writeBatch(db);
    batch.set(
      doc(ref, "projectMedia", "files"),
      JSON.parse(JSON.stringify({ projectFiles, updatedAtIso: new Date().toISOString() })),
    );
    batch.update(ref, { projectFiles: deleteField(), updatedAtIso: new Date().toISOString() });
    await batch.commit();
    return true;
  } catch (error) {
    console.warn("[saveProjectFilesData] write failed:", error);
    return false;
  }
}

// Product Compare tool (Initial Measure) — one small document per named comparison in its own
// subcollection, same "own doc, not an array on the project's `sales` object" reasoning as the
// grid-version helpers just above. See ProductComparison's own comment in lib/cutlist-types.ts.
function normalizeProductComparisonDoc(data: Record<string, unknown>, id: string): ProductComparison | null {
  const name = String(data.name ?? "").trim();
  const selectedRowIds = Array.isArray(data.selectedRowIds)
    ? data.selectedRowIds.map((v) => String(v ?? "").trim()).filter(Boolean)
    : [];
  const rawOverrides = (data.rowProductOverrides ?? {}) as Record<string, unknown>;
  const rowProductOverrides: Record<string, string> = {};
  if (rawOverrides && typeof rawOverrides === "object") {
    for (const [rowId, value] of Object.entries(rawOverrides)) {
      const trimmed = String(value ?? "").trim();
      if (rowId.trim() && trimmed) rowProductOverrides[rowId.trim()] = trimmed;
    }
  }
  const savedAtIso = String(data.savedAtIso ?? "").trim();
  const savedByName = String(data.savedByName ?? "").trim();
  return {
    id,
    name: name || "Untitled comparison",
    selectedRowIds,
    ...(Object.keys(rowProductOverrides).length > 0 ? { rowProductOverrides } : {}),
    savedAtIso: savedAtIso || new Date(0).toISOString(),
    ...(savedByName ? { savedByName } : {}),
  };
}

export async function fetchProductComparisons(project: Project): Promise<ProductComparison[]> {
  const ref = await resolveProjectDocRef(project);
  if (!ref) return [];
  try {
    const snap = await getDocs(collection(ref, "productComparisons"));
    const out: ProductComparison[] = [];
    for (const d of snap.docs) {
      const comparison = normalizeProductComparisonDoc(d.data() as Record<string, unknown>, d.id);
      if (comparison) out.push(comparison);
    }
    return out;
  } catch (error) {
    console.warn("[fetchProductComparisons] read failed:", error);
    return [];
  }
}

export async function saveProductComparison(
  project: Project,
  input: {
    name: string;
    selectedRowIds: string[];
    rowProductOverrides?: Record<string, string>;
    savedAtIso: string;
    savedByName?: string;
  },
): Promise<ProductComparison | null> {
  const ref = await resolveProjectDocRef(project);
  if (!ref) return null;
  try {
    const docRef = doc(collection(ref, "productComparisons"));
    const body: ProductComparison = {
      id: docRef.id,
      name: input.name,
      selectedRowIds: input.selectedRowIds,
      ...(input.rowProductOverrides && Object.keys(input.rowProductOverrides).length > 0 ? { rowProductOverrides: input.rowProductOverrides } : {}),
      savedAtIso: input.savedAtIso,
      ...(input.savedByName ? { savedByName: input.savedByName } : {}),
    };
    await setDoc(docRef, JSON.parse(JSON.stringify(body)));
    return body;
  } catch (error) {
    console.warn("[saveProductComparison] write failed:", error);
    return null;
  }
}

export async function updateProductComparison(
  project: Project,
  comparisonId: string,
  patch: Partial<Pick<ProductComparison, "name" | "selectedRowIds" | "rowProductOverrides">>,
): Promise<boolean> {
  const ref = await resolveProjectDocRef(project);
  if (!ref) return false;
  try {
    await updateDoc(doc(ref, "productComparisons", comparisonId), JSON.parse(JSON.stringify(patch)));
    return true;
  } catch (error) {
    console.warn(`[updateProductComparison] ${comparisonId} write failed:`, error);
    return false;
  }
}

export async function deleteProductComparison(project: Project, comparisonId: string): Promise<boolean> {
  const ref = await resolveProjectDocRef(project);
  if (!ref) return false;
  try {
    await deleteDoc(doc(ref, "productComparisons", comparisonId));
    return true;
  } catch (error) {
    console.warn(`[deleteProductComparison] ${comparisonId} write failed:`, error);
    return false;
  }
}

export async function fetchCompanyMembers(companyId: string): Promise<CompanyMemberOption[]> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) {
    return [];
  }
  // Shared for a minute (lib/firestore-cache.ts) — the calendar, dashboard, project page and app shell
  // all load the member list; each caller gets its own copies of the rows.
  try {
    const members = await cachedValue(`members:${cid}`, () => loadCompanyMembers(cid));
    return members.map((member) => ({ ...member }));
  } catch {
    return [];
  }
}

async function loadCompanyMembers(cid: string): Promise<CompanyMemberOption[]> {
  if (!db) return [];
  const firestore = db;

  try {
    const [companyDocData, snap] = await Promise.all([
      fetchCompanyDoc(cid),
      getDocs(collection(firestore, "companies", cid, "memberships")),
    ]);
    const companyData = companyDocData ?? {};
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
      // userColor first on both — see fetchUserColorMapByUids' own comment on why badgeColor can't
      // be trusted as the primary source (frozen by Firestore rules once ever set).
      const userColor = String(data.userColor ?? data.badgeColor ?? data.avatarColor ?? data.color ?? data.colour ?? "").trim();
      const badgeColor = String(data.userColor ?? data.badgeColor ?? data.avatarColor ?? data.color ?? data.colour ?? "").trim();
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
        joinCodeKey: String(data.joinCodeKey ?? "").trim() || undefined,
        joinedVia: String(data.joinedVia ?? "").trim() || undefined,
      });
    }

    // Company membership displayName/email/mobile/color is the source of truth once set — only
    // fall back to the user's own profile doc for whichever fields a legacy membership row is
    // still missing. This CANNOT be batched into a single where(documentId(),"in",[...]) query
    // the way it briefly was — firestore.rules only allows `users/{uid}` reads via `isSelf(uid)`,
    // which Firestore can only prove safe for a single-document get of the CALLER's own doc, never
    // for a multi-uid "in" query (it can't statically verify every id in that array is the
    // caller's), so a batched query here gets permission-denied outright for any company with
    // more than one staff member. Back to one getDoc per member — each one individually succeeds
    // for the caller's own doc and permission-denies (caught, ignored) for every other member's,
    // exactly as Firestore's rules require. What's still NOT redone here is the separate,
    // genuinely redundant fetchUserColorMapByUids pass that used to run after this loop — it only
    // ever re-derived a color already sitting right here in `out` from the bulk membership read
    // above, or re-did this exact same users/{uid} fallback a second time.
    // Only the signed-in user's own profile can be read (every other member's read is refused by the
    // rules — those reads used to be attempted anyway, one per member, all failing), and that one
    // comes from the shared cache sign-in already filled.
    const selfUid = String(auth?.currentUser?.uid || "").trim();
    await Promise.all(
      out.map(async (member) => {
        const uid = String(member.uid || "").trim();
        if (!uid || uid !== selfUid) return;
        try {
          const userData = await readUserDocCached(uid);
          if (!userData) return;
          const profileDisplayName = String(userData.displayName ?? userData.name ?? "").trim();
          const profileEmail = String(userData.email ?? "").trim();
          const profileMobile = String(userData.mobile ?? userData.phone ?? "").trim();
          const profileColor = String(
            userData.userColor ?? userData.badgeColor ?? userData.avatarColor ?? userData.color ?? userData.colour ?? "",
          ).trim();
          if (!displayNameOverridesByUid[uid] && !member.membershipDisplayName && profileDisplayName) {
            member.displayName = profileDisplayName;
          }
          if (!member.email && profileEmail) member.email = profileEmail;
          if (!member.mobile && profileMobile) member.mobile = profileMobile;
          if (!member.userColor && profileColor) member.userColor = profileColor;
          if (!member.badgeColor && profileColor) member.badgeColor = profileColor;
        } catch {
          // ignore per-user profile lookup errors (expected for every member who isn't the caller)
        }
      }),
    );

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
    invalidateCompanyCache(cid);
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
    invalidateCompanyCache(cid);
    return { ok: true };
  } catch (error) {
    const message =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "company-role-write-failed")
        : String((error as { message?: unknown } | null)?.message ?? "company-role-write-failed");
    return { ok: false, error: message };
  }
}

// The company data tied to one staff member that can be handed to someone else when they're removed
// (Company Settings > Staff > remove). What each kind covers, and what happens to it when it isn't
// transferred, is described in app/api/company/remove-member/route.ts (TRANSFER_KINDS).
export type MemberRemovalDataKind = "assignedProjects" | "createdProjects" | "contacts" | "leads" | "calendarEvents";
export type MemberRemovalCounts = Record<MemberRemovalDataKind, number>;

function toMemberRemovalCounts(raw: unknown): MemberRemovalCounts {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const num = (key: MemberRemovalDataKind) => Math.max(0, Number(row[key]) || 0);
  return {
    assignedProjects: num("assignedProjects"),
    createdProjects: num("createdProjects"),
    contacts: num("contacts"),
    leads: num("leads"),
    calendarEvents: num("calendarEvents"),
  };
}

async function postRemoveMemberRequest(payload: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const idToken = await auth!.currentUser!.getIdToken();
  const res = await fetch("/api/company/remove-member", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.ok && data.ok ? 200 : res.status || 500, data };
}

// How much company data is tied to a staff member, per kind — read before the remove pop-up opens so
// it can show what there is to hand over. Same server route (and permission check) as the removal.
export async function previewCompanyMemberRemoval(
  companyId: string,
  uid: string,
): Promise<{ ok: boolean; error?: string; counts: MemberRemovalCounts | null }> {
  const cid = String(companyId || "").trim();
  const userId = String(uid || "").trim();
  if (!auth?.currentUser || !cid || !userId) {
    return { ok: false, error: "missing-firebase-company-or-user-id", counts: null };
  }
  try {
    const { status, data } = await postRemoveMemberRequest({ mode: "preview", companyId: cid, uid: userId });
    if (status !== 200) {
      return { ok: false, error: String(data.error || `request-failed-${status}`), counts: null };
    }
    return { ok: true, counts: toMemberRemovalCounts(data.counts) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "remove-member-preview-failed";
    return { ok: false, error: message, counts: null };
  }
}

// Removing a staff member runs server-side (app/api/company/remove-member) rather than as direct
// client-SDK writes — firestore.rules has always had `allow delete: if false` on
// companies/{companyId}/memberships/{uid} with no exception (the actual "who can remove staff"
// check, lib/membership.ts's staff.remove/owner resolution, needs a search through the company
// doc's `roles` array that Firestore rules can't express), so a direct client delete here was
// guaranteed to fail with permission-denied for every caller, always. The route re-derives that
// same permission server-side with the Admin SDK instead. It also does the data hand-over (projects,
// contacts, leads — which only the server can write — and calendar events) in the same request,
// before the membership goes, so a failure part-way never leaves a removed member's data half-moved.
export async function removeCompanyMemberDetailed(
  companyId: string,
  uid: string,
  options?: {
    transferToUid?: string;
    transferToName?: string;
    // Which kinds of their data go to transferToUid. Omitted = only their active projects (the old
    // behaviour, when a transferToUid is given).
    transfer?: Partial<Record<MemberRemovalDataKind, boolean>>;
  },
): Promise<{
  ok: boolean;
  error?: string;
  transferredProjects: number;
  transferred?: MemberRemovalCounts;
  unassigned?: { assignedProjects: number; leads: number };
  // Contacts not transferred because the recipient already has a matching one (email, phone or name).
  skippedContacts?: number;
}> {
  const cid = String(companyId || "").trim();
  const userId = String(uid || "").trim();
  if (!auth?.currentUser || !cid || !userId) {
    return { ok: false, error: "missing-firebase-company-or-user-id", transferredProjects: 0 };
  }
  try {
    const { status, data } = await postRemoveMemberRequest({
      companyId: cid,
      uid: userId,
      transferToUid: String(options?.transferToUid || "").trim(),
      transferToName: String(options?.transferToName || "").trim(),
      ...(options?.transfer ? { transfer: options.transfer } : {}),
    });
    if (status !== 200) {
      return { ok: false, error: String(data.error || `request-failed-${status}`), transferredProjects: Number(data.transferredProjects || 0) };
    }
    // The company doc's staff maps and the memberships just changed.
    invalidateCompanyCache(cid);
    const unassignedRaw = data.unassigned && typeof data.unassigned === "object" ? (data.unassigned as Record<string, unknown>) : {};
    return {
      ok: true,
      transferredProjects: Number(data.transferredProjects || 0),
      transferred: toMemberRemovalCounts(data.transferred),
      unassigned: {
        assignedProjects: Math.max(0, Number(unassignedRaw.assignedProjects) || 0),
        leads: Math.max(0, Number(unassignedRaw.leads) || 0),
      },
      skippedContacts: Math.max(0, Number(data.skippedContacts) || 0),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "remove-member-request-failed";
    return { ok: false, error: message, transferredProjects: 0 };
  }
}

export async function fetchCompanyDoc(companyId: string): Promise<Record<string, unknown> | null> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) {
    return null;
  }
  // Through the shared short-lived cache (lib/firestore-cache.ts) — nearly every page and the app
  // shell read this on load. A shallow copy each time, so no caller can change another's copy.
  try {
    const data = await readCompanyDocCached(cid);
    return data ? { ...data } : null;
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
          highlights: normalizeWhatsNewHighlights(data.highlights),
          publishedAtIso: String(data.publishedAtIso || "") || undefined,
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
  // The project is archived (still opens, read-only) — or deleted for good, when only this row is left
  // of it. A contact keeps every project it's ever had in its history, so these stay listed (under Past
  // Projects) after the project itself is archived or gone.
  archived?: boolean;
  deleted?: boolean;
  deletedAtIso?: string;
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
  category: string;
  archived: boolean;
  // When it was archived (cleared on restore). Contacts archived before this was stored have none — the
  // Archived page falls back to updatedAtIso for those.
  archivedAtIso?: string;
  // A permanently deleted contact (from the Archived page). Its doc is kept as a tombstone instead of
  // being removed, because contacts are also derived from projects: without it the same person would
  // reappear from their projects straight away. A tombstone is never listed anywhere (not even in
  // Archived) and hides that person's projects from before deletedAtIso — see clientTombstoneHidesProject.
  deleted?: boolean;
  deletedAtIso?: string;
  createdAtIso: string;
  updatedAtIso: string;
  firstProjectAtIso: string;
  lastProjectAtIso: string;
  lastProjectId: string;
  projectCount: number;
  createdByUids: string[];
  assignedToUids: string[];
  history: CompanyClientProjectHistoryRow[];
};

// Whether a permanently deleted contact (tombstone) still hides a project of that person: only the
// projects that existed when it was deleted. A project created afterwards is a returning client, who
// gets a fresh contact card instead of staying invisible for good.
function clientTombstoneHidesProject(row: CompanyClientRow, projectCreatedIso: string | undefined): boolean {
  if (!row.deleted) return false;
  const deletedMs = Date.parse(String(row.deletedAtIso || ""));
  const createdMs = Date.parse(String(projectCreatedIso || ""));
  return !Number.isFinite(deletedMs) || !Number.isFinite(createdMs) || createdMs <= deletedMs;
}

type CompanyClientViewerFilter = {
  viewerUid?: string;
  includeAll?: boolean;
  // Archived contacts are excluded from fetchCompanyClients by default (that's the whole point of
  // archiving — it removes them from the main list); pass true to include them anyway.
  includeArchived?: boolean;
};

function toCompanyClientSummaryRow(row: CompanyClientRow): CompanyClientRow {
  return {
    ...row,
    history: [],
  };
}

function normalizeUidList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
}

function mergeUidLists(...lists: Array<string[] | undefined>): string[] {
  return Array.from(
    new Set(
      lists
        .flatMap((list) => list ?? [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
}

function canViewerAccessCompanyClientRow(row: CompanyClientRow, filter?: CompanyClientViewerFilter): boolean {
  if (filter?.includeAll) return true;
  const viewerUid = String(filter?.viewerUid || "").trim();
  if (!viewerUid) return false;
  return row.createdByUids.includes(viewerUid) || row.assignedToUids.includes(viewerUid);
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
    category: next.category || existing.category,
    // Archiving is a sticky, explicit user decision — a newly-synced project for the same person
    // (which always arrives with archived: false) must never silently un-archive them.
    archived: Boolean(existing.archived || next.archived),
    createdAtIso: existing.createdAtIso || next.createdAtIso,
    updatedAtIso: pickLaterIso(existing.updatedAtIso, next.updatedAtIso),
    firstProjectAtIso: pickEarlierIso(existing.firstProjectAtIso, next.firstProjectAtIso),
    lastProjectAtIso: pickLaterIso(existing.lastProjectAtIso, next.lastProjectAtIso),
    lastProjectId: next.lastProjectId || existing.lastProjectId,
    projectCount: Math.max(existing.projectCount, next.projectCount, mergedHistory.length),
    createdByUids: mergeUidLists(existing.createdByUids, next.createdByUids),
    assignedToUids: mergeUidLists(existing.assignedToUids, next.assignedToUids),
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

export function isCompletedClientProjectStatus(value: unknown): boolean {
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
    archived: project.isArchived === true || (project as unknown as Record<string, unknown>).isDeleted === true,
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
    category: "",
    archived: false,
    createdAtIso: String(project.createdAt || project.updatedAt || "").trim(),
    updatedAtIso: String(project.updatedAt || project.createdAt || "").trim(),
    firstProjectAtIso: String(project.createdAt || project.updatedAt || "").trim(),
    lastProjectAtIso: String(project.updatedAt || project.createdAt || "").trim(),
    lastProjectId: String(project.id || "").trim(),
    projectCount: 1,
    createdByUids: mergeUidLists([String(project.createdByUid || "").trim()]),
    assignedToUids: mergeUidLists([String(project.assignedToUid || "").trim()]),
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

// A permanently deleted contact (tombstone) that still covers this project wins, so the caller leaves it
// alone; one deleted before this project existed is skipped, so a returning client gets a live card.
async function findMatchingCompanyClientRow(companyId: string, project: Project): Promise<CompanyClientRow | null> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) return null;
  try {
    const snap = await getDocs(collection(db, "companies", cid, "clients"));
    const rows = snap.docs
      .filter((docSnap) => docSnap.id !== "__meta")
      .map((docSnap) => buildCompanyClientRowFromDoc(cid, docSnap.id, (docSnap.data() ?? {}) as Record<string, unknown>))
      .filter((row) => projectMatchesClientRow(project, row));
    return (
      rows.find((row) => clientTombstoneHidesProject(row, project.createdAt)) ??
      rows.find((row) => !row.deleted) ??
      null
    );
  } catch {
    return null;
  }
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
    category: String(data.category ?? "").trim(),
    archived: Boolean(data.archived),
    archivedAtIso: toIsoString(data.archivedAtIso, ""),
    deleted: data.deleted === true,
    deletedAtIso: toIsoString(data.deletedAtIso, ""),
    createdAtIso: toIsoString(data.createdAtIso ?? data.createdAt, ""),
    updatedAtIso: toIsoString(data.updatedAtIso ?? data.updatedAt, ""),
    firstProjectAtIso: toIsoString(data.firstProjectAtIso ?? data.firstProjectAt, ""),
    lastProjectAtIso: toIsoString(data.lastProjectAtIso ?? data.lastProjectAt, ""),
    lastProjectId: String(data.lastProjectId ?? "").trim(),
    projectCount: Number(data.projectCount ?? 0) || 0,
    createdByUids: normalizeUidList(data.createdByUids),
    assignedToUids: normalizeUidList(data.assignedToUids),
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
      archived: row.archived === true,
      deleted: row.deleted === true,
      deletedAtIso: toIsoString(row.deletedAtIso, ""),
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
  // historyPatch: extra on this project's history row (permanentlyDeleteProject marks it deleted).
  options?: { countCompletedProject?: boolean; syncOnly?: boolean; historyPatch?: Partial<CompanyClientProjectHistoryRow> },
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
    // This person's contact was deleted permanently and this project is one of theirs from before
    // that — nothing to write (writing would start rebuilding the deleted card).
    if (currentRow?.deleted) {
      return { ok: false };
    }
    const currentHistory = currentRow?.history.slice() ?? [];
    const currentCreatedByUids = mergeUidLists(
      currentRow?.createdByUids,
      normalizeUidList(existing?.createdByUids),
      [String(project.createdByUid || "").trim()],
    );
    const currentAssignedToUids = mergeUidLists(
      currentRow?.assignedToUids,
      normalizeUidList(existing?.assignedToUids),
      [String(project.assignedToUid || "").trim()],
    );
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
    }
    // This project's row in the contact's history, added or brought up to date — every project the
    // contact has ever had stays there, so it's still listed after it's archived or deleted.
    const historyProjectId = String(project.id || "").trim();
    if (historyProjectId) {
      const historyRow = { ...buildCompanyClientProjectHistory(project), ...(options?.historyPatch ?? {}) };
      const existingIndex = currentHistory.findIndex((row) => row.projectId === historyProjectId);
      if (existingIndex >= 0) currentHistory[existingIndex] = historyRow;
      else currentHistory.push(historyRow);
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
    // An existing contact card's own details are never overwritten from a project here — the project
    // only fills in fields the card doesn't have yet. Changing a card's details from project client
    // details is an explicit choice the project page asks the user about ("Update contact card?").
    const cardEmail = String(currentRow?.email || "").trim();
    const payload: Record<string, unknown> = {
      id: clientId,
      companyId: cid,
      name: String(currentRow?.name || project.customer || "").trim(),
      email: cardEmail || emailNormalized || email,
      emailNormalized: normalizeClientEmail(cardEmail) || emailNormalized,
      phone: String(currentRow?.phone || project.clientPhone || "").trim(),
      address: String(currentRow?.address || project.clientAddress || "").trim(),
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
      createdByUids: currentCreatedByUids,
      assignedToUids: currentAssignedToUids,
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

export async function fetchCompanyClients(companyId: string, filter?: CompanyClientViewerFilter): Promise<CompanyClientRow[]> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) return [];

  const merged = new Map<string, CompanyClientRow>();

  // Split persisted rows into archived vs active, and check project candidates against the archived
  // identities BEFORE adding them to `merged` at all. An archived contact must never reappear just
  // because the project-derived pass below independently re-matches/re-keys them slightly
  // differently than a straight row.id lookup would — this makes the exclusion correct regardless of
  // whether findMatchingClientIdInMap happens to land on the same map key as the persisted row's id.
  // Permanently deleted contacts (tombstones) are never listed, and hide their projects the same way an
  // archived contact does — but only the projects from before they were deleted.
  let archivedRows: CompanyClientRow[] = [];
  let tombstoneRows: CompanyClientRow[] = [];
  try {
    const clientsSnap = await getDocs(collection(db, "companies", cid, "clients"));
    const persistedRows = clientsSnap.docs
      .map((docSnap) => buildCompanyClientRowFromDoc(cid, docSnap.id, (docSnap.data() ?? {}) as Record<string, unknown>))
      .filter((row) => row.id && row.id !== "__meta");
    tombstoneRows = persistedRows.filter((row) => row.deleted);
    archivedRows = filter?.includeArchived ? [] : persistedRows.filter((row) => row.archived && !row.deleted);
    for (const row of persistedRows) {
      if (row.deleted || (row.archived && !filter?.includeArchived)) continue;
      merged.set(row.id, row);
    }
  } catch {
    // continue into project-derived merge
  }

  try {
    const projects = await collectCompanyProjectsForClients(cid);
    for (const project of projects) {
      // A project linked to a card (clientId) belongs to that card, whatever its client details say now —
      // that link is what keeps a changed phone/email from splitting the project off into a duplicate.
      const linkedId = String(project.clientId || "").trim();
      if (linkedId ? archivedRows.some((row) => row.id === linkedId) : archivedRows.some((archivedRow) => projectMatchesClientRow(project, archivedRow))) continue;
      if (
        linkedId
          ? tombstoneRows.some((row) => row.id === linkedId)
          : tombstoneRows.some((row) => clientTombstoneHidesProject(row, project.createdAt) && projectMatchesClientRow(project, row))
      ) {
        continue;
      }
      const derived = buildCompanyClientRowFromProject(project);
      const matchId = (linkedId && merged.has(linkedId) ? linkedId : "") || findMatchingClientIdInMap(merged, project) || derived.id;
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

  return Array.from(merged.values())
    .filter((row) => canViewerAccessCompanyClientRow(row, filter))
    .filter((row) => filter?.includeArchived || !row.archived)
    .sort((a, b) => {
    const aName = String(a.name || a.email).trim().toLowerCase();
    const bName = String(b.name || b.email).trim().toLowerCase();
    return aName.localeCompare(bName);
  });
}

export async function fetchCompanyClientById(
  companyId: string,
  clientId: string,
  filter?: CompanyClientViewerFilter,
): Promise<CompanyClientRow | null> {
  const cid = String(companyId || "").trim();
  const id = String(clientId || "").trim();
  if (!db || !cid || !id) return null;
  try {
    const snap = await getDoc(doc(db, "companies", cid, "clients", id));
    if (snap.exists()) {
      const row = buildCompanyClientRowFromDoc(cid, snap.id, (snap.data() ?? {}) as Record<string, unknown>);
      return !row.deleted && canViewerAccessCompanyClientRow(row, filter) ? row : null;
    }
    const projects = await collectCompanyProjectsForClients(cid);
    const merged = new Map<string, CompanyClientRow>();
    for (const project of projects) {
      const derived = buildCompanyClientRowFromProject(project);
      const linkedId = String(project.clientId || "").trim();
      const matchId = (linkedId && merged.has(linkedId) ? linkedId : "") || findMatchingClientIdInMap(merged, project) || derived.id;
      merged.set(matchId, mergeCompanyClientRows(merged.get(matchId), { ...derived, id: matchId }));
    }
    const row = merged.get(id) ?? null;
    return row && canViewerAccessCompanyClientRow(row, filter) ? row : null;
  } catch {
    return null;
  }
}

// The contact card a project's client details correspond to, as the given viewer would find it on the
// Contacts page — or null when that viewer has no card for this client there (none saved, archived, or
// saved but not visible to them). Mirrors fetchCompanyClients' rules: the project's linked clientId or
// the same email -> phone -> name(+address) match, archived cards hidden, and a card is visible to
// anyone with "view all", its own creators/assignees, or this project's own creator/assignee (the
// Contacts page folds each project's people into the matching card). With no saved card at all, the
// Contacts page still lists one derived from the project for that project's creator/assignee, so
// that counts too (as an uncategorised card under the project-derived id). Read failures throw, so a
// caller can tell "no card" apart from "couldn't check".
// `persisted` is false for that project-derived card (no saved doc yet, so nothing to link or update).
export async function findCompanyClientForProject(
  companyId: string,
  project: Project,
  filter?: CompanyClientViewerFilter,
): Promise<{ contact: CompanyClientRow; persisted: boolean } | null> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) return null;
  if (!normalizeClientEmail(project.clientEmail) && !normalizeClientPhone(project.clientPhone) && !String(project.customer || "").trim()) {
    return null;
  }
  const viewerUid = String(filter?.viewerUid || "").trim();
  const viewerOnProject =
    Boolean(viewerUid) &&
    (String(project.createdByUid || "").trim() === viewerUid || String(project.assignedToUid || "").trim() === viewerUid);
  const linkedId = String(project.clientId || "").trim();
  // A project already linked to its card only ever uses that card (below), so read just that one —
  // reading every contact is only needed to match an unlinked project by its client details.
  let linked: CompanyClientRow | undefined;
  let matches: CompanyClientRow[] = [];
  if (linkedId && linkedId !== "__meta") {
    const linkedSnap = await getDoc(doc(db, "companies", cid, "clients", linkedId));
    if (linkedSnap.exists()) {
      linked = buildCompanyClientRowFromDoc(cid, linkedSnap.id, (linkedSnap.data() ?? {}) as Record<string, unknown>);
    }
  }
  if (!linked) {
    const snap = await getDocs(collection(db, "companies", cid, "clients"));
    matches = snap.docs
      .filter((docSnap) => docSnap.id !== "__meta")
      .map((docSnap) => buildCompanyClientRowFromDoc(cid, docSnap.id, (docSnap.data() ?? {}) as Record<string, unknown>))
      .filter((row) => (linkedId && row.id === linkedId) || projectMatchesClientRow(project, row));
    linked = matches.find((row) => row.id === linkedId);
  }
  // A linked project only ever belongs to its own card — field look-alikes don't count. A permanently
  // deleted card hides the project like an archived one, unless the project is newer than the deletion
  // (a returning client — that card simply doesn't count).
  const candidates = (linked ? [linked] : matches).filter((row) => !row.deleted || row.id === linkedId || clientTombstoneHidesProject(row, project.createdAt));
  if (candidates.some((row) => row.archived || row.deleted)) return null;
  if (!candidates.length) {
    return filter?.includeAll || viewerOnProject ? { contact: buildCompanyClientRowFromProject(project), persisted: false } : null;
  }
  // Twin docs for the same person can exist (see findMatchingCompanyClientRowsByFields); the category
  // may only be saved on one of them.
  const best = { ...candidates[0] };
  best.category = best.category || candidates.find((row) => row.category)?.category || "";
  return filter?.includeAll || viewerOnProject || candidates.some((row) => canViewerAccessCompanyClientRow(row, filter))
    ? { contact: best, persisted: true }
    : null;
}

export type ManualCompanyClientInput = {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  category?: string;
};

function inputMatchesClientRow(input: ManualCompanyClientInput, row: CompanyClientRow): boolean {
  const inputEmail = normalizeClientEmail(input.email);
  const rowEmail = normalizeClientEmail(row.emailNormalized || row.email);
  if (inputEmail && rowEmail) {
    return inputEmail === rowEmail;
  }

  const inputPhone = normalizeClientPhone(input.phone);
  const rowPhone = normalizeClientPhone(row.phone);
  if (inputPhone && rowPhone) {
    return inputPhone === rowPhone;
  }

  const inputName = normalizeClientNameKey(input.name);
  const rowName = normalizeClientNameKey(row.name);
  const inputAddress = normalizeClientAddressKey(input.address);
  const rowAddress = normalizeClientAddressKey(row.address);
  if (inputName && rowName && inputAddress && rowAddress) {
    return inputName === rowName && inputAddress === rowAddress;
  }
  if (inputName && rowName) {
    return inputName === rowName;
  }
  return false;
}

// Every persisted client doc that is the same person as `input` — there can be more than one (project
// sync writes a doc under a random uid while other docs may carry the same email/phone/name).
async function findMatchingCompanyClientRowsByFields(
  companyId: string,
  input: ManualCompanyClientInput,
  alsoMatchId?: string,
  // A write that decides "no doc exists yet, create one" must not mistake a failed read for "none" —
  // callers like that pass strict so the error propagates instead of coming back as an empty list.
  strict = false,
): Promise<CompanyClientRow[]> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) return [];
  const matches: CompanyClientRow[] = [];
  try {
    const snap = await getDocs(collection(db, "companies", cid, "clients"));
    for (const docSnap of snap.docs) {
      if (docSnap.id === "__meta") continue;
      const row = buildCompanyClientRowFromDoc(cid, docSnap.id, (docSnap.data() ?? {}) as Record<string, unknown>);
      if ((alsoMatchId && row.id === alsoMatchId) || inputMatchesClientRow(input, row)) {
        matches.push(row);
      }
    }
  } catch (error) {
    if (strict) throw error;
    return [];
  }
  return matches;
}

// Manually adding a contact goes through the exact same email -> phone -> name+address matching used
// for projects (inputMatchesClientRow mirrors projectMatchesClientRow) so a contact a second user adds
// for someone who already exists (as a project-derived client or another user's contact) attaches to
// that same record — unioning the acting user into createdByUids/assignedToUids — instead of creating
// a duplicate. canViewerAccessCompanyClientRow already grants visibility to the creator, the assigned
// user, or anyone with the "view all" permission, so populating those two arrays is all that's needed.
export async function createOrAttachManualCompanyClient(
  companyId: string,
  input: ManualCompanyClientInput,
  actingUid: string,
): Promise<{ ok: boolean; clientId?: string; merged?: boolean }> {
  const cid = String(companyId || "").trim();
  const uid = String(actingUid || "").trim();
  const name = String(input.name || "").trim();
  const email = String(input.email || "").trim();
  const emailNormalized = normalizeClientEmail(email);
  const phone = String(input.phone || "").trim();
  const address = String(input.address || "").trim();
  const notes = String(input.notes || "").trim();
  const category = String(input.category || "").trim();
  if (!db || !cid || !uid || (!name && !emailNormalized && !phone)) {
    return { ok: false };
  }

  const nowIso = new Date().toISOString();
  try {
    await ensureCompanyClientsSection(cid);
    const matchedRows = await findMatchingCompanyClientRowsByFields(cid, input);
    const existingRow = matchedRows[0] ?? null;
    const clientId = existingRow?.id || createCompanyClientUid();
    const clientRef = doc(db, "companies", cid, "clients", clientId);

    if (existingRow) {
      const payload: Record<string, unknown> = {
        name: existingRow.name || name,
        email: existingRow.email || email,
        emailNormalized: existingRow.emailNormalized || emailNormalized,
        phone: existingRow.phone || phone,
        address: existingRow.address || address,
        notes: existingRow.notes || notes,
        category: existingRow.category || category,
        // Deliberately adding someone who was previously archived — or deleted permanently — brings
        // them back to the main list.
        archived: false,
        archivedAtIso: "",
        deleted: false,
        deletedAtIso: "",
        updatedAt: serverTimestamp(),
        updatedAtIso: nowIso,
        createdByUids: mergeUidLists(existingRow.createdByUids, [uid]),
        assignedToUids: mergeUidLists(existingRow.assignedToUids, [uid]),
      };
      await setDoc(clientRef, payload, { merge: true });
      // Archiving writes every doc that is the same person, so un-archive all of them or the archived
      // twins would keep hiding this contact's project-derived rows (same for a permanent delete).
      for (const twin of matchedRows.slice(1)) {
        if (twin.archived || twin.deleted) {
          await setDoc(
            doc(db, "companies", cid, "clients", twin.id),
            { archived: false, archivedAtIso: "", deleted: false, deletedAtIso: "" },
            { merge: true },
          );
        }
      }
      return { ok: true, clientId, merged: true };
    }

    const payload: Record<string, unknown> = {
      id: clientId,
      companyId: cid,
      name,
      email,
      emailNormalized,
      phone,
      address,
      notes,
      category,
      archived: false,
      createdAt: serverTimestamp(),
      createdAtIso: nowIso,
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso,
      firstProjectAtIso: "",
      lastProjectAtIso: "",
      lastProjectId: "",
      projectCount: 0,
      createdByUids: [uid],
      assignedToUids: [uid],
      completedProjectIds: [],
      history: [],
    };
    await setDoc(clientRef, payload, { merge: true });
    return { ok: true, clientId, merged: false };
  } catch {
    return { ok: false };
  }
}

// A contact row on the Contacts page is not always a persisted client doc: the read path keys
// job-derived contacts by an identity key (client_<email>, client_<name>, ...) while the doc project sync
// persisted for the same person has a random uid, and a contact that only exists as job data has no doc
// at all. So when the caller passes the `contact` row it is looking at, a write goes to EVERY persisted
// doc that is the same person (the row's own id, plus the same email -> phone -> name matching used for
// dedup), and if there is none one is created at the row's id carrying the row's identity. Without that,
// an archive/edit aimed at the derived id found no doc and silently did nothing.
export async function updateCompanyClientProfile(
  companyId: string,
  clientId: string,
  patch: Partial<Pick<CompanyClientRow, "name" | "email" | "phone" | "address" | "notes" | "category" | "archived">>,
  filter?: CompanyClientViewerFilter,
  contact?: CompanyClientRow | null,
): Promise<{ ok: boolean }> {
  const cid = String(companyId || "").trim();
  const id = String(clientId || "").trim();
  if (!db || !cid || !id) return { ok: false };
  try {
    let targets: CompanyClientRow[];
    if (contact) {
      // A permanently deleted twin of the same person stays as it is.
      targets = (
        await findMatchingCompanyClientRowsByFields(
          cid,
          { name: contact.name, email: contact.email || contact.emailNormalized, phone: contact.phone, address: contact.address },
          id,
          true,
        )
      ).filter((row) => !row.deleted);
    } else {
      const snap = await getDoc(doc(db, "companies", cid, "clients", id));
      targets = snap.exists()
        ? [buildCompanyClientRowFromDoc(cid, snap.id, (snap.data() ?? {}) as Record<string, unknown>)]
        : [];
    }
    // Visibility is checked against the row the viewer is looking at (the merged view), falling back to
    // the persisted doc when no row was supplied.
    const gateRow = contact ?? targets[0];
    if (!gateRow || !canViewerAccessCompanyClientRow(gateRow, filter)) return { ok: false };

    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp(), updatedAtIso: nowIso };
    if (typeof patch.name === "string") payload.name = patch.name.trim();
    if (typeof patch.email === "string") {
      payload.email = patch.email.trim();
      payload.emailNormalized = normalizeClientEmail(patch.email);
    }
    if (typeof patch.phone === "string") payload.phone = patch.phone.trim();
    if (typeof patch.address === "string") payload.address = patch.address.trim();
    if (typeof patch.notes === "string") payload.notes = patch.notes.trim();
    if (typeof patch.category === "string") payload.category = patch.category.trim();
    if (typeof patch.archived === "boolean") {
      payload.archived = patch.archived;
      // The date it's filed under on the Archived page.
      payload.archivedAtIso = patch.archived ? nowIso : "";
    }

    if (targets.length > 0) {
      for (const target of targets) {
        await setDoc(doc(db, "companies", cid, "clients", target.id), payload, { merge: true });
      }
      return { ok: true };
    }
    if (!contact) return { ok: false };

    // Last guard before creating a doc at the row's id: if one is already there (and simply wasn't picked
    // up as a target), merge the patch into it rather than replacing its history/created fields.
    const existingAtId = await getDoc(doc(db, "companies", cid, "clients", id));
    if (existingAtId.exists()) {
      await setDoc(doc(db, "companies", cid, "clients", id), payload, { merge: true });
      return { ok: true };
    }

    await ensureCompanyClientsSection(cid);
    await setDoc(
      doc(db, "companies", cid, "clients", id),
      {
        id,
        companyId: cid,
        name: contact.name,
        email: contact.email,
        emailNormalized: normalizeClientEmail(contact.emailNormalized || contact.email),
        phone: contact.phone,
        address: contact.address,
        notes: contact.notes,
        category: contact.category,
        archived: false,
        createdAt: serverTimestamp(),
        createdAtIso: contact.createdAtIso || nowIso,
        firstProjectAtIso: contact.firstProjectAtIso,
        lastProjectAtIso: contact.lastProjectAtIso,
        lastProjectId: contact.lastProjectId,
        projectCount: contact.projectCount,
        createdByUids: contact.createdByUids,
        assignedToUids: contact.assignedToUids,
        completedProjectIds: [],
        history: [],
        ...payload,
      },
      { merge: true },
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// The Archived page's Restore and Delete permanently for contacts, for one or many at once. Each row is
// the archived contact as the Archived page lists it (/api/clients?archived=only); like archiving, the
// write goes to every saved doc that is the same person (its own id plus the email -> phone ->
// name(+address) match), all read in one go. Returns the ids of the rows it handled.
async function writeArchivedCompanyClients(
  companyId: string,
  contacts: CompanyClientRow[],
  patchFor: (nowIso: string) => Record<string, unknown>,
  filter?: CompanyClientViewerFilter,
): Promise<string[]> {
  const cid = String(companyId || "").trim();
  const database = db;
  if (!database || !cid || !contacts.length) return [];
  try {
    const snap = await getDocs(collection(database, "companies", cid, "clients"));
    const rows = snap.docs
      .filter((docSnap) => docSnap.id !== "__meta")
      .map((docSnap) => buildCompanyClientRowFromDoc(cid, docSnap.id, (docSnap.data() ?? {}) as Record<string, unknown>))
      // Already-deleted docs stay as they are.
      .filter((row) => !row.deleted);
    const nowIso = new Date().toISOString();
    const patch = { ...patchFor(nowIso), updatedAt: serverTimestamp(), updatedAtIso: nowIso };
    const done: string[] = [];
    const targetIds = new Set<string>();
    for (const contact of contacts) {
      if (!canViewerAccessCompanyClientRow(contact, filter)) continue;
      const input = { name: contact.name, email: contact.email || contact.emailNormalized, phone: contact.phone, address: contact.address };
      const targets = rows.filter((row) => row.id === contact.id || inputMatchesClientRow(input, row));
      if (!targets.length) continue;
      targets.forEach((row) => targetIds.add(row.id));
      done.push(contact.id);
    }
    const ids = Array.from(targetIds);
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(database);
      ids.slice(i, i + 400).forEach((id) => batch.set(doc(database, "companies", cid, "clients", id), patch, { merge: true }));
      await batch.commit();
    }
    return done;
  } catch {
    return [];
  }
}

// Back to the Contacts list.
export async function restoreArchivedCompanyClients(
  companyId: string,
  contacts: CompanyClientRow[],
  filter?: CompanyClientViewerFilter,
): Promise<string[]> {
  return writeArchivedCompanyClients(companyId, contacts, () => ({ archived: false, archivedAtIso: "" }), filter);
}

// Deletes contacts for good — leaving a tombstone (see CompanyClientRow.deleted), since removing the doc
// would just let the contact come back from its projects. Everything about the contact is cleared except
// what's needed to recognise that person's projects (name, email, phone, address). Their projects aren't
// touched; a project for them created later starts a fresh contact card.
export async function permanentlyDeleteCompanyClients(
  companyId: string,
  contacts: CompanyClientRow[],
  filter?: CompanyClientViewerFilter,
): Promise<string[]> {
  return writeArchivedCompanyClients(
    companyId,
    contacts,
    (nowIso) => ({
      deleted: true,
      deletedAtIso: nowIso,
      archived: true,
      notes: "",
      category: "",
      history: [],
      completedProjectIds: [],
      projectCount: 0,
    }),
    filter,
  );
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
    assignedTo:
      String(input.assignedTo || "").trim() ||
      String(input.assignedToName || "").trim() ||
      String(input.createdByName || "").trim() ||
      "Unknown",
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

  // Not syncOnly: also links the new project to its card (project.clientId).
  return syncCompanyClientProfileFromProjectInternal(projectLike, { syncOnly: false });
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
  // Its place in its Leads board column once someone has dragged it there (see
  // lib/board-drop-order.ts) — unset until then, when it sits by date.
  boardOrder?: number;
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
    // A literal `undefined` anywhere in the patch (even nested several levels deep, e.g. inside a
    // template grid's row groups) makes setDoc throw "invalid-argument" for the WHOLE write, not just
    // that field — a stray optional field some caller forgot to omit-rather-than-set-undefined kills
    // an otherwise-unrelated save. JSON round-tripping the patch alone (never the full payload below,
    // since serverTimestamp()'s sentinel object would not survive that) drops any such key the same
    // way JSON.stringify already silently does, as a blanket safety net beneath each field's own
    // normalization.
    const sanitizedPatch = JSON.parse(JSON.stringify(patch)) as Record<string, unknown>;
    invalidateCompanyCache(cid);
    await setDoc(
      doc(db, "companies", cid),
      {
        ...sanitizedPatch,
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

// One doc per calendar year at companies/{companyId}/companyStats/{year} — a running,
// delta-incremented tally ("Company Wrapped") rather than something recomputed from scratch
// on every read, since these particular fields (cutlist quantities, hinge order quantities,
// board colour usage) only change at a discrete, well-defined "save" moment — there's exactly
// one place in the app that commits each one, so a delta computed at that single commit can
// never be double-applied. See the sync helpers in lib/company-stats.ts, which read/write this
// doc via the functions below.
//
// Sheets used / edge tape used / lacquer m² are NOT part of this doc — they're nesting-engine
// OUTPUTS that recompute continuously on every render while a project is open, with no discrete
// "save" moment to hook. An earlier version of this doc tried to delta-track them the same way
// as the fields above and it silently double-counted (two tabs on the same project, or a
// performance-gated intermediate reading of 0, would each get treated as a real change). Those
// three are tracked instead as an idempotent CURRENT-VALUE snapshot per project — see
// `ProjectStatsContribution`/`saveProjectStatsContribution`/`fetchAllProjectStatsContributions`
// below — and summed across all of a company's projects on read, the same "live sum over every
// project" shape already used for "Jobs complete this year".
export type CompanyStatsDoc = {
  year: number;
  doorsQuantity: number;
  drawersQuantity: number;
  panelsQuantity: number;
  materialUsage: Record<string, number>;
  materialUsageDisplay: Record<string, string>;
  hingeUsage: Record<string, number>;
  hingeUsageDisplay: Record<string, string>;
  updatedAt: unknown;
  updatedAtIso: string;
};

function companyStatsDocRef(companyId: string, year: number): DocumentReference {
  return doc(db!, "companies", companyId, "companyStats", String(year));
}

function toStatsNumberMap(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (value && typeof value === "object") {
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const num = Number(raw);
      if (Number.isFinite(num)) out[key] = num;
    }
  }
  return out;
}

function toStatsStringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === "object") {
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      out[key] = String(raw ?? "");
    }
  }
  return out;
}

function normalizeCompanyStatsDoc(year: number, data: Record<string, unknown>): CompanyStatsDoc {
  const toNum = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    year,
    doorsQuantity: toNum(data.doorsQuantity),
    drawersQuantity: toNum(data.drawersQuantity),
    panelsQuantity: toNum(data.panelsQuantity),
    materialUsage: toStatsNumberMap(data.materialUsage),
    materialUsageDisplay: toStatsStringMap(data.materialUsageDisplay),
    hingeUsage: toStatsNumberMap(data.hingeUsage),
    hingeUsageDisplay: toStatsStringMap(data.hingeUsageDisplay),
    updatedAt: data.updatedAt,
    updatedAtIso: String(data.updatedAtIso || ""),
  };
}

export async function fetchCompanyStatsDoc(companyId: string, year: number): Promise<CompanyStatsDoc | null> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) {
    return null;
  }
  try {
    const snap = await getDoc(companyStatsDocRef(cid, year));
    if (!snap.exists()) {
      return null;
    }
    return normalizeCompanyStatsDoc(year, (snap.data() ?? {}) as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function saveCompanyStatsDocPatch(
  companyId: string,
  year: number,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) {
    return { ok: false, error: "missing-firebase-or-company-id" };
  }
  try {
    const sanitizedPatch = JSON.parse(JSON.stringify(patch)) as Record<string, unknown>;
    await setDoc(
      companyStatsDocRef(cid, year),
      {
        ...sanitizedPatch,
        year,
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

// Powers the Wrapped page's year picker — cheap since this subcollection has at most one doc per
// calendar year the company has ever used the feature in.
export async function fetchCompanyStatsYears(companyId: string): Promise<number[]> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) {
    return [];
  }
  try {
    const snap = await getDocs(collection(db, "companies", cid, "companyStats"));
    return snap.docs
      .map((docSnap) => Number(docSnap.id))
      .filter((year) => Number.isFinite(year))
      .sort((a, b) => b - a);
  } catch {
    return [];
  }
}

// One doc per project at companies/{companyId}/companyStats/{year}/projectContributions/{projectId}
// holding that ONE project's CURRENT sheets/edge-tape/lacquer totals for the year (not a delta).
// Writing is idempotent by construction — re-writing the same true current value from a second
// open tab, a remount, or a stale re-render is harmless, since it just overwrites with the same
// (or corrected) number rather than accumulating on top of it.
export type ProjectStatsContribution = {
  sheets: number;
  edgeTapeMeters: number;
  lacquerSqm: number;
  updatedAtIso: string;
};

function projectStatsContributionDocRef(companyId: string, year: number, projectId: string): DocumentReference {
  return doc(db!, "companies", companyId, "companyStats", String(year), "projectContributions", projectId);
}

export async function saveProjectStatsContribution(
  companyId: string,
  year: number,
  projectId: string,
  contribution: { sheets: number; edgeTapeMeters: number; lacquerSqm: number },
): Promise<boolean> {
  const cid = String(companyId || "").trim();
  const pid = String(projectId || "").trim();
  if (!db || !cid || !pid) return false;
  try {
    await setDoc(
      projectStatsContributionDocRef(cid, year, pid),
      {
        sheets: Number.isFinite(contribution.sheets) ? contribution.sheets : 0,
        edgeTapeMeters: Number.isFinite(contribution.edgeTapeMeters) ? contribution.edgeTapeMeters : 0,
        lacquerSqm: Number.isFinite(contribution.lacquerSqm) ? contribution.lacquerSqm : 0,
        updatedAtIso: new Date().toISOString(),
      },
      { merge: true },
    );
    return true;
  } catch {
    return false;
  }
}

// Summed on the Wrapped page — same "live sum over every project" shape already used for "Jobs
// complete this year", rather than trusting a single running total that could drift.
export async function fetchAllProjectStatsContributions(companyId: string, year: number): Promise<ProjectStatsContribution[]> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) return [];
  try {
    const snap = await getDocs(collection(db, "companies", cid, "companyStats", String(year), "projectContributions"));
    return snap.docs.map((docSnap) => {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      const toNum = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      return {
        sheets: toNum(data.sheets),
        edgeTapeMeters: toNum(data.edgeTapeMeters),
        lacquerSqm: toNum(data.lacquerSqm),
        updatedAtIso: String(data.updatedAtIso || ""),
      };
    });
  } catch {
    return [];
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

// companyId is optional only for callers that genuinely want everything (there are none left in
// this codebase — every real caller passes the currently active company). When provided, rows
// from other companies (and legacy rows written before this field existed, which can't be safely
// attributed to any company) are filtered out client-side rather than in the query itself — a
// `where("companyId", "==", ...)` alongside the existing `orderBy("createdAt")` would need a new
// Firestore composite index that doesn't exist yet in production, and a missing index fails the
// whole query (silently, via this function's own catch) rather than just skipping the filter.
export async function fetchUserNotifications(uid: string, companyId?: string): Promise<UserNotificationRow[]> {
  const userId = String(uid || "").trim();
  if (!db || !userId) {
    return [];
  }
  const scopeCompanyId = String(companyId || "").trim();
  try {
    const snap = await getDocs(
      query(collection(db, "users", userId, "notifications"), orderBy("createdAt", "desc"), limit(200)),
    );
    const rows = snap.docs.map((docSnap) => {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      return {
        id: String(data.id ?? docSnap.id),
        title: String(data.title ?? ""),
        message: String(data.message ?? ""),
        type: String(data.type ?? "info"),
        read: Boolean(data.read),
        createdAtIso: toIsoString(data.createdAtIso ?? data.createdAt, ""),
        projectId: String(data.projectId ?? "").trim() || undefined,
        companyId: String(data.companyId ?? "").trim() || undefined,
        eventId: String(data.eventId ?? "").trim() || undefined,
      };
    });
    if (!scopeCompanyId) return rows;
    return rows.filter((row) => row.companyId === scopeCompanyId);
  } catch {
    return [];
  }
}

export async function setAllUserNotificationsRead(uid: string, read: boolean, companyId?: string): Promise<boolean> {
  const userId = String(uid || "").trim();
  if (!db || !userId) {
    return false;
  }
  const scopeCompanyId = String(companyId || "").trim();
  try {
    const snap = await getDocs(collection(db, "users", userId, "notifications"));
    const batch = writeBatch(db);
    for (const docSnap of snap.docs) {
      if (scopeCompanyId && String((docSnap.data() ?? {}).companyId ?? "").trim() !== scopeCompanyId) continue;
      batch.update(docSnap.ref, { read: Boolean(read), updatedAt: serverTimestamp(), updatedAtIso: new Date().toISOString() });
    }
    await batch.commit();
    return true;
  } catch {
    return false;
  }
}

// Best-effort notification writer — never lets a notification failure surface as (or block) the
// real action it's a side-effect of (role change, assignment change, quote/specs sent, etc.). If
// Firestore rules don't yet allow writing into another user's own notifications subcollection,
// this silently no-ops rather than breaking the underlying save/send.
export async function addUserNotification(
  uid: string,
  input: { title: string; message: string; type: string; projectId?: string; companyId?: string },
): Promise<boolean> {
  const userId = String(uid || "").trim();
  if (!db || !userId) return false;
  try {
    const ref = doc(collection(db, "users", userId, "notifications"));
    await setDoc(ref, {
      title: input.title,
      message: input.message,
      type: input.type,
      projectId: input.projectId || null,
      companyId: input.companyId || null,
      read: false,
      createdAt: serverTimestamp(),
      createdAtIso: new Date().toISOString(),
    });
    // ...and to their phone/desktop, if they've turned that on (lib/push-client.ts).
    void import("@/lib/push-client")
      .then(({ requestPushForNotification }) => requestPushForNotification(userId, ref.id, input.companyId))
      .catch(() => undefined);
    return true;
  } catch (err) {
    console.error("[addUserNotification] write failed:", err);
    return false;
  }
}

export async function markUserNotificationRead(uid: string, notificationId: string): Promise<boolean> {
  const userId = String(uid || "").trim();
  const id = String(notificationId || "").trim();
  if (!db || !userId || !id) return false;
  try {
    await updateDoc(doc(db, "users", userId, "notifications", id), { read: true });
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
  // fetchUserColorMapByUids() reads a membership doc's badgeColor BEFORE its
  // userColor (legacy field-name priority) — so fullPatch (the primary write,
  // used for both the users/{uid} doc and the membership doc's first-attempt
  // write) must always keep badgeColor in sync with userColor here, or a stale
  // badgeColor from an earlier write silently wins on every subsequent read,
  // even though userColor itself was updated correctly.
  const fullPatch = withMeta({ ...patch, ...(hasUserColor ? { badgeColor: userColorValue } : {}) });
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
    invalidateUserCache(userId);
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

  if (hasUserColor && !membershipWriteOk && userWriteOk) {
    // The personal users/{uid} profile doc — the authoritative fallback every
    // page's color lookup falls back to when no company-membership record has
    // a color set — saved fine even though every company-membership sync
    // attempt failed (most likely a rules/permission quirk on that specific
    // membership doc). Surface this as a real, separate condition instead of
    // silently reporting outright failure: the color WILL still show up
    // correctly wherever the membership doc has no stale color of its own,
    // but flag it so a genuinely out-of-sync membership record is visible.
    console.warn(
      `[saveUserProfilePatchDetailed] users/${userId} color saved, but company-membership sync failed for every attempted company: ${lastError}`,
    );
  }

  if (membershipWriteOk || userWriteOk) {
    return { ok: true };
  }

  return { ok: false, error: lastError || "membership-write-failed" };
}

function normalizeChecklistTemplate(id: string, raw: Record<string, unknown>): ChecklistTemplate {
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items = rawItems
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const text = String(row.text ?? "").trim();
      if (!text) return null;
      return { id: String(row.id ?? `${id}_item_${idx}`), text };
    })
    .filter((item): item is { id: string; text: string } => item !== null);
  return {
    id,
    name: String(raw.name ?? "").trim() || "Untitled Checklist",
    items,
    updatedAt: String(raw.updatedAtIso ?? "").trim() || undefined,
  };
}

export async function fetchChecklistTemplates(uid: string): Promise<ChecklistTemplate[]> {
  const userId = String(uid || "").trim();
  if (!db || !userId) return [];
  try {
    const snap = await getDocs(collection(db, "users", userId, "checklistTemplates"));
    return snap.docs
      .map((d) => normalizeChecklistTemplate(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.warn("[fetchChecklistTemplates] read failed:", error);
    return [];
  }
}

export async function saveChecklistTemplate(uid: string, template: ChecklistTemplate): Promise<boolean> {
  const userId = String(uid || "").trim();
  if (!db || !userId || !template?.id) return false;
  try {
    await setDoc(doc(db, "users", userId, "checklistTemplates", template.id), {
      name: template.name,
      items: template.items,
      updatedAtIso: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.warn("[saveChecklistTemplate] write failed:", error);
    return false;
  }
}

export async function deleteChecklistTemplate(uid: string, templateId: string): Promise<boolean> {
  const userId = String(uid || "").trim();
  const id = String(templateId || "").trim();
  if (!db || !userId || !id) return false;
  try {
    await deleteDoc(doc(db, "users", userId, "checklistTemplates", id));
    return true;
  } catch (error) {
    console.warn("[deleteChecklistTemplate] delete failed:", error);
    return false;
  }
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
  const cid = String(companyId || "").trim();

  // From the company's member list (shared/cached — see fetchCompanyMembers), which already carries
  // each member's colour (userColor first: badgeColor on a membership doc can't be updated through
  // the normal profile save, so it can be stale). This used to do one or two reads per person instead.
  if (cid) {
    const members = await fetchCompanyMembers(cid);
    const byUid = new Map(members.map((member) => [member.uid, member]));
    for (const uid of cleanUids) {
      const color = String(byUid.get(uid)?.userColor ?? byUid.get(uid)?.badgeColor ?? "").trim();
      if (color) out[uid] = color;
    }
  }

  // Anyone still without a colour: only the signed-in user's own profile can be read (the rules refuse
  // everyone else's), so that's the only fallback worth asking for.
  const selfUid = String(auth?.currentUser?.uid || "").trim();
  if (selfUid && cleanUids.includes(selfUid) && !out[selfUid]) {
    try {
      const data = await readUserDocCached(selfUid);
      const color = String(data?.userColor ?? data?.badgeColor ?? data?.avatarColor ?? data?.color ?? data?.colour ?? "").trim();
      if (color) out[selfUid] = color;
    } catch {
      // ignore
    }
  }

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
