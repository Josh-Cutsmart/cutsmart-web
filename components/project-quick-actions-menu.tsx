"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Archive, ArrowRightLeft, Check, ChevronLeft, ChevronRight, ExternalLink, Factory, Lock, PencilRuler, Plus, Tag, UserCheck, X } from "lucide-react";
import { GLASS_MENU_CLASS, GLASS_MENU_ROW_CLASS, GLASS_MENU_STYLE } from "@/components/glass-dropdown";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { Skeleton, SkeletonGroup } from "@/components/skeleton";
import { StatusMenuPanels, type StatusMenuStatus } from "@/components/status-menu-panels";
import { useFloatingNotice } from "@/components/floating-notice";
import { useUndo } from "@/components/undo-bar";
import { useAppTabs } from "@/lib/app-tabs-context";
import { useAuth } from "@/lib/auth-context";
import { bonusLockMessage } from "@/lib/completed-projects";
import { completionBonusSettingsFrom } from "@/lib/completion-bonus";
import { archiveProject, fetchCompanyDoc, fetchCompanyMembers, fetchProjectById, fetchUserColorMapByUids, unarchiveProject } from "@/lib/firestore-data";
import { glassShineStyle } from "@/lib/glass-shine";
import {
  announceProjectPatched,
  assignProject,
  landingSubStage,
  moveProjectStatus,
  PROJECT_PATCHED_EVENT,
  PROJECT_TAG_LIMIT,
  projectAssignmentPatch,
  projectQuickActionsAccess,
  projectStatusRowsFrom,
  projectTagSuggestionsFrom,
  saveProjectTags,
  statusMoveLocalPatch,
  type ProjectPatchedDetail,
  type ProjectQuickActionsAccess,
} from "@/lib/project-actions";
import { completedStatusMatcher } from "@/lib/project-archive";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";
import { useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { hasPermissionKey, isOwnerOrAdmin, useCompanyAccess } from "@/lib/use-company-access";
import type { Project } from "@/lib/types";

// A project's quick actions: right-click one of the Dashboard's cards (or list rows), or a project's tab in the top bar, and
// a glass menu opens at the pointer — Open, Open Design, Open Production, then Move ›, Change Assigned › and Edit Tags ›
// (each slides the menu over to its own panel, a back row at its top, as a status menu's sub-statuses do), then Archive.
// Each is done as the Dashboard or the project page does it (lib/project-actions.ts), and only offered to someone who can.

// Which project elements a menu answers ("dashboard": a Dashboard card or row; "tabs": a project's tab in the top bar),
// so the Dashboard's menu and the top bar's never both open.
export type ProjectQuickActionsScope = "dashboard" | "tabs";

export function projectQuickActionsAttrs(scope: ProjectQuickActionsScope, projectId: string) {
  return { "data-project-actions": scope, "data-project-actions-id": projectId };
}

// One right-click: the project, the pointer, and what was right-clicked (the Dashboard's Open flies the card up from it).
// `key`: new for every right-click, so right-clicking another card starts the menu afresh.
// `alignEnd`: its right edge at x, not its left (opened from a card's ⋯, at the card's right).
export type ProjectQuickActionsRequest = { key: number; projectId: string; x: number; y: number; source: HTMLElement; alignEnd?: boolean };

let nextRequestKey = 0;

// Right-clicking an element marked with projectQuickActionsAttrs: its project's menu, instead of the browser's (a text box
// keeps its own). A mouse's right-click only, or the keyboard's menu key — a long press on a touch screen is left as it
// was. Heard before anything else on the page, so the Dashboard column a card sits in doesn't open its own right-click
// menu as well (components/column-automations.tsx).
export function useProjectQuickActionsRequest(scope: ProjectQuickActionsScope) {
  const [request, setRequest] = useState<ProjectQuickActionsRequest | null>(null);
  useEffect(() => {
    let lastPointerType = "";
    const onPointerDown = (event: PointerEvent) => {
      lastPointerType = event.pointerType;
    };
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const element = target?.closest<HTMLElement>(`[data-project-actions="${scope}"]`);
      const projectId = String(element?.dataset.projectActionsId ?? "").trim();
      if (!element || !projectId || target?.closest("input, textarea, [contenteditable='true']")) return;
      // (A pointer event in most browsers; otherwise, the press it came from.)
      const pointerType = (event as Partial<PointerEvent>).pointerType || lastPointerType;
      if (pointerType === "touch") return;
      event.preventDefault();
      event.stopPropagation();
      // The keyboard's menu key has no pointer: under the element.
      const rect = element.getBoundingClientRect();
      const fromKeyboard = event.clientX === 0 && event.clientY === 0;
      nextRequestKey += 1;
      setRequest({
        key: nextRequestKey,
        projectId,
        x: fromKeyboard ? rect.left + 12 : event.clientX,
        y: fromKeyboard ? rect.bottom : event.clientY,
        source: element,
      });
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [scope]);
  const close = useCallback(() => setRequest(null), []);
  // A card's ⋯ tapped (a touch screen, which has no right-click): the same menu, under the button, lined up with its right.
  const openFrom = useCallback(
    (button: HTMLElement) => {
      const element = button.closest<HTMLElement>(`[data-project-actions="${scope}"]`);
      const projectId = String(element?.dataset.projectActionsId ?? "").trim();
      if (!element || !projectId) return;
      const rect = button.getBoundingClientRect();
      nextRequestKey += 1;
      setRequest({ key: nextRequestKey, projectId, x: rect.right, y: rect.bottom + 4, source: element, alignEnd: true });
    },
    [scope],
  );
  return { request, close, openFrom };
}

// A staff member, as Change Assigned lists them: their initials in their own colour.
export type ProjectQuickActionsStaff = { uid: string; name: string; color: string };
export type ProjectQuickActionsTab = "sales" | "production";

export const NO_PROJECT_QUICK_ACTIONS: ProjectQuickActionsAccess = {
  design: false,
  production: false,
  move: false,
  assign: false,
  tags: false,
  archive: false,
};

function initials(text: string) {
  const parts = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "CU";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

const SLIDE = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
const EDGE_PX = 8;
const ROW_CLASS = `${GLASS_MENU_ROW_CLASS} h-8 max-md:h-11`;
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";

// What the keyboard moves between: the buttons and box of the panel showing.
function visibleMenuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])") ?? []).filter(
    (el) => !el.closest('[aria-hidden="true"]'),
  );
}

