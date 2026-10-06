"use client";

import { activeDate, useCompanyFormats } from "@/lib/company-formats";
import { Suspense, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, Check, ChevronDown, ChevronRight, Contact, FolderKanban, Inbox, ListChecks, Minus, Search, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAppTabs } from "@/lib/app-tabs-context";
import { authorizedFetch } from "@/lib/api-fetch";
import { hasPermissionKey, isOwnerOrAdmin, useCompanyAccess } from "@/lib/use-company-access";
import {
  fetchCompanyDoc,
  fetchDeletedProjects,
  fetchProjects,
  permanentlyDeleteCompanyClients,
  permanentlyDeleteProject,
  restoreArchivedCompanyClients,
  restoreArchivedProject,
  updateProjectStatus,
  type CompanyClientRow,
  type CompanyLeadRow,
} from "@/lib/firestore-data";
import { projectTabAccess } from "@/lib/permissions";
import { retryAsync } from "@/lib/load-retry";
import { leadClientDisplayName } from "@/lib/lead-name";
import { projectArchivedAtIso } from "@/lib/project-archive";
import { RestoreDialog, restoreStatusOptionsFrom } from "@/components/restore-dialog";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import type { Project } from "@/lib/types";

// The Archived page — what used to be Recently Deleted as well. Every Delete/Archive button in the app
// (projects, leads, contacts) files things here, and finished projects arrive on their own (Company
// Settings → Dashboard → Finished projects). Nothing here is ever deleted automatically: each tab files
// its items by the date they were archived (year → month), and someone with the right access can
// restore them or delete them permanently, one at a time or many at once.
//
// Where each kind's "archived" lives:
// - Projects: isArchived / archivedAtIso on the job doc. Projects soft-deleted the old way (isDeleted)
//   are listed too, filed under their deletion date (fetchDeletedProjects, lib/project-archive.ts).
// - Leads: isDeleted / deletedAtIso — a lead's archive flag (the Leads page's Archive button), read
//   through /api/leads?archived=only.
// - Contacts: archived / archivedAtIso on the contact doc, read through /api/clients?archived=only.

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
// The last tab opened here, so coming back lands on it (the ?tab= in the URL wins when there is one).
const ARCHIVED_TAB_STORAGE_KEY = "cutsmart_archived_tab";
// Which years/months each person has opened or closed (per tab), kept on this device so a reload
// leaves them as they were. Keyed by user, so someone else signing in here starts fresh.
const ARCHIVED_GROUPS_STORAGE_KEY_PREFIX = "cutsmart_archived_groups:";

function readArchivedGroupToggles(uid: string): Record<string, boolean> {
  if (!uid || typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ARCHIVED_GROUPS_STORAGE_KEY_PREFIX + uid) || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
    );
  } catch {
    return {};
  }
}

type ArchivedTab = "leads" | "projects" | "contacts";
const ARCHIVED_TABS: Array<{ key: ArchivedTab; label: string; icon: typeof Inbox }> = [
  { key: "leads", label: "Leads", icon: Inbox },
  { key: "projects", label: "Projects", icon: FolderKanban },
  { key: "contacts", label: "Contacts", icon: Contact },
];
const TAB_NOUNS: Record<ArchivedTab, { one: string; many: string }> = {
  leads: { one: "lead", many: "leads" },
  projects: { one: "project", many: "projects" },
  contacts: { one: "contact", many: "contacts" },
};

function parseArchivedTab(value: unknown): ArchivedTab | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "leads" || raw === "projects" || raw === "contacts" ? raw : null;
}

function countLabel(count: number, tab: ArchivedTab): string {
  return `${count} ${count === 1 ? TAB_NOUNS[tab].one : TAB_NOUNS[tab].many}`;
}

// One row on any tab, whatever it is underneath — the filing, search, selection and bulk bar all work
// on these.
type ArchiveRow = {
  id: string;
  archivedIso: string;
  // The archived date as shown on the row (first on its second line, so it's never cut off).
  archivedLabel: string;
  title: string;
  details: string[];
  pill: { label: string; color: string } | null;
  searchText: string;
  canRestore: boolean;
  canDelete: boolean;
};

// The archive as a filing system: year → month it was archived, newest first, and within a month the
// newest-archived first (each row shows its own archived date).
type MonthGroup = { key: string; label: string; rows: ArchiveRow[] };
type YearGroup = { key: string; label: string; rows: ArchiveRow[]; months: MonthGroup[] };

