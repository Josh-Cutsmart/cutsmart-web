import { collectionGroup, doc, documentId, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { UserRole } from "@/lib/types";
const COMPANY_ID_HINTS = Array.from(
  new Set(
    [
      String(process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID ?? "").trim(),
      "cmp_mykm_91647c",
    ].filter(Boolean),
  ),
);

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
  mobile?: string;
  userColor?: string;
  companyId?: string;
  verified?: boolean;
  // "Notifications as Creator" (User Settings) — when true, a project this user creates
  // auto-subscribes them to its notifications, same as the assigned user already does by
  // default. Off by default: see isProjectNotifySubscribed in lib/project-notify.ts.
  notifyAsCreator?: boolean;
}

export interface CompanyAccessInfo {
  role: UserRole;
  permissionKeys: string[];
  roleId?: string;
  displayName?: string;
}

const companyRoleOverridesCache = new Map<string, Record<string, string>>();

// This cache never expired on its own — a company doc fetch failure permanently cached an empty
// override map for that company, and a real staff role-override change made elsewhere was never
// picked up by an already-open tab without a full reload. Callers that mutate staffRoleIdsByUid
// (e.g. company-settings' own save handlers) must call this afterward so the next read is fresh.
export function invalidateCompanyRoleOverridesCache(companyId?: string): void {
  if (!companyId) {
    companyRoleOverridesCache.clear();
    return;
  }
  companyRoleOverridesCache.delete(String(companyId).trim());
}

