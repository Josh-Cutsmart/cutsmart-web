import { randomInt } from "crypto";
import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { hasPermissionKey, resolveMemberAccess } from "@/lib/company-access-server";
import { checkJoinCodeRole, companyRoleIdsOf, joinRoleIdFor, type JoinRoleSetter } from "@/lib/company-join-code-role";

// A company's join codes (Company Settings > Company > Join key), handled server-side only.
//
// - companyJoinCodes/{key}: the lookup a code is joined with. It only exists while the code can be
//   used — firestore.rules lets a membership be created only with a key that's here and points at
//   that company — so deleting it is what stops a code working.
// - companies/{companyId}/joinCodes/{key}: the company's own record of each code: master or
//   temporary, who it was for, who used it and when, and whether it was revoked. Not readable by the
//   app directly; GET /api/company/join-codes lists it for owners/admins.
//
// The master code is the company's long-lived one (companies/{id}.joinCode and the older field names
// for it). Changing it doesn't touch anyone already in the company — only joining needs the new one.
// A temporary code is for one person: it stops working the moment they join, so they never learn the
// master code and can't come back with it after being removed. Revoking a used one means removing
// them first (with the usual hand-over of their data); revoking an unused one just cancels it.
//
// Inviting someone (Company Settings > Staff > Add staff) makes them a temporary code too, linked to the
// invite (inviteId, invitedEmail): accepting the invite uses it up, the same as joining with it, so they
// show as having joined with it — and joining with it accepts the invite. Cancelling the invite revokes
// it. A revoked code can then be deleted from the list. Add staff can also link one of the company's waiting codes
// to the invite instead of making a new one (linkCodeToInvite).
//
// A temporary code can carry the role its person starts in (roleId — Add staff's Role), checked here when it's set
// (lib/company-join-code-role.ts: one of the company's roles, never Owner, Admin only from an owner or admin, and
// anything but Staff only from someone who can change staff roles). Joining with it — or accepting its invite — gives
// them that role, checked again then (deleted since: Staff). Without one, and with the master code, it's Staff.

export type JoinCodeKind = "master" | "temporary";
export type JoinCodeStatus = "active" | "used" | "revoked" | "replaced";

