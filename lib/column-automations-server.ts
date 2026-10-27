import { FieldPath, FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  automationConditionsMet,
  automationItemFacts,
  automationsSetOffByMove,
  columnActionsSetOffByMove,
  columnAutomationAssignedText,
  columnAutomationsEnteredBy,
  columnAutomationColumnLabel,
  columnAutomationRecipients,
  columnAutomationDurationLabel,
  columnAutomationMoveNoticeText,
  columnAutomationNotificationText,
  columnAutomationStayMs,
  columnMoveSetOffByMove,
  columnMoveTarget,
  COLUMN_AUTOMATION_BACKFILLS_FIELD,
  COLUMN_AUTOMATION_NOTIFICATION_TYPE,
  COLUMN_MOVE_CHAIN_LIMIT,
  hasColumnAutomationRecipients,
  HAS_WAITING_COLUMN_AUTOMATIONS_FIELD,
  isInAutomationColumn,
  itemStayStartedAtIso,
  normalizeColumnAutomations,
  normalizeWaitingColumnAutomations,
  readyWaitingColumnAutomations,
  SCHEDULED_COLUMN_MOVE_DUE_FIELD,
  SCHEDULED_COLUMN_MOVE_FIELD,
  scheduledColumnMoveFor,
  WAITING_COLUMN_AUTOMATIONS_FIELD,
  waitingAfterMove,
  type AutomationItemFacts,
  type BoardSpot,
  type ColumnAutomation,
  type ColumnAutomationBoard,
} from "@/lib/column-automations";
import { convertLeadToProject } from "@/lib/lead-convert-server";
import { isBonusPeriodKey } from "@/lib/completion-bonus";
import { leadNameForNotification } from "@/lib/lead-notify-server";
import { completedStatusMatcher, normalizeProjectArchiveDelay } from "@/lib/project-archive";
import { addNotificationAndPush, isCompanyMemberUid } from "@/lib/push-server";

// The server's side of column automations (lib/column-automations.ts):
// - a lead moved between the Leads board's columns (app/api/leads), or new into one (lib/lead-notify-server.ts): the
//   people its columns' "enters" / "leaves" automations name, told — and moved on, if the column it went into moves
//   things (straight away, or its timer started);
// - "has been in <column> for <n> <unit>": looked for by the notifications scheduled job (app/api/cron/notifications)
//   — each project or lead told about once per stay, the stay remembered on it (columnAutomationsSent.{automation id} =
//   when that stay began), so a later stay in the same column is told again;
// - a move on a timer (a project's started by the app as it's moved — lib/firestore-data.ts): carried out by the same
//   job once it's due, if the project or lead is still in the column it was started from — told, and moved on again,
//   as any move; one counted from when each moved in (moveCountFrom "movedIn"), new or changed: its column gone through
//   first (backfillCountFromMoveIn), everything there given its timer from its real move-in;
// - a lead moved on to one of the Dashboard's columns: converted to a project there (lib/lead-convert-server.ts) — the
//   project's own column automations then, as any project new into a column;
// - assign and tag automations: done as something enters their column, before it's told (so "the person it's
//   assigned to" is whoever it was just assigned to) and moved on.
// Each automation only if its conditions hold (automationConditionsMet) — a timed move's when it entered (its timer only
// started then), not again when it's due. One whose conditions didn't hold as it entered waits (on it — lib/
// column-automations.ts), looked at again as what they look at changes (recheckWaitingColumnAutomations: a lead's
// assignee or details changed — app/api/leads; and the scheduled job, for any change made anywhere else).

const str = (value: unknown) => String(value ?? "").trim();
const same = (a: unknown, b: unknown) => str(a).toLowerCase() === str(b).toLowerCase();

// "Has been in" is looked for at most this often (its smallest unit's a minute, but a stay's rarely that short):
// jobRuns/columnAutomationStays remembers when.
const CHECK_AT_MOST_EVERY_MS = 10 * 60 * 1000;

// One company's run: its doc and automations, who's been found to be in it, and (once a role's to be told) everyone's
// role — this run only.
type Ctx = {
  db: FirebaseFirestore.Firestore;
  companyId: string;
  companyData: Record<string, unknown>;
  automations: ColumnAutomation[];
  siteOrigin: string;
  members: Map<string, boolean>;
  memberRoles: Array<{ uid: string; roleId: string }> | null;
  // A lead this run converted to a project: the project (app/api/leads tells the board).
  convertedProjectId?: string;
};

async function contextFor(companyId: string, siteOrigin: string, companyData?: Record<string, unknown>): Promise<Ctx | null> {
  if (!adminDb || !companyId) return null;
  const data = companyData ?? ((await adminDb.collection("companies").doc(companyId).get()).data() ?? {});
  return {
    db: adminDb,
    companyId,
    companyData: data,
    automations: normalizeColumnAutomations(data.columnAutomations),
    siteOrigin,
    members: new Map(),
    memberRoles: null,
  };
}

async function isMember(ctx: Pick<Ctx, "companyId" | "members">, uid: string): Promise<boolean> {
  if (!ctx.members.has(uid)) ctx.members.set(uid, await isCompanyMemberUid(ctx.companyId, uid));
  return ctx.members.get(uid)!;
}

