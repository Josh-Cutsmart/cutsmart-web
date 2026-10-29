"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { createPortal } from "react-dom";
import { AlertTriangle, Archive, Ban, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, Inbox, Lock, PencilLine, RotateCcw, Search, Trash2, X } from "lucide-react";
import { activeDate, activeMoney } from "@/lib/company-formats";
import { bonusPeriodLabel, bonusPeriodNames, completionBonusSettingsFrom, isBonusPeriodKey, quoteAmountFrom, type CompletionBonusSettings } from "@/lib/completion-bonus";
import { glassShineStyle } from "@/lib/glass-shine";
import { DragGhostLayer, useDragGhost } from "@/lib/use-drag-ghost";
import { modalCloseButtonClass } from "@/components/settings-ui";
import { CompletedDatePicker } from "@/components/completed-date-picker";
import { GlassDropdown } from "@/components/glass-dropdown";
import { isProjectArchived } from "@/lib/project-archive";
import { fetchAcceptedQuoteTotalText, fetchCompanyDoc, updateProjectPatch } from "@/lib/firestore-data";
import {
  BONUS_NON_QUALIFIED,
  removeCompletedProjectRecord,
  changeCompletedProjectRecord,
  fetchCompletedProjectRecords,
  fillInCompletedProjectRecords,
  isRecordCompleted,
  projectCompletedIso,
  setCompletedProjectBonus,
  type CompletedProjectRecord,
} from "@/lib/completed-projects";
import type { Project } from "@/lib/types";
import { SkeletonRows } from "@/components/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useUndo } from "@/components/undo-bar";
import { restoreCompletedProjectRecord } from "@/lib/undo-restore-misc";

// The Dashboard's Completed pop-up: the completed-projects record (lib/completed-projects.ts) — every project marked
// complete, on the day and time it was completed, for working out completion bonuses. Counted by period (a month, 2,
// 3 or 6 months, a year — or all time), stepped back and forward, with a bar for each recent period; the periods start
// in whichever month the company's bonus period does (Company Settings › Dashboard › Completion bonus —
// lib/completion-bonus.ts). Each one's completion date and time can be changed. A project archived or deleted (from the
// Archive or anywhere) since it was completed stays (deleted: stamped so); one moved out of the completed status leaves
// (lib/completed-projects.ts).
//
// Bonus periods (only with dashboard.complete.bonus — owners and admins have it): a bubble for each of the company's
// bonus periods (quarters, say), oldest to newest, each with how many are locked into it — a job dragged onto one is
// locked into it, whatever its completion date (a phone: its Sort chip). "Not sorted" holds the rest; "Non qualified"
// the jobs that don't count towards a bonus. A bubble pressed shows just its jobs. With a minimum set, a job whose
// accepted quote is under it — or that has none — says so.

const GREEN = "#2E8C5C";
const PERIOD_LENGTHS: Array<{ months: number; label: string }> = [
  { months: 1, label: "Month" },
  { months: 2, label: "2 months" },
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "Year" },
  { months: 0, label: "All time" },
];
const MONTH_SHORT = Array.from({ length: 12 }, (_, m) => new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(2024, m, 1)));
const MONTH_LONG = Array.from({ length: 12 }, (_, m) => new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2024, m, 1)));
// How long each period is — per person, on this device. (The month they start in is the company's: see startMonth.)
const PERIOD_PREFS_STORAGE_KEY_PREFIX = "cutsmart_completed_periods:";

type PeriodPrefs = { months: number };
function readPeriodPrefs(uid: string): PeriodPrefs {
  const fallback: PeriodPrefs = { months: 3 };
  if (!uid || typeof window === "undefined") return fallback;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PERIOD_PREFS_STORAGE_KEY_PREFIX + uid) || "{}") as Record<string, unknown>;
    const months = Number(parsed.months);
    return { months: PERIOD_LENGTHS.some((p) => p.months === months) ? months : fallback.months };
  } catch {
    return fallback;
  }
}

// Months as one running number (year × 12 + month), so periods are simple sums.
const monthIndexOf = (ms: number) => {
  const d = new Date(ms);
  return d.getFullYear() * 12 + d.getMonth();
};
const yearOf = (index: number) => Math.floor(index / 12);
const monthOf = (index: number) => ((index % 12) + 12) % 12;
// The first month of the period a month is in, for periods of this length starting in startMonth.
function periodStartOf(index: number, months: number, startMonth: number): number {
  if (months <= 1) return index;
  return index - ((((index - startMonth) % months) + months) % months);
}
function periodLabel(start: number, months: number): string {
  if (months <= 1) return `${MONTH_LONG[monthOf(start)]} ${yearOf(start)}`;
  const end = start + months - 1;
  return yearOf(start) === yearOf(end)
    ? `${MONTH_SHORT[monthOf(start)]} – ${MONTH_SHORT[monthOf(end)]} ${yearOf(end)}`
    : `${MONTH_SHORT[monthOf(start)]} ${yearOf(start)} – ${MONTH_SHORT[monthOf(end)]} ${yearOf(end)}`;
}
// The month a period's paid in: so many months after its last (Company Settings' Bonus paid).
function paidLabel(start: number, months: number, paidMonthsAfter: number): string {
  const paid = start + months - 1 + paidMonthsAfter;
  return `${MONTH_LONG[monthOf(paid)]} ${yearOf(paid)}`;
}

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
const WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "short" });
function timeLabel(ms: number): string {
  return Number.isFinite(ms) ? TIME_FORMAT.format(new Date(ms)).toLowerCase().replace(/\s+/g, "") : "";
}
function isoMs(iso: string): number {
  const ms = iso ? new Date(iso).getTime() : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.NaN;
}
function dateTimeLabel(iso: string): string {
  const ms = isoMs(iso);
  return Number.isFinite(ms) ? `${activeDate(ms)} · ${timeLabel(ms)}` : "";
}

type LoadState = { status: "loading" | "ready" | "error"; records: CompletedProjectRecord[] };

type CompletionRow = {
  record: CompletedProjectRecord;
  project: Project | null;
  completedMs: number;
  // In the saved record (not just shown from the projects, the record couldn't be read).
  saved: boolean;
};

