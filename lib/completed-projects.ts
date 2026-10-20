// The completed-projects record — what the Dashboard's Completed pop-up (and its Completed count) show, and what
// completion bonuses are worked out from. One doc per project at companies/{companyId}/completedProjects/{projectId},
// written the moment it joins the completed status (updateProjectStatus, lib/firestore-data.ts):
// - archived, it stays completed (it's still in the completed status);
// - deleted for good — from the Archive or anywhere — it stays completed, stamped deleted (permanentlyDeleteProject):
//   the record is all that's left of it;
// - moved out of the completed status, to any other, it's no longer completed: stamped reopened, and left out of the
//   pop-up and the count (the doc's kept, but nothing shows it). Completed again later, it's a new completion — from
//   then.
//
// Sorted for bonuses (the pop-up's Bonus quarters — dashboard.complete.bonus): each can be locked into a bonus quarter
// (bonusQuarter: its first month, "2025-12"), whatever its completion date — as one of its qualified jobs, or one of its
// non qualified ones (bonusNonQualified) — or left not sorted (""). (Before quarters had non qualified jobs of their own,
// there was one overall non qualified ("nq") — the pop-up puts those in the quarter they were completed in.) Completed
// again after it was moved out, it's a new completion: not sorted.
//
// Its completion date and time start as when it was marked, and can be changed (who changed it, and when, is kept —
// markedAtIso stays the original). Its category is a row of Company Settings' "Completed project legend" (e.g. Small
// project / Full makeover); without one set, the pop-up suggests one from the project's tags.
//
// Projects already completed before the record began are filled in from their own completion dates the first time
// the pop-up is opened (fillInCompletedProjectRecords — fromBefore). Every write here is best-effort: a status change
// never waits on or fails because of it.

import { doc, getDoc, getDocs, collection, setDoc, updateDoc } from "@/lib/firestore-client";
import { auth, db } from "@/lib/firebase";
import { completedStatusMatcher } from "@/lib/project-archive";
import { bonusPeriodLabel, isBonusPeriodKey, type CompletionBonusSettings } from "@/lib/completion-bonus";
import type { Project } from "@/lib/types";

export type CompletedProjectRecord = {
  projectId: string;
  projectName: string;
  customer: string;
  tags: string[];
  // A completed project legend row's id ("" for none).
  categoryId: string;
  // When it was completed — as marked, or as changed since.
  completedAtIso: string;
  // When it was first marked complete, and by whom (never changes).
  markedAtIso: string;
  markedByUid: string;
  markedByName: string;
  // Its completion date's last change.
  dateChangedAtIso: string;
  dateChangedByName: string;
  // Moved back out of a completed status ("" while it's still completed) — and completed again since.
  reopenedAtIso: string;
  completedAgainAtIso: string;
  // The project's been deleted for good (the record stays).
  deletedAtIso: string;
  deletedByName: string;
  // Taken off the Completed list by hand (removeCompletedProjectRecord) — kept, so it isn't filled back in from its
  // project; completed again after it's reopened, it starts over as a new record.
  removedAtIso: string;
  removedByName: string;
  // Already completed when the record began — filled in from the project's own completion date.
  fromBefore: boolean;
  // Its bonus quarter (that quarter's first month, "2025-12"), or "" (not sorted) — whether it's one of the quarter's
  // non qualified jobs — and who sorted it, when. ("nq": the old overall non qualified.)
  bonusQuarter: string;
  bonusNonQualified: boolean;
  bonusSetAtIso: string;
  bonusSetByName: string;
};
export const BONUS_NON_QUALIFIED = "nq";

// Who's doing it: whoever's signed in (setCompletionActor — the app shell keeps it up to date; the Firebase account
// otherwise).
let currentActor: { uid: string; name: string } | null = null;
export function setCompletionActor(actor: { uid: string; name: string } | null) {
  currentActor = actor;
}
function actor(): { uid: string; name: string } {
  if (currentActor) return currentActor;
  const account = auth?.currentUser;
  return { uid: String(account?.uid || ""), name: String(account?.displayName || account?.email || "").trim() };
}