// Everyone a notify one tells, as the company is now: its people (still in it), and everyone in its roles — each
// member's role as the company has it (Company Settings' staffRoleIdsByUid, else their membership's).
async function recipientsOf(ctx: Ctx, automation: ColumnAutomation, assigneeUid = ""): Promise<string[]> {
  if (automation.notifyRoleIds.length && !ctx.memberRoles) {
    const overrides = (ctx.companyData.staffRoleIdsByUid ?? {}) as Record<string, unknown>;
    const memberships = await ctx.db.collection("companies").doc(ctx.companyId).collection("memberships").get().catch(() => null);
    ctx.memberRoles = (memberships?.docs ?? []).map((snap) => {
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      const uid = str(data.uid) || snap.id;
      // (A membership doc is being in the company.)
      ctx.members.set(uid, true);
      return { uid, roleId: str(overrides[uid] ?? data.roleId ?? data.role) };
    });
  }
  const recipients: string[] = [];
  for (const uid of columnAutomationRecipients(automation, ctx.memberRoles ?? [], assigneeUid)) {
    if (await isMember(ctx, uid)) recipients.push(uid);
  }
  return recipients;
}

// Its columns' "enters" / "leaves" automations' people, told — and whoever moved it too (once), so they know what their
// move set off (none, for one the scheduled job made). Not them for a move an automation made straight after theirs
// (depth): afterMove's tellActor tells them that, where it went — not twice.
async function tellMove(
  ctx: Ctx,
  board: ColumnAutomationBoard,
  item: { id: string; name: string },
  from: BoardSpot | null,
  to: BoardSpot,
  depth: number,
  facts: AutomationItemFacts,
  actorUid?: string,
) {
  for (const { automation, event } of automationsSetOffByMove(ctx.automations, board, from, to)) {
    if (!automationConditionsMet(automation, facts, from)) continue;
    const text = columnAutomationNotificationText({
      board,
      event,
      itemName: item.name,
      column: columnAutomationColumnLabel(automation),
      movedTo: columnAutomationColumnLabel(to),
    });
    const recipients = new Set(await recipientsOf(ctx, automation, facts.assignedToUid));
    if (actorUid && depth > 0) recipients.delete(actorUid);
    else if (actorUid && (await isMember(ctx, actorUid))) recipients.add(actorUid);
    for (const uid of recipients) {
      await addNotificationAndPush(
        uid,
        { ...text, type: COLUMN_AUTOMATION_NOTIFICATION_TYPE, ...(board === "leads" ? { leadId: item.id } : { projectId: item.id }), companyId: ctx.companyId },
        ctx.siteOrigin,
      );
    }
  }
}

// Moved (or new — `from` null): told, then moved on if the column it went into moves things — straight away (another
// move, as far as COLUMN_MOVE_CHAIN_LIMIT), or its timer started (kept on it); whoever moved it told it has, or will.
// Where it ended up.
async function afterMove(
  ctx: Ctx,
  board: ColumnAutomationBoard,
  ref: DocumentReference,
  item: { id: string; name: string },
  from: BoardSpot | null,
  to: BoardSpot,
  depth: number,
  actorUid?: string,
  knownData?: Record<string, unknown>,
): Promise<BoardSpot> {
  // (Its stored fields — what its conditions look at — read now, unless whoever moved it has them already.)
  const data = knownData ?? (((await ref.get().catch(() => null))?.data() ?? {}) as Record<string, unknown>);
  let facts = automationItemFacts(data, item.name);
  facts = await runColumnActions(ctx, board, ref, item, from, to, facts, actorUid);
  await tellMove(ctx, board, item, from, to, depth, facts, actorUid);
  // What waits on its conditions in this column (those that didn't hold) — instead of what waited in the one it left.
  const waiting = waitingAfterMove(columnAutomationsEnteredBy(ctx.automations, board, from, to), facts, from, new Date().toISOString());
  if (Object.keys(waiting).length || data[HAS_WAITING_COLUMN_AUTOMATIONS_FIELD] === true) {
    await ref
      .update({ [WAITING_COLUMN_AUTOMATIONS_FIELD]: waiting, [HAS_WAITING_COLUMN_AUTOMATIONS_FIELD]: Object.keys(waiting).length > 0 })
      .catch(() => undefined);
  }
  const rule = columnMoveSetOffByMove(ctx.automations, board, from, to, facts);
  if (!rule) return to;
  // A lead moved on to the Dashboard: made into a project there.
  const converts = board === "leads" && rule.moveToBoard === "projects";
  const tellActor = (projectId = "") => tellMoveNotice(ctx, board, item, to, rule, actorUid, projectId);
  if (rule.moveAfter) {
    // (Its timer started — whoever set it off told when it moves, by the scheduled job, not now.)
    const scheduled = scheduledColumnMoveFor(rule, to, Date.now(), undefined, actorUid);
    await ref
      .update({ [SCHEDULED_COLUMN_MOVE_FIELD]: scheduled, [SCHEDULED_COLUMN_MOVE_DUE_FIELD]: scheduled.dueAtIso })
      .catch(() => undefined);
    return to;
  }
  if (depth >= COLUMN_MOVE_CHAIN_LIMIT) return to;
  if (converts) {
    const projectId = await convertAndCarryOn(ctx, ref, (here) => same(here.status, to.status), columnMoveTarget(rule), depth + 1, undefined, actorUid);
    if (projectId) await tellActor(projectId);
    return to;
  }
  // (Still where it was just moved — nothing else has moved it since.)
  const moved = await applyMove(
    ctx,
    board,
    ref,
    (here) => same(here.status, to.status) && same(here.subStage, to.subStage),
    columnMoveTarget(rule),
    depth + 1,
    undefined,
    actorUid,
  );
  if (moved) await tellActor();
  return moved ?? to;
}

