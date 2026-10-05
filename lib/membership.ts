import { db } from "@/lib/firebase";
import {
  cachedValue,
  invalidateCompanyCache,
  readCompanyDocCached,
  readMembershipDocCached,
  readUserDocCached,
} from "@/lib/firestore-cache";
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

// Role overrides and role definitions come from the company doc, read through the shared short-lived
// cache (lib/firestore-cache.ts). Callers that change staffRoleIdsByUid or the roles (e.g.
// company-settings' save handlers) must call this afterward so the next read is fresh.
export function invalidateCompanyRoleOverridesCache(companyId?: string): void {
  invalidateCompanyCache(companyId);
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
  try {
    const data = (await readCompanyDocCached(cid)) ?? {};
    return normalizeCompanyRoleOverrides(data.staffRoleIdsByUid);
  } catch {
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
    const data = await readUserDocCached(userId);
    if (!data) {
      return null;
    }
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
    const data = await readCompanyDocCached(companyId);
    if (!data) {
      return [];
    }
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
    const data = await readUserDocCached(String(uid).trim());
    if (!data) {
      return null;
    }
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
  // The user's own profile names their company; then that company's membership doc and the company
  // doc (role overrides + role permissions) are read together. All three go through the shared cache
  // (lib/firestore-cache.ts), so the profile read is also the one fetchUserProfileSummary and the
  // access checks use. This used to start with a collectionGroup("memberships") query filtered by
  // documentId() == uid, which the Firestore SDK always rejects (a collection-group documentId filter
  // needs a full document path, not a bare uid) — silently caught, so every sign-in paid for it and
  // then ran this same chain one read after another.
  try {
    const userData = await readUserDocCached(uid);
    const nestedCompany =
      userData && typeof userData.company === "object" && userData.company !== null
        ? (userData.company as Record<string, unknown>)
        : null;
    const companyId = String(
      userData?.companyId ?? userData?.activeCompanyId ?? nestedCompany?.id ?? nestedCompany?.companyId ?? "",
    ).trim();
    if (!companyId) {
      return null;
    }
    const [membershipData] = await Promise.all([
      readMembershipDocCached(companyId, uid),
      readCompanyDocCached(companyId).catch(() => null),
    ]);
    if (!membershipData) {
      return null;
    }
    const access = await resolveMembershipToAccess(companyId, uid, membershipData);
    return {
      role: access.role,
      companyId,
      displayName: access.displayName,
      permissionKeys: access.permissionKeys,
      roleId: access.roleId,
    };
  } catch {
    return null;
  }
}

export async function fetchCompanyAccess(companyId: string, uid: string): Promise<CompanyAccessInfo | null> {
  if (!db || !companyId || !uid) {
    return null;
  }

  const cid = String(companyId).trim();
  const userId = String(uid).trim();

  // Shared for a minute (lib/firestore-cache.ts) — several parts of a page (the app shell, the page's
  // own access check, project loading) ask the same question on load. The account-level access, the
  // membership doc and the company doc (role overrides/permissions) are all read at once.
  return cachedValue(`access:${cid}:${userId}`, () => resolveCompanyAccess(cid, userId)).catch(() => null);
}

async function resolveCompanyAccess(cid: string, userId: string): Promise<CompanyAccessInfo | null> {
  const [accountAccess, membershipData] = await Promise.all([
    fetchUserAccountAccess(userId),
    readMembershipDocCached(cid, userId).catch(() => null),
    readCompanyDocCached(cid).catch(() => null),
  ]);

  // Primary path used by desktop: companies/{companyId}/memberships/{uid}
  if (membershipData) {
    return mergeAccessWithUserAccount(await resolveMembershipToAccess(cid, userId, membershipData), accountAccess);
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

  const hits = await Promise.all(
    candidates.map(async (companyId) => ((await readMembershipDocCached(companyId, userId).catch(() => null)) ? companyId : "")),
  );
  return hits.find(Boolean) ?? "";
}