export type JoinCodeRecord = {
  key: string;
  code: string;
  kind: JoinCodeKind;
  status: JoinCodeStatus;
  label: string;
  createdAtIso: string;
  createdByUid: string;
  createdByName: string;
  usedByUid: string;
  usedByName: string;
  usedByEmail: string;
  usedAtIso: string;
  revokedAtIso: string;
  // Made for an invite: which one, and who it was sent to.
  inviteId: string;
  invitedEmail: string;
  // The role its person starts in ("" — Staff). Temporary codes only.
  roleId: string;
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const MIN_MASTER_CODE_LENGTH = 4;

function toStr(v: unknown): string {
  return String(v ?? "").trim();
}

// The key a code is stored under — same as the app's (lib/company-onboarding.ts).
export function joinCodeKeyFor(code: string): string {
  return toStr(code).toLowerCase().replace(/\s+/g, "");
}

export function masterCodeOf(companyData: Record<string, unknown>): string {
  return toStr(companyData.joinCode ?? companyData.companyCode ?? companyData.joinPassword ?? companyData.companyPassword);
}

function randomCode(): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    if (i === 4) out += "-";
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

function recordFrom(key: string, data: Record<string, unknown>): JoinCodeRecord {
  const kind = toStr(data.kind) === "master" ? "master" : "temporary";
  const status = toStr(data.status);
  return {
    key,
    code: toStr(data.code) || key.toUpperCase(),
    kind,
    status: status === "used" || status === "revoked" || status === "replaced" ? status : "active",
    label: toStr(data.label),
    createdAtIso: toStr(data.createdAtIso),
    createdByUid: toStr(data.createdByUid),
    createdByName: toStr(data.createdByName),
    usedByUid: toStr(data.usedByUid),
    usedByName: toStr(data.usedByName),
    usedByEmail: toStr(data.usedByEmail),
    usedAtIso: toStr(data.usedAtIso),
    revokedAtIso: toStr(data.revokedAtIso),
    inviteId: toStr(data.inviteId),
    invitedEmail: toStr(data.invitedEmail),
    roleId: toStr(data.roleId),
  };
}

// Owners, and anyone who can add staff or change company settings. Also what roles they can put on a code (`setter`,
// for checkCodeRole): the same as the Staff table lets them give (owner, or staff.change.role).
export async function canManageJoinCodes(companyId: string, uid: string): Promise<{ ok: boolean; name: string; setter: JoinRoleSetter }> {
  const access = await resolveMemberAccess(companyId, uid);
  if (!access.exists) return { ok: false, name: "", setter: { isOwnerOrAdmin: false, canChangeRoles: false } };
  const isOwnerOrAdmin = access.roleId === "owner" || access.roleId === "admin";
  const ok =
    isOwnerOrAdmin ||
    hasPermissionKey(access.permissionKeys, "staff.add") ||
    hasPermissionKey(access.permissionKeys, "company.settings");
  const canChangeRoles = access.roleId === "owner" || hasPermissionKey(access.permissionKeys, "staff.change.role");
  return { ok, name: access.displayName, setter: { isOwnerOrAdmin, canChangeRoles } };
}

// Whether this role can go on one of this company's codes, from this person (lib/company-join-code-role.ts), against
// the company's roles as they are now. `roleId` back: "" when none was asked for.
export async function checkCodeRole(db: Firestore, companyId: string, setter: JoinRoleSetter, roleIdRaw: unknown) {
  if (!toStr(roleIdRaw)) return { ok: true as const, roleId: "" };
  const companyData = ((await db.collection("companies").doc(companyId).get()).data() ?? {}) as Record<string, unknown>;
  return checkJoinCodeRole(roleIdRaw, companyRoleIdsOf(companyData), setter);
}

export async function listJoinCodes(db: Firestore, companyId: string) {
  const companyRef = db.collection("companies").doc(companyId);
  const [companySnap, recordsSnap] = await Promise.all([companyRef.get(), companyRef.collection("joinCodes").get()]);
  const masterCode = masterCodeOf((companySnap.data() ?? {}) as Record<string, unknown>);
  const codes = recordsSnap.docs
    .map((doc) => recordFrom(doc.id, (doc.data() ?? {}) as Record<string, unknown>))
    .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
  return { masterCode, masterKey: joinCodeKeyFor(masterCode), codes };
}

export async function createTemporaryCode(
  db: Firestore,
  companyId: string,
  by: { uid: string; name: string },
  label: string,
  invite?: { inviteId: string; invitedEmail: string },
  // Already checked (checkCodeRole).
  roleId = "",
) {
  const companyRef = db.collection("companies").doc(companyId);
  const companyName = toStr(((await companyRef.get()).data() ?? {}).name);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = randomCode();
    const key = joinCodeKeyFor(code);
    const lookupRef = db.collection("companyJoinCodes").doc(key);
    const created = await db.runTransaction(async (tx) => {
      if ((await tx.get(lookupRef)).exists) return false;
      const nowIso = new Date().toISOString();
      tx.set(lookupRef, { id: key, companyId, companyName, active: true, kind: "temporary", createdAtIso: nowIso, updatedAtIso: nowIso });
      tx.set(companyRef.collection("joinCodes").doc(key), {
        code,
        kind: "temporary",
        status: "active",
        label: label.slice(0, 80),
        createdAtIso: nowIso,
        createdByUid: by.uid,
        createdByName: by.name,
        ...(invite?.inviteId ? { inviteId: invite.inviteId, invitedEmail: invite.invitedEmail.toLowerCase() } : {}),
        ...(roleId ? { roleId } : {}),
      });
      return true;
    });
    if (created) return { ok: true as const, code, key };
  }
  return { ok: false as const, error: "could-not-create" };
}