// Its column's assign and tag automations (the ones whose conditions hold), as it enters: assigned to their person
// (told, unless they set it off themselves), given their tag. Its facts as they are after.
async function runColumnActions(
  ctx: Ctx,
  board: ColumnAutomationBoard,
  ref: DocumentReference,
  item: { id: string; name: string },
  from: BoardSpot | null,
  to: BoardSpot,
  facts: AutomationItemFacts,
  actorUid?: string,
): Promise<AutomationItemFacts> {
  return doColumnActions(ctx, board, ref, item, columnActionsSetOffByMove(ctx.automations, board, from, to, facts), facts, actorUid);
}

// These assign and tag automations, done. Its facts as they are after.
async function doColumnActions(
  ctx: Ctx,
  board: ColumnAutomationBoard,
  ref: DocumentReference,
  item: { id: string; name: string },
  actions: ColumnAutomation[],
  facts: AutomationItemFacts,
  actorUid?: string,
): Promise<AutomationItemFacts> {
  const next = { ...facts, tags: [...facts.tags] };
  for (const automation of actions) {
    try {
      if (automation.action === "assign") {
        const uid = automation.assignToUid;
        if (uid === next.assignedToUid || !(await isMember(ctx, uid))) continue;
        const membership = (await ctx.db.collection("companies").doc(ctx.companyId).collection("memberships").doc(uid).get()).data() ?? {};
        const name = str(membership.displayName ?? membership.name) || "A teammate";
        await ref.update({ assignedToUid: uid, assignedToName: name, assignedTo: name, updatedAtIso: new Date().toISOString() });
        next.assignedToUid = uid;
        if (uid !== actorUid) {
          await addNotificationAndPush(
            uid,
            {
              ...columnAutomationAssignedText({ board, itemName: item.name, column: columnAutomationColumnLabel(automation) }),
              type: board === "leads" ? "lead_access" : "project_assigned",
              ...(board === "leads" ? { leadId: item.id } : { projectId: item.id }),
              companyId: ctx.companyId,
            },
            ctx.siteOrigin,
          );
        }
      } else if (automation.action === "tag" && board === "projects") {
        if (next.tags.some((tag) => same(tag, automation.tagValue))) continue;
        await ref.update({ tags: FieldValue.arrayUnion(automation.tagValue), updatedAtIso: new Date().toISOString() });
        next.tags.push(automation.tagValue);
      }
    } catch (error) {
      console.error("[column-automations] assign/tag failed:", error);
    }
  }
  return next;
}

// Whoever set a move automation off, told it's moved on — straight away, or when its timer's up — `projectId`: the
// project a lead became (the notification opens that, not the archived lead).
async function tellMoveNotice(
  ctx: Ctx,
  board: ColumnAutomationBoard,
  item: { id: string; name: string },
  column: BoardSpot,
  rule: ColumnAutomation,
  actorUid?: string,
  projectId = "",
) {
  if (!actorUid || !(await isMember(ctx, actorUid))) return;
  const notice = columnAutomationMoveNoticeText({
    board,
    itemName: item.name,
    column: columnAutomationColumnLabel(column),
    movedTo: columnAutomationColumnLabel(columnMoveTarget(rule)),
    converts: board === "leads" && rule.moveToBoard === "projects",
  });
  await addNotificationAndPush(
    actorUid,
    {
      ...notice,
      type: COLUMN_AUTOMATION_NOTIFICATION_TYPE,
      ...(projectId ? { projectId } : board === "leads" ? { leadId: item.id } : { projectId: item.id }),
      companyId: ctx.companyId,
    },
    ctx.siteOrigin,
  );
}

// A lead converted to a project in `to` (one of the Dashboard's columns — lib/lead-convert-server.ts), then that
// project's own column automations, as any project new into a column. The project's id (null: not converted).
async function convertAndCarryOn(
  ctx: Ctx,
  leadRef: DocumentReference,
  isStillThere: (here: BoardSpot) => boolean,
  to: BoardSpot,
  depth: number,
  scheduledDueAtIso?: string,
  actorUid?: string,
): Promise<string | null> {
  const made = await convertLeadToProject({
    companyId: ctx.companyId,
    leadRef,
    to,
    isStillThere: (status) => isStillThere({ status, subStage: "" }),
    scheduledDueAtIso,
    actorUid,
  });
  if (!made) return null;
  ctx.convertedProjectId = made.projectId;
  const projectRef = ctx.db.collection("companies").doc(ctx.companyId).collection("jobs").doc(made.projectId);
  await afterMove(ctx, "projects", projectRef, { id: made.projectId, name: made.name }, null, to, depth, actorUid, made.data);
  return made.projectId;
}

