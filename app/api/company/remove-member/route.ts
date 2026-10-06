import { NextRequest, NextResponse } from "next/server";
import { FieldValue, type DocumentReference, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";
import { completedStatusMatcher } from "@/lib/project-archive";

// Removing a staff member from a company used to be attempted directly from the client SDK (see
// removeCompanyMemberDetailed in lib/firestore-data.ts), but firestore.rules has always had
// `allow delete: if false` on companies/{companyId}/memberships/{uid} with no exception — so that
// call was guaranteed to fail with permission-denied for every caller, always. Replicating the
// full "does this caller have staff.remove" check (lib/membership.ts's resolveMembershipToAccess)
// in rules isn't practical: it needs to search the company doc's `roles` ARRAY for a matching
// role's permission list, and Firestore rules have no array-of-maps lookup — so this now runs
// server-side instead, doing its own authorization check with the Admin SDK (which bypasses rules
// entirely) rather than trying to express that check in rules.
//
// Two modes, both POST with the same auth check:
// - { mode: "preview" } counts the company data tied to the member, per kind (below), so the
//   remove pop-up can show what there is to hand over before anything changes.
// - otherwise, removes them. Each kind switched on in `transfer` is reassigned to `transferToUid`;
//   a kind left off keeps its "not transferred" behaviour (see TRANSFER_KINDS). Nothing is deleted
//   either way — data that isn't transferred stays in the company. All data changes happen BEFORE
//   the membership is removed, so a failure part-way leaves the member in place to retry.

// The company data tied to one member that can be handed over. What happens to each when it is NOT
// transferred (the remove pop-up in company-settings explains the same):
// - assignedProjects: their active (not completed, not deleted) projects → left unassigned.
//   Completed projects keep them as assignee, as history.
// - createdProjects: projects they created (incl. archived ones) → unchanged, still credited to them.
// - contacts: contact cards that list them as creator/assignee → unchanged. When they ARE transferred,
//   a card matching one the recipient already has (same email, phone number or name) is skipped and
//   stays as it is — the recipient already has that person (see contactMatchKeys).
// - leads: leads assigned to them → left unassigned, for someone who sees everyone's leads to pick up.
// - calendarEvents: calendar events they added → unchanged, still showing them as who added them.
const TRANSFER_KINDS = ["assignedProjects", "createdProjects", "contacts", "leads", "calendarEvents"] as const;
type TransferKind = (typeof TRANSFER_KINDS)[number];
type TransferCounts = Record<TransferKind, number>;

function toStr(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeRoleId(raw: unknown): string {
  return toStr(raw).toLowerCase().replace(/\s+/g, "_");
}

// Same field precedence lib/firestore-data.ts's normalizeProject uses to decide who a project is
// assigned to / created by — older project docs store these under different field names.
const PROJECT_ASSIGNEE_UID_FIELDS = ["assignedToUid", "assignedUid", "projectAssignedUid"] as const;
const PROJECT_ASSIGNEE_NAME_FIELDS = ["assignedToName", "assignedName", "projectAssignedName", "assignedTo"] as const;

function projectAssigneeUid(data: Record<string, unknown>): string {
  for (const field of PROJECT_ASSIGNEE_UID_FIELDS) {
    const value = toStr(data[field]);
    if (value) return value;
  }
  return "";
}

function projectCreatorUid(data: Record<string, unknown>): string {
  return toStr(data.createdByUid ?? data.ownerUid);
}

// Mirrors lib/membership.ts's flattenPermissionObject — a permissions map can be stored as nested
// `{ leads: { view: true } }`-style booleans, not just a flat string array.
function flattenPermissionObject(obj: Record<string, unknown>, prefix: string, out: Set<string>) {
  for (const [k, v] of Object.entries(obj)) {
    const key = toStr(k);
    if (!key) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (v === true) {
      out.add(path);
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      flattenPermissionObject(v as Record<string, unknown>, path, out);
    }
  }
}

// Mirrors lib/membership.ts's collectPermissionKeys — every field shape a membership doc's own
// direct permission overrides might be stored under.
function collectPermissionKeys(data: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const pushArray = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      const txt = toStr(item);
      if (txt) out.add(txt);
    }
  };
  pushArray(data.permissions);
  pushArray(data.permissionKeys);
  pushArray(data.rolePermissions);
  pushArray(data.grants);
  for (const source of [data.permissions, data.permissionMap, data.rolePermissionsMap, data.grantsMap]) {
    if (source && typeof source === "object" && !Array.isArray(source)) {
      flattenPermissionObject(source as Record<string, unknown>, "", out);
    }
  }
  return out;
}