// A new master code. Staff already in the company stay; the old code stops working for anyone new.
export async function changeMasterCode(db: Firestore, companyId: string, by: { uid: string; name: string }, nextCodeRaw: string) {
  const nextCode = toStr(nextCodeRaw);
  const nextKey = joinCodeKeyFor(nextCode);
  if (nextKey.length < MIN_MASTER_CODE_LENGTH) return { ok: false as const, error: "too-short" };
  const companyRef = db.collection("companies").doc(companyId);
  const nextLookupRef = db.collection("companyJoinCodes").doc(nextKey);
  return db.runTransaction(async (tx) => {
    const [companySnap, nextLookup] = await Promise.all([tx.get(companyRef), tx.get(nextLookupRef)]);
    const companyData = (companySnap.data() ?? {}) as Record<string, unknown>;
    const previousCode = masterCodeOf(companyData);
    const previousKey = joinCodeKeyFor(previousCode);
    if (nextLookup.exists && toStr(nextLookup.data()?.companyId) !== companyId) return { ok: false as const, error: "code-taken" };
    if (nextLookup.exists && nextKey !== previousKey) return { ok: false as const, error: "code-taken" };
    const previousLookupRef = previousKey ? db.collection("companyJoinCodes").doc(previousKey) : null;
    const previousLookup = previousLookupRef && previousKey !== nextKey ? await tx.get(previousLookupRef) : null;
    const nowIso = new Date().toISOString();
    tx.set(
      companyRef,
      { companyCode: nextCode, companyPassword: nextCode, joinCode: nextCode, joinPassword: nextCode, updatedAt: FieldValue.serverTimestamp(), updatedAtIso: nowIso },
      { merge: true },
    );
    tx.set(nextLookupRef, {
      id: nextKey,
      companyId,
      companyName: toStr(companyData.name ?? companyData.companyName),
      active: true,
      kind: "master",
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    });
    tx.set(companyRef.collection("joinCodes").doc(nextKey), {
      code: nextCode,
      kind: "master",
      status: "active",
      label: "",
      createdAtIso: nowIso,
      createdByUid: by.uid,
      createdByName: by.name,
    });
    if (previousLookupRef && previousLookup?.exists && toStr(previousLookup.data()?.companyId) === companyId) {
      tx.delete(previousLookupRef);
    }
    if (previousKey && previousKey !== nextKey) {
      tx.set(
        companyRef.collection("joinCodes").doc(previousKey),
        { code: previousCode, kind: "master", status: "replaced", revokedAtIso: nowIso },
        { merge: true },
      );
    }
    return { ok: true as const, code: nextCode, key: nextKey };
  });
}

// Stops a temporary code working. One that's been used can only be revoked once the person who used
// it has been removed from the company (the app removes them first, with the hand-over of their data).
export async function revokeTemporaryCode(db: Firestore, companyId: string, key: string) {
  const companyRef = db.collection("companies").doc(companyId);
  const recordRef = companyRef.collection("joinCodes").doc(key);
  const recordSnap = await recordRef.get();
  if (!recordSnap.exists) return { ok: false as const, error: "not-found" };
  const record = recordFrom(key, (recordSnap.data() ?? {}) as Record<string, unknown>);
  if (record.kind !== "temporary") return { ok: false as const, error: "not-temporary" };
  if (record.usedByUid) {
    const stillMember = (await companyRef.collection("memberships").doc(record.usedByUid).get()).exists;
    if (stillMember) return { ok: false as const, error: "member-still-in-company" };
  }
  const lookupRef = db.collection("companyJoinCodes").doc(key);
  const lookup = await lookupRef.get();
  const batch = db.batch();
  if (lookup.exists && toStr(lookup.data()?.companyId) === companyId) batch.delete(lookupRef);
  batch.set(recordRef, { status: "revoked", revokedAtIso: new Date().toISOString() }, { merge: true });
  await batch.commit();
  return { ok: true as const };
}