export function CompletedProjectsModal({
  panelRef,
  scrollRef,
  onClose,
  companyId,
  projects,
  isCompletedStatus,
  isAdmin,
  canEdit,
  canSortBonus,
  uid,
  onOpenProject,
  onProjectPatched,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  companyId: string;
  // The dashboard's projects (archived ones too).
  projects: Project[];
  isCompletedStatus: (status: unknown) => boolean;
  isAdmin: boolean;
  canEdit: boolean;
  // dashboard.complete.bonus: sees and sorts the bonus quarters.
  canSortBonus: boolean;
  uid: string;
  onOpenProject: (project: Project) => void;
  onProjectPatched: (projectId: string, patch: Record<string, unknown>) => void;
}) {
  const [load, setLoad] = useState<LoadState>({ status: "loading", records: [] });
  // Read each time it opens; any project completed before the record began is filled in (once).
  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  });
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    fetchCompletedProjectRecords(companyId).then(
      async (records) => {
        if (cancelled) return;
        setLoad({ status: "ready", records });
        if (!canEdit) return;
        const have = new Set(records.map((record) => record.projectId));
        const missing = projectsRef.current.filter((project) => isCompletedStatus(project.statusLabel) && !have.has(project.id));
        if (!missing.length) return;
        const made = await fillInCompletedProjectRecords(companyId, missing);
        if (!cancelled && made.length) setLoad((prev) => ({ ...prev, records: [...prev.records, ...made] }));
      },
      () => {
        if (!cancelled) setLoad({ status: "error", records: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [canEdit, companyId, isCompletedStatus]);

  // --- The period ------------------------------------------------------------------------------------------------
  const [prefs, setPrefs] = useState<PeriodPrefs>(() => readPeriodPrefs(uid));
  // The company's completion bonus settings (Company Settings › Dashboard — lib/completion-bonus.ts): the bonus period
  // (its length and the month it starts in — what every period here is counted from), when it's paid, its minimum.
  const [bonus, setBonus] = useState<CompletionBonusSettings>(() => completionBonusSettingsFrom(null));
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    fetchCompanyDoc(companyId).then(
      (companyDoc) => {
        if (!cancelled) setBonus(completionBonusSettingsFrom(companyDoc));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [companyId]);
  const startMonth = bonus.startMonth;
  const [nowMs] = useState(() => Date.now());
  const currentStart = periodStartOf(monthIndexOf(nowMs), prefs.months, startMonth);
  // The period shown (its first month) — null: the current one.
  const [pickedStart, setPickedStart] = useState<number | null>(null);
  const selectedStart = pickedStart === null ? currentStart : periodStartOf(pickedStart, prefs.months, startMonth);
  const isAllTime = prefs.months === 0;
  const changePrefs = (next: PeriodPrefs) => {
    setPrefs(next);
    setPickedStart(null);
    try {
      if (uid) window.localStorage.setItem(PERIOD_PREFS_STORAGE_KEY_PREFIX + uid, JSON.stringify(next));
    } catch {
      // not remembered
    }
  };

  // --- The rows --------------------------------------------------------------------------------------------------
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  // What's completed: the record's completed ones (in the completed status now, archived or not — or deleted while they
  // were), and any project in the completed status it doesn't have yet (just completed, or the record couldn't be read
  // or written) — shown from the project itself. One moved out of the completed status isn't completed.
  const recordOf = (project: Project): CompletedProjectRecord => {
    const completedAtIso = projectCompletedIso(project) || String(project.updatedAt || "");
    return {
      projectId: project.id,
      projectName: project.name,
      customer: project.customer,
      tags: project.tags ?? [],
      categoryId: String((project as unknown as Record<string, unknown>).dashboardCompleteStatusId ?? ""),
      completedAtIso,
      markedAtIso: completedAtIso,
      markedByUid: "",
      markedByName: "",
      dateChangedAtIso: "",
      dateChangedByName: "",
      reopenedAtIso: "",
      completedAgainAtIso: "",
      deletedAtIso: "",
      deletedByName: "",
      removedAtIso: "",
      removedByName: "",
      fromBefore: true,
      bonusQuarter: "",
      bonusNonQualified: false,
      bonusSetAtIso: "",
      bonusSetByName: "",
    };
  };
  const savedRecords = load.status === "ready" ? load.records : [];
  const recordedIds = new Set(savedRecords.map((record) => record.projectId));
  const records: Array<{ record: CompletedProjectRecord; saved: boolean }> = [
    ...savedRecords
      .filter((record) => {
        if (record.removedAtIso) return false;
        const project = projectsById.get(record.projectId) ?? null;
        return isRecordCompleted(record, project, Boolean(project && isCompletedStatus(project.statusLabel)));
      })
      .map((record) => ({ record, saved: true })),
    ...projects
      .filter((project) => isCompletedStatus(project.statusLabel) && !recordedIds.has(project.id))
      .map((project) => ({ record: recordOf(project), saved: false })),
  ];
  const rows: CompletionRow[] = records.flatMap(({ record, saved }): CompletionRow[] => {
    const project = projectsById.get(record.projectId) ?? null;
    // Someone who can't see every project sees the ones they can (and any deleted one they marked).
    if (!isAdmin && !project && !(record.deletedAtIso && record.markedByUid === uid)) return [];
    return [
      {
        record: project ? { ...record, projectName: project.name || record.projectName, customer: project.customer && project.customer !== "Unknown Customer" ? project.customer : record.customer } : record,
        project,
        completedMs: isoMs(record.completedAtIso),
        saved,
      },
    ];
  });

  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const inPeriod = (row: CompletionRow, start: number) => {
    if (isAllTime) return true;
    if (!Number.isFinite(row.completedMs)) return false;
    const index = monthIndexOf(row.completedMs);
    return index >= start && index < start + prefs.months;
  };
  const periodRows = rows.filter((row) => inPeriod(row, selectedStart));
  const shownRows = periodRows
    .filter((row) => !query || [row.record.projectName, row.record.customer, ...row.record.tags].join(" ").toLowerCase().includes(query))
    .sort((a, b) => (Number.isFinite(b.completedMs) ? b.completedMs : 0) - (Number.isFinite(a.completedMs) ? a.completedMs : 0));
  const countIn = (start: number) => rows.filter((row) => inPeriod(row, start)).length;

  // A bar for every period from the first with a completed job up to now — and always a few years of them to look back
  // through (RECENT_MIN_BARS for the period length; at most RECENT_MAX_BARS) — scrolled sideways (RecentPeriodsStrip).
  // With the average a period since that first job, and the best.
  const RECENT_MIN_BARS = prefs.months <= 1 ? 36 : prefs.months <= 3 ? 24 : prefs.months <= 6 ? 16 : 10;
  const RECENT_MAX_BARS = 240;
  const firstCompletedIndex = rows.reduce((min, row) => (Number.isFinite(row.completedMs) ? Math.min(min, monthIndexOf(row.completedMs)) : min), Infinity);
  const firstCompletedStart = Number.isFinite(firstCompletedIndex) ? periodStartOf(firstCompletedIndex, prefs.months, startMonth) : currentStart;
  const barsFrom = isAllTime
    ? 0
    : Math.max(
        currentStart - (RECENT_MAX_BARS - 1) * prefs.months,
        Math.min(currentStart - (RECENT_MIN_BARS - 1) * prefs.months, selectedStart, firstCompletedStart),
      );
  const bars = isAllTime
    ? []
    : Array.from({ length: Math.floor((currentStart - barsFrom) / prefs.months) + 1 }, (_, i) => barsFrom + i * prefs.months).map((start) => ({
        start,
        count: countIn(start),
      }));
  const tallest = Math.max(1, ...bars.map((bar) => bar.count));
  const countedBars = bars.filter((bar) => bar.start >= firstCompletedStart);
  const barsAverage = countedBars.length ? countedBars.reduce((sum, bar) => sum + bar.count, 0) / countedBars.length : 0;
  const bestBar = bars.reduce<{ start: number; count: number } | null>((best, bar) => (bar.count > (best?.count ?? 0) ? bar : best), null);
  const periodWord = prefs.months === 1 ? "month" : prefs.months === 12 ? "year" : "period";

  // --- Bonus periods (canSortBonus) ------------------------------------------------------------------------------------
  // A bonus period: the company's so many months from the month they start in — numbered within the year it ends in
  // ("Quarter 1 2026": Dec 2025 – Feb 2026, quarterly from December; a month's or a year's just its name). Kept on a job as
  // its first month ("2025-12"). (Named quarter… below whatever its length.)
  const bonusLength = bonus.periodMonths;
  const bonusNames = bonusPeriodNames(bonusLength);
  const quarterStartOf = (index: number) => periodStartOf(index, bonusLength, startMonth);
  const quarterKeyOf = (start: number) => `${yearOf(start)}-${String(monthOf(start) + 1).padStart(2, "0")}`;
  const quarterStartFromKey = (key: string) => {
    const match = key.match(/^(\d{4})-(\d{2})$/);
    return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : Number.NaN;
  };
  const quarterLabel = (start: number) => bonusPeriodLabel(quarterKeyOf(start), bonus);
  const quarterShortLabel = (start: number) => bonusPeriodLabel(quarterKeyOf(start), bonus, true);
  // Where a job's sorted: a quarter's qualified jobs ("2026-09"), its non qualified ones ("2026-09|nq"), or "unsorted".
  // One in the old overall non qualified ("nq") counts as non qualified in the quarter it was completed in.
  const bucketOf = (row: CompletionRow): string => {
    const quarter = row.record.bonusQuarter;
    if (quarter === BONUS_NON_QUALIFIED) {
      return Number.isFinite(row.completedMs) ? `${quarterKeyOf(quarterStartOf(monthIndexOf(row.completedMs)))}|nq` : "unsorted";
    }
    if (isBonusPeriodKey(quarter)) return row.record.bonusNonQualified ? `${quarter}|nq` : quarter;
    return "unsorted";
  };
  const quarterOfBucket = (bucket: string) => bucket.split("|")[0];
  const isSmallBucket = (bucket: string) => bucket.endsWith("|nq");
  // Oldest to newest: from the earliest quarter anything was completed (or locked) in, to now — every one between.
  const nowQuarter = quarterStartOf(monthIndexOf(nowMs));
  const quarterStarts = (() => {
    const lockedStarts = rows.map((row) => quarterStartFromKey(quarterOfBucket(bucketOf(row)))).filter((start) => Number.isFinite(start));
    const completedStarts = rows.filter((row) => Number.isFinite(row.completedMs)).map((row) => quarterStartOf(monthIndexOf(row.completedMs)));
    const first = Math.min(nowQuarter, ...completedStarts, ...lockedStarts.map(quarterStartOf));
    const last = Math.max(nowQuarter, ...lockedStarts.map(quarterStartOf));
    const starts: number[] = [];
    for (let start = first; start <= last && starts.length < 400; start += bonusLength) starts.push(start);
    // (One locked into a quarter of an older cycle — before the start month was changed — keeps its own.)
    for (const start of lockedStarts) if (!starts.includes(start)) starts.push(start);
    return starts.sort((a, b) => a - b);
  })();
  const bucketCount = (bucket: string) => rows.filter((row) => bucketOf(row) === bucket).length;
  const bucketName = (bucket: string) =>
    bucket === "unsorted" ? "Not sorted" : `${quarterLabel(quarterStartFromKey(quarterOfBucket(bucket)))}${isSmallBucket(bucket) ? " · Non qualified" : ""}`;
  // A bubble opened (its quarter's key, or "unsorted"): the list is its jobs — a quarter's qualified ones, then its non
  // qualified ones — instead of the period's.
  const [openBucket, setOpenBucket] = useState<string | null>(null);
  // A job being dragged, and the bubble it's over.
  const [draggingId, setDraggingId] = useState("");
  // The Dashboard board's drag: a see-through copy of the row hanging from the cursor, swinging as it moves, gliding
  // back onto the row when it's let go.
  const rowDragGhost = useDragGhost();
  const [dropBucket, setDropBucket] = useState("");
  const listRows = openBucket && canSortBonus
    ? rows
        .filter((row) => bucketOf(row) === openBucket || (openBucket !== "unsorted" && bucketOf(row) === `${openBucket}|nq`))
        .filter((row) => !query || [row.record.projectName, row.record.customer, ...row.record.tags].join(" ").toLowerCase().includes(query))
        .sort((a, b) => (Number.isFinite(b.completedMs) ? b.completedMs : 0) - (Number.isFinite(a.completedMs) ? a.completedMs : 0))
    : shownRows;
  // Copying jobs as tables — each one's name and the day it was completed, oldest first — HTML for an email, Word or Docs,
  // and tab-separated for a spreadsheet:
  // - the period's ("Copy quarter" on the list's first month bar — "Copy period" for a length that isn't the bonus
  //   period's, "Copy all" for all time): its jobs in two tables by where they're sorted — those in a quarter (and any
  //   not sorted yet, marked so), then "Small Jobs:", the non qualified ones;
  // - an opened quarter's: its qualified jobs, then "Small Jobs:", its non qualified ones.
  const [copiedKey, setCopiedKey] = useState("");
  const copyPeriodTitle = isAllTime
    ? "All time"
    : prefs.months === bonusLength
      ? `${bonusPeriodLabel(quarterKeyOf(selectedStart), bonus)} (${periodLabel(selectedStart, prefs.months)})`
      : periodLabel(selectedStart, prefs.months);
  const copyPeriodLabel = isAllTime ? "Copy all" : prefs.months === bonusLength ? `Copy ${bonusNames.word.toLowerCase()}` : "Copy period";
  // The count in a copy's heading: its jobs and its small ones ("3 Projects · 1 Small Project").
  const projectsCount = (projects: number, small: number) =>
    `${projects} ${projects === 1 ? "Project" : "Projects"} · ${small} ${small === 1 ? "Small Project" : "Small Projects"}`;
  const copyTables = async (key: string, tables: Array<{ title: string; rows: CompletionRow[] }>) => {
    const oldestFirst = (list: CompletionRow[]) =>
      [...list].sort((a, b) => (Number.isFinite(a.completedMs) ? a.completedMs : 0) - (Number.isFinite(b.completedMs) ? b.completedMs : 0));
    const cell = (value: string) => value.replace(/[\t\r\n]+/g, " ");
    const html = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const th = 'style="border:1px solid #CBD5E1;padding:4px 12px;text-align:left;background:#F1F5F9;font-weight:600"';
    const td = 'style="border:1px solid #CBD5E1;padding:4px 12px"';
    // One table — its title, then the jobs (or "None").
    const parts = tables.map(({ title, rows: list }) => {
      const lines = oldestFirst(list).map((row) => [
        `${row.record.projectName || "Untitled"}${row.record.deletedAtIso ? " (deleted)" : ""}${bucketOf(row) === "unsorted" ? " (not sorted)" : ""}`,
        Number.isFinite(row.completedMs) ? activeDate(row.completedMs) : "",
      ]);
      return {
        text: [title, "", ...(lines.length ? ["Project\tCompleted", ...lines.map((line) => line.map(cell).join("\t"))] : ["None"])].join("\n"),
        html: `<p><strong>${html(title)}</strong></p>${
          lines.length
            ? `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px"><thead><tr><th ${th}>Project</th><th ${th}>Completed</th></tr></thead><tbody>${lines
                .map((line) => `<tr><td ${td}>${html(line[0])}</td><td ${td}>${html(line[1])}</td></tr>`)
                .join("")}</tbody></table>`
            : "<p>None</p>"
        }`,
      };
    });
    const text = parts.map((part) => part.text).join("\n\n");
    const table = parts.map((part) => part.html).join("<br>");
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/html": new Blob([table], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? "" : prev)), 2000);
    } catch {
      setNotice("Couldn't copy it — please try again.");
    }
  };
  const copyPeriod = () => {
    const jobs = periodRows.filter((row) => !isSmallBucket(bucketOf(row)));
    const smallJobs = periodRows.filter((row) => isSmallBucket(bucketOf(row)));
    return copyTables("period", [
      { title: `${copyPeriodTitle} · ${projectsCount(jobs.length, smallJobs.length)}`, rows: jobs },
      { title: "Small Jobs:", rows: smallJobs },
    ]);
  };
  const copyQuarter = (quarterKey: string) => {
    const start = quarterStartFromKey(quarterKey);
    const jobs = rows.filter((row) => bucketOf(row) === quarterKey);
    const smallJobs = rows.filter((row) => bucketOf(row) === `${quarterKey}|nq`);
    return copyTables(quarterKey, [
      { title: `${quarterLabel(start)} (${periodLabel(start, bonusLength)}) · ${projectsCount(jobs.length, smallJobs.length)}`, rows: jobs },
      { title: "Small Jobs:", rows: smallJobs },
    ]);
  };
  // Each listed job's accepted quote total (the version its client accepted) — read as they're listed, a few at a time:
  // a number, "none" (no accepted quote) or "unknown" (accepted, with no total marked). Only to check the minimum.
  const [acceptedQuotes, setAcceptedQuotes] = useState<Record<string, number | "none" | "unknown">>({});
  const askedQuotesRef = useRef(new Set<string>());
  const quoteCheckIds = canSortBonus && bonus.minimumQuote !== null
    ? listRows.filter((row) => row.project && !row.record.deletedAtIso).map((row) => row.record.projectId)
    : [];
  const quoteCheckKey = quoteCheckIds.join("|");
  useEffect(() => {
    const asked = askedQuotesRef.current;
    const ids = quoteCheckKey ? quoteCheckKey.split("|").filter((id) => !asked.has(id)) : [];
    if (!ids.length) return;
    ids.forEach((id) => asked.add(id));
    const received = new Set<string>();
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < ids.length; i += 4) {
        const results = await Promise.all(
          ids.slice(i, i + 4).map(async (id) => {
            const project = projectsRef.current.find((item) => item.id === id);
            const text = project ? await fetchAcceptedQuoteTotalText(project) : null;
            const amount = text === null ? Number.NaN : quoteAmountFrom(text);
            return [id, text === null ? "none" : Number.isFinite(amount) ? amount : "unknown"] as const;
          }),
        );
        if (cancelled) return;
        results.forEach(([id]) => received.add(id));
        setAcceptedQuotes((prev) => ({ ...prev, ...Object.fromEntries(results) }));
      }
    })();
    return () => {
      cancelled = true;
      // (Anything not read yet is asked for again next time.)
      ids.forEach((id) => {
        if (!received.has(id)) asked.delete(id);
      });
    };
  }, [quoteCheckKey]);

  const railRef = useRef<HTMLDivElement | null>(null);
  // (Opened at the newest — the bottom of the column, or a phone's strip's end.)
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollTop = rail.scrollHeight;
    rail.scrollLeft = rail.scrollWidth;
  }, [canSortBonus]);

  // Grouped by the month completed (newest first).
  const months: Array<{ key: string; label: string; rows: CompletionRow[] }> = [];
  for (const row of listRows) {
    const key = Number.isFinite(row.completedMs) ? String(monthIndexOf(row.completedMs)) : "none";
    const label = Number.isFinite(row.completedMs) ? `${MONTH_LONG[monthOf(Number(key))]} ${yearOf(Number(key))}` : "No date";
    const last = months[months.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else months.push({ key, label, rows: [row] });
  }

  // --- Changing one ----------------------------------------------------------------------------------------------
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");
  const patchRecord = (projectId: string, patch: Partial<CompletedProjectRecord>) =>
    setLoad((prev) => ({ ...prev, records: prev.records.map((record) => (record.projectId === projectId ? { ...record, ...patch } : record)) }));
  // Kept in step on the project too, while it's still completed (its archive delay counts from its completion date).
  const patchProject = async (row: CompletionRow, patch: Record<string, unknown>) => {
    if (!row.project || row.record.deletedAtIso) return;
    if ("completedAtIso" in patch && !isCompletedStatus(row.project.statusLabel)) return;
    if (await updateProjectPatch(row.project, patch)) onProjectPatched(row.project.id, patch);
  };
  const changeDate = async (row: CompletionRow, completedAtIso: string) => {
    if (!completedAtIso || !canEdit || saving) return;
    setSaving(row.record.projectId);
    setNotice("");
    if (row.saved) {
      const patch = await changeCompletedProjectRecord(companyId, row.record.projectId, { completedAtIso });
      if (patch) patchRecord(row.record.projectId, patch);
      else setNotice("Couldn't change the date — please try again.");
    }
    await patchProject(row, { completedAtIso });
    setSaving("");
  };
  // Into a quarter's qualified jobs ("2026-09"), its non qualified ones ("2026-09|nq"), or back to not sorted ("" /
  // "unsorted") — written with its record if it hasn't one yet. (One still in the old overall non qualified is always
  // written, so it moves to the new way.)
  const sortInto = async (row: CompletionRow, bucket: string) => {
    const target = bucket === "unsorted" ? "" : bucket;
    if (!canSortBonus || saving) return;
    if ((target || "unsorted") === bucketOf(row) && row.record.bonusQuarter !== BONUS_NON_QUALIFIED) return;
    setSaving(row.record.projectId);
    setNotice("");
    const patch = await setCompletedProjectBonus(
      companyId,
      row.record.projectId,
      target ? quarterOfBucket(target) : "",
      Boolean(target) && isSmallBucket(target),
      row.saved || !row.project ? undefined : { project: row.project, completedAtIso: row.record.completedAtIso },
    );
    if (!patch) setNotice("Couldn't sort it — please try again.");
    else if (row.saved) patchRecord(row.record.projectId, patch);
    else setLoad((prev) => (prev.status === "ready" ? { ...prev, records: [...prev.records, { ...row.record, ...patch }] } : prev));
    setSaving("");
  };
  // Taking one off the list: dragged onto the bin in the header (owners and admins), then confirmed — and then the
  // Undo bar, putting it back on the list.
  const canRemove = isAdmin;
  const [removeTarget, setRemoveTarget] = useState<CompletionRow | null>(null);
  const offerUndo = useUndo();
  const [overBin, setOverBin] = useState(false);
  // Dropped on the bin: its copy fades out there (not back onto its row, over the confirmation) — the drag's own end
  // that follows leaves it be.
  const droppedOnBinRef = useRef(false);
  useEffect(() => {
    if (!removeTarget) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setRemoveTarget(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [removeTarget]);
  const removeRow = async (row: CompletionRow) => {
    setRemoveTarget(null);
    if (!canRemove || saving) return;
    setSaving(row.record.projectId);
    setNotice("");
    const patch = await removeCompletedProjectRecord(
      companyId,
      row.record.projectId,
      row.saved || !row.project ? undefined : { project: row.project, completedAtIso: row.record.completedAtIso },
    );
    if (!patch) setNotice("Couldn't remove it — please try again.");
    else if (row.saved) patchRecord(row.record.projectId, patch);
    else setLoad((prev) => (prev.status === "ready" ? { ...prev, records: [...prev.records, { ...row.record, ...patch }] } : prev));
    setSaving("");
    if (!patch) return;
    // Undone: its record's removed stamp cleared again (the record's never deleted — one written just now, for a project
    // the record didn't have yet, stays written, now as an ordinary one).
    const projectId = row.record.projectId;
    offerUndo(`${row.record.projectName || "Project"} removed`, async () => {
      if (await restoreCompletedProjectRecord(companyId, projectId)) patchRecord(projectId, { removedAtIso: "", removedByName: "" });
    });
  };
  const dropOnBin = (event: React.DragEvent) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || draggingId;
    setOverBin(false);
    setDropBucket("");
    setDraggingId("");
    droppedOnBinRef.current = true;
    rowDragGhost.end();
    const row = rows.find((item) => item.record.projectId === id);
    if (row) setRemoveTarget(row);
  };
  // Dropped on a bubble.
  const dropOn = (bucket: string) => (event: React.DragEvent) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || draggingId;
    setDropBucket("");
    setDraggingId("");
    // Here too, not just the row's own drag end — its copy glides back onto it.
    rowDragGhost.end(id);
    const row = rows.find((item) => item.record.projectId === id);
    if (row) void sortInto(row, bucket === "unsorted" ? "" : bucket);
  };

  if (typeof document === "undefined") return null;
  const neutralChip = "glass-shine glass-shine-neutral";
  // A bubble in the column (or, narrower, the strip): its name, its months and when it's paid, how many are in it (a
  // quarter: its qualified jobs, and its non qualified ones) — lit while it's open. While a job's dragged, a quarter
  // splits in two: dropped on its left half, the job's one of its qualified jobs; on its right half, a non qualified one.
  const RED = "#DC2626";
  const bubble = (bucket: string, title: string, detail: string, colour: string, Icon: typeof Inbox | null) => {
    const isQuarter = bucket !== "unsorted";
    const on = openBucket === bucket;
    const overHalf = dropBucket === bucket ? "left" : isQuarter && dropBucket === `${bucket}|nq` ? "right" : "";
    const isNow = bucket === quarterKeyOf(nowQuarter);
    const halfOf = (event: React.DragEvent<HTMLElement>) => {
      if (!isQuarter) return bucket;
      const rect = event.currentTarget.getBoundingClientRect();
      return event.clientX > rect.left + rect.width / 2 ? `${bucket}|nq` : bucket;
    };
    const lit = { backgroundColor: "rgba(255,255,255,0.25)" };
    const smallCount = isQuarter ? bucketCount(`${bucket}|nq`) : 0;
    return (
      <button
        key={bucket}
        type="button"
        data-bonus-bucket={bucket}
        aria-pressed={on}
        onClick={() => setOpenBucket((prev) => (prev === bucket ? null : bucket))}
        onDragOver={(event) => {
          if (!draggingId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const target = halfOf(event);
          if (dropBucket !== target) setDropBucket(target);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDropBucket((prev) => (prev === bucket || prev === `${bucket}|nq` ? "" : prev));
        }}
        onDrop={(event) => dropOn(halfOf(event))(event)}
        className={`glass-shine ${on ? "" : "glass-shine-neutral"} relative flex min-w-[170px] shrink-0 items-center gap-2.5 overflow-hidden rounded-[18px] px-3 py-2 text-left transition hover:brightness-[0.97] lg:w-full lg:min-w-0`}
        style={glassShineStyle(colour, {
          color: on ? "#FFFFFF" : "var(--text-main)",
          // Its ring while a job's held over it — always there, just clear otherwise, so it fades away as the job's let
          // go (rather than vanishing).
          outline: `2px solid ${overHalf ? (overHalf === "right" ? RED : colour) : "transparent"}`,
          outlineOffset: 0,
          transition: "outline-color 320ms ease-out, background-color 150ms ease, color 150ms ease, box-shadow 150ms ease, filter 150ms ease",
        })}
        title={on ? "Back to the period" : `Open ${title}`}
      >
        {Icon ? (
          <span
            className="glass-shine inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
            style={on ? lit : glassShineStyle(colour)}
          >
            <Icon size={13} />
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium">{title}</span>
            {isNow ? (
              <span className="shrink-0 rounded-full px-1.5 text-[9.5px] font-medium uppercase tracking-[0.6px]" style={on ? lit : { backgroundColor: "color-mix(in srgb, var(--brand) 14%, transparent)", color: "var(--brand)" }}>
                Now
              </span>
            ) : null}
          </span>
          {detail ? (
            <span className="block truncate text-[10.5px] font-medium" style={on ? { opacity: 0.85 } : { color: "var(--text-muted)" }}>
              {detail}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span
            className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[12px] font-medium tabular-nums"
            style={on ? lit : { backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
            title={isQuarter ? `${bucketCount(bucket)} qualified` : undefined}
          >
            {bucketCount(bucket)}
          </span>
          {isQuarter ? (
            <span
              className="inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full px-1.5 text-[12px] font-medium tabular-nums"
              style={on ? lit : { backgroundColor: `color-mix(in srgb, ${RED} 12%, transparent)`, color: RED }}
              title={`${smallCount} non qualified`}
            >
              <Ban size={10} className="shrink-0" />
              {smallCount}
            </span>
          ) : null}
        </span>
        {/* While a job's dragged: the quarter's two halves, the one it's over brighter. */}
        {draggingId && isQuarter ? (
          <span className="pointer-events-none absolute inset-0 flex text-[11px] font-semibold text-white">
            <span
              className="flex flex-1 items-center justify-center gap-1 transition-colors"
              style={{ backgroundColor: `color-mix(in srgb, ${colour} ${overHalf === "left" ? 97 : 82}%, transparent)` }}
            >
              <Lock size={11} className="shrink-0" />
              Qualified
            </span>
            <span
              className="flex flex-1 items-center justify-center gap-1 transition-colors"
              style={{ backgroundColor: `color-mix(in srgb, ${RED} ${overHalf === "right" ? 97 : 82}%, transparent)` }}
            >
              <Ban size={11} className="shrink-0" />
              Non qualified
            </span>
          </span>
        ) : null}
      </button>
    );
  };
  const stampClass = "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-[1px] text-[10.5px] font-medium";
  const stampStyle = { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" };

  // One completed job's row — in the period's list, and an opened bubble's.
  const renderRow = (row: CompletionRow) => {
                      const { record, project } = row;
                      const isSaving = saving === record.projectId;
                      const date = Number.isFinite(row.completedMs) ? new Date(row.completedMs) : null;
                      return (
                        <div key={record.projectId} data-board-card-id={record.projectId}>
                        <div
                          id={`completed-row-${record.projectId}`}
                          data-drag-ghost="compact"
                          draggable={canSortBonus || canRemove}
                          onDragStart={(event) => {
                            // (Not from its date field — that's for typing into.)
                            if ((event.target as HTMLElement).closest("input, select")) {
                              event.preventDefault();
                              return;
                            }
                            event.dataTransfer.setData("text/plain", record.projectId);
                            event.dataTransfer.effectAllowed = "move";
                            droppedOnBinRef.current = false;
                            setDraggingId(record.projectId);
                            if (rowDragGhost.transparentImageRef.current) event.dataTransfer.setDragImage(rowDragGhost.transparentImageRef.current, 0, 0);
                            rowDragGhost.spawn(event, `completed-row-${record.projectId}`, { label: record.projectName || "Untitled", color: GREEN });
                          }}
                          onDragEnd={() => {
                            setDraggingId("");
                            setDropBucket("");
                            setOverBin(false);
                            if (droppedOnBinRef.current) droppedOnBinRef.current = false;
                            else rowDragGhost.end(record.projectId);
                          }}
                          className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] border px-2.5 py-2 sm:flex-nowrap ${
                            canSortBonus || canRemove ? "cursor-grab active:cursor-grabbing" : ""
                          }`}
                          style={{
                            borderColor: record.deletedAtIso ? "var(--danger-border)" : "var(--glass-border)",
                            backgroundColor: "color-mix(in srgb, var(--panel-bg) 70%, transparent)",
                            opacity: draggingId === record.projectId ? 0.4 : isSaving ? 0.6 : 1,
                          }}
                        >
                          {/* Its day. */}
                          <span className="flex w-10 shrink-0 flex-col items-center">
                            <span className="text-[17px] font-medium leading-none tabular-nums" style={{ color: "var(--text-main)" }}>
                              {date ? date.getDate() : "–"}
                            </span>
                            <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.8px]" style={{ color: "var(--text-muted)" }}>
                              {date ? WEEKDAY_FORMAT.format(date) : ""}
                            </span>
                          </span>
                          <span className="min-w-0 flex-1 basis-[180px]">
                            {project && !record.deletedAtIso ? (
                              <button
                                type="button"
                                onClick={() => onOpenProject(project)}
                                className="block max-w-full truncate text-left text-[13.5px] font-medium transition hover:opacity-75"
                                style={{ color: "var(--text-main)" }}
                                title="Open the project"
                              >
                                {record.projectName || "Untitled"}
                              </button>
                            ) : (
                              <span className="block truncate text-[13.5px] font-medium" style={{ color: "var(--text-main)" }}>
                                {record.projectName || "Untitled"}
                              </span>
                            )}
                            <span className="block truncate text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                              {[record.customer, ...(project?.tags?.length ? project.tags : record.tags)].filter(Boolean).join(" · ") || "—"}
                            </span>
                            {/* Its stamps: a changed date, and anything since (only when there's one). */}
                            {record.dateChangedAtIso || record.deletedAtIso || (project && isProjectArchived(project)) ? (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {record.dateChangedAtIso ? (
                                <span
                                  className={stampClass}
                                  style={stampStyle}
                                  title={`First marked ${dateTimeLabel(record.markedAtIso)} — changed ${dateTimeLabel(record.dateChangedAtIso)}${record.dateChangedByName ? ` by ${record.dateChangedByName}` : ""}`}
                                >
                                  <PencilLine size={10} />
                                  {`Date changed${record.dateChangedByName ? ` by ${record.dateChangedByName}` : ""}`}
                                </span>
                              ) : null}
                              {record.deletedAtIso ? (
                                <span
                                  className={stampClass}
                                  style={{ ...stampStyle, color: "var(--danger-strong)", borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)" }}
                                  title={`Deleted ${dateTimeLabel(record.deletedAtIso)}${record.deletedByName ? ` by ${record.deletedByName}` : ""} — kept in the record`}
                                >
                                  <Trash2 size={10} />
                                  {`Deleted ${activeDate(record.deletedAtIso)}`}
                                </span>
                              ) : project && isProjectArchived(project) ? (
                                <span className={stampClass} style={stampStyle} title="Archived — see the Archive">
                                  <Archive size={10} />
                                  Archived
                                </span>
                              ) : null}
                            </span>
                            ) : null}
                          </span>
                          <span data-drag-ghost-hide className="flex shrink-0 items-center gap-2 max-sm:ml-[52px]">
                            {/* Its accepted quote under the bonus minimum (nothing when it's over, or there's none to check). */}
                            {canSortBonus && bonus.minimumQuote !== null && !record.deletedAtIso && acceptedQuotes[record.projectId] !== undefined
                              ? (() => {
                                  const quote = acceptedQuotes[record.projectId];
                                  const minimum = activeMoney(bonus.minimumQuote, { decimals: 0 });
                                  if (typeof quote !== "number" || quote >= bonus.minimumQuote) return null;
                                  return (
                                    <span
                                      className="glass-shine inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-medium"
                                      style={glassShineStyle("#D97706", { color: "#FFFFFF" })}
                                      title={`Accepted quote ${activeMoney(quote)} — under the ${minimum} bonus minimum`}
                                    >
                                      <AlertTriangle size={11} className="shrink-0" />
                                      {`Below ${minimum}`}
                                    </span>
                                  );
                                })()
                              : null}
                            {/* Its bonus quarter (locked) — as a qualified job, or non qualified — changeable here too (a phone
                                can't drag: "Sort"), from the app's glass dropdown. */}
                            {canSortBonus ? (
                              (() => {
                                const rowBucket = bucketOf(row);
                                const rowSorted = rowBucket !== "unsorted";
                                const rowSmall = isSmallBucket(rowBucket);
                                return (
                                  <span className={`inline-flex ${rowSorted ? "" : "sm:hidden"}`}>
                                    <GlassDropdown
                                      value={rowSorted ? rowBucket : ""}
                                      options={[
                                        { value: "", label: "Not sorted", color: "#64748B" },
                                        ...quarterStarts.flatMap((start) => [
                                          { value: quarterKeyOf(start), label: quarterLabel(start), color: GREEN },
                                          { value: `${quarterKeyOf(start)}|nq`, label: `${quarterLabel(start)} · Non qualified`, color: "#DC2626" },
                                        ]),
                                      ]}
                                      onChange={(next) => void sortInto(row, next)}
                                      disabled={Boolean(saving)}
                                      ariaLabel={`Bonus quarter for ${record.projectName}`}
                                      menuMinWidth={240}
                                      menuAlign="right"
                                      hideChevron
                                      triggerTitle={rowSorted ? `${bucketName(rowBucket)}${record.bonusSetByName ? ` — sorted by ${record.bonusSetByName}` : ""}` : "Sort into a bonus period"}
                                      triggerClassName={`${rowSorted ? "glass-shine" : `${neutralChip} border-dashed`} h-7 max-w-[210px] rounded-full px-2.5 text-[11.5px] font-medium`}
                                      triggerStyle={
                                        rowSmall
                                          ? glassShineStyle("#DC2626", { color: "#FFFFFF" })
                                          : rowSorted
                                            ? glassShineStyle(GREEN, { color: "#FFFFFF" })
                                            : { color: "var(--text-muted)" }
                                      }
                                      triggerContent={
                                        <span className="inline-flex min-w-0 items-center gap-1">
                                          {rowSmall ? <Ban size={11} className="shrink-0" /> : rowSorted ? <Lock size={11} className="shrink-0" /> : null}
                                          <span className="truncate">
                                            {rowSorted ? `${quarterShortLabel(quarterStartFromKey(quarterOfBucket(rowBucket)))}${rowSmall ? " · Non qualified" : ""}` : "Sort"}
                                          </span>
                                        </span>
                                      }
                                    />
                                  </span>
                                );
                              })()
                            ) : null}
                            {/* When it was completed — pressed, a calendar to change it (components/completed-date-picker.tsx). */}
                            {canEdit ? (
                              <CompletedDatePicker
                                valueIso={record.completedAtIso}
                                label={dateTimeLabel(record.completedAtIso)}
                                ariaLabel={`When ${record.projectName || "it"} was completed — change`}
                                accent={GREEN}
                                saving={saving === record.projectId}
                                chipClassName={neutralChip}
                                onSave={(iso) => void changeDate(row, iso)}
                              />
                            ) : (
                              <span
                                className={`${neutralChip} inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium tabular-nums`}
                                style={{ color: "var(--text-main)" }}
                              >
                                <CalendarDays size={12} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                                {dateTimeLabel(record.completedAtIso) || "No date"}
                              </span>
                            )}
                          </span>
                        </div>
                        </div>
                      );
  };

  // An opened bubble: its name, months and when it's paid, how many of each, its copy — then its qualified jobs and its
  // non qualified ones (not sorted: just its jobs).
  const openedHeader = (bucket: string) => {
    const isUnsorted = bucket === "unsorted";
    const start = quarterStartFromKey(bucket);
    return (
      <div className="glass-shine glass-shine-soft rounded-[22px] p-4" style={glassShineStyle(isUnsorted ? "#64748B" : GREEN)}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpenBucket(null)}
            className={`${neutralChip} inline-flex h-8 items-center gap-1 rounded-full pl-2 pr-3 text-[12px] font-medium transition hover:brightness-95`}
            style={{ color: "var(--text-main)" }}
          >
            <ChevronLeft size={14} />
            Back to the period
          </button>
          {!isUnsorted ? (
            <button
              type="button"
              onClick={() => void copyQuarter(bucket)}
              disabled={!bucketCount(bucket) && !bucketCount(`${bucket}|nq`)}
              className={`${neutralChip} ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition hover:brightness-95 disabled:opacity-50`}
              style={{ color: copiedKey === bucket ? GREEN : "var(--text-main)" }}
              title="Copy its jobs and when each was completed — qualified, then the small (non qualified) ones — as two tables"
            >
              {copiedKey === bucket ? <Check size={13} /> : <Copy size={13} />}
              {copiedKey === bucket ? "Copied" : `Copy ${bonusNames.word.toLowerCase()}`}
            </button>
          ) : null}
        </div>
        <p className="mt-3 text-[22px] font-medium leading-tight" style={{ color: "var(--text-main)" }}>
          {bucketName(bucket)}
        </p>
        <p className="mt-0.5 text-[12.5px] font-medium" style={{ color: "var(--text-muted)" }}>
          {isUnsorted
            ? "Completed jobs not in a quarter yet — drag them onto one."
            : `${periodLabel(start, bonusLength)} · paid in ${paidLabel(start, bonusLength, bonus.paidMonthsAfter)}`}
        </p>
        {!isUnsorted ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="glass-shine inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-medium" style={glassShineStyle(GREEN, { color: "#FFFFFF" })}>
              <Lock size={11} className="shrink-0" />
              {`${bucketCount(bucket)} qualified`}
            </span>
            <span className="glass-shine inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-medium" style={glassShineStyle("#DC2626", { color: "#FFFFFF" })}>
              <Ban size={11} className="shrink-0" />
              {`${bucketCount(`${bucket}|nq`)} non qualified`}
            </span>
          </div>
        ) : null}
      </div>
    );
  };
  const openedLists = (bucket: string) => {
    const isUnsorted = bucket === "unsorted";
    const list = (title: string, colour: string, items: CompletionRow[], empty: string, emptyHint?: string) => (
      <section key={title} className="mt-4">
        <div className="mb-1.5 flex items-center gap-2 px-1">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colour }} />
          <p className="text-[12px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
            {title}
          </p>
          <span className="rounded-full border px-2 py-[1px] text-[11px] font-medium tabular-nums" style={stampStyle}>
            {items.length}
          </span>
        </div>
        {items.length ? (
          <div className="space-y-1.5">{items.map(renderRow)}</div>
        ) : (
          <div className="rounded-[18px] border border-dashed" style={{ borderColor: "var(--glass-border)" }}>
            {query ? (
              <EmptyState compact icon={<Search size={16} />} title="No matches" hint="Try a different search" />
            ) : (
              <EmptyState compact icon={<CheckCircle2 size={16} />} title={empty} hint={emptyHint} />
            )}
          </div>
        )}
      </section>
    );
    if (load.status === "loading") {
      return (
        <SkeletonRows count={5} avatar={false} label="Loading the record" className="mt-4" />
      );
    }
    if (isUnsorted) return list("Not sorted", "#64748B", listRows, "Everything's sorted");
    return (
      <>
        {list("Qualified", GREEN, listRows.filter((row) => bucketOf(row) === bucket), "None yet", "Drop jobs on the left half of the quarter.")}
        {list("Non qualified", "#DC2626", listRows.filter((row) => bucketOf(row) === `${bucket}|nq`), "None yet", "Drop jobs on the right half of the quarter.")}
      </>
    );
  };

  return createPortal(
    // The same pop-up as everywhere else: glass backdrop, and the panel grows out of the card that opened it.
    <div className="fixed inset-0 z-[1600] flex items-center justify-center px-3 py-4 sm:px-4">
      <button type="button" aria-label="Close completed projects" onClick={onClose} className="glass-modal-backdrop absolute inset-0" />
      <div
        ref={panelRef}
        data-completed-projects-modal="true"
        role="dialog"
        aria-modal="true"
        aria-label="Completed projects"
        className={`glass-modal-panel relative z-[1601] flex h-[min(820px,90svh)] w-full flex-col overflow-hidden ${canSortBonus ? "max-w-[1220px]" : "max-w-[980px]"}`}
      >
        {/* As every pop-up's header (GlassModalHeader — the Schedule pop-up's): 56px, its icon and title in 14px bold capitals. */}
        <div className="glass-modal-header flex h-[56px] shrink-0 items-center gap-2 px-5">
          <CheckCircle2 size={16} className="shrink-0" style={{ color: "var(--text-main)" }} />
          <p className="min-w-0 truncate text-[14px] font-bold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
            Completed Projects
          </p>
          {/* The bin: faint until a project's dragged — then a "Remove" to drop it on (red under it). Dropped: confirmed
              first (removeTarget). */}
          {canRemove ? (
            <div
              onDragOver={(event) => {
                if (!draggingId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (!overBin) setOverBin(true);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setOverBin(false);
              }}
              onDrop={dropOnBin}
              title="Drag a project here to take it off the list"
              aria-label="Remove from the list — drag a project here"
              className={`ml-auto inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full transition-all duration-200 ${
                draggingId ? "glass-shine px-3.5" : "w-9 opacity-45 hover:opacity-80"
              }`}
              style={
                draggingId
                  ? glassShineStyle(RED, {
                      color: "#FFFFFF",
                      backgroundColor: overBin ? RED : `color-mix(in srgb, ${RED} 78%, var(--glass-modal-bg))`,
                      transform: overBin ? "scale(1.06)" : undefined,
                    })
                  : { color: "var(--text-muted)" }
              }
            >
              <Trash2 size={14} className="shrink-0" />
              {draggingId ? <span className="text-[12px] font-medium">{overBin ? "Drop to remove" : "Remove"}</span> : null}
            </div>
          ) : null}
          <div
            className={`glass-shine glass-shine-neutral ${canRemove ? "" : "ml-auto"} inline-flex h-9 min-w-0 items-center gap-2 rounded-full px-3`}
            style={{ width: "min(240px, 38vw)" }}
          >
            <Search size={13} className="shrink-0" style={{ color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              aria-label="Search completed projects"
              className="h-8 w-full min-w-0 bg-transparent text-[12px] font-medium outline-none"
              style={{ color: "var(--text-main)" }}
            />
            {search ? (
              <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="shrink-0" style={{ color: "var(--text-muted)" }}>
                <X size={13} />
              </button>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className={modalCloseButtonClass} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* The period: how long, when its cycle starts, and which one. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-5" style={{ borderColor: "var(--glass-border)" }}>
          {/* (Wrapping onto another line rather than scrolling sideways, so nothing cuts their shadows off.) */}
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {PERIOD_LENGTHS.map((length) => {
              const on = prefs.months === length.months;
              return (
                <button
                  key={length.months}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setOpenBucket(null);
                    changePrefs({ ...prefs, months: length.months });
                  }}
                  className={`${on ? "glass-shine" : neutralChip} inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[12px] font-medium transition hover:brightness-95`}
                  style={on ? glassShineStyle(GREEN, { color: "#FFFFFF" }) : { color: "var(--text-main)" }}
                >
                  {length.label}
                </button>
              );
            })}
          </div>
          {isAllTime ? null : (
            <div className="ml-auto flex items-center gap-1.5">
              {selectedStart !== currentStart ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpenBucket(null);
                    setPickedStart(null);
                  }}
                  className={`${neutralChip} inline-flex h-8 items-center gap-1 rounded-full px-3 text-[12px] font-medium transition hover:brightness-95`}
                  style={{ color: "var(--text-main)" }}
                >
                  <RotateCcw size={12} />
                  Now
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setOpenBucket(null);
                  setPickedStart(selectedStart - prefs.months);
                }}
                aria-label="The period before"
                className={`${neutralChip} inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:brightness-95`}
                style={{ color: "var(--text-main)" }}
              >
                <ChevronLeft size={15} />
              </button>
              <span className="flex min-w-[140px] flex-col items-center leading-tight">
                <span className="text-[13px] font-medium tabular-nums" style={{ color: "var(--text-main)" }}>
                  {periodLabel(selectedStart, prefs.months)}
                </span>
                {prefs.months === bonus.periodMonths ? (
                  <span className="text-[10.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                    {`Paid in ${paidLabel(selectedStart, prefs.months, bonus.paidMonthsAfter)}`}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => {
                  setOpenBucket(null);
                  setPickedStart(selectedStart + prefs.months);
                }}
                disabled={selectedStart >= currentStart}
                aria-label="The period after"
                className={`${neutralChip} inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:brightness-95 disabled:opacity-40`}
                style={{ color: "var(--text-main)" }}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 max-lg:flex-col">
        {canSortBonus ? (
          // The bonus quarters: down the side (narrower, a strip across the top) — oldest to newest, not sorted first and
          // non qualified last.
          <div
            ref={railRef}
            className="order-last flex shrink-0 gap-2 overflow-auto border-b px-4 py-3 [scrollbar-width:none] max-lg:order-first lg:w-[250px] lg:flex-col lg:border-b-0 lg:border-l lg:px-3 lg:py-4"
            style={{ borderColor: "var(--glass-border)" }}
            aria-label={`Bonus ${bonusNames.plural}`}
          >
            <div className="hidden px-1 pb-1 lg:block">
              <p className="text-[11px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                {`Bonus ${bonusNames.plural}`}
              </p>
            </div>
            {bubble("unsorted", "Not sorted", "Not in a quarter yet", "#64748B", Inbox)}
            {quarterStarts.map((start) =>
              bubble(
                quarterKeyOf(start),
                quarterLabel(start),
                `${periodLabel(start, bonusLength)} · paid ${MONTH_SHORT[monthOf(start + bonusLength - 1 + bonus.paidMonthsAfter)]}`,
                GREEN,
                null,
              ),
            )}
          </div>
        ) : null}
        <div ref={scrollRef} className="glass-scroll hide-native-scrollbar min-h-0 flex-1 overflow-auto px-4 pb-5 pt-4 sm:px-5">
          {/* The period at a glance: how many, by category, against the one before — and the recent periods. (An opened
              bubble instead: its own.) */}
          {openBucket && canSortBonus ? (
            openedHeader(openBucket)
          ) : (
          <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="glass-shine glass-shine-soft rounded-[22px] p-4" style={glassShineStyle(GREEN)}>
              <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
                <span className="text-[40px] font-medium leading-none tabular-nums" style={{ color: "var(--text-main)" }}>
                  {periodRows.length}
                </span>
                <span className="pb-1 text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                  {isAllTime
                    ? "completed all time"
                    : selectedStart === currentStart
                      ? `completed this ${periodWord}`
                      : `completed in ${periodLabel(selectedStart, prefs.months)}`}
                </span>
              </div>
            </div>
            {bars.length ? (
              <div className="glass-shine glass-shine-neutral flex flex-col rounded-[22px] px-4 pb-3 pt-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-[11px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-muted)" }}>
                    {`Recent ${periodWord}s`}
                  </p>
                  <p className="text-[11px] font-medium tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {`Average ${barsAverage.toFixed(1).replace(/\.0$/, "")} a ${periodWord}`}
                    {bestBar ? ` · Best ${bestBar.count}, ${periodLabel(bestBar.start, prefs.months)}` : ""}
                  </p>
                </div>
                <RecentPeriodsStrip
                  bars={bars}
                  selectedStart={selectedStart}
                  tallest={tallest}
                  months={prefs.months}
                  titleOf={(bar) =>
                    `${periodLabel(bar.start, prefs.months)}${prefs.months === bonus.periodMonths ? ` (paid in ${paidLabel(bar.start, prefs.months, bonus.paidMonthsAfter)})` : ""}: ${bar.count}`
                  }
                  onPick={(start) => setPickedStart(start === currentStart ? null : start)}
                />
              </div>
            ) : null}
          </div>
          )}

          {notice ? (
            <div
              className="mt-3 flex items-center justify-between gap-3 rounded-full border px-4 py-2 text-[12px] font-medium"
              style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
            >
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice("")} aria-label="Dismiss" className="shrink-0">
                <X size={14} />
              </button>
            </div>
          ) : null}

          {/* Each one completed, by month: when (changeable), its category (changeable), and its stamps. */}
          {openBucket && canSortBonus ? (
            openedLists(openBucket)
          ) : load.status === "loading" ? (
            <SkeletonRows count={5} avatar={false} label="Loading the record" className="mt-4" />
          ) : months.length === 0 ? (
            <div className="mt-4 rounded-[22px] border border-dashed" style={{ borderColor: "var(--text-main)" }}>
              {query ? (
                <EmptyState compact icon={<Search size={16} />} title="No matches" hint="Try a different search" />
              ) : (
                <EmptyState
                  compact
                  icon={<CheckCircle2 size={16} />}
                  title={isAllTime ? "No completed projects yet" : "Nothing completed in this period"}
                  hint="Projects show here once they're marked complete."
                />
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {months.map((month, monthIndex) => (
                <section key={month.key}>
                  <div className="mb-1.5 flex items-center gap-2 px-1">
                    <p className="text-[12px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                      {month.label}
                    </p>
                    <span className="rounded-full border px-2 py-[1px] text-[11px] font-medium tabular-nums" style={stampStyle}>
                      {month.rows.length}
                    </span>
                    {/* The period's copy (copyPeriod) — on the first month's bar; not while a bubble's pressed (that list
                        isn't the period). */}
                    {monthIndex === 0 && canSortBonus && !openBucket ? (
                      <button
                        type="button"
                        onClick={() => void copyPeriod()}
                        disabled={!periodRows.length}
                        className={`${neutralChip} ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium transition hover:brightness-95 disabled:opacity-50`}
                        style={{ color: copiedKey === "period" ? GREEN : "var(--text-main)" }}
                        title="Copy this period's jobs and when each was completed — sorted jobs, then the small (non qualified) ones — as two tables"
                      >
                        {copiedKey === "period" ? <Check size={12} /> : <Copy size={12} />}
                        {copiedKey === "period" ? "Copied" : copyPeriodLabel}
                      </button>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    {month.rows.map(renderRow)}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>
      <DragGhostLayer controller={rowDragGhost} />
      {/* Taking one off the list — confirmed first. */}
      {removeTarget ? (
        <div className="absolute inset-0 z-[1700] flex items-center justify-center px-4">
          <button type="button" aria-label="Keep it" onClick={() => setRemoveTarget(null)} className="glass-modal-backdrop absolute inset-0" />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Remove from the list"
            className="glass-modal-panel glass-bar-pop relative w-full max-w-[400px] overflow-hidden"
          >
            <GlassModalHeader title="Remove from the list?" icon={<Trash2 size={16} />} onClose={() => setRemoveTarget(null)} />
            <div className="space-y-2 px-5 py-4">
              <p className="text-[13px] font-medium leading-[1.5]" style={{ color: "var(--text-main)" }}>
                <b>{removeTarget.record.projectName || "Untitled"}</b> comes off Completed
                {bucketOf(removeTarget) !== "unsorted" ? ", and out of its bonus quarter" : ""}.
              </p>
              <p className="text-[12px] font-medium leading-[1.5]" style={{ color: "var(--text-muted)" }}>
                The project itself isn&apos;t changed. If it&apos;s reopened and completed again, it&apos;ll come back as a new completion.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button
                type="button"
                onClick={() => setRemoveTarget(null)}
                className="glass-shine glass-shine-neutral inline-flex h-9 items-center rounded-full px-4 text-[12.5px] font-medium"
                style={{ color: "var(--text-main)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void removeRow(removeTarget)}
                className="glass-shine inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-medium"
                style={glassShineStyle(RED, { color: "#FFFFFF" })}
              >
                <Trash2 size={13} />
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

type PeriodBar = { start: number; count: number };

// The periods' bars side by side, scrolled sideways: dragged with the mouse (or swiped) to look back through them, opened
// on the latest. Picking one is just that — the strip stays where it is; only when the period shown is changed some other
// way (the arrows above) and it's out of sight is it brought into view. Its edges fade where there's more to see.
function RecentPeriodsStrip({
  bars,
  selectedStart,
  tallest,
  months,
  titleOf,
  onPick,
}: {
  bars: PeriodBar[];
  selectedStart: number;
  tallest: number;
  months: number;
  titleOf: (bar: PeriodBar) => string;
  onPick: (start: number) => void;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const stripId = useId();
  const dragRef = useRef<{ pointerId: number; x: number; left: number; moved: boolean } | null>(null);
  // A drag's end isn't a click on the bar it ended over.
  const draggedRef = useRef(false);
  const pickedRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [edges, setEdges] = useState({ left: false, right: false });

  // Let go while it's moving: it glides on and slows to a stop — the production cutlist's change feed's glide (the same
  // friction): its speed at the moment it's let go (sampled as it's dragged, px a ms), worn down a little each frame
  // until it's all but stopped or reaches an end. Let go after holding still: it stays. Grabbed (or moved any other
  // way) mid-glide: it stops there.
  const GLIDE_MIN_VELOCITY = 0.03;
  const GLIDE_FRICTION_PER_MS = 0.0021;
  const GLIDE_STOP_VELOCITY = 0.015;
  const velocityRef = useRef(0);
  const lastMoveRef = useRef<{ x: number; t: number } | null>(null);
  const glideRafRef = useRef<number | null>(null);
  const stopGlide = () => {
    if (glideRafRef.current !== null) window.cancelAnimationFrame(glideRafRef.current);
    glideRafRef.current = null;
  };
  const glide = (initialVelocity: number) => {
    const el = stripRef.current;
    if (!el) return;
    let velocity = initialVelocity;
    let lastTime = performance.now();
    // Kept here to the fraction of a pixel (the strip's own scroll position may round a slow glide's small steps away).
    let position = el.scrollLeft;
    const step = (now: number) => {
      const dt = Math.min(48, now - lastTime);
      lastTime = now;
      velocity *= Math.exp(-GLIDE_FRICTION_PER_MS * dt);
      const max = el.scrollWidth - el.clientWidth;
      // (The bars follow the pointer: moving it right goes back — scrolls left.)
      const next = Math.min(max, Math.max(0, position - velocity * dt));
      position = next;
      el.scrollLeft = next;
      if (next <= 0 || next >= max || Math.abs(velocity) < GLIDE_STOP_VELOCITY) {
        glideRafRef.current = null;
        return;
      }
      glideRafRef.current = window.requestAnimationFrame(step);
    };
    glideRafRef.current = window.requestAnimationFrame(step);
  };
  useEffect(() => () => stopGlide(), []);

  // Where it's scrolled to: for its fades and arrows, and the scroll bar under it (the part showing, as fractions of it all).
  const [view, setView] = useState({ from: 0, size: 1 });
  const updateEdges = () => {
    const el = stripRef.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    const from = el.scrollWidth ? el.scrollLeft / el.scrollWidth : 0;
    const size = el.scrollWidth ? Math.min(1, el.clientWidth / el.scrollWidth) : 1;
    setView((prev) => (Math.abs(prev.from - from) < 0.001 && Math.abs(prev.size - size) < 0.001 ? prev : { from, size }));
  };
  // The arrows: most of a stripful at a time.
  const page = (direction: -1 | 1) => {
    stopGlide();
    const el = stripRef.current;
    if (el) el.scrollBy({ left: direction * Math.max(80, el.clientWidth * 0.8), behavior: "smooth" });
  };
  // The scroll bar: its handle dragged (or the bar pressed somewhere else — the handle jumps there first).
  const onTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = stripRef.current;
    const track = event.currentTarget;
    if (!el) return;
    stopGlide();
    event.preventDefault();
    const rect = track.getBoundingClientRect();
    const scale = el.scrollWidth / Math.max(1, rect.width);
    const handleLeft = rect.left + (el.scrollLeft / el.scrollWidth) * rect.width;
    const handleWidth = (el.clientWidth / el.scrollWidth) * rect.width;
    if (event.clientX < handleLeft || event.clientX > handleLeft + handleWidth) {
      el.scrollLeft = (event.clientX - rect.left - handleWidth / 2) * scale;
    }
    const startX = event.clientX;
    const startLeft = el.scrollLeft;
    try {
      track.setPointerCapture(event.pointerId);
    } catch {
      // (Not a pointer it can hold — it still follows while over the bar.)
    }
    const move = (moveEvent: PointerEvent) => {
      el.scrollLeft = startLeft + (moveEvent.clientX - startX) * scale;
    };
    const end = () => {
      track.removeEventListener("pointermove", move);
      track.removeEventListener("pointerup", end);
      track.removeEventListener("pointercancel", end);
    };
    track.addEventListener("pointermove", move);
    track.addEventListener("pointerup", end);
    track.addEventListener("pointercancel", end);
  };

  // Opened on the latest — and again for a different period length (a different set of bars) — and kept there as the
  // bars load and settle into their size, until it's moved (pinnedRef: still at the latest end).
  const pinnedRef = useRef(true);
  useLayoutEffect(() => {
    pinnedRef.current = true;
    const el = stripRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
    // (Its fades straight after — not left to the scroll event that follows.)
    queueMicrotask(updateEdges);
  }, [months]);
  useEffect(() => {
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollLeft = el.scrollWidth;
      updateEdges();
    });
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);
  // A mouse wheel over it scrolls it sideways — until it's at that end, when the window behind scrolls as usual.
  // (Its own listener: React's wheel events can't stop the page scrolling.)
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      if ((event.deltaY < 0 && el.scrollLeft <= 0) || (event.deltaY > 0 && el.scrollLeft >= max - 1)) return;
      event.preventDefault();
      if (glideRafRef.current !== null) window.cancelAnimationFrame(glideRafRef.current);
      glideRafRef.current = null;
      el.scrollLeft += event.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  // The period shown changed by the arrows, and out of sight: scrolled to. (Not when it was picked here.)
  useEffect(() => {
    if (pickedRef.current) {
      pickedRef.current = false;
      return;
    }
    const el = stripRef.current;
    const bar = el?.querySelector<HTMLElement>(`[data-bar-start="${selectedStart}"]`);
    if (!el || !bar) return;
    const barLeft = bar.offsetLeft;
    const barRight = barLeft + bar.offsetWidth;
    if (barLeft < el.scrollLeft) el.scrollTo({ left: barLeft - 8, behavior: "smooth" });
    else if (barRight > el.scrollLeft + el.clientWidth) el.scrollTo({ left: barRight - el.clientWidth + 8, behavior: "smooth" });
  }, [selectedStart]);

  const fade = 22;
  const mask = `linear-gradient(to right, ${edges.left ? "transparent" : "#000"} 0, #000 ${edges.left ? fade : 0}px, #000 calc(100% - ${
    edges.right ? fade : 0
  }px), ${edges.right ? "transparent" : "#000"} 100%)`;

  const canScroll = edges.left || edges.right;
  const arrowClass =
    "glass-shine glass-shine-neutral absolute top-[34px] z-[1] inline-flex h-7 w-7 items-center justify-center rounded-full transition hover:brightness-95";
  return (
    <div className="relative mt-2 flex flex-1 flex-col">
      <div
        ref={stripRef}
        id={stripId}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinnedRef.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
          updateEdges();
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse" || event.button !== 0) return;
          stopGlide();
          const el = stripRef.current;
          if (el && el.scrollWidth > el.clientWidth) {
            dragRef.current = { pointerId: event.pointerId, x: event.clientX, left: el.scrollLeft, moved: false };
            velocityRef.current = 0;
            lastMoveRef.current = { x: event.clientX, t: performance.now() };
          }
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          const el = stripRef.current;
          if (!drag || !el || drag.pointerId !== event.pointerId) return;
          const dx = event.clientX - drag.x;
          if (!drag.moved && Math.abs(dx) < 4) return;
          if (!drag.moved) {
            drag.moved = true;
            setDragging(true);
            try {
              el.setPointerCapture(event.pointerId);
            } catch {
              // (Not a pointer it can hold — it still drags while over the strip.)
            }
          }
          el.scrollLeft = drag.left - dx;
          // Its speed, smoothed over the last few moves (as the change feed's).
          const now = performance.now();
          const last = lastMoveRef.current;
          if (last && now - last.t > 4) {
            velocityRef.current = velocityRef.current * 0.6 + ((event.clientX - last.x) / (now - last.t)) * 0.4;
            lastMoveRef.current = { x: event.clientX, t: now };
          } else if (!last) {
            lastMoveRef.current = { x: event.clientX, t: now };
          }
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          dragRef.current = null;
          if (!drag.moved) return;
          setDragging(false);
          draggedRef.current = true;
          window.setTimeout(() => {
            draggedRef.current = false;
          }, 0);
          // Still moving as it's let go (not held still first): it glides on.
          const last = lastMoveRef.current;
          const velocity = last && performance.now() - last.t < 80 ? velocityRef.current : 0;
          velocityRef.current = 0;
          lastMoveRef.current = null;
          if (Math.abs(velocity) >= GLIDE_MIN_VELOCITY) glide(velocity);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onClickCapture={(event) => {
          if (!draggedRef.current) return;
          event.stopPropagation();
          event.preventDefault();
          draggedRef.current = false;
        }}
        onDragStart={(event) => event.preventDefault()}
        className={`hide-native-scrollbar relative flex-1 select-none overflow-x-auto overflow-y-hidden ${
          canScroll ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""
        }`}
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      >
        <div className="flex h-full w-max min-w-full items-end justify-end gap-1.5">
          {bars.map((bar) => {
            const on = bar.start === selectedStart;
            return (
              <button
                key={bar.start}
                type="button"
                data-bar-start={bar.start}
                onClick={() => {
                  pickedRef.current = true;
                  onPick(bar.start);
                }}
                title={titleOf(bar)}
                className={`group flex w-[34px] shrink-0 flex-col items-center gap-1 ${dragging ? "cursor-grabbing" : ""}`}
              >
                <span className="text-[11px] font-medium tabular-nums" style={{ color: on ? "var(--text-main)" : "var(--text-muted)" }}>
                  {bar.count}
                </span>
                <span className="flex h-[64px] w-full items-end">
                  <span
                    className={`w-full rounded-full transition group-hover:brightness-95 ${on ? "glass-shine" : ""}`}
                    style={{
                      ...(on ? glassShineStyle(GREEN) : { backgroundColor: `color-mix(in srgb, ${GREEN} 28%, var(--panel-muted))` }),
                      height: `${Math.max(6, (bar.count / tallest) * 64)}px`,
                    }}
                  />
                </span>
                {/* Its month, with its year under it (a calendar year: just the year) — short enough for a narrow bar. */}
                <span className="flex w-full flex-col items-center text-center font-medium leading-tight" style={{ color: on ? "var(--text-main)" : "var(--text-muted)" }}>
                  {months === 12 && monthOf(bar.start) === 0 ? (
                    <span className="text-[10px] tabular-nums">{yearOf(bar.start)}</span>
                  ) : (
                    <>
                      <span className="text-[10px]">{MONTH_SHORT[monthOf(bar.start)]}</span>
                      <span className="text-[9px] tabular-nums opacity-80">{`’${String(yearOf(bar.start)).slice(2)}`}</span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {/* There's more that way: an arrow to it, on that edge. */}
      {edges.left ? (
        <button type="button" onClick={() => page(-1)} aria-label="Earlier periods" title="Earlier periods" className={`${arrowClass} left-0`} style={{ color: "var(--text-main)" }}>
          <ChevronLeft size={15} />
        </button>
      ) : null}
      {edges.right ? (
        <button type="button" onClick={() => page(1)} aria-label="Later periods" title="Later periods" className={`${arrowClass} right-0`} style={{ color: "var(--text-main)" }}>
          <ChevronRight size={15} />
        </button>
      ) : null}
      {/* A slim scroll bar: where the bars showing are in all of them — dragged (or pressed) to move through them. */}
      {canScroll ? (
        <div
          onPointerDown={onTrackPointerDown}
          role="scrollbar"
          aria-label="Scroll through the periods"
          aria-orientation="horizontal"
          aria-controls={stripId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((view.from / Math.max(0.001, 1 - view.size)) * 100)}
            className="mt-1.5 cursor-pointer touch-none py-1"
        >
          <div className="relative h-[5px] rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--text-main) 9%, transparent)" }}>
            <div
              className="absolute inset-y-0 rounded-full"
              style={{ left: `${view.from * 100}%`, width: `${view.size * 100}%`, backgroundColor: `color-mix(in srgb, ${GREEN} 55%, transparent)` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
