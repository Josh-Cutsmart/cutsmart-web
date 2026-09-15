import { NextRequest, NextResponse } from "next/server";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { adminDb, hasFirebaseAdminConfig } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";

// Removing a staff member from a company used to be attempted directly from the client SDK (see
// removeCompanyMemberDetailed in lib/firestore-data.ts), but firestore.rules has always had
// `allow delete: if false` on companies/{companyId}/memberships/{uid} with no exception — so that
// call was guaranteed to fail with permission-denied for every caller, always. Replicating the
// full "does this caller have staff.remove" check (lib/membership.ts's resolveMembershipToAccess)
// in rules isn't practical: it needs to search the company doc's `roles` ARRAY for a matching
// role's permission list, and Firestore rules have no array-of-maps lookup — so this now runs
// server-side instead, doing its own authorization check with the Admin SDK (which bypasses rules
// entirely) rather than trying to express that check in rules.

function toStr(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeRoleId(raw: unknown): string {
  return toStr(raw).toLowerCase().replace(/\s+/g, "_");
}

function isCompletedStatus(value: unknown): boolean {
  const normalized = toStr(value).toLowerCase().replace(/[^a-z]/g, "");
  return normalized === "complete" || normalized === "completed";
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

// Resolves what the caller (not the target) is actually allowed to do in this company — same
// role-override-then-membership-then-role-definition resolution order as
// lib/membership.ts's resolveMembershipToAccess, just read via the Admin SDK. Returns the
// resolved roleId too so callers can also gate on "is this the owner" without a second lookup.
async function resolveMemberAccess(
  companyId: string,
  uid: string,
): Promise<{ exists: boolean; roleId: string; permissionKeys: Set<string> }> {
  if (!adminDb) return { exists: false, roleId: "", permissionKeys: new Set() };
  const [membershipSnap, companySnap] = await Promise.all([
    adminDb.collection("companies").doc(companyId).collection("memberships").doc(uid).get(),
    adminDb.collection("companies").doc(companyId).get(),
  ]);
  if (!membershipSnap.exists) return { exists: false, roleId: "", permissionKeys: new Set() };
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
  return { exists: true, roleId, permissionKeys };
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
  const transferToUid = toStr(body.transferToUid);
  const transferToName = toStr(body.transferToName);
  if (!companyId || !targetUid) {
    return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });
  }

  const callerAccess = await resolveMemberAccess(companyId, callerUid);
  if (!callerAccess.exists) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const callerIsOwner = callerAccess.roleId === "owner";
  if (!callerIsOwner && !callerAccess.permissionKeys.has("staff.remove")) {
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

  const nowIso = new Date().toISOString();
  let transferredProjects = 0;

  // 1) Reassign (or clear) the target's own active projects — same rule as
  //    removeCompanyMemberDetailed's own project-transfer step, ported to the Admin SDK.
  try {
    const jobsSnap = await adminDb.collection("companies").doc(companyId).collection("jobs").get();
    for (const jobDoc of jobsSnap.docs) {
      const data = (jobDoc.data() ?? {}) as Record<string, unknown>;
      if (Boolean(data.isDeleted)) continue;
      if (toStr(data.assignedToUid) !== targetUid) continue;
      if (isCompletedStatus(data.statusLabel ?? data.status)) continue;
      const transferPatch: Record<string, unknown> = transferToUid
        ? { assignedToUid: transferToUid, assignedToName: transferToName, assignedTo: transferToName }
        : { assignedToUid: FieldValue.delete(), assignedToName: FieldValue.delete(), assignedTo: FieldValue.delete() };
      await jobDoc.ref.update({ ...transferPatch, updatedAtIso: nowIso });
      transferredProjects += 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "project-transfer-failed";
    return NextResponse.json({ ok: false, error: message, transferredProjects }, { status: 500 });
  }

  // 2) Find every membership/member doc that actually represents the target in this company —
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

  // 3) Actually delete them — the critical access-revoking step, so unlike the best-effort
  //    fallbacks above, a failure here is fatal and reported back.
  try {
    for (const ref of membershipRefs.values()) {
      await ref.delete();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "membership-delete-failed";
    return NextResponse.json({ ok: false, error: message, transferredProjects }, { status: 500 });
  }

  // 4) Clear the target out of the company doc's own staff override maps.
  try {
    await adminDb.collection("companies").doc(companyId).update({
      [`staffDisplayNamesByUid.${targetUid}`]: FieldValue.delete(),
      [`staffRoleIdsByUid.${targetUid}`]: FieldValue.delete(),
      updatedAtIso: nowIso,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "company-member-cleanup-failed";
    return NextResponse.json({ ok: false, error: message, transferredProjects }, { status: 500 });
  }

  // 5) Best-effort: point the removed user's own profile doc at another company they still
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

  return NextResponse.json({ ok: true, transferredProjects });
}
