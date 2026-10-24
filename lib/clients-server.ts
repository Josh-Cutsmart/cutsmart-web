import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

// Contacts' cards on the server: matching a project's client to a card, building cards from projects, and saving a new
// project's client to one (saveClientForProject). app/api/clients, and lib/column-automations-server.ts.

export function toStr(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeEmail(value: unknown) {
  return toStr(value).toLowerCase();
}

export function normalizePhone(value: unknown) {
  return toStr(value).replace(/\D+/g, "");
}

export function normalizeNameKey(value: unknown) {
  return toStr(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function normalizeAddressKey(value: unknown) {
  return toStr(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function buildClientId(input: {
  clientId?: unknown;
  clientEmail?: unknown;
  clientPhone?: unknown;
  customer?: unknown;
  clientAddress?: unknown;
  projectId?: unknown;
}) {
  const existing = toStr(input.clientId);
  if (existing) return existing;
  return "";
}

export function buildClientMatchKey(input: {
  clientEmail?: unknown;
  clientPhone?: unknown;
  customer?: unknown;
  clientAddress?: unknown;
  projectId?: unknown;
}) {
  const email = normalizeEmail(input.clientEmail);
  if (email) return `client_${email.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown"}`;
  const phone = normalizePhone(input.clientPhone);
  if (phone) return `client_phone_${phone}`;
  const nameKey = normalizeNameKey(input.customer);
  const addressKey = normalizeAddressKey(input.clientAddress);
  if (nameKey && addressKey) return `client_${nameKey}_${addressKey}`;
  if (nameKey) return `client_${nameKey}`;
  const projectId = toStr(input.projectId);
  return `client_project_${projectId || "unknown"}`;
}

export function createClientUid() {
  return `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function pickEarlierIso(...values: Array<unknown>) {
  const valid = values
    .map((value) => toStr(value))
    .filter(Boolean)
    .map((value) => ({ raw: value, stamp: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.stamp))
    .sort((a, b) => a.stamp - b.stamp);
  return valid[0]?.raw || "";
}

export function pickLaterIso(...values: Array<unknown>) {
  const valid = values
    .map((value) => toStr(value))
    .filter(Boolean)
    .map((value) => ({ raw: value, stamp: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.stamp))
    .sort((a, b) => b.stamp - a.stamp);
  return valid[0]?.raw || "";
}

export function toIsoString(value: unknown, fallback = "") {
  if (value == null) return fallback;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return fallback;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
  }
  if (value && typeof value === "object" && "toDate" in (value as Record<string, unknown>)) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return fallback;
    }
  }
  if (value instanceof Date) return value.toISOString();
  return fallback;
}

export type ClientHistoryRow = {
  projectId: string;
  projectName: string;
  createdAtIso: string;
  updatedAtIso: string;
  statusLabel: string;
  customer: string;
  clientEmail: string;
  clientPhone: string;
  clientAddress: string;
  // Archived, or deleted for good (only the contact's saved row is left) — see withLiveProjectState.
  archived?: boolean;
  deleted?: boolean;
  deletedAtIso?: string;
};

export function isArchivedProjectData(project: Record<string, unknown>): boolean {
  return project.isArchived === true || project.isDeleted === true;
}

// A contact's history keeps every project it's ever had (lib/firestore-data.ts saves each one). Whether
// each is archived now — or deleted, when it's no longer among the company's projects — comes from the
// projects themselves (liveArchivedById: every current project's id → archived or not), not from the
// saved row, which can be out of date.
export function withLiveProjectState(history: ClientHistoryRow[], liveArchivedById: Map<string, boolean>): ClientHistoryRow[] {
  return history.map((row) => {
    const projectId = toStr(row.projectId);
    if (!projectId) return row;
    const liveArchived = liveArchivedById.get(projectId);
    if (liveArchived === undefined) return { ...row, deleted: true };
    return { ...row, archived: liveArchived, deleted: false, deletedAtIso: "" };
  });
}

export type ClientRow = {
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
  // When it was archived (contacts archived before this was stored have none).
  archivedAtIso?: string;
  // Permanently deleted from the Archived page: the doc is kept as a tombstone so the same person
  // doesn't just reappear from their projects. Never returned; see tombstoneHidesProject.
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
  history: ClientHistoryRow[];
};

// A permanently deleted contact (tombstone) hides that person's projects from before it was deleted,
// like an archived contact does. A project created afterwards is a returning client and shows again
// (as a fresh contact). Same rule as clientTombstoneHidesProject in lib/firestore-data.ts.
export function tombstoneHidesProject(row: ClientRow, project: Record<string, unknown>): boolean {
  if (!row.deleted) return false;
  const deletedMs = Date.parse(toStr(row.deletedAtIso));
  const createdMs = Date.parse(toIsoString(project.createdAtIso ?? project.createdAt, ""));
  return !Number.isFinite(deletedMs) || !Number.isFinite(createdMs) || createdMs <= deletedMs;
}

export function normalizeUidList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => toStr(value))
        .filter(Boolean),
    ),
  );
}

export function mergeUidLists(...lists: Array<string[] | undefined>): string[] {
  return Array.from(
    new Set(
      lists
        .flatMap((list) => list ?? [])
        .map((value) => toStr(value))
        .filter(Boolean),
    ),
  );
}

export function canViewerAccessClientRow(row: ClientRow, viewerUid: string, includeAll: boolean) {
  if (includeAll) return true;
  const cleanViewerUid = toStr(viewerUid);
  if (!cleanViewerUid) return false;
  return row.createdByUids.includes(cleanViewerUid) || row.assignedToUids.includes(cleanViewerUid);
}

export function toSummaryClientRow(row: ClientRow): ClientRow {
  return {
    ...row,
    history: [],
  };
}

export function buildHistoryFromProject(project: Record<string, unknown>): ClientHistoryRow {
  return {
    projectId: toStr(project.id),
    projectName: toStr(project.name) || "Untitled Project",
    createdAtIso: toIsoString(project.createdAtIso ?? project.createdAt, ""),
    updatedAtIso: toIsoString(project.updatedAtIso ?? project.updatedAt, ""),
    statusLabel: toStr(project.status) || "New",
    customer: toStr(project.customer ?? project.clientName ?? project.client),
    clientEmail: toStr(project.clientEmail ?? project.email),
    clientPhone: toStr(project.clientPhone ?? project.clientNumber ?? project.phone),
    clientAddress: toStr(project.clientAddress ?? project.projectAddress ?? project.address),
    archived: isArchivedProjectData(project),
  };
}

export function buildClientFromProject(companyId: string, project: Record<string, unknown>): ClientRow {
  const id = buildClientId({
    clientId: project.clientId,
  }) || buildClientMatchKey({
    projectId: project.id,
    clientEmail: project.clientEmail,
    clientPhone: project.clientPhone ?? project.clientNumber,
    customer: project.customer ?? project.clientName ?? project.client,
    clientAddress: project.clientAddress ?? project.projectAddress,
  });
  const history = [buildHistoryFromProject(project)];
  const createdAtIso = toIsoString(project.createdAtIso ?? project.createdAt, "");
  const updatedAtIso = toIsoString(project.updatedAtIso ?? project.updatedAt, createdAtIso);
  return {
    id,
    companyId,
    name: toStr(project.customer ?? project.clientName ?? project.client),
    email: toStr(project.clientEmail),
    emailNormalized: normalizeEmail(project.clientEmail),
    phone: toStr(project.clientPhone ?? project.clientNumber),
    address: toStr(project.clientAddress ?? project.projectAddress),
    notes: toStr(project.notes),
    category: "",
    archived: false,
    createdAtIso,
    updatedAtIso,
    firstProjectAtIso: createdAtIso,
    lastProjectAtIso: updatedAtIso || createdAtIso,
    lastProjectId: toStr(project.id),
    projectCount: 1,
    createdByUids: mergeUidLists([toStr(project.createdByUid)]),
    assignedToUids: mergeUidLists([toStr(project.assignedToUid)]),
    history,
  };
}

export function projectMatchesClient(project: Record<string, unknown>, client: ClientRow): boolean {
  const projectEmail = normalizeEmail(project.clientEmail);
  const clientEmail = normalizeEmail(client.emailNormalized || client.email);
  if (projectEmail && clientEmail) {
    return projectEmail === clientEmail;
  }
  const projectPhone = normalizePhone(project.clientPhone ?? project.clientNumber);
  const clientPhone = normalizePhone(client.phone);
  if (projectPhone && clientPhone) {
    return projectPhone === clientPhone;
  }
  const projectName = normalizeNameKey(project.customer ?? project.clientName ?? project.client);
  const clientName = normalizeNameKey(client.name);
  const projectAddress = normalizeAddressKey(project.clientAddress ?? project.projectAddress ?? project.address);
  const clientAddress = normalizeAddressKey(client.address);
  if (projectName && clientName && projectAddress && clientAddress) {
    return projectName === clientName && projectAddress === clientAddress;
  }
  if (projectName && clientName) {
    return projectName === clientName;
  }
  return false;
}

export function findMatchingClientIdInMap(merged: Map<string, ClientRow>, project: Record<string, unknown>): string | null {
  for (const [clientId, row] of merged.entries()) {
    if (projectMatchesClient(project, row)) {
      return clientId;
    }
  }
  return null;
}

// Used for a project being created now, so a permanently deleted contact never matches — the person is
// back, and gets a fresh card.
export async function findExistingClientRow(companyId: string, project: Record<string, unknown>): Promise<ClientRow | null> {
  const snap = await adminDb!.collection("companies").doc(companyId).collection("clients").get();
  for (const docSnap of snap.docs) {
    if (docSnap.id === "__meta") continue;
    const row = buildClientFromDoc(companyId, docSnap.id, (docSnap.data() ?? {}) as Record<string, unknown>);
    if (!row.deleted && projectMatchesClient(project, row)) {
      return row;
    }
  }
  return null;
}

export function mergeClientRows(existing: ClientRow | undefined, next: ClientRow): ClientRow {
  if (!existing) return next;
  const historyByProjectId = new Map<string, ClientHistoryRow>();
  [...existing.history, ...next.history].forEach((row) => {
    const key = toStr(row.projectId);
    if (!key) return;
    const previous = historyByProjectId.get(key);
    if (!previous) {
      historyByProjectId.set(key, row);
      return;
    }
    const prevStamp = Date.parse(previous.updatedAtIso || previous.createdAtIso || "");
    const nextStamp = Date.parse(row.updatedAtIso || row.createdAtIso || "");
    if (nextStamp >= prevStamp) historyByProjectId.set(key, row);
  });
  const history = Array.from(historyByProjectId.values()).sort(
    (a, b) => Date.parse(b.updatedAtIso || b.createdAtIso || "") - Date.parse(a.updatedAtIso || a.createdAtIso || ""),
  );
  return {
    ...existing,
    ...next,
    name: next.name || existing.name,
    email: next.email || existing.email,
    emailNormalized: next.emailNormalized || existing.emailNormalized,
    phone: next.phone || existing.phone,
    address: next.address || existing.address,
    notes: next.notes || existing.notes,
    category: next.category || existing.category,
    archived: Boolean(existing.archived || next.archived),
    createdAtIso: existing.createdAtIso || next.createdAtIso,
    updatedAtIso: pickLaterIso(existing.updatedAtIso, next.updatedAtIso),
    firstProjectAtIso: pickEarlierIso(existing.firstProjectAtIso, next.firstProjectAtIso),
    lastProjectAtIso: pickLaterIso(existing.lastProjectAtIso, next.lastProjectAtIso),
    lastProjectId: next.lastProjectId || existing.lastProjectId,
    projectCount: Math.max(existing.projectCount, next.projectCount),
    createdByUids: mergeUidLists(existing.createdByUids, next.createdByUids),
    assignedToUids: mergeUidLists(existing.assignedToUids, next.assignedToUids),
    history,
  };
}

export function buildClientFromDoc(companyId: string, id: string, data: Record<string, unknown>): ClientRow {
  const history = Array.isArray(data.history)
    ? (data.history as Array<Record<string, unknown>>).map((row) => ({
        projectId: toStr(row.projectId),
        projectName: toStr(row.projectName) || "Untitled Project",
        createdAtIso: toIsoString(row.createdAtIso ?? row.createdAt, ""),
        updatedAtIso: toIsoString(row.updatedAtIso ?? row.updatedAt, ""),
        statusLabel: toStr(row.statusLabel) || "New",
        customer: toStr(row.customer),
        clientEmail: toStr(row.clientEmail),
        clientPhone: toStr(row.clientPhone),
        clientAddress: toStr(row.clientAddress),
        archived: row.archived === true,
        deleted: row.deleted === true,
        deletedAtIso: toIsoString(row.deletedAtIso, ""),
      }))
    : [];
  return {
    id,
    companyId,
    name: toStr(data.name),
    email: toStr(data.email),
    emailNormalized: normalizeEmail(data.emailNormalized ?? data.email),
    phone: toStr(data.phone),
    address: toStr(data.address),
    notes: toStr(data.notes),
    category: toStr(data.category),
    archived: Boolean(data.archived),
    archivedAtIso: toIsoString(data.archivedAtIso, ""),
    deleted: data.deleted === true,
    deletedAtIso: toIsoString(data.deletedAtIso, ""),
    createdAtIso: toIsoString(data.createdAtIso ?? data.createdAt, ""),
    updatedAtIso: toIsoString(data.updatedAtIso ?? data.updatedAt, ""),
    firstProjectAtIso: toIsoString(data.firstProjectAtIso ?? data.firstProjectAt, ""),
    lastProjectAtIso: toIsoString(data.lastProjectAtIso ?? data.lastProjectAt, ""),
    lastProjectId: toStr(data.lastProjectId),
    projectCount: Number.isFinite(Number(data.projectCount)) ? Number(data.projectCount) : 0,
    createdByUids: normalizeUidList(data.createdByUids),
    assignedToUids: normalizeUidList(data.assignedToUids),
    history: history.sort(
      (a, b) => Date.parse(b.updatedAtIso || b.createdAtIso || "") - Date.parse(a.updatedAtIso || a.createdAtIso || ""),
    ),
  };
}

export async function ensureClientsSection(companyId: string) {
  const nowIso = new Date().toISOString();
  await adminDb!.collection("companies").doc(companyId).collection("clients").doc("__meta").set(
    {
      id: "__meta",
      companyId,
      type: "clients-meta",
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtIso: nowIso,
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: nowIso,
    },
    { merge: true },
  );
}

// A new project's client, as a contact card (Contacts): the card asked for (body.clientId — not one deleted for good),
// else the one whose details match, else a new one — the project added to its history, and linked to it. An existing
// card keeps its own details (the project only fills in what it's missing); the differences come back, so the app can
// ask before changing it. POST /api/clients (the New Project pop-up), and a lead converted to a project by a column
// automation (lib/column-automations-server.ts). Throws if it can't be saved.
export async function saveClientForProject(
  companyId: string,
  body: Record<string, unknown>,
): Promise<{ clientId: string; matchedExisting: boolean; differences: Array<{ field: string; card: string; project: string }> }> {
  if (!adminDb) throw new Error("missing-firebase-admin-config");
  const projectId = toStr(body.projectId);
  const customer = toStr(body.customer);
  const clientEmail = toStr(body.clientEmail);
  const clientEmailNormalized = normalizeEmail(clientEmail);
  const clientPhone = toStr(body.clientPhone);
  const clientAddress = toStr(body.clientAddress);
  const directClientId = buildClientId({
    clientId: body.clientId,
  });
  const nowIso = new Date().toISOString();

  await ensureClientsSection(companyId);
  // A card that was deleted permanently isn't reused, even when asked for by id — the person gets a
  // fresh one.
  const directSnap = directClientId
    ? await adminDb.collection("companies").doc(companyId).collection("clients").doc(directClientId).get()
    : null;
  const usableDirectId = directSnap && (directSnap.data() ?? {}).deleted === true ? "" : directClientId;
  const matchedRow = usableDirectId ? null : await findExistingClientRow(companyId, body);
  const clientId = usableDirectId || matchedRow?.id || createClientUid();
  const clientRef = adminDb.collection("companies").doc(companyId).collection("clients").doc(clientId);
  const existingSnap = await clientRef.get();
  const existing = existingSnap.exists ? ((existingSnap.data() ?? {}) as Record<string, unknown>) : null;
  const current = existing ? buildClientFromDoc(companyId, clientId, existing) : matchedRow;
  const history = current?.history.slice() ?? [];
  const hasProjectHistory = history.some((row) => row.projectId === projectId);
  if (!hasProjectHistory) {
    history.push({
      projectId,
      projectName: toStr(body.projectName) || "Untitled Project",
      createdAtIso: toStr(body.createdAtIso) || nowIso,
      updatedAtIso: toStr(body.updatedAtIso) || toStr(body.createdAtIso) || nowIso,
      statusLabel: toStr(body.statusLabel) || "New",
      customer,
      clientEmail,
      clientPhone,
      clientAddress,
    });
  }
  history.sort((a, b) => Date.parse(b.updatedAtIso || b.createdAtIso || "") - Date.parse(a.updatedAtIso || a.createdAtIso || ""));
  await clientRef.set(
    {
      id: clientId,
      companyId,
      // An existing card keeps its own details — the project only fills in what the card is missing.
      // Differences are reported back (below) so the app can ask before changing the card.
      name: current?.name || customer,
      email: current?.email || clientEmailNormalized,
      emailNormalized: normalizeEmail(current?.email || "") || clientEmailNormalized,
      phone: current?.phone || clientPhone,
      address: current?.address || clientAddress,
      notes: current?.notes || toStr(body.notes),
      createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(),
      createdAtIso: current?.createdAtIso || toStr(body.createdAtIso) || nowIso,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtIso: nowIso,
      firstProjectAtIso: pickEarlierIso(current?.firstProjectAtIso, toStr(body.createdAtIso), history[history.length - 1]?.createdAtIso),
      lastProjectAtIso: pickLaterIso(current?.lastProjectAtIso, toStr(body.updatedAtIso), toStr(body.createdAtIso), history[0]?.updatedAtIso),
      lastProjectId: projectId,
      projectCount: current?.projectCount ?? 0,
      createdByUids: mergeUidLists(current?.createdByUids, normalizeUidList(existing?.createdByUids), [toStr(body.createdByUid)]),
      assignedToUids: mergeUidLists(current?.assignedToUids, normalizeUidList(existing?.assignedToUids), [toStr(body.assignedToUid)]),
      completedProjectIds: Array.isArray(existing?.completedProjectIds) ? existing?.completedProjectIds : [],
      history,
    },
    { merge: true },
  );
  // Link the project to its card so later client-detail edits stay attached to this card.
  try {
    await adminDb.collection("companies").doc(companyId).collection("jobs").doc(projectId).update({ clientId });
  } catch {
    // The project doc may live elsewhere (legacy) — the app links it on next open instead.
  }
  const differences = current
    ? [
        { field: "name", card: current.name, project: customer },
        { field: "email", card: current.email, project: clientEmail },
        { field: "phone", card: current.phone, project: clientPhone },
        { field: "address", card: current.address, project: clientAddress },
      ].filter((row) => row.card && row.project && (row.field === "email" ? normalizeEmail(row.card) !== normalizeEmail(row.project) : row.card !== row.project))
    : [];
  return { clientId, matchedExisting: Boolean(current), differences };
}
