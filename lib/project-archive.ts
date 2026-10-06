import type { Project } from "@/lib/types";

// Project archiving, shared by the staff app (background archiver, Archived page, dashboard, project
// page, Company Settings) and the client portal's server routes — so it deliberately has no Firebase
// imports and only works on plain data (a raw job document or a normalized Project).
//
// Company doc:
// - projectStatuses[].isComplete — the statuses that mean "this job is finished" (Company Settings >
//   Project statuses > "Completed").
// - projectArchiveAfter — how long a project sits in one of those statuses before it's archived and
//   its client portal link stops working ("never" = it never is, "instant" = the moment it's completed).
//
// Job doc (companies/{companyId}/jobs/{jobId}):
// - completedAtIso — when it entered a completed status (kept up to date by updateProjectStatus).
// - isArchived / archivedAtIso — stored away in the Archived list, either automatically (above) or by
//   hand (the project page's Archive button, which used to be Delete). Nothing archived is ever deleted
//   automatically; only someone deleting it permanently from the Archived page removes it.
// - isDeleted / deletedAtIso — the old "Recently Deleted" soft delete. Nothing writes it any more, but
//   projects deleted that way are treated as archived everywhere (archived on their deletion date), so
//   they show in the Archived list instead of being lost.
// - archiveRestoredAtIso — when it was last restored from the archive. The delay counts from the later
//   of this and completedAtIso, so a restored project gets the full delay again instead of being
//   archived straight back on the next run (its completion date stays as it was). With "instant" a
//   restored project stays out until it's completed again (see isPastArchiveDelay).

export type ProjectArchiveDelay = "never" | "instant" | "1w" | "2w" | "1m" | "3m" | "6m" | "1y";
export const PROJECT_ARCHIVE_DELAY_OPTIONS: Array<{ value: ProjectArchiveDelay; label: string }> = [
  { value: "never", label: "Never" },
  { value: "instant", label: "Instantly" },
  { value: "1w", label: "1 week" },
  { value: "2w", label: "2 weeks" },
  { value: "1m", label: "1 month" },
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
  { value: "1y", label: "1 year" },
];

export function normalizeProjectArchiveDelay(raw: unknown): ProjectArchiveDelay {
  return PROJECT_ARCHIVE_DELAY_OPTIONS.some((o) => o.value === raw) ? (raw as ProjectArchiveDelay) : "never";
}

// When a project that started its delay at fromMs is due to be archived (epoch ms). 0 = never.
export function projectArchiveDueMs(fromMs: number, delay: ProjectArchiveDelay): number {
  if (delay === "never" || !Number.isFinite(fromMs) || fromMs <= 0) return 0;
  if (delay === "instant") return fromMs;
  const d = new Date(fromMs);
  if (delay === "1w") d.setDate(d.getDate() + 7);
  else if (delay === "2w") d.setDate(d.getDate() + 14);
  else if (delay === "1m") d.setMonth(d.getMonth() + 1);
  else if (delay === "3m") d.setMonth(d.getMonth() + 3);
  else if (delay === "6m") d.setMonth(d.getMonth() + 6);
  else d.setFullYear(d.getFullYear() + 1);
  return d.getTime();
}

function statusKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

// How "completed" was decided before statuses had their own toggle (the dashboard's long-standing
// rule) — still used for a company that hasn't set the toggle on any status yet.
export function isCompletedStatusFallback(status: unknown): boolean {
  const token = String(status ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return token === "done" || token.startsWith("complete");
}

// Answers "is this a completed status?" for one company, from its projectStatuses list (raw from the
// company doc, or already normalized — anything with name/isComplete). Once any status carries the
// toggle (Company Settings saves it on every row, on or off), the one switched on is the completed
// status — only one can be, so if older data has several, the first in the list counts. Before that,
// the old name-based rule applies, so nothing changes for a company until it's been set.
export function completedStatusMatcher(projectStatuses: unknown): (status: unknown) => boolean {
  const rows = Array.isArray(projectStatuses)
    ? projectStatuses.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : [];
  if (!rows.some((row) => typeof row.isComplete === "boolean")) return isCompletedStatusFallback;
  const completedName = statusKey(rows.find((row) => row.isComplete === true && statusKey(row.name))?.name);
  return (status) => Boolean(completedName) && statusKey(status) === completedName;
}

// Epoch ms from an ISO string, a Date, or a Firestore Timestamp (client or admin SDK). 0 if unusable.
function toMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "string") {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value === "object") {
    const ts = value as { toMillis?: () => number; toDate?: () => Date; seconds?: unknown };
    if (typeof ts.toMillis === "function") return ts.toMillis();
    if (typeof ts.toDate === "function") return ts.toDate().getTime();
    if (typeof ts.seconds === "number") return ts.seconds * 1000;
  }
  return 0;
}

type ArchiveRecord = Record<string, unknown>;