// Mirrors lib/membership.ts's permissionKeysFromRoleDef — a role definition's own `permissions`
// field can be a plain string array or a nested boolean map, same as above.
function permissionKeysFromRoleDef(roleDef: unknown, out: Set<string>) {
  if (!roleDef || typeof roleDef !== "object") return;
  const perms = (roleDef as Record<string, unknown>).permissions;
  if (Array.isArray(perms)) {
    for (const p of perms) {
      const txt = toStr(p);
      if (txt) out.add(txt);
    }
  } else if (perms && typeof perms === "object") {
    flattenPermissionObject(perms as Record<string, unknown>, "", out);
  }
}

// Resolves what a member (caller, target or transfer recipient) is in this company — same
// role-override-then-membership-then-role-definition resolution order as
// lib/membership.ts's resolveMembershipToAccess, just read via the Admin SDK. Returns the
// resolved roleId too so callers can also gate on "is this the owner" without a second lookup,
// and the name staff see for them (the company's display-name override first, like the app).
async function resolveMemberAccess(
  companyId: string,
  uid: string,
): Promise<{ exists: boolean; roleId: string; permissionKeys: Set<string>; displayName: string }> {
  if (!adminDb) return { exists: false, roleId: "", permissionKeys: new Set(), displayName: "" };
  const [membershipSnap, companySnap] = await Promise.all([
    adminDb.collection("companies").doc(companyId).collection("memberships").doc(uid).get(),
    adminDb.collection("companies").doc(companyId).get(),
  ]);
  if (!membershipSnap.exists) return { exists: false, roleId: "", permissionKeys: new Set(), displayName: "" };
  const membershipData = (membershipSnap.data() ?? {}) as Record<string, unknown>;
  const companyData = (companySnap.data() ?? {}) as Record<string, unknown>;

  const overrides =
    companyData.staffRoleIdsByUid && typeof companyData.staffRoleIdsByUid === "object"
      ? (companyData.staffRoleIdsByUid as Record<string, unknown>)
      : {};
  const roleId = normalizeRoleId(overrides[uid]) || normalizeRoleId(membershipData.roleId ?? membershipData.role);

  const permissionKeys = collectPermissionKeys(membershipData);
  if (roleId) {
    const roles = Array.isArray(companyData.roles) ? (companyData.roles as Array<Record<string, unknown>>) : [];
    for (const role of roles) {
      const roleIdValue = normalizeRoleId(role.id ?? role.name);
      if (roleIdValue !== roleId) continue;
      permissionKeysFromRoleDef(role, permissionKeys);
      break;
    }
  }
  const nameOverrides =
    companyData.staffDisplayNamesByUid && typeof companyData.staffDisplayNamesByUid === "object"
      ? (companyData.staffDisplayNamesByUid as Record<string, unknown>)
      : {};
  const displayName =
    toStr(nameOverrides[uid]) || toStr(membershipData.displayName) || toStr(membershipData.name) || toStr(membershipData.email);
  return { exists: true, roleId, permissionKeys, displayName };
}

// Same rule as the client's hasPermissionKey (lib/use-company-access.ts), which decides whether the
// remove button shows at all: the exact key, or a `company.*` / `staff.*` wildcard, any case. Checking
// only the exact key here refused e.g. a role granted company.* that the page let press the button.
function hasPermissionKey(keys: Set<string>, key: string): boolean {
  const target = key.trim().toLowerCase();
  const lowered = new Set(Array.from(keys, (k) => k.trim().toLowerCase()));
  if (lowered.has(target) || lowered.has("company.*")) return true;
  const prefix = target.split(".")[0];
  return Boolean(prefix) && lowered.has(`${prefix}.*`);
}

type MemberData = Record<TransferKind, QueryDocumentSnapshot[]>;