// Moves a project or lead (if it's still where it should be — `isStillThere` — still on its board, and not a project
// locked into a bonus period changing status) — as the app moves one: a project's status history, completion date,
// instant archiving and completed-projects record; a lead's status-change time. Any move on a timer it had is over
// (it's left that column). Then afterMove. `scheduledDueAtIso`: a timed move being carried out — only if it's still
// that one. `actorUid`: whoever's move set it off (straight away), told what it sets off in turn. Where it ended up (null:
// not moved).
async function applyMove(
  ctx: Ctx,
  board: ColumnAutomationBoard,
  ref: DocumentReference,
  isStillThere: (here: BoardSpot) => boolean,
  to: BoardSpot,
  depth: number,
  scheduledDueAtIso?: string,
  actorUid?: string,
): Promise<BoardSpot | null> {
  const isLeads = board === "leads";
  const nowIso = new Date().toISOString();
  const clearSchedule = { [SCHEDULED_COLUMN_MOVE_FIELD]: FieldValue.delete(), [SCHEDULED_COLUMN_MOVE_DUE_FIELD]: FieldValue.delete() };
  const isCompleted = completedStatusMatcher(ctx.companyData.projectStatuses);
  // A project locked into a bonus period (the Dashboard's Completed pop-up) keeps its status — as in the app (its
  // sub-stage can still change).
  const record = isLeads ? null : (await ctx.db.collection("companies").doc(ctx.companyId).collection("completedProjects").doc(ref.id).get()).data();
  const bonusLocked = Boolean(
    record && isBonusPeriodKey(str(record.bonusQuarter)) && !str(record.reopenedAtIso) && !str(record.deletedAtIso) && !str(record.removedAtIso),
  );
  const result = await ctx.db
    .runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      if (scheduledDueAtIso && str(data[SCHEDULED_COLUMN_MOVE_DUE_FIELD]) !== scheduledDueAtIso) return null;
      const here: BoardSpot = { status: str(data.status), subStage: isLeads ? "" : str(data.dashboardSubStageId) };
      const offBoard = data.isDeleted === true || data.isArchived === true || data.isPurged === true || (!isLeads && data.isSmallJob === true);
      if (offBoard || !isStillThere(here) || (bonusLocked && !same(here.status, to.status))) {
        if (scheduledDueAtIso) tx.update(ref, clearSchedule);
        return null;
      }
      if (isLeads) {
        tx.update(ref, { ...clearSchedule, status: to.status, statusChangedAtIso: nowIso, updatedAt: FieldValue.serverTimestamp(), updatedAtIso: nowIso });
        return { data, here, completion: null as "completed" | "reopened" | null, completedAtIso: "" };
      }
      const completed = isCompleted(to.status);
      const wasCompleted = isCompleted(here.status);
      const keepsCompletedAt = completed && wasCompleted && Boolean(str(data.completedAtIso));
      const completedAtIso = completed ? (keepsCompletedAt ? str(data.completedAtIso) : nowIso) : "";
      const patch: Record<string, unknown> = {
        ...clearSchedule,
        status: to.status,
        dashboardSubStageId: to.subStage,
        updatedAtIso: nowIso,
        completedAtIso,
        statusHistory: FieldValue.arrayUnion({ status: to.status, subStage: to.subStage, atIso: nowIso }),
      };
      if (!keepsCompletedAt) patch.completedAt = completed ? FieldValue.serverTimestamp() : null;
      if (normalizeProjectArchiveDelay(ctx.companyData.projectArchiveAfter) === "instant" && completed && !wasCompleted) {
        patch.isArchived = true;
        patch.archivedAtIso = nowIso;
      }
      tx.update(ref, patch);
      return { data, here, completion: completed && !wasCompleted ? ("completed" as const) : !completed && wasCompleted ? ("reopened" as const) : null, completedAtIso };
    })
    .catch(() => null);
  if (!result) return null;

  const { data, here } = result;
  const itemId = str(data.id) || ref.id;
  if (!isLeads && result.completion) {
    // Its completed-projects record (lib/completed-projects.ts): started (or completed again) as it's completed, stamped
    // reopened as it leaves.
    const recordRef = ctx.db.collection("companies").doc(ctx.companyId).collection("completedProjects").doc(itemId);
    const customer = str(data.customer);
    const snapshot = {
      projectId: itemId,
      projectName: str(data.name),
      customer: customer === "Unknown Customer" ? "" : customer,
      tags: Array.isArray(data.tags) ? data.tags.map(str).filter(Boolean) : [],
    };
    try {
      const record = await recordRef.get();
      if (result.completion === "completed") {
        if (!record.exists || str(record.data()?.reopenedAtIso)) {
          await recordRef.set({
            ...snapshot,
            companyId: ctx.companyId,
            categoryId: str(record.data()?.categoryId) || str(data.dashboardCompleteStatusId),
            completedAtIso: result.completedAtIso,
            markedAtIso: result.completedAtIso,
            markedByUid: "",
            markedByName: "Automation",
            dateChangedAtIso: "",
            dateChangedByName: "",
            reopenedAtIso: "",
            completedAgainAtIso: "",
            deletedAtIso: "",
            deletedByName: "",
            removedAtIso: "",
            removedByName: "",
            fromBefore: false,
            bonusQuarter: "",
            bonusNonQualified: false,
            bonusSetAtIso: "",
            bonusSetByName: "",
          });
        } else {
          await recordRef.update(snapshot);
        }
      } else if (record.exists) {
        await recordRef.update({ ...snapshot, reopenedAtIso: new Date().toISOString() });
      }
    } catch (error) {
      console.error("[column-automations] completed-projects record failed:", error);
    }
  }
  const name = isLeads ? await leadNameForNotification(ctx.companyId, data, "A lead") : str(data.name) || "A project";
  return afterMove(ctx, board, ref, { id: itemId, name }, here, to, depth, actorUid, data);
}

