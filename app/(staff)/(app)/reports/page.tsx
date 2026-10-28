"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { ChevronDown, Clock, DollarSign, Inbox, ListChecks, Minus, Plus, RefreshCw, RotateCcw, Search, Trophy, X, type LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useDevModeOn } from "@/lib/dev-mode";
import { activeDate, activeMoney, useCompanyFormats } from "@/lib/company-formats";
import {
  fetchCompanyDoc,
  fetchCompanyLeads,
  fetchCompanyMembers,
  fetchProjectQuoteOutcomes,
  fetchProjects,
  type ProjectQuoteOutcome,
} from "@/lib/firestore-data";
import { glassShineStyle } from "@/lib/glass-shine";
import { isPreviewMode } from "@/lib/preview-mode";
import { completedStatusMatcher } from "@/lib/project-archive";
import {
  buildReport,
  focusReportInput,
  REPORT_RANGES,
  reportPersonKey,
  reportProjectPerson,
  reportRangeFor,
  type ReportData,
  type ReportHeadlines,
  type ReportInput,
  type ReportLead,
  type ReportProject,
  type ReportRangeId,
  type ReportStatus,
} from "@/lib/reports";
import { hasPermissionKey, useCompanyAccess } from "@/lib/use-company-access";

// Reports (the sidebar's, for a role holding company.report): the company's figures over a stretch — leads converted,
// quote win rate, average job value and days to complete across the top (each against the stretch before); quotes sent
// vs won by week / month; days in each stage; the pipeline now; each salesperson's figures; where the leads came from.
// Worked out in lib/reports.ts from the company's projects (their quotes, status history) and leads, loaded here.

const PANEL_STYLE = {
  borderColor: "var(--glass-border)",
  backgroundColor: "var(--glass-bg-strong)",
  backdropFilter: "blur(20px) saturate(180%)",
  WebkitBackdropFilter: "blur(20px) saturate(180%)",
  boxShadow: "inset 0 1px 0 var(--glass-highlight), var(--shadow-glass)",
};
const MUTED = { color: "var(--text-muted)" };
const MAIN = { color: "var(--text-main)" };
// The project statuses a company has before it sets its own (the Dashboard's).
const DEFAULT_STATUSES = [
  { name: "New", color: "#3060D0" },
  { name: "In Production", color: "#2A7A3B" },
  { name: "On Hold", color: "#C77700" },
  { name: "Complete", color: "#2A7A3B" },
];

// A few at a time (each a project's quotes).
async function mapInBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(...(await Promise.all(items.slice(index, index + size).map(run))));
  }
  return out;
}

