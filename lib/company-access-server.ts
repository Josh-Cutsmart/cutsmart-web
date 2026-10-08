import { adminDb } from "@/lib/firebase-admin";

// Who someone is in a company, read with the Admin SDK: their role and every permission key they
// have — the server-side twin of lib/membership.ts's resolveMembershipToAccess. Shared by the API
// routes that need to check the caller (and sometimes another member) before changing anything.

function toStr(v: unknown): string {
  return String(v ?? "").trim();
}

export function normalizeRoleId(raw: unknown): string {
  return toStr(raw).toLowerCase().replace(/\s+/g, "_");
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
export async function resolveMemberAccess(
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
export function hasPermissionKey(keys: Set<string>, key: string): boolean {
  const target = key.trim().toLowerCase();
  const lowered = new Set(Array.from(keys, (k) => k.trim().toLowerCase()));
  if (lowered.has(target) || lowered.has("company.*")) return true;
  const prefix = target.split(".")[0];
  return Boolean(prefix) && lowered.has(`${prefix}.*`);
}