// A lead moved (or new — `from` null) by someone, from app/api/leads or lib/lead-notify-server.ts: the automations it
// sets off. The status it ended up in (moved on, it's not the one it was given).
export async function runLeadColumnAutomations(input: {
  companyId: string;
  leadId: string;
  leadName: string;
  from: BoardSpot | null;
  to: BoardSpot;
  actorUid?: string;
  siteOrigin: string;
}): Promise<{ finalStatus: string; convertedProjectId?: string }> {
  const finalStatus = { finalStatus: input.to.status };
  if (!input.to.status || (input.from && same(input.from.status, input.to.status))) return finalStatus;
  try {
    const ctx = await contextFor(input.companyId, input.siteOrigin);
    if (!ctx || !ctx.automations.length) return finalStatus;
    const ref = ctx.db.collection("companies").doc(input.companyId).collection("leads").doc(input.leadId);
    const ended = await afterMove(ctx, "leads", ref, { id: input.leadId, name: input.leadName }, input.from, input.to, 0, input.actorUid);
    // (Converted to a project: it's archived now — the board takes it off.)
    return { finalStatus: ended.status, convertedProjectId: ctx.convertedProjectId };
  } catch (error) {
    console.error("[column-automations] lead automations failed:", error);
    return finalStatus;
  }
}

// Its waiting automations (those whose conditions didn't hold as it entered its column) looked at again — what they
// look at has changed (its assignee, tags or name): any whose conditions hold now done, as they'd have been as it entered
// — its assign and tag ones, its notify ones (their people told), then a move (straight away; a timed one once its time
// from entering is up — now, if it already is; a lead's on to the Dashboard converting it). `actorUid`: whoever changed
// it, told of a move it set off. From app/api/leads, and the scheduled job (for changes made anywhere else). Where it
// ended up, and a lead's project if it became one (null: nothing done).
export async function recheckWaitingColumnAutomations(input: {
  companyId: string;
  board: ColumnAutomationBoard;
  itemId: string;
  actorUid?: string;
  siteOrigin: string;
  ctx?: Ctx;
}): Promise<{ finalStatus: string; convertedProjectId?: string } | null> {
  try {
    const ctx = input.ctx ?? (await contextFor(input.companyId, input.siteOrigin));
    if (!ctx) return null;
    // (A run the scheduled job shares across items: this one's own.)
    ctx.convertedProjectId = undefined;
    const board = input.board;
    const isLeads = board === "leads";
    const ref = ctx.db.collection("companies").doc(ctx.companyId).collection(isLeads ? "leads" : "jobs").doc(input.itemId);
    const first = (await ref.get()).data();
    if (!first || first[HAS_WAITING_COLUMN_AUTOMATIONS_FIELD] !== true) return null;
    const name = isLeads ? await leadNameForNotification(ctx.companyId, first, "A lead") : str(first.name) || "A project";
    // What's ready, taken off its waiting list in one go — so two looks at once can't both do it.
    const claimed = await ctx.db
      .runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const data = (snap.data() ?? {}) as Record<string, unknown>;
        const waiting = normalizeWaitingColumnAutomations(data[WAITING_COLUMN_AUTOMATIONS_FIELD]);
        const offBoard = data.isDeleted === true || data.isArchived === true || data.isPurged === true || (!isLeads && data.isSmallJob === true);
        if (offBoard || !Object.keys(waiting).length) {
          tx.update(ref, { [WAITING_COLUMN_AUTOMATIONS_FIELD]: {}, [HAS_WAITING_COLUMN_AUTOMATIONS_FIELD]: false });
          return null;
        }
        const here: BoardSpot = { status: str(data.status), subStage: isLeads ? "" : str(data.dashboardSubStageId) };
        const { ready, still } = readyWaitingColumnAutomations(ctx.automations, board, waiting, here, automationItemFacts(data, name));
        if (Object.keys(still).length !== Object.keys(waiting).length) {
          tx.update(ref, { [WAITING_COLUMN_AUTOMATIONS_FIELD]: still, [HAS_WAITING_COLUMN_AUTOMATIONS_FIELD]: Object.keys(still).length > 0 });
        }
        return ready.length ? { data, here, ready } : null;
      })
      .catch(() => null);
    if (!claimed) return null;
    const { data, here, ready } = claimed;
    const item = { id: str(data.id) || ref.id, name };
    let facts = automationItemFacts(data, name);
    facts = await doColumnActions(
      ctx,
      board,
      ref,
      item,
      ready.filter(({ automation }) => automation.action === "assign" || automation.action === "tag").map(({ automation }) => automation),
      facts,
      input.actorUid,
    );
    for (const { automation } of ready) {
      if (automation.action !== "notify") continue;
      const text = columnAutomationNotificationText({
        board,
        event: "enters",
        itemName: name,
        column: columnAutomationColumnLabel(automation),
        movedTo: columnAutomationColumnLabel(here),
      });
      for (const uid of await recipientsOf(ctx, automation, facts.assignedToUid)) {
        await addNotificationAndPush(
          uid,
          { ...text, type: COLUMN_AUTOMATION_NOTIFICATION_TYPE, ...(isLeads ? { leadId: item.id } : { projectId: item.id }), companyId: ctx.companyId },
          ctx.siteOrigin,
        );
      }
    }
    let finalStatus = here.status;
    const move = ready.find(({ automation }) => automation.action === "move");
    if (move) {
      const rule = move.automation;
      const startedMs = Date.parse(move.entry.atIso) || Date.now();
      const isStillThere = (spot: BoardSpot) => isInAutomationColumn(rule, spot);
      if (rule.moveAfter && startedMs + columnAutomationStayMs(rule) > Date.now()) {
        // Its time in the column's not up yet: its timer, from when it entered (whoever set it off told when it moves).
        const scheduled = scheduledColumnMoveFor(rule, here, Date.now(), startedMs, input.actorUid);
        await ref.update({ [SCHEDULED_COLUMN_MOVE_FIELD]: scheduled, [SCHEDULED_COLUMN_MOVE_DUE_FIELD]: scheduled.dueAtIso });
      } else if (isLeads && rule.moveToBoard === "projects") {
        const projectId = await convertAndCarryOn(ctx, ref, isStillThere, columnMoveTarget(rule), 1, undefined, input.actorUid);
        if (projectId) await tellMoveNotice(ctx, board, item, here, rule, input.actorUid, projectId);
      } else {
        const moved = await applyMove(ctx, board, ref, isStillThere, columnMoveTarget(rule), 1, undefined, input.actorUid);
        if (moved) {
          finalStatus = moved.status;
          await tellMoveNotice(ctx, board, item, here, rule, input.actorUid);
        }
      }
    }
    return { finalStatus, convertedProjectId: ctx.convertedProjectId };
  } catch (error) {
    console.error("[column-automations] re-checking waiting automations failed:", error);
    return null;
  }
}

