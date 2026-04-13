import type { Project, UserRole } from "@/lib/types";

const editMatrix: Record<string, UserRole[]> = {
  dashboard: ["owner", "admin", "sales", "production", "viewer"],
  sales: ["owner", "admin", "sales"],
  initialCutlist: ["owner", "admin", "sales", "production"],
  productionCutlist: ["owner", "admin", "production"],
  projectSettings: ["owner", "admin"],
};

export function canAccess(feature: keyof typeof editMatrix, role: UserRole) {
  return editMatrix[feature].includes(role);
}

type TabKey = "general" | "sales" | "production" | "settings";

function normalizeRole(value: unknown): UserRole | null {
  const role = String(value ?? "").trim().toLowerCase();
  if (role === "owner" || role === "admin" || role === "sales" || role === "production" || role === "viewer") {
    return role;
  }
  return null;
}

function roleInList(role: UserRole, list: unknown): boolean | null {
  if (!Array.isArray(list)) {
    return null;
  }
  const normalized = list
    .map((item) => normalizeRole(item))
    .filter(Boolean) as UserRole[];
  if (!normalized.length) {
    return null;
  }
  return normalized.includes(role);
}

function hasPermission(permissionKeys: string[] | undefined, key: string): boolean {
  const target = String(key || "").trim().toLowerCase();
  if (!target) {
    return false;
  }
  return (permissionKeys ?? []).some((item) => String(item || "").trim().toLowerCase() === target);
}

export function projectTabAccess(
  project: Project | null,
  role: UserRole,
  tab: TabKey,
  uid?: string,
  permissionKeys?: string[],
) {
  if (tab === "general") {
    const canEdit = role !== "viewer" || hasPermission(permissionKeys, "projects.edit");
    return { view: true, edit: canEdit };
  }

  if (tab === "settings") {
    const canEdit = role === "owner" || role === "admin" || hasPermission(permissionKeys, "company.settings");
    return { view: true, edit: canEdit };
  }

  const defaults: Record<"sales" | "production", { view: UserRole[]; edit: UserRole[] }> = {
    sales: {
      view: ["owner", "admin", "sales"],
      edit: ["owner", "admin", "sales"],
    },
    production: {
      view: ["owner", "admin", "production"],
      edit: ["owner", "admin", "production"],
    },
  };

  let canView = defaults[tab].view.includes(role);
  let canEdit = defaults[tab].edit.includes(role);

  if (tab === "sales") {
    canView = canView || hasPermission(permissionKeys, "sales.view") || hasPermission(permissionKeys, "sales.edit");
    canEdit = canEdit || hasPermission(permissionKeys, "sales.edit");
  }

  if (tab === "production") {
    const hasProdPerm =
      hasPermission(permissionKeys, "production.key") ||
      hasPermission(permissionKeys, "production.view") ||
      hasPermission(permissionKeys, "production.edit");
    canView = canView || hasProdPerm;
    canEdit = canEdit || hasPermission(permissionKeys, "production.edit") || hasPermission(permissionKeys, "production.key");
  }

  const settings = (project?.projectSettings ?? {}) as Record<string, unknown>;
  const tabPermissions =
    (settings.tabPermissions as Record<string, unknown> | undefined) ??
    ((settings.permissions as Record<string, unknown> | undefined)?.tabs as Record<string, unknown> | undefined) ??
    {};
  const tabConfig = (tabPermissions[tab] as Record<string, unknown> | undefined) ?? {};

  const viewOverride = roleInList(role, tabConfig.viewRoles);
  const editOverride = roleInList(role, tabConfig.editRoles);

  if (viewOverride !== null) {
    canView = viewOverride;
  }
  if (editOverride !== null) {
    canEdit = editOverride;
  }

  if (tab === "production") {
    const remaining = getProductionUnlockRemainingSeconds(project, uid);
    if (!canView && remaining > 0) {
      canView = true;
      canEdit = true;
    }
  }

  return { view: canView, edit: canEdit };
}

function toFutureSeconds(iso: string): number {
  const t = new Date(String(iso || "")).getTime();
  if (!Number.isFinite(t)) {
    return 0;
  }
  return Math.floor((t - Date.now()) / 1000);
}

export function getProductionUnlockRemainingSeconds(project: Project | null, uid?: string): number {
  const userId = String(uid ?? "").trim();
  if (!project || !userId) {
    return 0;
  }
  const settings = (project.projectSettings ?? {}) as Record<string, unknown>;
  const rawMap =
    ((settings.productionTempEdit as Record<string, unknown> | undefined) ??
      (settings.tempProductionAccess as Record<string, unknown> | undefined) ??
      {}) as Record<string, unknown>;

  const expiryIso = String(rawMap[userId] ?? "").trim();
  return Math.max(0, toFutureSeconds(expiryIso));
}