function normalizeRoleId(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function normalizeRole(raw: unknown): UserRole | null {
  const role = normalizeRoleId(raw);
  return role || null;
}

function rolePriority(role: UserRole): number {
  if (role === "owner") {
    return 3;
  }
  if (role === "admin") {
    return 2;
  }
  return 1;
}

function strongerRole(primary: UserRole | null | undefined, secondary: UserRole | null | undefined): UserRole {
  const first = primary ?? "staff";
  const second = secondary ?? "staff";
  return rolePriority(first) >= rolePriority(second) ? first : second;
}

function bestMembership(items: MembershipInfo[]): MembershipInfo | null {
  if (!items.length) {
    return null;
  }
  const sorted = [...items].sort((a, b) => {
    const byRole = rolePriority(b.role) - rolePriority(a.role);
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

  return normalizePermissionKeys(Array.from(out));
}

function normalizePermissionKeys(values: string[]): string[] {
  return Array.from(
    new Set(
      values.flatMap((value) => {
        const clean = String(value || "").trim();
        if (!clean) return [];
        if (clean === "leads.*") {
          return ["leads.view", "leads.view.others"];
        }
        if (clean === "projects.create.others") {
          return [clean, "projects.create.other", "projects.assign.other"];
        }
        return [clean];
      }),
    ),
  );
}

function deriveRoleFromPermissions(permissionKeys: string[]): UserRole | null {
  const normalized = new Set(permissionKeys.map((key) => String(key || "").trim().toLowerCase()));
  const has = (key: string) => normalized.has(String(key || "").trim().toLowerCase());
  if (has("company.*")) {
    return "admin";
  }
  if (has("company.settings") || has("projects.status") || has("users.manage")) {
    return "admin";
  }
  return null;
}

function normalizeCompanyRoleOverrides(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [rawUid, rawRoleId] of Object.entries(raw as Record<string, unknown>)) {
    const uid = String(rawUid || "").trim();
    const roleId = normalizeRoleId(rawRoleId);
    if (uid && roleId) {
      out[uid] = roleId;
    }
  }
  return out;
}

async function fetchCompanyRoleOverridesForCompany(companyId: string): Promise<Record<string, string>> {
  const cid = String(companyId || "").trim();
  if (!db || !cid) {
    return {};
  }
  if (companyRoleOverridesCache.has(cid)) {
    return companyRoleOverridesCache.get(cid) ?? {};
  }
  try {
    const snap = await getDoc(doc(db, "companies", cid));
    const data = snap.exists() ? ((snap.data() ?? {}) as Record<string, unknown>) : {};
    const overrides = normalizeCompanyRoleOverrides(data.staffRoleIdsByUid);
    companyRoleOverridesCache.set(cid, overrides);
    return overrides;
  } catch {
    companyRoleOverridesCache.set(cid, {});
    return {};
  }
}

async function applyCompanyRoleOverride(
  companyId: string,
  uid: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) {
    return data;
  }
  const overrides = await fetchCompanyRoleOverridesForCompany(companyId);
  const overrideRoleId = overrides[cleanUid];
  if (!overrideRoleId) {
    return data;
  }
  return {
    ...data,
    roleId: overrideRoleId,
    role: overrideRoleId,
  };
}

function permissionKeysFromRoleDef(roleDef: unknown): string[] {
  if (!roleDef || typeof roleDef !== "object") {
    return [];
  }
  const role = roleDef as Record<string, unknown>;
  const perms = role.permissions;
  if (Array.isArray(perms)) {
    return normalizePermissionKeys(perms.map((value) => String(value ?? "").trim()).filter(Boolean));
  }
  if (!perms || typeof perms !== "object") {
    return [];
  }
  const keys = flattenPermissionObject(perms as Record<string, unknown>);
  return normalizePermissionKeys(Array.from(keys));
}

async function fetchUserAccountAccess(uid: string): Promise<CompanyAccessInfo | null> {
  const userId = String(uid || "").trim();
  if (!db || !userId) {
    return null;
  }
  try {
    const snap = await getDoc(doc(db, "users", userId));
    if (!snap.exists()) {
      return null;
    }
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const permissionKeys = collectPermissionKeys(data);
    const role =
      normalizeRole(data.roleId ?? data.role) ??
      deriveRoleFromPermissions(permissionKeys) ??
      null;
    if (!role && !permissionKeys.length) {
      return null;
    }
    return {
      role: role ?? "staff",
      permissionKeys,
      roleId: normalizeRoleId(data.roleId ?? data.role) || undefined,
      displayName: String(data.displayName ?? data.name ?? "").trim() || undefined,
    };
  } catch {
    return null;
  }
}

function mergeAccessWithUserAccount(baseAccess: CompanyAccessInfo | null, accountAccess: CompanyAccessInfo | null): CompanyAccessInfo | null {
  if (!baseAccess && !accountAccess) {
    return null;
  }
  if (!baseAccess) {
    return accountAccess;
  }
  if (!accountAccess) {
    return baseAccess;
  }
  return {
    role: strongerRole(baseAccess.role, accountAccess.role),
    permissionKeys: Array.from(
      new Set([
        ...baseAccess.permissionKeys.map((value) => String(value || "").trim()).filter(Boolean),
        ...accountAccess.permissionKeys.map((value) => String(value || "").trim()).filter(Boolean),
      ]),
    ),
    roleId: baseAccess.roleId || accountAccess.roleId,
    displayName: baseAccess.displayName || accountAccess.displayName,
  };
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
  uid: string,
  data: Record<string, unknown>,
): Promise<CompanyAccessInfo> {
  const effectiveData = await applyCompanyRoleOverride(companyId, uid, data);
  const roleId = normalizeRoleId(effectiveData.roleId ?? effectiveData.role);
  let permissionKeys = collectPermissionKeys(effectiveData);
  if (roleId) {
    permissionKeys = normalizePermissionKeys([
      ...permissionKeys,
      ...(await fetchRolePermissionsForCompany(companyId, roleId)),
    ]);
  }
  const role = normalizeRole(effectiveData.roleId ?? effectiveData.role) ?? deriveRoleFromPermissions(permissionKeys) ?? "staff";
  return {
    role,
    permissionKeys,
    roleId: roleId || undefined,
    displayName: String(effectiveData.displayName ?? "").trim() || undefined,
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
    const mobile = String(data.mobile ?? data.phone ?? "").trim();
    const userColor = String(data.userColor ?? data.avatarColor ?? "").trim();
    const nestedCompany =
      typeof data.company === "object" && data.company !== null
        ? (data.company as Record<string, unknown>)
        : null;
    const companyId = String(
      data.companyId ??
        data.activeCompanyId ??
        nestedCompany?.id ??
        nestedCompany?.companyId ??
        "",
    ).trim();
    return {
      displayName,
      email,
      mobile: mobile || undefined,
      userColor: userColor || undefined,
      companyId: companyId || undefined,
      // Absent field = unverified — never default this to true, a missing doc/field must never
      // read as "trusted."
      verified: Boolean(data.verified),
      notifyAsCreator: Boolean(data.notifyAsCreator),
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

  // Rules-friendly path for schemas where membership doc id == auth uid.
  try {
    const byDocId = await getDocs(
      query(
        collectionGroup(db, "memberships"),
        where(documentId(), "==", uid),
        limit(50),
      ),
    );

    for (const docSnap of byDocId.docs) {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      const companyId = String(docSnap.ref.parent.parent?.id ?? "").trim();
      if (!companyId) {
        continue;
      }

      const effectiveData = await applyCompanyRoleOverride(companyId, uid, data);
      const roleId = normalizeRoleId(effectiveData.roleId ?? effectiveData.role);
      let permissionKeys = collectPermissionKeys(effectiveData);
      if (roleId) {
        const cacheKey = `${companyId}::${roleId}`;
        if (!companyRolePermissionsCache.has(cacheKey)) {
          const rolePerms = await fetchRolePermissionsForCompany(companyId, roleId);
          companyRolePermissionsCache.set(cacheKey, rolePerms);
        }
        permissionKeys = normalizePermissionKeys([
          ...permissionKeys,
          ...(companyRolePermissionsCache.get(cacheKey) ?? []),
        ]);
      }

      const role = normalizeRole(effectiveData.roleId ?? effectiveData.role) ?? deriveRoleFromPermissions(permissionKeys) ?? "staff";
      found.push({
        role,
        companyId,
        displayName: String(effectiveData.displayName ?? "").trim() || undefined,
        permissionKeys,
        roleId: roleId || undefined,
      });
    }
  } catch {
    // continue fallbacks
  }

  if (found.length) {
    return bestMembership(found);
  }

  // The three fallbacks that used to live here — collectionGroup("members") by doc id,
  // collectionGroup("memberships") filtered on a plain "uid" data field, and an unfiltered
  // collectionGroup("memberships") scan — can never succeed against this app's actual
  // firestore.rules: a collection-group query is only allowed when Firestore can statically
  // prove every possible match satisfies the rule, which requires constraining by document ID
  // the way the query above does. A data-field filter or no filter at all can't be proven safe
  // (and there's no rule for a "members" collection at all, anywhere), so each of those three
  // always threw a silently-swallowed permission-denied — pure wasted network round trips (part
  // of why loading felt slow on a cold connection), never a real safety net.
  //
  // The one fallback that IS rules-legitimate: read the user's own profile doc (isSelf(uid)
  // always allows this) for a companyId hint, then a direct doc get at that company's membership
  // doc — genuinely useful for the rare account whose membership doc id isn't its own uid.
  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    const userData = userSnap.exists() ? ((userSnap.data() ?? {}) as Record<string, unknown>) : null;
    const companyId = userData
      ? String(userData.companyId ?? userData.activeCompanyId ?? "").trim()
      : "";
    if (companyId) {
      const membershipSnap = await getDoc(doc(db, "companies", companyId, "memberships", uid));
      if (membershipSnap.exists()) {
        const data = (membershipSnap.data() ?? {}) as Record<string, unknown>;
        const effectiveData = await applyCompanyRoleOverride(companyId, uid, data);
        const roleId = normalizeRoleId(effectiveData.roleId ?? effectiveData.role);
        let permissionKeys = collectPermissionKeys(effectiveData);
        if (roleId) {
          const cacheKey = `${companyId}::${roleId}`;
          if (!companyRolePermissionsCache.has(cacheKey)) {
            const rolePerms = await fetchRolePermissionsForCompany(companyId, roleId);
            companyRolePermissionsCache.set(cacheKey, rolePerms);
          }
          permissionKeys = normalizePermissionKeys([
            ...permissionKeys,
            ...(companyRolePermissionsCache.get(cacheKey) ?? []),
          ]);
        }
        const role = normalizeRole(effectiveData.roleId ?? effectiveData.role) ?? deriveRoleFromPermissions(permissionKeys) ?? "staff";
        found.push({
          role,
          companyId,
          displayName: String(effectiveData.displayName ?? "").trim() || undefined,
          permissionKeys,
          roleId: roleId || undefined,
        });
      }
    }
  } catch {
    // no membership found via the profile-doc hint either
  }

  return bestMembership(found);
}

export async function fetchCompanyAccess(companyId: string, uid: string): Promise<CompanyAccessInfo | null> {
  if (!db || !companyId || !uid) {
    return null;
  }

  const cid = String(companyId).trim();
  const userId = String(uid).trim();
  const accountAccess = await fetchUserAccountAccess(userId);

  // Primary path used by desktop: companies/{companyId}/memberships/{uid}
  try {
    const direct = await getDoc(doc(db, "companies", cid, "memberships", userId));
    if (direct.exists()) {
      const data = (direct.data() ?? {}) as Record<string, unknown>;
      return mergeAccessWithUserAccount(await resolveMembershipToAccess(cid, userId, data), accountAccess);
    }
  } catch {
    // continue fallbacks
  }

  // The two fallbacks that used to live here (a collectionGroup("memberships") query filtered on
  // a plain "uid" data field, and an unfiltered collectionGroup("memberships") scan) can never
  // succeed against this app's actual firestore.rules — a collection-group query is only allowed
  // when Firestore can statically prove every possible match satisfies the rule, which the direct
  // doc-id read above already does correctly; neither of those two shapes can be proven safe, so
  // they always threw a silently-swallowed permission-denied. Since companyId is already known
  // here, the direct doc get above is the only rules-legitimate membership check possible — if
  // it's empty, there's nothing further worth trying.
  return accountAccess;
}

export async function resolveCompanyIdForUid(
  uid: string,
  preferredCompanyIds?: string[],
): Promise<string> {
  const userId = String(uid || "").trim();
  if (!db || !userId) {
    return "";
  }

  const membership = await fetchPrimaryMembership(userId);
  if (membership?.companyId) {
    return String(membership.companyId).trim();
  }

  const profile = await fetchUserProfileSummary(userId);
  if (profile?.companyId) {
    return String(profile.companyId).trim();
  }

  const candidates = Array.from(
    new Set(
      [
        ...(preferredCompanyIds ?? []),
        ...COMPANY_ID_HINTS,
      ]
        .map((v) => String(v || "").trim())
        .filter(Boolean),
    ),
  );

  for (const companyId of candidates) {
    try {
      const membershipSnap = await getDoc(doc(db, "companies", companyId, "memberships", userId));
      if (membershipSnap.exists()) {
        return companyId;
      }
    } catch {
      // try next candidate
    }
  }

  return "";
}