export type ColumnAutomationStaysResult = { companies: number; sent: number; skipped?: boolean };

// "Has been in": every company's — each project (on the Dashboard: not archived, deleted or a small job) or lead (not
// archived) in an automation's column for at least its time, told once for that stay.
export async function runColumnAutomationStays(options: { siteOrigin: string; now?: number }): Promise<ColumnAutomationStaysResult> {
  const result: ColumnAutomationStaysResult = { companies: 0, sent: 0 };
  if (!adminDb) return result;
  const db = adminDb;
  const now = options.now ?? Date.now();
  const stampRef = db.collection("jobRuns").doc("columnAutomationStays");
  const claimedRun = await db
    .runTransaction(async (tx) => {
      const last = Number((await tx.get(stampRef)).data()?.lastRunMs) || 0;
      if (now - last < CHECK_AT_MOST_EVERY_MS) return false;
      tx.set(stampRef, { lastRunMs: now, lastRunIso: new Date(now).toISOString() }, { merge: true });
      return true;
    })
    .catch(() => false);
  if (!claimedRun) return { ...result, skipped: true };

  const companies = await db.collection("companies").select("columnAutomations", "staffRoleIdsByUid").get();
  for (const companySnap of companies.docs) {
    const companyId = companySnap.id;
    const ctx = await contextFor(companyId, options.siteOrigin, (companySnap.data() ?? {}) as Record<string, unknown>);
    const stays = (ctx?.automations ?? []).filter(
      (automation) => automation.action === "notify" && automation.trigger === "stays" && hasColumnAutomationRecipients(automation),
    );
    if (!ctx || !stays.length) continue;
    result.companies += 1;
    for (const automation of stays) {
      const isLeads = automation.board === "leads";
      const items = await companySnap.ref
        .collection(isLeads ? "leads" : "jobs")
        .where("status", "==", automation.status)
        .get()
        .catch(() => null);
      if (!items) continue;
      for (const itemSnap of items.docs) {
        const data = (itemSnap.data() ?? {}) as Record<string, unknown>;
        if (data.isDeleted === true || data.isArchived === true || data.isPurged === true) continue;
        if (!isLeads && (data.isSmallJob === true || (automation.subStage && !same(data.dashboardSubStageId, automation.subStage)))) continue;
        // When this stay began: a project's from its status history, a lead's from when its status last changed. None
        // known — from when the automation was set (it can't be told how long it's really been).
        const started = itemStayStartedAtIso(automation, data) || automation.updatedAtIso;
        const startedMs = Date.parse(started);
        if (!Number.isFinite(startedMs) || now - startedMs < columnAutomationStayMs(automation)) continue;
        const sentMap = (data.columnAutomationsSent ?? {}) as Record<string, unknown>;
        if (sentMap[automation.id] === started) continue;
        const itemName = isLeads ? await leadNameForNotification(companyId, data, "A lead") : str(data.name) || "A project";
        if (!automationConditionsMet(automation, automationItemFacts(data, itemName), null)) continue;
        // Claimed first, so two runs at once can't both tell it.
        const claimed = await db
          .runTransaction(async (tx) => {
            const fresh = await tx.get(itemSnap.ref);
            if (!fresh.exists) return false;
            const current = ((fresh.data() ?? {}).columnAutomationsSent ?? {}) as Record<string, unknown>;
            if (current[automation.id] === started) return false;
            tx.update(itemSnap.ref, new FieldPath("columnAutomationsSent", automation.id), started);
            return true;
          })
          .catch(() => false);
        if (!claimed) continue;
        const text = columnAutomationNotificationText({
          board: automation.board,
          event: "stays",
          itemName,
          column: columnAutomationColumnLabel(automation),
          duration: columnAutomationDurationLabel(automation),
        });
        const itemId = str(data.id) || itemSnap.id;
        for (const uid of await recipientsOf(ctx, automation, str(data.assignedToUid))) {
          await addNotificationAndPush(
            uid,
            {
              ...text,
              type: COLUMN_AUTOMATION_NOTIFICATION_TYPE,
              ...(isLeads ? { leadId: itemId } : { projectId: itemId }),
              companyId,
            },
            options.siteOrigin,
          );
          result.sent += 1;
        }
      }
    }
  }
  return result;
}

