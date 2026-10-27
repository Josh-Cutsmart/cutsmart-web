// Column automations: a board column (a Dashboard status, or one of its sub-stages; a Leads status) set — by someone
// whose role has projects.automate, from the column's right-click menu (components/column-automations.tsx) — to tell
// the people picked when a project (or lead) enters it, leaves it, or has been in it a while, or to move what enters
// it on to another column (straight away, or after a while):
//   Notify <people, roles, the person it's assigned to> when a project <enters | leaves | has been in> <column> [for <n> <unit>]
//   Move a project to <another column> when it enters <column> <straight away | after <n> <unit>>
//     (a lead's can go to one of the Dashboard's columns: and convert it to a project — lib/column-automations-server.ts)
//   Assign a project to <person> when it enters <column>
//   Tag a project <tag> when it enters <column> (projects only)
// each "but only if" any conditions it has all hold (automationConditionsMet): who it's assigned to, which column it came
// from, a tag it has, where a lead came from, what its name has in it. One whose conditions didn't hold as it entered
// waits (columnAutomationsWaiting, on the project or lead) — looked at again as what they look at changes (its
// assignee, tags or name — recheckWaitingColumnAutomations, app and server), and done then if they hold; given up as it
// leaves the column.
// Kept on the company doc (columnAutomations). Moves are told (and moved on) straight away — a project's from the app
// as it's moved (notifyColumnAutomationMove in lib/firestore-data.ts), a lead's by the server as it's changed
// (app/api/leads); a stay, and a move on a timer, by the notifications scheduled job (lib/column-automations-server.ts).
// Shared by the app and the server.

export type ColumnAutomationBoard = "projects" | "leads";
export type ColumnAutomationAction = "notify" | "move" | "assign" | "tag";
export type ColumnAutomationTrigger = "enters" | "leaves" | "stays";
export type ColumnAutomationUnit = "minutes" | "hours" | "days" | "weeks" | "months";
// A move on a timer: its time counted only for what enters from now on ("now" — what's in the column when it's set gets no
// timer, and a time changed later leaves the timers already going), or from when each moved in ("movedIn" — what's
// already there too, its timer from its real move-in, and a changed time applied to them all: see the scheduled job's
// COLUMN_AUTOMATION_BACKFILLS_FIELD).
export type ColumnAutomationCountFrom = "now" | "movedIn";

// "But only if": what a condition looks at, and how —
//   assignee  is / isn't  <person> | anyone (someone's assigned) | nobody (no one is)
//   from      is / isn't  <column> — the column it came from (one just created came from none)
//   tag       has / hasn't <tag> (a project's)
//   source    is / isn't  where a lead came in: one of the company's forms, its leads email inbox, Zapier, Create Lead
//   name      contains / doesn't contain <text>
export type AutomationConditionField = "assignee" | "from" | "tag" | "source" | "name";
export type AutomationConditionOp = "is" | "isNot" | "has" | "hasNot" | "contains" | "notContains";
export type AutomationCondition = { id: string; field: AutomationConditionField; op: AutomationConditionOp; value: string };
export const CONDITION_ANYONE = "__anyone__";
export const CONDITION_NOBODY = "__nobody__";
// A column as a condition's (or a dropdown's) value: its status and sub-stage, apart.
export const COLUMN_VALUE_SEP = "\u001f";
export const LEAD_SOURCE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "web-form", label: "a lead form" },
  { value: "email", label: "the leads email inbox" },
  { value: "zapier", label: "Zapier" },
  { value: "manual", label: "Create Lead" },
];
const CONDITION_FIELD_OPS: Record<AutomationConditionField, readonly AutomationConditionOp[]> = {
  assignee: ["is", "isNot"],
  from: ["is", "isNot"],
  tag: ["has", "hasNot"],
  source: ["is", "isNot"],
  name: ["contains", "notContains"],
};
// What each board's conditions can look at.
export function conditionFieldsFor(board: ColumnAutomationBoard): AutomationConditionField[] {
  return board === "leads" ? ["assignee", "from", "source", "name"] : ["assignee", "from", "tag", "name"];
}
export function conditionOpsFor(field: AutomationConditionField): readonly AutomationConditionOp[] {
  return CONDITION_FIELD_OPS[field];
}

