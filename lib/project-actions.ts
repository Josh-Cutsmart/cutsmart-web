import type { Project, UserRole } from "@/lib/types";
import {
  addProjectChange,
  addUserNotification,
  resyncCompanyProjectTagUsage,
  updateProjectPatch,
  updateProjectStatus,
  updateProjectTags,
  type CompanyMemberOption,
} from "@/lib/firestore-data";
import { fetchBonusLock } from "@/lib/completed-projects";
import { projectTabAccess } from "@/lib/permissions";
import { isProjectArchived } from "@/lib/project-archive";

// What's done to a project from more than one place — the Dashboard (its status menu), the project page, and a project's
// right-click menu on the Dashboard's cards and the top bar's tabs (components/project-quick-actions-menu.tsx) — so each
// does it the same way.

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";

// ---- Statuses ----

// A company's project statuses (Company Settings › Project statuses): each one's colour and sub-statuses — the one marked
// Default is where a project lands as it's moved in. isComplete: the "Completed" toggle, left out while the company hasn't
// set it, so completedStatusMatcher falls back to the old name-based rule. With none set up, the four the app started with.
export type ProjectSubStatusRow = { name: string; color: string; isDefault?: boolean };
export type ProjectStatusRow = { name: string; color: string; subStages?: ProjectSubStatusRow[]; isComplete?: boolean };

function starterProjectStatusRows(): ProjectStatusRow[] {
  return [
    { name: "New", color: "#3060D0" },
    { name: "In Production", color: "#2A7A3B" },
    { name: "On Hold", color: "#C77700" },
    { name: "Complete", color: "#2A7A3B" },
  ];
}

export function projectStatusRowsFrom(raw: unknown): ProjectStatusRow[] {
  if (!Array.isArray(raw)) return starterProjectStatusRows();
  const rows = raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      const subStagesRaw = Array.isArray(row.subStages) ? row.subStages : [];
      const subStages: ProjectSubStatusRow[] = subStagesRaw
        .filter((sub) => sub && typeof sub === "object")
        .map((sub) => {
          const subRow = sub as Record<string, unknown>;
          return {
            name: String(subRow.name ?? "").trim(),
            color: String(subRow.color ?? "").trim() || "#64748B",
            isDefault: Boolean(subRow.isDefault),
          };
        })
        .filter((sub) => sub.name);
      return {
        name: String(row.name ?? "").trim(),
        color: String(row.color ?? "").trim() || "#64748B",
        subStages,
        ...(typeof row.isComplete === "boolean" ? { isComplete: row.isComplete } : {}),
      };
    })
    .filter((row) => row.name);
  return rows.length ? rows : starterProjectStatusRows();
}

// Where a project moved to a status lands: the sub-status picked for it, else that status's Default one, else none (a
// sub-board's "Other").
export function landingSubStage(rows: ProjectStatusRow[], status: string, chosenSubStage?: string): string {
  const row = rows.find((item) => item.name.trim().toLowerCase() === status.trim().toLowerCase());
  return chosenSubStage ?? row?.subStages?.find((sub) => sub.isDefault)?.name ?? "";
}

// How a moved project shows straight away, before the move is saved — what updateProjectStatus will store: its status,
// sub-status and completion date (kept while it moves between completed statuses, stamped as it enters one).
export function statusMoveLocalPatch(
  project: Project,
  status: string,
  subStageId: string,
  isCompletedStatus: (status: unknown) => boolean,
  nowIso: string,
): Partial<Project> {
  const completedAtIso = isCompletedStatus(status)
    ? (isCompletedStatus(project.statusLabel) && String(project.completedAtIso || "").trim()) || nowIso
    : "";
  return { statusLabel: status, dashboardSubStageId: subStageId, updatedAt: nowIso, completedAtIso: completedAtIso || undefined };
}

// Saves a move to another status (and sub-status), as the Dashboard's status menu does. Refused while the job's locked
// into a bonus period (updateProjectStatus checks) — onLocked then hears which period, to say why. A new status is noted
// in the project's changelog. extraPatch: saved in the same write (e.g. the board's drop position).
export async function moveProjectStatus(
  project: Project,
  status: string,
  subStageId: string,
  options: { actor: string; extraPatch?: Record<string, unknown>; onLocked?: (lockKey: string) => void },
): Promise<boolean> {
  const previousStatus = project.statusLabel;
  const changesStatus = status.trim().toLowerCase() !== String(previousStatus || "").trim().toLowerCase();
  const ok = await updateProjectStatus(project, status, subStageId, options.extraPatch);
  if (!ok) {
    // Locked since it was last looked at (someone sorted it meanwhile): said, while the caller puts it back.
    const onLocked = options.onLocked;
    if (changesStatus && project.companyId && onLocked) {
      void fetchBonusLock(project.companyId, project.id).then((lock) => {
        if (lock) onLocked(lock);
      });
    }
    return false;
  }
  if (previousStatus !== status) {
    void addProjectChange(project.id, options.actor, `Status changed: ${previousStatus || "(none)"} → ${status}`);
  }
  return true;
}

// ---- Assigning ----

// The fields a project's assignment is saved in, for the staff member picked ("" — no one).
export function projectAssignmentPatch(uid: string, members: Array<Pick<CompanyMemberOption, "uid" | "displayName">>): Partial<Project> {
  const nextUid = String(uid || "").trim();
  const member = members.find((row) => String(row.uid || "").trim() === nextUid) ?? null;
  return {
    assignedToUid: nextUid || "",
    assignedToName: member?.displayName || "",
    assignedTo: member?.displayName || "",
  };
}

