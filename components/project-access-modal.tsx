"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Eye, ShieldCheck } from "lucide-react";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { ProductionUnlockCountdown } from "@/components/production-unlock-countdown";
import { ProjectPermissionsBoard, type ProjectPermissionsPalette } from "@/components/project-permissions-board";
import { SkeletonRows } from "@/components/skeleton";
import { useAuth } from "@/lib/auth-context";
import { addProjectChange, fetchCompanyMembers, fetchProjectById, fetchUserColorMapByUids, updateProjectPatch, type CompanyMemberOption } from "@/lib/firestore-data";
import { announceProjectPatched } from "@/lib/project-actions";
import { notifyProjectPermissionChange, projectPermissionChangeText, projectPermissionRows, projectSettingsWithPermission, type ProjectAccessValue } from "@/lib/project-permissions";
import type { Project } from "@/lib/types";

// View Access, off a project's right-click menu: just its Project Permissions, in a pop-up — without opening the project.
// The same columns as on its Settings tab, draggable for someone who can change them there. (Read fresh as it opens: a list
// of projects can be behind, and a save writes all of the project's settings.)

const PALETTE: ProjectPermissionsPalette = {
  border: "var(--panel-border)",
  inputBg: "var(--panel-bg)",
  inputText: "var(--text-main)",
  panelBg: "var(--panel-bg)",
  panelMuted: "var(--panel-muted)",
  textMuted: "var(--text-muted)",
  textSoft: "var(--text-main)",
};

const PHONE_QUERY = "(max-width: 767px)";
const subscribeToPhone = (changed: () => void) => {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
};

export function ProjectAccessModal({
  project: given,
  canEdit,
  panelRef,
  onClose,
}: {
  project: Project;
  canEdit: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const isPhone = useSyncExternalStore(subscribeToPhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
  const [project, setProject] = useState(given);
  const [members, setMembers] = useState<CompanyMemberOption[] | null>(null);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [savingUid, setSavingUid] = useState("");
  const [error, setError] = useState("");
  const uid = String(user?.uid || "").trim();
  const projectId = given.id;
  const companyId = String(given.companyId || "").trim();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [fresh, list] = await Promise.all([
        fetchProjectById(projectId, uid, companyId ? [companyId] : []).catch(() => null),
        companyId ? fetchCompanyMembers(companyId).catch(() => [] as CompanyMemberOption[]) : Promise.resolve([] as CompanyMemberOption[]),
      ]);
      const colorMap = list.length ? await fetchUserColorMapByUids(list.map((member) => member.uid), companyId).catch(() => ({}) as Record<string, string>) : {};
      if (cancelled) return;
      if (fresh) setProject(fresh);
      setMembers(list);
      setColors(colorMap);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, uid, companyId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const rows = useMemo(
    () => projectPermissionRows(project, (members ?? []).map((member) => ({ uid: member.uid, displayName: member.displayName, role: member.roleId || member.role }))),
    [members, project],
  );

  const change = async (targetUid: string, access: ProjectAccessValue) => {
    if (!canEdit || savingUid) return;
    const { settings, oldAccess, nextAccess } = projectSettingsWithPermission(project, targetUid, access);
    setSavingUid(targetUid);
    setError("");
    const ok = await updateProjectPatch(project, { projectSettings: settings });
    setSavingUid("");
    if (!ok) {
      setError("Couldn't save that — check your connection and try again.");
      return;
    }
    setProject((prev) => ({ ...prev, projectSettings: settings }) as Project);
    // (An open Dashboard, or this project's own page, keeps up.)
    announceProjectPatched(project.id, { projectSettings: settings } as Partial<Project>);
    const target = (members ?? []).find((member) => member.uid === targetUid);
    void addProjectChange(project.id, String(user?.displayName || user?.email || "Staff").trim() || "Staff", projectPermissionChangeText(target?.displayName ?? "", oldAccess, nextAccess));
    notifyProjectPermissionChange(project, targetUid, oldAccess, nextAccess, uid, String(user?.displayName || ""));
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[2147483646] flex items-center justify-center p-0 sm:p-4">
      <button type="button" aria-label="Close project permissions" onClick={onClose} className="glass-modal-backdrop absolute inset-0" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Project Permissions — ${given.name || "Project"}`}
        data-phone-fullscreen="true"
        className="glass-modal-panel relative z-[2147483647] flex h-full w-full flex-col overflow-hidden max-sm:rounded-none! max-sm:border-0! sm:h-auto sm:max-h-[92vh] sm:w-[min(1000px,94vw)]"
      >
        <GlassModalHeader title="Project Permissions" icon={<ShieldCheck />} onClose={onClose} className="max-sm:h-[calc(56px+env(safe-area-inset-top))] max-sm:pt-[env(safe-area-inset-top)]">
          {!canEdit ? (
            <span className="inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
              <Eye size={13} />
              View only
            </span>
          ) : null}
        </GlassModalHeader>
        <div className="glass-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 truncate text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
            {given.name || "Project"}
          </p>
          <div className="rounded-[18px] border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),var(--shadow-glass)]">
            {members === null ? (
              <div className="p-4">
                <SkeletonRows count={5} label="Loading staff" />
              </div>
            ) : (
              <ProjectPermissionsBoard
                rows={rows}
                canEdit={canEdit}
                savingUid={savingUid}
                onChange={(targetUid, access) => void change(targetUid, access)}
                colorOf={(rowUid) => {
                  const member = members.find((entry) => entry.uid === rowUid);
                  return colors[rowUid] || member?.badgeColor || member?.userColor || "#7D99B3";
                }}
                palette={PALETTE}
                isPhone={isPhone}
                rowExtras={(row) => (
                  <ProductionUnlockCountdown project={project} uid={row.uid}>
                    {(label) => (
                      <span className="shrink-0 rounded-full border px-2 py-[2px] text-[10px] font-bold uppercase tracking-[0.6px]" style={{ borderColor: PALETTE.border, backgroundColor: PALETTE.panelMuted, color: PALETTE.textSoft }}>
                        {label}
                      </span>
                    )}
                  </ProductionUnlockCountdown>
                )}
              />
            )}
          </div>
          {error ? (
            <p className="mt-2 text-[12px] font-medium" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