// An access code's name (its label — "For Sam"), changed: any temporary code, used or not. (Its code itself never changes —
// it may already be written down or sent.) Up to 80 characters; empty takes the name off.
export async function renameTemporaryCode(db: Firestore, companyId: string, key: string, labelRaw: string) {
  const recordRef = db.collection("companies").doc(companyId).collection("joinCodes").doc(key);
  const recordSnap = await recordRef.get();
  if (!recordSnap.exists) return { ok: false as const, error: "not-found" };
  const record = recordFrom(key, (recordSnap.data() ?? {}) as Record<string, unknown>);
  if (record.kind !== "temporary") return { ok: false as const, error: "not-temporary" };
  await recordRef.set({ label: toStr(labelRaw).slice(0, 80) }, { merge: true });
  return { ok: true as const };
}

// Add staff with one of the company's codes: links that code to the invite, as if it had been made for it, with the
// role picked if there was one (already checked, checkCodeRole). Only a temporary code that's still waiting: not used,
// revoked, or some other invite's already. Its label stays.
export async function linkCodeToInvite(
  db: Firestore,
  companyId: string,
  key: string,
  invite: { inviteId: string; invitedEmail: string },
  roleId = "",
) {
  if (!key || !invite.inviteId) return { ok: false as const, error: "missing-invite" };
  const recordRef = db.collection("companies").doc(companyId).collection("joinCodes").doc(key);
  const lookupRef = db.collection("companyJoinCodes").doc(key);
  return db.runTransaction(async (tx) => {
    const [recordSnap, lookup] = await Promise.all([tx.get(recordRef), tx.get(lookupRef)]);
    if (!recordSnap.exists) return { ok: false as const, error: "code-not-available" };
    const record = recordFrom(key, (recordSnap.data() ?? {}) as Record<string, unknown>);
    const lookupData = (lookup.data() ?? {}) as Record<string, unknown>;
    const waiting =
      record.kind === "temporary" &&
      record.status === "active" &&
      !record.usedByUid &&
      !record.inviteId &&
      lookup.exists &&
      lookupData.active !== false &&
      toStr(lookupData.companyId) === companyId;
    if (!waiting) return { ok: false as const, error: "code-not-available" };
    tx.set(
      recordRef,
      { inviteId: invite.inviteId, invitedEmail: invite.invitedEmail.toLowerCase(), ...(roleId ? { roleId } : {}) },
      { merge: true },
    );
    return { ok: true as const, code: record.code, key };
  });
}

// Cancelling an invite: revokes the code made for it, if it hasn't been used. `exceptKey`: one to leave alone (the
// code just linked to it, inviting the same person again).
export async function revokeCodesForInvite(db: Firestore, companyId: string, inviteId: string, exceptKey = "") {
  if (!inviteId) return { ok: false as const, error: "missing-invite" };
  const companyRef = db.collection("companies").doc(companyId);
  const linked = await companyRef.collection("joinCodes").where("inviteId", "==", inviteId).get();
  const nowIso = new Date().toISOString();
  const batch = db.batch();
  let revoked = 0;
  for (const doc of linked.docs) {
    if (exceptKey && doc.id === exceptKey) continue;
    const record = recordFrom(doc.id, (doc.data() ?? {}) as Record<string, unknown>);
    if (record.status !== "active" || record.usedByUid) continue;
    const lookupRef = db.collection("companyJoinCodes").doc(doc.id);
    const lookup = await lookupRef.get();
    if (lookup.exists && toStr(lookup.data()?.companyId) === companyId) batch.delete(lookupRef);
    batch.set(doc.ref, { status: "revoked", revokedAtIso: nowIso }, { merge: true });
    revoked += 1;
  }
  if (revoked) await batch.commit();
  return { ok: true as const, revoked };
}

