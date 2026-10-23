// Column automations: a board column (a Dashboard status, or one of its sub-stages; a Leads status) set — by someone
// whose role has projects.automate, from the column's right-click menu (components/column-automations.tsx) — to tell
// the people picked when a project (or lead) enters it, leaves it, or has been in it a while, or to move what enters
// it on to another column (straight away, or after a while):
//   Notify <people> when a project <enters | leaves | has been in> <column> [for <n> <unit>]
//   Move a project to <another column> when it enters <column> <straight away | after <n> <unit>>
// Kept on the company doc (columnAutomations). Moves are told (and moved on) straight away — a project's from the app
// as it's moved (notifyColumnAutomationMove in lib/firestore-data.ts), a lead's by the server as it's changed
// (app/api/leads); a stay, and a move on a timer, by the notifications scheduled job (lib/column-automations-server.ts).
// Shared by the app and the server.

export type ColumnAutomationBoard = "projects" | "leads";
export type ColumnAutomationAction = "notify" | "move";
export type ColumnAutomationTrigger = "enters" | "leaves" | "stays";
export type ColumnAutomationUnit = "minutes" | "hours" | "days" | "weeks" | "months";

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
  createdByUid: string;
  updatedAtIso: string;
};

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
      const action = (str(row.action) === "move" ? "move" : "notify") as ColumnAutomationAction;
      return {
        id: str(row.id),
        board: (str(row.board) === "leads" ? "leads" : "projects") as ColumnAutomationBoard,
        status: str(row.status),
        subStage: str(row.subStage),
        action,
        trigger: (action === "move" ? "enters" : trigger === "leaves" || trigger === "stays" ? trigger : "enters") as ColumnAutomationTrigger,
        amount: Math.min(COLUMN_AUTOMATION_MAX_AMOUNT, Math.max(1, Math.round(Number(row.amount) || 1))),
        unit: (COLUMN_AUTOMATION_UNITS.some((option) => option.value === unit) ? unit : "days") as ColumnAutomationUnit,
        notifyUids: Array.isArray(row.notifyUids) ? Array.from(new Set(row.notifyUids.map(str).filter(Boolean))) : [],
        notifyRoleIds: Array.isArray(row.notifyRoleIds) ? Array.from(new Set(row.notifyRoleIds.map(automationRoleKey).filter(Boolean))) : [],
        moveToStatus: str(row.moveToStatus),
        moveToSubStage: str(row.moveToSubStage),
        moveAfter: row.moveAfter === true,
        createdByUid: str(row.createdByUid),
        updatedAtIso: str(row.updatedAtIso),
      };
    })
    // (A move needs somewhere to go — not the column it's on.)
    .filter(
      (row) =>
        row.id &&
        row.status &&
        (row.action !== "move" || (row.moveToStatus && !(same(row.moveToStatus, row.status) && same(row.moveToSubStage, row.subStage)))),
    );
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

// Whether a notify one has anyone to tell (a person, or a role).
export function hasColumnAutomationRecipients(automation: Pick<ColumnAutomation, "notifyUids" | "notifyRoleIds">): boolean {
  return automation.notifyUids.length > 0 || automation.notifyRoleIds.length > 0;
}

// Everyone a notify one tells: its people, and everyone whose role (their role id) is one of its roles — as the company
// is now (`members`: each person's user id and role id).
export function columnAutomationRecipients(
  automation: Pick<ColumnAutomation, "notifyUids" | "notifyRoleIds">,
  members: Array<{ uid: string; roleId?: string }>,
): string[] {
  const roles = new Set(automation.notifyRoleIds.map(automationRoleKey));
  const fromRoles = roles.size ? members.filter((member) => roles.has(automationRoleKey(member.roleId))).map((member) => member.uid) : [];
  return Array.from(new Set([...automation.notifyUids, ...fromRoles].filter(Boolean)));
}

// The move a move sets off: the first move automation of a column it went into (one per column), or none.
export function columnMoveSetOffByMove(
  automations: ColumnAutomation[],
  board: ColumnAutomationBoard,
  from: BoardSpot | null,
  to: BoardSpot,
): ColumnAutomation | null {
  return (
    automations.find(
      (automation) =>
        automation.board === board &&
        automation.action === "move" &&
        isInAutomationColumn(automation, to) &&
        !(from && isInAutomationColumn(automation, from)),
    ) ?? null
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
};
export const SCHEDULED_COLUMN_MOVE_FIELD = "scheduledColumnMove";
export const SCHEDULED_COLUMN_MOVE_DUE_FIELD = "scheduledColumnMoveDueAtIso";
// How many moves one move can set off one after the other (A → B → C …) before it stops — so two columns moving
// things to each other can't go round for ever.
export const COLUMN_MOVE_CHAIN_LIMIT = 4;

export function scheduledColumnMoveFor(automation: ColumnAutomation, from: BoardSpot, nowMs: number): ScheduledColumnMove {
  return {
    automationId: automation.id,
    fromStatus: from.status,
    fromSubStage: from.subStage,
    toStatus: automation.moveToStatus,
    toSubStage: automation.moveToSubStage,
    dueAtIso: new Date(nowMs + columnAutomationStayMs(automation)).toISOString(),
    setAtIso: new Date(nowMs).toISOString(),
  };
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
// Whoever moved something, told of the move automation their move set off: that it's moved on (straight away), or will
// (on a timer — `after`: how long).
export function columnAutomationMoveNoticeText(input: {
  board: ColumnAutomationBoard;
  itemName: string;
  column: string;
  movedTo: string;
  after?: string;
}): { title: string; message: string } {
  const thing = input.board === "leads" ? `The lead "${input.itemName}"` : `"${input.itemName}"`;
  if (input.after) {
    return {
      title: `Moving on to ${input.movedTo}`,
      message: `${thing} will move on from ${input.column} to ${input.movedTo} in ${input.after} — ${input.column}'s automation.`,
    };
  }
  return { title: `Moved on to ${input.movedTo}`, message: `${thing} was moved on from ${input.column} to ${input.movedTo} by ${input.column}'s automation.` };
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