// Tells the people a reassignment affects: whoever's now assigned it, and whoever was taken off it.
export function notifyProjectAssignment(project: Pick<Project, "id" | "name">, previousUid: string, nextUid: string): void {
  if (nextUid && nextUid !== previousUid) {
    void addUserNotification(nextUid, {
      title: "Assigned to a project",
      message: `You were assigned to "${project.name || "a project"}".`,
      type: "project_assigned",
      projectId: project.id,
    });
  }
  if (previousUid && previousUid !== nextUid) {
    void addUserNotification(previousUid, {
      title: "Removed from a project",
      message: `You were removed from "${project.name || "a project"}".`,
      type: "project_unassigned",
      projectId: project.id,
    });
  }
}

// Reassigns a project from outside its page, as the page's Assign does: saved, noted in its changelog the way the page
// notes it ("Assigned User: Sam → Alex"), and the two people told. What was saved, or null if it couldn't be.
export async function assignProject(
  project: Project,
  uid: string,
  members: Array<Pick<CompanyMemberOption, "uid" | "displayName">>,
  actor: string,
): Promise<Partial<Project> | null> {
  const nextUid = String(uid || "").trim();
  const previousUid = String(project.assignedToUid || "").trim();
  const patch = projectAssignmentPatch(nextUid, members);
  if (!(await updateProjectPatch(project, patch as Record<string, unknown>))) return null;
  const before = String(project.assignedToName ?? "").trim();
  const after = String(patch.assignedToName ?? "").trim();
  if (before !== after) void addProjectChange(project.id, actor, `Assigned User: ${before || "-"} → ${after || "-"}`);
  notifyProjectAssignment(project, previousUid, nextUid);
  return patch;
}

// ---- Tags ----

// The most a project can have.
export const PROJECT_TAG_LIMIT = 5;

// Its changelog's lines for its tags changing: one for each tag added, then each taken off.
export function projectTagChangeActions(before: string[], next: string[]): string[] {
  return [
    ...next.filter((tag) => !before.includes(tag)).map((tag) => `Tag added: ${tag}`),
    ...before.filter((tag) => !next.includes(tag)).map((tag) => `Tag removed: ${tag}`),
  ];
}

// Saves a project's tags from outside its page, as the page does: the project and the company's tag counts (what
// Edit Tags suggests — counted again in full once it's saved), and a changelog line for each tag added or taken off.
// onSaved: as soon as the tags themselves are saved, before that count.
export async function saveProjectTags(
  project: Project,
  nextTags: string[],
  previousTags: string[],
  actor: string,
  onSaved?: () => void,
): Promise<boolean> {
  if (!(await updateProjectTags(project, nextTags, previousTags))) return false;
  onSaved?.();
  for (const action of projectTagChangeActions(previousTags, nextTags)) void addProjectChange(project.id, actor, action);
  let companyId = String(project.companyId || "").trim();
  if (!companyId && typeof window !== "undefined") {
    try {
      companyId = String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim();
    } catch {
      // No stored company — nothing to count again.
    }
  }
  if (companyId) await resyncCompanyProjectTagUsage(companyId);
  return true;
}

// The tags the company's projects use (its projectTagUsage), the most used first — what Edit Tags suggests.
export function projectTagSuggestionsFrom(companyDoc: Record<string, unknown> | null | undefined): string[] {
  const usage = companyDoc?.projectTagUsage;
  const rows = usage && typeof usage === "object" && Array.isArray((usage as Record<string, unknown>).tags) ? ((usage as Record<string, unknown>).tags as unknown[]) : [];
  return rows
    .map((row) => {
      const item = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
      const count = Number(item.count ?? 0);
      return { value: String(item.value ?? "").trim(), count: Number.isFinite(count) ? count : 0 };
    })
    .filter((row) => row.value)
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .map((row) => row.value);
}

// ---- Who can do what ----

// What someone can do to a project from its right-click menu — by the same rules as the project page and the Dashboard's
// status menu. Open Design / Open Production: that tab is one they can see. Move, Edit Tags and Archive: edit access to the
// project (its General tab); Change Assigned: to its Settings too, as the page's Assign. Changes need a verified account,
// and an archived project can't be changed by anyone. A small job has none of a project's tabs, statuses or tags.
export type ProjectQuickActionsAccess = {
  design: boolean;
  production: boolean;
  move: boolean;
  assign: boolean;
  tags: boolean;
  archive: boolean;
};

export function projectQuickActionsAccess(
  project: Project,
  role: UserRole,
  uid: string | undefined,
  permissionKeys: string[],
  verified: boolean,
): ProjectQuickActionsAccess {
  const smallJob = Boolean(project.isSmallJob);
  const changeable = verified && !isProjectArchived(project);
  const general = projectTabAccess(project, role, "general", uid, permissionKeys);
  const settings = projectTabAccess(project, role, "settings", uid, permissionKeys);
  const canEdit = changeable && general.edit;
  return {
    design: !smallJob && projectTabAccess(project, role, "sales", uid, permissionKeys).view,
    production: !smallJob && projectTabAccess(project, role, "production", uid, permissionKeys).view,
    move: canEdit && !smallJob,
    assign: canEdit && settings.edit,
    tags: canEdit && !smallJob,
    archive: canEdit,
  };
}

// ---- Telling an open Dashboard ----

// A project changed from outside its own page — from its right-click menu (assigned, tagged, moved from the top bar, its
// archiving undone): what changed, for an open Dashboard to show it straight away.
export const PROJECT_PATCHED_EVENT = "cutsmart:project-patched";
export type ProjectPatchedDetail = { projectId: string; patch: Partial<Project> };

export function announceProjectPatched(projectId: string, patch: Partial<Project>): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ProjectPatchedDetail>(PROJECT_PATCHED_EVENT, { detail: { projectId, patch } }));
}