// Removes a revoked code from the list for good (it already can't be joined with).
export async function deleteRevokedCode(db: Firestore, companyId: string, key: string) {
  const recordRef = db.collection("companies").doc(companyId).collection("joinCodes").doc(key);
  const recordSnap = await recordRef.get();
  if (!recordSnap.exists) return { ok: true as const };
  const record = recordFrom(key, (recordSnap.data() ?? {}) as Record<string, unknown>);
  if (record.status !== "revoked") return { ok: false as const, error: "not-revoked" };
  const lookupRef = db.collection("companyJoinCodes").doc(key);
  const lookup = await lookupRef.get();
  const batch = db.batch();
  if (lookup.exists && toStr(lookup.data()?.companyId) === companyId) batch.delete(lookupRef);
  batch.delete(recordRef);
  await batch.commit();
  return { ok: true as const };
}

// Someone joining who was in the company before: a role the Staff table gave them back then (the company's
// staffRoleIdsByUid) would still win over the one they're joining with, so it goes. Removing someone clears it
// already; this is for anyone who left some other way.
function clearOldRoleOverride(tx: Transaction, companyRef: DocumentReference, companyData: Record<string, unknown>, uid: string) {
  const overrides =
    companyData.staffRoleIdsByUid && typeof companyData.staffRoleIdsByUid === "object"
      ? (companyData.staffRoleIdsByUid as Record<string, unknown>)
      : {};
  if (toStr(overrides[uid])) tx.update(companyRef, { [`staffRoleIdsByUid.${uid}`]: FieldValue.delete() });
}

// Joins a company with a code (master or temporary). A temporary code is used up by this join.
export async function joinWithCode(
  db: Firestore,
  user: { uid: string; email: string; name: string },
  codeRaw: string,
): Promise<{ ok: true; companyId: string } | { ok: false; error: string }> {
  const key = joinCodeKeyFor(codeRaw);
  if (!key) return { ok: false, error: "missing-code" };
  const lookupRef = db.collection("companyJoinCodes").doc(key);
  return db.runTransaction(async (tx) => {
    const lookup = await tx.get(lookupRef);
    const lookupData = (lookup.data() ?? {}) as Record<string, unknown>;
    const companyId = toStr(lookupData.companyId);
    if (!lookup.exists || !companyId || lookupData.active === false) return { ok: false as const, error: "no-such-code" };
    const companyRef = db.collection("companies").doc(companyId);
    const recordRef = companyRef.collection("joinCodes").doc(key);
    const membershipRef = companyRef.collection("memberships").doc(user.uid);
    const [companySnap, recordSnap, membershipSnap] = await Promise.all([tx.get(companyRef), tx.get(recordRef), tx.get(membershipRef)]);
    if (!companySnap.exists) return { ok: false as const, error: "no-such-code" };
    const companyData = (companySnap.data() ?? {}) as Record<string, unknown>;
    const record = recordSnap.exists ? recordFrom(key, (recordSnap.data() ?? {}) as Record<string, unknown>) : null;
    const isMaster = joinCodeKeyFor(masterCodeOf(companyData)) === key;
    const isTemporary = !isMaster && (record?.kind === "temporary" || toStr(lookupData.kind) === "temporary");
    if (isTemporary && (!record || record.status !== "active" || record.usedByUid)) return { ok: false as const, error: "no-such-code" };
    // Joining again (already a member): nothing to do.
    if (membershipSnap.exists) return { ok: true as const, companyId };
    const nowIso = new Date().toISOString();
    const companyName = toStr(companyData.name ?? companyData.companyName ?? lookupData.companyName);
    // A temporary code's role (checked again: deleted since, Staff). The master code's is always Staff.
    const roleId = joinRoleIdFor(isTemporary ? record?.roleId : "", companyRoleIdsOf(companyData));
    clearOldRoleOverride(tx, companyRef, companyData, user.uid);
    tx.set(membershipRef, {
      uid: user.uid,
      email: user.email,
      displayName: user.name || user.email || "User",
      role: roleId,
      roleId,
      joinCodeKey: key,
      joinedVia: isTemporary ? "temporary-code" : "master-code",
      companyName,
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: nowIso,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtIso: nowIso,
    });
    tx.set(
      db.collection("users").doc(user.uid),
      { email: user.email, companyId, updatedAt: FieldValue.serverTimestamp(), updatedAtIso: nowIso },
      { merge: true },
    );
    if (isTemporary) {
      tx.delete(lookupRef);
      tx.set(
        recordRef,
        { status: "used", usedByUid: user.uid, usedByName: user.name || user.email, usedByEmail: user.email, usedAtIso: nowIso },
        { merge: true },
      );
      // An invite's code: joining with it accepts the invite.
      if (record?.inviteId) tx.delete(companyRef.collection("invites").doc(record.inviteId));
    }
    return { ok: true as const, companyId };
  });
}

