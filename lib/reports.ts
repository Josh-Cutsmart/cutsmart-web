import { quoteAmountFrom } from "@/lib/completion-bonus";
import type { ProjectQuoteOutcome } from "@/lib/firestore-data";

// Reports (app/(staff)/(app)/reports): the company's figures over a stretch of time — worked out here from its
// projects, their quotes and its leads, as they're stored:
//  - leads converted: of the leads that came in, those made into a project — the lead stamped with its project (from
//    when Reports came in), a project naming it as its source, or (before either was recorded) archived the moment a
//    project for the same person (email, phone or name) was created — or in a converted status (the Leads page's
//    Converted card's rule). A lead made into a project is archived, but still counts;
//  - won jobs: a project whose quote the client accepted, or that reached the company's won status (Company Settings
//    › Project statuses › Won) or one after it on the board — whichever came first; its value the accepted quote's,
//    else its latest quote sent;
//  - quote win rate: of the projects first sent a quote in the stretch, those since won (a project counts once, however
//    many versions it was sent);
//  - average job value: what the won jobs with a quote came to, on average;
//  - days to complete: from a project's creation to its completion, for the jobs completed in it;
//  - quoted vs won, by week or month: what was quoted (each project's latest quote sent) and what was won;
//  - days in each stage: how long projects sat in each status — from their status history, recorded from when
//    Reports came in (nothing before it);
//  - the pipeline as it is now, each salesperson's (its assigned user's) figures, and where the leads came from.
// Each headline figure also for the stretch just before, of the same length, to compare.

export type ReportRangeId = "month" | "quarter" | "year" | "twelve";
export const REPORT_RANGES: Array<{ id: ReportRangeId; label: string }> = [
  { id: "month", label: "This month" },
  { id: "quarter", label: "Last 3 months" },
  { id: "year", label: "This year" },
  { id: "twelve", label: "Last 12 months" },
];

export type ReportBucket = { key: string; label: string; startMs: number; endMs: number };
export type ReportRange = { id: ReportRangeId; startMs: number; endMs: number; previous: { startMs: number; endMs: number }; buckets: ReportBucket[] };

const DAY_MS = 86_400_000;
const monthLabel = (date: Date) => date.toLocaleString("en-NZ", { month: "short" });

// The stretch (up to now), and its weeks (this month) or months.
export function reportRangeFor(id: ReportRangeId, nowMs: number): ReportRange {
  const now = new Date(nowMs);
  const monthStart = (offset: number) => new Date(now.getFullYear(), now.getMonth() + offset, 1).getTime();
  const months = (fromOffset: number): ReportBucket[] => {
    const out: ReportBucket[] = [];
    for (let offset = fromOffset; offset <= 0; offset += 1) {
      const start = monthStart(offset);
      out.push({ key: `m${offset}`, label: monthLabel(new Date(start)), startMs: start, endMs: offset === 0 ? nowMs : monthStart(offset + 1) });
    }
    return out;
  };
  let startMs: number;
  let buckets: ReportBucket[];
  if (id === "month") {
    startMs = monthStart(0);
    buckets = [];
    // Weeks from Monday, the first cut short to the 1st.
    let cursor = startMs;
    while (cursor < nowMs) {
      const date = new Date(cursor);
      const daysToMonday = (8 - date.getDay()) % 7 || 7;
      const next = Math.min(nowMs, new Date(date.getFullYear(), date.getMonth(), date.getDate() + daysToMonday).getTime());
      buckets.push({ key: `w${cursor}`, label: `${date.getDate()} ${monthLabel(date)}`, startMs: cursor, endMs: next });
      cursor = next;
    }
  } else if (id === "quarter") {
    startMs = monthStart(-2);
    buckets = months(-2);
  } else if (id === "year") {
    startMs = new Date(now.getFullYear(), 0, 1).getTime();
    buckets = months(-now.getMonth());
  } else {
    startMs = monthStart(-11);
    buckets = months(-11);
  }
  const length = nowMs - startMs;
  return { id, startMs, endMs: nowMs, previous: { startMs: startMs - length, endMs: startMs }, buckets };
}