function recordRef(companyId: string, projectId: string) {
  return doc(db!, "companies", companyId, "completedProjects", projectId);
}

const text = (value: unknown) => String(value ?? "").trim();

function recordFrom(id: string, data: Record<string, unknown>): CompletedProjectRecord {
  return {
    projectId: text(data.projectId) || id,
    projectName: text(data.projectName),
    customer: text(data.customer),
    tags: Array.isArray(data.tags) ? data.tags.map(text).filter(Boolean) : [],
    categoryId: text(data.categoryId),
    completedAtIso: text(data.completedAtIso),
    markedAtIso: text(data.markedAtIso),
    markedByUid: text(data.markedByUid),
    markedByName: text(data.markedByName),
    dateChangedAtIso: text(data.dateChangedAtIso),
    dateChangedByName: text(data.dateChangedByName),
    reopenedAtIso: text(data.reopenedAtIso),
    completedAgainAtIso: text(data.completedAgainAtIso),
    deletedAtIso: text(data.deletedAtIso),
    deletedByName: text(data.deletedByName),
    removedAtIso: text(data.removedAtIso),
    removedByName: text(data.removedByName),
    fromBefore: data.fromBefore === true,
    bonusQuarter: text(data.bonusQuarter),
    bonusNonQualified: data.bonusNonQualified === true,
    bonusSetAtIso: text(data.bonusSetAtIso),
    bonusSetByName: text(data.bonusSetByName),
  };
}

// What's kept of the project itself (its name, client and tags as they were last seen).
function projectSnapshot(project: Project) {
  const customer = text(project.customer);
  return {
    projectId: project.id,
    projectName: text(project.name),
    customer: customer === "Unknown Customer" ? "" : customer,
    tags: Array.isArray(project.tags) ? project.tags.map(text).filter(Boolean) : [],
  };
}

// A project's own completion date (completedAtIso, or the older completedAt timestamp) — "" if it has none.
export function projectCompletedIso(project: Project): string {
  const raw = project as unknown as Record<string, unknown>;
  const iso = text(raw.completedAtIso);
  if (iso) return iso;
  const stamp = raw.completedAt as { toDate?: () => Date } | Date | null | undefined;
  const date = stamp instanceof Date ? stamp : typeof stamp?.toDate === "function" ? stamp.toDate() : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

function newRecord(project: Project, completedAtIso: string, extra: Partial<CompletedProjectRecord> = {}) {
  const by = actor();
  return {
    ...projectSnapshot(project),
    companyId: project.companyId,
    categoryId: text((project as unknown as Record<string, unknown>).dashboardCompleteStatusId),
    completedAtIso,
    markedAtIso: completedAtIso,
    markedByUid: by.uid,
    markedByName: by.name,
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
    ...extra,
  };
}

export async function fetchCompletedProjectRecords(companyId: string): Promise<CompletedProjectRecord[]> {
  const cid = text(companyId);
  if (!db || !cid) return [];
  const snap = await getDocs(collection(db, "companies", cid, "completedProjects"));
  return snap.docs.map((d) => recordFrom(d.id, (d.data() ?? {}) as Record<string, unknown>));
}

// Moved into a completed status (from one that isn't): its record starts — or, reopened since it was last completed,
// starts again, as a new completion from now (its category kept).
export async function noteProjectCompleted(project: Project, completedAtIso: string): Promise<void> {
  const cid = text(project.companyId);
  if (!db || !cid || !project.id) return;
  try {
    const ref = recordRef(cid, project.id);
    const snap = await getDoc(ref);
    const existing = snap.exists() ? recordFrom(project.id, (snap.data() ?? {}) as Record<string, unknown>) : null;
    if (!existing || existing.reopenedAtIso) {
      const record = newRecord(project, completedAtIso);
      await setDoc(ref, existing?.categoryId ? { ...record, categoryId: existing.categoryId } : record);
      return;
    }
    await updateDoc(ref, projectSnapshot(project));
  } catch {
    // the record's best-effort — the status change itself has already been saved
  }
}

// Moved out of a completed status (to one that isn't): stamped reopened — no longer completed, so left out of the
// pop-up and the count.
export async function noteProjectReopened(project: Project, reopenedAtIso: string): Promise<void> {
  const cid = text(project.companyId);
  if (!db || !cid || !project.id) return;
  try {
    const ref = recordRef(cid, project.id);
    const snap = await getDoc(ref);
    if (snap.exists()) await updateDoc(ref, { ...projectSnapshot(project), reopenedAtIso });
  } catch {
    // best-effort
  }
}

// Deleted for good (from the Archive, or anywhere) while it's in the completed status: it stays completed, stamped
// deleted — the record's all that's left of it. One completed before the record began gets its record now, so it isn't
// lost. (One that was moved out of the completed status before it was deleted wasn't completed: left as it is.)
export async function noteProjectDeleted(project: Project): Promise<void> {
  const cid = text(project.companyId);
  if (!db || !cid || !project.id) return;
  const nowIso = new Date().toISOString();
  const by = actor();
  try {
    const companySnap = await getDoc(doc(db, "companies", cid));
    const isCompletedStatus = completedStatusMatcher(((companySnap.data() ?? {}) as Record<string, unknown>).projectStatuses);
    const completedNow = isCompletedStatus(project.statusLabel || project.status);
    const ref = recordRef(cid, project.id);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existing = recordFrom(project.id, (snap.data() ?? {}) as Record<string, unknown>);
      if (existing.reopenedAtIso && !completedNow) return;
      await updateDoc(ref, { ...projectSnapshot(project), reopenedAtIso: "", deletedAtIso: nowIso, deletedByName: by.name });
      return;
    }
    if (!completedNow) return;
    const completedIso = projectCompletedIso(project) || text(project.updatedAt) || nowIso;
    await setDoc(ref, newRecord(project, completedIso, { fromBefore: true, markedByUid: "", markedByName: "", deletedAtIso: nowIso, deletedByName: by.name }));
  } catch {
    // best-effort
  }
}

