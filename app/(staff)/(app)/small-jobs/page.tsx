"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CalendarDays, Hammer, Plus, RefreshCw, Search } from "lucide-react";
import { BoardTitleBar } from "@/components/board-title-bar";
import {
  GLASS_MENU_CLASS,
  GLASS_MENU_MIN_WIDTH_PHONE_PX,
  GLASS_MENU_MIN_WIDTH_PX,
  GLASS_MENU_STYLE,
  GlassDropdown,
  GlassMenuOption,
  glassMenuHeight,
} from "@/components/glass-dropdown";
import { useAuth } from "@/lib/auth-context";
import { activeDateTime, useCompanyFormats } from "@/lib/company-formats";
import { fetchCompanyDoc, fetchCompanyMembers, fetchProjects, updateProjectStatus } from "@/lib/firestore-data";
import { flatPageBg } from "@/lib/flat-page";
import { glassShineStyle } from "@/lib/glass-shine";
import { normalizeSmallJobStatuses, openNewSmallJob, SMALL_JOB_COLOR, type SmallJobStatus } from "@/lib/small-jobs";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";
import { captureGlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { readThemeMode, THEME_MODE_UPDATED_EVENT } from "@/lib/theme-mode";
import type { Project } from "@/lib/types";
import { hasPermissionKey, isOwnerOrAdmin, useCompanyAccess } from "@/lib/use-company-access";

// Small Jobs (the sidebar's): quick jobs and small fixes, each without a whole project (lib/small-jobs.ts) — a list,
// laid out as the Dashboard's list (a flat page — lib/flat-page.ts): each job, its client, who it's assigned to, when it
// was created and changed, and its status (the Dashboard's status pill and menu, from the company's small-job
// statuses). The open ones first (in the statuses' order), newest changed first. A search, a status filter, and New
// Small Job (the New Project pop-up, as a small job). A job opens as its page — the project's title bar, its client
// details, notes and images.

const MUTED_PANEL = {
  borderColor: "var(--glass-border)",
  backgroundColor: "var(--glass-bg-strong)",
  backdropFilter: "blur(20px) saturate(180%)",
  WebkitBackdropFilter: "blur(20px) saturate(180%)",
  boxShadow: "inset 0 1px 0 var(--glass-highlight), var(--shadow-glass)",
};
const ALL_STATUSES = "__all__";

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
// The Dashboard's: dark text on a light status colour, white on a dark one.
function rowTextColorForFill(fill: string): string {
  const clean = String(fill || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return "#FFFFFF";
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#0F172A" : "#FFFFFF";
}
// The Dashboard list's rows: a colour across a row that fades out over its last 72px at each end — the hover
// highlight, and the line between rows (a 1px line along its bottom, in its background).
function fadedAcrossRow(color: string) {
  return `linear-gradient(90deg, transparent 0, ${color} 72px, ${color} calc(100% - 72px), transparent 100%)`;
}
function fadedRowLineStyle(lineColor: string, rowBackground = "none"): CSSProperties {
  return {
    backgroundImage: `${fadedAcrossRow(lineColor)}, ${rowBackground}`,
    backgroundSize: "100% 1px, 100% 100%",
    backgroundPosition: "left bottom, left top",
    backgroundRepeat: "no-repeat",
  };
}
const dateText = (value: string | undefined) => activeDateTime(value) || "-";
// Light or dark (the theme saved — light on the server), kept up as it's changed.
const subscribeThemeMode = (onChange: () => void) => {
  window.addEventListener(THEME_MODE_UPDATED_EVENT, onChange);
  return () => window.removeEventListener(THEME_MODE_UPDATED_EVENT, onChange);
};

export default function SmallJobsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const access = useCompanyAccess();
  useCompanyFormats();
  // Whoever can see the Dashboard (its own permission) can see Small Jobs.
  const canAccess =
    access.status === "ready" && (isOwnerOrAdmin(access.role) || hasPermissionKey(access.permissionKeys, "company.dashboard.view"));
  const canCreate =
    access.status === "ready" &&
    (isOwnerOrAdmin(access.role) || hasPermissionKey(access.permissionKeys, "projects.create") || hasPermissionKey(access.permissionKeys, "projects.create.others"));
  const companyId = access.status === "ready" ? String(access.companyId || "").trim() : "";
  const [jobs, setJobs] = useState<Project[] | null>(null);
  const [statuses, setStatuses] = useState<SmallJobStatus[]>([]);
  const [colorByUid, setColorByUid] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL_STATUSES);
  const [hoveredJobId, setHoveredJobId] = useState("");
  const [savingJobId, setSavingJobId] = useState("");
  // The status menu (the Dashboard's): which job's, and where.
  const [statusMenuJobId, setStatusMenuJobId] = useState("");
  const [statusMenuPos, setStatusMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);

  // The Dashboard's colours, light or dark.
  const isDarkMode = useSyncExternalStore(subscribeThemeMode, () => readThemeMode() === "dark", () => false);
  const palette = isDarkMode
    ? { border: "#3f3f46", text: "#f1f1f1", textMuted: "#aaaaaa", textSoft: "#c9d1d9" }
    : { border: "#D7DEE8", text: "#111827", textMuted: "#64748B", textSoft: "#475467" };

  // The table's header: blurred once it's stuck under the top bar (the Dashboard's).
  const tableHeadRef = useRef<HTMLTableSectionElement | null>(null);
  const [isHeadStuck, setIsHeadStuck] = useState(false);
  useEffect(() => {
    let ticking = false;
    const check = () => {
      ticking = false;
      const head = tableHeadRef.current;
      if (head) setIsHeadStuck(head.getBoundingClientRect().top <= 49);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(check);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    if (!canAccess || !companyId || !user?.uid) return;
    let cancelled = false;
    void (async () => {
      try {
        const [projects, companyDoc, members] = await Promise.all([
          fetchProjects(user.uid, [companyId], { lightweight: true }),
          fetchCompanyDoc(companyId),
          fetchCompanyMembers(companyId).catch(() => []),
        ]);
        if (cancelled) return;
        setJobs(projects.filter((project) => project.isSmallJob && String(project.companyId || companyId) === companyId));
        setStatuses(normalizeSmallJobStatuses(companyDoc?.smallJobStatuses));
        setColorByUid(Object.fromEntries(members.map((member) => [member.uid, member.userColor || member.badgeColor || "#94A3B8"])));
        setLoadError(false);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canAccess, companyId, user?.uid, loadKey]);

  // A press outside the status menu just closes it (the click it makes is swallowed, so it doesn't also open a job);
  // so does scrolling or resizing.
  useEffect(() => {
    if (!statusMenuJobId) return;
    const close = () => {
      setStatusMenuJobId("");
      setStatusMenuPos(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.closest("[data-status-menu='true']")) return;
      const trigger = target.closest<HTMLElement>("[data-status-trigger='true']");
      if (trigger && trigger.dataset.statusTriggerJobId === statusMenuJobId) return;
      close();
      swallowNextClick();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [statusMenuJobId]);

  const statusIndex = useMemo(() => new Map(statuses.map((status, index) => [status.name.toLowerCase(), index])), [statuses]);
  const colorOf = (status: string) => statuses.find((row) => row.name.toLowerCase() === status.toLowerCase())?.color ?? "#64748B";
  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (jobs ?? [])
      .filter((job) => statusFilter === ALL_STATUSES || String(job.statusLabel || "").toLowerCase() === statusFilter.toLowerCase())
      .filter(
        (job) =>
          !query ||
          [job.name, job.customer, job.clientPhone, job.clientEmail, job.clientAddress, job.assignedToName || job.assignedTo, job.statusLabel].some((value) =>
            String(value || "").toLowerCase().includes(query),
          ),
      )
      .sort(
        (a, b) =>
          (statusIndex.get(String(a.statusLabel || "").toLowerCase()) ?? statuses.length) -
            (statusIndex.get(String(b.statusLabel || "").toLowerCase()) ?? statuses.length) ||
          String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
      );
  }, [jobs, search, statusFilter, statusIndex, statuses.length]);
  // The status pill's width (the Dashboard's): enough for the longest status name.
  const statusPillWidthPx = useMemo(() => {
    const longest = statuses.reduce((max, status) => Math.max(max, status.name.length), 0);
    return longest ? Math.ceil(longest * 7) + 40 : 120;
  }, [statuses]);
  const statusColumnWidthPx = statusPillWidthPx + 20;

  // A job's status, changed from the list: straight away, back if it doesn't save.
  const changeStatus = async (job: Project, status: string) => {
    setStatusMenuJobId("");
    setStatusMenuPos(null);
    if (status === job.statusLabel) return;
    setSavingJobId(job.id);
    setJobs((prev) => (prev ?? []).map((row) => (row.id === job.id ? { ...row, statusLabel: status, updatedAt: new Date().toISOString() } : row)));
    const ok = await updateProjectStatus(job, status);
    if (!ok) setJobs((prev) => (prev ?? []).map((row) => (row.id === job.id ? job : row)));
    setSavingJobId("");
  };
  const openJob = (job: Project) => router.push(`/projects/${job.id}`);
  // The status menu, under (or over, without room below) the pill that opened it.
  const toggleStatusMenu = (job: Project, event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (savingJobId === job.id) return;
    if (statusMenuJobId === job.id) {
      setStatusMenuJobId("");
      setStatusMenuPos(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const isPhoneMenu = window.matchMedia("(max-width: 767px)").matches;
    const height = glassMenuHeight(statuses.length, isPhoneMenu);
    const openUp = rect.bottom + height > window.innerHeight - 8 && rect.top - height >= 8;
    const width = Math.max(isPhoneMenu ? GLASS_MENU_MIN_WIDTH_PHONE_PX : GLASS_MENU_MIN_WIDTH_PX, Math.round(rect.width));
    setStatusMenuPos({
      left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8),
      top: openUp ? Math.max(8, rect.top - height - 4) : rect.bottom + 4,
      width,
    });
    setStatusMenuJobId(job.id);
  };
  const statusPill = (job: Project, style: CSSProperties) => {
    const color = colorOf(String(job.statusLabel || ""));
    return (
      <button
        type="button"
        data-status-trigger="true"
        data-status-trigger-job-id={job.id}
        onClick={(event) => toggleStatusMenu(job, event)}
        className="glass-shine inline-flex items-center justify-center rounded-full px-3 py-2 text-[12px] font-normal"
        style={glassShineStyle({ backgroundColor: color, color: rowTextColorForFill(color), ...style })}
        aria-label="Small job status"
        title="Change status"
      >
        {savingJobId === job.id ? "Saving..." : job.statusLabel || "-"}
      </button>
    );
  };
  const assigned = (job: Project) => {
    const name = String(job.assignedToName || job.assignedTo || "").trim();
    if (!name || name.toLowerCase() === "unassigned") return null;
    return (
      <>
        <span
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ backgroundColor: colorByUid[String(job.assignedToUid || "")] || SMALL_JOB_COLOR }}
        >
          {initialsOf(name)}
        </span>
        <span className="min-w-0 truncate" style={{ color: palette.text }}>
          {name}
        </span>
      </>
    );
  };

  const notice = (body: ReactNode) => (
    <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}>
      {body}
    </div>
  );
  if (access.status === "loading") return notice("Checking access...");
  if (access.status === "error") {
    return notice(
      <>
        <p>Couldn&apos;t check your access to Small Jobs — the connection may be slow or offline.</p>
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
  if (!canAccess) return notice("You do not have permission to access Small Jobs.");

  const statusMenuJob = statusMenuJobId ? (jobs ?? []).find((job) => job.id === statusMenuJobId) ?? null : null;
  const headCell = "py-2 text-[11px] font-bold";

  return (
    <div className="space-y-4 pb-10">
      <BoardTitleBar icon={Hammer} title="Small Jobs" color={SMALL_JOB_COLOR} count={shown.length} />
      {/* Its search, the status filter, and New Small Job. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative min-w-0 basis-full sm:max-w-[320px] sm:flex-1 sm:basis-0">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search small jobs..."
            aria-label="Search small jobs"
            className="h-9 w-full rounded-full border pl-9 pr-3 text-[13px] outline-none"
            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
          />
        </span>
        <GlassDropdown
          value={statusFilter}
          options={[{ value: ALL_STATUSES, label: "All statuses" }, ...statuses.map((status) => ({ value: status.name, label: status.name, color: status.color }))]}
          onChange={setStatusFilter}
          ariaLabel="Status"
          menuMinWidth={170}
          triggerClassName="h-9 min-w-[150px] justify-between rounded-full border px-3.5 text-[13px] font-medium"
          triggerStyle={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
        />
        {canCreate ? (
          <button
            type="button"
            onClick={(e) => openNewSmallJob(captureGlassModalOrigin(e))}
            className="glass-shine ml-auto inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium text-white hover:brightness-95"
            style={glassShineStyle("var(--brand)")}
          >
            <Plus size={15} />
            New Small Job
          </button>
        ) : null}
      </div>

      {loadError && jobs === null ? (
        notice(
          <>
            <p>Couldn&apos;t load your small jobs — the connection may be slow or offline.</p>
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
      ) : jobs === null ? (
        notice("Loading small jobs...")
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-[18px] border px-4 py-14 text-center" style={MUTED_PANEL}>
          <span className="glass-shine inline-flex h-11 w-11 items-center justify-center rounded-full text-white" style={glassShineStyle(SMALL_JOB_COLOR)}>
            <Hammer size={19} />
          </span>
          <p className="text-[15px] font-medium" style={{ color: "var(--text-main)" }}>
            {jobs.length ? "No small jobs match" : "No small jobs yet"}
          </p>
          <p className="max-w-[360px] text-[12.5px]" style={{ color: "var(--text-muted)" }}>
            {jobs.length ? "Try another search or status." : "Quick jobs and small fixes — a toekick to replace, hinges to change — without a whole project."}
          </p>
          {!jobs.length && canCreate ? (
            <button
              type="button"
              onClick={(e) => openNewSmallJob(captureGlassModalOrigin(e))}
              className="glass-shine mt-1 inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium text-white hover:brightness-95"
              style={glassShineStyle("var(--brand)")}
            >
              <Plus size={15} />
              New Small Job
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {/* A computer: the Dashboard's list table — straight on the page, its columns spread across it. */}
          <div className="hidden lg:block">
            <table className="w-full table-fixed text-[12px]" style={{ minWidth: 220 + 180 + 130 + 150 + 150 + statusColumnWidthPx }}>
              <colgroup>
                <col style={{ width: "220px" }} />
                <col style={{ width: "180px" }} />
                <col style={{ width: "130px" }} />
                <col style={{ width: "150px" }} />
                <col style={{ width: "150px" }} />
                <col style={{ width: `${statusColumnWidthPx}px` }} />
              </colgroup>
              <thead
                ref={tableHeadRef}
                className="sticky top-12 z-20"
                style={{
                  backgroundColor: isHeadStuck ? (isDarkMode ? "rgba(11,13,18,0.6)" : "rgba(245,247,250,0.6)") : flatPageBg(isDarkMode),
                  backdropFilter: isHeadStuck ? "blur(12px) saturate(220%)" : "none",
                  WebkitBackdropFilter: isHeadStuck ? "blur(12px) saturate(220%)" : "none",
                  transition: "background-color 280ms ease, backdrop-filter 280ms ease",
                }}
              >
                <tr style={fadedRowLineStyle(palette.border)}>
                  <th className={`${headCell} pl-[10px] text-left`} style={{ color: palette.textMuted }}>
                    Project Name
                  </th>
                  <th className={`${headCell} text-left`} style={{ color: palette.textMuted }}>
                    Client
                  </th>
                  <th className={`${headCell} text-left`} style={{ color: palette.textMuted }}>
                    Assigned
                  </th>
                  <th className={`${headCell} text-center`} style={{ color: palette.textMuted }}>
                    Created
                  </th>
                  <th className={`${headCell} text-center`} style={{ color: palette.textMuted }}>
                    Modified
                  </th>
                  <th className={`${headCell} text-right`} style={{ width: statusColumnWidthPx, color: palette.textMuted }}>
                    <span className="inline-block text-center" style={{ width: statusPillWidthPx, marginRight: 10 }}>
                      Status
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((job) => {
                  const rowBg = hoveredJobId === job.id ? fadedAcrossRow(isDarkMode ? "rgba(0, 0, 0, 0.25)" : "#ECF0F6") : "none";
                  return (
                    <tr
                      key={job.id}
                      className="cursor-pointer transition-colors"
                      style={fadedRowLineStyle(isDarkMode ? "var(--glass-border)" : palette.border, rowBg)}
                      onMouseEnter={() => setHoveredJobId(job.id)}
                      onMouseLeave={() => setHoveredJobId((prev) => (prev === job.id ? "" : prev))}
                      onClick={() => openJob(job)}
                    >
                      <td className="truncate py-[11px] pl-[10px] font-bold" style={{ color: palette.text }}>
                        {job.name || "Untitled"}
                      </td>
                      <td className="truncate py-[11px]" style={{ color: palette.text }}>
                        {job.customer || "-"}
                      </td>
                      <td className="py-[11px]">
                        <div className="flex min-w-0 items-center gap-2 text-[12px]">{assigned(job)}</div>
                      </td>
                      <td className="truncate py-[11px] text-center text-[12px]" style={{ color: palette.textSoft }}>
                        {dateText(job.createdAt)}
                      </td>
                      <td className="truncate py-[11px] text-center text-[12px]" style={{ color: palette.textSoft }}>
                        {dateText(job.updatedAt)}
                      </td>
                      <td className="relative py-[6px] text-right" style={{ width: statusColumnWidthPx }}>
                        {statusPill(job, { width: statusPillWidthPx, marginRight: 10 })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* A phone or tablet: a card each (the Dashboard's list cards). */}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:hidden">
            {shown.map((job) => (
              <div
                key={job.id}
                role="button"
                tabIndex={0}
                onClick={() => openJob(job)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openJob(job);
                }}
                className="cursor-pointer space-y-2.5 rounded-[18px] border p-3.5"
                style={MUTED_PANEL}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[16px] font-bold" style={{ color: palette.text }}>
                      {job.name || "Untitled"}
                    </p>
                    <p className="mt-0.5 truncate text-[12.5px]" style={{ color: palette.textSoft }}>
                      {job.customer || "-"}
                    </p>
                  </div>
                  {statusPill(job, { width: 118 })}
                </div>
                <div className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="flex min-w-0 items-center gap-2">{assigned(job)}</span>
                  <span className="flex shrink-0 items-center gap-3" style={{ color: palette.textSoft }}>
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays size={12} />
                      {dateText(job.createdAt)}
                    </span>
                    <span className="inline-flex items-center gap-1 max-sm:hidden">
                      <RefreshCw size={12} />
                      {dateText(job.updatedAt)}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* The status menu (the Dashboard's): each status, its colour's dot, the current one picked. */}
      {statusMenuJob && statusMenuPos
        ? createPortal(
            <div
              data-status-menu="true"
              role="listbox"
              aria-label="Small job status"
              className={GLASS_MENU_CLASS}
              style={{ ...GLASS_MENU_STYLE, left: statusMenuPos.left, top: statusMenuPos.top, width: statusMenuPos.width }}
              onClick={(e) => e.stopPropagation()}
            >
              {statuses.map((status) => (
                <GlassMenuOption
                  key={`${statusMenuJob.id}_${status.name}`}
                  label={status.name}
                  color={status.color}
                  selected={String(statusMenuJob.statusLabel || "").toLowerCase() === status.name.toLowerCase()}
                  disabled={savingJobId === statusMenuJob.id}
                  onSelect={() => void changeStatus(statusMenuJob, status.name)}
                />
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