const percent = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);
const money = (value: number | null) => (value === null ? "—" : activeMoney(value, { decimals: 0 }));
const days = (value: number | null) => (value === null ? "—" : value < 1 ? "<1 day" : `${Math.round(value)} ${Math.round(value) === 1 ? "day" : "days"}`);
// "$12k" / "$1.2m" — the chart's scale.
const shortMoney = (value: number) => {
  const symbol = activeMoney(0, { decimals: 0 }).replace(/[\d.,\s]/g, "") || "$";
  if (value >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  if (value >= 1_000) return `${symbol}${Math.round(value / 1_000)}k`;
  return `${symbol}${Math.round(value)}`;
};

type Loaded = { companyId: string; input: Omit<ReportInput, "nowMs"> };
// What your Reports count (yours alone): the staff and projects you've switched off (Included), and when you last reset
// them (Reset stats — the company read again as it was then: projects deleted from the Archive before it don't count).
type ReportsView = { hiddenPeople: string[]; hiddenProjects: string[]; resetAtIso?: string };
const NOTHING_HIDDEN: ReportsView = { hiddenPeople: [], hiddenProjects: [] };
// ...as saved in this browser under its key; nothing hidden without one.
function readReportsView(storageKey: string): ReportsView {
  if (!storageKey || typeof window === "undefined") return NOTHING_HIDDEN;
  try {
    const raw = JSON.parse(window.localStorage.getItem(storageKey) || "null") as Record<string, unknown> | null;
    const list = (value: unknown) => (Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : []);
    if (!raw || typeof raw !== "object") return NOTHING_HIDDEN;
    const resetAtIso = typeof raw.resetAtIso === "string" && Number.isFinite(Date.parse(raw.resetAtIso)) ? raw.resetAtIso : undefined;
    return { hiddenPeople: list(raw.hiddenPeople), hiddenProjects: list(raw.hiddenProjects), ...(resetAtIso ? { resetAtIso } : {}) };
  } catch {
    return NOTHING_HIDDEN;
  }
}

export default function ReportsPage() {
  const { user } = useAuth();
  const access = useCompanyAccess();
  useCompanyFormats();
  // Reset stats: only while dev mode's on (a Dev user — public/dev-emails.txt — who's switched it on; lib/dev-mode.ts).
  const devModeOn = useDevModeOn();
  const canAccessReports = access.status === "ready" && hasPermissionKey(access.permissionKeys, "company.report");
  const [rangeId, setRangeId] = useState<ReportRangeId>("quarter");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const companyId = access.status === "ready" ? String(access.companyId || "").trim() : "";
  useEffect(() => {
    if (!canAccessReports || !companyId || !user?.uid) return;
    let cancelled = false;
    void (async () => {
      try {
        const [projects, companyDoc, members, storedLeads] = await Promise.all([
          // Archived ones, and those deleted from the Archive (kept as text-only records), still count.
          fetchProjects(user.uid, [companyId], { lightweight: true, archived: "include", includePurged: true }),
          fetchCompanyDoc(companyId),
          fetchCompanyMembers(companyId),
          fetchCompanyLeads(companyId).catch(() => []),
        ]);
        // In the Preview its live leads are the Leads page's own, kept in the browser (lib/preview-seed.ts).
        let previewLeads: ReportLead[] = [];
        if (isPreviewMode()) {
          try {
            const raw = JSON.parse(window.localStorage.getItem(`cutsmart_sample_leads:${companyId}`) || "[]") as unknown;
            previewLeads = Array.isArray(raw) ? (raw as ReportLead[]) : [];
          } catch {
            previewLeads = [];
          }
        }
        // Not the small jobs (Small Jobs — lib/small-jobs.ts).
        const companyProjects = projects.filter((project) => String(project.companyId || companyId) === companyId && !project.isSmallJob);
        const outcomes = await mapInBatches(companyProjects, 6, (project) => fetchProjectQuoteOutcomes(project));
        const quotes: Record<string, ProjectQuoteOutcome[]> = {};
        companyProjects.forEach((project, index) => {
          quotes[project.id] = outcomes[index];
        });
        const rawStatuses = Array.isArray(companyDoc?.projectStatuses) ? (companyDoc.projectStatuses as Array<Record<string, unknown>>) : [];
        const isComplete = completedStatusMatcher(companyDoc?.projectStatuses);
        // In the board's order; the won one (Company Settings › Project statuses › Won) — the first, if more.
        let wonTaken = false;
        const statuses: ReportStatus[] = (rawStatuses.length ? rawStatuses : DEFAULT_STATUSES)
          .map((row) => ({
            name: String(row.name ?? "").trim(),
            color: String(row.color ?? "#94A3B8").trim() || "#94A3B8",
            won: (row as Record<string, unknown>).isWon === true,
            // Its sub-board's columns, in order.
            subStages: (Array.isArray((row as Record<string, unknown>).subStages) ? ((row as Record<string, unknown>).subStages as Array<Record<string, unknown>>) : [])
              .map((sub) => ({ name: String(sub?.name ?? "").trim(), color: String(sub?.color ?? "#94A3B8").trim() || "#94A3B8" }))
              .filter((sub) => sub.name),
          }))
          .filter((row) => row.name)
          .map(({ won, ...row }) => {
            const isWon = won && !wonTaken;
            if (isWon) wonTaken = true;
            return { ...row, isComplete: isComplete(row.name), isWon };
          });
        const leadIds = new Set<string>();
        const leads: ReportLead[] = [...previewLeads, ...storedLeads]
          .filter((lead) => {
            if (!lead?.id || leadIds.has(lead.id)) return false;
            leadIds.add(lead.id);
            return true;
          })
          .map((lead) => ({
            id: lead.id,
            createdAtIso: String(lead.createdAtIso || ""),
            status: String(lead.status || ""),
            source: String(lead.source || ""),
            sourceDetail: lead.sourceDetail,
            formName: lead.formName,
            isDeleted: lead.isDeleted,
            deletedAtIso: lead.deletedAtIso,
            convertedProjectId: lead.convertedProjectId,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            assignedToUid: lead.assignedToUid,
            assignedToName: lead.assignedToName,
          }));
        if (cancelled) return;
        setLoaded({
          companyId,
          input: {
            projects: companyProjects.map((project) => ({
              id: project.id,
              name: project.name,
              statusLabel: project.statusLabel,
              createdAt: project.createdAt,
              completedAtIso: project.completedAtIso,
              isArchived: project.isArchived,
              assignedToUid: project.assignedToUid,
              assignedTo: project.assignedToName || project.assignedTo,
              statusHistory: project.statusHistory,
              sourceLeadId: project.sourceLeadId,
              customer: project.customer,
              clientEmail: project.clientEmail,
              clientPhone: project.clientPhone,
              isPurged: project.isPurged,
              purgedAtIso: project.purgedAtIso,
            })),
            leads,
            quotes,
            statuses,
            people: members.map((member) => ({
              uid: member.uid,
              name: member.displayName || member.membershipDisplayName || "Team member",
              color: member.userColor || member.badgeColor || "#94A3B8",
            })),
          },
        });
        setLoadError(false);
        setNowMs(Date.now());
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canAccessReports, companyId, user?.uid, loadKey]);

  // Included: its panel open or not, and the staff and projects you've switched off (yours alone — remembered in this
  // browser, for this company).
  const [isProjectsPanelOpen, setIsProjectsPanelOpen] = useState(false);
  // Sliding out: still there while it goes (as CNC Cutlist's Visibility sidebar), the report only widening back after.
  const [isProjectsPanelClosing, setIsProjectsPanelClosing] = useState(false);
  const projectsPanelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleProjectsPanel = () => {
    if (projectsPanelTimeoutRef.current) clearTimeout(projectsPanelTimeoutRef.current);
    if (!isProjectsPanelOpen || isProjectsPanelClosing) {
      setIsProjectsPanelClosing(false);
      setIsProjectsPanelOpen(true);
      return;
    }
    setIsProjectsPanelClosing(true);
    projectsPanelTimeoutRef.current = setTimeout(() => {
      setIsProjectsPanelOpen(false);
      setIsProjectsPanelClosing(false);
      projectsPanelTimeoutRef.current = null;
    }, 360);
  };
  const viewStorageKey = user?.uid && companyId ? `cutsmart.web.reports.view.${user.uid}.${companyId}` : "";
  const [viewState, setViewState] = useState<{ key: string; view: ReportsView }>({ key: "", view: NOTHING_HIDDEN });
  const view = useMemo(
    () => (viewState.key === viewStorageKey ? viewState.view : readReportsView(viewStorageKey)),
    [viewState, viewStorageKey],
  );
  const saveView = (next: ReportsView) => {
    setViewState({ key: viewStorageKey, view: next });
    if (!viewStorageKey) return;
    try {
      window.localStorage.setItem(viewStorageKey, JSON.stringify(next));
    } catch {
      // Storage unavailable — it just won't be remembered.
    }
  };
  // Switched on or off (Included): staff, or projects.
  const setShownInView = (kind: "people" | "projects", ids: string[], shown: boolean) => {
    const field = kind === "people" ? "hiddenPeople" : "hiddenProjects";
    const next = new Set(view[field]);
    ids.forEach((id) => (shown ? next.delete(id) : next.add(id)));
    saveView({ ...view, [field]: [...next] });
  };

  // The company as your Reports read it: since your last reset, without the projects deleted from the Archive before it.
  const companyInput = useMemo(() => {
    if (!loaded || loaded.companyId !== companyId) return null;
    const resetAtMs = view.resetAtIso ? Date.parse(view.resetAtIso) : Number.NaN;
    if (!Number.isFinite(resetAtMs)) return loaded.input;
    const goneBefore = (project: ReportProject) => {
      if (!project.isPurged) return false;
      const purgedMs = Date.parse(String(project.purgedAtIso || ""));
      return !Number.isFinite(purgedMs) || purgedMs <= resetAtMs;
    };
    return { ...loaded.input, projects: loaded.input.projects.filter((project) => !goneBefore(project)) };
  }, [companyId, loaded, view.resetAtIso]);
  const range = useMemo(() => reportRangeFor(rangeId, nowMs), [rangeId, nowMs]);
  const report = useMemo(() => {
    if (!companyInput) return null;
    const input = focusReportInput(companyInput, { hiddenPeople: new Set(view.hiddenPeople), hiddenProjects: new Set(view.hiddenProjects) });
    return buildReport({ ...input, nowMs }, range);
  }, [companyInput, nowMs, range, view.hiddenPeople, view.hiddenProjects]);
  // The panel's projects: each with its salesperson and status (its colour).
  const projectRows = useMemo<IncludedProjectRow[]>(() => {
    if (!companyInput) return [];
    const statusColor = new Map(companyInput.statuses.map((status) => [status.name.toLowerCase(), status.color]));
    const personColor = new Map(companyInput.people.map((person) => [person.uid, person.color]));
    return companyInput.projects
      .map((project) => {
        const person = reportProjectPerson(project, companyInput.people);
        return {
          id: project.id,
          name: String(project.name || "").trim(),
          personKey: person.key,
          personName: person.name,
          personColor: personColor.get(String(project.assignedToUid || "")) ?? "#94A3B8",
          status: project.statusLabel || "New",
          statusColor: statusColor.get(String(project.statusLabel || "").toLowerCase()) ?? "#94A3B8",
          createdAt: project.createdAt,
          isArchived: Boolean(project.isArchived),
          isPurged: Boolean(project.isPurged),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [companyInput]);
  // The panel's staff: everyone in the company, and anyone else projects are assigned to (someone who's left,
  // Unassigned) — each with how many projects are theirs.
  const staffRows = useMemo<IncludedStaffRow[]>(() => {
    if (!loaded) return [];
    const out = new Map<string, IncludedStaffRow>(
      loaded.input.people.map((person) => [reportPersonKey(person.uid, person.name), { key: reportPersonKey(person.uid, person.name), name: person.name, color: person.color, count: 0 }]),
    );
    for (const row of projectRows) {
      const person = out.get(row.personKey) ?? { key: row.personKey, name: row.personName, color: row.personColor, count: 0 };
      person.count += 1;
      out.set(row.personKey, person);
    }
    return [...out.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [loaded, projectRows]);
  // Reset stats (asked first, in a pop-up): the whole company read again, as it is now — every figure worked out afresh
  // from the projects still there (archived ones too, history and all); those deleted from the Archive stop counting.
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const resetStats = () => {
    saveView({ ...view, resetAtIso: new Date().toISOString() });
    setLoadKey((key) => key + 1);
    setIsResetConfirmOpen(false);
  };
  // How many projects your Reports count.
  const projectsOn = projectRows.filter((row) => !view.hiddenProjects.includes(row.id) && !view.hiddenPeople.includes(row.personKey)).length;
  // The panel there (not on its way out).
  const panelShown = isProjectsPanelOpen && !isProjectsPanelClosing && Boolean(loaded);

  const notice = (body: ReactNode) => (
    <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}>
      {body}
    </div>
  );
  if (access.status === "loading") return notice("Checking access...");
  if (access.status === "error") {
    return notice(
      <>
        <p>Couldn&apos;t check your access to Reports — the connection may be slow or offline.</p>
        <button
          type="button"
          onClick={() => access.retry()}
          className="mt-3 inline-flex h-9 items-center rounded-full border px-3 text-[12px] font-bold hover:brightness-95"
          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
        >
          Retry
        </button>
      </>,
    );
  }
  if (!canAccessReports) return notice("You do not have permission to access Reports.");

  return (
    <div className="space-y-4 pb-10">
      {/* The stretch it's for: a glass bubble each, the picked one in the brand's colour. */}
      <div className="flex flex-wrap items-center gap-2">
        {REPORT_RANGES.map((option) => {
          const active = option.id === rangeId;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setRangeId(option.id)}
              aria-pressed={active}
              className={`inline-flex h-9 items-center rounded-full border px-4 text-[13px] font-medium transition hover:brightness-95 ${active ? "glass-shine text-white" : ""}`}
              style={active ? glassShineStyle("var(--brand)") : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
            >
              {option.label}
            </button>
          );
        })}
        <span className="ml-auto" />
        <button
          type="button"
          onClick={toggleProjectsPanel}
          aria-expanded={panelShown}
          className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition hover:brightness-95 ${panelShown ? "glass-shine text-white" : ""}`}
          style={panelShown ? glassShineStyle("var(--brand)") : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
        >
          <ListChecks size={15} />
          Included
          {loaded ? (
            <span
              className="rounded-full px-1.5 text-[11px] font-semibold"
              style={{ backgroundColor: panelShown ? "rgba(255,255,255,0.25)" : "color-mix(in srgb, var(--text-main) 8%, transparent)" }}
            >
              {projectsOn}/{projectRows.length}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setLoadKey((key) => key + 1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border hover:brightness-95"
          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      <div
        className="lg:grid lg:items-start"
        style={{
          gridTemplateColumns: `minmax(0, 1fr) ${panelShown ? 360 : 0}px`,
          columnGap: panelShown ? 16 : 0,
          transition: panelShown
            ? "grid-template-columns 180ms ease, column-gap 180ms ease"
            : "grid-template-columns 200ms ease 280ms, column-gap 200ms ease 280ms",
        }}
      >
      <div className="min-w-0 space-y-4">
      {loadError && !report
        ? notice(
            <>
              <p>Couldn&apos;t load the figures — the connection may be slow or offline.</p>
              <button
                type="button"
                onClick={() => setLoadKey((key) => key + 1)}
                className="mt-3 inline-flex h-9 items-center rounded-full border px-3 text-[12px] font-bold hover:brightness-95"
                style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
              >
                Retry
              </button>
            </>,
          )
        : !report
          ? notice("Working out the figures...")
          : (
            <>
              <HeadlineCards headlines={report.headlines} previous={report.previous} />
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel
                  title="Quoted vs won"
                  note={
                    report.wonStatus
                      ? `Each project's latest quote, by when it was first sent — and the jobs won (a quote accepted, or reaching ${report.wonStatus})`
                      : "Each project's latest quote, by when it was first sent — and what clients accepted"
                  }
                >
                  <QuotesChart buckets={report.buckets} />
                </Panel>
                <Panel title="Average days in each stage" note="How long projects sit in each status before moving on">
                  {report.stageHistoryCount ? (
                    <StageBars stages={report.stages} />
                  ) : (
                    <p className="py-8 text-center text-[13px] font-medium" style={MUTED}>
                      Status changes are recorded from now on — this fills in as projects move through your statuses.
                    </p>
                  )}
                </Panel>
              </div>
              <Panel title="Pipeline right now" note="Projects on the board, in each status">
                <Pipeline rows={report.pipeline} />
              </Panel>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <Panel title="By salesperson" note="Projects assigned to each person, in this period">
                  <PeopleTable rows={report.people} />
                </Panel>
                <Panel title="Where leads came from" note="Leads in this period, and how many converted">
                  <Sources rows={report.sources} />
                </Panel>
              </div>
            </>
          )}
      </div>
      {/* Reset stats (dev mode only): floating at the bottom right — beside Included while it's open on a computer. */}
      {devModeOn && loaded ? (
        <button data-bottom-bar=""
          type="button"
          onClick={() => setIsResetConfirmOpen(true)}
          title={view.resetAtIso ? `Last reset ${activeDate(view.resetAtIso)}` : "Work your stats out again from the company as it is now"}
          className={`glass-shine fixed bottom-6 right-6 z-[100] inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[13px] font-medium text-white shadow-[0_10px_28px_rgba(15,23,42,0.22)] transition-[right,filter] duration-200 hover:brightness-95 max-lg:bottom-[calc(16px+env(safe-area-inset-bottom))] max-lg:right-4 ${
            panelShown ? "lg:right-[404px]" : ""
          }`}
          style={glassShineStyle("var(--brand)")}
        >
          <RotateCcw size={15} />
          Reset stats
        </button>
      ) : null}
      {isResetConfirmOpen ? createPortal(
        <div className="glass-modal-backdrop fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={() => setIsResetConfirmOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Reset your stats"
            className="glass-modal-panel w-full max-w-[420px] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <GlassModalHeader title="Reset your stats?" onClose={() => setIsResetConfirmOpen(false)} />
            <div className="space-y-4 px-5 py-4">
              <p className="text-[13px] font-medium" style={MAIN}>
                Your stats are worked out again from the company as it is now — projects deleted from the Archive stop counting.
              </p>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={resetStats}
                  className="glass-shine inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium text-white hover:brightness-95"
                  style={glassShineStyle("var(--brand)")}
                >
                  <RotateCcw size={14} />
                  Reset stats
                </button>
              </div>
            </div>
          </div>
        </div>
      , document.body) : null}
      {isProjectsPanelOpen && loaded ? (
        <IncludedPanel
          rows={projectRows}
          staff={staffRows}
          statusOrder={loaded.input.statuses.map((status) => status.name)}
          hiddenPeople={new Set(view.hiddenPeople)}
          hiddenProjects={new Set(view.hiddenProjects)}
          onShown={setShownInView}
          onClose={toggleProjectsPanel}
          closing={isProjectsPanelClosing}
        />
      ) : null}
      </div>
    </div>
  );
}

type IncludedProjectRow = {
  id: string;
  name: string;
  personKey: string;
  personName: string;
  personColor: string;
  status: string;
  statusColor: string;
  createdAt: string;
  isArchived: boolean;
  isPurged: boolean;
};
type IncludedStaffRow = { key: string; name: string; color: string; count: number };

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
// Dark text on a light colour, white on a dark one.
const textOnColor = (hex: string) => {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (!value) return "#0F172A";
  const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.62 ? "#0F172A" : "#FFFFFF";
};

// Included (beside the report on a computer; a page of its own on a phone): what your Reports count — yours alone. Two
// tabs: Staff — a tick each (all their projects and leads); Projects — a tick each, by status (the board's order), a pill
// each (all its projects at once; folded away or not) — one whose staff member's off sitting greyed, its tick off. Each
// with a search, and All / None (of what it shows).
function IncludedPanel({
  rows,
  staff,
  statusOrder,
  hiddenPeople,
  hiddenProjects,
  onShown,
  onClose,
  closing,
}: {
  rows: IncludedProjectRow[];
  staff: IncludedStaffRow[];
  statusOrder: string[];
  hiddenPeople: ReadonlySet<string>;
  hiddenProjects: ReadonlySet<string>;
  onShown: (kind: "people" | "projects", ids: string[], shown: boolean) => void;
  onClose: () => void;
  // On its way out.
  closing: boolean;
}) {
  const [tab, setTab] = useState<"staff" | "projects">("staff");
  const [search, setSearch] = useState("");
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const onStaff = tab === "staff";
  const query = search.trim().toLowerCase();
  const shownStaff = staff.filter((person) => !query || person.name.toLowerCase().includes(query));
  const shownRows = rows.filter((row) => !query || [row.name, row.personName, row.status].some((value) => value.toLowerCase().includes(query)));
  const groups = new Map<string, IncludedProjectRow[]>();
  for (const row of shownRows) groups.set(row.status, [...(groups.get(row.status) ?? []), row]);
  const rank = (status: string) => {
    const at = statusOrder.findIndex((name) => name.toLowerCase() === status.toLowerCase());
    return at < 0 ? statusOrder.length : at;
  };
  // A project whose staff member's off: its tick off, and not to be changed here.
  const lockedOf = (row: IncludedProjectRow) => hiddenPeople.has(row.personKey);
  const tickedOf = (row: IncludedProjectRow) => !lockedOf(row) && !hiddenProjects.has(row.id);
  const setTicked = (rowsToSet: IncludedProjectRow[], ticked: boolean) => {
    const ids = rowsToSet.filter((row) => !lockedOf(row)).map((row) => row.id);
    if (ids.length) onShown("projects", ids, ticked);
  };
  const staffOn = staff.filter((person) => !hiddenPeople.has(person.key)).length;
  const projectsOn = rows.filter(tickedOf).length;
  const setAll = (on: boolean) => (onStaff ? onShown("people", shownStaff.map((person) => person.key), on) : setTicked(shownRows, on));
  const fieldStyle = { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" };
  return (
    // Sliding in from the right (the glass bubbles' bounce — a phone's page, all the way across, as the Notifications
    // drawer), and back out the same way.
    <aside
      className={`rounded-[18px] border p-4 max-lg:fixed max-lg:inset-0 max-lg:z-[120] max-lg:overflow-y-auto max-lg:rounded-none max-lg:border-0 max-lg:bg-[var(--bg-app)] max-lg:p-3 lg:sticky lg:top-[64px] lg:max-h-[calc(100svh-84px)] lg:overflow-y-auto motion-reduce:animate-none ${
        closing
          ? "max-lg:animate-[side-sheet-out_280ms_ease_both] lg:animate-[glass-bubble-slide-out-right_280ms_ease_both]"
          : "max-lg:animate-[notif-drawer-in_320ms_cubic-bezier(0.22,1,0.36,1)_both] lg:animate-[glass-bubble-slide-in-right_480ms_cubic-bezier(0.34,1.56,0.64,1)_both]"
      }`}
      style={PANEL_STYLE}
      aria-label="Included"
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[15px] font-medium" style={MAIN}>
          Included
        </p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border hover:brightness-95"
          style={fieldStyle}
          aria-label="Close Included"
        >
          <X size={15} />
        </button>
      </div>
      {/* Staff / Projects — each with how many are on. */}
      <div
        className="mt-3 grid grid-cols-2 gap-1 rounded-full border p-1"
        style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--text-main) 4%, transparent)" }}
        role="tablist"
      >
        {(
          [
            { id: "staff", label: "Staff", on: staffOn, of: staff.length },
            { id: "projects", label: "Projects", on: projectsOn, of: rows.length },
          ] as const
        ).map((option) => {
          const active = tab === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setTab(option.id);
                setSearch("");
              }}
              className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full text-[12.5px] font-medium transition ${active ? "glass-shine text-white" : "hover:brightness-95"}`}
              style={active ? glassShineStyle("var(--brand)") : { color: "var(--text-muted)" }}
            >
              {option.label}
              <span className="text-[11px]" style={{ opacity: 0.8 }}>
                {option.on}/{option.of}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="relative min-w-0 flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={MUTED} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={onStaff ? "Search staff..." : "Search projects..."}
            aria-label={onStaff ? "Search staff" : "Search projects"}
            className="h-8 w-full rounded-full border pl-8 pr-3 text-[12px]"
            style={fieldStyle}
          />
        </span>
        {(
          [
            { label: "All", on: true },
            { label: "None", on: false },
          ] as const
        ).map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => setAll(option.on)}
            className="h-8 shrink-0 rounded-full border px-3 text-[11px] font-bold hover:brightness-95"
            style={fieldStyle}
          >
            {option.label}
          </button>
        ))}
      </div>
      {onStaff ? (
        <div className="mt-4 space-y-1">
          {shownStaff.map((person) => {
            const isOn = !hiddenPeople.has(person.key);
            return (
              <label
                key={person.key}
                className="flex cursor-pointer items-center gap-2 rounded-[16px] border px-3 py-2 transition"
                style={{ ...fieldStyle, opacity: isOn ? 1 : 0.55 }}
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={(e) => onShown("people", [person.key], e.target.checked)}
                  className="h-4 w-4 shrink-0"
                  aria-label={`${person.name}: included`}
                />
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-white" style={{ backgroundColor: person.color }}>
                  {initialsOf(person.name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium" style={MAIN}>
                  {person.name}
                </span>
                <span className="shrink-0 text-[11px]" style={MUTED}>
                  {person.count} {person.count === 1 ? "project" : "projects"}
                </span>
              </label>
            );
          })}
          {shownStaff.length === 0 ? (
            <p className="rounded-[16px] border border-dashed px-3 py-4 text-center text-[12px] font-semibold" style={{ borderColor: "var(--glass-border)", color: "var(--text-muted)" }}>
              {staff.length ? "No staff match the search." : "No staff yet."}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 space-y-1">
          {[...groups.entries()]
            .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
            .map(([status, statusRows]) => {
              const color = statusRows[0].statusColor;
              const ink = textOnColor(color);
              const changeable = statusRows.filter((row) => !lockedOf(row));
              const ticked = changeable.filter(tickedOf).length;
              const isFolded = Boolean(folded[status]);
              return (
                <div key={status} className="space-y-1">
                  <div className="flex items-center justify-between rounded-full pl-[5px] text-[11px] font-extrabold" style={{ backgroundColor: color, color: ink }}>
                    <span style={{ paddingLeft: 5 }}>
                      {status} ({statusRows.length})
                    </span>
                    <div className="ml-auto inline-flex items-center">
                      <span className="inline-flex h-7 items-center self-center pr-2">
                        <input
                          type="checkbox"
                          checked={changeable.length > 0 && ticked === changeable.length}
                          disabled={changeable.length === 0}
                          ref={(el) => {
                            if (el) el.indeterminate = ticked > 0 && ticked < changeable.length;
                          }}
                          onChange={(e) => setTicked(statusRows, e.target.checked)}
                          className="h-4 w-4 accent-[#12345B]"
                          aria-label={`${status}: all its projects`}
                        />
                      </span>
                      <button
                        type="button"
                        onClick={() => setFolded((prev) => ({ ...prev, [status]: !prev[status] }))}
                        className="inline-flex h-7 w-8 items-center justify-center rounded-r-full border-l border-black/15 hover:bg-black/10"
                        style={{ color: ink }}
                        title={isFolded ? "Expand status" : "Collapse status"}
                      >
                        {isFolded ? <Plus size={14} strokeWidth={2.6} /> : <Minus size={14} strokeWidth={2.6} />}
                      </button>
                    </div>
                  </div>
                  {!isFolded &&
                    statusRows.map((row) => {
                      const isTicked = tickedOf(row);
                      const locked = lockedOf(row);
                      const tag = row.isPurged ? "Deleted" : row.isArchived ? "Archived" : "";
                      return (
                        <label
                          key={row.id}
                          className={`flex items-center gap-2 rounded-[16px] border px-3 py-2 transition ${locked ? "cursor-default" : "cursor-pointer"}`}
                          style={{
                            backgroundColor: `color-mix(in srgb, ${color} 14%, var(--panel-bg))`,
                            borderColor: `color-mix(in srgb, ${color} 40%, var(--glass-border))`,
                            opacity: isTicked ? 1 : 0.55,
                          }}
                          title={locked ? `${row.personName} is switched off in Staff` : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={isTicked}
                            disabled={locked}
                            onChange={(e) => setTicked([row], e.target.checked)}
                            className="h-4 w-4 shrink-0"
                            aria-label={`${row.name}: included`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-[12px] font-medium" style={MAIN}>
                                {row.name || "Untitled"}
                              </span>
                              {tag ? (
                                <span className="shrink-0 rounded-full px-1.5 text-[10px] font-medium" style={{ backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}>
                                  {tag}
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-[1px] block truncate text-[11px]" style={MUTED}>
                              {row.personName}
                              {row.createdAt ? ` · ${activeDate(row.createdAt)}` : ""}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                </div>
              );
            })}
          {shownRows.length === 0 ? (
            <p className="rounded-[16px] border border-dashed px-3 py-4 text-center text-[12px] font-semibold" style={{ borderColor: "var(--glass-border)", color: "var(--text-muted)" }}>
              {rows.length ? "No projects match the search." : "No projects yet."}
            </p>
          ) : null}
        </div>
      )}
    </aside>
  );
}

function Panel({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="rounded-[18px] border p-4 sm:p-5" style={PANEL_STYLE}>
      <p className="text-[15px] font-medium" style={MAIN}>
        {title}
      </p>
      <p className="mb-4 mt-0.5 text-[12px]" style={MUTED}>
        {note}
      </p>
      {children}
    </section>
  );
}

// The four headline figures (the Leads page's stat cards' look), each with how it compares with the stretch before.
function HeadlineCards({ headlines, previous }: { headlines: ReportHeadlines; previous: ReportHeadlines }) {
  const change = (now: number | null, before: number | null, format: (diff: number) => string, lowerIsBetter = false) => {
    if (now === null || before === null) return null;
    const diff = now - before;
    if (Math.abs(diff) < 1e-9) return { text: "Same as the period before", tone: "flat" as const };
    const better = lowerIsBetter ? diff < 0 : diff > 0;
    return { text: `${diff > 0 ? "▲" : "▼"} ${format(Math.abs(diff))} vs the period before`, tone: better ? ("good" as const) : ("bad" as const) };
  };
  const cards: Array<{ key: string; label: string; icon: LucideIcon; color: string; value: string; detail: string; change: ReturnType<typeof change> }> = [
    {
      key: "leads",
      label: "Leads converted",
      icon: Inbox,
      color: "#8B5CF6",
      value: percent(headlines.conversionRate),
      detail: `${headlines.converted} of ${headlines.leads} ${headlines.leads === 1 ? "lead" : "leads"}`,
      change: change(headlines.conversionRate, previous.conversionRate, (diff) => `${Math.round(diff * 100)} pts`),
    },
    {
      key: "win",
      label: "Quote win rate",
      icon: Trophy,
      color: "#2E8C5C",
      value: percent(headlines.winRate),
      detail: `${headlines.quotedWon} of ${headlines.quoted} quoted ${headlines.quoted === 1 ? "project" : "projects"}`,
      change: change(headlines.winRate, previous.winRate, (diff) => `${Math.round(diff * 100)} pts`),
    },
    {
      key: "value",
      label: "Average job value",
      icon: DollarSign,
      color: "#3577E0",
      value: money(headlines.averageJobValue),
      detail: `${money(headlines.wonValue)} won from ${headlines.won} ${headlines.won === 1 ? "job" : "jobs"}`,
      change: change(headlines.averageJobValue, previous.averageJobValue, (diff) => money(diff)),
    },
    {
      key: "days",
      label: "Days to complete",
      icon: Clock,
      color: "#DC9A1F",
      value: days(headlines.averageDaysToComplete),
      detail: `${headlines.completed} ${headlines.completed === 1 ? "job" : "jobs"} completed`,
      change: change(headlines.averageDaysToComplete, previous.averageDaysToComplete, (diff) => days(diff), true),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.key}
            className="glass-shine glass-shine-soft min-w-0 rounded-[18px] border px-3 py-2.5 sm:px-5 sm:py-4"
            style={glassShineStyle(card.color)}
          >
            <div className="mb-2 flex items-center gap-2 sm:mb-3 sm:gap-2.5">
              <div className="glass-shine inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white sm:h-9 sm:w-9" style={glassShineStyle(card.color)}>
                <Icon size={15} strokeWidth={2.4} />
              </div>
              <p className="min-w-0 truncate text-[12px] font-medium sm:text-[14px]" style={MAIN}>
                {card.label}
              </p>
            </div>
            <p className="truncate text-[24px] font-semibold leading-none sm:text-[34px]" style={MAIN}>
              {card.value}
            </p>
            <p className="mt-2 truncate text-[12px]" style={MUTED}>
              {card.detail}
            </p>
            {card.change ? (
              <p
                className="mt-0.5 truncate text-[12px] font-medium"
                style={{ color: card.change.tone === "good" ? "#2A7A3B" : card.change.tone === "bad" ? "#C2410C" : "var(--text-muted)" }}
              >
                {card.change.text}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// Quoted and won, side by side for each week / month, on one scale.
function QuotesChart({ buckets }: { buckets: Array<{ key: string; label: string; quotedValue: number; wonValue: number }> }) {
  const max = Math.max(1, ...buckets.flatMap((bucket) => [bucket.quotedValue, bucket.wonValue]));
  const hasAny = buckets.some((bucket) => bucket.quotedValue || bucket.wonValue);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-[12px]" style={MUTED}>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: "color-mix(in srgb, var(--brand) 32%, transparent)" }} />
          Quoted
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: "var(--brand)" }} />
          Won
        </span>
      </div>
      <div className="relative flex h-[190px] gap-2 pl-11">
        {[1, 0.5, 0].map((step) => (
          <div key={step} className="pointer-events-none absolute left-0 right-0 flex items-center gap-2" style={{ bottom: `${24 + step * 150}px` }}>
            <span className="w-9 shrink-0 text-right text-[10px]" style={MUTED}>
              {shortMoney(max * step)}
            </span>
            <span className="h-px flex-1" style={{ backgroundColor: "var(--glass-border)" }} />
          </div>
        ))}
        {buckets.map((bucket) => (
          <div key={bucket.key} className="flex min-w-0 flex-1 flex-col items-center justify-end">
            <div className="flex h-[150px] w-full items-end justify-center gap-[3px]">
              {[
                { value: bucket.quotedValue, color: "color-mix(in srgb, var(--brand) 32%, transparent)", label: "Quoted" },
                { value: bucket.wonValue, color: "var(--brand)", label: "Won" },
              ].map((bar) => (
                <div
                  key={bar.label}
                  className="w-full max-w-[22px] rounded-t-[5px]"
                  style={{ height: `${(bar.value / max) * 100}%`, minHeight: bar.value ? 3 : 0, backgroundColor: bar.color }}
                  title={`${bucket.label} · ${bar.label}: ${money(bar.value)}`}
                />
              ))}
            </div>
            <span className="mt-1.5 h-[18px] max-w-full truncate text-[11px]" style={MUTED}>
              {bucket.label}
            </span>
          </div>
        ))}
      </div>
      {hasAny ? null : (
        <p className="mt-2 text-center text-[12px]" style={MUTED}>
          No quotes sent to clients in this period.
        </p>
      )}
    </div>
  );
}

// Each status's average stay as a bar in its own colour — the longest marked; one with sub-stages opening (its arrow)
// to theirs, a thinner bar each in theirs, on the same scale.
function StageBars({ stages }: { stages: ReportData["stages"] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const max = Math.max(1, ...stages.flatMap((stage) => [stage.averageDays ?? 0, ...stage.subStages.map((sub) => sub.averageDays ?? 0)]));
  const longest = stages.reduce<string | null>(
    (best, stage) => (stage.averageDays !== null && (best === null || stage.averageDays > (stages.find((row) => row.status === best)?.averageDays ?? 0)) ? stage.status : best),
    null,
  );
  return (
    <div className="space-y-2.5">
      {stages.map((stage) => {
        const hasSubs = stage.subStages.length > 0;
        const isOpen = hasSubs && Boolean(open[stage.status]);
        return (
          <div key={stage.status}>
            <div className="flex items-center gap-3">
              <span className="flex w-[34%] min-w-0 shrink-0 items-center gap-2 text-[13px] font-medium" style={MAIN}>
                {hasSubs ? (
                  <button
                    type="button"
                    onClick={() => setOpen((prev) => ({ ...prev, [stage.status]: !prev[stage.status] }))}
                    aria-expanded={isOpen}
                    aria-label={isOpen ? `Hide ${stage.status}'s sub-stages` : `Show ${stage.status}'s sub-stages`}
                    className="-ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)]"
                    style={MUTED}
                  >
                    <ChevronDown size={14} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 160ms ease" }} />
                  </button>
                ) : (
                  <span className="-ml-1 w-5 shrink-0" />
                )}
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                <span className="truncate">{stage.status}</span>
              </span>
              <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: "var(--panel-muted)" }}>
                <span className="block h-full rounded-full" style={{ width: `${((stage.averageDays ?? 0) / max) * 100}%`, backgroundColor: stage.color }} />
              </span>
              <span className="w-[86px] shrink-0 text-right text-[12px]" style={stage.status === longest ? { color: "#C2410C", fontWeight: 600 } : MUTED}>
                {stage.averageDays === null ? "No moves yet" : days(stage.averageDays)}
              </span>
            </div>
            {/* Its sub-stages, sliding open (the grid's 0fr / 1fr). */}
            {hasSubs ? (
              <div
                className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
                style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                aria-hidden={!isOpen}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="space-y-1.5 pb-1 pt-2">
                    {stage.subStages.map((sub) => (
                      <div key={sub.name} className="flex items-center gap-3">
                        <span className="flex w-[34%] min-w-0 shrink-0 items-center gap-2 pl-6 text-[12px]" style={MAIN}>
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: sub.color }} />
                          <span className="truncate">{sub.name}</span>
                        </span>
                        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: "var(--panel-muted)" }}>
                          <span className="block h-full rounded-full" style={{ width: `${((sub.averageDays ?? 0) / max) * 100}%`, backgroundColor: sub.color }} />
                        </span>
                        <span className="w-[86px] shrink-0 text-right text-[11.5px]" style={MUTED}>
                          {sub.averageDays === null ? "No moves yet" : days(sub.averageDays)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// One bar across, a stretch of it for each status (as many projects as it has), with each listed under it.
function Pipeline({ rows }: { rows: Array<{ status: string; color: string; count: number }> }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (!total) {
    return (
      <p className="py-4 text-center text-[13px] font-medium" style={MUTED}>
        No projects on the board.
      </p>
    );
  }
  return (
    <div>
      <div className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-full">
        {rows
          .filter((row) => row.count)
          .map((row) => (
            <span key={row.status} className="h-full" style={{ width: `${(row.count / total) * 100}%`, backgroundColor: row.color }} title={`${row.status}: ${row.count}`} />
          ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {rows.map((row) => (
          <span key={row.status} className="inline-flex items-center gap-2 text-[13px] font-medium" style={MAIN}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
            {row.status}
            <span style={MUTED}>{row.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function PeopleTable({
  rows,
}: {
  rows: Array<{ key: string; name: string; color: string; started: number; completed: number; quoted: number; won: number; wonValue: number; winRate: number | null }>;
}) {
  if (!rows.length) {
    return (
      <p className="py-4 text-center text-[13px] font-medium" style={MUTED}>
        Nothing assigned in this period.
      </p>
    );
  }
  const columns = "grid grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,0.8fr))_minmax(0,1fr)] sm:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.7fr))_minmax(0,1fr)_minmax(0,1fr)]";
  return (
    <div>
      <div className={`${columns} gap-2 border-b pb-2 text-[11px] font-medium`} style={{ ...MUTED, borderColor: "var(--glass-border)" }}>
        <span>Name</span>
        <span className="text-right max-sm:hidden">Started</span>
        <span className="text-right max-sm:hidden">Completed</span>
        <span className="text-right">Quoted</span>
        <span className="text-right">Win rate</span>
        <span className="text-right">Won</span>
      </div>
      {rows.map((row) => (
        <div key={row.key} className={`${columns} items-center gap-2 border-b py-2.5 text-[13px] last:border-b-0`} style={{ ...MAIN, borderColor: "var(--glass-border)" }}>
          <span className="flex min-w-0 items-center gap-2">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: row.color }}>
              {row.name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase())
                .join("") || "?"}
            </span>
            <span className="truncate font-medium">{row.name}</span>
          </span>
          <span className="text-right max-sm:hidden">{row.started}</span>
          <span className="text-right max-sm:hidden">{row.completed}</span>
          <span className="text-right">{row.quoted}</span>
          <span className="text-right">{percent(row.winRate)}</span>
          <span className="truncate text-right font-medium">{money(row.wonValue)}</span>
        </div>
      ))}
    </div>
  );
}

function Sources({ rows }: { rows: Array<{ label: string; count: number; converted: number }> }) {
  if (!rows.length) {
    return (
      <p className="py-4 text-center text-[13px] font-medium" style={MUTED}>
        No leads in this period.
      </p>
    );
  }
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate font-medium" style={MAIN}>
              {row.label}
            </span>
            <span className="shrink-0 text-[12px]" style={MUTED}>
              {row.count} {row.count === 1 ? "lead" : "leads"} · {row.converted} converted
            </span>
          </div>
          <span className="block h-2 overflow-hidden rounded-full" style={{ backgroundColor: "var(--panel-muted)" }}>
            <span className="block h-full rounded-full" style={{ width: `${(row.count / max) * 100}%`, backgroundColor: "#8B5CF6" }} />
          </span>
        </div>
      ))}
    </div>
  );
}

