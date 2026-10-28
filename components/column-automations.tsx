"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Clock, FolderPlus, Plus, Search, Trash2, UserCheck, Users, X, Zap } from "lucide-react";
import { GLASS_MENU_CLASS, GLASS_MENU_STYLE, GlassDropdown } from "@/components/glass-dropdown";
import { modalCloseButtonClass } from "@/components/settings-ui";
import { useAuth } from "@/lib/auth-context";
import { normalizeRoles, type RoleRow } from "@/lib/company-roles";
import {
  automationRoleKey,
  CONDITION_ANYONE,
  CONDITION_NOBODY,
  conditionFieldsFor,
  conditionOpsFor,
  LEAD_SOURCE_OPTIONS,
  COLUMN_AUTOMATION_MAX_AMOUNT,
  COLUMN_AUTOMATION_NOTIFICATION_TYPE,
  COLUMN_AUTOMATION_UNITS,
  columnAutomationColumnLabel,
  columnAutomationDurationLabel,
  columnAutomationNotificationText,
  columnAutomationsFor,
  newColumnAutomationId,
  normalizeColumnAutomations,
  type AutomationCondition,
  type AutomationConditionField,
  type AutomationConditionOp,
  type ColumnAutomation,
  type ColumnAutomationAction,
  type ColumnAutomationBoard,
  type ColumnAutomationTrigger,
  type ColumnAutomationUnit,
} from "@/lib/column-automations";
import { devButtonClass, useDevModeOn } from "@/lib/dev-mode";
import { addUserNotification, fetchCompanyDoc, fetchCompanyMembers, saveColumnAutomations, type CompanyMemberOption } from "@/lib/firestore-data";
import { glassShineStyle } from "@/lib/glass-shine";
import { hasPermissionKey, isOwnerOrAdmin, useCompanyAccess } from "@/lib/use-company-access";
import { cn } from "@/lib/utils";
import { SkeletonRows } from "@/components/skeleton";
import { useUndo } from "@/components/undo-bar";

// A board's column automations (lib/column-automations.ts), for whoever's role has projects.automate: right-click a
// column (an element marked data-automation-board / -status / -substage / -color — the Dashboard's and Leads' column
// frames) for its menu → Automate, a pop-up of its automations:
//   Notify <people, roles, the person it's assigned to> when a project <enters | leaves | has been in> <column> [for <n> <unit>]
//   Move a project to <any of the board's other columns> when it enters <column> <straight away | after <n> <unit>>
//     — a lead's to one of the Dashboard's columns too: "and convert it to a project"
//   Assign a project to <person> when it enters <column>
//   Tag a project <tag> when it enters <column> (projects)
//   … but only if <who it's assigned to | the column it came from | its tags | where it came in from | its name> <is …>
// People and roles are kept by their ids and shown by their names as they are now, so a rename doesn't lose them; a role
// tells everyone in it when it's sent.
// each part a dropdown, any number of them (more than one move in a column: the first whose conditions hold); saved to
// the company doc. Company Settings' status
// lists show how many each column has (countFor) on its row's Automate button, which opens them too (open). Dev mode: a
// notify one's Test sends it to yourself, as it would read.

export type ColumnAutomationTarget = { status: string; subStage: string; color: string };
// One of the board's columns (a status, or a Dashboard status's sub-stage) — somewhere a move can go.
export type ColumnAutomationColumn = ColumnAutomationTarget;

const UPDATED_EVENT = "cutsmart:column-automations-updated";
const same = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

const TRIGGER_OPTIONS: Array<{ value: ColumnAutomationTrigger; label: string }> = [
  { value: "enters", label: "enters" },
  { value: "leaves", label: "leaves" },
  { value: "stays", label: "has been in" },
];
const UNIT_OPTIONS = COLUMN_AUTOMATION_UNITS.map((unit) => ({ value: unit.value, label: unit.many }));
const ACTION_OPTIONS: Array<{ value: ColumnAutomationAction; label: string }> = [
  { value: "notify", label: "Notify" },
  { value: "move", label: "Move" },
  { value: "assign", label: "Assign" },
  { value: "tag", label: "Tag" },
];
// "But only if" — each condition read as the rest of the sentence: "who it's assigned to" "is" "Liam".
const CONDITION_FIELD_LABELS: Record<AutomationConditionField, string> = {
  assignee: "who it's assigned to",
  from: "the column it came from",
  tag: "its tags",
  source: "where it came in from",
  name: "its name",
};
const CONDITION_OP_LABELS: Record<AutomationConditionOp, string> = {
  is: "is",
  isNot: "isn't",
  has: "include",
  hasNot: "don't include",
  contains: "contains",
  notContains: "doesn't contain",
};
const TIMING_OPTIONS = [
  { value: "now", label: "straight away" },
  { value: "after", label: "after" },
];
// A timed move's time: for what enters from now on, or from when each moved in (what's already there too).
const COUNT_FROM_OPTIONS = [
  { value: "now", label: "for ones entering from now" },
  { value: "movedIn", label: "counting from when each moved in" },
];
// A column as a dropdown value: its status and sub-stage, apart.
const COLUMN_KEY_SEP = "\u001f";
// The rules' dropdowns and boxes: the same rounded pill.
const PILL_CLASS = "h-9 justify-between gap-2 rounded-full border px-3.5 text-[13px] font-medium";
const PILL_STYLE = { borderColor: "var(--panel-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" };
// The app's green "+" buttons' colour (their glass shine) — Add automation's under the pointer; a brighter green before.
const ADD_GREEN = "#16A34A";
const ADD_GREEN_LIGHT = "#22C55E";
const FLOATING_STYLE = {
  borderColor: "var(--glass-border)",
  backgroundColor: "var(--glass-modal-bg)",
  backdropFilter: "blur(12px) saturate(220%)",
  WebkitBackdropFilter: "blur(12px) saturate(220%)",
  zIndex: 9700,
};

