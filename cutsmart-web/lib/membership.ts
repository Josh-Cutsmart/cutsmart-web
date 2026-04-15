import { collectionGroup, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { UserRole } from "@/lib/types";

const rolePriority: Record<UserRole, number> = {
  owner: 5,
  admin: 4,
  sales: 3,
  production: 2,
  viewer: 1,
};

export interface MembershipInfo {
  role: UserRole;
  companyId: string;
  displayName?: string;
  permissionKeys: string[];
  roleId?: string;
}

export interface UserProfileSummary {
  displayName: string;
  email: string;
  userColor?: string;
}

export interface CompanyAccessInfo {
  role: UserRole;
  permissionKeys: string[];
  roleId?: string;
  displayName?: string;
}

function normalizeRole(raw: unknown): UserRole | null {
  const role = String(raw ?? "").trim().toLowerCase();
  if (role === "owner" || role === "admin" || role === "sales" || role === "production" || role === "viewer") {
    return role;
  }
  return null;
}

function bestMembership(items: MembershipInfo[]): MembershipInfo | null {
  if (!items.length) {
    return null;
  }
  const sorted = [...items].sort((a, b) => {
    const byRole = rolePriority[b.role] - rolePriority[a.role];
    if (byRole !== 0) {
      return byRole;
    }
    return (b.permissionKeys?.length ?? 0) - (a.permissionKeys?.length ?? 0);
  });
  return sorted[0] ?? null;
}

function flattenPermissionObject(obj: Record<string, unknown>, prefix = "", out?: Set<string>) {
  const bucket = out ?? new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k || "").trim();
    if (!key) {
      continue;
    }
    const path = prefix ? `${prefix}.${key}` : key;
    if (v === true) {
      bucket.add(path);
      continue;
    }
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      flattenPermissionObject(v as Record<string, unknown>, path, bucket);
      continue;
    }
  }
  return bucket;
}

function collectPermissionKeys(data: Record<string, unknown>): string[] {
  const out = new Set<string>();

  const push = (value: unknown) => {
    const txt = String(value ?? "").trim();
    if (txt) {
      out.add(txt);
    }
  };

  const fromArray = (value: unknown) => {
    if (!Array.isArray(value)) {
      return;
    }
    for (const item of value) {
      push(item);
    }
  };

  fromArray(data.permissions);
  fromArray(data.permissionKeys);
  fromArray(data.rolePermissions);
  fromArray(data.grants);

  for (const source of [data.permissions, data.permissionMap, data.rolePermissionsMap, data.grantsMap]) {
    if (typeof source === "object" && source !== null && !Array.isArray(source)) {
      flattenPermissionObject(source as Record<string, unknown>, "", out);
    }
  }

  return Array.from(out);
}

function deriveRoleFromPermissions(permissionKeys: string[]): UserRole | null {
  const normalized = new Set(permissionKeys.map((key) => String(key || "").trim().toLowerCase()));
  const has = (key: string) => normalized.has(String(key || "").trim().toLowerCase());
  if (has("company.settings") || has("projects.status") || has("users.manage")) {
    return "admin";
  }
  if (has("production.key") || has("production.edit") || has("production.view")) {
    return "production";
  }
  if (has("sales.edit") || has("sales.view")) {
    return "sales";
  }
  return null;
}