export type ReportProject = {
  id: string;
  name?: string;
  statusLabel: string;
  createdAt: string;
  completedAtIso?: string;
  isArchived?: boolean;
  assignedToUid?: string;
  assignedTo: string;
  statusHistory?: Array<{ status: string; atIso: string; subStage?: string }>;
  sourceLeadId?: string;
  // Who it's for — to find the lead it was made from, before that was recorded.
  customer?: string;
  clientEmail?: string;
  clientPhone?: string;
  // Deleted from the Archive (a text-only record), and when.
  isPurged?: boolean;
  purgedAtIso?: string;
};
export type ReportLead = {
  id: string;
  createdAtIso: string;
  status: string;
  source: string;
  sourceDetail?: string;
  formName?: string;
  isDeleted?: boolean;
  deletedAtIso?: string;
  convertedProjectId?: string;
  name?: string;
  email?: string;
  phone?: string;
  assignedToUid?: string;
  assignedToName?: string;
};
// In the board's order. isWon: Company Settings' Won toggle. subStages: its sub-board's columns, in order.
export type ReportStatus = { name: string; color: string; isComplete: boolean; isWon: boolean; subStages: Array<{ name: string; color: string }> };
export type ReportPerson = { uid: string; name: string; color: string };
export type ReportInput = {
  projects: ReportProject[];
  leads: ReportLead[];
  quotes: Record<string, ProjectQuoteOutcome[]>;
  statuses: ReportStatus[];
  people: ReportPerson[];
  nowMs: number;
};

export type ReportHeadlines = {
  leads: number;
  converted: number;
  conversionRate: number | null;
  quoted: number;
  // Of those, won (whenever).
  quotedWon: number;
  winRate: number | null;
  won: number;
  wonValue: number;
  averageJobValue: number | null;
  completed: number;
  averageDaysToComplete: number | null;
};

export type ReportData = {
  headlines: ReportHeadlines;
  previous: ReportHeadlines;
  // The company's won status, when it has one.
  wonStatus: string | null;
  buckets: Array<ReportBucket & { quotedValue: number; wonValue: number }>;
  stages: Array<{
    status: string;
    color: string;
    averageDays: number | null;
    projects: number;
    // Its sub-stages' (the board's sub-columns), each as long on average.
    subStages: Array<{ name: string; color: string; averageDays: number | null; projects: number }>;
  }>;
  stageHistoryCount: number;
  pipeline: Array<{ status: string; color: string; count: number }>;
  people: Array<{ key: string; name: string; color: string; started: number; completed: number; quoted: number; won: number; wonValue: number; winRate: number | null }>;
  sources: Array<{ label: string; count: number; converted: number }>;
};

// Which lead statuses count as converted — the Leads page's own rule (leads/page.tsx's LEAD_CONVERTED_STATUS).
const LEAD_CONVERTED_STATUS = /convert|won|sold|accepted|signed/i;
// How long before a lead was archived (made into a project) its project may have been created, or after.
const CONVERSION_WINDOW_BEFORE_MS = 15 * 60_000;
const CONVERSION_WINDOW_AFTER_MS = 2 * 60_000;

const timeOf = (iso: string | undefined) => {
  const ms = Date.parse(String(iso || ""));
  return Number.isFinite(ms) ? ms : Number.NaN;
};
const within = (ms: number, startMs: number, endMs: number) => Number.isFinite(ms) && ms >= startMs && ms <= endMs;
const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const amountOf = (text: string) => {
  const value = quoteAmountFrom(text);
  return Number.isFinite(value) ? value : 0;
};
const statusKey = (name: string) => String(name || "").trim().toLowerCase();