export type ScheduledColumnMovesResult = { companies: number; moved: number; rechecked: number; timersSet: number };

// A timed move counted from when each moved in, new or changed (its time, column, conditions …): everything in its column
// now — each project (on the Dashboard: not archived, deleted or a small job) or lead (not archived) its conditions hold
// for — given its timer from when it really moved in (its stay's start; none known: from when the automation was set),
// replacing one it had from this automation (a changed time applies to them all). What's already past its time is due
// at once (the run carries on to the due moves straight after). How many timers it set.
async function backfillCountFromMoveIn(ctx: Ctx, companyRef: DocumentReference, automation: ColumnAutomation, nowMs: number): Promise<number> {
  const isLeads = automation.board === "leads";
  const items = await companyRef
    .collection(isLeads ? "leads" : "jobs")
    .where("status", "==", automation.status)
    .get()
    .catch(() => null);
  let set = 0;
  for (const itemSnap of items?.docs ?? []) {
    const data = (itemSnap.data() ?? {}) as Record<string, unknown>;
    if (data.isDeleted === true || data.isArchived === true || data.isPurged === true) continue;
    if (!isLeads && (data.isSmallJob === true || (automation.subStage && !same(data.dashboardSubStageId, automation.subStage)))) continue;
    // A timer from something else (another column's move, still waiting to be cleared): left be.
    const existing = (data[SCHEDULED_COLUMN_MOVE_FIELD] ?? null) as Record<string, unknown> | null;
    if (existing && str(existing.automationId) && str(existing.automationId) !== automation.id) continue;
    const itemName = isLeads ? await leadNameForNotification(ctx.companyId, data, "A lead") : str(data.name) || "A project";
    if (!automationConditionsMet(automation, automationItemFacts(data, itemName), null)) continue;
    const startedMs = Date.parse(itemStayStartedAtIso(automation, data) || automation.updatedAtIso);
    if (!Number.isFinite(startedMs)) continue;
    const here: BoardSpot = { status: str(data.status), subStage: isLeads ? "" : str(data.dashboardSubStageId) };
    const scheduled = scheduledColumnMoveFor(automation, here, nowMs, startedMs);
    if (str(data[SCHEDULED_COLUMN_MOVE_DUE_FIELD]) === scheduled.dueAtIso) continue;
    const ok = await itemSnap.ref
      .update({ [SCHEDULED_COLUMN_MOVE_FIELD]: scheduled, [SCHEDULED_COLUMN_MOVE_DUE_FIELD]: scheduled.dueAtIso })
      .then(() => true)
      .catch(() => false);
    if (ok) set += 1;
  }
  return set;
}