// Whether a record is in the completed count — given its project (null: not here — deleted, or one this person can't
// see) and whether that project's in the completed status now. Deleted while completed: yes. Here: only while it's in
// the completed status (archived or not). Otherwise: unless it's been moved out of it.
export function isRecordCompleted(record: CompletedProjectRecord, project: Project | null, projectIsCompleted: boolean): boolean {
  if (record.deletedAtIso) return true;
  if (project) return projectIsCompleted;
  return !record.reopenedAtIso;
}

// A job locked into a bonus period from the Completed pop-up — the period's key ("2026-09"), or "" when it isn't (not
// sorted, non qualified, or no longer completed). Its status can't change while it's locked (updateProjectStatus in
// lib/firestore-data.ts refuses it) — until someone with dashboard.complete.bonus takes it back out of the period.
export function bonusLockOf(
  record: (Pick<CompletedProjectRecord, "bonusQuarter" | "reopenedAtIso" | "deletedAtIso"> & { removedAtIso?: string }) | null | undefined,
): string {
  // (Taken off the list: nothing locked.)
  if (!record || record.reopenedAtIso || record.deletedAtIso || record.removedAtIso) return "";
  return isBonusPeriodKey(record.bonusQuarter) ? record.bonusQuarter : "";
}

// The same, read from its saved record ("" if it can't be read).
export async function fetchBonusLock(companyId: string, projectId: string): Promise<string> {
  const cid = text(companyId);
  if (!db || !cid || !projectId) return "";
  try {
    const snap = await getDoc(recordRef(cid, projectId));
    if (!snap.exists()) return "";
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    return bonusLockOf({
      bonusQuarter: text(data.bonusQuarter),
      reopenedAtIso: text(data.reopenedAtIso),
      deletedAtIso: text(data.deletedAtIso),
      removedAtIso: text(data.removedAtIso),
    });
  } catch {
    return "";
  }
}

// What to tell someone trying to change a locked job's status: the period by name for those who sort the bonus
// (settings given), and just that it's locked for everyone else.
export function bonusLockMessage(lockKey: string, settings: CompletionBonusSettings | null): string {
  const period = settings ? bonusPeriodLabel(lockKey, settings) : "";
  return period ? `Locked into ${period} for completion, so its status can't change.` : "This job is locked, so its status can't change.";
}