// A salesperson, as Reports tells them apart: by their uid — or, someone no longer on the team, by their name.
export function reportPersonKey(uid: string | undefined, name: string | undefined): string {
  const id = String(uid || "").trim();
  return id || `name:${String(name || "Unassigned").trim().toLowerCase()}`;
}
// A project's salesperson (its assigned user): their key and name.
export function reportProjectPerson(project: ReportProject, people: ReportPerson[]): { key: string; name: string } {
  const uid = String(project.assignedToUid || "").trim();
  const name = (uid && people.find((person) => person.uid === uid)?.name) || String(project.assignedTo || "").trim() || "Unassigned";
  return { key: reportPersonKey(uid, name), name };
}

// What your Reports count (Included — each person's own): not the staff or projects you've switched off — the staff's
// projects and the leads assigned to them, the projects and the leads made into them.
export type ReportFocus = { hiddenPeople: ReadonlySet<string>; hiddenProjects: ReadonlySet<string> };
export function focusReportInput<T extends Omit<ReportInput, "nowMs">>(input: T, focus: ReportFocus): T {
  const left = (project: ReportProject) =>
    focus.hiddenProjects.has(project.id) || focus.hiddenPeople.has(reportProjectPerson(project, input.people).key);
  const leftOut = new Set(input.projects.filter(left).map((project) => project.id));
  const projectOfLead = new Map(input.projects.filter((project) => project.sourceLeadId).map((project) => [String(project.sourceLeadId), project.id]));
  const leads = input.leads.filter((lead) => {
    const projectId = String(lead.convertedProjectId || "").trim() || projectOfLead.get(lead.id) || "";
    if (projectId && leftOut.has(projectId)) return false;
    return !focus.hiddenPeople.has(reportPersonKey(lead.assignedToUid, lead.assignedToName));
  });
  return { ...input, projects: input.projects.filter((project) => !leftOut.has(project.id)), leads };
}

// A project, as Reports counts it: when it was first sent a quote and its latest quote sent's value (none when it's
// never been sent one); whether it's won, when (NaN: not known — reached the won status before history was kept),
// and its value.
type ProjectOutcome = { firstSentMs: number; latestValue: number; won: boolean; wonMs: number; wonValue: number };
function outcomeOf(project: ReportProject, outcomes: ProjectQuoteOutcome[] | undefined, statusIndex: Map<string, number>, wonIndex: number | null): ProjectOutcome {
  const sent = (outcomes ?? []).filter((outcome) => Number.isFinite(timeOf(outcome.savedAtIso))).sort((a, b) => timeOf(a.savedAtIso) - timeOf(b.savedAtIso));
  const accepted = sent.filter((outcome) => Number.isFinite(timeOf(outcome.acceptedAtIso))).sort((a, b) => timeOf(a.acceptedAtIso) - timeOf(b.acceptedAtIso))[0];
  const latestValue = sent.length ? amountOf(sent[sent.length - 1].totalText) : 0;
  // Reached the won status (or one after it): first seen there in its history — else, where it is now (when, then,
  // its completion if it's been completed).
  let reachedWon = false;
  let reachedMs = Number.NaN;
  if (wonIndex !== null) {
    const pastWon = (name: string) => (statusIndex.get(statusKey(name)) ?? -1) >= wonIndex;
    const first = (project.statusHistory ?? [])
      .filter((entry) => pastWon(entry.status) && Number.isFinite(timeOf(entry.atIso)))
      .sort((a, b) => timeOf(a.atIso) - timeOf(b.atIso))[0];
    if (first) {
      reachedWon = true;
      reachedMs = timeOf(first.atIso);
    } else if (pastWon(project.statusLabel)) {
      reachedWon = true;
      reachedMs = timeOf(project.completedAtIso);
    }
  }
  const acceptedMs = accepted ? timeOf(accepted.acceptedAtIso) : Number.NaN;
  const dates = [acceptedMs, reachedMs].filter((ms) => Number.isFinite(ms));
  return {
    firstSentMs: sent.length ? timeOf(sent[0].savedAtIso) : Number.NaN,
    latestValue,
    won: Boolean(accepted) || reachedWon,
    wonMs: dates.length ? Math.min(...dates) : Number.NaN,
    wonValue: accepted ? amountOf(accepted.totalText) : latestValue,
  };
}

