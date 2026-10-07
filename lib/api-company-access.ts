import type { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyBearerUid } from "@/lib/api-auth";

// Server-side (Admin SDK) "is the caller a member of this company, and what can they do there" check
// for API routes. The caller is identified by their Firebase ID token (Authorization: Bearer …, see
// verifyBearerUid) — never by a uid/companyId/scope in the query string or body, which anyone can
// send. Mirrors the client's own resolution in lib/membership.ts (fetchCompanyAccess): the company
// membership doc (with the company's staffRoleIdsByUid override applied), the permissions of that
// role from the company's roles list, merged with the account-level role/permissions on users/{uid}.

export type ApiCompanyAccess = {
  uid: string;
  role: string;
  permissionKeys: string[];
};

const toStr = (value: unknown) => String(value ?? "").trim();
const normalizeRoleId = (raw: unknown) => toStr(raw).toLowerCase().replace(/\s+/g, "_");

function flattenPermissionObject(obj: Record<string, unknown>, prefix: string, out: Set<string>) {
  for (const [k, v] of Object.entries(obj)) {
    const key = toStr(k);
    if (!key) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (v === true) out.add(path);
    else if (v && typeof v === "object" && !Array.isArray(v)) flattenPermissionObject(v as Record<string, unknown>, path, out);
  }
}

function normalizePermissionKeys(values: string[]): string[] {
  return Array.from(
    new Set(
      values.flatMap((value) => {
        const clean = toStr(value);
        if (!clean) return [];
        if (clean === "leads.*") return ["leads.view", "leads.view.others"];
        if (clean === "projects.create.others") return [clean, "projects.create.other", "projects.assign.other"];
        return [clean];
      }),
    ),
  );
}

function collectPermissionKeys(data: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const list of [data.permissions, data.permissionKeys, data.rolePermissions, data.grants]) {
    if (Array.isArray(list)) list.forEach((item) => toStr(item) && out.add(toStr(item)));
  }
  for (const source of [data.permissions, data.permissionMap, data.rolePermissionsMap, data.grantsMap]) {
    if (source && typeof source === "object" && !Array.isArray(source)) flattenPermissionObject(source as Record<string, unknown>, "", out);
  }
  return normalizePermissionKeys(Array.from(out));
}

function rolePermissionKeys(companyData: Record<string, unknown>, roleId: string): string[] {
  const roles = Array.isArray(companyData.roles) ? (companyData.roles as Array<Record<string, unknown>>) : [];
  const role = roles.find((r) => normalizeRoleId(r?.id ?? r?.name) === roleId);
  if (!role) return [];
  const perms = role.permissions;
  if (Array.isArray(perms)) return normalizePermissionKeys(perms.map(toStr).filter(Boolean));
  if (perms && typeof perms === "object") {
    const out = new Set<string>();
    flattenPermissionObject(perms as Record<string, unknown>, "", out);
    return normalizePermissionKeys(Array.from(out));
  }
  return [];
}

const ROLE_PRIORITY: Record<string, number> = { owner: 3, admin: 2 };
function strongerRole(a: string, b: string): string {
  return (ROLE_PRIORITY[b] ?? 0) > (ROLE_PRIORITY[a] ?? 0) ? b : a;
}

// The signed-in caller's access to `companyId`, or null if they aren't signed in or aren't part of
// that company. "Part of" = a membership doc in the company, or (older accounts) their own user doc
// naming this company.
export async function requireCompanyMember(request: NextRequest, companyId: string): Promise<ApiCompanyAccess | null> {
  const cid = toStr(companyId);
  if (!adminDb || !cid) return null;
  const uid = await verifyBearerUid(request);
  if (!uid) return null;
  const companyRef = adminDb.collection("companies").doc(cid);
  const [membershipSnap, companySnap, userSnap] = await Promise.all([
    companyRef.collection("memberships").doc(uid).get(),
    companyRef.get(),
    adminDb.collection("users").doc(uid).get(),
  ]);
  if (!companySnap.exists) return null;
  const userData = (userSnap.exists ? userSnap.data() : {}) as Record<string, unknown>;
  if (!membershipSnap.exists && toStr(userData.companyId) !== cid) return null;

  return resolveMemberAccess(
    (companySnap.data() ?? {}) as Record<string, unknown>,
    uid,
    (membershipSnap.exists ? membershipSnap.data() : {}) as Record<string, unknown>,
    userData,
  );
}