// Works for a raw job doc (status = the label) and a normalized Project (statusLabel = the label).
function statusLabelOf(record: ArchiveRecord): string {
  const label = record.statusLabel;
  return typeof label === "string" && label.trim() ? label : String(record.status ?? "");
}

// Where a project's archive delay starts: the later of when it was completed and when it was last
// restored from the archive. A project completed before completedAtIso existed has no completion
// date, so its last update stands in (the status change itself was an update, so that's never
// earlier than when it was really completed).
export function projectArchiveClockStartMs(record: ArchiveRecord): number {
  const completedMs = toMs(record.completedAtIso) || toMs(record.completedAt);
  const startMs = completedMs || toMs(record.updatedAtIso) || toMs(record.updatedAt);
  return Math.max(startMs, toMs(record.archiveRestoredAtIso));
}

// True once a project has sat in a completed status for longer than the delay. Ignores whether it's
// already archived — callers decide what that means for them.
//
// "instant" is due as soon as it's completed — except that a restore sticks: a project restored from
// the archive while still completed isn't due again (and its portal stays open) until it's moved out
// of the completed status and back in, which stamps a completion date later than the restore.
export function isPastArchiveDelay(
  record: ArchiveRecord,
  isCompletedStatus: (status: unknown) => boolean,
  delay: ProjectArchiveDelay,
  nowMs = Date.now(),
): boolean {
  if (delay === "never" || !isCompletedStatus(statusLabelOf(record))) return false;
  if (delay === "instant") {
    const restoredMs = toMs(record.archiveRestoredAtIso);
    if (!restoredMs) return true;
    return (toMs(record.completedAtIso) || toMs(record.completedAt)) > restoredMs;
  }
  const dueMs = projectArchiveDueMs(projectArchiveClockStartMs(record), delay);
  return dueMs > 0 && nowMs >= dueMs;
}

// The client portal's rule (checked by every public /api/specs-share route at request time, from the
// company doc and the project doc): the link stops working once the project is archived, or once
// it's past its archive delay even if nobody has opened the app since to actually archive it.
export function isClientPortalClosedForProject(projectRecord: ArchiveRecord, companyRecord: ArchiveRecord, nowMs = Date.now()): boolean {
  if (isProjectArchived(projectRecord)) return true;
  const delay = normalizeProjectArchiveDelay(companyRecord.projectArchiveAfter);
  if (delay === "never") return false;
  return isPastArchiveDelay(projectRecord, completedStatusMatcher(companyRecord.projectStatuses), delay, nowMs);
}

// Read through these rather than the fields directly: an old soft-deleted project (isDeleted, from
// before Recently Deleted became part of Archived) counts as archived too.
export function isProjectArchived(project: Project | ArchiveRecord | null | undefined): boolean {
  if (!project) return false;
  const record = project as ArchiveRecord;
  return record.isArchived === true || record.isDeleted === true;
}

export function projectArchivedAtIso(project: Project | ArchiveRecord | null | undefined): string {
  return project ? String((project as ArchiveRecord).archivedAtIso ?? "").trim() : "";
}

// Copies a job doc's archive fields onto a normalized Project (see normalizeProject), only the ones
// that are set, so projects that were never archived carry nothing extra. An old soft-deleted project
// comes back archived, filed under the date it was deleted (unless it had already been archived).
export function withProjectArchiveFields<T extends Project>(project: T, data: ArchiveRecord): T {
  const out = project as unknown as ArchiveRecord;
  if (data.isArchived === true || data.isDeleted === true) out.isArchived = true;
  const deletedMs = data.isDeleted === true ? toMs(data.deletedAtIso) || toMs(data.deletedAt) : 0;
  const archivedAtIso = String(data.archivedAtIso ?? "").trim() || (deletedMs ? new Date(deletedMs).toISOString() : "");
  if (archivedAtIso) out.archivedAtIso = archivedAtIso;
  const restoredAtIso = String(data.archiveRestoredAtIso ?? "").trim();
  if (restoredAtIso) out.archiveRestoredAtIso = restoredAtIso;
  return project;
}

// Which projects a project list returns: "exclude" (the default everywhere) leaves archived ones out,
// "only" is the Archived page, "include" is everything (e.g. opening a project by its link).
export type ArchivedFilter = "exclude" | "include" | "only";
export function matchesArchivedFilter(data: ArchiveRecord, filter: ArchivedFilter = "exclude"): boolean {
  if (filter === "include") return true;
  const archived = data.isArchived === true;
  return filter === "only" ? archived : !archived;
}

// Sent (window event) whenever projects are archived — by the background archiver, the moment one is
// completed under "instant", or by hand from the project page — so an open dashboard (and the project's
// own page) can move them out of the way without a reload. detail: { companyId, projectIds, archivedAtIso }.
export const PROJECTS_ARCHIVED_EVENT = "cutsmart:projects-archived";
export type ProjectsArchivedDetail = { companyId: string; projectIds: string[]; archivedAtIso: string };