// The leads made into projects: stamped with their project, named by a project as its source, or — from before
// either was recorded — archived just as a project for the same person was created.
function convertedLeadIdsOf(input: ReportInput): Set<string> {
  const out = new Set<string>();
  for (const lead of input.leads) if (String(lead.convertedProjectId || "").trim()) out.add(lead.id);
  for (const project of input.projects) if (project.sourceLeadId) out.add(project.sourceLeadId);
  const email = (value: unknown) => String(value || "").trim().toLowerCase();
  const phone = (value: unknown) => String(value || "").replace(/\D/g, "");
  const name = (value: unknown) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const projects = input.projects.map((project) => ({
    createdMs: timeOf(project.createdAt),
    email: email(project.clientEmail),
    phone: phone(project.clientPhone),
    name: name(project.customer),
  }));
  for (const lead of input.leads) {
    if (out.has(lead.id) || !lead.isDeleted) continue;
    const archivedMs = timeOf(lead.deletedAtIso);
    if (!Number.isFinite(archivedMs)) continue;
    const leadEmail = email(lead.email);
    const leadPhone = phone(lead.phone);
    const leadName = name(lead.name);
    const match = projects.some(
      (project) =>
        within(project.createdMs, archivedMs - CONVERSION_WINDOW_BEFORE_MS, archivedMs + CONVERSION_WINDOW_AFTER_MS) &&
        ((leadEmail && leadEmail === project.email) || (leadPhone.length >= 6 && leadPhone === project.phone) || (leadName && leadName === project.name)),
    );
    if (match) out.add(lead.id);
  }
  return out;
}

const leadSourceLabel = (lead: ReportLead) => {
  const source = String(lead.source || "").trim().toLowerCase();
  if (source === "email") return "Email";
  if (source === "manual") return String(lead.sourceDetail || "").trim() || "Added by hand";
  return String(lead.formName || "").trim() || (source === "web-form" ? "Website form" : "Form");
};

function headlinesFor(
  input: ReportInput,
  startMs: number,
  endMs: number,
  outcomes: Map<string, ProjectOutcome>,
  isConverted: (lead: ReportLead) => boolean,
): ReportHeadlines {
  // The leads that came in — not ones thrown away (one made into a project is archived, but still counts).
  const leads = input.leads.filter((lead) => within(timeOf(lead.createdAtIso), startMs, endMs) && (!lead.isDeleted || isConverted(lead)));
  const converted = leads.filter(isConverted).length;
  let quoted = 0;
  let quotedWon = 0;
  let won = 0;
  let wonValue = 0;
  let valuedWins = 0;
  for (const project of input.projects) {
    const outcome = outcomes.get(project.id);
    if (!outcome) continue;
    if (within(outcome.firstSentMs, startMs, endMs)) {
      quoted += 1;
      if (outcome.won) quotedWon += 1;
    }
    if (within(outcome.wonMs, startMs, endMs)) {
      won += 1;
      wonValue += outcome.wonValue;
      if (outcome.wonValue > 0) valuedWins += 1;
    }
  }
  const completedDays = input.projects
    .filter((project) => within(timeOf(project.completedAtIso), startMs, endMs))
    .map((project) => (timeOf(project.completedAtIso) - timeOf(project.createdAt)) / DAY_MS)
    .filter((days) => Number.isFinite(days) && days >= 0);
  return {
    leads: leads.length,
    converted,
    conversionRate: leads.length ? converted / leads.length : null,
    quoted,
    quotedWon,
    winRate: quoted ? quotedWon / quoted : null,
    won,
    wonValue,
    averageJobValue: valuedWins ? wonValue / valuedWins : null,
    completed: completedDays.length,
    averageDaysToComplete: average(completedDays),
  };
}

