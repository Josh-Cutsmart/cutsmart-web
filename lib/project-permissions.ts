import { notificationText } from "@/lib/notification-messages";
import { addUserNotification } from "@/lib/firestore-data";
import type { Project } from "@/lib/types";

// A project's Project Permissions: who's in which of its columns (No Access, View, Edit), and a move between them. Used by
// its Settings tab and by View Access on its right-click menu (components/project-permissions-board.tsx).

export type ProjectAccessValue = "no_access" | "view" | "edit";
export type ProjectPermissionRow = { uid: string; displayName: string; accessValue: ProjectAccessValue; isLocked: boolean };

function rawPermissionMap(project: Project | null | undefined): Record<string, unknown> {
  const settings = ((project?.projectSettings ?? {}) as Record<string, unknown>) || {};
  return (
    (settings.projectPermissionsByUid as Record<string, unknown> | undefined) ??
    (settings.userAccessByUid as Record<string, unknown> | undefined) ??
    (settings.memberAccessByUid as Record<string, unknown> | undefined) ??
    {}
  );
}

// Everyone, and which column they're in. Whoever made it, whoever it's assigned to, and owners and admins always can edit
// it: locked there.
export function projectPermissionRows(
  project: Project | null | undefined,
  members: Array<{ uid: string; displayName: string; role?: string }>,
): ProjectPermissionRow[] {
  const direct = new Map<string, "view" | "edit">();
  for (const [rawUid, rawPermission] of Object.entries(rawPermissionMap(project))) {
    const uid = String(rawUid || "").trim();
    const permission = String(rawPermission || "").trim().toLowerCase();
    if (uid && (permission === "view" || permission === "edit")) direct.set(uid, permission);
  }
  const creatorUid = String(project?.createdByUid ?? "").trim();
  const assignedUid = String(project?.assignedToUid ?? "").trim();
  const seen = new Set<string>();
  return members
    .filter((member) => {
      const uid = String(member.uid || "").trim();
      if (!uid || seen.has(uid)) return false;
      seen.add(uid);
      return true;
    })
    .map((member) => {
      const uid = String(member.uid || "").trim();
      const role = String(member.role || "").trim().toLowerCase();
      const isLocked = uid === creatorUid || uid === assignedUid || role === "owner" || role === "admin";
      return { uid, displayName: member.displayName, accessValue: isLocked ? "edit" : direct.get(uid) ?? "no_access", isLocked };
    });
}

// Its settings with someone moved to a column, and what that changes.
export function projectSettingsWithPermission(project: Project, uid: string, access: string) {
  const current = ((project.projectSettings ?? {}) as Record<string, unknown>) || {};
  const raw = rawPermissionMap(project);
  const normalized = String(access || "").trim().toLowerCase();
  const nextAccess = normalized === "edit" ? "edit" : normalized === "view" ? "view" : "";
  const nextMap: Record<string, string> = {};
  for (const [rawUid, rawPermission] of Object.entries(raw)) {
    const cleanUid = String(rawUid || "").trim();
    const permission = String(rawPermission || "").trim().toLowerCase();
    if (cleanUid && (permission === "view" || permission === "edit")) nextMap[cleanUid] = permission;
  }
  if (nextAccess) nextMap[uid] = nextAccess;
  else delete nextMap[uid];
  const settings: Record<string, unknown> = { ...current, projectPermissionsByUid: nextMap };
  delete settings.userAccessByUid;
  delete settings.memberAccessByUid;
  return { settings, oldAccess: String(raw[uid] || "").trim().toLowerCase(), nextAccess };
}

const accessLabel = (value: string) => (value === "edit" ? "Edit" : value === "view" ? "View" : "No Access");

// What the project's changelog says.
export const projectPermissionChangeText = (name: string, oldAccess: string, nextAccess: string) =>
  `Permissions — ${name || "Staff"}: ${accessLabel(oldAccess)} → ${accessLabel(nextAccess)}`;

// Given access (or it changed between viewer and editor): let them know — not when it's taken away, or it's themselves.
export function notifyProjectPermissionChange(project: Project, uid: string, oldAccess: string, nextAccess: string, actorUid?: string, actorName?: string) {
  if (!nextAccess || nextAccess === oldAccess || uid === actorUid) return;
  const role = nextAccess === "edit" ? "an editor" : "a viewer";
  const actor = actorName || "A teammate";
  const name = project.name || "a project";
  void addUserNotification(uid, {
    ...notificationText(oldAccess ? "project_access.changed" : "project_access.added", { person: actor, project: name, role }),
    type: "project_access",
    projectId: project.id,
    companyId: project.companyId,
  });
}