const memberName = (member: CompanyMemberOption) =>
  String(member.membershipDisplayName || member.displayName || member.email || "Someone").trim();
const memberColor = (member: CompanyMemberOption | undefined) => String(member?.userColor || member?.badgeColor || "").trim() || "#7C8EA5";
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

export function useColumnAutomations(
  board: ColumnAutomationBoard,
  // The board's columns, for where a move can go.
  columns: ColumnAutomationColumn[],
): {
  canAutomate: boolean;
  countFor: (status: string, subStage?: string) => number;
  open: (target: ColumnAutomationTarget) => void;
  layer: ReactNode;
} {
  const access = useCompanyAccess();
  const companyId = access.status === "ready" ? String(access.companyId || "").trim() : "";
  const canAutomate =
    access.status === "ready" && (isOwnerOrAdmin(access.role) || hasPermissionKey(access.permissionKeys, "projects.automate"));
  const [automations, setAutomations] = useState<ColumnAutomation[]>([]);
  // The Dashboard's columns — where a Leads column can move a lead on to (converting it to a project).
  const [dashboardColumns, setDashboardColumns] = useState<ColumnAutomationColumn[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; target: ColumnAutomationTarget } | null>(null);
  const [editing, setEditing] = useState<ColumnAutomationTarget | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // The company's automations — and again whenever they're saved (here, or the other board).
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    void fetchCompanyDoc(companyId).then((companyDoc) => {
      if (cancelled) return;
      setAutomations(normalizeColumnAutomations(companyDoc?.columnAutomations));
      setDashboardColumns(dashboardColumnsOf(companyDoc?.projectStatuses));
    });
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId: string; automations: ColumnAutomation[] }>).detail;
      if (detail?.companyId === companyId) setAutomations(detail.automations);
    };
    window.addEventListener(UPDATED_EVENT, onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(UPDATED_EVENT, onUpdated);
    };
  }, [companyId]);

  // Right-click a column (not in a text box — that keeps its own menu): its menu, at the pointer.
  useEffect(() => {
    if (!canAutomate) return;
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const column = target?.closest<HTMLElement>(`[data-automation-board="${board}"]`);
      if (!column || target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      setMenu({
        x: event.clientX,
        y: event.clientY,
        target: {
          status: column.dataset.automationStatus ?? "",
          subStage: column.dataset.automationSubstage ?? "",
          color: column.dataset.automationColor ?? "#64748B",
        },
      });
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [board, canAutomate]);

  // The menu closes with a press elsewhere, Escape, a scroll or a resize.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  const countFor = (status: string, subStage = "") => columnAutomationsFor(automations, board, status, subStage).length;
  const menuCount = menu ? countFor(menu.target.status, menu.target.subStage) : 0;

  const layer = (
    <>
      {menu && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className={GLASS_MENU_CLASS}
              style={{
                ...GLASS_MENU_STYLE,
                left: Math.min(menu.x, window.innerWidth - 228),
                top: Math.min(menu.y, window.innerHeight - 60),
                width: 220,
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setEditing(menu.target);
                  setMenu(null);
                }}
                className="flex h-8 w-full items-center gap-2 rounded-[8px] px-3 text-left text-[12px] font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--brand-soft)] hover:text-[var(--brand)] max-md:h-11 max-md:text-[15px]"
              >
                <Zap size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">Automate {columnAutomationColumnLabel(menu.target)}</span>
                {menuCount ? (
                  <span className="shrink-0 rounded-full bg-[var(--brand-soft)] px-1.5 text-[11px] font-bold text-[var(--brand)]">{menuCount}</span>
                ) : null}
              </button>
            </div>,
            document.body,
          )
        : null}
      {editing && companyId ? (
        <ColumnAutomationModal
          board={board}
          companyId={companyId}
          columns={columns}
          dashboardColumns={board === "leads" ? dashboardColumns : []}
          target={editing}
          automations={automations}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setAutomations(next);
            window.dispatchEvent(new CustomEvent(UPDATED_EVENT, { detail: { companyId, automations: next } }));
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );

  return { canAutomate, countFor, open: setEditing, layer };
}

// The Dashboard's columns: Company Settings' project statuses, each with its sub-stages.
function dashboardColumnsOf(raw: unknown): ColumnAutomationColumn[] {
  if (!Array.isArray(raw)) return [];
  const text = (value: unknown) => String(value ?? "").trim();
  return raw
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .flatMap((row) => {
      const status = text(row.name);
      if (!status) return [];
      const color = text(row.color) || "#64748B";
      const subs = Array.isArray(row.subStages) ? (row.subStages as unknown[]) : [];
      return [
        { status, subStage: "", color },
        ...subs
          .filter((sub): sub is Record<string, unknown> => Boolean(sub) && typeof sub === "object" && Boolean(text((sub as Record<string, unknown>).name)))
          .map((sub) => ({ status, subStage: text(sub.name), color: text(sub.color) || color })),
      ];
    });
}

// A column frame's marks for its right-click menu (useColumnAutomations): which board and column it is, and its colour.
export function columnAutomationAttrs(board: ColumnAutomationBoard, status: string, subStage: string, color: string) {
  return {
    "data-automation-board": board,
    "data-automation-status": status,
    "data-automation-substage": subStage,
    "data-automation-color": color,
  };
}

// A Company Settings status row's "⚡ Automate 2": opens that column's automations, with how many it has. Narrow rows
// (the settings list's @container under 448px, or a phone) keep the icon and count only.
export function ColumnAutomationButton({
  count,
  onOpen,
  disabled,
}: {
  count: number;
  onOpen: () => void;
  disabled?: boolean;
}) {
  const label = count ? `${count} automation${count === 1 ? "" : "s"}` : "Automate";
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      title={disabled ? "Name the status first" : label}
      aria-label={label}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium transition hover:brightness-95 disabled:opacity-40 max-sm:min-w-7 max-sm:justify-center max-sm:px-1.5 @max-md:min-w-7 @max-md:justify-center @max-md:px-1.5"
      style={
        count
          ? { borderColor: "color-mix(in srgb, var(--brand) 40%, var(--glass-border))", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }
          : { borderColor: "var(--glass-border)", backgroundColor: "transparent", color: "var(--text-muted)" }
      }
    >
      <Zap size={13} className="shrink-0" fill={count ? "currentColor" : "none"} />
      <span className="max-sm:hidden @max-md:hidden">Automate</span>
      {count ? <span className="font-semibold">{count}</span> : null}
    </button>
  );
}

type DraftRow = ColumnAutomation;

function ColumnAutomationModal({
  board,
  companyId,
  columns,
  dashboardColumns,
  target,
  automations,
  onClose,
  onSaved,
}: {
  board: ColumnAutomationBoard;
  companyId: string;
  columns: ColumnAutomationColumn[];
  dashboardColumns: ColumnAutomationColumn[];
  target: ColumnAutomationTarget;
  automations: ColumnAutomation[];
  onClose: () => void;
  onSaved: (next: ColumnAutomation[]) => void;
}) {
  const { user } = useAuth();
  const devModeOn = useDevModeOn();
  // The Undo bar, after an automation or a condition's taken out of the draft (removeRow, removeCondition).
  const offerUndo = useUndo();
  const column = columnAutomationColumnLabel(target);
  const thing = board === "leads" ? "lead" : "project";
  const newRow = (): DraftRow => ({
    id: newColumnAutomationId(),
    board,
    status: target.status,
    subStage: target.subStage,
    action: "notify",
    trigger: "enters",
    amount: 3,
    unit: "days",
    notifyUids: [],
    notifyRoleIds: [],
    moveToStatus: "",
    moveToSubStage: "",
    moveAfter: false,
    moveCountFrom: "now",
    moveToBoard: board,
    notifyAssignee: false,
    assignToUid: "",
    tagValue: "",
    conditions: [],
    createdByUid: String(user?.uid || ""),
    updatedAtIso: "",
  });
  const original = columnAutomationsFor(automations, board, target.status, target.subStage);
  const [rows, setRows] = useState<DraftRow[]>(() => (original.length ? original : [newRow()]));
  const [members, setMembers] = useState<CompanyMemberOption[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [triedSave, setTriedSave] = useState(false);
  const [testedId, setTestedId] = useState("");

  useEffect(() => {
    let cancelled = false;
    // The staff and roles as they are now (their names too — a rule keeps their ids).
    void Promise.all([fetchCompanyMembers(companyId).catch(() => [] as CompanyMemberOption[]), fetchCompanyDoc(companyId).catch(() => null)]).then(
      ([list, companyDoc]) => {
        if (cancelled) return;
        setMembers(list.slice().sort((a, b) => memberName(a).localeCompare(memberName(b))));
        setRoles(normalizeRoles(companyDoc?.roles));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const update = (id: string, patch: Partial<DraftRow>) => setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  // One taken out — of the draft only (it's gone once Save's pressed); undone, it's back in its place.
  const removeRow = (row: DraftRow) => {
    const at = rows.findIndex((item) => item.id === row.id);
    setRows((prev) => prev.filter((item) => item.id !== row.id));
    offerUndo("Automation removed", () =>
      setRows((prev) => (prev.some((item) => item.id === row.id) ? prev : [...prev.slice(0, at), row, ...prev.slice(at)])),
    );
  };
  // What's still to fill in on one (shown under it once Save's been tried).
  const rowProblem = (row: DraftRow): string => {
    if (row.action === "notify" && !row.notifyUids.length && !row.notifyRoleIds.length && !row.notifyAssignee) {
      return "Pick who to notify — people, roles, or the person it's assigned to.";
    }
    if (row.action === "assign" && !row.assignToUid) return "Pick who to assign it to.";
    if (row.action === "tag" && !row.tagValue.trim()) return "Type the tag to give it.";
    if (row.conditions.some((condition) => !condition.value.trim())) return "Finish each condition, or take it off.";
    return "";
  };
  const hasProblem = rows.some((row) => Boolean(rowProblem(row)));
  // Where a move can go: every other column of the board — and, a lead's, every column of the Dashboard (converting it),
  // the two in their groups ("Leads ———", "Dashboard ———"), a Dashboard one's trigger saying which ("Dashboard › Design").
  const moveOption = (toBoard: ColumnAutomationBoard, option: ColumnAutomationColumn) => ({
    value: [toBoard, option.status, option.subStage].join(COLUMN_KEY_SEP),
    label: columnAutomationColumnLabel(option),
    color: option.color,
    ...(dashboardColumns.length ? { group: toBoard === "leads" ? "Leads" : "Dashboard" } : {}),
    ...(toBoard !== board ? { triggerLabel: `Dashboard › ${columnAutomationColumnLabel(option)}` } : {}),
  });
  const moveOptions = [
    ...columns.filter((option) => !(same(option.status, target.status) && same(option.subStage, target.subStage))).map((option) => moveOption(board, option)),
    ...dashboardColumns.map((option) => moveOption("projects", option)),
  ];
  // The board's columns as a condition's "came from" (any but this one).
  const fromOptions = columns
    .filter((option) => !(same(option.status, target.status) && same(option.subStage, target.subStage)))
    .map((option) => ({ value: `${option.status}${COLUMN_KEY_SEP}${option.subStage}`, label: columnAutomationColumnLabel(option), color: option.color }));
  const personOptions = (members ?? []).map((member) => ({ value: member.uid, label: memberName(member), color: memberColor(member) }));
  // Notify, Move, Assign or Tag — a move starts off going to the first other column; the rest are on entering.
  const setAction = (row: DraftRow, action: ColumnAutomationAction) => {
    if (action === row.action) return;
    if (action !== "move") {
      update(row.id, { action, trigger: action === "notify" ? row.trigger : "enters" });
      return;
    }
    const [firstBoard = board, firstStatus = "", firstSubStage = ""] = (moveOptions[0]?.value ?? "").split(COLUMN_KEY_SEP);
    update(row.id, {
      action,
      trigger: "enters",
      moveToBoard: row.moveToStatus ? row.moveToBoard : (firstBoard as ColumnAutomationBoard),
      moveToStatus: row.moveToStatus || firstStatus,
      moveToSubStage: row.moveToStatus ? row.moveToSubStage : firstSubStage,
    });
  };
  // Its conditions: one added (who it's assigned to — anyone), changed (a new field starts from its first choice), or
  // taken off (and, as an automation's, back in its place if that's undone).
  const conditionStartValue = (field: AutomationConditionField) =>
    field === "assignee" ? CONDITION_ANYONE : field === "from" ? fromOptions[0]?.value ?? "" : field === "source" ? LEAD_SOURCE_OPTIONS[0].value : "";
  const addCondition = (row: DraftRow) =>
    update(row.id, {
      conditions: [...row.conditions, { id: newColumnAutomationId(), field: "assignee", op: "is", value: CONDITION_ANYONE }],
    });
  const changeCondition = (row: DraftRow, id: string, patch: Partial<AutomationCondition>) =>
    update(row.id, { conditions: row.conditions.map((condition) => (condition.id === id ? { ...condition, ...patch } : condition)) });
  const removeCondition = (row: DraftRow, id: string) => {
    const at = row.conditions.findIndex((condition) => condition.id === id);
    const removed = row.conditions[at];
    update(row.id, { conditions: row.conditions.filter((condition) => condition.id !== id) });
    if (!removed) return;
    offerUndo("Condition removed", () =>
      setRows((prev) =>
        prev.map((item) =>
          item.id !== row.id || item.conditions.some((condition) => condition.id === id)
            ? item
            : { ...item, conditions: [...item.conditions.slice(0, at), removed, ...item.conditions.slice(at)] },
        ),
      ),
    );
  };

  const save = async () => {
    setTriedSave(true);
    if (hasProblem || saving) return;
    setSaving(true);
    setError("");
    const nowIso = new Date().toISOString();
    // A new or changed one is stamped now (a "has been in" one with no stay to count from counts from it).
    const fields = (row: DraftRow) =>
      JSON.stringify([
        row.action,
        row.trigger,
        row.amount,
        row.unit,
        [...row.notifyUids].sort(),
        [...row.notifyRoleIds].sort(),
        row.moveToStatus,
        row.moveToSubStage,
        row.moveAfter,
        row.moveCountFrom,
        row.moveToBoard,
        row.notifyAssignee,
        row.assignToUid,
        row.tagValue,
        row.conditions.map((condition) => [condition.field, condition.op, condition.value]),
      ]);
    // Anyone who's left the company, or a role since deleted, left off.
    const roleIds = new Set(roles.map((role) => automationRoleKey(role.id)));
    const memberIds = new Set((members ?? []).map((member) => member.uid));
    const tidy = (row: DraftRow): DraftRow => ({
      ...row,
      notifyUids: members ? row.notifyUids.filter((uid) => memberIds.has(uid)) : row.notifyUids,
      notifyRoleIds: roles.length ? row.notifyRoleIds.filter((id) => roleIds.has(id)) : row.notifyRoleIds,
      tagValue: row.tagValue.trim(),
      conditions: row.conditions.map((condition) => ({ ...condition, value: condition.value.trim() })),
    });
    const saved = rows.map(tidy).map((row) => {
      const before = original.find((item) => item.id === row.id);
      return before && fields(before) === fields(row) ? row : { ...row, updatedAtIso: nowIso };
    });
    const next = [
      ...automations.filter((row) => !(row.board === board && same(row.status, target.status) && same(row.subStage, target.subStage))),
      ...saved,
    ];
    const ok = await saveColumnAutomations(companyId, next);
    setSaving(false);
    if (!ok) {
      setError("Couldn't save — check your connection and try again.");
      return;
    }
    onSaved(next);
  };

  // Dev mode: the automation's notification, as it would read, to yourself (your Notifications, and your devices).
  const sendTest = async (row: DraftRow) => {
    if (!user?.uid) return;
    const text = columnAutomationNotificationText({
      board,
      event: row.trigger,
      itemName: board === "leads" ? "Jane Smith" : "Smith Kitchen",
      column,
      movedTo: "the next column",
      duration: columnAutomationDurationLabel(row),
    });
    const ok = await addUserNotification(user.uid, { ...text, type: COLUMN_AUTOMATION_NOTIFICATION_TYPE, companyId, devTest: true });
    setTestedId(ok ? row.id : "");
    if (ok) window.setTimeout(() => setTestedId((prev) => (prev === row.id ? "" : prev)), 2500);
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="glass-modal-backdrop fixed inset-0 z-[9000] flex items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Automate ${column}`}
        // A phone: the whole screen (as the other pop-ups — data-phone-fullscreen, app/globals.css). A big screen: wide
        // enough for each automation's sentence on one line.
        data-phone-fullscreen="true"
        className="glass-modal-panel relative flex h-full w-full flex-col overflow-hidden max-sm:rounded-none! max-sm:border-0! sm:h-auto sm:max-h-[min(760px,92vh)] sm:w-[min(680px,96vw)] lg:w-[min(1000px,94vw)]"
      >
        {/* As every pop-up's header (GlassModalHeader — the Schedule pop-up's): 56px, its icon and title in 14px bold
            capitals — the column it's for beside it; on a phone, under the notch. */}
        <div className="glass-modal-header flex h-[56px] shrink-0 items-center gap-3 px-5 max-sm:h-[calc(56px+env(safe-area-inset-top))] max-sm:pt-[env(safe-area-inset-top)]">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[var(--text-main)]">
            <Zap size={16} className="shrink-0" />
            <p className="shrink-0 text-[14px] font-bold uppercase tracking-[1px]">Automate</p>
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-[var(--text-muted)]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: target.color }} />
              <span className="truncate">{column}</span>
            </span>
          </div>
          <button type="button" onClick={onClose} className={modalCloseButtonClass} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </div>
        <div data-keyboard-scroll-pad="true" className="glass-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {rows.length === 0 ? (
            <p className="rounded-[14px] border border-dashed border-[var(--panel-border)] px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">
              No automations on {column}. Save to leave it with none.
            </p>
          ) : null}
          {rows.map((row) => {
            const problem = triedSave ? rowProblem(row) : "";
            // (Tagging's a project's.)
            const actionOptions = ACTION_OPTIONS.filter((option) => option.value !== "tag" || board === "projects");
            // What its conditions can look at — "the column it came from" only for one set off as it enters.
            const conditionFields = conditionFieldsFor(board).filter((field) => field !== "from" || row.trigger === "enters");
            const converts = row.action === "move" && board === "leads" && row.moveToBoard === "projects";
            // How long — a "has been in" one's, or a move's timer.
            const duration = (
              <>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={COLUMN_AUTOMATION_MAX_AMOUNT}
                  value={row.amount}
                  onChange={(e) =>
                    update(row.id, {
                      amount: Math.min(COLUMN_AUTOMATION_MAX_AMOUNT, Math.max(1, Math.round(Number(e.target.value) || 1))),
                    })
                  }
                  aria-label="How many"
                  autoComplete="cs-automation-amount"
                  className="h-9 w-[68px] rounded-full border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 text-center text-[13px] font-medium text-[var(--text-main)] outline-none transition focus:border-[var(--brand)]"
                />
                <GlassDropdown
                  value={row.unit}
                  options={UNIT_OPTIONS}
                  onChange={(value) => update(row.id, { unit: value as ColumnAutomationUnit })}
                  ariaLabel="Minutes, hours, days, weeks or months"
                  hideTriggerDot
                  menuMinWidth={130}
                  triggerClassName={PILL_CLASS}
                  triggerStyle={PILL_STYLE}
                />
              </>
            );
            const columnChip = (
              <span className="inline-flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-[var(--panel-border)] bg-[var(--panel-muted)] px-3.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: target.color }} />
                <span className="truncate">{column}</span>
              </span>
            );
            return (
              <div key={row.id} className="glass-shine glass-shine-neutral rounded-[16px] p-3.5">
                {/* The sentence, then its Test (dev mode, a notify one) and remove buttons at its end. */}
                <div className="flex items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-2 text-[13px] font-medium text-[var(--text-main)]">
                    <GlassDropdown
                      value={row.action}
                      options={actionOptions}
                      onChange={(value) => setAction(row, value as ColumnAutomationAction)}
                      ariaLabel="Notify, move, assign or tag"
                      hideTriggerDot
                      menuMinWidth={130}
                      triggerClassName={PILL_CLASS}
                      triggerStyle={PILL_STYLE}
                    />
                    {row.action === "move" ? (
                      <>
                        <span>a {thing} to</span>
                        <GlassDropdown
                          value={[row.moveToBoard, row.moveToStatus, row.moveToSubStage].join(COLUMN_KEY_SEP)}
                          options={moveOptions}
                          onChange={(value) => {
                            const [moveToBoard = board, moveToStatus = "", moveToSubStage = ""] = value.split(COLUMN_KEY_SEP);
                            update(row.id, { moveToBoard: moveToBoard as ColumnAutomationBoard, moveToStatus, moveToSubStage });
                          }}
                          ariaLabel="Move to"
                          menuMinWidth={260}
                          triggerClassName={PILL_CLASS}
                          triggerStyle={PILL_STYLE}
                        />
                        <span>when it enters</span>
                        {columnChip}
                        <GlassDropdown
                          value={row.moveAfter ? "after" : "now"}
                          options={TIMING_OPTIONS}
                          onChange={(value) => update(row.id, { moveAfter: value === "after" })}
                          ariaLabel="When to move it"
                          hideTriggerDot
                          menuMinWidth={150}
                          triggerClassName={PILL_CLASS}
                          triggerStyle={PILL_STYLE}
                        />
                        {row.moveAfter ? (
                          <>
                            {duration}
                            <GlassDropdown
                              value={row.moveCountFrom}
                              options={COUNT_FROM_OPTIONS}
                              onChange={(value) => update(row.id, { moveCountFrom: value === "movedIn" ? "movedIn" : "now" })}
                              ariaLabel="Count the time from"
                              hideTriggerDot
                              menuMinWidth={260}
                              triggerClassName={PILL_CLASS}
                              triggerStyle={PILL_STYLE}
                            />
                          </>
                        ) : null}
                      </>
                    ) : row.action === "assign" ? (
                      <>
                        <span>a {thing} to</span>
                        <GlassDropdown
                          value={row.assignToUid}
                          options={personOptions}
                          onChange={(assignToUid) => update(row.id, { assignToUid })}
                          ariaLabel="Assign to"
                          placeholder={members === null ? "Loading..." : "Choose someone"}
                          menuMinWidth={220}
                          triggerClassName={cn(PILL_CLASS, problem && !row.assignToUid ? "border-[var(--danger)]!" : "")}
                          triggerStyle={PILL_STYLE}
                        />
                        <span>when it enters</span>
                        {columnChip}
                      </>
                    ) : row.action === "tag" ? (
                      <>
                        <span>a {thing}</span>
                        <input
                          value={row.tagValue}
                          onChange={(e) => update(row.id, { tagValue: e.target.value.slice(0, 60) })}
                          placeholder="tag"
                          aria-label="Tag"
                          autoComplete="cs-automation-tag"
                          className={cn(
                            "h-9 w-[150px] rounded-full border bg-[var(--panel-bg)] px-3.5 text-[13px] font-medium text-[var(--text-main)] outline-none transition focus:border-[var(--brand)]",
                            problem && !row.tagValue.trim() ? "border-[var(--danger)]" : "border-[var(--panel-border)]",
                          )}
                        />
                        <span>when it enters</span>
                        {columnChip}
                      </>
                    ) : (
                      <>
                        <PeoplePicker
                          members={members}
                          roles={roles}
                          value={row.notifyUids}
                          roleValue={row.notifyRoleIds}
                          assignee={row.notifyAssignee}
                          thing={thing}
                          invalid={Boolean(problem) && !row.notifyUids.length && !row.notifyRoleIds.length && !row.notifyAssignee}
                          onChange={(notifyUids) => update(row.id, { notifyUids })}
                          onChangeRoles={(notifyRoleIds) => update(row.id, { notifyRoleIds })}
                          onChangeAssignee={(notifyAssignee) => update(row.id, { notifyAssignee })}
                        />
                        <span>when a {thing}</span>
                        <GlassDropdown
                          value={row.trigger}
                          options={TRIGGER_OPTIONS}
                          onChange={(value) => update(row.id, { trigger: value as ColumnAutomationTrigger })}
                          ariaLabel="When"
                          hideTriggerDot
                          menuMinWidth={150}
                          triggerClassName={PILL_CLASS}
                          triggerStyle={PILL_STYLE}
                        />
                        {columnChip}
                        {row.trigger === "stays" ? (
                          <>
                            <span>for</span>
                            {duration}
                          </>
                        ) : null}
                      </>
                    )}
                  </div>
                  <span className="flex h-9 shrink-0 items-center gap-1.5">
                    {devModeOn && row.action === "notify" ? (
                      <button type="button" onClick={() => void sendTest(row)} className={devButtonClass(testedId === row.id)} title="Send this notification to yourself">
                        {testedId === row.id ? "Sent" : "Test"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => removeRow(row)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                      aria-label="Remove automation"
                      title="Remove automation"
                    >
                      <Trash2 size={15} />
                    </button>
                  </span>
                </div>
                {/* A lead moved on to the Dashboard becomes a project there (lib/lead-convert-server.ts). */}
                {converts ? (
                  <div className="mt-2.5 flex items-start gap-2 pl-1">
                    <FolderPlus size={15} className="mt-0.5 shrink-0" style={{ color: "var(--brand-strong)" }} />
                    <p className="min-w-0 text-[13px] font-medium text-[var(--text-main)]">
                      and convert it to a project
                      <span className="block text-[11.5px] font-normal text-[var(--text-muted)]">
                        Its client, contact details, address, notes, photos and answers go onto the project, as Create Project
                        fills them in — and the lead&apos;s archived.
                      </span>
                    </p>
                  </div>
                ) : null}
                {/* A timed move counted from when each moved in: what's already there counts too — said before it's saved. */}
                {row.action === "move" && row.moveAfter && row.moveCountFrom === "movedIn" ? (
                  <div className="mt-2.5 flex items-start gap-2 pl-1">
                    <Clock size={15} className="mt-0.5 shrink-0" style={{ color: "var(--accent-amber)" }} />
                    <p className="min-w-0 text-[11.5px] font-normal text-[var(--text-muted)]">
                      {thing === "lead" ? "Leads" : "Projects"} already in {column} count too — any there longer than{" "}
                      {columnAutomationDurationLabel(row)} move on within a minute or so of saving. Changing the time later
                      applies to them all.
                    </p>
                  </div>
                ) : null}
                {/* But only if … and … */}
                <div className="mt-2.5 space-y-2">
                  {row.conditions.map((condition, index) => (
                    <div key={condition.id} className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[13px] font-medium text-[var(--text-main)]">
                      <span className="w-[84px] shrink-0 text-[var(--text-muted)]">{index === 0 ? "but only if" : "and"}</span>
                      <GlassDropdown
                        value={condition.field}
                        options={(conditionFields.includes(condition.field) ? conditionFields : [condition.field, ...conditionFields]).map((field) => ({
                          value: field,
                          label: CONDITION_FIELD_LABELS[field],
                        }))}
                        onChange={(value) => {
                          const field = value as AutomationConditionField;
                          changeCondition(row, condition.id, { field, op: conditionOpsFor(field)[0], value: conditionStartValue(field) });
                        }}
                        ariaLabel="What it looks at"
                        hideTriggerDot
                        menuMinWidth={210}
                        triggerClassName={PILL_CLASS}
                        triggerStyle={PILL_STYLE}
                      />
                      <GlassDropdown
                        value={condition.op}
                        options={conditionOpsFor(condition.field).map((op) => ({ value: op, label: CONDITION_OP_LABELS[op] }))}
                        onChange={(value) => changeCondition(row, condition.id, { op: value as AutomationConditionOp })}
                        ariaLabel="How"
                        hideTriggerDot
                        menuMinWidth={150}
                        triggerClassName={PILL_CLASS}
                        triggerStyle={PILL_STYLE}
                      />
                      {condition.field === "assignee" || condition.field === "from" || condition.field === "source" ? (
                        <GlassDropdown
                          value={condition.value}
                          options={
                            condition.field === "assignee"
                              ? [
                                  { value: CONDITION_ANYONE, label: "anyone" },
                                  { value: CONDITION_NOBODY, label: "nobody" },
                                  ...personOptions,
                                ]
                              : condition.field === "from"
                                ? fromOptions
                                : LEAD_SOURCE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))
                          }
                          onChange={(value) => changeCondition(row, condition.id, { value })}
                          ariaLabel="Which"
                          placeholder="Choose..."
                          hideTriggerDot={condition.field === "source"}
                          menuMinWidth={220}
                          triggerClassName={PILL_CLASS}
                          triggerStyle={PILL_STYLE}
                        />
                      ) : (
                        <input
                          value={condition.value}
                          onChange={(e) => changeCondition(row, condition.id, { value: e.target.value.slice(0, 120) })}
                          placeholder={condition.field === "tag" ? "tag" : "text"}
                          aria-label={condition.field === "tag" ? "Tag" : "Text"}
                          autoComplete="cs-automation-condition"
                          className={cn(
                            "h-9 w-[160px] rounded-full border bg-[var(--panel-bg)] px-3.5 text-[13px] font-medium text-[var(--text-main)] outline-none transition focus:border-[var(--brand)]",
                            problem && !condition.value.trim() ? "border-[var(--danger)]" : "border-[var(--panel-border)]",
                          )}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => removeCondition(row, condition.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                        aria-label="Take off this condition"
                        title="Take off this condition"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {row.conditions.length < 8 ? (
                    <button
                      type="button"
                      onClick={() => addCondition(row)}
                      className="inline-flex items-center gap-1 rounded-full px-1 text-[12px] font-medium text-[var(--brand-strong)] transition hover:underline"
                    >
                      <Plus size={13} strokeWidth={2.5} />
                      {row.conditions.length ? "And…" : "Only if…"}
                    </button>
                  ) : null}
                </div>
                {problem ? <p className="mt-2 text-[11.5px] font-medium text-[var(--danger)]">{problem}</p> : null}
              </div>
            );
          })}
          {/* Green glass (the glass shine), and under the pointer the app's green + buttons' own glass (glassShineStyle
              "#16A34A") fading in over it — neither with the glass's white edge. */}
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, newRow()])}
            className="group glass-shine relative flex h-11 w-full items-center justify-center overflow-hidden rounded-[14px] text-[13px] font-medium text-white"
            style={glassShineStyle(ADD_GREEN_LIGHT, { border: "none" })}
          >
            <span
              aria-hidden="true"
              className="glass-shine pointer-events-none absolute inset-0 rounded-[14px] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              style={glassShineStyle(ADD_GREEN, { border: "none" })}
            />
            <span className="relative inline-flex items-center gap-1.5">
              <Plus size={15} strokeWidth={2.5} />
              Add automation
            </span>
          </button>
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--glass-border)] px-5 py-3 max-sm:pb-[calc(12px+env(safe-area-inset-bottom))]">
          <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--danger)]">{error}</p>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-10 shrink-0 items-center rounded-full border border-[var(--panel-border)] bg-[var(--panel-bg)] px-4 text-[13px] font-medium text-[var(--text-main)] transition hover:bg-[var(--panel-muted)] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="glass-shine inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-5 text-[13px] font-medium text-white transition hover:brightness-105 disabled:opacity-60"
            style={glassShineStyle("var(--brand)")}
          >
            <Check size={15} strokeWidth={2.5} />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Who to notify: whole roles (everyone in one, when it's sent) and anyone in the company — their badges on the button,
// a searchable list to tick them in (roles first). Each by its name as it is now.
function PeoplePicker({
  members,
  roles,
  value,
  roleValue,
  assignee,
  thing,
  invalid,
  onChange,
  onChangeRoles,
  onChangeAssignee,
}: {
  members: CompanyMemberOption[] | null;
  roles: RoleRow[];
  value: string[];
  roleValue: string[];
  // The person it's assigned to (whoever that is when it's sent) — `thing`: "project" or "lead".
  assignee: boolean;
  thing: string;
  invalid: boolean;
  onChange: (uids: string[]) => void;
  onChangeRoles: (roleIds: string[]) => void;
  onChangeAssignee: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const roleOf = (id: string) => roles.find((role) => automationRoleKey(role.id) === id);
  const pickedRoles = roleValue.map(roleOf).filter((role): role is RoleRow => Boolean(role));
  const picked = value.map((uid) => (members ?? []).find((member) => member.uid === uid)).filter((member): member is CompanyMemberOption => Boolean(member));
  const peopleIn = (role: RoleRow) => (members ?? []).filter((member) => automationRoleKey(member.roleId || member.role) === automationRoleKey(role.id)).length;
  const query = search.trim().toLowerCase();
  const shownRoles = roles.filter((role) => !query || role.name.toLowerCase().includes(query));
  const shown = (members ?? []).filter((member) => !query || `${memberName(member)} ${member.email ?? ""}`.toLowerCase().includes(query));
  const pickedNames = [...(assignee ? ["Assigned person"] : []), ...pickedRoles.map((role) => role.name), ...picked.map(memberName)];
  const showAssignee = !query || "assigned person it's".includes(query);
  const assigneeBadge = (size = 24) => (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full text-white" style={{ width: size, height: size, backgroundImage: "var(--brand-gradient)" }}>
      <UserCheck size={size <= 22 ? 11 : 13} strokeWidth={2.5} />
    </span>
  );

  // Closes with a press elsewhere, Escape, a scroll (not its own list's) or a resize.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    const onScroll = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(300, window.innerWidth - 16);
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      setPos(
        below >= 340 || below >= above
          ? { left, width, top: rect.bottom + 4, maxHeight: below }
          : { left, width, bottom: window.innerHeight - rect.top + 4, maxHeight: above },
      );
    }
    setSearch("");
    setOpen(true);
  };

  // A row of the list: a role (its colour, everyone's icon) or a person (their initials), ticked or not.
  const optionRow = (input: { key: string; isOn: boolean; onToggle: () => void; badge: ReactNode; title: string; detail?: string }) => (
    <button
      key={input.key}
      type="button"
      role="option"
      aria-selected={input.isOn}
      onClick={input.onToggle}
      className={cn("flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12px] transition-colors", !input.isOn && "hover:bg-[var(--brand-soft)]")}
      style={input.isOn ? { backgroundImage: "var(--brand-gradient)" } : undefined}
    >
      {input.badge}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate font-medium", input.isOn ? "text-white" : "text-[var(--text-main)]")}>{input.title}</span>
        {input.detail ? (
          <span className={cn("block truncate text-[11px]", input.isOn ? "text-white/80" : "text-[var(--text-main)]")}>{input.detail}</span>
        ) : null}
      </span>
      <span
        className={cn(
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border",
          input.isOn ? "border-white bg-white text-[var(--brand)]" : "border-[var(--panel-border)]",
        )}
      >
        {input.isOn ? <Check size={11} strokeWidth={3} /> : null}
      </span>
    </button>
  );
  const roleBadge = (role: RoleRow, size = 24) => (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[7px] text-white"
      style={{ width: size, height: size, backgroundColor: role.color || "#7D99B3" }}
    >
      <Users size={size <= 22 ? 11 : 13} strokeWidth={2.5} />
    </span>
  );
  const sectionLabel = (text: string) => (
    <p className="px-2 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.8px] text-[var(--text-muted)] first:pt-1">{text}</p>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "inline-flex h-9 min-w-0 max-w-full items-center gap-2 rounded-full border px-2 pr-3 text-[13px] font-medium transition",
          invalid ? "border-[var(--danger)]" : "border-[var(--panel-border)] hover:border-[var(--brand)]",
        )}
        style={{ backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
      >
        {pickedNames.length ? (
          <>
            <span className="flex shrink-0 -space-x-1.5">
              {assignee ? <span className="rounded-full ring-2 ring-[var(--panel-bg)]">{assigneeBadge()}</span> : null}
              {pickedRoles.slice(0, 2).map((role) => (
                <span key={role.id} className="rounded-[8px] ring-2 ring-[var(--panel-bg)]">
                  {roleBadge(role)}
                </span>
              ))}
              {picked.slice(0, Math.max(0, 3 - Math.min(2, pickedRoles.length))).map((member) => (
                <span
                  key={member.uid}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-[var(--panel-bg)]"
                  style={{ backgroundColor: memberColor(member) }}
                >
                  {initialsOf(memberName(member))}
                </span>
              ))}
            </span>
            <span className="min-w-0 truncate">
              {pickedNames.length === 1 ? pickedNames[0] : `${pickedNames[0]} + ${pickedNames.length - 1} more`}
            </span>
          </>
        ) : (
          <span className="px-1.5 text-[var(--text-muted)]">
            {members === null && (value.length || roleValue.length) ? "Loading..." : "Choose who"}
          </span>
        )}
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed flex flex-col overflow-hidden rounded-[12px] border shadow-[var(--shadow-md)]"
              style={{ ...FLOATING_STYLE, left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: Math.min(380, pos.maxHeight) }}
            >
              <div className="relative shrink-0 border-b border-[var(--glass-border)] p-2">
                <Search size={13} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoComplete="cs-automation-people"
                  className="h-8 w-full rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-bg)] pl-7 pr-2 text-[12px] text-[var(--text-main)] outline-none transition focus:border-[var(--brand)]"
                  placeholder="Search staff and roles..."
                />
              </div>
              <div role="listbox" aria-multiselectable="true" className="glass-scroll min-h-0 flex-1 overflow-y-auto p-1">
                {members === null ? (
                  <SkeletonRows count={4} label="Loading staff" />
                ) : showAssignee || shownRoles.length || shown.length ? (
                  <>
                    {showAssignee
                      ? optionRow({
                          key: "assignee",
                          isOn: assignee,
                          onToggle: () => onChangeAssignee(!assignee),
                          badge: assigneeBadge(),
                          title: "The person it's assigned to",
                          detail: `Whoever the ${thing}'s assigned to at the time`,
                        })
                      : null}
                    {shownRoles.length ? sectionLabel("Roles") : null}
                    {shownRoles.map((role) => {
                      const id = automationRoleKey(role.id);
                      const isOn = roleValue.includes(id);
                      const count = peopleIn(role);
                      return optionRow({
                        key: `role_${id}`,
                        isOn,
                        onToggle: () => onChangeRoles(isOn ? roleValue.filter((roleId) => roleId !== id) : [...roleValue, id]),
                        badge: roleBadge(role),
                        title: role.name,
                        detail: count ? `Everyone in it — ${count} ${count === 1 ? "person" : "people"}` : "No one in it yet",
                      });
                    })}
                    {shown.length ? sectionLabel("People") : null}
                    {shown.map((member) => {
                      const isOn = value.includes(member.uid);
                      return optionRow({
                        key: member.uid,
                        isOn,
                        onToggle: () => onChange(isOn ? value.filter((uid) => uid !== member.uid) : [...value, member.uid]),
                        badge: (
                          <span
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                            style={{ backgroundColor: memberColor(member) }}
                          >
                            {initialsOf(memberName(member))}
                          </span>
                        ),
                        title: memberName(member),
                        detail: member.email,
                      });
                    })}
                  </>
                ) : (
                  <p className="px-2 py-3 text-center text-[12px] text-[var(--text-muted)]">No staff or roles found.</p>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
