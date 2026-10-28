"use client";

import { activeDate, activeDateRange, useCompanyFormats } from "@/lib/company-formats";
import { createPortal } from "react-dom";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { Suspense, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CalendarDays,
  Check,
  ChevronDown,
  Contact,
  ExternalLink,
  Folder,
  FolderKanban,
  FolderOpen,
  Inbox,
  ListChecks,
  Mail,
  Minus,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useUndo } from "@/components/undo-bar";
import { useAppTabs } from "@/lib/app-tabs-context";
import { authorizedFetch } from "@/lib/api-fetch";
import { hasPermissionKey, isOwnerOrAdmin, useCompanyAccess } from "@/lib/use-company-access";
import {
  fetchCompanyClients,
  fetchCompanyDoc,
  fetchCompanyLeads,
  fetchCompanyMembers,
  fetchDeletedProjects,
  fetchProjects,
  permanentlyDeleteCompanyClients,
  permanentlyDeleteProject,
  restoreArchivedCompanyClients,
  restoreArchivedProject,
  updateProjectStatus,
  type CompanyClientRow,
  type CompanyLeadRow,
  type CompanyMemberOption,
} from "@/lib/firestore-data";
import { GlassSwitch } from "@/components/settings-ui";
import { GlassActionMenu } from "@/components/glass-dropdown";
import { sendProjectCopyEmail } from "@/lib/project-email-copy";
import { ALL_PROJECT_COPY_SECTIONS, PROJECT_COPY_SECTIONS, type ProjectCopySections } from "@/lib/project-copy-sections";
import {
  calendarCategoryLevel,
  calendarRetentionCutoffMs,
  deleteCalendarEvent,
  fetchArchivedCalendarEvents,
  normalizeCalendarCategories,
  normalizeCalendarRetention,
  restoreArchivedCalendarEvent,
  type ArchivedCalendarEvent,
  type CalendarCategory,
} from "@/lib/calendar-data";
import { normalizeRoleKey } from "@/lib/company-roles";
import { projectTabAccess } from "@/lib/permissions";
import { retryAsync } from "@/lib/load-retry";
import { leadClientDisplayName } from "@/lib/lead-name";
import { projectArchivedAtIso } from "@/lib/project-archive";
import { fetchBonusLock } from "@/lib/completed-projects";
import { glassShineStyle } from "@/lib/glass-shine";
import { isPreviewMode } from "@/lib/preview-mode";
import { db } from "@/lib/firebase";
import { deleteDoc, doc, setDoc } from "@/lib/firestore-client";
import { RestoreDialog, restoreStatusOptionsFrom } from "@/components/restore-dialog";
import { Skeleton, SkeletonGroup } from "@/components/skeleton";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import type { Project } from "@/lib/types";

// The Archive — a filing cabinet of everything put away: projects, leads and contacts (every Delete/Archive button in
// the app files them here, and finished projects arrive on their own — Company Settings → Dashboard), and calendar
// events once they're archived (Company Settings → Calendar → Archive events after). Nothing here is ever deleted
// automatically: someone with the right access restores things or deletes them for good, one at a time or many at
// once.
//
// It's all in one cabinet, filed month by month: a drawer for each year (the cabinet down the side on a wide screen —
// a strip of months on a phone), a folder for each month, and in each folder its files day by day, each time-stamped.
// Everything is filed by when it was archived — except events, filed by when they happened (they're archived in
// batches, long after, so that date says little). It can be narrowed to one kind, a range of months, statuses
// and categories, and the people on them, and searched, newest or oldest first.
//
// Where each kind's "archived" lives:
// - Projects: isArchived / archivedAtIso on the job doc. Projects soft-deleted the old way (isDeleted) are listed too,
//   filed under their deletion date (fetchDeletedProjects, lib/project-archive.ts).
// - Leads: isDeleted / deletedAtIso — a lead's archive flag (the Leads page's Archive button), read through
//   /api/leads?archived=only.
// - Contacts: archived / archivedAtIso on the contact doc, read through /api/clients?archived=only.
// - Events: archived / archivedAtIso on the event doc (lib/calendar-data.ts).

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
// How each person last left it — newest or oldest first, and everything they opened or closed: the folders, the
// cabinet's drawers, the Filters panel — on this device, per person, so it opens the same way next time. (It always
// opens on Everything.)
const ARCHIVE_PREFS_STORAGE_KEY_PREFIX = "cutsmart_archive_prefs:";

type ArchiveKind = "projects" | "leads" | "contacts" | "events";
const ARCHIVE_KINDS: ArchiveKind[] = ["projects", "leads", "contacts", "events"];
const KIND_META: Record<ArchiveKind, { label: string; one: string; many: string; icon: typeof Inbox; color: string }> = {
  projects: { label: "Projects", one: "project", many: "projects", icon: FolderKanban, color: "#2F6BFF" },
  leads: { label: "Leads", one: "lead", many: "leads", icon: Inbox, color: "#E8721C" },
  contacts: { label: "Contacts", one: "contact", many: "contacts", icon: Contact, color: "#0F9D8A" },
  events: { label: "Events", one: "event", many: "events", icon: CalendarDays, color: "#8B5CF6" },
};

function parseKind(value: unknown): ArchiveKind | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return (ARCHIVE_KINDS as string[]).includes(raw) ? (raw as ArchiveKind) : null;
}

type SortOrder = "newest" | "oldest";
type ArchivePrefs = { sort: SortOrder; closed: Record<string, boolean>; drawers: Record<string, boolean>; filtersOpen: boolean };

function booleanMap(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
}

function readArchivePrefs(uid: string): ArchivePrefs {
  const empty: ArchivePrefs = { sort: "newest", closed: {}, drawers: {}, filtersOpen: false };
  if (!uid || typeof window === "undefined") return empty;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ARCHIVE_PREFS_STORAGE_KEY_PREFIX + uid) || "{}") as Record<string, unknown>;
    return {
      sort: parsed.sort === "oldest" ? "oldest" : "newest",
      closed: booleanMap(parsed.closed),
      drawers: booleanMap(parsed.drawers),
      filtersOpen: parsed.filtersOpen === true,
    };
  } catch {
    return empty;
  }
}