function MenuDivider() {
  return <div role="separator" className="mx-2 my-1 h-px" style={{ backgroundColor: "var(--glass-border)" }} />;
}

// What it does for a project, given everything it needs (the Dashboard's from its own state; the top bar's loaded as it
// opens — ProjectTabQuickActions below). Stays mounted while closed: Archive's confirm, and the saves that finish after
// the menu's gone (with their Undo), outlive it.
export function ProjectQuickActionsMenu({
  request,
  onClose,
  project,
  loadFailed = false,
  statuses,
  staff,
  tagSuggestions,
  access,
  moving = false,
  onOpen,
  onOpenTab,
  onMove,
  onArchiving,
}: {
  request: ProjectQuickActionsRequest | null;
  onClose: () => void;
  // The project it's open for — null while it's still loading (skeleton rows), or when it couldn't be (loadFailed).
  project: Project | null;
  loadFailed?: boolean;
  statuses: StatusMenuStatus[];
  staff: ProjectQuickActionsStaff[];
  tagSuggestions: string[];
  access: ProjectQuickActionsAccess;
  // A move of it being saved (Move's statuses wait).
  moving?: boolean;
  // Open: as clicking it does.
  onOpen: (projectId: string, source: HTMLElement) => void;
  // Open Design / Open Production (without it: straight to that tab of its page).
  onOpenTab?: (projectId: string, tab: ProjectQuickActionsTab) => void;
  // Move: a status, or a status and one of its sub-statuses — saved as the caller's own status menu saves it.
  onMove: (project: Project, status: string, subStage?: string) => void;
  // As it's archived, just before its tab is closed (the top bar's tab pops away).
  onArchiving?: (projectId: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { tabs, suppressScope, restoreScope, registerScopeTabs } = useAppTabs();
  const offerUndo = useUndo();
  const notice = useFloatingNotice({ tone: "yellow" });
  const actor = String(user?.displayName || user?.email || "Staff").trim() || "Staff";
  // Each project's tags as last saved here — what a removed tag's Undo puts it back into.
  const latestTagsRef = useRef(new Map<string, string[]>());

  const openTab = (projectId: string, tab: ProjectQuickActionsTab) => {
    if (onOpenTab) onOpenTab(projectId, tab);
    else router.push(`/projects/${projectId}?tab=${tab}`);
  };

  // Change Assigned: saved as the page's Assign saves it, shown straight away (put back if it can't be saved).
  const assign = async (target: Project, uid: string) => {
    const members = staff.map((member) => ({ uid: member.uid, displayName: member.name }));
    const before: Partial<Project> = {
      assignedToUid: target.assignedToUid ?? "",
      assignedToName: target.assignedToName ?? "",
      assignedTo: target.assignedTo ?? "",
    };
    announceProjectPatched(target.id, projectAssignmentPatch(uid, members));
    if (await assignProject(target, uid, members, actor)) return;
    announceProjectPatched(target.id, before);
    notice.show("Couldn't change who's assigned. Please try again.");
  };

  // Edit Tags: saved as the project page saves them. A tag taken off can be put back from the Undo bar (offered once the
  // save's done, so its Undo can't land before it) — where it was, unless the project's at five again by then.
  const saveTags = async (target: Project, nextTags: string[], previousTags: string[]): Promise<boolean> => {
    const ok = await saveProjectTags(target, nextTags, previousTags, actor, () => {
      latestTagsRef.current.set(target.id, nextTags);
      announceProjectPatched(target.id, { tags: nextTags });
    });
    if (!ok) {
      notice.show("Couldn't save the tags. Please try again.");
      return false;
    }
    const removed = previousTags.find((tag) => !nextTags.includes(tag));
    if (removed && nextTags.length < previousTags.length) {
      const index = previousTags.indexOf(removed);
      offerUndo(`${removed} removed`, async () => {
        const current = latestTagsRef.current.get(target.id) ?? nextTags;
        if (current.length >= PROJECT_TAG_LIMIT || current.some((tag) => tag.toLowerCase() === removed.toLowerCase())) return;
        const restored = [...current];
        restored.splice(Math.min(index, restored.length), 0, removed);
        await saveProjectTags(target, restored, current, actor, () => {
          latestTagsRef.current.set(target.id, restored);
          announceProjectPatched(target.id, { tags: restored });
        });
      });
    }
    return true;
  };

  // Archive: asked first, as the project page's Archive button asks (its name typed to confirm).
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Project | null>(null);
  const [archiveOrigin, setArchiveOrigin] = useState<GlassModalOrigin>(null);
  const [archiveNameInput, setArchiveNameInput] = useState("");
  const [isArchiving, setIsArchiving] = useState(false);
  const archivePanelRef = useRef<HTMLDivElement | null>(null);
  const shouldRenderArchiveConfirm = useGlassModalPopOrigin(archiveConfirmOpen, archiveOrigin, archivePanelRef);
  const askToArchive = (target: Project, origin: GlassModalOrigin) => {
    setArchiveTarget(target);
    setArchiveOrigin(origin);
    setArchiveNameInput("");
    setArchiveConfirmOpen(true);
  };
  const closeArchiveConfirm = () => {
    if (!isArchiving) setArchiveConfirmOpen(false);
  };
  // As the project page's Archive does: filed in the Archive, its tab closed, and its page left if it's the one open.
  // Undo: out of the archive just as it was — back on its page if that was left, else its tab back in the top bar.
  const confirmArchive = async () => {
    const target = archiveTarget;
    if (!target || isArchiving || archiveNameInput.trim() !== target.name.trim()) return;
    setIsArchiving(true);
    const scopeKey = `project:${target.id}`;
    const tabsBefore = tabs.filter((tab) => tab.scopeKey === scopeKey);
    const ok = await archiveProject(target);
    setIsArchiving(false);
    if (!ok) return;
    setArchiveConfirmOpen(false);
    onArchiving?.(target.id);
    suppressScope(scopeKey);
    const openProjectId = String(pathname || "").match(/^\/projects\/([^/?#]+)/)?.[1] ?? "";
    const leftItsPage = openProjectId === target.id;
    if (leftItsPage) router.push("/dashboard");
    offerUndo(`${target.name.trim() || "Project"} archived`, async () => {
      if (!(await unarchiveProject(target))) return;
      restoreScope(scopeKey);
      announceProjectPatched(target.id, { isArchived: false, archivedAtIso: "" });
      if (leftItsPage) router.push(`/projects/${target.id}`);
      else if (tabsBefore.length) registerScopeTabs(scopeKey, tabsBefore);
    });
  };

  const archiveName = archiveTarget?.name ?? "";
  return (
    <>
      {request ? (
        <QuickActionsPopup
          key={request.key}
          request={request}
          onClose={onClose}
          project={project}
          loadFailed={loadFailed}
          statuses={statuses}
          staff={staff}
          tagSuggestions={tagSuggestions}
          access={access}
          moving={moving}
          onOpen={() => onOpen(request.projectId, request.source)}
          onOpenTab={(tab) => openTab(request.projectId, tab)}
          onMove={onMove}
          onAssign={(target, uid) => void assign(target, uid)}
          onSaveTags={saveTags}
          onArchive={askToArchive}
        />
      ) : null}
      {shouldRenderArchiveConfirm && archiveTarget && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[2147483646] flex items-center justify-center px-4">
              <button
                type="button"
                aria-label="Close archive project dialog backdrop"
                onClick={closeArchiveConfirm}
                className="glass-modal-backdrop absolute inset-0"
              />
              <div
                ref={archivePanelRef}
                role="dialog"
                aria-modal="true"
                aria-label="Archive this project?"
                className="glass-modal-panel relative z-[2147483647] w-[min(440px,96vw)] overflow-hidden"
              >
                <GlassModalHeader title="Archive this project?" onClose={closeArchiveConfirm} />
                <div className="px-5 py-4">
                  <p className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                    This moves <b>{archiveName}</b> to the Archive and takes it off the Dashboard straight away. You can restore it or delete it
                    permanently from there.
                  </p>
                  <p className="mt-3 text-[12px] font-semibold" style={{ color: "var(--text-muted)" }}>
                    Type <b style={{ color: "var(--text-main)" }}>{archiveName}</b> to confirm.
                  </p>
                  <input
                    autoFocus
                    value={archiveNameInput}
                    onChange={(e) => setArchiveNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void confirmArchive();
                      }
                      if (e.key === "Escape") closeArchiveConfirm();
                    }}
                    placeholder={archiveName}
                    className="mt-2 h-10 w-full rounded-[10px] border px-3 text-[13px] outline-none"
                    style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                  />
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={isArchiving}
                      onClick={closeArchiveConfirm}
                      className="h-9 rounded-[8px] border px-4 text-[12px] font-semibold hover:brightness-95 disabled:opacity-60"
                      style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isArchiving || archiveNameInput.trim() !== archiveName.trim()}
                      onClick={() => void confirmArchive()}
                      className="h-9 rounded-[8px] border px-4 text-[12px] font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-55"
                      style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                    >
                      {isArchiving ? "Archiving..." : "Confirm Archive"}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {notice.element}
    </>
  );
}

type SubPanel = "move" | "assign" | "tags";

// The menu itself, for one right-click (keyed by it, so each starts on its first panel).
function QuickActionsPopup({
  request,
  onClose,
  project,
  loadFailed,
  statuses,
  staff,
  tagSuggestions,
  access,
  moving,
  onOpen,
  onOpenTab,
  onMove,
  onAssign,
  onSaveTags,
  onArchive,
}: {
  request: ProjectQuickActionsRequest;
  onClose: () => void;
  project: Project | null;
  loadFailed: boolean;
  statuses: StatusMenuStatus[];
  staff: ProjectQuickActionsStaff[];
  tagSuggestions: string[];
  access: ProjectQuickActionsAccess;
  moving: boolean;
  onOpen: () => void;
  onOpenTab: (tab: ProjectQuickActionsTab) => void;
  onMove: (project: Project, status: string, subStage?: string) => void;
  onAssign: (project: Project, uid: string) => void;
  onSaveTags: (project: Project, nextTags: string[], previousTags: string[]) => Promise<boolean>;
  onArchive: (project: Project, origin: GlassModalOrigin) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Which panel's showing, and the one the second panel holds (kept as it slides back).
  const [showingSub, setShowingSub] = useState(false);
  const [subPanel, setSubPanel] = useState<SubPanel>("move");
  // Edit Tags: its tags while a change of them is being saved, and what's typed to add one.
  const [tagsDraft, setTagsDraft] = useState<string[] | null>(null);
  const [savingTags, setSavingTags] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const tags = tagsDraft ?? project?.tags ?? [];
  const { x, y, alignEnd } = request;

  // At the pointer — kept on the screen, again whenever its size changes (a panel taller or shorter than the last).
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const place = () => {
      const viewport = window.visualViewport;
      const viewLeft = viewport?.offsetLeft ?? 0;
      const viewTop = viewport?.offsetTop ?? 0;
      const viewWidth = viewport?.width ?? window.innerWidth;
      const viewHeight = viewport?.height ?? window.innerHeight;
      menu.style.maxHeight = `${Math.max(120, Math.floor(viewHeight - EDGE_PX * 2))}px`;
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const left = Math.max(viewLeft + EDGE_PX, Math.min(alignEnd ? x - width : x, viewLeft + viewWidth - EDGE_PX - width));
      const top = Math.max(viewTop + EDGE_PX, Math.min(y, viewTop + viewHeight - EDGE_PX - height));
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
      // (It squeezes out of the pointer — .glass-menu-squeeze.)
      menu.style.transformOrigin = `${Math.round(Math.min(width, Math.max(0, x - left)))}px ${Math.round(Math.min(height, Math.max(0, y - top)))}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [x, y, alignEnd]);

  // Closed by a press anywhere else, Escape, a scroll (not its own lists'), a resize, or the window losing focus. A press
  // that closes it doesn't also act on what it landed on — a right-click on another card opens that one's instead.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
      if (event.button === 0) swallowNextClick();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // The keyboard: into the panel showing (Edit Tags: its box), as it opens, loads, or slides.
  const loaded = Boolean(project) || loadFailed;
  useEffect(() => {
    if (!loaded) return;
    const frame = requestAnimationFrame(() => {
      const items = visibleMenuItems(menuRef.current);
      const first = (showingSub ? items.find((el) => el.tagName === "INPUT") : null) ?? items.find((el) => !el.dataset.backRow) ?? items[0];
      first?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [loaded, showingSub, subPanel]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const inInput = event.target instanceof HTMLInputElement;
    if (event.key === "ArrowLeft" && showingSub && !inInput) {
      event.preventDefault();
      setShowingSub(false);
      return;
    }
    if (inInput && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = visibleMenuItems(menuRef.current);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = current <= 0 ? items.length - 1 : current - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  const open = () => {
    onClose();
    onOpen();
  };
  const openTab = (tab: ProjectQuickActionsTab) => {
    onClose();
    onOpenTab(tab);
  };
  const slideTo = (panel: SubPanel) => {
    setSubPanel(panel);
    setShowingSub(true);
  };

  const row = (options: { icon: ReactNode; label: string; onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void; sub?: boolean; danger?: boolean }) => (
    <button
      type="button"
      role="menuitem"
      onClick={options.onClick}
      aria-haspopup={options.sub ? "true" : undefined}
      className={ROW_CLASS}
      style={{ color: options.danger ? "var(--danger)" : "var(--text-main)" }}
    >
      <span className="inline-flex shrink-0">{options.icon}</span>
      <span className="min-w-0 flex-1 truncate">{options.label}</span>
      {options.sub ? <ChevronRight size={14} className="shrink-0 opacity-70" /> : null}
    </button>
  );

  const backRow = (icon: ReactNode, title: string) => (
    <>
      <button
        type="button"
        data-back-row="true"
        onClick={() => setShowingSub(false)}
        className={ROW_CLASS}
        style={{ color: "var(--text-main)" }}
        aria-label="Back"
        title="Back"
      >
        <ChevronLeft size={15} className="shrink-0" style={{ color: "var(--text-muted)" }} />
        <span className="inline-flex shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
      <MenuDivider />
    </>
  );

  // ---- The panels ----

  const mainPanel = (target: Project) => (
    <>
      {row({ icon: <ExternalLink size={14} />, label: "Open", onClick: open })}
      {access.design ? row({ icon: <PencilRuler size={14} />, label: "Open Design", onClick: () => openTab("sales") }) : null}
      {access.production ? row({ icon: <Factory size={14} />, label: "Open Production", onClick: () => openTab("production") }) : null}
      {access.move || access.assign || access.tags ? <MenuDivider /> : null}
      {access.move ? row({ icon: <ArrowRightLeft size={14} />, label: "Move", sub: true, onClick: () => slideTo("move") }) : null}
      {access.assign ? row({ icon: <UserCheck size={14} />, label: "Change Assigned", sub: true, onClick: () => slideTo("assign") }) : null}
      {access.tags ? row({ icon: <Tag size={14} />, label: "Edit Tags", sub: true, onClick: () => slideTo("tags") }) : null}
      {access.archive ? (
        <>
          <MenuDivider />
          {row({
            icon: <Archive size={14} />,
            label: "Archive",
            danger: true,
            onClick: (event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onClose();
              onArchive(target, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
            },
          })}
        </>
      ) : null}
    </>
  );

  const movePanel = (target: Project) => (
    <>
      {backRow(<ArrowRightLeft size={14} />, "Move")}
      <div role="listbox" aria-label="Move to">
        <StatusMenuPanels
          statuses={statuses}
          currentStatus={String(target.statusLabel || "")}
          currentSubStage={String(target.dashboardSubStageId ?? "")}
          disabled={moving}
          onSelect={(status, subStage) => {
            onClose();
            onMove(target, status, subStage);
          }}
        />
      </div>
    </>
  );

  const assignedUid = String(project?.assignedToUid ?? "").trim();
  const pickedRowStyle = { backgroundColor: "color-mix(in srgb, var(--brand) 10%, transparent)" };
  const pickedCheck = <Check size={14} className="ml-auto shrink-0" style={{ color: "var(--brand)" }} />;
  const assignPanel = (target: Project) => {
    const pick = (uid: string) => {
      onClose();
      if (uid !== assignedUid) onAssign(target, uid);
    };
    return (
      <>
        {backRow(<UserCheck size={14} />, "Change Assigned")}
        <div role="listbox" aria-label="Assign to" className="glass-scroll max-h-[288px] overflow-y-auto max-md:max-h-[396px]">
          <button
            type="button"
            role="option"
            aria-selected={!assignedUid}
            onClick={() => pick("")}
            className={ROW_CLASS}
            style={{ color: "var(--text-main)", ...(!assignedUid ? pickedRowStyle : null) }}
          >
            <span className="inline-flex h-5 w-5 shrink-0 rounded-full border border-dashed" style={{ borderColor: "var(--text-muted)" }} />
            <span className="min-w-0 flex-1 truncate">Unassigned</span>
            {!assignedUid ? pickedCheck : null}
          </button>
          {staff.map((member) => {
            const picked = member.uid === assignedUid;
            return (
              <button
                key={member.uid}
                type="button"
                role="option"
                aria-selected={picked}
                onClick={() => pick(member.uid)}
                className={ROW_CLASS}
                style={{ color: "var(--text-main)", ...(picked ? pickedRowStyle : null) }}
              >
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: member.color }}
                >
                  {initials(member.name)}
                </span>
                <span className="min-w-0 flex-1 truncate">{member.name}</span>
                {picked ? pickedCheck : null}
              </button>
            );
          })}
          {!staff.length ? (
            <p className="px-3 py-2 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
              No staff members found.
            </p>
          ) : null}
        </div>
      </>
    );
  };

  // Five at most; each with an × to take it off; a box to add one, the company's tags suggested under it (the ones
  // starting with what's typed first). One change at a time, as on the project page.
  const changeTags = async (target: Project, nextTags: string[]) => {
    if (savingTags) return;
    const previousTags = tags;
    setTagsDraft(nextTags);
    setSavingTags(true);
    const ok = await onSaveTags(target, nextTags, previousTags);
    setSavingTags(false);
    setTagsDraft(ok ? null : previousTags);
  };
  const addTag = (target: Project, raw: string) => {
    const typed = String(raw || "").trim();
    const next = tagSuggestions.find((tag) => tag.toLowerCase() === typed.toLowerCase()) ?? typed;
    if (!next || savingTags || tags.length >= PROJECT_TAG_LIMIT) return;
    setTagInput("");
    if (tags.some((tag) => tag.toLowerCase() === next.toLowerCase())) return;
    void changeTags(target, [...tags, next].slice(0, PROJECT_TAG_LIMIT));
  };
  const availableSuggestions = tagSuggestions.filter((value) => !tags.some((tag) => tag.toLowerCase() === value.toLowerCase()));
  const typedTag = tagInput.trim().toLowerCase();
  const suggestions = (
    typedTag
      ? [
          ...availableSuggestions.filter((tag) => tag.toLowerCase().startsWith(typedTag)),
          ...availableSuggestions.filter((tag) => !tag.toLowerCase().startsWith(typedTag) && tag.toLowerCase().includes(typedTag)),
        ]
      : availableSuggestions
  ).slice(0, 12);
  const tagsPanel = (target: Project) => (
    <>
      {backRow(<Tag size={14} />, "Edit Tags")}
      <div className="px-2 pb-1 pt-0.5">
        {tags.length ? (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex max-w-full items-center gap-1 rounded-[8px] border py-[2px] pl-2 pr-[3px] text-[12px] font-medium max-md:text-[14px]"
                style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
              >
                <span className="min-w-0 truncate">{tag}</span>
                <button
                  type="button"
                  disabled={savingTags}
                  onClick={() => void changeTags(target, tags.filter((item) => item !== tag))}
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50 max-md:h-6 max-md:w-6"
                  aria-label={`Remove ${tag}`}
                  title="Remove"
                >
                  <X size={10} strokeWidth={2.6} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="px-1 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
            No tags yet.
          </p>
        )}
        {tags.length < PROJECT_TAG_LIMIT ? (
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(target, tagInput);
                }
              }}
              placeholder="Add a tag"
              aria-label="Add a tag"
              className="h-7 min-w-0 flex-1 rounded-[8px] border px-2 text-[12px] font-medium outline-none max-md:h-10 max-md:text-[15px]"
              style={{
                borderColor: "var(--glass-border)",
                backgroundColor: "color-mix(in srgb, var(--panel-bg) 45%, transparent)",
                color: "var(--text-main)",
              }}
            />
            <button
              type="button"
              disabled={savingTags || !tagInput.trim()}
              onClick={() => addTag(target, tagInput)}
              // The project page's add-tag + (the glass shine in green).
              className="glass-shine inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white hover:brightness-105 disabled:opacity-60"
              style={glassShineStyle("#16A34A")}
              aria-label="Add tag"
              title="Add tag"
            >
              <Plus size={16} strokeWidth={3} />
            </button>
          </div>
        ) : (
          <p className="mt-1.5 px-1 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
            {PROJECT_TAG_LIMIT} tags is the most a project can have.
          </p>
        )}
      </div>
      {tags.length < PROJECT_TAG_LIMIT && suggestions.length ? (
        <div role="listbox" aria-label="Suggested tags" className="glass-scroll max-h-[168px] overflow-y-auto max-md:max-h-[264px]">
          {suggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              role="option"
              aria-selected={false}
              disabled={savingTags}
              onClick={() => addTag(target, tag)}
              className={`${GLASS_MENU_ROW_CLASS} h-7 disabled:opacity-60 max-md:h-10`}
              style={{ color: "var(--text-main)" }}
            >
              <Tag size={12} className="shrink-0" style={{ color: "var(--text-muted)" }} />
              <span className="min-w-0 flex-1 truncate">{tag}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );

  const loadingRows = (
    <SkeletonGroup label="Loading">
      {[58, 70, 76, 0, 50, 72, 62].map((width, index) =>
        width ? (
          <div key={index} className="flex h-8 items-center gap-2 px-3 max-md:h-11">
            <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-[4px]" />
            <Skeleton className="h-3" style={{ width: `${width}%` }} />
          </div>
        ) : (
          <MenuDivider key={index} />
        ),
      )}
    </SkeletonGroup>
  );

  let body: ReactNode;
  if (project) {
    const subContent = subPanel === "move" ? movePanel(project) : subPanel === "assign" ? assignPanel(project) : tagsPanel(project);
    body = (
      // The panel showing sets the height; the other sits beside it, out of sight, as they slide.
      <div className="relative overflow-hidden">
        <div
          aria-hidden={showingSub}
          inert={showingSub}
          className={showingSub ? "pointer-events-none absolute inset-x-0 top-0" : "relative"}
          style={{ transform: showingSub ? "translateX(-100%)" : "translateX(0)", transition: SLIDE }}
        >
          {mainPanel(project)}
        </div>
        <div
          aria-hidden={!showingSub}
          inert={!showingSub}
          className={showingSub ? "relative" : "pointer-events-none absolute inset-x-0 top-0"}
          style={{ transform: showingSub ? "translateX(0)" : "translateX(100%)", transition: SLIDE }}
        >
          {subContent}
        </div>
      </div>
    );
  } else if (loadFailed) {
    body = (
      <>
        {row({ icon: <ExternalLink size={14} />, label: "Open", onClick: open })}
        <MenuDivider />
        <p className="px-3 py-1.5 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
          Couldn&apos;t load this project&apos;s other actions.
        </p>
      </>
    );
  } else {
    body = loadingRows;
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={project?.name ? `${project.name} actions` : "Project actions"}
      className={`${GLASS_MENU_CLASS} w-[236px] max-w-[calc(100vw-16px)] max-md:w-[264px]`}
      style={{ ...GLASS_MENU_STYLE, left: x, top: y }}
      onKeyDown={onKeyDown}
      // (Right-clicking in the menu: no browser menu over it — except in its text box.)
      onContextMenu={(event) => {
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
    >
      {body}
    </div>,
    document.body,
  );
}

// ---- The top bar's ----

type LoadedProjectActions = {
  key: number;
  project: Project | null;
  companyDoc: Record<string, unknown> | null;
  staff: ProjectQuickActionsStaff[];
};

// A project's tab in the top bar: nothing about the project is at hand there, so as its menu opens, the project, its
// company's statuses, tags and staff, and the person's access to it (as its page works it out) are loaded — skeleton rows
// until they're in. Move is saved the Dashboard's way (lib/project-actions.ts), a locked job's reason shown at the bottom
// of the screen; whatever changes is told to an open Dashboard (PROJECT_PATCHED_EVENT).
export function ProjectTabQuickActions({
  onOpen,
  onOpenTab,
  onArchiving,
}: {
  onOpen: (projectId: string) => void;
  onOpenTab: (projectId: string, tab: ProjectQuickActionsTab) => void;
  onArchiving?: (projectId: string) => void;
}) {
  const { request, close } = useProjectQuickActionsRequest("tabs");
  const { user } = useAuth();
  const uid = String(user?.uid || "").trim();
  const userCompanyId = String(user?.companyId || "").trim();
  const [loaded, setLoaded] = useState<LoadedProjectActions | null>(null);
  const current = loaded && request && loaded.key === request.key ? loaded : null;
  const project = current?.project ?? null;
  const companyAccess = useCompanyAccess(project ? project.companyId : null);
  const [movingProjectId, setMovingProjectId] = useState("");
  const lockNotice = useFloatingNotice({ tone: "yellow" });

  const requestKey = request?.key ?? 0;
  const requestProjectId = request?.projectId ?? "";
  useEffect(() => {
    if (!requestKey || !requestProjectId) return;
    let cancelled = false;
    void (async () => {
      let storedCompanyId = "";
      try {
        storedCompanyId = String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim();
      } catch {
        // No stored company — the user's own is looked up.
      }
      const found = await fetchProjectById(requestProjectId, uid, [storedCompanyId, userCompanyId].filter(Boolean)).catch(() => null);
      const companyId = String(found?.companyId || "").trim();
      const [companyDoc, members] = companyId
        ? await Promise.all([fetchCompanyDoc(companyId).catch(() => null), fetchCompanyMembers(companyId).catch(() => [])])
        : [null, []];
      const colors = members.length
        ? await fetchUserColorMapByUids(
            members.map((member) => member.uid),
            companyId,
          ).catch(() => ({}) as Record<string, string>)
        : ({} as Record<string, string>);
      if (cancelled) return;
      // Each in their colour, as the project page shows them.
      const themeColor = String(companyDoc?.themeColor ?? "").trim();
      const staff = members.map((member) => ({
        uid: member.uid,
        name: member.displayName,
        color: String(colors[member.uid] || member.badgeColor || member.userColor || themeColor || "#7D99B3").trim(),
      }));
      setLoaded({ key: requestKey, project: found, companyDoc, staff });
    })();
    return () => {
      cancelled = true;
    };
  }, [requestKey, requestProjectId, uid, userCompanyId]);

  // Its loaded copy kept up with what's changed from the menu since (Edit Tags stays open as tags are added).
  useEffect(() => {
    const onPatched = (event: Event) => {
      const detail = (event as CustomEvent<ProjectPatchedDetail>).detail;
      if (!detail?.projectId) return;
      setLoaded((prev) =>
        prev?.project && prev.project.id === detail.projectId ? { ...prev, project: { ...prev.project, ...detail.patch } } : prev,
      );
    };
    window.addEventListener(PROJECT_PATCHED_EVENT, onPatched);
    return () => window.removeEventListener(PROJECT_PATCHED_EVENT, onPatched);
  }, []);

  const companyDoc = current?.companyDoc ?? null;
  const statusRows = useMemo(() => projectStatusRowsFrom(companyDoc?.projectStatuses), [companyDoc]);
  const statuses = useMemo<StatusMenuStatus[]>(
    () => statusRows.map((row) => ({ name: row.name, color: row.color, subStages: (row.subStages ?? []).map((sub) => ({ name: sub.name, color: sub.color })) })),
    [statusRows],
  );
  const tagSuggestions = useMemo(() => projectTagSuggestionsFrom(companyDoc), [companyDoc]);
  // Their role in the project's own company, as the Dashboard works it out (until that's known, the skeleton stays).
  const accessReady = companyAccess.status !== "loading" || !project?.companyId;
  const role = String((companyAccess.status === "ready" ? companyAccess.role : "") || user?.role || "").trim().toLowerCase() || "staff";
  const permissionKeys = companyAccess.status === "ready" && companyAccess.permissionKeys.length ? companyAccess.permissionKeys : user?.permissions ?? [];
  const access = project && accessReady ? projectQuickActionsAccess(project, role, user?.uid, permissionKeys, Boolean(user?.verified)) : NO_PROJECT_QUICK_ACTIONS;
  const canSeeCompletionBonus = isOwnerOrAdmin(role) || hasPermissionKey(permissionKeys, "dashboard.complete.bonus");

  const move = async (target: Project, status: string, chosenSubStage?: string) => {
    if (movingProjectId === target.id) return;
    const subStageId = landingSubStage(statusRows, status, chosenSubStage);
    const isCompletedStatus = completedStatusMatcher(companyDoc?.projectStatuses);
    const bonusSettings = canSeeCompletionBonus ? completionBonusSettingsFrom(companyDoc) : null;
    setMovingProjectId(target.id);
    const ok = await moveProjectStatus(target, status, subStageId, {
      actor: String(user?.displayName || user?.email || "Staff").trim() || "Staff",
      onLocked: (lock) => lockNotice.show(bonusLockMessage(lock, bonusSettings), <Lock size={14} />),
    });
    setMovingProjectId("");
    if (ok) announceProjectPatched(target.id, statusMoveLocalPatch(target, status, subStageId, isCompletedStatus, new Date().toISOString()));
  };

  return (
    <>
      <ProjectQuickActionsMenu
        request={request}
        onClose={close}
        project={accessReady ? project : null}
        loadFailed={Boolean(current) && !project}
        statuses={statuses}
        staff={current?.staff ?? []}
        tagSuggestions={tagSuggestions}
        access={access}
        moving={Boolean(project) && movingProjectId === project?.id}
        onOpen={(projectId) => onOpen(projectId)}
        onOpenTab={onOpenTab}
        onMove={(target, status, subStage) => void move(target, status, subStage)}
        onArchiving={onArchiving}
      />
      {lockNotice.element}
    </>
  );
}