// Finds every piece of company data tied to `uid`, per kind. Read-only — used for both the preview
// counts and the actual hand-over, so the two always agree on what counts.
async function collectMemberData(companyId: string, uid: string): Promise<MemberData> {
  const companyRef = adminDb!.collection("companies").doc(companyId);
  const out: MemberData = { assignedProjects: [], createdProjects: [], contacts: [], leads: [], calendarEvents: [] };

  // Projects: one scan covers both kinds (the assignee can sit under several legacy field names, so
  // a single-field query would miss some).
  // "Active" = not deleted, not archived, and not in one of the company's Completed statuses.
  const [jobsSnap, companySnap] = await Promise.all([companyRef.collection("jobs").get(), companyRef.get()]);
  const isCompletedStatus = completedStatusMatcher(((companySnap.data() ?? {}) as Record<string, unknown>).projectStatuses);
  for (const jobDoc of jobsSnap.docs) {
    const data = (jobDoc.data() ?? {}) as Record<string, unknown>;
    if (
      !data.isDeleted &&
      data.isArchived !== true &&
      projectAssigneeUid(data) === uid &&
      !isCompletedStatus(data.statusLabel ?? data.status)
    ) {
      out.assignedProjects.push(jobDoc);
    }
    if (projectCreatorUid(data) === uid) out.createdProjects.push(jobDoc);
  }

  // Contacts: a contact card lists everyone who created or was assigned one of its projects.
  const contactsById = new Map<string, QueryDocumentSnapshot>();
  const [createdContacts, assignedContacts] = await Promise.all([
    companyRef.collection("clients").where("createdByUids", "array-contains", uid).get(),
    companyRef.collection("clients").where("assignedToUids", "array-contains", uid).get(),
  ]);
  [...createdContacts.docs, ...assignedContacts.docs].forEach((d) => {
    if (d.id !== "__meta") contactsById.set(d.id, d);
  });
  out.contacts = Array.from(contactsById.values());

  const [leadsSnap, eventsSnap] = await Promise.all([
    companyRef.collection("leads").where("assignedToUid", "==", uid).get(),
    companyRef.collection("calendarEvents").where("createdByUid", "==", uid).get(),
  ]);
  out.leads = leadsSnap.docs;
  out.calendarEvents = eventsSnap.docs;
  return out;
}

function countsOf(data: MemberData): TransferCounts {
  return {
    assignedProjects: data.assignedProjects.length,
    createdProjects: data.createdProjects.length,
    contacts: data.contacts.length,
    leads: data.leads.length,
    calendarEvents: data.calendarEvents.length,
  };
}

// Batched writes, well under Firestore's 500-writes-per-batch limit.
async function commitUpdates(updates: Map<string, { ref: DocumentReference; patch: Record<string, unknown> }>) {
  const rows = Array.from(updates.values());
  for (let i = 0; i < rows.length; i += 400) {
    const batch = adminDb!.batch();
    rows.slice(i, i + 400).forEach(({ ref, patch }) => batch.update(ref, patch));
    await batch.commit();
  }
}

// What identifies the person on a contact card, for spotting one the recipient already has: the email,
// the phone number's last 8 digits (so "+64 21 123 4567" and "021 123 4567" match) and the name (case
// and spacing ignored).
function contactMatchKeys(data: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const email = toStr(data.emailNormalized || data.email).toLowerCase();
  if (email) keys.push(`email:${email}`);
  const phoneDigits = toStr(data.phone).replace(/\D+/g, "");
  if (phoneDigits.length >= 8) keys.push(`phone:${phoneDigits.slice(-8)}`);
  const name = toStr(data.name).replace(/\s+/g, " ").toLowerCase();
  if (name) keys.push(`name:${name}`);
  return keys;
}

// The match keys of every contact card the recipient is already on (as creator or assignee).
async function contactKeysOf(companyId: string, uid: string): Promise<Set<string>> {
  const clientsRef = adminDb!.collection("companies").doc(companyId).collection("clients");
  const [created, assigned] = await Promise.all([
    clientsRef.where("createdByUids", "array-contains", uid).get(),
    clientsRef.where("assignedToUids", "array-contains", uid).get(),
  ]);
  const keys = new Set<string>();
  for (const contactDoc of [...created.docs, ...assigned.docs]) {
    if (contactDoc.id === "__meta") continue;
    contactMatchKeys((contactDoc.data() ?? {}) as Record<string, unknown>).forEach((key) => keys.add(key));
  }
  return keys;
}

function replaceUid(list: unknown, fromUid: string, toUid: string): string[] {
  const values = Array.isArray(list) ? list.map((v) => toStr(v)).filter(Boolean) : [];
  return Array.from(new Set(values.map((v) => (v === fromUid ? toUid : v))));
}

