// Shared with app/(app)/company-settings/page.tsx (where roles are authored) and
// app/(app)/projects/[projectId]/page.tsx (where a group's editableByRoleIds is enforced against
// the current viewer's own role) — both need the EXACT same id-generation logic, since a role
// without a stored `id` falls back to one derived from its name, and a mismatch between the two
// pages' own copies of that fallback would silently break enforcement (a group restricted to a role
// picked in the builder would never match the id computed for that same role in the project page).

export type RoleRow = { id: string; name: string; color: string; permissions: string[] };

function toStr(v: unknown, fallback = ""): string {
  const t = String(v ?? "").trim();
  return t || fallback;
}

export function normalizeRoleKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

export function normalizeRoles(raw: unknown): RoleRow[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out = raw
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => {
      const row = item as Record<string, unknown>;
      const permissionsArray = Array.isArray(row.permissions)
        ? row.permissions.map((value) => toStr(value)).filter(Boolean)
        : [];
      const permissionsObj = row.permissions && typeof row.permissions === "object" && !Array.isArray(row.permissions)
        ? (row.permissions as Record<string, unknown>)
        : {};
      const permissions = permissionsArray.length
        ? permissionsArray
        : Object.entries(permissionsObj).filter(([, v]) => Boolean(v)).map(([k]) => String(k));
      const normalizedPermissions = Array.from(
        new Set(
          permissions.flatMap((permission) => {
            const clean = toStr(permission);
            if (!clean) return [];
            if (clean === "leads.*") {
              return ["leads.view", "leads.view.others"];
            }
            if (clean === "company.clients") {
              return ["clients.view", "clients.view.all"];
            }
            if (clean === "projects.create.others") {
              return [clean, "projects.create.other", "projects.assign.other"];
            }
            return [clean];
          }),
        ),
      );
      return {
        id: toStr(row.id, normalizeRoleKey(row.name) || `role_${idx + 1}`),
        name: toStr(row.name, `Role ${idx + 1}`),
        color: toStr(row.color, "#7D99B3"),
        permissions: normalizedPermissions,
      };
    });
  return out;
}