function groupByArchivedDate(rows: ArchiveRow[]): YearGroup[] {
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long" });
  const sorted = [...rows].sort((a, b) => b.archivedIso.localeCompare(a.archivedIso));
  const years: YearGroup[] = [];
  for (const row of sorted) {
    const d = new Date(row.archivedIso);
    const valid = Boolean(row.archivedIso) && !Number.isNaN(d.getTime());
    const yearKey = valid ? String(d.getFullYear()) : "undated";
    const monthKey = valid ? `${yearKey}-${String(d.getMonth() + 1).padStart(2, "0")}` : "undated-month";
    let year = years.find((y) => y.key === yearKey);
    if (!year) {
      year = { key: yearKey, label: valid ? yearKey : "No date", rows: [], months: [] };
      years.push(year);
    }
    let month = year.months.find((m) => m.key === monthKey);
    if (!month) {
      month = { key: monthKey, label: valid ? monthLabel.format(d) : "No date", rows: [] };
      year.months.push(month);
    }
    month.rows.push(row);
    year.rows.push(row);
  }
  return years;
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

type LoadState<T> = { status: "loading" | "ready" | "error"; rows: T[] };

type SelectState = "all" | "some" | "none";
function selectStateOf(ids: string[], selected: Set<string>): SelectState {
  if (!ids.length) return "none";
  const count = ids.filter((id) => selected.has(id)).length;
  return count === 0 ? "none" : count === ids.length ? "all" : "some";
}

// A tick box for one row, a month or the whole list ("some" shows a dash).
function SelectBox({
  state,
  onToggle,
  label,
  className = "",
}: {
  state: SelectState;
  onToggle: () => void;
  label: string;
  className?: string;
}) {
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
      className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border transition hover:brightness-95 ${className}`}
      style={
        on
          ? { borderColor: "var(--brand)", backgroundImage: "var(--brand-gradient)", color: "#FFFFFF" }
          : { borderColor: "color-mix(in srgb, var(--text-main) 28%, transparent)", backgroundColor: "var(--panel-bg)", color: "transparent" }
      }
    >
      {state === "some" ? <Minus size={13} strokeWidth={3} /> : <Check size={13} strokeWidth={3} />}
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
  // This page's sticky header sits flush under the top bar instead of <main>'s usual top padding.
  useEffect(() => {
    setReduceMainTopPadding(true);
    return () => setReduceMainTopPadding(false);
  }, [setReduceMainTopPadding]);

  const uid = String(user?.uid || "").trim();
  const accessReady = access.status === "ready";
  const role = String(access.role || user?.role || "").trim().toLowerCase() || "staff";
  const isVerified = Boolean(user?.verified);
  // Same checks as the Leads and Contacts pages (and Recently Deleted's leads tab before this).
  const isAdmin = isOwnerOrAdmin(access.role);
  const canSeeLeads =
    accessReady &&
    (isAdmin || hasPermissionKey(access.permissionKeys, "leads.view") || hasPermissionKey(access.permissionKeys, "leads.view.others"));
  const canViewOtherLeads = accessReady && (isAdmin || hasPermissionKey(access.permissionKeys, "leads.view.others"));
  const canViewAllContacts = accessReady && (isAdmin || hasPermissionKey(access.permissionKeys, "clients.view.all"));
  const canSeeContacts = accessReady && (isAdmin || hasPermissionKey(access.permissionKeys, "clients.view") || canViewAllContacts);

  // --- Which tab ---------------------------------------------------------------------------------
  // The tab is the URL's ?tab= (so a link can open a given tab); with none, the one used last.
  const urlTab = parseArchivedTab(searchParams.get("tab"));
  useEffect(() => {
    try {
      if (urlTab) {
        window.localStorage.setItem(ARCHIVED_TAB_STORAGE_KEY, urlTab);
        return;
      }
      const stored = parseArchivedTab(window.localStorage.getItem(ARCHIVED_TAB_STORAGE_KEY));
      if (stored && stored !== "projects") window.history.replaceState(null, "", `?tab=${stored}`);
    } catch {
      // storage unavailable — stay on Projects
    }
  }, [urlTab]);
  // While access is still loading every tab shows (Leads/Contacts say they're loading); once it's
  // known, a tab this person can't use is hidden.
  const visibleTabs = ARCHIVED_TABS.filter(
    (t) => !accessReady || t.key === "projects" || (t.key === "leads" ? canSeeLeads : canSeeContacts),
  );
  const tab: ArchivedTab = urlTab && visibleTabs.some((t) => t.key === urlTab) ? urlTab : "projects";

  // --- Data --------------------------------------------------------------------------------------
  const [projects, setProjects] = useState<LoadState<Project>>({ status: "loading", rows: [] });
  const [leads, setLeads] = useState<LoadState<CompanyLeadRow>>({ status: "loading", rows: [] });
  const [contacts, setContacts] = useState<LoadState<CompanyClientRow>>({ status: "loading", rows: [] });
  const [companyName, setCompanyName] = useState("");
  const [projectStatusColors, setProjectStatusColors] = useState<Record<string, string>>({});
  const [projectStatusesRaw, setProjectStatusesRaw] = useState<unknown>(null);
  const [leadStatusColors, setLeadStatusColors] = useState<Record<string, string>>(DEFAULT_LEAD_STATUS_COLORS);
  // Which lead fields are the client's name ("Use for" in Company Settings → Integrations), so each
  // lead is titled by its client, like on the Leads page.
  const [leadFieldLayout, setLeadFieldLayout] = useState<unknown>(null);
  const [contactCategoryColors, setContactCategoryColors] = useState<Record<string, string>>({});

  const companyId = String(access.companyId || "").trim();
  // Bumped by Try again to load a tab's list again.
  const [reloadTicks, setReloadTicks] = useState<Record<ArchivedTab, number>>({ leads: 0, projects: 0, contacts: 0 });

  // Projects, plus the company doc (status/category colours, the archive setting, the company name).
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    const load = async () => {
      try {
        const stored = String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim();
        const preferred = Array.from(new Set([stored, String(user?.companyId || "").trim()].filter(Boolean)));
        // Only projects this person can view come back (each list checks every project), same as the
        // dashboard. Archived ones, plus any soft-deleted the old way (they count as archived).
        const [archivedRows, deletedRows, companyDoc] = await Promise.all([
          retryAsync(() => fetchProjects(uid, preferred, { lightweight: true, archived: "only" }), { attempts: 2, delayMs: 350 }),
          retryAsync(() => fetchDeletedProjects(uid, preferred), { attempts: 2, delayMs: 350 }).catch(() => [] as Project[]),
          preferred[0] ? fetchCompanyDoc(preferred[0]).catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const byId = new Map<string, Project>();
        for (const row of [...deletedRows, ...archivedRows]) byId.set(row.id, row);
        setProjects({ status: "ready", rows: Array.from(byId.values()) });
        const doc = (companyDoc ?? {}) as Record<string, unknown>;
        const prefs = (doc.applicationPreferences ?? {}) as Record<string, unknown>;
        setCompanyName(String(doc.name ?? doc.companyName ?? prefs.companyName ?? "").trim());
        setProjectStatusColors(colorMapFrom(doc.projectStatuses));
        setProjectStatusesRaw(doc.projectStatuses ?? null);
        setLeadStatusColors(colorMapFrom(doc.leadStatuses, DEFAULT_LEAD_STATUS_COLORS));
        setLeadFieldLayout(((doc.integrations as Record<string, unknown> | undefined)?.zapierLeads as Record<string, unknown> | undefined)?.fieldLayout ?? null);
        setContactCategoryColors(colorMapFrom(doc.contactCategories));
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
        const rows = await retryAsync(
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
    const load = async () => {
      try {
        const rows = await retryAsync(
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
        );
        if (!cancelled) setContacts({ status: "ready", rows });
      } catch {
        if (!cancelled) setContacts((prev) => ({ ...prev, status: "error" }));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [canSeeContacts, canViewAllContacts, companyId, reloadTicks.contacts]);

  const retryTab = (kind: ArchivedTab) => {
    if (kind === "projects") setProjects((prev) => ({ ...prev, status: "loading" }));
    else if (kind === "leads") setLeads((prev) => ({ ...prev, status: "loading" }));
    else setContacts((prev) => ({ ...prev, status: "loading" }));
    setReloadTicks((prev) => ({ ...prev, [kind]: prev[kind] + 1 }));
  };

  // --- Rows per tab --------------------------------------------------------------------------------
  // Worked out on each render (a few hundred rows at most) rather than memoised.
  const permissionKeysForProjects = access.permissionKeys.length ? access.permissionKeys : user?.permissions ?? [];
  const projectRows: ArchiveRow[] = projects.rows.map((project) => {
    const statusLabel = String(project.statusLabel || "").trim();
    const completedDate = activeDate(project.completedAtIso || "");
    // A project archived some other way without a date is filed under its last update instead of disappearing.
    const archivedIso = projectArchivedAtIso(project) || String(project.deletedAt || project.updatedAt || "").trim();
    const archivedDate = activeDate(archivedIso);
    // Restoring and deleting both change the project, so they need the same access as editing it
    // (which is also what archiving it from its page needs).
    const canEdit = isVerified && accessReady && projectTabAccess(project, role, "general", uid, permissionKeysForProjects).edit;
    const customer = project.customer && project.customer !== "Unknown Customer" ? project.customer : "";
    return {
      id: project.id,
      archivedIso,
      archivedLabel: archivedDate,
      title: project.name || "Untitled",
      details: [customer, completedDate ? `Completed ${completedDate}` : ""].filter(Boolean),
      pill: statusLabel ? { label: statusLabel, color: projectStatusColors[statusLabel.toLowerCase()] || "#64748B" } : null,
      searchText: [project.name, project.customer, statusLabel, project.clientAddress, project.createdByName].join(" ").toLowerCase(),
      canRestore: canEdit,
      canDelete: canEdit,
    };
  });

  // Archiving a lead needs the Leads page (leads.view); restoring or deleting one needs the same.
  const canActOnLeads = isVerified && canSeeLeads;
  const leadRows: ArchiveRow[] = leads.rows.map((lead) => {
    const archivedIso = String(lead.deletedAtIso || lead.updatedAtIso || lead.createdAtIso || "").trim();
    const archivedDate = activeDate(archivedIso);
    const status = String(lead.status || "").trim();
    const assigned = String(lead.assignedToName || lead.assignedTo || "").trim();
    const clientName = leadClientDisplayName(lead.rawFields, leadFieldLayout) || String(lead.name || "").trim();
    return {
      id: lead.id,
      archivedIso,
      archivedLabel: archivedDate,
      title: clientName || lead.email || lead.phone || "Lead",
      details: [
        clientName ? lead.email : "",
        clientName || lead.email ? lead.phone : "",
        lead.formName,
        assigned ? `Assigned to ${assigned}` : "",
      ].filter(Boolean),
      pill: status ? { label: status, color: leadStatusColors[status.toLowerCase()] || "#64748B" } : null,
      searchText: [clientName, lead.name, lead.email, lead.phone, lead.formName, lead.message, status, assigned].join(" ").toLowerCase(),
      canRestore: canActOnLeads,
      canDelete: canActOnLeads,
    };
  });

  // Restoring a contact is the reverse of archiving it (anyone who can use Contacts); deleting one for
  // good is new, so it's kept to owners and admins.
  const canRestoreContacts = isVerified && canSeeContacts;
  const canDeleteContacts = isVerified && accessReady && isAdmin;
  const contactRows: ArchiveRow[] = contacts.rows.map((contact) => {
    const archivedIso = String(contact.archivedAtIso || contact.updatedAtIso || "").trim();
    const archivedDate = activeDate(archivedIso);
    const category = String(contact.category || "").trim();
    return {
      id: contact.id,
      archivedIso,
      archivedLabel: archivedDate,
      title: contact.name || contact.email || contact.phone || "Contact",
      details: [contact.name ? contact.email : "", contact.name || contact.email ? contact.phone : ""].filter(Boolean),
      pill: category ? { label: category, color: contactCategoryColors[category.toLowerCase()] || "#7D99B3" } : null,
      searchText: [contact.name, contact.email, contact.phone, contact.address, category, contact.notes].join(" ").toLowerCase(),
      canRestore: canRestoreContacts,
      canDelete: canDeleteContacts,
    };
  });

  // No active company (nothing to read leads/contacts from) reads as an empty list, not a spinner.
  const noCompany = accessReady && !companyId;
  const loadStateFor: Record<ArchivedTab, LoadState<unknown>> = {
    projects,
    leads: noCompany ? { status: "ready", rows: [] } : leads,
    contacts: noCompany ? { status: "ready", rows: [] } : contacts,
  };
  const rowsFor: Record<ArchivedTab, ArchiveRow[]> = { projects: projectRows, leads: leadRows, contacts: contactRows };
  const tabState = loadStateFor[tab];
  const rows = rowsFor[tab];

  // --- Search, filing, open/closed groups ----------------------------------------------------------
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const isSearching = query.length > 0;
  const filtered = query ? rows.filter((row) => row.searchText.includes(query)) : rows;
  const years = groupByArchivedDate(filtered);
  // Open/closed years and months the user has toggled — anything not in here uses its default (only
  // the newest year and its newest month start open).
  const [toggled, setToggled] = useState<Record<string, boolean>>(() => readArchivedGroupToggles(uid));
  useEffect(() => {
    if (!uid) return;
    try {
      window.localStorage.setItem(ARCHIVED_GROUPS_STORAGE_KEY_PREFIX + uid, JSON.stringify(toggled));
    } catch {
      // storage unavailable — they just won't be remembered after a reload
    }
  }, [toggled, uid]);
  // While searching every group with a match is open, so nothing found is hidden inside a closed one.
  const isOpen = (key: string, openByDefault: boolean) => isSearching || (toggled[`${tab}:${key}`] ?? openByDefault);
  const toggleGroup = (key: string, openNow: boolean) => setToggled((prev) => ({ ...prev, [`${tab}:${key}`]: !openNow }));

  // --- Selection -----------------------------------------------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Phones only show the tick boxes in select mode (the Select button), so rows aren't cramped; on
  // wider screens they're always there. Ticking anything also counts as selecting.
  const [selectMode, setSelectMode] = useState(false);
  const selectableIdsOf = (list: ArchiveRow[]) => list.filter((row) => row.canRestore || row.canDelete).map((row) => row.id);
  // Only what's in the current (searched) list counts — a selection hidden by the search is left out.
  const selectedRows = filtered.filter((row) => selected.has(row.id));
  const isSelecting = selectMode || selectedRows.length > 0;
  const anySelectable = filtered.some((row) => row.canRestore || row.canDelete);
  const toggleIds = (ids: string[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = ids.length > 0 && ids.every((id) => prev.has(id));
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  const clearSelection = () => {
    setSelected(new Set());
    setSelectMode(false);
  };

  // --- Restore / delete ----------------------------------------------------------------------------
  const [busy, setBusy] = useState<{ action: "restore" | "delete"; ids: string[] } | null>(null);
  // The row whose delete button the pointer is over — that row gets the red highlight, the same as the
  // Rooms list in a project's Design tab does on its X.
  const [hoveredDeleteRowId, setHoveredDeleteRowId] = useState("");
  const [notice, setNotice] = useState("");
  // A row's Restore asks first, in a pop-up (components/restore-dialog.tsx) — for a project, with the
  // status it comes back in.
  const [restoreTarget, setRestoreTarget] = useState<{ kind: ArchivedTab; id: string } | null>(null);

  const selectTab = (next: ArchivedTab) => {
    if (next === tab) return;
    clearSelection();
    setNotice("");
    try {
      window.localStorage.setItem(ARCHIVED_TAB_STORAGE_KEY, next);
    } catch {
      // storage unavailable — the URL still carries it
    }
    window.history.replaceState(null, "", `?tab=${next}`);
  };

  const dropRows = (kind: ArchivedTab, ids: string[]) => {
    if (!ids.length) return;
    const gone = new Set(ids);
    if (kind === "projects") setProjects((prev) => ({ ...prev, rows: prev.rows.filter((row) => !gone.has(row.id)) }));
    else if (kind === "leads") setLeads((prev) => ({ ...prev, rows: prev.rows.filter((row) => !gone.has(row.id)) }));
    else setContacts((prev) => ({ ...prev, rows: prev.rows.filter((row) => !gone.has(row.id)) }));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
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

  const restoreIds = async (kind: ArchivedTab, ids: string[]) => {
    if (!ids.length || busy) return;
    setBusy({ action: "restore", ids });
    setNotice("");
    let done: string[] = [];
    if (kind === "projects") {
      const byId = new Map(projects.rows.map((row) => [row.id, row]));
      done = await runEach(ids, async (id) => {
        const project = byId.get(id);
        if (!project) return false;
        const ok = await restoreArchivedProject(project);
        // Lets it register a tab in the top bar again if it was archived from its page this session.
        if (ok) restoreScope(`project:${id}`);
        return ok;
      });
    } else if (kind === "leads") {
      const byId = new Map(leads.rows.map((row) => [row.id, row]));
      done = await runEach(ids, async (id) => {
        const lead = byId.get(id);
        if (!lead) return false;
        const response = await authorizedFetch("/api/leads", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId: lead.companyId || companyId, leadId: id, isDeleted: false }),
        });
        return response.ok;
      });
    } else {
      const chosen = contacts.rows.filter((row) => ids.includes(row.id));
      done = await restoreArchivedCompanyClients(companyId, chosen, contactFilter);
    }
    dropRows(kind, done);
    if (done.length < ids.length) {
      setNotice(`Couldn't restore ${countLabel(ids.length - done.length, kind)} — please try again.`);
    }
    setBusy(null);
  };

  const deleteIds = async (kind: ArchivedTab, ids: string[]) => {
    if (!ids.length || busy) return;
    setBusy({ action: "delete", ids });
    setNotice("");
    let done: string[] = [];
    if (kind === "projects") {
      const byId = new Map(projects.rows.map((row) => [row.id, row]));
      done = await runEach(ids, async (id) => {
        const project = byId.get(id);
        return project ? permanentlyDeleteProject(project) : false;
      });
    } else if (kind === "leads") {
      try {
        const response = await authorizedFetch("/api/leads", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, leadIds: ids }),
        });
        const json = (await response.json().catch(() => null)) as { ok?: boolean; deleted?: string[] } | null;
        done = response.ok && json?.ok && Array.isArray(json.deleted) ? json.deleted : [];
      } catch {
        done = [];
      }
    } else {
      const chosen = contacts.rows.filter((row) => ids.includes(row.id));
      done = await permanentlyDeleteCompanyClients(companyId, chosen, contactFilter);
    }
    dropRows(kind, done);
    if (done.length < ids.length) {
      setNotice(`Couldn't delete ${countLabel(ids.length - done.length, kind)} — please try again.`);
    }
    setBusy(null);
  };

  const onRestoreClick = (row: ArchiveRow) => {
    if (busy) return;
    setRestoreTarget({ kind: tab, id: row.id });
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
        setBusy({ action: "restore", ids: [target.id] });
        const ok = await updateProjectStatus(project, status, subStage);
        setBusy(null);
        if (!ok) {
          setNotice("Couldn't restore this project — please try again.");
          setRestoreTarget(null);
          return;
        }
      }
    }
    setRestoreTarget(null);
    await restoreIds(target.kind, [target.id]);
  };

  // "Delete permanently" always asks first, in a pop-up.
  const [pendingDelete, setPendingDelete] = useState<{ kind: ArchivedTab; ids: string[]; title: string; skipped: number } | null>(null);
  const [deleteOrigin, setDeleteOrigin] = useState<GlassModalOrigin>(null);
  const deletePanelRef = useRef<HTMLDivElement | null>(null);
  const deleteOriginElRef = useRef<HTMLElement | null>(null);
  const shouldRenderDeleteModal = useGlassModalPopOrigin(Boolean(pendingDelete), deleteOrigin, deletePanelRef, undefined, deleteOriginElRef);
  const askDelete = (e: ReactMouseEvent<HTMLElement>, chosen: ArchiveRow[]) => {
    const deletable = chosen.filter((row) => row.canDelete);
    if (!deletable.length || busy) return;
    deleteOriginElRef.current = e.currentTarget;
    setDeleteOrigin(captureGlassModalOrigin(e));
    setPendingDelete({
      kind: tab,
      ids: deletable.map((row) => row.id),
      title: deletable.length === 1 ? deletable[0].title : "",
      skipped: chosen.length - deletable.length,
    });
  };
  const confirmDelete = () => {
    if (!pendingDelete) return;
    const { kind, ids } = pendingDelete;
    setPendingDelete(null);
    void deleteIds(kind, ids);
  };

  const openProject = (id: string) => {
    const project = projects.rows.find((row) => row.id === id);
    if (!project) return;
    // An archived project opens normally, with a note saying it's archived — but no tab in the top bar.
    const name = String(project.name || "").trim();
    // fromArchive: the project page then skips its loading tab in the top bar (archived projects don't get one).
    router.push(name ? `/projects/${id}?openName=${encodeURIComponent(name)}&fromArchive=1` : `/projects/${id}?fromArchive=1`);
  };

  const onRowClick = (row: ArchiveRow) => {
    if (!isSelecting && tab === "projects") {
      openProject(row.id);
      return;
    }
    if (row.canRestore || row.canDelete) toggleIds([row.id]);
  };

  const glassCardStyle: CSSProperties = {
    borderColor: "var(--glass-border)",
    backgroundColor: "var(--glass-bg-strong)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    boxShadow: "var(--shadow-glass)",
  };
  const countPillStyle: CSSProperties = {
    borderColor: "var(--glass-border)",
    backgroundColor: "var(--panel-muted)",
    color: "var(--text-muted)",
  };
  const nouns = TAB_NOUNS[tab];
  // On phones the tick boxes only show while selecting (see selectMode).
  const boxVisibility = isSelecting ? "" : "max-sm:hidden";
  const restorableSelected = selectedRows.filter((row) => row.canRestore);
  const deletableSelected = selectedRows.filter((row) => row.canDelete);
  const allState = selectStateOf(selectableIdsOf(filtered), selected);

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
            <span
              className="hidden shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium normal-case tracking-normal sm:inline-flex"
              style={countPillStyle}
            >
              {companyName}
            </span>
          ) : null}
        </div>
        <div
          className="inline-flex h-9 min-w-0 items-center gap-2 rounded-[10px] border px-3"
          style={{ width: "min(300px, 55vw)", minWidth: 90, borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
        >
          <Search size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search archived ${nouns.many}...`}
            aria-label={`Search archived ${nouns.many}`}
            className="h-8 w-full min-w-0 bg-transparent text-[12px] font-medium outline-none"
            style={{ color: "var(--text-main)" }}
          />
          {search ? (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="shrink-0" style={{ color: "var(--text-muted)" }}>
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Extra room at the bottom while the bulk bar is showing, so it never covers the last row. */}
      <div className="space-y-3 p-3 md:p-4 lg:p-5" style={selectedRows.length ? { paddingBottom: 112 } : undefined}>
        {/* Leads / Projects / Contacts */}
        <div
          role="tablist"
          aria-label="Archive"
          className="flex w-full gap-1 rounded-[14px] border p-1 sm:w-fit"
          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
        >
          {visibleTabs.map((t) => {
            const active = t.key === tab;
            const state = loadStateFor[t.key];
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(t.key)}
                className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 text-[12.5px] font-medium transition sm:flex-none sm:px-4"
                style={
                  active
                    ? { backgroundImage: "var(--brand-gradient)", color: "#FFFFFF", boxShadow: "var(--shadow-sm)" }
                    : { color: "var(--text-main)" }
                }
              >
                <Icon size={14} className="shrink-0" />
                <span className="truncate">{t.label}</span>
                {state.status === "ready" ? (
                  <span
                    className="rounded-full px-1.5 text-[10.5px] font-medium"
                    style={active ? { backgroundColor: "rgba(255,255,255,0.22)", color: "#FFFFFF" } : { backgroundColor: "var(--panel-bg)", color: "var(--text-muted)" }}
                  >
                    {rowsFor[t.key].length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {notice ? (
          <div
            className="flex items-center justify-between gap-3 rounded-[12px] border px-3 py-2 text-[12px] font-medium"
            style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
          >
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")} aria-label="Dismiss" className="shrink-0">
              <X size={14} />
            </button>
          </div>
        ) : null}

        {/* Select all (what's listed) + the phones' Select mode switch. */}
        {anySelectable && years.length > 0 ? (
          <div className="flex min-h-9 items-center justify-between gap-2 px-1">
            <label className={`inline-flex items-center gap-2 ${boxVisibility}`}>
              <SelectBox
                state={allState}
                onToggle={() => toggleIds(selectableIdsOf(filtered))}
                label={isSearching ? `Select all matching ${nouns.many}` : `Select all archived ${nouns.many}`}
              />
              <span className="text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                {isSearching ? `Select all matching (${selectableIdsOf(filtered).length})` : `Select all (${selectableIdsOf(filtered).length})`}
              </span>
            </label>
            <button
              type="button"
              onClick={() => (isSelecting ? clearSelection() : setSelectMode(true))}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-medium transition hover:brightness-95 sm:hidden"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
            >
              {isSelecting ? <X size={13} /> : <ListChecks size={13} />}
              {isSelecting ? "Done" : "Select"}
            </button>
          </div>
        ) : null}

        {tab !== "projects" && !accessReady ? (
          <div className="rounded-[16px] border p-4 text-[13px] font-medium" style={{ ...glassCardStyle, color: "var(--text-muted)" }}>
            {`Loading archived ${nouns.many}...`}
          </div>
        ) : tabState.status === "loading" && !rows.length ? (
          <div className="rounded-[16px] border p-4 text-[13px] font-medium" style={{ ...glassCardStyle, color: "var(--text-muted)" }}>
            {`Loading archived ${nouns.many}...`}
          </div>
        ) : tabState.status === "error" && !rows.length ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border p-4 text-[13px] font-medium" style={{ ...glassCardStyle, color: "var(--text-muted)" }}>
            {`Couldn't load archived ${nouns.many}.`}
            <button
              type="button"
              onClick={() => retryTab(tab)}
              className="h-8 rounded-[10px] border px-3 text-[12px] font-medium transition hover:brightness-95"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
            >
              Try again
            </button>
          </div>
        ) : years.length === 0 ? (
          <div className="rounded-[16px] border p-6 text-center text-[13px] font-medium" style={{ ...glassCardStyle, color: "var(--text-muted)" }}>
            {isSearching ? `No archived ${nouns.many} match your search.` : `No archived ${nouns.many}.`}
          </div>
        ) : (
          years.map((year, yearIndex) => {
            const yearOpen = isOpen(`y:${year.key}`, yearIndex === 0);
            return (
              <section key={year.key} className="overflow-hidden rounded-[18px] border" style={glassCardStyle}>
                <button
                  type="button"
                  aria-expanded={yearOpen}
                  onClick={() => toggleGroup(`y:${year.key}`, yearOpen)}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:brightness-[0.98]"
                >
                  <ChevronDown
                    size={16}
                    className="shrink-0"
                    style={{ color: "var(--text-muted)", transform: yearOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 200ms ease" }}
                  />
                  <span className="text-[15px] font-medium" style={{ color: "var(--text-main)" }}>
                    {year.label}
                  </span>
                  <span className="rounded-full border px-2 py-[1px] text-[11px] font-medium" style={countPillStyle}>
                    {year.rows.length}
                  </span>
                </button>
                {yearOpen ? (
                  <div className="space-y-1 border-t px-2 pb-2.5 pt-1.5 sm:px-3" style={{ borderColor: "var(--glass-border)" }}>
                    {year.months.map((month, monthIndex) => {
                      const monthOpen = isOpen(`m:${month.key}`, yearIndex === 0 && monthIndex === 0);
                      const monthIds = selectableIdsOf(month.rows);
                      return (
                        <div key={month.key}>
                          <div className="flex items-center gap-1.5">
                            {monthIds.length ? (
                              <SelectBox
                                state={selectStateOf(monthIds, selected)}
                                onToggle={() => toggleIds(monthIds)}
                                label={`Select all in ${month.label} ${year.label}`}
                                className={`ml-1.5 ${boxVisibility}`}
                              />
                            ) : null}
                            <button
                              type="button"
                              aria-expanded={monthOpen}
                              onClick={() => toggleGroup(`m:${month.key}`, monthOpen)}
                              className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2 py-2 text-left transition hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)]"
                            >
                              <ChevronDown
                                size={14}
                                className="shrink-0"
                                style={{ color: "var(--text-muted)", transform: monthOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 200ms ease" }}
                              />
                              <span className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                                {month.label}
                              </span>
                              <span className="rounded-full border px-2 py-[1px] text-[11px] font-medium" style={countPillStyle}>
                                {month.rows.length}
                              </span>
                            </button>
                          </div>
                          {monthOpen ? (
                            <div className="space-y-1.5 pb-2 pl-1 pt-1 sm:pl-7">
                              {month.rows.map((row) => {
                                const isChecked = selected.has(row.id);
                                const selectable = row.canRestore || row.canDelete;
                                const isBusy = Boolean(busy?.ids.includes(row.id));
                                return (
                                  <div
                                    key={row.id}
                                    className="row-glow-anchor flex items-center gap-2 rounded-[12px] border px-2.5 py-2 transition"
                                    style={{
                                      borderColor: isChecked ? "var(--brand)" : "var(--glass-border)",
                                      backgroundColor: isChecked
                                        ? "color-mix(in srgb, var(--brand) 9%, var(--panel-bg))"
                                        : "color-mix(in srgb, var(--panel-bg) 55%, transparent)",
                                      opacity: isBusy ? 0.6 : 1,
                                    }}
                                  >
                                    {/* Sits exactly over the row's own rounded border (the shared class bleeds past
                                        the row, which suits the borderless Rooms rows but not these cards). */}
                                    <div
                                      className="row-glow"
                                      data-active={hoveredDeleteRowId === row.id}
                                      style={{ top: -1, bottom: -1, left: -1, right: -1, borderRadius: 12 }}
                                    />
                                    {selectable ? (
                                      <SelectBox
                                        state={isChecked ? "all" : "none"}
                                        onToggle={() => toggleIds([row.id])}
                                        label={`Select ${row.title}`}
                                        className={boxVisibility}
                                      />
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() => onRowClick(row)}
                                      title={!isSelecting && tab === "projects" ? "Open project" : undefined}
                                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition hover:opacity-80"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                                          {row.title}
                                        </p>
                                        <p className="truncate text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                                          {[row.archivedLabel ? `Archived ${row.archivedLabel}` : "", ...row.details].filter(Boolean).join(" · ")}
                                        </p>
                                      </div>
                                      {row.pill ? (
                                        <span
                                          className="inline-flex h-6 max-w-[96px] shrink-0 items-center truncate rounded-[8px] px-2 text-[11px] font-medium sm:max-w-[160px]"
                                          style={{ backgroundColor: row.pill.color, color: pillTextColor(row.pill.color) }}
                                        >
                                          <span className="truncate">{row.pill.label}</span>
                                        </span>
                                      ) : null}
                                      {tab === "projects" && !isSelecting ? (
                                        <ChevronRight size={15} className="shrink-0 max-sm:hidden" style={{ color: "var(--text-muted)" }} />
                                      ) : null}
                                    </button>
                                    {/* Per-row actions; on phones they step aside while selecting. */}
                                    <div className={`flex shrink-0 items-center gap-1.5 ${isSelecting ? "max-sm:hidden" : ""}`}>
                                      {row.canRestore ? (
                                        <button
                                          type="button"
                                          disabled={Boolean(busy)}
                                          onClick={() => onRestoreClick(row)}
                                          aria-label="Restore"
                                          title={
                                            tab === "projects"
                                              ? "Put it back on the Dashboard. If it's still in a Completed status, it's archived again after the archive delay (under Instantly, only once it's completed again)."
                                              : tab === "leads"
                                                ? "Put it back on the Leads page"
                                                : "Put it back in Contacts"
                                          }
                                          className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[9px] border px-2.5 text-[11.5px] font-medium text-white transition hover:brightness-95 disabled:opacity-55 ${
                                            isBusy && busy?.action === "restore" ? "" : "max-sm:w-8 max-sm:px-0"
                                          }`}
                                          style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)", color: "#FFFFFF" }}
                                        >
                                          <ArchiveRestore size={13} />
                                          <span className={isBusy && busy?.action === "restore" ? "" : "max-sm:hidden"}>
                                            {isBusy && busy?.action === "restore" ? "Restoring..." : "Restore"}
                                          </span>
                                        </button>
                                      ) : null}
                                      {row.canDelete ? (
                                        <button
                                          type="button"
                                          disabled={Boolean(busy)}
                                          onClick={(e) => askDelete(e, [row])}
                                          onMouseEnter={() => setHoveredDeleteRowId(row.id)}
                                          onMouseLeave={() => setHoveredDeleteRowId((prev) => (prev === row.id ? "" : prev))}
                                          aria-label="Delete permanently"
                                          title="Delete permanently"
                                          // The full red delete style — same as the Rooms list's X in a project's Design tab.
                                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border text-white transition hover:brightness-95 disabled:opacity-55"
                                          style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                                        >
                                          <Trash2 size={17} strokeWidth={2.25} />
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })
        )}
      </div>

      {/* Bulk actions for what's ticked. */}
      {selectedRows.length > 0 ? (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[96] flex justify-center px-3"
          style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
        >
          <div
            className="glass-bubble-pop pointer-events-auto flex w-full max-w-[600px] flex-wrap items-center gap-2 rounded-[16px] border px-3 py-2.5"
            style={glassCardStyle}
            role="region"
            aria-label="Selected items"
          >
            <span className="mr-auto text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
              {`${selectedRows.length} selected`}
            </span>
            <button
              type="button"
              disabled={Boolean(busy) || !restorableSelected.length}
              onClick={() => void restoreIds(tab, restorableSelected.map((row) => row.id))}
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-medium transition hover:brightness-95 disabled:opacity-55"
              style={{ color: "var(--brand-strong)", borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}
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
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-medium text-white transition hover:brightness-95 disabled:opacity-55"
              style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
            >
              <Trash2 size={14} />
              {busy?.action === "delete"
                ? "Deleting..."
                : deletableSelected.length < selectedRows.length
                  ? `Delete permanently (${deletableSelected.length})`
                  : "Delete permanently"}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={clearSelection}
              className="inline-flex h-9 items-center rounded-[10px] border px-3 text-[12px] font-medium transition hover:brightness-95 disabled:opacity-55"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {shouldRenderDeleteModal && pendingDelete ? (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center px-4 py-4">
          <button type="button" aria-label="Cancel" onClick={() => setPendingDelete(null)} className="glass-modal-backdrop absolute inset-0" />
          <div ref={deletePanelRef} role="alertdialog" aria-modal="true" className="glass-modal-panel relative w-full max-w-[440px] overflow-hidden">
            <div className="glass-modal-header px-5 py-4">
              <p className="text-[15px] font-medium" style={{ color: "var(--text-main)" }}>
                {pendingDelete.title
                  ? `Delete “${pendingDelete.title}” permanently?`
                  : `Delete ${countLabel(pendingDelete.ids.length, pendingDelete.kind)} permanently?`}
              </p>
            </div>
            <div className="space-y-2 px-5 py-4">
              <p className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                {pendingDelete.kind === "contacts"
                  ? "This can't be undone. Their projects aren't affected — a new project for the same person starts a fresh contact."
                  : "This can't be undone."}
              </p>
              {pendingDelete.skipped > 0 ? (
                <p className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                  {`${countLabel(pendingDelete.skipped, pendingDelete.kind)} you can't delete ${pendingDelete.skipped === 1 ? "stays" : "stay"} archived.`}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingDelete(null)}
                  className="inline-flex h-9 items-center rounded-[10px] border px-4 text-[12px] font-medium transition hover:brightness-95"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-4 text-[12px] font-medium text-white transition hover:brightness-95"
                  style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                >
                  <Trash2 size={13} />
                  Delete permanently
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {restoreTarget
        ? (() => {
            const project = restoreTarget.kind === "projects" ? projects.rows.find((row) => row.id === restoreTarget.id) : undefined;
            return (
              <RestoreDialog
                title={
                  restoreTarget.kind === "projects"
                    ? "Restore this project?"
                    : restoreTarget.kind === "leads"
                      ? "Restore this lead?"
                      : "Restore this contact?"
                }
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
