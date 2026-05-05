import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";

function toStr(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeEmail(value: unknown) {
  return toStr(value).toLowerCase();
}

function normalizePhone(value: unknown) {
  return toStr(value).replace(/\D+/g, "");
}

function normalizeNameKey(value: unknown) {
  return toStr(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeAddressKey(value: unknown) {
  return toStr(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildClientId(input: {
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

function buildClientMatchKey(input: {
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

function createClientUid() {
  return `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function pickEarlierIso(...values: Array<unknown>) {
  const valid = values
    .map((value) => toStr(value))
    .filter(Boolean)
    .map((value) => ({ raw: value, stamp: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.stamp))
    .sort((a, b) => a.stamp - b.stamp);
  return valid[0]?.raw || "";
}

function pickLaterIso(...values: Array<unknown>) {
  const valid = values
    .map((value) => toStr(value))
    .filter(Boolean)
    .map((value) => ({ raw: value, stamp: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.stamp))
    .sort((a, b) => b.stamp - a.stamp);
  return valid[0]?.raw || "";
}

function toIsoString(value: unknown, fallback = "") {
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

type ClientHistoryRow = {
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

type ClientRow = {
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
  history: ClientHistoryRow[];
};

function buildHistoryFromProject(project: Record<string, unknown>): ClientHistoryRow {
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
  };
}

function buildClientFromProject(companyId: string, project: Record<string, unknown>): ClientRow {
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
    createdAtIso,
    updatedAtIso,
    firstProjectAtIso: createdAtIso,
    lastProjectAtIso: updatedAtIso || createdAtIso,
    lastProjectId: toStr(project.id),
    projectCount: 0,
    history,
  };
}

function projectMatchesClient(project: Record<string, unknown>, client: ClientRow): boolean {
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

function findMatchingClientIdInMap(merged: Map<string, ClientRow>, project: Record<string, unknown>): string | null {
  for (const [clientId, row] of merged.entries()) {
    if (projectMatchesClient(project, row)) {
      return clientId;
    }
  }
  return null;
}

async function findExistingClientRow(companyId: string, project: Record<string, unknown>): Promise<ClientRow | null> {
  const snap = await adminDb!.collection("companies").doc(companyId).collection("clients").get();
  for (const docSnap of snap.docs) {
    if (docSnap.id === "__meta") continue;
    const row = buildClientFromDoc(companyId, docSnap.id, (docSnap.data() ?? {}) as Record<string, unknown>);
    if (projectMatchesClient(project, row)) {
      return row;
    }
  }
  return null;
}

function mergeClientRows(existing: ClientRow | undefined, next: ClientRow): ClientRow {
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
    createdAtIso: existing.createdAtIso || next.createdAtIso,
    updatedAtIso: pickLaterIso(existing.updatedAtIso, next.updatedAtIso),
    firstProjectAtIso: pickEarlierIso(existing.firstProjectAtIso, next.firstProjectAtIso),
    lastProjectAtIso: pickLaterIso(existing.lastProjectAtIso, next.lastProjectAtIso),
    lastProjectId: next.lastProjectId || existing.lastProjectId,
    projectCount: Math.max(existing.projectCount, next.projectCount),
    history,
  };
}

function buildClientFromDoc(companyId: string, id: string, data: Record<string, unknown>): ClientRow {
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
    createdAtIso: toIsoString(data.createdAtIso ?? data.createdAt, ""),
    updatedAtIso: toIsoString(data.updatedAtIso ?? data.updatedAt, ""),
    firstProjectAtIso: toIsoString(data.firstProjectAtIso ?? data.firstProjectAt, ""),
    lastProjectAtIso: toIsoString(data.lastProjectAtIso ?? data.lastProjectAt, ""),
    lastProjectId: toStr(data.lastProjectId),
    projectCount: Number.isFinite(Number(data.projectCount)) ? Number(data.projectCount) : 0,
    history: history.sort(
      (a, b) => Date.parse(b.updatedAtIso || b.createdAtIso || "") - Date.parse(a.updatedAtIso || a.createdAtIso || ""),
    ),
  };
}

async function ensureClientsSection(companyId: string) {
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

export async function GET(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const url = new URL(request.url);
  const companyId = toStr(url.searchParams.get("companyId"));
  if (!companyId) {
    return NextResponse.json({ ok: false, error: "missing-company-id" }, { status: 400 });
  }

  const merged = new Map<string, ClientRow>();
  try {
    const jobsSnap = await adminDb.collection("companies").doc(companyId).collection("jobs").get();
    jobsSnap.docs.forEach((docSnap) => {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      const candidate = buildClientFromProject(companyId, { ...data, id: toStr(data.id) || docSnap.id });
      if (!candidate.name && !candidate.email && !candidate.phone) return;
      const matchId = findMatchingClientIdInMap(merged, { ...data, id: toStr(data.id) || docSnap.id }) || candidate.id;
      merged.set(matchId, mergeClientRows(merged.get(matchId), { ...candidate, id: matchId }));
    });
  } catch {
    // keep going so persisted client rows can still load
  }

  try {
    const clientsSnap = await adminDb.collection("companies").doc(companyId).collection("clients").get();
    clientsSnap.docs.forEach((docSnap) => {
      if (docSnap.id === "__meta") return;
      const row = buildClientFromDoc(companyId, docSnap.id, (docSnap.data() ?? {}) as Record<string, unknown>);
      const matchId =
        findMatchingClientIdInMap(merged, {
          id: row.lastProjectId,
          customer: row.name,
          clientEmail: row.email,
          clientPhone: row.phone,
          clientAddress: row.address,
        }) || row.id;
      merged.set(matchId, mergeClientRows(merged.get(matchId), { ...row, id: matchId }));
    });
  } catch {
    // best-effort persisted load
  }

  const clients = Array.from(merged.values()).sort((a, b) => {
    const aName = toStr(a.name || a.email).toLowerCase();
    const bName = toStr(b.name || b.email).toLowerCase();
    return aName.localeCompare(bName);
  });

  return NextResponse.json({ ok: true, clients });
}

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const companyId = toStr(body.companyId);
  const projectId = toStr(body.projectId);
  const customer = toStr(body.customer);
  const clientEmail = toStr(body.clientEmail);
  const clientEmailNormalized = normalizeEmail(clientEmail);
  const clientPhone = toStr(body.clientPhone);
  const clientAddress = toStr(body.clientAddress);
  if (!companyId || !projectId || (!customer && !clientEmail && !clientPhone)) {
    return NextResponse.json({ ok: false, error: "missing-client-create-fields" }, { status: 400 });
  }

  const directClientId = buildClientId({
    clientId: body.clientId,
  });
  const nowIso = new Date().toISOString();

  try {
    await ensureClientsSection(companyId);
    const matchedRow = directClientId ? null : await findExistingClientRow(companyId, body);
    const clientId = directClientId || matchedRow?.id || createClientUid();
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
        name: customer || current?.name || "",
        email: clientEmailNormalized || current?.email || "",
        emailNormalized: clientEmailNormalized || normalizeEmail(current?.email || ""),
        phone: clientPhone || current?.phone || "",
        address: clientAddress || current?.address || "",
        notes: toStr(body.notes) || current?.notes || "",
        createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(),
        createdAtIso: current?.createdAtIso || toStr(body.createdAtIso) || nowIso,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtIso: nowIso,
        firstProjectAtIso: pickEarlierIso(current?.firstProjectAtIso, toStr(body.createdAtIso), history[history.length - 1]?.createdAtIso),
        lastProjectAtIso: pickLaterIso(current?.lastProjectAtIso, toStr(body.updatedAtIso), toStr(body.createdAtIso), history[0]?.updatedAtIso),
        lastProjectId: projectId,
        projectCount: current?.projectCount ?? 0,
        completedProjectIds: Array.isArray(existing?.completedProjectIds) ? existing?.completedProjectIds : [],
        history,
      },
      { merge: true },
    );
    return NextResponse.json({ ok: true, clientId });
  } catch {
    return NextResponse.json({ ok: false, error: "client-save-failed" }, { status: 500 });
  }
}