export type ColumnAutomation = {
  id: string;
  board: ColumnAutomationBoard;
  // The column: its status, and (a Dashboard sub-column) its sub-stage — "" for the status's own column.
  status: string;
  subStage: string;
  // Notify people, or move what enters the column on to another (a move is always on entering).
  action: ColumnAutomationAction;
  trigger: ColumnAutomationTrigger;
  // "Has been in": for how long; a move with a timer (moveAfter): how long after it entered.
  amount: number;
  unit: ColumnAutomationUnit;
  // Who a notify one tells: people (by their user id) and whole roles (by the role's id — everyone in it when it's
  // sent). Ids, so a person or role renamed is still the same one.
  notifyUids: string[];
  notifyRoleIds: string[];
  // A move: the column it goes to (its status, and sub-stage — "" for the status's own column), and whether it waits.
  moveToStatus: string;
  moveToSubStage: string;
  moveAfter: boolean;
  // Its timer counted from now on, or from when each moved in (ColumnAutomationCountFrom).
  moveCountFrom: ColumnAutomationCountFrom;
  // Which board that column's on: its own — or, a lead's, the Dashboard's (the lead converted to a project as it goes).
  moveToBoard: ColumnAutomationBoard;
  // A notify one tells the person it's assigned to as well (whoever that is when it's sent).
  notifyAssignee: boolean;
  // An assign one: who it's assigned to.
  assignToUid: string;
  // A tag one: the tag it's given.
  tagValue: string;
  // "But only if" — every one of them.
  conditions: AutomationCondition[];
  createdByUid: string;
  updatedAtIso: string;
};

// What its conditions look at, on a project or lead, as it is now.
export type AutomationItemFacts = { assignedToUid: string; tags: string[]; source: string; name: string };

// Where something is on a board: its status, and its sub-stage ("" for none).
export type BoardSpot = { status: string; subStage: string };

export const COLUMN_AUTOMATION_NOTIFICATION_TYPE = "column_automation";

const HOUR_MS = 60 * 60 * 1000;
export const COLUMN_AUTOMATION_UNITS: readonly { value: ColumnAutomationUnit; one: string; many: string; ms: number }[] = [
  { value: "minutes", one: "minute", many: "minutes", ms: 60 * 1000 },
  { value: "hours", one: "hour", many: "hours", ms: HOUR_MS },
  { value: "days", one: "day", many: "days", ms: 24 * HOUR_MS },
  { value: "weeks", one: "week", many: "weeks", ms: 7 * 24 * HOUR_MS },
  { value: "months", one: "month", many: "months", ms: 30 * 24 * HOUR_MS },
];
export const COLUMN_AUTOMATION_MAX_AMOUNT = 365;

const str = (value: unknown) => String(value ?? "").trim();
const same = (a: unknown, b: unknown) => str(a).toLowerCase() === str(b).toLowerCase();
// A role's id as the company's roles keep it (lib/company-roles.ts's normalizeRoleKey).
export const automationRoleKey = (value: unknown) => str(value).toLowerCase().replace(/\s+/g, "_");

