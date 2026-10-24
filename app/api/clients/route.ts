import { NextRequest, NextResponse } from "next/server";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { apiHasPermission, requireCompanyMember } from "@/lib/api-company-access";
import {
  toStr,
  pickLaterIso,
  isArchivedProjectData,
  withLiveProjectState,
  type ClientRow,
  tombstoneHidesProject,
  mergeUidLists,
  canViewerAccessClientRow,
  toSummaryClientRow,
  buildClientFromProject,
  projectMatchesClient,
  findMatchingClientIdInMap,
  mergeClientRows,
  buildClientFromDoc,
  saveClientForProject,
} from "@/lib/clients-server";

export async function GET(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }
  const url = new URL(request.url);
  const companyId = toStr(url.searchParams.get("companyId"));
  const mode = toStr(url.searchParams.get("mode")).toLowerCase();
  const clientId = toStr(url.searchParams.get("clientId"));
  // archived=only: the viewer's archived contacts instead (the Archived page).
  const archivedOnly = toStr(url.searchParams.get("archived")).toLowerCase() === "only";
  if (!companyId) {
    return NextResponse.json({ ok: false, error: "missing-company-id" }, { status: 400 });
  }
  // Contacts are personal data: only a signed-in member of this company may read them. Who's asking
  // and whether they may see every contact come from their sign-in and role — never from the query
  // string (the old viewerUid/scope params are ignored apart from scope=all as a request that's only
  // honoured with the "view all contacts" permission).
  const access = await requireCompanyMember(request, companyId);
  if (!access) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const viewerUid = access.uid;
  const includeAll = toStr(url.searchParams.get("scope")).toLowerCase() === "all" && apiHasPermission(access, "clients.view.all");

  if (mode === "detail") {
    if (!clientId) {
      return NextResponse.json({ ok: false, error: "missing-client-id" }, { status: 400 });
    }
    try {
      const clientSnap = await adminDb.collection("companies").doc(companyId).collection("clients").doc(clientId).get();
      if (clientSnap.exists) {
        const client = buildClientFromDoc(companyId, clientSnap.id, (clientSnap.data() ?? {}) as Record<string, unknown>);
        if (client.deleted || !canViewerAccessClientRow(client, viewerUid, includeAll)) {
          return NextResponse.json({ ok: false, error: "client-not-found" }, { status: 404 });
        }
        const liveSnap = await adminDb.collection("companies").doc(companyId).collection("jobs").select("id", "isArchived", "isDeleted").get();
        const liveArchivedById = new Map<string, boolean>();
        liveSnap.docs.forEach((docSnap) => {
          const data = (docSnap.data() ?? {}) as Record<string, unknown>;
          liveArchivedById.set(toStr(data.id) || docSnap.id, isArchivedProjectData(data));
        });
        return NextResponse.json({ ok: true, client: { ...client, history: withLiveProjectState(client.history, liveArchivedById) } });
      }
      const merged = new Map<string, ClientRow>();
      const detailLiveArchivedById = new Map<string, boolean>();
      const jobsSnap = await adminDb.collection("companies").doc(companyId).collection("jobs").get();
      jobsSnap.docs.forEach((docSnap) => {
        const data = (docSnap.data() ?? {}) as Record<string, unknown>;
        detailLiveArchivedById.set(toStr(data.id) || docSnap.id, isArchivedProjectData(data));
        const candidate = buildClientFromProject(companyId, { ...data, id: toStr(data.id) || docSnap.id });
        if (!candidate.name && !candidate.email && !candidate.phone) return;
        const matchId = findMatchingClientIdInMap(merged, { ...data, id: toStr(data.id) || docSnap.id }) || candidate.id;
        merged.set(matchId, mergeClientRows(merged.get(matchId), { ...candidate, id: matchId }));
      });
      const client = merged.get(clientId);
      if (!client || !canViewerAccessClientRow(client, viewerUid, includeAll)) {
        return NextResponse.json({ ok: false, error: "client-not-found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, client: { ...client, history: withLiveProjectState(client.history, detailLiveArchivedById) } });
    } catch {
      return NextResponse.json({ ok: false, error: "client-detail-load-failed" }, { status: 500 });
    }
  }

  // Read persisted clients first and split off the archived ones. An archived contact must never
  // reappear just because the project-derived pass (below) independently re-matches/re-keys them
  // slightly differently than this pass does — checking identity against archivedRows BEFORE a
  // project candidate is ever added to `merged` makes the exclusion correct regardless of whether
  // the two passes' own matching happens to land on the same map key.
  // Permanently deleted ones (tombstones) are never listed, archived or not, and hide their projects the
  // same way — only the projects from before they were deleted (see tombstoneHidesProject).
  const archivedRows: ClientRow[] = [];
  const tombstoneRows: ClientRow[] = [];
  const activeClientRows: ClientRow[] = [];
  try {
    const clientsSnap = await adminDb.collection("companies").doc(companyId).collection("clients").get();
    clientsSnap.docs.forEach((docSnap) => {
      if (docSnap.id === "__meta") return;
      const row = buildClientFromDoc(companyId, docSnap.id, (docSnap.data() ?? {}) as Record<string, unknown>);
      (row.deleted ? tombstoneRows : row.archived ? archivedRows : activeClientRows).push(row);
    });
  } catch {
    // best-effort persisted load
  }
  // The archived card a project belongs to (by its link, or else by matching identity), if any.
  const archivedRowFor = (input: Record<string, unknown>, linkedId: string) =>
    linkedId ? archivedRows.find((row) => row.id === linkedId) : archivedRows.find((archivedRow) => projectMatchesClient(input, archivedRow));
  const hiddenByTombstone = (input: Record<string, unknown>, linkedId: string) =>
    linkedId
      ? tombstoneRows.some((row) => row.id === linkedId)
      : tombstoneRows.some((row) => tombstoneHidesProject(row, input) && projectMatchesClient(input, row));

  const merged = new Map<string, ClientRow>();
  // The people on an archived contact's projects can see it on the Archived page, the same way they'd
  // see it in Contacts (an archived card's own doc may not list all of them).
  const archivedViewerUids = new Map<string, { createdByUids: string[]; assignedToUids: string[] }>();
  const liveArchivedById = new Map<string, boolean>();
  let liveProjectsRead = false;
  try {
    const jobsSnap = await adminDb.collection("companies").doc(companyId).collection("jobs").get();
    liveProjectsRead = true;
    jobsSnap.docs.forEach((docSnap) => {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      const projectInput = { ...data, id: toStr(data.id) || docSnap.id };
      liveArchivedById.set(projectInput.id, isArchivedProjectData(data));
      // A project linked to a card (clientId) belongs to that card whatever its client details say now —
      // that link keeps a changed phone/email from splitting it off into a duplicate contact.
      const linkedId = toStr(data.clientId);
      if (hiddenByTombstone(projectInput, linkedId)) return;
      const archivedOwner = archivedRowFor(projectInput, linkedId);
      if (archivedOwner) {
        const uids = archivedViewerUids.get(archivedOwner.id) ?? { createdByUids: [], assignedToUids: [] };
        archivedViewerUids.set(archivedOwner.id, {
          createdByUids: mergeUidLists(uids.createdByUids, [toStr(data.createdByUid)]),
          assignedToUids: mergeUidLists(uids.assignedToUids, [toStr(data.assignedToUid)]),
        });
        return;
      }
      const candidate = buildClientFromProject(companyId, projectInput);
      if (!candidate.name && !candidate.email && !candidate.phone) return;
      const matchId = (linkedId && merged.has(linkedId) ? linkedId : "") || (linkedId ? "" : findMatchingClientIdInMap(merged, projectInput)) || candidate.id;
      merged.set(matchId, mergeClientRows(merged.get(matchId), { ...candidate, id: matchId }));
    });
  } catch {
    // keep going so persisted client rows can still load
  }

  if (archivedOnly) {
    // One row per person: twin docs for the same person (archiving writes all of them) are merged the
    // same way the Contacts list merges active ones. Filed by when it was archived — or, archived before
    // that was stored, when it was last updated.
    const archivedMerged = new Map<string, ClientRow>();
    archivedRows.forEach((row) => {
      const extra = archivedViewerUids.get(row.id);
      const withViewers = extra
        ? {
            ...row,
            createdByUids: mergeUidLists(row.createdByUids, extra.createdByUids),
            assignedToUids: mergeUidLists(row.assignedToUids, extra.assignedToUids),
          }
        : row;
      const matchId =
        findMatchingClientIdInMap(archivedMerged, {
          id: row.lastProjectId,
          customer: row.name,
          clientEmail: row.email,
          clientPhone: row.phone,
          clientAddress: row.address,
        }) || row.id;
      const previous = archivedMerged.get(matchId);
      const next = mergeClientRows(previous, { ...withViewers, id: matchId });
      next.archivedAtIso = pickLaterIso(previous?.archivedAtIso, withViewers.archivedAtIso);
      archivedMerged.set(matchId, next);
    });
    const archived = Array.from(archivedMerged.values())
      .filter((client) => canViewerAccessClientRow(client, viewerUid, includeAll))
      .map((client) => ({ ...toSummaryClientRow(client), archivedAtIso: client.archivedAtIso || client.updatedAtIso }))
      .sort((a, b) => toStr(b.archivedAtIso).localeCompare(toStr(a.archivedAtIso)));
    return NextResponse.json({ ok: true, clients: archived });
  }

  activeClientRows.forEach((row) => {
    const matchId =
      (merged.has(row.id) ? row.id : "") ||
      findMatchingClientIdInMap(merged, {
        id: row.lastProjectId,
        customer: row.name,
        clientEmail: row.email,
        clientPhone: row.phone,
        clientAddress: row.address,
      }) || row.id;
    merged.set(matchId, mergeClientRows(merged.get(matchId), { ...row, id: matchId }));
  });

  const clients = Array.from(merged.values()).sort((a, b) => {
    if (!canViewerAccessClientRow(a, viewerUid, includeAll)) return 1;
    if (!canViewerAccessClientRow(b, viewerUid, includeAll)) return -1;
    const aName = toStr(a.name || a.email).toLowerCase();
    const bName = toStr(b.name || b.email).toLowerCase();
    return aName.localeCompare(bName);
  })
    .filter((client) => canViewerAccessClientRow(client, viewerUid, includeAll) && !client.archived)
    // (Only once the projects were actually read — otherwise every project would look deleted.)
    .map((client) => (liveProjectsRead ? { ...client, history: withLiveProjectState(client.history, liveArchivedById) } : client));

  return NextResponse.json({
    ok: true,
    clients,
  });
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
  const clientPhone = toStr(body.clientPhone);
  if (!companyId || !projectId || (!customer && !clientEmail && !clientPhone)) {
    return NextResponse.json({ ok: false, error: "missing-client-create-fields" }, { status: 400 });
  }
  // Creating/updating a contact (and linking a project to it) needs a signed-in member of this company.
  if (!(await requireCompanyMember(request, companyId))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const { clientId, matchedExisting, differences } = await saveClientForProject(companyId, body);
    return NextResponse.json({ ok: true, clientId, matchedExisting, differences });
  } catch {
    return NextResponse.json({ ok: false, error: "client-save-failed" }, { status: 500 });
  }
}
