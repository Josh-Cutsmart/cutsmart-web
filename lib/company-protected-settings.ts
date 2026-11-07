import { normalizeJoinRoleId } from "@/lib/company-join-code-role";

// The parts of Company Settings' save that decide who can do what or hold a secret: what each role can do, and the integrations (the
// Zapier webhook's secret). firestore.rules doesn't let the app change them itself, so saving them goes through the server, which
// checks the permission (app/api/company/protected-settings). The rules on their own, nothing read from Firestore, so the app can use
// them too.
//
// Company Settings sends these with every save, changed or not, and it saves itself as you go. So what matters is whether they've
// changed: unchanged, there's nothing to check or write.

export const PROTECTED_COMPANY_SETTINGS = ["roles", "integrations"] as const;

const MAX_ROLES = 100;
const MAX_INTEGRATIONS_LENGTH = 200_000;

// Takes the protected settings out of a patch to the company's record: what goes to the server, and what's left to write as usual.
export function splitProtectedCompanyPatch(patch: Record<string, unknown>): { protectedPatch: Record<string, unknown>; rest: Record<string, unknown> } {
  const protectedPatch: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if ((PROTECTED_COMPANY_SETTINGS as readonly string[]).includes(key)) protectedPatch[key] = value;
    else rest[key] = value;
  }
  return { protectedPatch, rest };
}

// The same value always writes out the same, whatever order its keys are in.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export type RoleDefinition = { id: string; name: string; color: string; permissions: Record<string, boolean> };

// A role as it's stored: a permission is on or it isn't, however it came in (a map, or an older list of keys).
function roleDefinitionFrom(raw: unknown): RoleDefinition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = normalizeJoinRoleId(row.id ?? row.name);
  const name = String(row.name ?? "").trim().slice(0, 80);
  if (!id || !name) return null;
  const permissions: Record<string, boolean> = {};
  if (Array.isArray(row.permissions)) {
    for (const key of row.permissions) if (String(key ?? "").trim()) permissions[String(key).trim()] = true;
  } else if (row.permissions && typeof row.permissions === "object") {
    for (const [key, on] of Object.entries(row.permissions as Record<string, unknown>)) if (on === true && key.trim()) permissions[key.trim()] = true;
  }
  return { id, name, color: String(row.color ?? "").trim().slice(0, 32), permissions };
}

function roleListFrom(raw: unknown): RoleDefinition[] {
  const seen = new Set<string>();
  const out: RoleDefinition[] = [];
  for (const row of Array.isArray(raw) ? raw : []) {
    const role = roleDefinitionFrom(row);
    if (!role || seen.has(role.id)) continue;
    seen.add(role.id);
    out.push(role);
  }
  return out;
}

// The company's roles as they'd be after this save, and whether that's any different. The Owner role is always kept, and only an owner
// can change what it can do.
export function rolesAfterSave(
  incomingRaw: unknown,
  storedRaw: unknown,
  callerIsOwner: boolean,
): { ok: true; roles: RoleDefinition[]; changed: boolean } | { ok: false; error: string } {
  if (!Array.isArray(incomingRaw) || incomingRaw.length > MAX_ROLES) return { ok: false, error: "invalid-roles" };
  const stored = roleListFrom(storedRaw);
  const storedOwner = stored.find((role) => role.id === "owner");
  let roles = roleListFrom(incomingRaw);
  if (!roles.length) return { ok: false, error: "invalid-roles" };
  if (storedOwner) {
    const at = roles.findIndex((role) => role.id === "owner");
    if (at < 0) roles = [storedOwner, ...roles];
    else if (!callerIsOwner) roles = roles.map((role, index) => (index === at ? storedOwner : role));
  }
  return { ok: true, roles, changed: canonicalJson(roles) !== canonicalJson(stored) };
}

// The integrations as they'd be after this save, and whether that's any different.
export function integrationsAfterSave(
  incomingRaw: unknown,
  storedRaw: unknown,
): { ok: true; integrations: Record<string, unknown>; changed: boolean } | { ok: false; error: string } {
  if (!incomingRaw || typeof incomingRaw !== "object" || Array.isArray(incomingRaw)) return { ok: false, error: "invalid-integrations" };
  if (JSON.stringify(incomingRaw).length > MAX_INTEGRATIONS_LENGTH) return { ok: false, error: "invalid-integrations" };
  return {
    ok: true,
    integrations: incomingRaw as Record<string, unknown>,
    changed: canonicalJson(incomingRaw) !== canonicalJson(storedRaw ?? {}),
  };
}
