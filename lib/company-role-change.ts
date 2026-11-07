import { DEFAULT_JOIN_ROLE_ID, normalizeJoinRoleId } from "@/lib/company-join-code-role";

// Who can change whose role (Company Settings > Staff), checked on the server (app/api/company/member-role) — firestore.rules doesn't
// let the app change roles itself. The rules on their own, plain data in and out, nothing read from Firestore.
//
// An owner can change anyone's, their own included, which is how ownership is handed over: the new owner is made one first, then the
// old one changes their own. Never so that the company is left with no owner. Otherwise it takes staff.change.role, and then: never your
// own, never to or from Owner, and to or from Admin only from an admin (the same as an access code's role, lib/company-join-code-role.ts).

export type MemberRoleChange = {
  caller: { uid: string; roleId: string; canChangeRoles: boolean };
  targetUid: string;
  targetRoleId: string;
  nextRoleIdRaw: unknown;
  companyRoleIds: string[];
  // How many people in the company are owners now.
  ownerCount: number;
};

export function checkMemberRoleChange(change: MemberRoleChange): { ok: true; roleId: string; changed: boolean } | { ok: false; error: string } {
  const { caller, targetUid, companyRoleIds, ownerCount } = change;
  const callerRole = normalizeJoinRoleId(caller.roleId);
  const targetRole = normalizeJoinRoleId(change.targetRoleId);
  const roleId = normalizeJoinRoleId(change.nextRoleIdRaw);
  if (!roleId) return { ok: false, error: "role-empty" };
  if (roleId !== "owner" && roleId !== DEFAULT_JOIN_ROLE_ID && !companyRoleIds.includes(roleId)) return { ok: false, error: "no-such-role" };

  if (callerRole === "owner") {
    if (targetRole === "owner" && roleId !== "owner" && ownerCount <= 1) return { ok: false, error: "last-owner" };
    return { ok: true, roleId, changed: roleId !== targetRole };
  }

  if (!caller.canChangeRoles) return { ok: false, error: "forbidden" };
  if (targetUid === caller.uid) return { ok: false, error: "own-role" };
  if (roleId === "owner" || targetRole === "owner") return { ok: false, error: "role-not-allowed" };
  if ((roleId === "admin" || targetRole === "admin") && callerRole !== "admin") return { ok: false, error: "role-not-allowed" };
  return { ok: true, roleId, changed: roleId !== targetRole };
}