// What `uid` can do in a company, from the company doc, their membership doc and their user doc (the
// part of requireCompanyMember after it has read those) — also used to work out who should hear about
// something (e.g. a new lead) without them being the caller.
export function resolveMemberAccess(
  companyData: Record<string, unknown>,
  uid: string,
  membershipData: Record<string, unknown>,
  userData: Record<string, unknown>,
): ApiCompanyAccess {
  const overrides = (companyData.staffRoleIdsByUid ?? {}) as Record<string, unknown>;
  const roleId = normalizeRoleId(overrides[uid] ?? membershipData.roleId ?? membershipData.role);
  const permissionKeys = normalizePermissionKeys([
    ...collectPermissionKeys(membershipData),
    ...(roleId ? rolePermissionKeys(companyData, roleId) : []),
    ...collectPermissionKeys(userData),
  ]);
  const lowered = new Set(permissionKeys.map((key) => key.toLowerCase()));
  const derived = lowered.has("company.*") || lowered.has("company.settings") || lowered.has("projects.status") || lowered.has("users.manage") ? "admin" : "staff";
  const accountRole = normalizeRoleId(userData.roleId ?? userData.role);
  const role = strongerRole(roleId || derived, accountRole || "staff");
  return { uid, role, permissionKeys };
}

export type CompanyMemberAccessRow = { access: ApiCompanyAccess; displayName: string };

// Every member of a company (their membership docs), with what each can do.
export async function listCompanyMemberAccess(companyId: string): Promise<CompanyMemberAccessRow[]> {
  const cid = toStr(companyId);
  if (!adminDb || !cid) return [];
  const db = adminDb;
  const companyRef = db.collection("companies").doc(cid);
  const [companySnap, membershipsSnap] = await Promise.all([companyRef.get(), companyRef.collection("memberships").limit(500).get()]);
  if (!companySnap.exists) return [];
  const companyData = (companySnap.data() ?? {}) as Record<string, unknown>;
  const members = membershipsSnap.docs
    .map((docSnap) => ({ uid: toStr((docSnap.data() ?? {}).uid) || docSnap.id, data: (docSnap.data() ?? {}) as Record<string, unknown> }))
    .filter((member) => member.uid);
  if (!members.length) return [];
  const userSnaps = await db.getAll(...members.map((member) => db.collection("users").doc(member.uid)));
  return members.map((member, index) => {
    const userData = (userSnaps[index]?.exists ? userSnaps[index].data() : {}) as Record<string, unknown>;
    const nameOverrides = (companyData.staffDisplayNamesByUid ?? {}) as Record<string, unknown>;
    return {
      access: resolveMemberAccess(companyData, member.uid, member.data, userData),
      displayName: toStr(nameOverrides[member.uid]) || toStr(member.data.displayName ?? member.data.name) || toStr(userData.displayName) || toStr(member.data.email),
    };
  });
}

// Same rules as the client's hasPermissionKey (lib/use-company-access.ts), plus owners/admins.
export function apiHasPermission(access: ApiCompanyAccess, key: string): boolean {
  if (access.role === "owner" || access.role === "admin") return true;
  const target = key.trim().toLowerCase();
  const keys = access.permissionKeys.map((item) => item.trim().toLowerCase());
  if (keys.includes(target) || keys.includes("company.*")) return true;
  const prefix = target.split(".")[0];
  return Boolean(prefix) && keys.includes(`${prefix}.*`);
}