export function newColumnAutomationId(): string {
  return `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// The company doc's columnAutomations, as they're used — anything malformed left out.
export function normalizeColumnAutomations(raw: unknown): ColumnAutomation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => {
      const trigger = str(row.trigger);
      const unit = str(row.unit);
      const board = (str(row.board) === "leads" ? "leads" : "projects") as ColumnAutomationBoard;
      const rawAction = str(row.action);
      // (Tagging's a project's only.)
      const action = (
        rawAction === "move" || rawAction === "assign" || (rawAction === "tag" && board === "projects") ? rawAction : "notify"
      ) as ColumnAutomationAction;
      return {
        id: str(row.id),
        board,
        status: str(row.status),
        subStage: str(row.subStage),
        action,
        // (Only a notify one has a choice — the rest are on entering.)
        trigger: (action !== "notify" ? "enters" : trigger === "leaves" || trigger === "stays" ? trigger : "enters") as ColumnAutomationTrigger,
        amount: Math.min(COLUMN_AUTOMATION_MAX_AMOUNT, Math.max(1, Math.round(Number(row.amount) || 1))),
        unit: (COLUMN_AUTOMATION_UNITS.some((option) => option.value === unit) ? unit : "days") as ColumnAutomationUnit,
        notifyUids: Array.isArray(row.notifyUids) ? Array.from(new Set(row.notifyUids.map(str).filter(Boolean))) : [],
        notifyRoleIds: Array.isArray(row.notifyRoleIds) ? Array.from(new Set(row.notifyRoleIds.map(automationRoleKey).filter(Boolean))) : [],
        moveToStatus: str(row.moveToStatus),
        moveToSubStage: str(row.moveToSubStage),
        moveAfter: row.moveAfter === true,
        moveCountFrom: (str(row.moveCountFrom) === "movedIn" ? "movedIn" : "now") as ColumnAutomationCountFrom,
        moveToBoard: (board === "leads" && str(row.moveToBoard) === "projects" ? "projects" : board) as ColumnAutomationBoard,
        notifyAssignee: row.notifyAssignee === true,
        assignToUid: str(row.assignToUid),
        tagValue: str(row.tagValue).slice(0, 60),
        conditions: normalizeAutomationConditions(row.conditions, board),
        createdByUid: str(row.createdByUid),
        updatedAtIso: str(row.updatedAtIso),
      };
    })
    // (A move needs somewhere to go — not the column it's on; an assign, someone; a tag, its tag.)
    .filter(
      (row) =>
        row.id &&
        row.status &&
        (row.action !== "move" ||
          (row.moveToStatus && !(row.moveToBoard === row.board && same(row.moveToStatus, row.status) && same(row.moveToSubStage, row.subStage)))) &&
        (row.action !== "assign" || row.assignToUid) &&
        (row.action !== "tag" || row.tagValue),
    );
}

function normalizeAutomationConditions(raw: unknown, board: ColumnAutomationBoard): AutomationCondition[] {
  if (!Array.isArray(raw)) return [];
  const fields = conditionFieldsFor(board);
  return raw
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => {
      const field = str(row.field) as AutomationConditionField;
      const ops = fields.includes(field) ? CONDITION_FIELD_OPS[field] : [];
      const op = str(row.op) as AutomationConditionOp;
      return { id: str(row.id) || newColumnAutomationId(), field, op: ops.includes(op) ? op : ops[0], value: str(row.value).slice(0, 120) };
    })
    .filter((row) => fields.includes(row.field) && row.op && row.value)
    .slice(0, 8);
}

// Whether everything its conditions ask holds for this project or lead — `from`: the column it came from (none: it's
// new, or it's not a move that's asking).
export function automationConditionsMet(
  automation: Pick<ColumnAutomation, "conditions">,
  facts: AutomationItemFacts,
  from: BoardSpot | null,
): boolean {
  return automation.conditions.every((condition) => {
    const negate = condition.op === "isNot" || condition.op === "hasNot" || condition.op === "notContains";
    let holds: boolean;
    if (condition.field === "assignee") {
      const uid = str(facts.assignedToUid);
      holds = condition.value === CONDITION_ANYONE ? Boolean(uid) : condition.value === CONDITION_NOBODY ? !uid : uid === condition.value;
    } else if (condition.field === "from") {
      const [status = "", subStage = ""] = condition.value.split(COLUMN_VALUE_SEP);
      // A status's own column takes in its sub-stages (as a column's automations do).
      holds = Boolean(from) && same(from!.status, status) && (!subStage || same(from!.subStage, subStage));
    } else if (condition.field === "tag") {
      holds = facts.tags.some((tag) => same(tag, condition.value));
    } else if (condition.field === "source") {
      const source = str(facts.source).toLowerCase();
      // Zapier's is whatever isn't one of the others (as the "New Lead" notification reads it).
      holds = condition.value === "zapier" ? !["web-form", "email", "manual"].includes(source) : source === condition.value;
    } else {
      holds = str(facts.name).toLowerCase().includes(condition.value.toLowerCase());
    }
    return negate ? !holds : holds;
  });
}

// A project's or lead's facts for its automations' conditions (its stored fields).
export function automationItemFacts(data: Record<string, unknown>, name: string): AutomationItemFacts {
  return {
    assignedToUid: str(data.assignedToUid),
    tags: Array.isArray(data.tags) ? data.tags.map(str).filter(Boolean) : [],
    source: str(data.source),
    name,
  };
}

// Whether any of these automations has a condition, or needs to know who something's assigned to — so its facts are
// worth reading.
export function automationsNeedFacts(automations: ColumnAutomation[]): boolean {
  return automations.some((automation) => automation.conditions.length > 0 || automation.notifyAssignee);
}

// A column's own automations (its status's column, or exactly that sub-column).
export function columnAutomationsFor(automations: ColumnAutomation[], board: ColumnAutomationBoard, status: string, subStage = ""): ColumnAutomation[] {
  return automations.filter((row) => row.board === board && same(row.status, status) && same(row.subStage, subStage));
}

// Whether something at `spot` is in the automation's column: its status (a status's own column takes in all its
// sub-stages), and its sub-stage too for a sub-column.
export function isInAutomationColumn(automation: ColumnAutomation, spot: BoardSpot): boolean {
  if (!same(automation.status, spot.status)) return false;
  return !automation.subStage || same(automation.subStage, spot.subStage);
}

// What a move sets off: the automations of the columns it left and of the ones it went into. `from` null: it's new
// (created straight into `to`) — only "enters" ones.
export function automationsSetOffByMove(
  automations: ColumnAutomation[],
  board: ColumnAutomationBoard,
  from: BoardSpot | null,
  to: BoardSpot,
): Array<{ automation: ColumnAutomation; event: "enters" | "leaves" }> {
  const result: Array<{ automation: ColumnAutomation; event: "enters" | "leaves" }> = [];
  for (const automation of automations) {
    if (automation.board !== board || automation.action !== "notify" || automation.trigger === "stays" || !hasColumnAutomationRecipients(automation)) continue;
    const wasIn = from ? isInAutomationColumn(automation, from) : false;
    const isIn = isInAutomationColumn(automation, to);
    if (automation.trigger === "enters" && isIn && !wasIn) result.push({ automation, event: "enters" });
    if (automation.trigger === "leaves" && wasIn && !isIn) result.push({ automation, event: "leaves" });
  }
  return result;
}

// Whether a notify one has anyone to tell (a person, a role, or the person it's assigned to).
export function hasColumnAutomationRecipients(
  automation: Pick<ColumnAutomation, "notifyUids" | "notifyRoleIds"> & { notifyAssignee?: boolean },
): boolean {
  return automation.notifyUids.length > 0 || automation.notifyRoleIds.length > 0 || automation.notifyAssignee === true;
}

// Everyone a notify one tells: its people, everyone whose role (their role id) is one of its roles — as the company is
// now (`members`: each person's user id and role id) — and the person it's assigned to (`assigneeUid`), if it says to.
export function columnAutomationRecipients(
  automation: Pick<ColumnAutomation, "notifyUids" | "notifyRoleIds"> & { notifyAssignee?: boolean },
  members: Array<{ uid: string; roleId?: string }>,
  assigneeUid = "",
): string[] {
  const roles = new Set(automation.notifyRoleIds.map(automationRoleKey));
  const fromRoles = roles.size ? members.filter((member) => roles.has(automationRoleKey(member.roleId))).map((member) => member.uid) : [];
  const assignee = automation.notifyAssignee ? [str(assigneeUid)] : [];
  return Array.from(new Set([...automation.notifyUids, ...fromRoles, ...assignee].filter(Boolean)));
}

// The move a move sets off: the first move automation of a column it went into whose conditions hold (`facts`; none
// given: conditions aren't looked at), or none.
export function columnMoveSetOffByMove(
  automations: ColumnAutomation[],
  board: ColumnAutomationBoard,
  from: BoardSpot | null,
  to: BoardSpot,
  facts?: AutomationItemFacts,
): ColumnAutomation | null {
  return (
    automations.find(
      (automation) =>
        automation.board === board &&
        automation.action === "move" &&
        isInAutomationColumn(automation, to) &&
        !(from && isInAutomationColumn(automation, from)) &&
        (!facts || automationConditionsMet(automation, facts, from)),
    ) ?? null
  );
}

// The assign and tag automations a move sets off: those of the columns it went into, whose conditions hold.
export function columnActionsSetOffByMove(
  automations: ColumnAutomation[],
  board: ColumnAutomationBoard,
  from: BoardSpot | null,
  to: BoardSpot,
  facts: AutomationItemFacts,
): ColumnAutomation[] {
  return automations.filter(
    (automation) =>
      automation.board === board &&
      (automation.action === "assign" || automation.action === "tag") &&
      isInAutomationColumn(automation, to) &&
      !(from && isInAutomationColumn(automation, from)) &&
      automationConditionsMet(automation, facts, from),
  );
}

export function columnMoveTarget(automation: ColumnAutomation): BoardSpot {
  return { status: automation.moveToStatus, subStage: automation.moveToSubStage };
}

// A move waiting on its timer, kept on the project or lead (its due time also on its own, to be looked up by): where it
// was going from and to, which automation, and when.
export type ScheduledColumnMove = {
  automationId: string;
  fromStatus: string;
  fromSubStage: string;
  toStatus: string;
  toSubStage: string;
  dueAtIso: string;
  setAtIso: string;
  // Whoever's move set its timer off — told when it moves (not before).
  byUid?: string;
};
export const SCHEDULED_COLUMN_MOVE_FIELD = "scheduledColumnMove";
export const SCHEDULED_COLUMN_MOVE_DUE_FIELD = "scheduledColumnMoveDueAtIso";
// How many moves one move can set off one after the other (A → B → C …) before it stops — so two columns moving
// things to each other can't go round for ever.
export const COLUMN_MOVE_CHAIN_LIMIT = 4;

// `startedMs`: when its time in the column began (a move that waited on its conditions: when it entered) — now if not given.
export function scheduledColumnMoveFor(
  automation: ColumnAutomation,
  from: BoardSpot,
  nowMs: number,
  startedMs = nowMs,
  byUid = "",
): ScheduledColumnMove {
  return {
    automationId: automation.id,
    fromStatus: from.status,
    fromSubStage: from.subStage,
    toStatus: automation.moveToStatus,
    toSubStage: automation.moveToSubStage,
    dueAtIso: new Date(startedMs + columnAutomationStayMs(automation)).toISOString(),
    setAtIso: new Date(nowMs).toISOString(),
    ...(byUid ? { byUid } : {}),
  };
}

// Waiting on its conditions: an automation of the column something's in that it entered while they didn't hold — by the
// automation's id: when it entered, and from which column (for a "came from" condition). Kept on the project or lead
// (WAITING_COLUMN_AUTOMATIONS_FIELD — HAS_WAITING_FIELD alongside it, true while there are any, for the scheduled job to
// find them by), replaced each time it moves.
export type WaitingColumnAutomation = { atIso: string; fromStatus: string; fromSubStage: string };
export const WAITING_COLUMN_AUTOMATIONS_FIELD = "columnAutomationsWaiting";
export const HAS_WAITING_COLUMN_AUTOMATIONS_FIELD = "hasWaitingColumnAutomations";

export function normalizeWaitingColumnAutomations(raw: unknown): Record<string, WaitingColumnAutomation> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, WaitingColumnAutomation> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const row = (value ?? {}) as Record<string, unknown>;
    if (!str(id) || !str(row.atIso)) continue;
    result[id] = { atIso: str(row.atIso), fromStatus: str(row.fromStatus), fromSubStage: str(row.fromSubStage) };
  }
  return result;
}

// Every automation a move into `to` sets off — notify ones (on entering), assign, tag and move ones — whatever their
// conditions: those that didn't hold wait.
export function columnAutomationsEnteredBy(
  automations: ColumnAutomation[],
  board: ColumnAutomationBoard,
  from: BoardSpot | null,
  to: BoardSpot,
): ColumnAutomation[] {
  return automations.filter(
    (automation) =>
      automation.board === board &&
      (automation.action === "notify" ? automation.trigger === "enters" && hasColumnAutomationRecipients(automation) : true) &&
      isInAutomationColumn(automation, to) &&
      !(from && isInAutomationColumn(automation, from)),
  );
}

// What waits after a move: those of `entered` whose conditions don't hold (with the facts as they ended up).
export function waitingAfterMove(
  entered: ColumnAutomation[],
  facts: AutomationItemFacts,
  from: BoardSpot | null,
  atIso: string,
): Record<string, WaitingColumnAutomation> {
  const waiting: Record<string, WaitingColumnAutomation> = {};
  for (const automation of entered) {
    if (automation.conditions.length && !automationConditionsMet(automation, facts, from)) {
      waiting[automation.id] = { atIso, fromStatus: from?.status ?? "", fromSubStage: from?.subStage ?? "" };
    }
  }
  return waiting;
}

// Of what's waiting, those that can be done now (still in their column, their conditions holding — in the order assign
// and tag, notify, move: as a move does them), and those that still wait. Any whose automation's gone, or whose column
// it's left, drops out.
export function readyWaitingColumnAutomations(
  automations: ColumnAutomation[],
  board: ColumnAutomationBoard,
  waiting: Record<string, WaitingColumnAutomation>,
  here: BoardSpot,
  facts: AutomationItemFacts,
): {
  ready: Array<{ automation: ColumnAutomation; entry: WaitingColumnAutomation; from: BoardSpot | null }>;
  still: Record<string, WaitingColumnAutomation>;
} {
  const ready: Array<{ automation: ColumnAutomation; entry: WaitingColumnAutomation; from: BoardSpot | null }> = [];
  const still: Record<string, WaitingColumnAutomation> = {};
  for (const [id, entry] of Object.entries(waiting)) {
    const automation = automations.find((row) => row.id === id && row.board === board);
    if (!automation || !isInAutomationColumn(automation, here)) continue;
    const from = entry.fromStatus ? { status: entry.fromStatus, subStage: entry.fromSubStage } : null;
    if (automationConditionsMet(automation, facts, from)) ready.push({ automation, entry, from });
    else still[id] = entry;
  }
  const rank = (action: ColumnAutomationAction) => (action === "assign" || action === "tag" ? 0 : action === "notify" ? 1 : 2);
  ready.sort((a, b) => rank(a.automation.action) - rank(b.automation.action));
  return { ready, still };
}

export function columnAutomationStayMs(automation: Pick<ColumnAutomation, "amount" | "unit">): number {
  const unit = COLUMN_AUTOMATION_UNITS.find((option) => option.value === automation.unit) ?? COLUMN_AUTOMATION_UNITS[1];
  return automation.amount * unit.ms;
}

export function columnAutomationDurationLabel(automation: Pick<ColumnAutomation, "amount" | "unit">): string {
  const unit = COLUMN_AUTOMATION_UNITS.find((option) => option.value === automation.unit) ?? COLUMN_AUTOMATION_UNITS[1];
  return `${automation.amount} ${automation.amount === 1 ? unit.one : unit.many}`;
}

// A column's name as the notification says it: "Production › Assembly" for a sub-column.
export function columnAutomationColumnLabel(spot: { status: string; subStage?: string }): string {
  return spot.subStage ? `${spot.status} › ${spot.subStage}` : spot.status;
}

// The timed moves counted from when each moved in that have had their column gone through for the time they have now —
// on the company, by the automation's id: its updatedAtIso when it was (a new or changed one: not yet — the scheduled
// job goes through its column, giving everything there its timer from its real move-in, then notes it here).
export const COLUMN_AUTOMATION_BACKFILLS_FIELD = "columnAutomationBackfills";

// When a project or lead's stay in an automation's column began: a project's from its status history, a lead's from when
// its status last changed (or it was added). "" — it can't be told.
export function itemStayStartedAtIso(automation: ColumnAutomation, data: Record<string, unknown>): string {
  if (automation.board === "leads") return str(data.statusChangedAtIso) || str(data.createdAtIso);
  return stayStartedAtIso(automation, Array.isArray(data.statusHistory) ? (data.statusHistory as Array<Record<string, unknown>>) : []);
}

// When something went into the column it's in now (the start of its stay there), from its status history (oldest
// first or not — sorted here): the earliest of the unbroken run of entries at the end that are in the column. None
// (no history of it): "".
export function stayStartedAtIso(
  automation: ColumnAutomation,
  history: Array<{ status?: unknown; subStage?: unknown; atIso?: unknown }>,
): string {
  const rows = history
    .map((row) => ({ status: str(row.status), subStage: str(row.subStage), atIso: str(row.atIso) }))
    .filter((row) => row.status && Number.isFinite(Date.parse(row.atIso)))
    .sort((a, b) => Date.parse(a.atIso) - Date.parse(b.atIso));
  let started = "";
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (!isInAutomationColumn(automation, rows[index])) break;
    started = rows[index].atIso;
  }
  return started;
}

// The notification's words: "Moved into Production" — "Smith Kitchen" moved into Production.
// Whoever moved something, told of the move automation their move set off once it's moved on — straight away, or when
// its timer's up (never ahead of it) — just where it is now, in a notify rule's own words: "Moved into Site Measure".
// A lead moved on to the Dashboard (`converts`) becomes a project as it goes.
export function columnAutomationMoveNoticeText(input: {
  board: ColumnAutomationBoard;
  itemName: string;
  column: string;
  movedTo: string;
  converts?: boolean;
}): { title: string; message: string } {
  const thing = input.board === "leads" ? `The lead "${input.itemName}"` : `"${input.itemName}"`;
  return {
    title: `Moved into ${input.movedTo}`,
    message: input.converts ? `${thing} moved into ${input.movedTo} and became a project.` : `${thing} moved into ${input.movedTo}.`,
  };
}

// Someone an assign automation assigned something to, told.
export function columnAutomationAssignedText(input: { board: ColumnAutomationBoard; itemName: string; column: string }): {
  title: string;
  message: string;
} {
  return input.board === "leads"
    ? { title: "Added to a lead", message: `The lead "${input.itemName}" was assigned to you — ${input.column}'s automation.` }
    : { title: "Assigned to a project", message: `"${input.itemName}" was assigned to you — ${input.column}'s automation.` };
}

export function columnAutomationNotificationText(input: {
  board: ColumnAutomationBoard;
  event: ColumnAutomationTrigger;
  itemName: string;
  column: string;
  // A move out: where it went.
  movedTo?: string;
  // A stay: for how long (its automation's).
  duration?: string;
}): { title: string; message: string } {
  const thing = input.board === "leads" ? `The lead "${input.itemName}"` : `"${input.itemName}"`;
  if (input.event === "leaves") {
    return {
      title: `Moved out of ${input.column}`,
      message: `${thing} moved out of ${input.column}${input.movedTo ? ` — now in ${input.movedTo}` : ""}.`,
    };
  }
  if (input.event === "stays") {
    return { title: `Still in ${input.column}`, message: `${thing} has been in ${input.column} for ${input.duration || "a while"}.` };
  }
  return { title: `Moved into ${input.column}`, message: `${thing} moved into ${input.column}.` };
}
