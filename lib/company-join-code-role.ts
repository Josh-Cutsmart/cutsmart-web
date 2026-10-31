// The role someone starts in when they join with an access code (a temporary join code — Company Settings > Staff >
// Add staff picks it). The code's record keeps it (roleId), set only by the server, so it's never taken from the app at
// join time. These are the rules on their own — plain data in and out, nothing read from Firestore — used by
// lib/company-join-codes-server.ts when a code is made or linked to an invite, and again when someone joins with it.

// What everyone joins as when their code has no role (or its role has since been deleted) — as joining always has.
export const DEFAULT_JOIN_ROLE_ID = "staff";

// Same as lib/company-access-server.ts's normalizeRoleId (and the app's normalizeRoleKey).
export function normalizeJoinRoleId(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

// The ids of a company's roles (companies/{id}.roles — a role without an id goes by its name, as everywhere else).
export function companyRoleIdsOf(companyData: Record<string, unknown>): string[] {
  const roles = Array.isArray(companyData.roles) ? (companyData.roles as Array<Record<string, unknown>>) : [];
  const ids = roles.map((role) => normalizeJoinRoleId(role && typeof role === "object" ? role.id ?? role.name : "")).filter(Boolean);
  return Array.from(new Set(ids));
}

// Who's giving a code its role: an owner or admin, and whether they can change staff roles (owner, or
// staff.change.role — the same rule the Staff table's role pills follow).
export type JoinRoleSetter = { isOwnerOrAdmin: boolean; canChangeRoles: boolean };

// Whether `roleIdRaw` can go on a code, given by this person. None given is fine (they'll join as Staff). Never Owner;
// Admin only from an owner or admin; and anything but the default only from someone who can change staff roles.
export function checkJoinCodeRole(
  roleIdRaw: unknown,
  companyRoleIds: string[],
  setter: JoinRoleSetter,
): { ok: true; roleId: string } | { ok: false; error: string } {
  const roleId = normalizeJoinRoleId(roleIdRaw);
  if (!roleId) return { ok: true, roleId: "" };
  if (roleId === "owner") return { ok: false, error: "role-not-allowed" };
  if (roleId !== DEFAULT_JOIN_ROLE_ID && !companyRoleIds.includes(roleId)) return { ok: false, error: "no-such-role" };
  if (roleId === "admin" && !setter.isOwnerOrAdmin) return { ok: false, error: "role-not-allowed" };
  if (roleId !== DEFAULT_JOIN_ROLE_ID && !setter.canChangeRoles) return { ok: false, error: "role-not-allowed" };
  return { ok: true, roleId };
}

// The role someone joining with a code gets: the code's, checked again now — still one of the company's roles, and
// never Owner — or Staff.
export function joinRoleIdFor(storedRoleId: unknown, companyRoleIds: string[]): string {
  const roleId = normalizeJoinRoleId(storedRoleId);
  if (!roleId || roleId === "owner" || !companyRoleIds.includes(roleId)) return DEFAULT_JOIN_ROLE_ID;
  return roleId;
}
