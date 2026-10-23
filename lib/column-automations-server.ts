import { FieldPath, FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  automationsSetOffByMove,
  columnAutomationColumnLabel,
  columnAutomationRecipients,
  columnAutomationDurationLabel,
  columnAutomationMoveNoticeText,
  columnAutomationNotificationText,
  columnAutomationStayMs,
  columnMoveSetOffByMove,
  columnMoveTarget,
  COLUMN_AUTOMATION_NOTIFICATION_TYPE,
  COLUMN_MOVE_CHAIN_LIMIT,
  hasColumnAutomationRecipients,
  isInAutomationColumn,
  normalizeColumnAutomations,
  SCHEDULED_COLUMN_MOVE_DUE_FIELD,
  SCHEDULED_COLUMN_MOVE_FIELD,
  scheduledColumnMoveFor,
  stayStartedAtIso,
  type BoardSpot,
  type ColumnAutomation,
  type ColumnAutomationBoard,
} from "@/lib/column-automations";
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
//   as any move.

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
async function recipientsOf(ctx: Ctx, automation: ColumnAutomation): Promise<string[]> {
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
  for (const uid of columnAutomationRecipients(automation, ctx.memberRoles ?? [])) {
    if (await isMember(ctx, uid)) recipients.push(uid);
  }
  return recipients;
}

// Its columns' "enters" / "leaves" automations' people, told — and whoever moved it too (once), so they know what their
// move set off (none, for one the scheduled job made).
async function tellMove(ctx: Ctx, board: ColumnAutomationBoard, item: { id: string; name: string }, from: BoardSpot | null, to: BoardSpot, actorUid?: string) {
  for (const { automation, event } of automationsSetOffByMove(ctx.automations, board, from, to)) {
    const text = columnAutomationNotificationText({
      board,
      event,
      itemName: item.name,
      column: columnAutomationColumnLabel(automation),
      movedTo: columnAutomationColumnLabel(to),
    });
    const recipients = new Set(await recipientsOf(ctx, automation));
    if (actorUid && (await isMember(ctx, actorUid))) recipients.add(actorUid);
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
): Promise<BoardSpot> {
  await tellMove(ctx, board, item, from, to, actorUid);
  const rule = columnMoveSetOffByMove(ctx.automations, board, from, to);
  if (!rule) return to;
  const tellActor = async (after: string) => {
    if (!actorUid || !(await isMember(ctx, actorUid))) return;
    const notice = columnAutomationMoveNoticeText({
      board,
      itemName: item.name,
      column: columnAutomationColumnLabel(to),
      movedTo: columnAutomationColumnLabel(columnMoveTarget(rule)),
      after,
    });
    await addNotificationAndPush(
      actorUid,
      { ...notice, type: COLUMN_AUTOMATION_NOTIFICATION_TYPE, ...(board === "leads" ? { leadId: item.id } : { projectId: item.id }), companyId: ctx.companyId },
      ctx.siteOrigin,
    );
  };
  if (rule.moveAfter) {
    const scheduled = scheduledColumnMoveFor(rule, to, Date.now());
    const ok = await ref
      .update({ [SCHEDULED_COLUMN_MOVE_FIELD]: scheduled, [SCHEDULED_COLUMN_MOVE_DUE_FIELD]: scheduled.dueAtIso })
      .then(() => true)
      .catch(() => false);
    if (ok) await tellActor(columnAutomationDurationLabel(rule));
    return to;
  }
  if (depth >= COLUMN_MOVE_CHAIN_LIMIT) return to;
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
  if (moved) await tellActor("");
  return moved ?? to;
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
  return afterMove(ctx, board, ref, { id: itemId, name }, here, to, depth, actorUid);
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
}): Promise<{ finalStatus: string }> {
  const finalStatus = { finalStatus: input.to.status };
  if (!input.to.status || (input.from && same(input.from.status, input.to.status))) return finalStatus;
  try {
    const ctx = await contextFor(input.companyId, input.siteOrigin);
    if (!ctx || !ctx.automations.length) return finalStatus;
    const ref = ctx.db.collection("companies").doc(input.companyId).collection("leads").doc(input.leadId);
    const ended = await afterMove(ctx, "leads", ref, { id: input.leadId, name: input.leadName }, input.from, input.to, 0, input.actorUid);
    return { finalStatus: ended.status };
  } catch (error) {
    console.error("[column-automations] lead automations failed:", error);
    return finalStatus;
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
        const started =
          (isLeads
            ? str(data.statusChangedAtIso) || str(data.createdAtIso)
            : stayStartedAtIso(automation, Array.isArray(data.statusHistory) ? (data.statusHistory as Array<Record<string, unknown>>) : [])) ||
          automation.updatedAtIso;
        const startedMs = Date.parse(started);
        if (!Number.isFinite(startedMs) || now - startedMs < columnAutomationStayMs(automation)) continue;
        const sentMap = (data.columnAutomationsSent ?? {}) as Record<string, unknown>;
        if (sentMap[automation.id] === started) continue;
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
        const itemName = isLeads ? await leadNameForNotification(companyId, data, "A lead") : str(data.name) || "A project";
        const text = columnAutomationNotificationText({
          board: automation.board,
          event: "stays",
          itemName,
          column: columnAutomationColumnLabel(automation),
          duration: columnAutomationDurationLabel(automation),
        });
        const itemId = str(data.id) || itemSnap.id;
        for (const uid of await recipientsOf(ctx, automation)) {
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

export type ScheduledColumnMovesResult = { companies: number; moved: number };

// Moves on a timer that are due — every call of the scheduled job (a minute's the smallest timer), for the companies with
// any timed move: each project or lead whose due time has come, moved if it's still in the column its timer started in
// (its automation still there), its timer cleared either way.
export async function runScheduledColumnMoves(options: { siteOrigin: string; now?: number }): Promise<ScheduledColumnMovesResult> {
  const result: ScheduledColumnMovesResult = { companies: 0, moved: 0 };
  if (!adminDb) return result;
  const nowIso = new Date(options.now ?? Date.now()).toISOString();
  const companies = await adminDb.collection("companies").select("columnAutomations", "projectStatuses", "projectArchiveAfter", "staffRoleIdsByUid").get();
  for (const companySnap of companies.docs) {
    const companyData = (companySnap.data() ?? {}) as Record<string, unknown>;
    const ctx = await contextFor(companySnap.id, options.siteOrigin, companyData);
    if (!ctx || !ctx.automations.some((automation) => automation.action === "move" && automation.moveAfter)) continue;
    result.companies += 1;
    for (const board of ["projects", "leads"] as const) {
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
        // still there).
        const moved = await applyMove(ctx, board, itemSnap.ref, (here) => isInAutomationColumn(automation, here), columnMoveTarget(automation), 1, dueAtIso);
        if (moved) result.moved += 1;
      }
    }
  }
  return result;
}
