import type { Project, UserRole } from "@/lib/types";

const featurePermissionMatrix: Record<string, string[]> = {
  dashboard: [],
  sales: ["sales.view", "sales.edit"],
  initialCutlist: ["sales.view", "sales.edit", "production.view", "production.edit", "production.key"],
  productionCutlist: ["production.view", "production.edit", "production.key"],
  projectSettings: ["company.settings"],
};

function hasPermission(permissionKeys: string[] | undefined, key: string): boolean {
  const target = String(key || "").trim().toLowerCase();
  if (!target) {
    return false;
  }
  return (permissionKeys ?? []).some((item) => {
    const normalized = String(item || "").trim().toLowerCase();
    return normalized === "company.*" || normalized === target;
  });
}

type TabKey = "general" | "sales" | "production" | "settings";

function normalizeRole(value: unknown): UserRole | null {
  const role = String(value ?? "").trim().toLowerCase();
  return role || null;
}

function isPrivilegedCompanyRole(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}

function projectPermissionLevel(project: Project | null, uid?: string): "edit" | "view" | "" {
  const userId = String(uid ?? "").trim();
  if (!project || !userId) {
    return "";
  }
  const settings = (project.projectSettings ?? {}) as Record<string, unknown>;
  const candidateMaps = [
    settings.projectPermissionsByUid,
    settings.userAccessByUid,
    settings.memberAccessByUid,
  ];
  for (const rawMap of candidateMaps) {
    if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
      continue;
    }
    const rawValue = (rawMap as Record<string, unknown>)[userId];
    const normalized = String(rawValue ?? "").trim().toLowerCase();
    if (normalized === "edit") {
      return "edit";
    }
    if (normalized === "view") {
      return "view";
    }
  }
  return "";
}

export function canAccess(feature: keyof typeof featurePermissionMatrix, role: UserRole, permissionKeys?: string[]) {
  if (feature === "dashboard") {
    return true;
  }
  if (isPrivilegedCompanyRole(role)) {
    return true;
  }
  return featurePermissionMatrix[feature].some((permissionKey) => hasPermission(permissionKeys, permissionKey));
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

export function projectTabAccess(
  project: Project | null,
  role: UserRole,
  tab: TabKey,
  uid?: string,
  permissionKeys?: string[],
) {
  const userId = String(uid ?? "").trim();
  const creatorUid = String(project?.createdByUid ?? "").trim();
  const assignedToUid = String(project?.assignedToUid ?? "").trim();
  const isProjectCreator = Boolean(userId && creatorUid && userId === creatorUid);
  const isAssignedProjectManager = Boolean(userId && assignedToUid && userId === assignedToUid);
  const privileged = isPrivilegedCompanyRole(role);
  const directProjectPermission = projectPermissionLevel(project, uid);
  const hasProjectViewAccess = directProjectPermission === "view" || directProjectPermission === "edit";
  const hasProjectEditAccess = directProjectPermission === "edit";
  const hasCompanyWideEditAccess = hasPermission(permissionKeys, "projects.edit.others");
  const baseProjectVisibility =
    privileged || hasCompanyWideEditAccess || isProjectCreator || isAssignedProjectManager || hasProjectViewAccess;

  if (tab === "general") {
    const canEdit =
      privileged ||
      hasCompanyWideEditAccess ||
      isProjectCreator ||
      isAssignedProjectManager ||
      hasProjectEditAccess;
    return { view: baseProjectVisibility, edit: canEdit };
  }

  if (tab === "settings") {
    const canEdit =
      privileged ||
      hasCompanyWideEditAccess ||
      isProjectCreator ||
      isAssignedProjectManager ||
      hasProjectEditAccess ||
      hasPermission(permissionKeys, "company.settings");
    return { view: baseProjectVisibility, edit: canEdit };
  }

  let canView = privileged;
  let canEdit = false;

  if (tab === "sales") {
    canView =
      canView ||
      (baseProjectVisibility && (hasPermission(permissionKeys, "sales.view") || hasPermission(permissionKeys, "sales.edit")));
    canEdit =
      canEdit ||
      (baseProjectVisibility && hasPermission(permissionKeys, "sales.edit")) ||
      privileged ||
      hasCompanyWideEditAccess ||
      isProjectCreator ||
      isAssignedProjectManager ||
      hasProjectEditAccess;
  }

  if (tab === "production") {
    const hasProdPerm =
      hasPermission(permissionKeys, "production.key") ||
      hasPermission(permissionKeys, "production.view") ||
      hasPermission(permissionKeys, "production.edit");
    canView = canView || baseProjectVisibility || (baseProjectVisibility && hasProdPerm);
    canEdit =
      canEdit ||
      hasPermission(permissionKeys, "production.edit");
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

  if (tab !== "production" && (isProjectCreator || isAssignedProjectManager || privileged || hasCompanyWideEditAccess || hasProjectEditAccess)) {
    canView = true;
    canEdit = true;
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