// Moves on a timer that are due — every call of the scheduled job (a minute's the smallest timer), for the companies with
// any timed move: each project or lead whose due time has come, moved if it's still in the column its timer started in
// (its automation still there), its timer cleared either way. And — for companies with any automation with conditions —
// every project or lead with automations waiting on theirs, looked at again (a change made somewhere that doesn't look
// itself: recheckWaitingColumnAutomations).
export async function runScheduledColumnMoves(options: { siteOrigin: string; now?: number }): Promise<ScheduledColumnMovesResult> {
  const result: ScheduledColumnMovesResult = { companies: 0, moved: 0, rechecked: 0, timersSet: 0 };
  if (!adminDb) return result;
  const db = adminDb;
  const nowMs = options.now ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const companies = await db
    .collection("companies")
    .select("columnAutomations", "projectStatuses", "projectArchiveAfter", "staffRoleIdsByUid", COLUMN_AUTOMATION_BACKFILLS_FIELD)
    .get();
  for (const companySnap of companies.docs) {
    const companyData = (companySnap.data() ?? {}) as Record<string, unknown>;
    const ctx = await contextFor(companySnap.id, options.siteOrigin, companyData);
    const hasTimed = Boolean(ctx?.automations.some((automation) => automation.action === "move" && automation.moveAfter));
    const hasConditions = Boolean(ctx?.automations.some((automation) => automation.conditions.length > 0));
    if (!ctx || (!hasTimed && !hasConditions)) continue;
    result.companies += 1;
    // Timed moves counted from when each moved in, new or changed since their column was last gone through: gone
    // through now — each claimed first (its updatedAtIso noted on the company), so two runs at once can't both.
    const backfilled = (companyData[COLUMN_AUTOMATION_BACKFILLS_FIELD] ?? {}) as Record<string, unknown>;
    for (const automation of ctx.automations) {
      if (automation.action !== "move" || !automation.moveAfter || automation.moveCountFrom !== "movedIn") continue;
      if (str(backfilled[automation.id]) === automation.updatedAtIso) continue;
      const claimed = await db
        .runTransaction(async (tx) => {
          const fresh = ((await tx.get(companySnap.ref)).data() ?? {}) as Record<string, unknown>;
          const noted = (fresh[COLUMN_AUTOMATION_BACKFILLS_FIELD] ?? {}) as Record<string, unknown>;
          if (str(noted[automation.id]) === automation.updatedAtIso) return false;
          tx.update(companySnap.ref, new FieldPath(COLUMN_AUTOMATION_BACKFILLS_FIELD, automation.id), automation.updatedAtIso);
          return true;
        })
        .catch(() => false);
      if (claimed) result.timersSet += await backfillCountFromMoveIn(ctx, companySnap.ref, automation, nowMs);
    }
    for (const board of hasConditions ? (["projects", "leads"] as const) : []) {
      const waiting = await companySnap.ref
        .collection(board === "leads" ? "leads" : "jobs")
        .where(HAS_WAITING_COLUMN_AUTOMATIONS_FIELD, "==", true)
        .get()
        .catch(() => null);
      for (const itemSnap of waiting?.docs ?? []) {
        const done = await recheckWaitingColumnAutomations({ companyId: companySnap.id, board, itemId: itemSnap.id, siteOrigin: options.siteOrigin, ctx });
        if (done) result.rechecked += 1;
      }
    }
    for (const board of hasTimed ? (["projects", "leads"] as const) : []) {
      const due = await companySnap.ref
        .collection(board === "leads" ? "leads" : "jobs")
        .where(SCHEDULED_COLUMN_MOVE_DUE_FIELD, "<=", nowIso)
        .get()
        .catch(() => null);
      for (const itemSnap of due?.docs ?? []) {
        const data = (itemSnap.data() ?? {}) as Record<string, unknown>;
        const scheduled = (data[SCHEDULED_COLUMN_MOVE_FIELD] ?? {}) as Record<string, unknown>;
        const dueAtIso = str(data[SCHEDULED_COLUMN_MOVE_DUE_FIELD]);
        // Its automation as it is now (gone, or no longer a timed move: the timer's just cleared).
        const automation = ctx.automations.find((row) => row.id === str(scheduled.automationId) && row.action === "move" && row.moveAfter);
        if (!automation) {
          await itemSnap.ref
            .update({ [SCHEDULED_COLUMN_MOVE_FIELD]: FieldValue.delete(), [SCHEDULED_COLUMN_MOVE_DUE_FIELD]: FieldValue.delete() })
            .catch(() => undefined);
          continue;
        }
        // Still in the automation's column (a status's own column takes in its sub-stages — moved between those, it's
        // still there). A lead's on to the Dashboard: converted to a project there.
        const isStillThere = (here: BoardSpot) => isInAutomationColumn(automation, here);
        const converts = board === "leads" && automation.moveToBoard === "projects";
        const moved = converts
          ? await convertAndCarryOn(ctx, itemSnap.ref, isStillThere, columnMoveTarget(automation), 1, dueAtIso)
          : await applyMove(ctx, board, itemSnap.ref, isStillThere, columnMoveTarget(automation), 1, dueAtIso);
        if (moved) {
          result.moved += 1;
          // Whoever's move set its timer off: told it's moved on, now that it has.
          const byUid = str(scheduled.byUid);
          if (byUid) {
            const name = board === "leads" ? await leadNameForNotification(ctx.companyId, data, "A lead") : str(data.name) || "A project";
            await tellMoveNotice(
              ctx,
              board,
              { id: str(data.id) || itemSnap.id, name },
              { status: str(scheduled.fromStatus), subStage: str(scheduled.fromSubStage) },
              automation,
              byUid,
              converts && typeof moved === "string" ? moved : "",
            );
          }
        }
      }
    }
  }
  return result;
}