function readTransferFlags(raw: unknown, transferToUid: string): Record<TransferKind, boolean> {
  const flags = Object.fromEntries(TRANSFER_KINDS.map((kind) => [kind, false])) as Record<TransferKind, boolean>;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const kind of TRANSFER_KINDS) flags[kind] = (raw as Record<string, unknown>)[kind] === true;
    return flags;
  }
  // Older callers only sent transferToUid, which meant "hand over their active projects".
  flags.assignedProjects = Boolean(transferToUid);
  return flags;
}

export async function POST(request: NextRequest) {
  if (!adminDb || !hasFirebaseAdminConfig) {
    return NextResponse.json({ ok: false, error: "missing-firebase-admin-config" }, { status: 500 });
  }

  const callerUid = await verifyBearerUid(request);
  if (!callerUid) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const companyId = toStr(body.companyId);
  const targetUid = toStr(body.uid);
  const isPreview = toStr(body.mode) === "preview";
  const transferToUid = toStr(body.transferToUid);
  if (!companyId || !targetUid) {
    return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });
  }

  const callerAccess = await resolveMemberAccess(companyId, callerUid);
  if (!callerAccess.exists) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const callerIsOwner = callerAccess.roleId === "owner";
  if (!callerIsOwner && !hasPermissionKey(callerAccess.permissionKeys, "staff.remove")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Re-check the TARGET's own role server-side too — never trust the client's own "not the owner"
  // gate alone for the one membership this whole safety net exists to protect.
  const targetAccess = await resolveMemberAccess(companyId, targetUid);
  if (!targetAccess.exists) {
    return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  if (targetAccess.roleId === "owner") {
    return NextResponse.json({ ok: false, error: "owner-cannot-be-removed" }, { status: 400 });
  }

  let memberData: MemberData;
  try {
    memberData = await collectMemberData(companyId, targetUid);
  } catch (error) {
    const message = error instanceof Error ? error.message : "member-data-read-failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  if (isPreview) {
    return NextResponse.json({ ok: true, counts: countsOf(memberData) });
  }

  const transfer = readTransferFlags(body.transfer, transferToUid);
  const transferring = TRANSFER_KINDS.some((kind) => transfer[kind] && memberData[kind].length > 0);
  // The recipient must be someone else who is still in this company — checked here, not just in the
  // pop-up's own picker.
  let transferToName = toStr(body.transferToName);
  if (transferring) {
    if (!transferToUid || transferToUid === targetUid) {
      return NextResponse.json({ ok: false, error: "missing-transfer-target" }, { status: 400 });
    }
    const recipient = await resolveMemberAccess(companyId, transferToUid);
    if (!recipient.exists) {
      return NextResponse.json({ ok: false, error: "transfer-target-not-in-company" }, { status: 400 });
    }
    transferToName = transferToName || recipient.displayName || transferToUid;
  }

  const nowIso = new Date().toISOString();
  const transferred: TransferCounts = { assignedProjects: 0, createdProjects: 0, contacts: 0, leads: 0, calendarEvents: 0 };
  const unassigned = { assignedProjects: 0, leads: 0 };
  // Contacts left as they are because the recipient already has a matching one.
  let skippedContacts = 0;
  const failure = (error: unknown, fallback: string) =>
    NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : fallback, transferredProjects: transferred.assignedProjects },
      { status: 500 },
    );

  // 1) Projects. One patch per project doc, since a project can be both assigned to and created by them.
  try {
    const updates = new Map<string, { ref: DocumentReference; patch: Record<string, unknown> }>();
    const patchFor = (docSnap: QueryDocumentSnapshot) => {
      const existing = updates.get(docSnap.ref.path);
      if (existing) return existing.patch;
      const patch: Record<string, unknown> = { updatedAtIso: nowIso };
      updates.set(docSnap.ref.path, { ref: docSnap.ref, patch });
      return patch;
    };
    for (const jobDoc of memberData.assignedProjects) {
      const data = (jobDoc.data() ?? {}) as Record<string, unknown>;
      const patch = patchFor(jobDoc);
      // The legacy assignee fields only count while assignedToUid is empty — clear any that are set
      // so an unassigned project can't fall back to naming the removed member again.
      for (const field of [...PROJECT_ASSIGNEE_UID_FIELDS, ...PROJECT_ASSIGNEE_NAME_FIELDS]) {
        if (field in data) patch[field] = FieldValue.delete();
      }
      if (transfer.assignedProjects) {
        Object.assign(patch, { assignedToUid: transferToUid, assignedToName: transferToName, assignedTo: transferToName });
        transferred.assignedProjects += 1;
      } else {
        unassigned.assignedProjects += 1;
      }
    }
    if (transfer.createdProjects) {
      for (const jobDoc of memberData.createdProjects) {
        const data = (jobDoc.data() ?? {}) as Record<string, unknown>;
        const patch = patchFor(jobDoc);
        patch.createdByUid = transferToUid;
        patch.createdByName = transferToName;
        if (toStr(data.ownerUid) === targetUid) patch.ownerUid = transferToUid;
        transferred.createdProjects += 1;
      }
    }
    await commitUpdates(updates);
  } catch (error) {
    return failure(error, "project-transfer-failed");
  }

  // 2) Contacts — swap them for the recipient in the card's creator/assignee lists (who can see it).
  //    A card matching one the recipient already has (same email, phone or name) isn't transferred —
  //    it stays as it is, so the recipient doesn't end up with the same person twice. A card the
  //    recipient is already on is the same card, not a duplicate, so that one is transferred as normal.
  if (transfer.contacts && memberData.contacts.length) {
    try {
      const recipientKeys = await contactKeysOf(companyId, transferToUid);
      const updates = new Map<string, { ref: DocumentReference; patch: Record<string, unknown> }>();
      for (const contactDoc of memberData.contacts) {
        const data = (contactDoc.data() ?? {}) as Record<string, unknown>;
        const alreadyOnIt = [data.createdByUids, data.assignedToUids].some(
          (list) => Array.isArray(list) && list.some((value) => toStr(value) === transferToUid),
        );
        if (!alreadyOnIt && contactMatchKeys(data).some((key) => recipientKeys.has(key))) {
          skippedContacts += 1;
          continue;
        }
        updates.set(contactDoc.ref.path, {
          ref: contactDoc.ref,
          patch: {
            createdByUids: replaceUid(data.createdByUids, targetUid, transferToUid),
            assignedToUids: replaceUid(data.assignedToUids, targetUid, transferToUid),
          },
        });
      }
      await commitUpdates(updates);
      transferred.contacts = updates.size;
    } catch (error) {
      return failure(error, "contact-transfer-failed");
    }
  }

  // 3) Leads — reassigned, or left unassigned (same empty-string shape app/api/leads's PATCH writes).
  if (memberData.leads.length) {
    try {
      const updates = new Map<string, { ref: DocumentReference; patch: Record<string, unknown> }>();
      const assignee = transfer.leads ? { uid: transferToUid, name: transferToName } : { uid: "", name: "" };
      for (const leadDoc of memberData.leads) {
        updates.set(leadDoc.ref.path, {
          ref: leadDoc.ref,
          patch: {
            assignedToUid: assignee.uid,
            assignedToName: assignee.name,
            assignedTo: assignee.name,
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtIso: nowIso,
          },
        });
      }
      await commitUpdates(updates);
      if (transfer.leads) transferred.leads = memberData.leads.length;
      else unassigned.leads = memberData.leads.length;
    } catch (error) {
      return failure(error, "lead-transfer-failed");
    }
  }

  // 4) Calendar events they added — the recipient is shown as who added them.
  if (transfer.calendarEvents && memberData.calendarEvents.length) {
    try {
      const updates = new Map<string, { ref: DocumentReference; patch: Record<string, unknown> }>();
      for (const eventDoc of memberData.calendarEvents) {
        updates.set(eventDoc.ref.path, { ref: eventDoc.ref, patch: { createdByUid: transferToUid, createdByName: transferToName } });
      }
      await commitUpdates(updates);
      transferred.calendarEvents = memberData.calendarEvents.length;
    } catch (error) {
      return failure(error, "calendar-transfer-failed");
    }
  }

  // 5) Find every membership/member doc that actually represents the target in this company —
  //    same multi-shape discovery as the client version (different-aged companies ended up with
  //    this doc under slightly different collection names/shapes over time).
  const membershipRefs = new Map<string, DocumentReference>();
  const addRef = (ref: DocumentReference | null | undefined) => {
    if (!ref) return;
    membershipRefs.set(ref.path, ref);
  };
  addRef(adminDb.collection("companies").doc(companyId).collection("memberships").doc(targetUid));
  addRef(adminDb.collection("companies").doc(companyId).collection("members").doc(targetUid));
  try {
    const byUid = await adminDb
      .collection("companies").doc(companyId).collection("memberships")
      .where("uid", "==", targetUid).limit(20).get();
    byUid.docs.forEach((d) => addRef(d.ref));
  } catch {
    // continue into broader fallbacks
  }
  try {
    const byUid = await adminDb
      .collection("companies").doc(companyId).collection("members")
      .where("uid", "==", targetUid).limit(20).get();
    byUid.docs.forEach((d) => addRef(d.ref));
  } catch {
    // continue into broader fallbacks
  }
  try {
    const scan = await adminDb.collection("companies").doc(companyId).collection("memberships").limit(500).get();
    scan.docs.forEach((d) => {
      const data = (d.data() ?? {}) as Record<string, unknown>;
      if (toStr(data.uid) === targetUid || d.id === targetUid) addRef(d.ref);
    });
  } catch {
    // ignore fallback scan errors
  }
  try {
    const scan = await adminDb.collection("companies").doc(companyId).collection("members").limit(500).get();
    scan.docs.forEach((d) => {
      const data = (d.data() ?? {}) as Record<string, unknown>;
      if (toStr(data.uid) === targetUid || d.id === targetUid) addRef(d.ref);
    });
  } catch {
    // ignore fallback scan errors
  }
  try {
    const group = await adminDb.collectionGroup("memberships").where("uid", "==", targetUid).limit(50).get();
    group.docs.forEach((d) => {
      if (d.ref.parent.parent?.id === companyId) addRef(d.ref);
    });
  } catch {
    // ignore collection-group fallback errors
  }

  // 6) Actually delete them — the critical access-revoking step, so unlike the best-effort
  //    fallbacks above, a failure here is fatal and reported back.
  try {
    for (const ref of membershipRefs.values()) {
      await ref.delete();
    }
  } catch (error) {
    return failure(error, "membership-delete-failed");
  }

  // 7) Clear the target out of the company doc's own staff override maps.
  try {
    await adminDb.collection("companies").doc(companyId).update({
      [`staffDisplayNamesByUid.${targetUid}`]: FieldValue.delete(),
      [`staffRoleIdsByUid.${targetUid}`]: FieldValue.delete(),
      updatedAtIso: nowIso,
    });
  } catch (error) {
    return failure(error, "company-member-cleanup-failed");
  }

  // 8) Best-effort: point the removed user's own profile doc at another company they still
  //    belong to (or clear it) — never fatal, since the membership doc above is the real access
  //    gate and this is just tidying a now-stale pointer on their own users/{uid} doc.
  try {
    const remainingCompanyIds = new Set<string>();
    const remaining = await adminDb.collectionGroup("memberships").where("uid", "==", targetUid).limit(100).get();
    for (const d of remaining.docs) {
      const otherCompanyId = d.ref.parent.parent?.id ?? "";
      if (otherCompanyId && otherCompanyId !== companyId) remainingCompanyIds.add(otherCompanyId);
    }
    const nextCompanyId = Array.from(remainingCompanyIds)[0] ?? "";
    const userRef = adminDb.collection("users").doc(targetUid);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
      const nestedCompany =
        userData.company && typeof userData.company === "object" ? (userData.company as Record<string, unknown>) : null;
      const userPatch: Record<string, unknown> = {};
      if (toStr(userData.companyId) === companyId) {
        userPatch.companyId = nextCompanyId || FieldValue.delete();
      }
      if (toStr(userData.activeCompanyId) === companyId) {
        userPatch.activeCompanyId = nextCompanyId || FieldValue.delete();
      }
      if (toStr(nestedCompany?.id) === companyId) {
        userPatch["company.id"] = nextCompanyId || FieldValue.delete();
      }
      if (toStr(nestedCompany?.companyId) === companyId) {
        userPatch["company.companyId"] = nextCompanyId || FieldValue.delete();
      }
      if (Object.keys(userPatch).length) {
        userPatch.updatedAtIso = nowIso;
        await userRef.update(userPatch);
      }
    }
  } catch {
    // membership removal is the critical access gate; profile fallback cleanup is best-effort
  }

  return NextResponse.json({
    ok: true,
    // Kept for older callers: the number of active projects handed over.
    transferredProjects: transferred.assignedProjects,
    transferred,
    unassigned,
    skippedContacts,
  });
}
