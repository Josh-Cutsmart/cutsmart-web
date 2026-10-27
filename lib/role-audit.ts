// Company Settings › Staff & Permissions › Audit log: who changed roles and permissions, and when — a staff member's role
// changed; a role added, renamed or removed; permissions given to or taken from a role. Kept on the company document
// (ROLE_AUDIT_FIELD — newest first, the latest ROLE_AUDIT_MAX), so it needs nothing more of the database's rules.

import { db } from "@/lib/firebase";
import { doc, getDoc, updateDoc } from "@/lib/firestore-client";
import type { RoleRow } from "@/lib/company-roles";

export const ROLE_AUDIT_FIELD = "roleAuditLog";
const ROLE_AUDIT_MAX = 300;

export type RoleAuditEntry = {
  id: string;
  atIso: string;
  byUid: string;
  byName: string;
  // What happened, in words: "changed Liam Chen's role from Staff to Admin".
  text: string;
};

const str = (value: unknown) => String(value ?? "").trim();

export function normalizeRoleAuditLog(raw: unknown): RoleAuditEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => ({ id: str(row.id), atIso: str(row.atIso), byUid: str(row.byUid), byName: str(row.byName), text: str(row.text) }))
    .filter((row) => row.id && row.text && Number.isFinite(Date.parse(row.atIso)))
    .sort((a, b) => Date.parse(b.atIso) - Date.parse(a.atIso));
}

export function newRoleAuditEntry(text: string, by: { uid: string; name: string }): RoleAuditEntry {
  return {
    id: `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    atIso: new Date().toISOString(),
    byUid: by.uid,
    byName: by.name || "Someone",
    text,
  };
}

const roleKey = (role: RoleRow) => str(role.id || role.name).toLowerCase();
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

// What changed between two versions of the roles, in words — one line per role changed.
export function describeRoleChanges(before: RoleRow[], after: RoleRow[], permissionName: (key: string) => string): string[] {
  const lines: string[] = [];
  const beforeById = new Map(before.map((role) => [roleKey(role), role]));
  const afterById = new Map(after.map((role) => [roleKey(role), role]));
  for (const role of after) {
    const old = beforeById.get(roleKey(role));
    if (!old) {
      lines.push(`added the role ${role.name || "Untitled"}`);
      continue;
    }
    if (str(old.name) !== str(role.name)) lines.push(`renamed the role ${old.name} to ${role.name}`);
    const oldPerms = new Set(old.permissions.map(str).filter(Boolean));
    const newPerms = new Set(role.permissions.map(str).filter(Boolean));
    const given = [...newPerms].filter((key) => !oldPerms.has(key)).map(permissionName);
    const taken = [...oldPerms].filter((key) => !newPerms.has(key)).map(permissionName);
    if (given.length || taken.length) {
      const parts = [given.length ? `gave it ${list(given)}` : "", taken.length ? `took away ${list(taken)}` : ""].filter(Boolean);
      lines.push(`changed ${role.name}'s permissions — ${parts.join("; ")}`);
    }
  }
  for (const role of before) {
    if (!afterById.has(roleKey(role))) lines.push(`removed the role ${role.name || "Untitled"}`);
  }
  return lines;
}

// Entries added to the company's log (read fresh, so another's just added aren't lost — newest first, the latest kept).
// The log as it is now.
export async function appendRoleAudit(companyId: string, entries: RoleAuditEntry[]): Promise<RoleAuditEntry[] | null> {
  const cid = str(companyId);
  if (!db || !cid || !entries.length) return null;
  try {
    const ref = doc(db, "companies", cid);
    const snap = await getDoc(ref);
    const current = normalizeRoleAuditLog(snap.exists() ? (snap.data() as Record<string, unknown>)[ROLE_AUDIT_FIELD] : []);
    const next = [...entries, ...current.filter((row) => !entries.some((entry) => entry.id === row.id))]
      .sort((a, b) => Date.parse(b.atIso) - Date.parse(a.atIso))
      .slice(0, ROLE_AUDIT_MAX);
    await updateDoc(ref, { [ROLE_AUDIT_FIELD]: next });
    return next;
  } catch {
    return null;
  }
}