function normalizeRoleId(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function permissionKeysFromRoleDef(roleDef: unknown): string[] {
  if (!roleDef || typeof roleDef !== "object") {
    return [];
  }
  const role = roleDef as Record<string, unknown>;
  const perms = role.permissions;
  if (!perms || typeof perms !== "object" || Array.isArray(perms)) {
    return [];
  }
  const keys = flattenPermissionObject(perms as Record<string, unknown>);
  return Array.from(keys);
}

async function fetchRolePermissionsForCompany(companyId: string, roleId: string): Promise<string[]> {
  if (!db || !companyId || !roleId) {
    return [];
  }
  try {
    const snap = await getDoc(doc(db, "companies", companyId));
    if (!snap.exists()) {
      return [];
    }
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const roles = Array.isArray(data.roles) ? (data.roles as Array<Record<string, unknown>>) : [];
    const wanted = normalizeRoleId(roleId);
    for (const role of roles) {
      const roleIdValue = normalizeRoleId(role.id ?? role.name);
      if (!roleIdValue || roleIdValue !== wanted) {
        continue;
      }
      return permissionKeysFromRoleDef(role);
    }
    return [];
  } catch {
    return [];
  }
}

async function resolveMembershipToAccess(
  companyId: string,
  data: Record<string, unknown>,
): Promise<CompanyAccessInfo> {
  const roleId = normalizeRoleId(data.roleId ?? data.role);
  let permissionKeys = collectPermissionKeys(data);
  if (!permissionKeys.length && roleId) {
    permissionKeys = await fetchRolePermissionsForCompany(companyId, roleId);
  }
  const role = normalizeRole(data.roleId ?? data.role) ?? deriveRoleFromPermissions(permissionKeys) ?? "viewer";
  return {
    role,
    permissionKeys,
    roleId: roleId || undefined,
    displayName: String(data.displayName ?? "").trim() || undefined,
  };
}

export async function fetchUserProfileSummary(uid: string): Promise<UserProfileSummary | null> {
  if (!db || !uid) {
    return null;
  }
  try {
    const snap = await getDoc(doc(db, "users", String(uid).trim()));
    if (!snap.exists()) {
      return null;
    }
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const email = String(data.email ?? "").trim();
    const displayName = String(data.displayName ?? "").trim();
    const userColor = String(data.userColor ?? data.avatarColor ?? "").trim();
    return {
      displayName,
      email,
      userColor: userColor || undefined,
    };
  } catch {
    return null;
  }
}

export async function fetchPrimaryMembership(uid: string): Promise<MembershipInfo | null> {
  if (!db || !uid) {
    return null;
  }

  const found: MembershipInfo[] = [];
  const companyRolePermissionsCache = new Map<string, string[]>();

  try {
    const snap = await getDocs(
      query(
        collectionGroup(db, "memberships"),
        where("uid", "==", uid),
        limit(50),
      ),
    );

    for (const docSnap of snap.docs) {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      const companyId = String(docSnap.ref.parent.parent?.id ?? "").trim();
      if (!companyId) {
        continue;
      }

      const roleId = normalizeRoleId(data.roleId ?? data.role);
      let permissionKeys = collectPermissionKeys(data);
      if (!permissionKeys.length && roleId) {
        const cacheKey = `${companyId}::${roleId}`;
        if (!companyRolePermissionsCache.has(cacheKey)) {
          const rolePerms = await fetchRolePermissionsForCompany(companyId, roleId);
          companyRolePermissionsCache.set(cacheKey, rolePerms);
        }
        permissionKeys = [...(companyRolePermissionsCache.get(cacheKey) ?? [])];
      }

      const role = normalizeRole(data.roleId ?? data.role) ?? deriveRoleFromPermissions(permissionKeys) ?? "viewer";
      found.push({
        role,
        companyId,
        displayName: String(data.displayName ?? "").trim() || undefined,
        permissionKeys,
        roleId: roleId || undefined,
      });
    }
  } catch {
    // fallback below
  }

  if (found.length) {
    return bestMembership(found);
  }

  // Legacy fallback: membership doc id can be uid with no `uid` field.
  try {
    const snap = await getDocs(query(collectionGroup(db, "memberships"), limit(300)));
    for (const docSnap of snap.docs) {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      const uidField = String(data.uid ?? "").trim();
      const docId = String(docSnap.id ?? "").trim();
      if (uidField !== uid && docId !== uid) {
        continue;
      }
      const companyId = String(docSnap.ref.parent.parent?.id ?? "").trim();
      if (!companyId) {
        continue;
      }

      const roleId = normalizeRoleId(data.roleId ?? data.role);
      let permissionKeys = collectPermissionKeys(data);
      if (!permissionKeys.length && roleId) {
        const cacheKey = `${companyId}::${roleId}`;
        if (!companyRolePermissionsCache.has(cacheKey)) {
          const rolePerms = await fetchRolePermissionsForCompany(companyId, roleId);
          companyRolePermissionsCache.set(cacheKey, rolePerms);
        }
        permissionKeys = [...(companyRolePermissionsCache.get(cacheKey) ?? [])];
      }

      const role = normalizeRole(data.roleId ?? data.role) ?? deriveRoleFromPermissions(permissionKeys) ?? "viewer";
      found.push({
        role,
        companyId,
        displayName: String(data.displayName ?? "").trim() || undefined,
        permissionKeys,
        roleId: roleId || undefined,
      });
    }
  } catch {
    return null;
  }

  return bestMembership(found);
}

export async function fetchCompanyAccess(companyId: string, uid: string): Promise<CompanyAccessInfo | null> {
  if (!db || !companyId || !uid) {
    return null;
  }

  const cid = String(companyId).trim();
  const userId = String(uid).trim();

  // Primary path used by desktop: companies/{companyId}/memberships/{uid}
  try {
    const direct = await getDoc(doc(db, "companies", cid, "memberships", userId));
    if (direct.exists()) {
      const data = (direct.data() ?? {}) as Record<string, unknown>;
      return await resolveMembershipToAccess(cid, data);
    }
  } catch {
    // continue fallbacks
  }

  // Fallback for schemas where uid is inside doc payload.
  try {
    const snap = await getDocs(
      query(
        collectionGroup(db, "memberships"),
        where("uid", "==", userId),
        limit(100),
      ),
    );
    for (const docSnap of snap.docs) {
      const parentCompanyId = String(docSnap.ref.parent.parent?.id ?? "").trim();
      if (parentCompanyId !== cid) {
        continue;
      }
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      return await resolveMembershipToAccess(cid, data);
    }
  } catch {
    // ignore
  }

  // Last fallback: scan by doc id == uid under collection group.
  try {
    const snap = await getDocs(query(collectionGroup(db, "memberships"), limit(500)));
    for (const docSnap of snap.docs) {
      const parentCompanyId = String(docSnap.ref.parent.parent?.id ?? "").trim();
      if (parentCompanyId !== cid) {
        continue;
      }
      if (String(docSnap.id ?? "").trim() !== userId) {
        continue;
      }
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      return await resolveMembershipToAccess(cid, data);
    }
  } catch {
    return null;
  }

  return null;
}