// "3 projects", "1 item"…
// A staff member's badge letters — as the Dashboard's Staff list shows them.
function staffInitials(text: string): string {
  const parts = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
function itemCount(count: number): string {
  return countOf(count, "item", "items");
}

// One file in the cabinet, whatever it is underneath — the filing, filters, search, selection and bulk bar all work on
// these. key is unique across kinds (kind:id).
type ArchiveFact = { label: string; value: string };
type ArchiveRow = {
  kind: ArchiveKind;
  id: string;
  key: string;
  // When it's filed (NaN: undated — filed at the back).
  filedMs: number;
  // Its time stamp: "Archived" / "Event", its date and its time.
  stampLabel: string;
  stampDate: string;
  stampTime: string;
  title: string;
  // Beside its title: whose it is — a project's client, a lead's or contact's email (or phone), an event's project.
  subtitle: string;
  pill: { label: string; color: string } | null;
  // Its status or category, for the filter (kind:name, lower case; "" for none).
  statusKey: string;
  people: string[];
  // Opened: its details, and any longer text (a lead's message, a contact's or an event's notes).
  facts: ArchiveFact[];
  note: string;
  searchText: string;
  canRestore: boolean;
  canDelete: boolean;
  restoreTitle: string;
};

// The filing: years (drawers) → months (folders) → days, in the order chosen; undated things at the back.
type DayGroup = { key: string; day: string; weekday: string; rows: ArchiveRow[] };
type MonthFolder = { key: string; yearKey: string; name: string; year: string; rows: ArchiveRow[]; days: DayGroup[] };
type YearDrawer = { key: string; label: string; count: number; months: MonthFolder[] };

const pad2 = (n: number) => String(n).padStart(2, "0");
function monthKeyOf(ms: number): string {
  if (!Number.isFinite(ms)) return "undated";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function fileRows(rows: ArchiveRow[], sort: SortOrder): YearDrawer[] {
  const monthName = new Intl.DateTimeFormat(undefined, { month: "long" });
  const weekdayName = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const dated = rows.filter((r) => Number.isFinite(r.filedMs)).sort((a, b) => (sort === "newest" ? b.filedMs - a.filedMs : a.filedMs - b.filedMs));
  const undated = rows.filter((r) => !Number.isFinite(r.filedMs));
  const years: YearDrawer[] = [];
  for (const row of dated) {
    const d = new Date(row.filedMs);
    const yearKey = String(d.getFullYear());
    const monthKey = `${yearKey}-${pad2(d.getMonth() + 1)}`;
    const dayKey = `${monthKey}-${pad2(d.getDate())}`;
    let year = years[years.length - 1];
    if (!year || year.key !== yearKey) {
      year = { key: yearKey, label: yearKey, count: 0, months: [] };
      years.push(year);
    }
    let month = year.months[year.months.length - 1];
    if (!month || month.key !== monthKey) {
      month = { key: monthKey, yearKey, name: monthName.format(d), year: yearKey, rows: [], days: [] };
      year.months.push(month);
    }
    let day = month.days[month.days.length - 1];
    if (!day || day.key !== dayKey) {
      day = { key: dayKey, day: String(d.getDate()), weekday: weekdayName.format(d), rows: [] };
      month.days.push(day);
    }
    day.rows.push(row);
    month.rows.push(row);
    year.count += 1;
  }
  if (undated.length) {
    years.push({
      key: "undated",
      label: "No date",
      count: undated.length,
      months: [{ key: "undated", yearKey: "undated", name: "No date", year: "", rows: undated, days: [{ key: "undated", day: "–", weekday: "", rows: undated }] }],
    });
  }
  return years;
}

// How many of each kind, in kind order (for a folder's and the cabinet's breakdowns).
function kindCounts(rows: ArchiveRow[]): Array<{ kind: ArchiveKind; count: number }> {
  return ARCHIVE_KINDS.map((kind) => ({ kind, count: rows.filter((r) => r.kind === kind).length })).filter((k) => k.count > 0);
}

// "2 projects, 1 lead" — for the selection bar, the delete pop-up and the Undo bar.
function breakdownText(rows: ArchiveRow[]): string {
  return kindCounts(rows)
    .map(({ kind, count }) => countOf(count, KIND_META[kind].one, KIND_META[kind].many))
    .join(", ");
}

// White text on darker status colours, dark on very light ones (same cut-off as the dashboard).
function pillTextColor(fill: string): string {
  const clean = String(fill || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return "#FFFFFF";
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.75 ? "#0F172A" : "#FFFFFF";
}

// name (lower case) → colour, from a company doc list like projectStatuses / leadStatuses / contactCategories.
function colorMapFrom(raw: unknown, fallback: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = { ...fallback };
  for (const row of Array.isArray(raw) ? raw : []) {
    const item = (row ?? {}) as Record<string, unknown>;
    const name = String(item.name ?? "").trim().toLowerCase();
    if (name) out[name] = String(item.color ?? "").trim() || "#64748B";
  }
  return out;
}

// The Leads page's own defaults, for a company that hasn't set its lead statuses.
const DEFAULT_LEAD_STATUS_COLORS: Record<string, string> = {
  new: "#3060D0",
  contacted: "#C77700",
  qualified: "#6B4FB3",
  converted: "#2A7A3B",
};

// A time of day in the viewer's own time ("3:05pm"), as the rest of the app shows it.
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
function timeLabel(ms: number): string {
  return Number.isFinite(ms) ? TIME_FORMAT.format(new Date(ms)).toLowerCase().replace(/\s+/g, "") : "";
}
function isoMs(iso: string): number {
  const ms = iso ? new Date(iso).getTime() : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.NaN;
}
// "<date> · 3:05pm" ("" with no date).
function dateTimeLabel(iso: string): string {
  const ms = isoMs(iso);
  return Number.isFinite(ms) ? `${activeDate(ms)} · ${timeLabel(ms)}` : "";
}

// An event's day(s) and time(s): all-day ones end at midnight after their last day (lib/calendar-data.ts).
function eventWhen(event: { allDay: boolean; startMs: number; endMs: number }): { date: string; time: string } {
  const start = new Date(event.startMs);
  if (event.allDay) {
    const lastDay = new Date(Math.max(event.startMs, event.endMs - 1));
    return { date: lastDay.toDateString() === start.toDateString() ? activeDate(start) : activeDateRange(start, lastDay), time: "All day" };
  }
  const end = new Date(event.endMs);
  return {
    date: end.toDateString() === start.toDateString() ? activeDate(start) : activeDateRange(start, end),
    time: `${timeLabel(event.startMs)} – ${timeLabel(event.endMs)}`,
  };
}

type LoadState<T> = { status: "loading" | "ready" | "error"; rows: T[] };

type SelectState = "all" | "some" | "none";
function selectStateOf(keys: string[], selected: Set<string>): SelectState {
  if (!keys.length) return "none";
  const count = keys.filter((key) => selected.has(key)).length;
  return count === 0 ? "none" : count === keys.length ? "all" : "some";
}

// A round tick for one file, a folder or everything listed ("some" shows a dash).
function SelectDot({ state, onToggle, label, className = "" }: { state: SelectState; onToggle: () => void; label: string; className?: string }) {
  const on = state !== "none";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full transition hover:brightness-95 ${on ? "glass-shine" : "border"} ${className}`}
      style={
        on
          ? glassShineStyle("var(--brand)", { color: "#FFFFFF" })
          : { borderColor: "color-mix(in srgb, var(--text-main) 28%, transparent)", backgroundColor: "var(--panel-bg)", color: "transparent" }
      }
    >
      {state === "some" ? <Minus size={12} strokeWidth={3} /> : <Check size={12} strokeWidth={3} />}
    </button>
  );
}

// A round glass-shine button: in a colour (white icon), or neutral (the plain glass).
function RoundButton({
  color,
  title,
  onClick,
  disabled,
  size = 32,
  className = "",
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  color?: string;
  title: string;
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  size?: number;
  className?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`glass-shine ${color ? "" : "glass-shine-neutral"} inline-flex shrink-0 items-center justify-center rounded-full transition hover:brightness-95 disabled:opacity-55 ${className}`}
      style={glassShineStyle(color ?? "#64748B", { width: size, height: size, color: color ? "#FFFFFF" : "var(--text-main)" })}
    >
      {children}
    </button>
  );
}

// A filter chip: on (glass shine in its colour) or off (the plain glass, with a dot of its colour).
function FilterChip({ label, color, count, on, onClick }: { label: string; color: string; count?: number; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`glass-shine ${on ? "" : "glass-shine-neutral"} inline-flex h-8 max-w-full items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition hover:brightness-95`}
      style={glassShineStyle(color, { color: on ? pillTextColor(color.startsWith("#") ? color : "#2F6BFF") : "var(--text-main)" })}
    >
      {on ? null : <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
      <span className="truncate">{label}</span>
      {count !== undefined ? <span className={`shrink-0 tabular-nums ${on ? "opacity-80" : ""}`} style={on ? undefined : { color: "var(--text-muted)" }}>{count}</span> : null}
    </button>
  );
}

// useSearchParams (the ?tab= param) needs a Suspense boundary.
export default function ArchivedPage() {
  return (
    <Suspense fallback={null}>
      <ArchivedPageInner />
    </Suspense>
  );
}

function ArchivedPageInner() {
  // Re-render when the company's date format changes.
  useCompanyFormats();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const access = useCompanyAccess();
  const { restoreScope, setReduceMainTopPadding } = useAppTabs();
  // The Undo bar along the bottom, after anything's deleted for good here (components/undo-bar.tsx).
  const offerUndo = useUndo();
  // This page's sticky header sits flush under the top bar instead of <main>'s usual top padding.
  useEffect(() => {
    setReduceMainTopPadding(true);
    return () => setReduceMainTopPadding(false);
  }, [setReduceMainTopPadding]);

  const uid = String(user?.uid || "").trim();
  const accessReady = access.status === "ready";
  const role = String(access.role || user?.role || "").trim().toLowerCase() || "staff";
  const isVerified = Boolean(user?.verified);
  // Same checks as the Leads, Contacts and Calendar pages.
  const isAdmin = isOwnerOrAdmin(access.role);
  const canSeeLeads =
    accessReady &&
    (isAdmin || hasPermissionKey(access.permissionKeys, "leads.view") || hasPermissionKey(access.permissionKeys, "leads.view.others"));
  const canViewOtherLeads = accessReady && (isAdmin || hasPermissionKey(access.permissionKeys, "leads.view.others"));
  const canViewAllContacts = accessReady && (isAdmin || hasPermissionKey(access.permissionKeys, "clients.view.all"));
  const canSeeContacts = accessReady && (isAdmin || hasPermissionKey(access.permissionKeys, "clients.view") || canViewAllContacts);
  const canViewCalendar =
    accessReady && (isAdmin || hasPermissionKey(access.permissionKeys, "calendar.view") || hasPermissionKey(access.permissionKeys, "calendar.edit"));
  // While access is still loading every kind shows (loading); once it's known, a kind this person can't use is left out.
  const kindAllowed = (kind: ArchiveKind) =>
    !accessReady || kind === "projects" || (kind === "leads" ? canSeeLeads : kind === "contacts" ? canSeeContacts : canViewCalendar);
  const allowedKinds = ARCHIVE_KINDS.filter(kindAllowed);

  // --- Which kinds, and how it was left ----------------------------------------------------------------------------
  // It opens on Everything — unless a link asks for one kind (?tab=leads — e.g. the old Recently Deleted address).
  const urlKind = parseKind(searchParams.get("tab"));
  const [kinds, setKinds] = useState<ArchiveKind[]>(() => (urlKind ? [urlKind] : []));
  const [sort, setSort] = useState<SortOrder>("newest");
  // Folders closed, and the cabinet's drawers opened or closed (by key) — anything not in here as it starts.
  const [closedFolders, setClosedFolders] = useState<Record<string, boolean>>({});
  const [drawerToggles, setDrawerToggles] = useState<Record<string, boolean>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [prefsLoadedFor, setPrefsLoadedFor] = useState("");
  useEffect(() => {
    if (!uid) return;
    // A device-local preference, restored after mount so the server's and the first client render match.
    /* eslint-disable react-hooks/set-state-in-effect */
    const prefs = readArchivePrefs(uid);
    setSort(prefs.sort);
    setClosedFolders(prefs.closed);
    setDrawerToggles(prefs.drawers);
    setFiltersOpen(prefs.filtersOpen);
    setPrefsLoadedFor(uid);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [uid]);
  useEffect(() => {
    if (!uid || prefsLoadedFor !== uid) return;
    try {
      window.localStorage.setItem(
        ARCHIVE_PREFS_STORAGE_KEY_PREFIX + uid,
        JSON.stringify({ sort, closed: closedFolders, drawers: drawerToggles, filtersOpen } satisfies ArchivePrefs),
      );
    } catch {
      // storage unavailable — just not remembered
    }
  }, [closedFolders, drawerToggles, filtersOpen, prefsLoadedFor, sort, uid]);
  // Opening and closing slide — but not as it's put back how it was left (it opens that way, not sliding there).
  const [canAnimate, setCanAnimate] = useState(false);
  useEffect(() => {
    if (!prefsLoadedFor || canAnimate) return;
    const frame = window.requestAnimationFrame(() => setCanAnimate(true));
    return () => window.cancelAnimationFrame(frame);
  }, [canAnimate, prefsLoadedFor]);

  // --- Data --------------------------------------------------------------------------------------------------------
  const [projects, setProjects] = useState<LoadState<Project>>({ status: "loading", rows: [] });
  const [leads, setLeads] = useState<LoadState<CompanyLeadRow>>({ status: "loading", rows: [] });
  const [contacts, setContacts] = useState<LoadState<CompanyClientRow>>({ status: "loading", rows: [] });
  const [events, setEvents] = useState<LoadState<ArchivedCalendarEvent>>({ status: "loading", rows: [] });
  const [companyName, setCompanyName] = useState("");
  const [projectStatusColors, setProjectStatusColors] = useState<Record<string, string>>({});
  const [projectStatusesRaw, setProjectStatusesRaw] = useState<unknown>(null);
  const [leadStatusColors, setLeadStatusColors] = useState<Record<string, string>>(DEFAULT_LEAD_STATUS_COLORS);
  // Which lead fields are the client's name ("Use for" in Company Settings → Integrations), so each lead is titled by
  // its client, like on the Leads page.
  const [leadFieldLayout, setLeadFieldLayout] = useState<unknown>(null);
  const [contactCategoryColors, setContactCategoryColors] = useState<Record<string, string>>({});
  const [calendarCategories, setCalendarCategories] = useState<CalendarCategory[]>([]);
  // Company Settings → Calendar → Archive events after: an event that ended before this would be hidden again on the
  // calendar straight away, so it isn't offered back (0 = never).
  const [eventCutoffMs, setEventCutoffMs] = useState(0);
  // The staff, by uid — the people on events and contacts.
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  // The staff (with an email address) — who a deleted project's copy can be emailed to.
  const [emailableMembers, setEmailableMembers] = useState<CompanyMemberOption[]>([]);
  // The projects this person can open (any, archived too) — an event linked to one they can't shows just the basics.
  // null until known (non-admins only).
  const [openableProjectIds, setOpenableProjectIds] = useState<Set<string> | null>(null);

  const companyId = String(access.companyId || "").trim();
  // Bumped by Try again to load a kind again.
  const [reloadTicks, setReloadTicks] = useState<Record<ArchiveKind, number>>({ projects: 0, leads: 0, contacts: 0, events: 0 });

  // Projects, plus the company doc (status/category colours, the calendar's settings, the company name).
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    const load = async () => {
      try {
        const stored = String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim();
        const preferred = Array.from(new Set([stored, String(user?.companyId || "").trim()].filter(Boolean)));
        // Only projects this person can view come back (each list checks every project), same as the dashboard.
        // Archived ones, plus any soft-deleted the old way (they count as archived).
        const [archivedRows, deletedRows, companyDoc] = await Promise.all([
          retryAsync(() => fetchProjects(uid, preferred, { lightweight: true, archived: "only" }), { attempts: 2, delayMs: 350 }),
          retryAsync(() => fetchDeletedProjects(uid, preferred), { attempts: 2, delayMs: 350 }).catch(() => [] as Project[]),
          preferred[0] ? fetchCompanyDoc(preferred[0]).catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const byId = new Map<string, Project>();
        for (const row of [...deletedRows, ...archivedRows]) byId.set(row.id, row);
        setProjects({ status: "ready", rows: Array.from(byId.values()) });
        const companyData = (companyDoc ?? {}) as Record<string, unknown>;
        const prefs = (companyData.applicationPreferences ?? {}) as Record<string, unknown>;
        setCompanyName(String(companyData.name ?? companyData.companyName ?? prefs.companyName ?? "").trim());
        setProjectStatusColors(colorMapFrom(companyData.projectStatuses));
        setProjectStatusesRaw(companyData.projectStatuses ?? null);
        setLeadStatusColors(colorMapFrom(companyData.leadStatuses, DEFAULT_LEAD_STATUS_COLORS));
        setLeadFieldLayout(((companyData.integrations as Record<string, unknown> | undefined)?.zapierLeads as Record<string, unknown> | undefined)?.fieldLayout ?? null);
        setContactCategoryColors(colorMapFrom(companyData.contactCategories));
        setCalendarCategories(normalizeCalendarCategories(companyData.calendarCategories));
        setEventCutoffMs(calendarRetentionCutoffMs(normalizeCalendarRetention(companyData.calendarEventRetention)));
      } catch {
        if (!cancelled) setProjects((prev) => ({ ...prev, status: "error" }));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadTicks.projects, uid, user?.companyId]);

  useEffect(() => {
    if (!canSeeLeads || !companyId) return;
    let cancelled = false;
    const load = async () => {
      try {
        // The preview holds every server call (lib/preview-runtime.ts) — its archived leads are read straight from its
        // own database instead.
        const rows = isPreviewMode()
          ? (await fetchCompanyLeads(companyId)).filter((lead) => lead.isDeleted)
          : await retryAsync(
              async () => {
                const response = await authorizedFetch(`/api/leads?companyId=${encodeURIComponent(companyId)}&archived=only`, { cache: "no-store" });
                const json = (await response.json().catch(() => null)) as { ok?: boolean; leads?: CompanyLeadRow[] } | null;
                if (!response.ok || !json?.ok || !Array.isArray(json.leads)) throw new Error("leads-load-failed");
                return json.leads;
              },
              { attempts: 2, delayMs: 350 },
            );
        if (cancelled) return;
        // Same as the Leads page: without "view others' leads", only the ones assigned to you.
        setLeads({
          status: "ready",
          rows: canViewOtherLeads ? rows : rows.filter((lead) => String(lead.assignedToUid || "").trim() === uid),
        });
      } catch {
        if (!cancelled) setLeads((prev) => ({ ...prev, status: "error" }));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [canSeeLeads, canViewOtherLeads, companyId, reloadTicks.leads, uid]);

  useEffect(() => {
    if (!canSeeContacts || !companyId) return;
    let cancelled = false;
    // Read straight from the database when the server can't be asked (as the Contacts page does — and in the preview).
    const direct = async () =>
      (await fetchCompanyClients(companyId, { viewerUid: uid, includeAll: canViewAllContacts, includeArchived: true })).filter(
        (row) => row.archived && !row.deleted,
      );
    const load = async () => {
      try {
        const rows = isPreviewMode()
          ? await direct()
          : await retryAsync(
              async () => {
                const response = await authorizedFetch(
                  `/api/clients?companyId=${encodeURIComponent(companyId)}&archived=only&scope=${canViewAllContacts ? "all" : "mine"}`,
                  { cache: "no-store" },
                );
                const json = (await response.json().catch(() => null)) as { ok?: boolean; clients?: CompanyClientRow[] } | null;
                if (!response.ok || !json?.ok || !Array.isArray(json.clients)) throw new Error("contacts-load-failed");
                return json.clients;
              },
              { attempts: 2, delayMs: 350 },
            ).catch(direct);
        if (!cancelled) setContacts({ status: "ready", rows });
      } catch {
        if (!cancelled) setContacts((prev) => ({ ...prev, status: "error" }));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [canSeeContacts, canViewAllContacts, companyId, reloadTicks.contacts, uid]);

  useEffect(() => {
    if (!canViewCalendar || !companyId) return;
    let cancelled = false;
    retryAsync(() => fetchArchivedCalendarEvents(companyId), { attempts: 2, delayMs: 350 }).then(
      (rows) => {
        if (!cancelled) setEvents({ status: "ready", rows });
      },
      () => {
        if (!cancelled) setEvents((prev) => ({ ...prev, status: "error" }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [canViewCalendar, companyId, reloadTicks.events]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    fetchCompanyMembers(companyId).then(
      (members) => {
        if (cancelled) return;
        const names: Record<string, string> = {};
        for (const member of members) {
          const name = String(member.displayName || member.email || "").trim();
          if (member.uid && name) names[member.uid] = name;
        }
        setMemberNames(names);
        setEmailableMembers(members.filter((member) => member.uid && String(member.email || "").includes("@")));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const needsOpenableProjects = accessReady && !isAdmin && events.rows.some((event) => event.projectId);
  useEffect(() => {
    if (!needsOpenableProjects || !uid || !companyId) return;
    let cancelled = false;
    fetchProjects(uid, [companyId], { lightweight: true, archived: "include" }).then(
      (rows) => {
        if (!cancelled) setOpenableProjectIds(new Set(rows.map((p) => p.id)));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [companyId, needsOpenableProjects, uid]);

  const retryKind = (kind: ArchiveKind) => {
    const toLoading = <T,>(prev: LoadState<T>): LoadState<T> => ({ ...prev, status: "loading" });
    if (kind === "projects") setProjects(toLoading);
    else if (kind === "leads") setLeads(toLoading);
    else if (kind === "contacts") setContacts(toLoading);
    else setEvents(toLoading);
    setReloadTicks((prev) => ({ ...prev, [kind]: prev[kind] + 1 }));
  };

  // --- The files ---------------------------------------------------------------------------------------------------
  // Worked out on each render (a few hundred at most) rather than memoised.
  const permissionKeysForProjects = access.permissionKeys.length ? access.permissionKeys : user?.permissions ?? [];
  const projectRows: ArchiveRow[] = projects.rows.map((project) => {
    const statusLabel = String(project.statusLabel || "").trim();
    // A project archived some other way without a date is filed under its last update instead of disappearing.
    const archivedIso = projectArchivedAtIso(project) || String(project.deletedAt || project.updatedAt || "").trim();
    const filedMs = isoMs(archivedIso);
    // Restoring and deleting both change the project, so they need the same access as editing it (which is also what
    // archiving it from its page needs).
    const canEdit = isVerified && accessReady && projectTabAccess(project, role, "general", uid, permissionKeysForProjects).edit;
    const customer = project.customer && project.customer !== "Unknown Customer" ? project.customer : "";
    const assigned = String(project.assignedToName || project.assignedTo || "").trim();
    const createdBy = String(project.createdByName || "").trim();
    return {
      kind: "projects",
      id: project.id,
      key: `projects:${project.id}`,
      filedMs,
      stampLabel: "Archived",
      stampDate: activeDate(filedMs),
      stampTime: timeLabel(filedMs),
      title: project.name || "Untitled",
      subtitle: customer,
      pill: statusLabel ? { label: statusLabel, color: projectStatusColors[statusLabel.toLowerCase()] || "#64748B" } : null,
      statusKey: statusLabel ? `projects:${statusLabel.toLowerCase()}` : "",
      people: Array.from(new Set([assigned, createdBy].filter(Boolean))),
      facts: [
        { label: "Client", value: customer },
        { label: "Address", value: String(project.clientAddress || "").trim() },
        { label: "Phone", value: String(project.clientPhone || "").trim() },
        { label: "Email", value: String(project.clientEmail || "").trim() },
        { label: "Assigned to", value: assigned },
        { label: "Created by", value: createdBy },
        { label: "Created", value: dateTimeLabel(String(project.createdAt || "")) },
        { label: "Completed", value: dateTimeLabel(String(project.completedAtIso || "")) },
        { label: "Archived", value: dateTimeLabel(archivedIso) },
      ].filter((fact) => fact.value),
      note: "",
      searchText: [project.name, project.customer, statusLabel, project.clientAddress, project.createdByName, assigned].join(" ").toLowerCase(),
      canRestore: canEdit,
      canDelete: canEdit,
      restoreTitle:
        "Put it back on the Dashboard. If it's still in a Completed status, it's archived again after the archive delay (under Instantly, only once it's completed again).",
    };
  });

  // Archiving a lead needs the Leads page (leads.view); restoring or deleting one needs the same.
  const canActOnLeads = isVerified && canSeeLeads;
  const leadRows: ArchiveRow[] = leads.rows.map((lead) => {
    const archivedIso = String(lead.deletedAtIso || lead.updatedAtIso || lead.createdAtIso || "").trim();
    const filedMs = isoMs(archivedIso);
    const status = String(lead.status || "").trim();
    const assigned = String(lead.assignedToName || lead.assignedTo || "").trim();
    const clientName = leadClientDisplayName(lead.rawFields, leadFieldLayout) || String(lead.name || "").trim();
    return {
      kind: "leads",
      id: lead.id,
      key: `leads:${lead.id}`,
      filedMs,
      stampLabel: "Archived",
      stampDate: activeDate(filedMs),
      stampTime: timeLabel(filedMs),
      title: clientName || lead.email || lead.phone || "Lead",
      subtitle: [lead.email, lead.phone].map((value) => String(value || "").trim()).find((value) => value && value !== (clientName || lead.email || lead.phone)) ?? "",
      pill: status ? { label: status, color: leadStatusColors[status.toLowerCase()] || "#64748B" } : null,
      statusKey: status ? `leads:${status.toLowerCase()}` : "",
      people: assigned ? [assigned] : [],
      facts: [
        { label: "Email", value: String(lead.email || "").trim() },
        { label: "Phone", value: String(lead.phone || "").trim() },
        { label: "Form", value: String(lead.formName || "").trim() },
        { label: "Assigned to", value: assigned },
        { label: "Came in", value: dateTimeLabel(String(lead.submittedAtIso || lead.createdAtIso || "")) },
        { label: "Archived", value: dateTimeLabel(archivedIso) },
      ].filter((fact) => fact.value),
      note: String(lead.message || "").trim(),
      searchText: [clientName, lead.name, lead.email, lead.phone, lead.formName, lead.message, status, assigned].join(" ").toLowerCase(),
      canRestore: canActOnLeads,
      canDelete: canActOnLeads,
      restoreTitle: "Put it back on the Leads page",
    };
  });

  // Restoring a contact is the reverse of archiving it (anyone who can use Contacts); deleting one for good is kept to
  // owners and admins.
  const canRestoreContacts = isVerified && canSeeContacts;
  const canDeleteContacts = isVerified && accessReady && isAdmin;
  const contactRows: ArchiveRow[] = contacts.rows.map((contact) => {
    const archivedIso = String(contact.archivedAtIso || contact.updatedAtIso || "").trim();
    const filedMs = isoMs(archivedIso);
    const category = String(contact.category || "").trim();
    const people = Array.from(
      new Set([...(contact.assignedToUids ?? []), ...(contact.createdByUids ?? [])].map((id) => memberNames[id]).filter((name): name is string => Boolean(name))),
    );
    return {
      kind: "contacts",
      id: contact.id,
      key: `contacts:${contact.id}`,
      filedMs,
      stampLabel: "Archived",
      stampDate: activeDate(filedMs),
      stampTime: timeLabel(filedMs),
      title: contact.name || contact.email || contact.phone || "Contact",
      subtitle: [contact.email, contact.phone].map((value) => String(value || "").trim()).find((value) => value && value !== (contact.name || contact.email || contact.phone)) ?? "",
      pill: category ? { label: category, color: contactCategoryColors[category.toLowerCase()] || "#7D99B3" } : null,
      statusKey: category ? `contacts:${category.toLowerCase()}` : "",
      people,
      facts: [
        { label: "Email", value: String(contact.email || "").trim() },
        { label: "Phone", value: String(contact.phone || "").trim() },
        { label: "Address", value: String(contact.address || "").trim() },
        { label: "Projects", value: contact.projectCount ? String(contact.projectCount) : "" },
        { label: "Added", value: dateTimeLabel(String(contact.createdAtIso || "")) },
        { label: "Archived", value: dateTimeLabel(archivedIso) },
      ].filter((fact) => fact.value),
      note: String(contact.notes || "").trim(),
      searchText: [contact.name, contact.email, contact.phone, contact.address, category, contact.notes].join(" ").toLowerCase(),
      canRestore: canRestoreContacts,
      canDelete: canDeleteContacts,
      restoreTitle: "Put it back in Contacts",
    };
  });

  // Events: who can see and change each follows its category (Company Settings → Calendar), as on the calendar; one
  // linked to a project this person can't open shows just its title, time and category.
  const categoryById = new Map(calendarCategories.map((category) => [category.id, category]));
  const roleKey = normalizeRoleKey(access.roleId || access.role);
  const eventRows: ArchiveRow[] = events.rows.flatMap((event): ArchiveRow[] => {
    const category = categoryById.get(event.categoryId);
    const level = calendarCategoryLevel(category, { isAdmin, roleKey, canViewCalendar });
    if (level === "none") return [];
    const restricted = !isAdmin && Boolean(event.projectId) && !openableProjectIds?.has(event.projectId);
    const canEdit = isVerified && level === "edit" && !restricted;
    const when = eventWhen(event);
    const staff = (event.staffUids ?? []).map((id) => memberNames[id]).filter((name): name is string => Boolean(name));
    const addedBy = String(event.createdByName || "").trim();
    const categoryName = category?.name || "No category";
    return [
      {
        kind: "events",
        id: event.id,
        key: `events:${event.id}`,
        filedMs: event.startMs,
        stampLabel: "Event",
        stampDate: when.date,
        stampTime: when.time,
        title: event.title || "Untitled event",
        subtitle: restricted ? "Linked to a project you can't open" : event.projectName || event.location,
        pill: { label: categoryName, color: category?.color || "#7D99B3" },
        statusKey: `events:${categoryName.toLowerCase()}`,
        people: restricted ? [] : Array.from(new Set([...staff, addedBy].filter(Boolean))),
        facts: restricted
          ? [
              { label: "When", value: `${when.date} · ${when.time}` },
              { label: "Category", value: categoryName },
            ]
          : [
              { label: "When", value: `${when.date} · ${when.time}` },
              { label: "Category", value: categoryName },
              { label: "Location", value: event.location },
              { label: "Project", value: event.projectName },
              { label: "Staff", value: staff.join(", ") },
              { label: "Added by", value: addedBy },
              { label: "Archived", value: dateTimeLabel(event.archivedAtIso) },
            ].filter((fact) => fact.value),
        note: restricted ? "" : event.notes.trim(),
        searchText: (restricted ? [event.title, categoryName] : [event.title, categoryName, event.location, event.projectName, event.notes, addedBy, ...staff])
          .join(" ")
          .toLowerCase(),
        canRestore: canEdit && (!eventCutoffMs || event.endMs > eventCutoffMs),
        canDelete: canEdit,
        restoreTitle: "Put it back on the calendar",
      },
    ];
  });

  // No active company (nothing to read leads/contacts/events from) reads as empty, not loading.
  const noCompany = accessReady && !companyId;
  const emptyReady: LoadState<never> = { status: "ready", rows: [] };
  const loadStateFor: Record<ArchiveKind, LoadState<unknown>> = {
    projects,
    leads: noCompany ? emptyReady : leads,
    contacts: noCompany ? emptyReady : contacts,
    events: noCompany ? emptyReady : events,
  };
  const rowsByKind: Record<ArchiveKind, ArchiveRow[]> = { projects: projectRows, leads: leadRows, contacts: contactRows, events: eventRows };
  // Files deleted a moment ago, still waiting on the Undo bar (see deleteWithUndo): out of the cabinet already, though
  // they're only deleted for good as the bar goes.
  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(() => new Set());
  const allRows = allowedKinds.flatMap((kind) => rowsByKind[kind]).filter((row) => !deletingKeys.has(row.key));

  // --- Filters -----------------------------------------------------------------------------------------------------
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [peopleFilter, setPeopleFilter] = useState<string[]>([]);
  const [fromMonth, setFromMonth] = useState("");
  // Today, as the page opened (the quick ranges count back from its month).
  const [nowDate] = useState(() => new Date());
  const [toMonth, setToMonth] = useState("");
  const query = search.trim().toLowerCase();
  const pickedKinds = kinds.filter((kind) => allowedKinds.includes(kind));
  // The one kind picked — or none: everything.
  const shownKinds = pickedKinds.length ? pickedKinds : allowedKinds;
  const ofShownKinds = allRows.filter((row) => shownKinds.includes(row.kind));

  // The statuses / categories and the people there are to pick from (in what's shown), with how many of each.
  const statusOptions: Array<{ key: string; label: string; color: string; kind: ArchiveKind; count: number }> = [];
  const peopleCounts = new Map<string, number>();
  for (const row of ofShownKinds) {
    if (row.statusKey && row.pill) {
      const existing = statusOptions.find((option) => option.key === row.statusKey);
      if (existing) existing.count += 1;
      else statusOptions.push({ key: row.statusKey, label: row.pill.label, color: row.pill.color, kind: row.kind, count: 1 });
    }
    row.people.forEach((name) => peopleCounts.set(name, (peopleCounts.get(name) ?? 0) + 1));
  }
  statusOptions.sort((a, b) => ARCHIVE_KINDS.indexOf(a.kind) - ARCHIVE_KINDS.indexOf(b.kind) || a.label.localeCompare(b.label));
  const peopleOptions = Array.from(peopleCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // (Ones picked that aren't there any more — another kind's, say — don't count.)
  const activeStatusFilter = statusFilter.filter((key) => statusOptions.some((option) => option.key === key));
  const activePeopleFilter = peopleFilter.filter((name) => peopleCounts.has(name));
  // The months for the range: every one from the oldest filed to now (and any picked), newest first.
  const monthLabelOf = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return Number.isFinite(y) && Number.isFinite(m) ? new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(new Date(y, m - 1, 1)) : key;
  };
  const rangeKeys = [...allRows.map((row) => monthKeyOf(row.filedMs)), monthKeyOf(nowDate.getTime()), fromMonth, toMonth].filter((key) => /^\d{4}-\d{2}$/.test(key)).sort();
  const monthOptions: Array<{ key: string; label: string }> = [];
  if (rangeKeys.length) {
    const [lastY, lastM] = rangeKeys[rangeKeys.length - 1].split("-").map(Number);
    // (Twenty years at most, should a date be way off.)
    for (let i = 0; i < 240; i += 1) {
      const key = monthKeyOf(new Date(lastY, lastM - 1 - i, 1).getTime());
      monthOptions.push({ key, label: monthLabelOf(key) });
      if (key <= rangeKeys[0]) break;
    }
  }
  const hasRange = Boolean(fromMonth || toMonth);
  const activeFilterCount = (hasRange ? 1 : 0) + activeStatusFilter.length + activePeopleFilter.length;

  const passesFilters = (row: ArchiveRow) => {
    if (query && !row.searchText.includes(query)) return false;
    if (hasRange) {
      const key = monthKeyOf(row.filedMs);
      if (key === "undated" || (fromMonth && key < fromMonth) || (toMonth && key > toMonth)) return false;
    }
    if (activeStatusFilter.length && !activeStatusFilter.includes(row.statusKey)) return false;
    if (activePeopleFilter.length && !row.people.some((name) => activePeopleFilter.includes(name))) return false;
    return true;
  };
  // Everything the filters let through, any kind (the kind chips' counts) — and of the kinds shown (the cabinet).
  const passingRows = allRows.filter(passesFilters);
  const filtered = passingRows.filter((row) => shownKinds.includes(row.kind));
  const drawers = fileRows(filtered, sort);
  const folders = drawers.flatMap((drawer) => drawer.months);

  // Just that kind — or, pressed again, everything.
  const toggleKind = (kind: ArchiveKind) => setKinds((prev) => (prev.length === 1 && prev[0] === kind ? [] : [kind]));
  const toggleIn = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  // Quick ranges, by month (to the current month).
  const monthsBack = (n: number) => monthKeyOf(new Date(nowDate.getFullYear(), nowDate.getMonth() - n, 1).getTime());
  const rangePresets = [
    { label: "This month", from: monthsBack(0), to: monthsBack(0) },
    { label: "Last 3 months", from: monthsBack(2), to: monthsBack(0) },
    { label: "Last 12 months", from: monthsBack(11), to: monthsBack(0) },
    { label: "This year", from: `${nowDate.getFullYear()}-01`, to: monthsBack(0) },
    { label: "Last year", from: `${nowDate.getFullYear() - 1}-01`, to: `${nowDate.getFullYear() - 1}-12` },
  ];
  const clearFilters = () => {
    setStatusFilter([]);
    setPeopleFilter([]);
    setFromMonth("");
    setToMonth("");
  };
  const clearEverything = () => {
    clearFilters();
    setSearch("");
    setKinds([]);
  };

  // --- Folders and the cabinet -------------------------------------------------------------------------------------
  const isFolderOpen = (key: string) => Boolean(query) || !closedFolders[key];
  const toggleFolder = (key: string) => setClosedFolders((prev) => ({ ...prev, [key]: !prev[key] }));
  const anyFolderOpen = folders.some((folder) => !closedFolders[folder.key]);
  const setAllFolders = (open: boolean) =>
    setClosedFolders((prev) => {
      const next = { ...prev };
      folders.forEach((folder) => (open ? delete next[folder.key] : (next[folder.key] = true)));
      return next;
    });
  // The folder at the top of the screen (lit in the cabinet), and its year's drawer: the last one whose top has gone up
  // under the sticky header (and a phone's month strip). One gone to from the cabinet stays lit till they scroll
  // themselves (jumpHeldRef) — near the bottom it can't come up that far.
  const [activeFolder, setActiveFolder] = useState("");
  const jumpHeldRef = useRef(false);
  const folderSignature = folders.map((folder) => folder.key).join("|");
  useEffect(() => {
    if (!folderSignature) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (jumpHeldRef.current) return;
      const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-archive-folder]"));
      let current = elements[0];
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= 150) current = element;
        else break;
      }
      if (current) setActiveFolder(current.dataset.archiveFolder ?? "");
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const release = () => {
      jumpHeldRef.current = false;
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchstart", release, { passive: true });
    window.addEventListener("keydown", release);
    update();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchstart", release);
      window.removeEventListener("keydown", release);
    };
  }, [folderSignature]);
  const activeKey = folders.some((folder) => folder.key === activeFolder) ? activeFolder : folders[0]?.key ?? "";
  const activeYear = folders.find((folder) => folder.key === activeKey)?.yearKey ?? "";
  const isDrawerOpen = (key: string, index: number) => drawerToggles[key] ?? (key === activeYear || index === 0);
  const toggleDrawer = (key: string, open: boolean) => setDrawerToggles((prev) => ({ ...prev, [key]: !open }));
  const jumpToFolder = (key: string) => {
    setClosedFolders((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setActiveFolder(key);
    jumpHeldRef.current = true;
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-archive-folder="${CSS.escape(key)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  // A phone's strip of months keeps the lit one in view.
  const monthStripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const strip = monthStripRef.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-month-chip="${CSS.escape(activeKey)}"]`);
    if (!strip || !chip) return;
    const left = chip.offsetLeft - strip.clientWidth / 2 + chip.offsetWidth / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [activeKey]);

  // --- Opening a file, and selecting -------------------------------------------------------------------------------
  const [openFileKey, setOpenFileKey] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Phones only show the ticks in select mode (the Select button), so files aren't cramped; on wider screens they're
  // always there. Ticking anything also counts as selecting.
  const [selectMode, setSelectMode] = useState(false);
  const selectableKeysOf = (list: ArchiveRow[]) => list.filter((row) => row.canRestore || row.canDelete).map((row) => row.key);
  // Only what's listed counts — a selection hidden by the filters is left out.
  const selectedRows = filtered.filter((row) => selected.has(row.key));
  const isSelecting = selectMode || selectedRows.length > 0;
  const toggleKeys = (keys: string[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = keys.length > 0 && keys.every((key) => prev.has(key));
      keys.forEach((key) => (allOn ? next.delete(key) : next.add(key)));
      return next;
    });
  const clearSelection = () => {
    setSelected(new Set());
    setSelectMode(false);
  };

  // --- Restore / delete --------------------------------------------------------------------------------------------
  const [busy, setBusy] = useState<{ action: "restore" | "delete"; keys: string[] } | null>(null);
  // The file whose delete button the pointer is over — it's lit red.
  const [hoveredDeleteKey, setHoveredDeleteKey] = useState("");
  const [notice, setNotice] = useState("");
  // A file's Restore asks first, in a pop-up (components/restore-dialog.tsx) — for a project, with the status it comes
  // back in.
  const [restoreTarget, setRestoreTarget] = useState<ArchiveRow | null>(null);

  const dropRows = (kind: ArchiveKind, ids: string[]) => {
    if (!ids.length) return;
    const gone = new Set(ids);
    const keep = <T extends { id: string }>(prev: LoadState<T>): LoadState<T> => ({ ...prev, rows: prev.rows.filter((row) => !gone.has(row.id)) });
    if (kind === "projects") setProjects(keep);
    else if (kind === "leads") setLeads(keep);
    else if (kind === "contacts") setContacts(keep);
    else setEvents(keep);
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(`${kind}:${id}`));
      return next;
    });
  };

  // Runs one task per item a few at a time; returns the ids that worked.
  const runEach = async (ids: string[], task: (id: string) => Promise<boolean>): Promise<string[]> => {
    const done: string[] = [];
    for (let i = 0; i < ids.length; i += 4) {
      const chunk = ids.slice(i, i + 4);
      const results = await Promise.all(chunk.map((id) => task(id).catch(() => false)));
      chunk.forEach((id, j) => {
        if (results[j]) done.push(id);
      });
    }
    return done;
  };

  const contactFilter = { viewerUid: uid, includeAll: canViewAllContacts };
  // A preview lead (its own database — lib/preview-seed.ts): changed there, as the server would.
  const previewLeadDoc = (id: string) => (db ? doc(db, "companies", companyId, "leads", id) : null);

  const restoreKind = async (kind: ArchiveKind, ids: string[]): Promise<string[]> => {
    if (kind === "projects") {
      const byId = new Map(projects.rows.map((row) => [row.id, row]));
      return runEach(ids, async (id) => {
        const project = byId.get(id);
        if (!project) return false;
        const ok = await restoreArchivedProject(project);
        // Lets it register a tab in the top bar again if it was archived from its page this session.
        if (ok) restoreScope(`project:${id}`);
        return ok;
      });
    }
    if (kind === "leads") {
      if (isPreviewMode()) {
        return runEach(ids, async (id) => {
          const ref = previewLeadDoc(id);
          if (!ref) return false;
          await setDoc(ref, { isDeleted: false, deletedAtIso: "" }, { merge: true });
          return true;
        });
      }
      const byId = new Map(leads.rows.map((row) => [row.id, row]));
      return runEach(ids, async (id) => {
        const lead = byId.get(id);
        if (!lead) return false;
        const response = await authorizedFetch("/api/leads", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId: lead.companyId || companyId, leadId: id, isDeleted: false }),
        });
        return response.ok;
      });
    }
    if (kind === "contacts") {
      return restoreArchivedCompanyClients(
        companyId,
        contacts.rows.filter((row) => ids.includes(row.id)),
        contactFilter,
      );
    }
    return runEach(ids, (id) => restoreArchivedCalendarEvent(companyId, id));
  };

  const deleteKind = async (kind: ArchiveKind, ids: string[]): Promise<string[]> => {
    if (kind === "projects") {
      const byId = new Map(projects.rows.map((row) => [row.id, row]));
      return runEach(ids, async (id) => {
        const project = byId.get(id);
        return project ? permanentlyDeleteProject(project) : false;
      });
    }
    if (kind === "leads") {
      if (isPreviewMode()) {
        return runEach(ids, async (id) => {
          const ref = previewLeadDoc(id);
          if (!ref) return false;
          await deleteDoc(ref);
          return true;
        });
      }
      try {
        const response = await authorizedFetch("/api/leads", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, leadIds: ids }),
        });
        const json = (await response.json().catch(() => null)) as { ok?: boolean; deleted?: string[] } | null;
        return response.ok && json?.ok && Array.isArray(json.deleted) ? json.deleted : [];
      } catch {
        return [];
      }
    }
    if (kind === "contacts") {
      return permanentlyDeleteCompanyClients(
        companyId,
        contacts.rows.filter((row) => ids.includes(row.id)),
        contactFilter,
      );
    }
    return runEach(ids, async (id) => (await deleteCalendarEvent(companyId, id)).ok);
  };

  // Each kind in turn (they're stored in different places); what worked leaves the cabinet. Returns how many didn't.
  const runOnKinds = async (action: "restore" | "delete", chosen: ArchiveRow[]): Promise<number> => {
    let failed = 0;
    for (const kind of ARCHIVE_KINDS) {
      const ids = chosen.filter((row) => row.kind === kind).map((row) => row.id);
      if (!ids.length) continue;
      const done = await (action === "restore" ? restoreKind(kind, ids) : deleteKind(kind, ids));
      dropRows(kind, done);
      failed += ids.length - done.length;
    }
    return failed;
  };

  // Anything that didn't work stays, with a note.
  const actOnRows = async (action: "restore" | "delete", rows: ArchiveRow[]) => {
    const chosen = rows.filter((row) => (action === "restore" ? row.canRestore : row.canDelete));
    if (!chosen.length || busy) return;
    setBusy({ action, keys: chosen.map((row) => row.key) });
    setNotice("");
    const failed = await runOnKinds(action, chosen);
    if (failed) setNotice(`Couldn't ${action} ${itemCount(failed)} — please try again.`);
    setBusy(null);
  };

  // Deleting for good (once its pop-up's said yes): out of the cabinet straight away, with the Undo bar — but only
  // deleted as the bar goes without Undo pressed (a project's images and files go with it, so nothing could be put back
  // afterwards); Undo just puts the files back in the cabinet. Any that can't be deleted then come back, with a note.
  const deleteWithUndo = (rows: ArchiveRow[]) => {
    const chosen = rows.filter((row) => row.canDelete);
    if (!chosen.length) return;
    const keys = chosen.map((row) => row.key);
    const putBack = () =>
      setDeletingKeys((prev) => {
        const next = new Set(prev);
        keys.forEach((key) => next.delete(key));
        return next;
      });
    setNotice("");
    setDeletingKeys((prev) => new Set([...prev, ...keys]));
    setSelected((prev) => {
      const next = new Set(prev);
      keys.forEach((key) => next.delete(key));
      return next;
    });
    offerUndo(`${chosen.length === 1 ? chosen[0].title || "Item" : breakdownText(chosen)} deleted`, putBack, {
      commit: async () => {
        const failed = await runOnKinds("delete", chosen);
        putBack();
        if (failed) setNotice(`Couldn't delete ${itemCount(failed)} — please try again.`);
      },
    });
  };

  // A project's new status (if one was picked) is written first, then it comes out of the Archive.
  const confirmRestore = async (status: string, subStage: string) => {
    const target = restoreTarget;
    if (!target || busy) return;
    if (target.kind === "projects") {
      const project = projects.rows.find((row) => row.id === target.id);
      const currentStatus = String(project?.statusLabel || "").trim();
      const currentSubStage = String(project?.dashboardSubStageId || "").trim();
      if (project && status && (status !== currentStatus || subStage !== currentSubStage)) {
        setBusy({ action: "restore", keys: [target.key] });
        const ok = await updateProjectStatus(project, status, subStage);
        setBusy(null);
        if (!ok) {
          // Locked into a bonus period (the Dashboard's Completed pop-up): it can only come back as it is.
          const locked = project.companyId ? await fetchBonusLock(project.companyId, project.id) : "";
          setNotice(
            locked
              ? `${project.name || "This project"} is locked, so its status can't change — restore it with its current status.`
              : "Couldn't restore this project — please try again.",
          );
          setRestoreTarget(null);
          return;
        }
      }
    }
    setRestoreTarget(null);
    await actOnRows("restore", [target]);
  };

  // "Delete permanently" always asks first, in a pop-up.
  const [pendingDelete, setPendingDelete] = useState<{ rows: ArchiveRow[]; skipped: number } | null>(null);
  const [deleteOrigin, setDeleteOrigin] = useState<GlassModalOrigin>(null);
  const deletePanelRef = useRef<HTMLDivElement | null>(null);
  const deleteOriginElRef = useRef<HTMLElement | null>(null);
  const shouldRenderDeleteModal = useGlassModalPopOrigin(Boolean(pendingDelete), deleteOrigin, deletePanelRef, undefined, deleteOriginElRef);
  // A project's copy, emailed before it goes (lib/project-email-copy.ts): on, with everything in it, to its assigned
  // person — whoever's deleting can turn parts off and pick other staff. Each project gets its own email.
  const [copyEmail, setCopyEmail] = useState(true);
  const [copySections, setCopySections] = useState<ProjectCopySections>(ALL_PROJECT_COPY_SECTIONS);
  // Staff picked by uid, and whether each project's own assigned person gets theirs too.
  const [copyRecipients, setCopyRecipients] = useState<string[]>([]);
  const [copyToAssigned, setCopyToAssigned] = useState(true);
  const [copySending, setCopySending] = useState(false);
  const [copyError, setCopyError] = useState("");
  const pendingProjects = (pendingDelete?.rows ?? [])
    .filter((row) => row.kind === "projects")
    .map((row) => projects.rows.find((project) => project.id === row.id))
    .filter((project): project is Project => Boolean(project));
  const assignedUidOf = (project: Project) => String(project.assignedToUid || "").trim();
  const emailableUids = new Set(emailableMembers.map((member) => member.uid));
  const copyRecipientsFor = (project: Project) =>
    Array.from(new Set([...copyRecipients, ...(copyToAssigned && emailableUids.has(assignedUidOf(project)) ? [assignedUidOf(project)] : [])]));
  const copyHasContent = Object.values(copySections).some(Boolean);
  const copyWillSend = copyEmail && pendingProjects.length > 0 && copyHasContent && pendingProjects.some((project) => copyRecipientsFor(project).length > 0);

  const askDelete = (e: ReactMouseEvent<HTMLElement>, chosen: ArchiveRow[]) => {
    const deletable = chosen.filter((row) => row.canDelete);
    if (!deletable.length || busy) return;
    deleteOriginElRef.current = e.currentTarget;
    setDeleteOrigin(captureGlassModalOrigin(e));
    setCopyEmail(true);
    setCopySections(ALL_PROJECT_COPY_SECTIONS);
    setCopyRecipients([]);
    setCopyToAssigned(true);
    setCopyError("");
    setPendingDelete({ rows: deletable, skipped: chosen.length - deletable.length });
  };
  const confirmDelete = async () => {
    if (!pendingDelete || copySending) return;
    const { rows } = pendingDelete;
    if (copyWillSend) {
      // Emailed first — a project whose copy couldn't be sent isn't deleted (the pop-up stays, saying so).
      setCopySending(true);
      setCopyError("");
      const failed: string[] = [];
      let preview = false;
      for (const project of pendingProjects) {
        const recipientUids = copyRecipientsFor(project);
        if (!recipientUids.length) continue;
        const result = await sendProjectCopyEmail({ project, sections: copySections, recipientUids });
        if (!result.ok) failed.push(String(project.name || "Untitled"));
        else if (result.preview) preview = true;
      }
      setCopySending(false);
      if (failed.length) {
        setCopyError(`Couldn't email ${failed.join(", ")}, so nothing's been deleted. Try again, or turn the email off to delete without it.`);
        return;
      }
      if (preview) setNotice("Preview — the email copy was made but not sent (nothing leaves the Preview).");
    }
    setPendingDelete(null);
    deleteWithUndo(rows);
  };

  const openProject = (id: string) => {
    const project = projects.rows.find((row) => row.id === id);
    if (!project) return;
    // An archived project opens normally, with a note saying it's archived — but no tab in the top bar (fromArchive:
    // the project page skips its loading tab).
    const name = String(project.name || "").trim();
    router.push(name ? `/projects/${id}?openName=${encodeURIComponent(name)}&fromArchive=1` : `/projects/${id}?fromArchive=1`);
  };

  const onFileClick = (row: ArchiveRow) => {
    if (isSelecting) {
      if (row.canRestore || row.canDelete) toggleKeys([row.key]);
      return;
    }
    setOpenFileKey((prev) => (prev === row.key ? "" : row.key));
  };

  // --- How it looks ------------------------------------------------------------------------------------------------
  const mutedPillStyle: CSSProperties = { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" };
  // On phones the ticks only show while selecting (see selectMode).
  const dotVisibility = isSelecting ? "" : "max-sm:hidden";
  const restorableSelected = selectedRows.filter((row) => row.canRestore);
  const deletableSelected = selectedRows.filter((row) => row.canDelete);
  const allSelectable = selectableKeysOf(filtered);
  const errorKinds = shownKinds.filter((kind) => loadStateFor[kind].status === "error");
  const isLoadingAny = shownKinds.some((kind) => loadStateFor[kind].status === "loading");
  const anyFilterOrSearch = Boolean(query) || activeFilterCount > 0 || pickedKinds.length > 0;

  const renderKindDots = (rows: ArchiveRow[], withLabels: boolean) => (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
      {kindCounts(rows).map(({ kind, count }) => (
        <span key={kind} className="inline-flex items-center gap-1 text-[11.5px] font-medium tabular-nums" style={{ color: "var(--text-muted)" }}>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: KIND_META[kind].color }} />
          {withLabels ? countOf(count, KIND_META[kind].one, KIND_META[kind].many) : count}
        </span>
      ))}
    </span>
  );

  // One file. Left: its tick, its kind's round badge, its title (bigger) and whose it is beside it. Right: its status or
  // category, when it was archived (its date, then the time), restore and delete. Opened: its details.
  const renderFile = (row: ArchiveRow) => {
    const meta = KIND_META[row.kind];
    const Icon = meta.icon;
    const isChecked = selected.has(row.key);
    const selectable = row.canRestore || row.canDelete;
    const isBusy = Boolean(busy?.keys.includes(row.key));
    const isOpen = openFileKey === row.key && !isSelecting;
    const deleteLit = hoveredDeleteKey === row.key;
    return (
      <div
        key={row.key}
        className="overflow-hidden rounded-[18px] border transition-[background-color,border-color,opacity]"
        style={{
          borderColor: deleteLit ? "var(--danger-border)" : isChecked ? "var(--brand)" : "var(--glass-border)",
          backgroundColor: deleteLit
            ? "var(--danger-soft)"
            : isChecked
              ? "color-mix(in srgb, var(--brand) 9%, var(--panel-bg))"
              : isOpen
                ? "var(--panel-bg)"
                : "color-mix(in srgb, var(--panel-bg) 62%, transparent)",
          opacity: isBusy ? 0.6 : 1,
        }}
      >
        <div className="flex items-center gap-2 py-2 pl-2 pr-2 sm:gap-2.5 sm:pl-2.5">
          {selectable ? (
            <SelectDot state={isChecked ? "all" : "none"} onToggle={() => toggleKeys([row.key])} label={`Select ${row.title}`} className={dotVisibility} />
          ) : null}
          <button
            type="button"
            onClick={() => onFileClick(row)}
            aria-expanded={isSelecting ? undefined : isOpen}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left sm:gap-3"
          >
            <span
              className="glass-shine inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
              style={glassShineStyle(meta.color)}
              title={meta.label}
            >
              <Icon size={15} strokeWidth={2.1} />
            </span>
            {/* Its title and, beside it, whose it is (a phone: under it, with its time — it has no time stamp column). */}
            <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2.5">
              <span className="min-w-0 truncate text-[15px] font-medium sm:shrink-0 sm:max-w-[60%]" style={{ color: "var(--text-main)" }}>
                {row.title}
              </span>
              <span className="min-w-0 truncate text-[12.5px] font-medium max-sm:hidden" style={{ color: "var(--text-muted)" }}>
                {row.subtitle}
              </span>
              <span className="min-w-0 truncate text-[11.5px] font-medium sm:hidden" style={{ color: "var(--text-muted)" }}>
                {[row.stampTime, row.subtitle].filter(Boolean).join(" · ") || meta.label}
              </span>
            </span>
            {row.pill ? (
              <span
                className="glass-shine inline-flex h-6 max-w-[150px] shrink-0 items-center rounded-full px-2.5 text-[11px] font-medium max-md:hidden"
                style={glassShineStyle(row.pill.color, { color: pillTextColor(row.pill.color) })}
              >
                <span className="truncate">{row.pill.label}</span>
              </span>
            ) : null}
            <span className="w-[132px] shrink-0 text-right max-sm:hidden" title={`${row.stampLabel} ${row.stampDate} · ${row.stampTime}`}>
              <span className="block truncate text-[12px] font-medium tabular-nums" style={{ color: "var(--text-main)" }}>
                {row.stampDate || "No date"}
              </span>
              <span className="block truncate text-[11px] font-medium tabular-nums" style={{ color: "var(--text-muted)" }}>
                {[row.stampLabel, row.stampTime].filter(Boolean).join(" · ")}
              </span>
            </span>
          </button>
          {/* Its actions; on phones they step aside while selecting. */}
          <div className={`flex shrink-0 items-center gap-1.5 ${isSelecting ? "max-sm:hidden" : ""}`}>
            {row.canRestore ? (
              <RoundButton color="var(--brand)" title={row.restoreTitle} disabled={Boolean(busy)} onClick={() => !busy && setRestoreTarget(row)}>
                <ArchiveRestore size={14} />
              </RoundButton>
            ) : null}
            {row.canDelete ? (
              <RoundButton
                color="var(--danger)"
                title="Delete permanently"
                disabled={Boolean(busy)}
                onClick={(e) => askDelete(e, [row])}
                onMouseEnter={() => setHoveredDeleteKey(row.key)}
                onMouseLeave={() => setHoveredDeleteKey((prev) => (prev === row.key ? "" : prev))}
              >
                <Trash2 size={14} />
              </RoundButton>
            ) : null}
          </div>
        </div>
        {isOpen ? (
          <div
            className="border-t px-3 pb-3 pt-2.5 transition-[opacity,transform] duration-200 ease-out starting:-translate-y-1 starting:opacity-0 motion-reduce:transition-none sm:pl-[58px]"
            style={{ borderColor: "var(--glass-border)" }}
          >
            {row.pill ? (
              <span
                className="glass-shine mb-2 inline-flex h-6 max-w-full items-center rounded-full px-2.5 text-[11px] font-medium md:hidden"
                style={glassShineStyle(row.pill.color, { color: pillTextColor(row.pill.color) })}
              >
                <span className="truncate">{row.pill.label}</span>
              </span>
            ) : null}
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
              {row.facts.map((fact) => (
                <div key={fact.label} className="min-w-0">
                  <dt className="text-[10.5px] font-medium uppercase tracking-[0.8px]" style={{ color: "var(--text-muted)" }}>
                    {fact.label}
                  </dt>
                  <dd className="break-words text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
            {row.note ? (
              <p
                className="mt-2.5 whitespace-pre-wrap rounded-[14px] border px-3 py-2 text-[12.5px] font-medium"
                style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
              >
                {row.note}
              </p>
            ) : null}
            {row.kind === "projects" ? (
              <button
                type="button"
                onClick={() => openProject(row.id)}
                className="glass-shine mt-3 inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-medium text-white transition hover:brightness-95"
                style={glassShineStyle("var(--brand)")}
              >
                <ExternalLink size={13} />
                Open project
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div
      className="flex flex-col bg-transparent"
      style={{
        marginLeft: "calc(-1 * max(12px, env(safe-area-inset-left)))",
        marginRight: "calc(-1 * max(12px, env(safe-area-inset-right)))",
      }}
    >
      <div className="glass-page-header sticky top-0 z-[95] flex h-[56px] shrink-0 items-center justify-between gap-3 px-4 md:px-5 lg:top-[48px]">
        <div className="inline-flex min-w-0 items-center gap-2">
          <Archive size={16} style={{ color: "var(--text-main)" }} strokeWidth={2.1} />
          <p className="truncate text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
            Archive
          </p>
          {companyName ? (
            <span className="hidden shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium normal-case tracking-normal sm:inline-flex" style={mutedPillStyle}>
              {companyName}
            </span>
          ) : null}
        </div>
        {/* The search bar: the Dashboard's (a plain rounded box, its icon inside on the left — cs-own-fill keeping its
            fill and border in dark mode too). */}
        <div className="relative min-w-0" style={{ width: "min(320px, 55vw)", minWidth: 90 }}>
          <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            aria-label="Search the archive"
            className={`cs-own-fill h-9 w-full rounded-full border border-[#D7DEE8] pl-9 text-[12px] font-semibold outline-none transition-colors focus:border-[var(--brand)] ${search ? "pr-8" : "pr-3.5"}`}
            style={{
              backgroundColor: "var(--panel-bg)",
              color: "var(--text-main)",
              ["--field-bg" as string]: "var(--panel-bg)",
              ["--field-border" as string]: "var(--panel-border)",
            }}
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Extra room at the bottom while the bulk bar is showing, so it never covers the last file. */}
      <div className="p-3 md:p-4 lg:p-5" style={selectedRows.length ? { paddingBottom: 112 } : undefined}>
        {/* Everything, or one kind, then Filters, the order and (phones) Select. */}
        <div className="flex flex-wrap items-center gap-2">
          {/* (A phone: a row of its own, scrolled sideways.) */}
          <div className="-mx-3 flex min-w-0 max-w-[calc(100%+24px)] flex-1 items-center gap-2 overflow-x-auto px-3 py-1 [scrollbar-width:none] max-md:basis-full md:mx-0 md:max-w-full md:flex-wrap md:overflow-visible md:px-0">
            {(() => {
              const everythingOn = pickedKinds.length === 0;
              return (
                <button
                  type="button"
                  aria-pressed={everythingOn}
                  onClick={() => setKinds([])}
                  className={`glass-shine ${everythingOn ? "" : "glass-shine-neutral"} inline-flex h-9 shrink-0 items-center gap-2 rounded-full pl-1.5 pr-3.5 text-[12.5px] font-medium transition hover:brightness-95`}
                  style={glassShineStyle("var(--brand)", { color: everythingOn ? "#FFFFFF" : "var(--text-main)" })}
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${everythingOn ? "" : "glass-shine text-white"}`}
                    style={everythingOn ? { backgroundColor: "rgba(255,255,255,0.22)" } : glassShineStyle("var(--brand)")}
                  >
                    <Archive size={12} strokeWidth={2.2} />
                  </span>
                  Everything
                  <span className="tabular-nums" style={everythingOn ? { opacity: 0.8 } : { color: "var(--text-muted)" }}>
                    {passingRows.length}
                  </span>
                </button>
              );
            })()}
            {allowedKinds.map((kind) => {
              const meta = KIND_META[kind];
              const Icon = meta.icon;
              const on = pickedKinds.includes(kind);
              const state = loadStateFor[kind].status;
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleKind(kind)}
                  className={`glass-shine ${on ? "" : "glass-shine-neutral"} inline-flex h-9 shrink-0 items-center gap-2 rounded-full pl-1.5 pr-3.5 text-[12.5px] font-medium transition hover:brightness-95`}
                  style={glassShineStyle(meta.color, { color: on ? "#FFFFFF" : "var(--text-main)" })}
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${on ? "" : "glass-shine text-white"}`}
                    style={on ? { backgroundColor: "rgba(255,255,255,0.22)" } : glassShineStyle(meta.color)}
                  >
                    <Icon size={12} strokeWidth={2.2} />
                  </span>
                  {meta.label}
                  <span className="tabular-nums" style={on ? { opacity: 0.8 } : { color: "var(--text-muted)" }}>
                    {state === "ready" ? passingRows.filter((row) => row.kind === kind).length : state === "error" ? "!" : "…"}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
              className={`glass-shine ${filtersOpen || activeFilterCount ? "" : "glass-shine-neutral"} inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition hover:brightness-95`}
              style={glassShineStyle("var(--brand)", { color: filtersOpen || activeFilterCount ? "#FFFFFF" : "var(--text-main)" })}
            >
              <SlidersHorizontal size={14} />
              Filters
              {activeFilterCount ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] tabular-nums" style={{ backgroundColor: "rgba(255,255,255,0.25)" }}>
                  {activeFilterCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setSort((prev) => (prev === "newest" ? "oldest" : "newest"))}
              title={sort === "newest" ? "Newest first — show oldest first" : "Oldest first — show newest first"}
              className="glass-shine glass-shine-neutral inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition hover:brightness-95"
              style={{ color: "var(--text-main)" }}
            >
              {sort === "newest" ? <ArrowDownWideNarrow size={14} /> : <ArrowUpNarrowWide size={14} />}
              <span className="max-sm:hidden">{sort === "newest" ? "Newest first" : "Oldest first"}</span>
            </button>
            {allSelectable.length ? (
              <button
                type="button"
                onClick={() => (isSelecting ? clearSelection() : setSelectMode(true))}
                className={`glass-shine ${isSelecting ? "" : "glass-shine-neutral"} inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition hover:brightness-95 sm:hidden`}
                style={glassShineStyle("var(--brand)", { color: isSelecting ? "#FFFFFF" : "var(--text-main)" })}
              >
                {isSelecting ? <X size={14} /> : <ListChecks size={14} />}
                {isSelecting ? "Done" : "Select"}
              </button>
            ) : null}
          </div>
        </div>

        {/* The filters: a range of months, statuses / categories, people — opening down out of the bar. */}
        <div
          className={`grid ${canAnimate ? "transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none" : ""}`}
          style={{ gridTemplateRows: filtersOpen ? "1fr" : "0fr", opacity: filtersOpen ? 1 : 0 }}
          inert={!filtersOpen}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="glass-shine glass-shine-neutral mx-px mb-1 mt-3 space-y-4 rounded-[22px] p-4">
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-muted)" }}>
                  Filed
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {rangePresets.map((preset) => (
                    <FilterChip
                      key={preset.label}
                      label={preset.label}
                      color="var(--brand)"
                      on={fromMonth === preset.from && toMonth === preset.to}
                      onClick={() => {
                        const on = fromMonth === preset.from && toMonth === preset.to;
                        setFromMonth(on ? "" : preset.from);
                        setToMonth(on ? "" : preset.to);
                      }}
                    />
                  ))}
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {(
                      [
                        { label: "From", value: fromMonth, set: setFromMonth },
                        { label: "To", value: toMonth, set: setToMonth },
                      ] as const
                    ).map((field) => (
                      <label
                        key={field.label}
                        className="glass-shine glass-shine-neutral inline-flex h-8 items-center gap-1.5 rounded-full pl-3 pr-1.5 text-[12px] font-medium"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {field.label}
                        <select
                          value={field.value}
                          onChange={(e) => field.set(e.target.value)}
                          className="h-7 cursor-pointer rounded-full bg-transparent pr-1 text-[12px] font-medium outline-none"
                          style={{ color: "var(--text-main)" }}
                        >
                          <option value="">Any</option>
                          {monthOptions.map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </span>
                </div>
              </div>
              {statusOptions.length ? (
                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-muted)" }}>
                    Status &amp; category
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {statusOptions.map((option) => (
                      <FilterChip
                        key={option.key}
                        label={shownKinds.length > 1 ? `${option.label} · ${KIND_META[option.kind].one}` : option.label}
                        color={option.color}
                        count={option.count}
                        on={activeStatusFilter.includes(option.key)}
                        onClick={() => setStatusFilter((prev) => toggleIn(prev, option.key))}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {peopleOptions.length ? (
                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-muted)" }}>
                    People
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {peopleOptions.map((option) => (
                      <FilterChip
                        key={option.name}
                        label={option.name}
                        color="#64748B"
                        count={option.count}
                        on={activePeopleFilter.includes(option.name)}
                        onClick={() => setPeopleFilter((prev) => toggleIn(prev, option.name))}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={!activeFilterCount}
                  onClick={clearFilters}
                  className="glass-shine glass-shine-neutral inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-medium transition hover:brightness-95 disabled:opacity-55"
                  style={{ color: "var(--text-main)" }}
                >
                  <RotateCcw size={13} />
                  Clear filters
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* What's narrowing it down, each one taken off with its X. */}
        {hasRange || activeStatusFilter.length || activePeopleFilter.length || query ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {(
              [
                query ? { key: "search", label: `“${search.trim()}”`, clear: () => setSearch("") } : null,
                hasRange
                  ? {
                      key: "range",
                      label: fromMonth && toMonth ? (fromMonth === toMonth ? monthLabelOf(fromMonth) : `${monthLabelOf(fromMonth)} – ${monthLabelOf(toMonth)}`) : fromMonth ? `From ${monthLabelOf(fromMonth)}` : `To ${monthLabelOf(toMonth)}`,
                      clear: () => {
                        setFromMonth("");
                        setToMonth("");
                      },
                    }
                  : null,
                ...activeStatusFilter.map((key) => ({
                  key,
                  label: statusOptions.find((option) => option.key === key)?.label ?? key,
                  clear: () => setStatusFilter((prev) => prev.filter((k) => k !== key)),
                })),
                ...activePeopleFilter.map((name) => ({ key: `person:${name}`, label: name, clear: () => setPeopleFilter((prev) => prev.filter((n) => n !== name)) })),
              ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>
            ).map((chip) => (
              <span
                key={chip.key}
                className="glass-shine glass-shine-neutral inline-flex h-7 max-w-full items-center gap-1 rounded-full pl-3 pr-1 text-[11.5px] font-medium"
                style={{ color: "var(--text-main)" }}
              >
                <span className="truncate">{chip.label}</span>
                <button
                  type="button"
                  onClick={chip.clear}
                  aria-label={`Remove ${chip.label}`}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)]"
                  style={{ color: "var(--text-muted)" }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <span className="ml-1 text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
              {countOf(filtered.length, "file", "files")}
            </span>
          </div>
        ) : null}

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
        {errorKinds.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {errorKinds.map((kind) => (
              <span
                key={kind}
                className="inline-flex h-8 items-center gap-2 rounded-full border pl-3.5 pr-1 text-[12px] font-medium"
                style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
              >
                {`Couldn't load archived ${KIND_META[kind].many}.`}
                <button
                  type="button"
                  onClick={() => retryKind(kind)}
                  className="glass-shine glass-shine-neutral inline-flex h-6 items-center rounded-full px-2.5 text-[11.5px] font-medium transition hover:brightness-95"
                  style={{ color: "var(--text-main)" }}
                >
                  Try again
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-4 lg:grid lg:grid-cols-[252px_minmax(0,1fr)] lg:items-start lg:gap-5">
          {/* The cabinet: a drawer for each year — pulled open, its months (each one's files, by kind); the one at the
              top of the screen lit. A press goes to that month. */}
          <aside className="hidden lg:sticky lg:top-[120px] lg:block" aria-label="Filing cabinet">
            <div className="glass-shine glass-shine-neutral max-h-[calc(100vh-136px)] overflow-y-auto rounded-[26px] p-2.5 [scrollbar-width:thin]">
              <div className="flex items-center justify-between gap-2 py-1 pl-2.5 pr-0.5">
                <p className="text-[11px] font-medium uppercase tracking-[1.2px]" style={{ color: "var(--text-muted)" }}>
                  Filing cabinet
                </p>
                {folders.length ? (
                  <RoundButton title={anyFolderOpen ? "Close every folder" : "Open every folder"} size={28} onClick={() => setAllFolders(!anyFolderOpen)}>
                    {anyFolderOpen ? <Folder size={13} /> : <FolderOpen size={13} />}
                  </RoundButton>
                ) : null}
              </div>
              {drawers.length ? (
                <div className="mt-1.5 space-y-2">
                  {drawers.map((drawer, index) => {
                    const open = isDrawerOpen(drawer.key, index);
                    const drawerRows = drawer.months.flatMap((month) => month.rows);
                    return (
                      <div key={drawer.key}>
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => toggleDrawer(drawer.key, open)}
                          className="glass-shine glass-shine-neutral flex w-full flex-col items-stretch rounded-[18px] px-3 pb-2 pt-2.5 text-left transition hover:brightness-[0.98]"
                        >
                          <span className="flex items-center gap-2">
                            <span className="pl-0.5 text-[15px] font-medium tabular-nums" style={{ color: "var(--text-main)" }}>
                              {drawer.label}
                            </span>
                            {/* (A flex row of its own, so its dots and counts centre on the year, not sit on a text line.) */}
                            <span className="flex min-w-0 flex-1 items-center">{renderKindDots(drawerRows, false)}</span>
                            <ChevronDown
                              size={15}
                              className="shrink-0"
                              style={{ color: "var(--text-muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform 240ms ease" }}
                            />
                          </span>
                          {/* Its files by kind, as a bar across it (its months' bars, for the whole year) — on Everything
                              only (one kind shown, it'd just be that kind's colour). */}
                          {pickedKinds.length === 0 ? (
                            <span
                              aria-hidden="true"
                              className="mt-2 flex h-[6px] w-full overflow-hidden rounded-full"
                              style={{ backgroundColor: "var(--panel-muted)", boxShadow: "inset 0 1px 1px rgba(0,0,0,0.08)" }}
                            >
                              {kindCounts(drawerRows).map(({ kind, count }) => (
                                <span key={kind} style={{ width: `${(count / Math.max(1, drawerRows.length)) * 100}%`, backgroundColor: KIND_META[kind].color }} />
                              ))}
                            </span>
                          ) : null}
                        </button>
                        {/* Pulled open: its months. */}
                        <div
                          className={`grid ${canAnimate ? "transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none" : ""}`}
                          style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
                          inert={!open}
                        >
                          <div className="min-h-0 overflow-hidden">
                            <div className="space-y-0.5 px-1 pb-1 pt-1.5">
                              {drawer.months.map((month) => {
                                const lit = month.key === activeKey;
                                const counts = kindCounts(month.rows);
                                return (
                                  <button
                                    key={month.key}
                                    type="button"
                                    onClick={() => jumpToFolder(month.key)}
                                    className={`flex w-full items-center gap-2 rounded-full px-3 py-[7px] text-left transition ${lit ? "glass-shine" : "hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)]"}`}
                                    style={lit ? glassShineStyle("var(--brand)", { color: "#FFFFFF" }) : { color: "var(--text-main)" }}
                                  >
                                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{month.name}</span>
                                    {/* Its files by kind, as a little bar — in their kinds' colours, lit or not (lit: ringed in
                                        white, so they read on the lit month's blue). On Everything only, as the year's. */}
                                    {pickedKinds.length === 0 ? (
                                      <span
                                        aria-hidden="true"
                                        className="flex h-[5px] w-12 shrink-0 overflow-hidden rounded-full"
                                        style={{ backgroundColor: "var(--panel-muted)", boxShadow: lit ? "0 0 0 1.5px #FFFFFF" : undefined }}
                                      >
                                        {counts.map(({ kind, count }) => (
                                          <span key={kind} style={{ width: `${(count / month.rows.length) * 100}%`, backgroundColor: KIND_META[kind].color }} />
                                        ))}
                                      </span>
                                    ) : null}
                                    <span className="w-6 shrink-0 text-right text-[11.5px] font-medium tabular-nums" style={lit ? { opacity: 0.85 } : { color: "var(--text-muted)" }}>
                                      {month.rows.length}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : isLoadingAny ? (
                // Opening the cabinet: a drawer or two, waiting.
                <SkeletonGroup label="Opening the cabinet" className="mt-1.5 space-y-2">
                  {[0, 1].map((i) => (
                    <Skeleton key={i} className="h-[46px] w-full rounded-[18px]" />
                  ))}
                </SkeletonGroup>
              ) : (
                <p className="px-2.5 pb-2 pt-1 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                  Nothing filed.
                </p>
              )}
            </div>
          </aside>

          <div className="min-w-0">
            {/* A phone's (and a tablet's) cabinet: its months in a strip, held under the header. */}
            {folders.length > 1 ? (
              <div
                className="sticky top-[56px] z-[40] -mx-3 mb-1 px-3 py-2 md:-mx-4 md:px-4 lg:hidden"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--glass-bg-strong) 72%, transparent)",
                  backdropFilter: "blur(16px) saturate(180%)",
                  WebkitBackdropFilter: "blur(16px) saturate(180%)",
                }}
              >
                <div ref={monthStripRef} className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                  {folders.map((month) => {
                    const lit = month.key === activeKey;
                    return (
                      <button
                        key={month.key}
                        type="button"
                        data-month-chip={month.key}
                        onClick={() => jumpToFolder(month.key)}
                        className={`glass-shine ${lit ? "" : "glass-shine-neutral"} inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium`}
                        style={glassShineStyle("var(--brand)", { color: lit ? "#FFFFFF" : "var(--text-main)" })}
                      >
                        {month.year ? `${month.name.slice(0, 3)} ${month.year.slice(2)}` : month.name}
                        <span className="tabular-nums" style={lit ? { opacity: 0.8 } : { color: "var(--text-muted)" }}>
                          {month.rows.length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Select everything listed (wider screens always; phones in select mode). */}
            {allSelectable.length && folders.length ? (
              <div className={`mb-2 flex min-h-8 items-center gap-2 px-1.5 ${dotVisibility}`}>
                <SelectDot
                  state={selectStateOf(allSelectable, selected)}
                  onToggle={() => toggleKeys(allSelectable)}
                  label={anyFilterOrSearch ? "Select everything listed" : "Select everything in the archive"}
                />
                <span className="text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                  {`${anyFilterOrSearch ? "Select everything listed" : "Select everything"} (${allSelectable.length})`}
                </span>
              </div>
            ) : null}

            {folders.length === 0 ? (
              isLoadingAny ? (
                // Opening the cabinet: a folder or two, waiting.
                <SkeletonGroup label="Opening the cabinet" className="space-y-6 pt-4">
                  {[0, 1].map((i) => (
                    <div key={i} className="glass-shine glass-shine-neutral relative rounded-[24px] px-3 pb-3 pt-8">
                      <Skeleton className="absolute -top-4 left-4 h-8 w-36 rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--brand) 25%, var(--panel-bg))" }} />
                      {[0, 1, 2].map((j) => (
                        <Skeleton key={j} className="mb-1.5 h-[54px] w-full rounded-[18px]" />
                      ))}
                    </div>
                  ))}
                </SkeletonGroup>
              ) : (
                <div className="glass-shine glass-shine-neutral flex flex-col items-center rounded-[26px] px-6 py-12 text-center">
                  <span className="glass-shine inline-flex h-14 w-14 items-center justify-center rounded-full text-white" style={glassShineStyle("var(--brand)")}>
                    <Archive size={24} />
                  </span>
                  <p className="mt-4 text-[15px] font-medium" style={{ color: "var(--text-main)" }}>
                    {anyFilterOrSearch && allRows.length ? "Nothing filed matches" : "The filing cabinet is empty"}
                  </p>
                  <p className="mt-1 max-w-[420px] text-[12.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                    {anyFilterOrSearch && allRows.length
                      ? "Try another search, more kinds or a wider range of months."
                      : "Projects, leads and contacts you archive — and calendar events once they're archived — are filed here, month by month."}
                  </p>
                  {anyFilterOrSearch && allRows.length ? (
                    <button
                      type="button"
                      onClick={clearEverything}
                      className="glass-shine mt-4 inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-medium text-white transition hover:brightness-95"
                      style={glassShineStyle("var(--brand)")}
                    >
                      <RotateCcw size={13} />
                      Show everything
                    </button>
                  ) : null}
                </div>
              )
            ) : (
              <div className="space-y-5">
                {folders.map((month) => {
                  const open = isFolderOpen(month.key);
                  const monthKeys = selectableKeysOf(month.rows);
                  return (
                    <section
                      key={month.key}
                      data-archive-folder={month.key}
                      aria-label={month.year ? `${month.name} ${month.year}` : month.name}
                      className="scroll-mt-[112px] pt-4 lg:scroll-mt-[116px]"
                    >
                      <div className="glass-shine glass-shine-neutral relative rounded-[24px] px-2 pb-2 pt-6 sm:px-3 sm:pb-3">
                        {/* Its index tab, standing up out of the folder — opens and closes it. In the colour of the kind
                            shown (Leads: orange…); Everything: the brand blue. */}
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => toggleFolder(month.key)}
                          className="glass-shine absolute -top-4 left-4 inline-flex h-8 items-center gap-2 rounded-full pl-1.5 pr-3.5 text-white transition hover:brightness-95"
                          style={glassShineStyle(pickedKinds.length === 1 ? KIND_META[pickedKinds[0]].color : "var(--brand)")}
                        >
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.22)" }}>
                            {open ? <FolderOpen size={12} /> : <Folder size={12} />}
                          </span>
                          <span className="text-[13px] font-medium">{month.name}</span>
                          {month.year ? <span className="text-[13px] font-medium opacity-75">{month.year}</span> : null}
                        </button>
                        <div className="flex min-h-8 items-center gap-2 px-1">
                          {monthKeys.length ? (
                            <SelectDot
                              state={selectStateOf(monthKeys, selected)}
                              onToggle={() => toggleKeys(monthKeys)}
                              label={`Select everything in ${month.name} ${month.year}`.trim()}
                              className={dotVisibility}
                            />
                          ) : null}
                          <span className="min-w-0 flex-1">{renderKindDots(month.rows, true)}</span>
                          <span className="shrink-0 text-[11.5px] font-medium tabular-nums max-sm:hidden" style={{ color: "var(--text-muted)" }}>
                            {countOf(month.rows.length, "file", "files")}
                          </span>
                          <RoundButton title={open ? "Close the folder" : "Open the folder"} size={28} onClick={() => toggleFolder(month.key)}>
                            <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 240ms ease" }} />
                          </RoundButton>
                        </div>
                        {/* Its files, day by day down a time line. */}
                        <div
                          className={`grid ${canAnimate ? "transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none" : ""}`}
                          style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
                          inert={!open}
                        >
                          <div className="min-h-0 overflow-hidden">
                            <div className="pt-2">
                              {month.days.map((day, dayIndex) => (
                                <div key={day.key} className="flex gap-1.5 sm:gap-2.5">
                                  <div className="flex w-10 shrink-0 flex-col items-center pt-2 sm:w-12">
                                    <span className="text-[17px] font-medium leading-none tabular-nums" style={{ color: "var(--text-main)" }}>
                                      {day.day}
                                    </span>
                                    {day.weekday ? (
                                      <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.8px]" style={{ color: "var(--text-muted)" }}>
                                        {day.weekday}
                                      </span>
                                    ) : null}
                                    {dayIndex < month.days.length - 1 ? (
                                      <span aria-hidden="true" className="mt-2 w-px flex-1" style={{ backgroundColor: "var(--glass-border)" }} />
                                    ) : null}
                                  </div>
                                  <div className="min-w-0 flex-1 space-y-1.5 pb-2">{day.rows.map(renderFile)}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bulk actions for what's ticked. */}
      {selectedRows.length > 0 ? (
        <div data-bottom-bar="" className="pointer-events-none fixed inset-x-0 bottom-0 z-[96] flex justify-center px-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <div
            className="glass-bubble-pop pointer-events-auto flex w-full max-w-[640px] flex-wrap items-center gap-2 rounded-[28px] border py-2 pl-4 pr-2"
            style={{
              borderColor: "var(--glass-border)",
              backgroundColor: "var(--glass-bg-strong)",
              backdropFilter: "blur(20px) saturate(180%)",
              WebkitBackdropFilter: "blur(20px) saturate(180%)",
              boxShadow: "var(--shadow-glass)",
            }}
            role="region"
            aria-label="Selected files"
          >
            <span className="mr-auto min-w-0">
              <span className="block text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                {`${selectedRows.length} selected`}
              </span>
              <span className="block truncate text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                {breakdownText(selectedRows)}
              </span>
            </span>
            <button
              type="button"
              disabled={Boolean(busy) || !restorableSelected.length}
              onClick={() => void actOnRows("restore", restorableSelected)}
              className="glass-shine inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-medium text-white transition hover:brightness-95 disabled:opacity-55"
              style={glassShineStyle("var(--brand)")}
            >
              <ArchiveRestore size={14} />
              {busy?.action === "restore"
                ? "Restoring..."
                : restorableSelected.length < selectedRows.length
                  ? `Restore (${restorableSelected.length})`
                  : "Restore"}
            </button>
            <button
              type="button"
              disabled={Boolean(busy) || !deletableSelected.length}
              onClick={(e) => askDelete(e, selectedRows)}
              className="glass-shine inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-medium text-white transition hover:brightness-95 disabled:opacity-55"
              style={glassShineStyle("var(--danger)")}
            >
              <Trash2 size={14} />
              {busy?.action === "delete"
                ? "Deleting..."
                : deletableSelected.length < selectedRows.length
                  ? `Delete (${deletableSelected.length})`
                  : "Delete"}
            </button>
            <RoundButton title="Clear the selection" size={36} disabled={Boolean(busy)} onClick={clearSelection}>
              <X size={15} />
            </RoundButton>
          </div>
        </div>
      ) : null}

      {shouldRenderDeleteModal && pendingDelete ? createPortal(
        <div className="fixed inset-0 z-[2000] flex items-center justify-center px-4 py-4">
          <button type="button" aria-label="Cancel" onClick={() => !copySending && setPendingDelete(null)} className="glass-modal-backdrop absolute inset-0" />
          <div
            ref={deletePanelRef}
            role="alertdialog"
            aria-modal="true"
            className={`glass-modal-panel relative flex max-h-[calc(100svh-32px)] w-full flex-col overflow-hidden ${pendingProjects.length ? "max-w-[560px]" : "max-w-[440px]"}`}
          >
            <GlassModalHeader
              title={
                pendingDelete.rows.length === 1
                  ? `Delete “${pendingDelete.rows[0].title}” permanently?`
                  : `Delete ${itemCount(pendingDelete.rows.length)} permanently?`
              }
              onClose={() => setPendingDelete(null)}
              closeDisabled={copySending}
            />
            <div className="min-h-0 space-y-2 overflow-y-auto px-5 py-4">
              {pendingDelete.rows.length > 1 ? (
                <p className="text-[12.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                  {breakdownText(pendingDelete.rows)}
                </p>
              ) : null}
              <p className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                {pendingDelete.rows.some((row) => row.kind === "contacts")
                  ? "This can't be undone. A contact's projects aren't affected — a new project for the same person starts a fresh contact."
                  : pendingProjects.length
                    ? "Its images and attached files are deleted for good — email a copy first to keep them. Everything else is kept as a hidden, text-only record (for Reports and its contact's history), and it leaves the Archive."
                    : "This can't be undone."}
              </p>
              {pendingDelete.skipped > 0 ? (
                <p className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                  {`${itemCount(pendingDelete.skipped)} you can't delete ${pendingDelete.skipped === 1 ? "stays" : "stay"} archived.`}
                </p>
              ) : null}
              {pendingProjects.length ? (
                // Its copy, emailed first: what's in it, and who to.
                <div className="mt-3 space-y-3 rounded-[18px] border px-3.5 py-3" style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 60%, transparent)" }}>
                  <div className="flex items-center gap-2.5">
                    <span className="glass-shine inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white" style={glassShineStyle("var(--brand)")}>
                      <Mail size={13} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                        {pendingProjects.length === 1 ? "Email a copy first" : "Email each project a copy first"}
                      </p>
                      <p className="text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                        {pendingProjects.length === 1 ? `Subject: “Deleted: ${pendingProjects[0].name || "Untitled"}”` : "One email per project — “Deleted: <project name>”."}
                      </p>
                    </div>
                    <GlassSwitch checked={copyEmail} onChange={setCopyEmail} disabled={copySending} ariaLabel="Email a copy before deleting" />
                  </div>
                  {copyEmail ? (
                    <>
                      <div>
                        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.8px]" style={{ color: "var(--text-muted)" }}>
                          Include
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {PROJECT_COPY_SECTIONS.map((section) => {
                            const on = copySections[section.key];
                            return (
                              <button
                                key={section.key}
                                type="button"
                                aria-pressed={on}
                                disabled={copySending}
                                onClick={() => setCopySections((prev) => ({ ...prev, [section.key]: !prev[section.key] }))}
                                className={`glass-shine ${on ? "" : "glass-shine-neutral"} inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition hover:brightness-95 disabled:opacity-60`}
                                style={on ? glassShineStyle("var(--brand)", { color: "#FFFFFF" }) : { color: "var(--text-main)" }}
                                title={on ? `${section.label} — ${section.detail.toLowerCase()}. Click to leave it out.` : `Leave out — click to include ${section.label.toLowerCase()}`}
                              >
                                {on ? <Check size={12} className="shrink-0" /> : <Minus size={12} className="shrink-0 opacity-60" />}
                                {section.label}
                                <span className="text-[10.5px] opacity-75">{section.detail}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.8px]" style={{ color: "var(--text-muted)" }}>
                          Send to
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(() => {
                            // Who it goes to, as chips (each with their badge, and an × to take them off); everyone else
                            // in the Add staff dropdown. Its assigned person (each project's own, when there are several)
                            // is on to begin with.
                            const single = pendingProjects.length === 1;
                            const assigned = single ? emailableMembers.find((member) => member.uid === assignedUidOf(pendingProjects[0])) ?? null : null;
                            const hasAssigned = single ? Boolean(assigned) : pendingProjects.some((project) => emailableUids.has(assignedUidOf(project)));
                            const colourOf = (member: CompanyMemberOption) => String(member.badgeColor || member.userColor || "").trim() || "var(--brand)";
                            const badge = (member: CompanyMemberOption | null, size: number) => (
                              <span
                                className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
                                style={{ width: size, height: size, fontSize: size * 0.4, backgroundColor: member ? colourOf(member) : "var(--brand)" }}
                              >
                                {member ? staffInitials(member.displayName || member.email || "") : <Users size={size * 0.5} />}
                              </span>
                            );
                            const tagOf = (member: CompanyMemberOption) => {
                              if (single && member.uid === assigned?.uid) return "Assigned";
                              if (member.uid === uid) return "You";
                              const role = String(member.role || "").trim();
                              return role ? role.charAt(0).toUpperCase() + role.slice(1) : "";
                            };
                            const chip = (key: string, member: CompanyMemberOption | null, label: string, tag: string, onRemove: () => void) => (
                              <span
                                key={key}
                                className="glass-shine glass-shine-neutral inline-flex h-8 max-w-full items-center gap-1.5 rounded-full pl-1 pr-1 text-[12px] font-medium"
                                style={{ color: "var(--text-main)" }}
                              >
                                {badge(member, 24)}
                                <span className="truncate">{label}</span>
                                {tag ? <span className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>{tag}</span> : null}
                                <button
                                  type="button"
                                  onClick={onRemove}
                                  disabled={copySending}
                                  aria-label={`Don't send to ${label}`}
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition hover:bg-[var(--panel-muted)] disabled:opacity-50"
                                  style={{ color: "var(--text-muted)" }}
                                >
                                  <X size={12} />
                                </button>
                              </span>
                            );
                            const picked = copyRecipients
                              .map((id) => emailableMembers.find((member) => member.uid === id))
                              .filter((member): member is CompanyMemberOption => Boolean(member));
                            const addable = [
                              ...(hasAssigned && !copyToAssigned
                                ? [
                                    {
                                      key: "assigned",
                                      label: single ? String(assigned?.displayName || "Assigned") : "Each project's assigned person",
                                      detail: single ? "Assigned" : "",
                                      icon: badge(assigned, 22),
                                      onSelect: () => setCopyToAssigned(true),
                                    },
                                  ]
                                : []),
                              ...emailableMembers
                                .filter((member) => member.uid !== assigned?.uid && !copyRecipients.includes(member.uid))
                                .map((member) => ({
                                  key: member.uid,
                                  label: String(member.displayName || member.email || "Staff"),
                                  detail: tagOf(member),
                                  icon: badge(member, 22),
                                  onSelect: () => setCopyRecipients((prev) => (prev.includes(member.uid) ? prev : [...prev, member.uid])),
                                })),
                            ];
                            return (
                              <>
                                {hasAssigned && copyToAssigned
                                  ? chip(
                                      "assigned",
                                      single ? assigned : null,
                                      single ? String(assigned?.displayName || "Assigned") : "Each project's assigned person",
                                      single ? "Assigned" : "",
                                      () => setCopyToAssigned(false),
                                    )
                                  : null}
                                {picked.map((member) =>
                                  chip(member.uid, member, String(member.displayName || member.email || "Staff"), tagOf(member), () =>
                                    setCopyRecipients((prev) => prev.filter((id) => id !== member.uid)),
                                  ),
                                )}
                                <GlassActionMenu
                                  items={copySending ? [] : addable}
                                  ariaLabel="Add staff"
                                  openWithOneItem
                                  menuMinWidth={250}
                                  triggerClassName="glass-shine glass-shine-neutral inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition hover:brightness-95"
                                  triggerStyle={{ color: "var(--text-main)" }}
                                >
                                  <Plus size={13} className="shrink-0" />
                                  Add staff
                                </GlassActionMenu>
                              </>
                            );
                          })()}
                        </div>
                        {!copyHasContent ? (
                          <p className="mt-2 text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                            {"Nothing's included, so no email will be sent."}
                          </p>
                        ) : !copyWillSend ? (
                          <p className="mt-2 text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                            Pick who to send it to — or no email will be sent.
                          </p>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                  {copyError ? (
                    <p className="rounded-[12px] border px-3 py-2 text-[12px] font-medium" style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}>
                      {copyError}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingDelete(null)}
                  className="glass-shine glass-shine-neutral inline-flex h-9 items-center rounded-full px-4 text-[12px] font-medium transition hover:brightness-95"
                  style={{ color: "var(--text-main)" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmDelete()}
                  disabled={copySending}
                  className="glass-shine inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[12px] font-medium text-white transition hover:brightness-95 disabled:opacity-70"
                  style={glassShineStyle("var(--danger)")}
                >
                  {copyWillSend ? <Mail size={13} /> : <Trash2 size={13} />}
                  {copySending ? "Emailing…" : copyWillSend ? "Email & delete" : "Delete permanently"}
                </button>
              </div>
            </div>
          </div>
        </div>
      , document.body) : null}
      {restoreTarget
        ? (() => {
            const project = restoreTarget.kind === "projects" ? projects.rows.find((row) => row.id === restoreTarget.id) : undefined;
            return (
              <RestoreDialog
                title={`Restore this ${KIND_META[restoreTarget.kind].one}?`}
                statusOptions={project ? restoreStatusOptionsFrom(projectStatusesRaw, [String(project.statusLabel || "")]) : undefined}
                initialStatus={String(project?.statusLabel || "").trim()}
                initialSubStage={String(project?.dashboardSubStageId || "").trim()}
                busy={Boolean(busy)}
                onCancel={() => setRestoreTarget(null)}
                onConfirm={(status, subStage) => void confirmRestore(status, subStage)}
              />
            );
          })()
        : null}
    </div>
  );
}