// From the pop-up: its completion date and time, or its category.
// Sorted into a bonus quarter — as one of its qualified jobs, or its non qualified ones — or back to not sorted ("") — by
// someone with dashboard.complete.bonus. One the record doesn't have yet (in the completed status, but not written —
// project given) is written with it.
export async function setCompletedProjectBonus(
  companyId: string,
  projectId: string,
  bonusQuarter: string,
  nonQualified: boolean,
  missing?: { project: Project; completedAtIso: string },
): Promise<Partial<CompletedProjectRecord> | null> {
  const cid = text(companyId);
  if (!db || !cid || !projectId) return null;
  const patch: Partial<CompletedProjectRecord> = {
    bonusQuarter,
    bonusNonQualified: Boolean(bonusQuarter) && nonQualified,
    bonusSetAtIso: new Date().toISOString(),
    bonusSetByName: actor().name,
  };
  try {
    const base = missing ? newRecord({ ...missing.project, companyId: cid }, missing.completedAtIso, { fromBefore: true, markedByUid: "", markedByName: "" }) : {};
    await setDoc(recordRef(cid, projectId), { ...base, ...patch }, { merge: true });
    return patch;
  } catch {
    return null;
  }
}

// Taken off the Completed list (dragged to its bin and confirmed). The record's kept, marked removed — firestore.rules
// keeps them for good — so it isn't filled back in from its project, and it no longer locks the project's status. One the
// record doesn't have yet (in the completed status, but not written — project given) is written so.
export async function removeCompletedProjectRecord(
  companyId: string,
  projectId: string,
  missing?: { project: Project; completedAtIso: string },
): Promise<Partial<CompletedProjectRecord> | null> {
  const cid = text(companyId);
  if (!db || !cid || !projectId) return null;
  const patch: Partial<CompletedProjectRecord> = { removedAtIso: new Date().toISOString(), removedByName: actor().name };
  try {
    const base = missing ? newRecord({ ...missing.project, companyId: cid }, missing.completedAtIso, { fromBefore: true, markedByUid: "", markedByName: "" }) : {};
    await setDoc(recordRef(cid, projectId), { ...base, ...patch }, { merge: true });
    return patch;
  } catch {
    return null;
  }
}

export async function changeCompletedProjectRecord(
  companyId: string,
  projectId: string,
  change: { completedAtIso?: string; categoryId?: string },
): Promise<Partial<CompletedProjectRecord> | null> {
  const cid = text(companyId);
  if (!db || !cid || !projectId) return null;
  const patch: Partial<CompletedProjectRecord> = {};
  if (change.completedAtIso !== undefined) {
    patch.completedAtIso = change.completedAtIso;
    patch.dateChangedAtIso = new Date().toISOString();
    patch.dateChangedByName = actor().name;
  }
  if (change.categoryId !== undefined) patch.categoryId = change.categoryId;
  try {
    await updateDoc(recordRef(cid, projectId), patch);
    return patch;
  } catch {
    return null;
  }
}

// Projects completed before the record began (in a completed status, with no record yet): filled in from their own
// completion dates — no one's marked them, so they're fromBefore. Returns the records made.
export async function fillInCompletedProjectRecords(companyId: string, projects: Project[]): Promise<CompletedProjectRecord[]> {
  const cid = text(companyId);
  if (!db || !cid) return [];
  const made: CompletedProjectRecord[] = [];
  for (const project of projects) {
    const completedIso = projectCompletedIso(project) || text(project.updatedAt);
    if (!project.id || !completedIso) continue;
    try {
      const ref = recordRef(cid, project.id);
      // (Checked one by one — someone else may have just made it.)
      if ((await getDoc(ref)).exists()) continue;
      const record = newRecord({ ...project, companyId: cid }, completedIso, { fromBefore: true, markedByUid: "", markedByName: "" });
      await setDoc(ref, record);
      made.push(recordFrom(project.id, record as unknown as Record<string, unknown>));
    } catch {
      // best-effort — tried again next time
    }
  }
  return made;
}