export function buildReport(input: ReportInput, range: ReportRange): ReportData {
  const statusIndex = new Map(input.statuses.map((status, index) => [statusKey(status.name), index]));
  const wonIndexRaw = input.statuses.findIndex((status) => status.isWon);
  const wonIndex = wonIndexRaw >= 0 ? wonIndexRaw : null;
  const outcomes = new Map(input.projects.map((project) => [project.id, outcomeOf(project, input.quotes[project.id], statusIndex, wonIndex)]));
  const convertedLeadIds = convertedLeadIdsOf(input);
  const isConverted = (lead: ReportLead) => convertedLeadIds.has(lead.id) || LEAD_CONVERTED_STATUS.test(lead.status);
  const statusByKey = new Map(input.statuses.map((status) => [statusKey(status.name), status]));
  const isComplete = (name: string) => statusByKey.get(statusKey(name))?.isComplete ?? false;

  const buckets = range.buckets.map((bucket) => {
    let quotedValue = 0;
    let wonValue = 0;
    for (const outcome of outcomes.values()) {
      if (within(outcome.firstSentMs, bucket.startMs, bucket.endMs - 1)) quotedValue += outcome.latestValue;
      if (within(outcome.wonMs, bucket.startMs, bucket.endMs - 1)) wonValue += outcome.wonValue;
    }
    return { ...bucket, quotedValue, wonValue };
  });

  // Each stay in a status that ended in the stretch (or is still going): how long it lasted — from going in to going
  // into another status (its moves between sub-stages in between are the same stay) — and each stay in a sub-stage,
  // to its next move of any kind. Not the completed statuses, where a job just stays.
  const stays = new Map<string, { days: number[]; projects: Set<string> }>();
  const subStays = new Map<string, { days: number[]; projects: Set<string> }>();
  const addStay = (into: typeof stays, key: string, projectId: string, fromMs: number, toMs: number) => {
    const stay = into.get(key) ?? { days: [], projects: new Set<string>() };
    stay.days.push(Math.max(0, toMs - fromMs) / DAY_MS);
    stay.projects.add(projectId);
    into.set(key, stay);
  };
  let stageHistoryCount = 0;
  for (const project of input.projects) {
    const history = (project.statusHistory ?? [])
      .map((entry) => ({ key: statusKey(entry.status), name: entry.status, subKey: statusKey(entry.subStage ?? ""), atMs: timeOf(entry.atIso) }))
      .filter((entry) => entry.key && Number.isFinite(entry.atMs))
      .sort((a, b) => a.atMs - b.atMs);
    history.forEach((entry, index) => {
      if (isComplete(entry.name)) return;
      const nextMs = index + 1 < history.length ? history[index + 1].atMs : input.nowMs;
      if (entry.subKey && within(nextMs, range.startMs, range.endMs)) addStay(subStays, `${entry.key}|${entry.subKey}`, project.id, entry.atMs, nextMs);
      // The status: once, from the first of its run of entries to the next status.
      if (index > 0 && history[index - 1].key === entry.key) return;
      let after = index + 1;
      while (after < history.length && history[after].key === entry.key) after += 1;
      const endMs = after < history.length ? history[after].atMs : input.nowMs;
      if (!within(endMs, range.startMs, range.endMs)) return;
      addStay(stays, entry.key, project.id, entry.atMs, endMs);
      stageHistoryCount += 1;
    });
  }
  const stages = input.statuses
    .filter((status) => !status.isComplete)
    .map((status) => {
      const stay = stays.get(statusKey(status.name));
      return {
        status: status.name,
        color: status.color,
        averageDays: stay ? average(stay.days) : null,
        projects: stay?.projects.size ?? 0,
        subStages: status.subStages.map((sub) => {
          const subStay = subStays.get(`${statusKey(status.name)}|${statusKey(sub.name)}`);
          return { name: sub.name, color: sub.color, averageDays: subStay ? average(subStay.days) : null, projects: subStay?.projects.size ?? 0 };
        }),
      };
    });

  // Now: the projects still on the board, in each status (in the board's order; any status the company no longer
  // has, after them).
  const pipelineCounts = new Map<string, { status: string; count: number }>();
  for (const project of input.projects) {
    if (project.isArchived) continue;
    const key = statusKey(project.statusLabel) || "new";
    const row = pipelineCounts.get(key) ?? { status: statusByKey.get(key)?.name ?? project.statusLabel, count: 0 };
    row.count += 1;
    pipelineCounts.set(key, row);
  }
  const pipeline = [
    ...input.statuses.map((status) => ({ status: status.name, color: status.color, count: pipelineCounts.get(statusKey(status.name))?.count ?? 0 })),
    ...[...pipelineCounts.entries()].filter(([key]) => !statusByKey.has(key)).map(([, row]) => ({ status: row.status, color: "#94A3B8", count: row.count })),
  ];

  // Each salesperson — the projects' assigned users — and what was theirs in the stretch.
  const personByUid = new Map(input.people.map((person) => [person.uid, person]));
  const people = new Map<string, ReportData["people"][number] & { quotedWon: number }>();
  for (const project of input.projects) {
    const uid = String(project.assignedToUid || "").trim();
    const { key, name } = reportProjectPerson(project, input.people);
    const row = people.get(key) ?? {
      key,
      name,
      color: (uid && personByUid.get(uid)?.color) || "#94A3B8",
      started: 0,
      completed: 0,
      quoted: 0,
      quotedWon: 0,
      won: 0,
      wonValue: 0,
      winRate: null,
    };
    if (within(timeOf(project.createdAt), range.startMs, range.endMs)) row.started += 1;
    if (within(timeOf(project.completedAtIso), range.startMs, range.endMs)) row.completed += 1;
    const outcome = outcomes.get(project.id);
    if (outcome && within(outcome.firstSentMs, range.startMs, range.endMs)) {
      row.quoted += 1;
      if (outcome.won) row.quotedWon += 1;
    }
    if (outcome && within(outcome.wonMs, range.startMs, range.endMs)) {
      row.won += 1;
      row.wonValue += outcome.wonValue;
    }
    people.set(key, row);
  }
  const peopleRows = [...people.values()]
    .map(({ quotedWon, ...row }) => ({ ...row, winRate: row.quoted ? quotedWon / row.quoted : null }))
    .filter((row) => row.started || row.completed || row.quoted || row.won)
    .sort((a, b) => b.wonValue - a.wonValue || b.quoted - a.quoted || b.started - a.started || a.name.localeCompare(b.name));

  // Where the stretch's leads came from.
  const sourceRows = new Map<string, { label: string; count: number; converted: number }>();
  for (const lead of input.leads) {
    if (!within(timeOf(lead.createdAtIso), range.startMs, range.endMs)) continue;
    if (lead.isDeleted && !isConverted(lead)) continue;
    const label = leadSourceLabel(lead);
    const row = sourceRows.get(label) ?? { label, count: 0, converted: 0 };
    row.count += 1;
    if (isConverted(lead)) row.converted += 1;
    sourceRows.set(label, row);
  }

  return {
    headlines: headlinesFor(input, range.startMs, range.endMs, outcomes, isConverted),
    previous: headlinesFor(input, range.previous.startMs, range.previous.endMs - 1, outcomes, isConverted),
    wonStatus: wonIndex !== null ? input.statuses[wonIndex].name : null,
    buckets,
    stages,
    stageHistoryCount,
    pipeline,
    people: peopleRows,
    sources: [...sourceRows.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}