// Accepts an invite sent to this account's email (Company Settings > Staff > Add staff).
export async function joinWithInvite(
  db: Firestore,
  user: { uid: string; email: string; name: string },
  companyId: string,
  inviteId: string,
): Promise<{ ok: true; companyId: string } | { ok: false; error: string }> {
  if (!companyId || !inviteId || !user.email) return { ok: false, error: "missing-invite" };
  const companyRef = db.collection("companies").doc(companyId);
  const inviteRef = companyRef.collection("invites").doc(inviteId);
  return db.runTransaction(async (tx) => {
    const [invite, companySnap, membershipSnap, linkedCodes] = await Promise.all([
      tx.get(inviteRef),
      tx.get(companyRef),
      tx.get(companyRef.collection("memberships").doc(user.uid)),
      tx.get(companyRef.collection("joinCodes").where("inviteId", "==", inviteId)),
    ]);
    // The code made for this invite, if it's still waiting: accepting uses it up (as if they'd joined
    // with it), so they show as having joined with it.
    const linkedCode = linkedCodes.docs.find((doc) => {
      const record = recordFrom(doc.id, (doc.data() ?? {}) as Record<string, unknown>);
      return record.status === "active" && !record.usedByUid;
    });
    const inviteData = (invite.data() ?? {}) as Record<string, unknown>;
    const inviteEmail = toStr(inviteData.emailLower ?? inviteData.email).toLowerCase();
    if (!invite.exists || !companySnap.exists || inviteEmail !== user.email.toLowerCase()) return { ok: false as const, error: "no-such-invite" };
    const nowIso = new Date().toISOString();
    if (!membershipSnap.exists) {
      const companyData = (companySnap.data() ?? {}) as Record<string, unknown>;
      // Its code's role (checked again: deleted since, Staff). No code waiting, Staff.
      const linkedRoleId = linkedCode ? recordFrom(linkedCode.id, (linkedCode.data() ?? {}) as Record<string, unknown>).roleId : "";
      const roleId = joinRoleIdFor(linkedRoleId, companyRoleIdsOf(companyData));
      clearOldRoleOverride(tx, companyRef, companyData, user.uid);
      tx.set(companyRef.collection("memberships").doc(user.uid), {
        uid: user.uid,
        email: user.email,
        displayName: user.name || user.email || "User",
        role: roleId,
        roleId,
        joinedVia: "invite",
        ...(linkedCode ? { joinCodeKey: linkedCode.id } : {}),
        companyName: toStr(companyData.name ?? companyData.companyName),
        createdAt: FieldValue.serverTimestamp(),
        createdAtIso: nowIso,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtIso: nowIso,
      });
    }
    tx.set(
      db.collection("users").doc(user.uid),
      { email: user.email, companyId, updatedAt: FieldValue.serverTimestamp(), updatedAtIso: nowIso },
      { merge: true },
    );
    tx.delete(inviteRef);
    if (linkedCode && !membershipSnap.exists) {
      tx.delete(db.collection("companyJoinCodes").doc(linkedCode.id));
      tx.set(
        linkedCode.ref,
        { status: "used", usedByUid: user.uid, usedByName: user.name || user.email, usedByEmail: user.email, usedAtIso: nowIso },
        { merge: true },
      );
    }
    return { ok: true as const, companyId };
  });
}
