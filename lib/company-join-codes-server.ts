import { randomInt } from "crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { hasPermissionKey, resolveMemberAccess } from "@/lib/company-access-server";

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
  };
}

// Owners, and anyone who can add staff or change company settings.
export async function canManageJoinCodes(companyId: string, uid: string): Promise<{ ok: boolean; name: string }> {
  const access = await resolveMemberAccess(companyId, uid);
  if (!access.exists) return { ok: false, name: "" };
  const ok =
    access.roleId === "owner" ||
    access.roleId === "admin" ||
    hasPermissionKey(access.permissionKeys, "staff.add") ||
    hasPermissionKey(access.permissionKeys, "company.settings");
  return { ok, name: access.displayName };
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

export async function createTemporaryCode(db: Firestore, companyId: string, by: { uid: string; name: string }, label: string) {
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
    tx.set(membershipRef, {
      uid: user.uid,
      email: user.email,
      displayName: user.name || user.email || "User",
      role: "staff",
      roleId: "staff",
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
    const [invite, companySnap, membershipSnap] = await Promise.all([
      tx.get(inviteRef),
      tx.get(companyRef),
      tx.get(companyRef.collection("memberships").doc(user.uid)),
    ]);
    const inviteData = (invite.data() ?? {}) as Record<string, unknown>;
    const inviteEmail = toStr(inviteData.emailLower ?? inviteData.email).toLowerCase();
    if (!invite.exists || !companySnap.exists || inviteEmail !== user.email.toLowerCase()) return { ok: false as const, error: "no-such-invite" };
    const nowIso = new Date().toISOString();
    if (!membershipSnap.exists) {
      const companyData = (companySnap.data() ?? {}) as Record<string, unknown>;
      tx.set(companyRef.collection("memberships").doc(user.uid), {
        uid: user.uid,
        email: user.email,
        displayName: user.name || user.email || "User",
        role: "staff",
        roleId: "staff",
        joinedVia: "invite",
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
    return { ok: true as const, companyId };
  });
}
