"use client";

// The app's global search (components/global-search.tsx): what it can find — projects, small jobs, leads, contacts,
// calendar events and pages — loaded for whoever's looking with exactly the access the pages themselves give them
// (the same checks as the Dashboard / Small Jobs, Leads, Contacts and Calendar pages, and the Archived page's for all
// of them together), then matched against what's typed.

import { authorizedFetch } from "@/lib/api-fetch";
import { calendarCategoryLevel, normalizeCalendarCategories } from "@/lib/calendar-categories";
import { subscribeCalendarEvents, type CalendarEvent } from "@/lib/calendar-data";
import { activeDate, activeDateTime } from "@/lib/company-formats";
import { normalizeRoleKey } from "@/lib/company-roles";
import {
  fetchCompanyClients,
  fetchCompanyDoc,
  fetchCompanyLeads,
  fetchCompanyMembers,
  fetchProjects,
  type CompanyClientRow,
  type CompanyLeadRow,
} from "@/lib/firestore-data";
import { leadClientDisplayName } from "@/lib/lead-name";
import { isPreviewMode } from "@/lib/preview-mode";
import { isProjectArchived } from "@/lib/project-archive";
import { withStaffContacts } from "@/lib/staff-contacts";
import { hasPermissionKey, isOwnerOrAdmin } from "@/lib/use-company-access";
import type { Project } from "@/lib/types";

// Opens the search from anywhere (the top bar's search button; Ctrl/⌘+K is the search's own).
export const GLOBAL_SEARCH_OPEN_EVENT = "cutsmart:open-global-search";
// A lead picked in the search with the Leads page already open: it opens it (the page's ?lead= covers arriving).
export const OPEN_LEAD_EVENT = "cutsmart:open-lead";

export type GlobalSearchKind = "project" | "smalljob" | "lead" | "contact" | "event" | "page";
// The order its groups show in.
export const GLOBAL_SEARCH_KINDS: GlobalSearchKind[] = ["project", "smalljob", "lead", "contact", "event", "page"];

export type GlobalSearchItem = {
  kind: GlobalSearchKind;
  id: string;
  title: string;
  subtitle: string;
  // A small label on the right (a project's status, "Archived", an event's category…).
  badge?: string;
  color?: string;
  href: string;
  // A page's icon key (components/global-search.tsx looks it up); the others use their kind's.
  icon?: string;
  // Its words, cleaned for matching (normalizeSearchText): its title, and everything else it can be found by.
  titleText: string;
  otherText: string;
  // Ties are broken by this, newest / soonest first (an event: how close to now it is).
  rank: number;
  // Below the rest of its group whatever it matches (an archived project, a past event).
  demoted?: boolean;
};

// Lower case, accents off, anything but letters / digits / @ . + a space — and a phone number's digits run together
// too, so "021 234 567" and "021234567" both find it.
export function normalizeSearchText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9@.+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function searchWords(...values: Array<string | undefined | null>): string {
  const text = values.map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");
  const digits = text.replace(/[^0-9]/g, "");
  return normalizeSearchText(digits.length >= 6 ? `${text} ${digits}` : text);
}

// How well it matches what's typed (0: not at all — every word typed has to be found in it somewhere). Its title
// counts most: the title starting with it, then a word in it starting with it, then anywhere in it; then the rest.
export function scoreSearchItem(item: GlobalSearchItem, query: string): number {
  const typed = normalizeSearchText(query);
  if (!typed) return 0;
  const tokens = typed.split(" ");
  let score = 0;
  for (const [i, token] of tokens.entries()) {
    const title = item.titleText;
    if (i === 0 && title.startsWith(token)) score += 40;
    else if (title.startsWith(token) || title.includes(` ${token}`)) score += 24;
    else if (title.includes(token)) score += 12;
    else if (item.otherText.startsWith(token) || item.otherText.includes(` ${token}`)) score += 8;
    else if (item.otherText.includes(token)) score += 4;
    else return 0;
  }
  if (item.titleText === typed) score += 60;
  return item.demoted ? score / 4 : score;
}

// What's typed, against everything: each kind's matches, best first.
export function searchGlobalItems(items: GlobalSearchItem[], query: string): Map<GlobalSearchKind, GlobalSearchItem[]> {
  const scored = items
    .map((item) => ({ item, score: scoreSearchItem(item, query) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.item.rank - a.item.rank);
  const groups = new Map<GlobalSearchKind, GlobalSearchItem[]>();
  for (const { item } of scored) {
    const list = groups.get(item.kind) ?? [];
    list.push(item);
    groups.set(item.kind, list);
  }
  return groups;
}

// ---- Recently opened (this device, per person) ----------------------------------------------------------------------

const RECENT_KEY_PREFIX = "cutsmart_global_search_recent:";
const RECENT_MAX = 8;
export type RecentSearchItem = Pick<GlobalSearchItem, "kind" | "id" | "title" | "subtitle" | "href" | "color" | "icon" | "badge">;
export function readRecentSearchItems(uid: string): RecentSearchItem[] {
  if (!uid) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY_PREFIX + uid) || "[]");
    return Array.isArray(parsed) ? (parsed as RecentSearchItem[]).filter((row) => row && row.kind && row.id && row.href) : [];
  } catch {
    return [];
  }
}
export function rememberRecentSearchItem(uid: string, item: GlobalSearchItem) {
  if (!uid) return;
  const row: RecentSearchItem = {
    kind: item.kind,
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    href: item.href,
    color: item.color,
    icon: item.icon,
    badge: item.badge,
  };
  const next = [row, ...readRecentSearchItems(uid).filter((r) => !(r.kind === row.kind && r.id === row.id))].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(RECENT_KEY_PREFIX + uid, JSON.stringify(next));
  } catch {
    // storage unavailable — just not remembered
  }
}

// ---- Loading what this person can see ------------------------------------------------------------------------------

export type GlobalSearchViewer = {
  uid: string;
  companyId: string;
  role: string;
  roleId?: string;
  permissionKeys: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
// Events from a year back to a year ahead.
const EVENT_WINDOW_MS = 365 * DAY_MS;

function projectItem(project: Project): GlobalSearchItem {
  const archived = isProjectArchived(project);
  const customer = project.customer && project.customer !== "Unknown Customer" ? project.customer : "";
  const client = [project.clientFirstName, project.clientLastName].filter(Boolean).join(" ");
  const address = String(project.clientAddress || "").trim();
  const title = String(project.name || customer || "Untitled project").trim();
  const small = Boolean(project.isSmallJob);
  return {
    kind: small ? "smalljob" : "project",
    id: project.id,
    title,
    subtitle: [customer && customer !== title ? customer : "", address].filter(Boolean).join(" · "),
    badge: archived ? "Archived" : String(project.statusLabel || "").trim() || undefined,
    href: `/projects/${project.id}`,
    titleText: searchWords(title),
    otherText: searchWords(customer, client, address, project.clientPhone, project.clientEmail, project.statusLabel, ...(project.tags ?? [])),
    rank: Date.parse(project.updatedAt || "") || 0,
    demoted: archived,
  };
}

function leadItem(lead: CompanyLeadRow, fieldLayout: unknown): GlobalSearchItem {
  const name = leadClientDisplayName(lead.rawFields, fieldLayout) || String(lead.name || "").trim();
  const title = name || String(lead.email || lead.phone || "").trim() || "Lead";
  const rawValues = Object.values(lead.rawFields ?? {})
    .filter((v) => typeof v === "string" || typeof v === "number")
    .map(String);
  return {
    kind: "lead",
    id: lead.id,
    title,
    subtitle: [lead.email, lead.phone].map((v) => String(v || "").trim()).filter(Boolean).join(" · "),
    badge: String(lead.status || "").trim() || undefined,
    href: `/leads?lead=${encodeURIComponent(lead.id)}`,
    titleText: searchWords(title),
    otherText: searchWords(lead.name, lead.email, lead.phone, lead.formName, lead.status, lead.message, ...rawValues),
    rank: Date.parse(lead.createdAtIso || lead.submittedAtIso || "") || 0,
  };
}

function contactItem(contact: CompanyClientRow, categoryColors: Record<string, string>): GlobalSearchItem {
  const title = String(contact.name || contact.email || contact.phone || "Contact").trim();
  const category = String(contact.category || "").trim();
  return {
    kind: "contact",
    id: contact.id,
    title,
    subtitle: [contact.phone, contact.email].map((v) => String(v || "").trim()).filter(Boolean).join(" · "),
    badge: category || undefined,
    color: categoryColors[category.toLowerCase()],
    href: `/contacts?contact=${encodeURIComponent(contact.id)}`,
    titleText: searchWords(title),
    otherText: searchWords(contact.email, contact.phone, contact.address, category),
    rank: Date.parse(contact.updatedAtIso || contact.createdAtIso || "") || 0,
  };
}

function eventItem(event: CalendarEvent, category: { name: string; color: string } | undefined, restricted: boolean, now: number): GlobalSearchItem {
  const title = String(event.title || "").trim() || "Untitled event";
  const when = event.allDay ? activeDate(new Date(event.startMs)) : activeDateTime(new Date(event.startMs), " · ");
  // An event linked to a project this person can't open: just its title, when and its category (as the Calendar shows
  // it) — nothing from the project.
  return {
    kind: "event",
    id: event.id,
    title,
    subtitle: [when, restricted ? "" : event.location].filter(Boolean).join(" · "),
    badge: category?.name,
    color: category?.color,
    href: `/calendar?event=${encodeURIComponent(event.id)}`,
    titleText: searchWords(title),
    otherText: searchWords(category?.name, ...(restricted ? [] : [event.location, event.projectName, event.notes])),
    // The nearest to now first, coming ones before past ones.
    rank: -(Math.abs(event.startMs - now) + (event.endMs < now ? EVENT_WINDOW_MS : 0)),
    demoted: event.endMs < now - 30 * DAY_MS,
  };
}

function colorMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(raw)) return out;
  for (const row of raw) {
    const r = (row ?? {}) as Record<string, unknown>;
    const name = String(r.name ?? r.label ?? "").trim().toLowerCase();
    const color = String(r.color ?? "").trim();
    if (name && color) out[name] = color;
  }
  return out;
}

// Everything this person can find, a kind at a time as each arrives (onKind) — so the quick ones show straight away.
// A kind they can't see isn't loaded at all; one that fails to load is just left out.
export async function loadGlobalSearchItems(
  viewer: GlobalSearchViewer,
  onKind: (kinds: GlobalSearchKind[], items: GlobalSearchItem[]) => void,
): Promise<void> {
  const { uid, companyId } = viewer;
  if (!uid || !companyId) return;
  const admin = isOwnerOrAdmin(viewer.role);
  const can = (key: string) => admin || hasPermissionKey(viewer.permissionKeys, key);
  // Same as the Leads, Contacts and Calendar pages.
  const canSeeLeads = can("leads.view");
  const canViewOtherLeads = can("leads.view.others");
  const canViewAllContacts = can("clients.view.all");
  const canSeeContacts = canViewAllContacts || can("clients.view");
  const canViewCalendar = can("calendar.view") || can("calendar.edit");
  const preview = isPreviewMode();

  const companyDocLoad = fetchCompanyDoc(companyId).catch(() => null);
  // Only the projects this person can view come back (fetchProjects checks each one), archived ones too.
  const projectsLoad = fetchProjects(uid, [companyId], { lightweight: true, archived: "include" }).catch(() => [] as Project[]);

  const jobs: Array<Promise<void>> = [];

  jobs.push(
    projectsLoad.then((projects) => {
      onKind(["project", "smalljob"], projects.map(projectItem));
    }),
  );

  if (canSeeLeads) {
    jobs.push(
      (async () => {
        let rows: CompanyLeadRow[] = [];
        try {
          if (preview) rows = await fetchCompanyLeads(companyId);
          else {
            const response = await authorizedFetch(`/api/leads?companyId=${encodeURIComponent(companyId)}&mode=summary`, { cache: "no-store" });
            const json = (await response.json().catch(() => null)) as { ok?: boolean; leads?: CompanyLeadRow[] } | null;
            rows = response.ok && json?.ok && Array.isArray(json.leads) ? json.leads : await fetchCompanyLeads(companyId);
          }
        } catch {
          rows = await fetchCompanyLeads(companyId).catch(() => []);
        }
        const companyDoc = (await companyDocLoad) ?? {};
        const fieldLayout = (((companyDoc as Record<string, unknown>).integrations as Record<string, unknown> | undefined)?.zapierLeads as
          | Record<string, unknown>
          | undefined)?.fieldLayout;
        // As the Leads page: live ones, and without "view others' leads" just the ones assigned to them.
        const visible = rows
          .filter((lead) => !lead.isDeleted)
          .filter((lead) => canViewOtherLeads || String(lead.assignedToUid || "").trim() === uid);
        onKind(["lead"], visible.map((lead) => leadItem(lead, fieldLayout)));
      })(),
    );
  }

  if (canSeeContacts) {
    jobs.push(
      (async () => {
        const direct = () => fetchCompanyClients(companyId, { viewerUid: uid, includeAll: canViewAllContacts });
        let rows: CompanyClientRow[] = [];
        try {
          if (preview) rows = await direct();
          else {
            const response = await authorizedFetch(
              `/api/clients?companyId=${encodeURIComponent(companyId)}&mode=summary&viewerUid=${encodeURIComponent(uid)}&scope=${canViewAllContacts ? "all" : "mine"}`,
              { cache: "no-store" },
            );
            const json = (await response.json().catch(() => null)) as { ok?: boolean; clients?: CompanyClientRow[] } | null;
            rows = response.ok && json?.ok && Array.isArray(json.clients) ? json.clients : await direct();
          }
        } catch {
          rows = await direct().catch(() => []);
        }
        // Everyone on the staff is in everyone's Contacts, under Staff (lib/staff-contacts.ts).
        const members = await fetchCompanyMembers(companyId).catch(() => []);
        const companyDoc = (await companyDocLoad) ?? {};
        const categoryColors = colorMap((companyDoc as Record<string, unknown>).contactCategories);
        const visible = withStaffContacts(rows, members, companyId).filter((row) => !row.archived && !row.deleted);
        onKind(["contact"], visible.map((row) => contactItem(row, categoryColors)));
      })(),
    );
  }

  if (canViewCalendar) {
    jobs.push(
      (async () => {
        const now = Date.now();
        const events = await new Promise<CalendarEvent[]>((resolve) => {
          let stop: (() => void) | null = null;
          let done = false;
          const finish = (rows: CalendarEvent[]) => {
            if (done) return;
            done = true;
            resolve(rows);
            // (After this call returns — it can answer before handing back its unsubscribe.)
            window.setTimeout(() => stop?.(), 0);
          };
          stop = subscribeCalendarEvents(companyId, now - EVENT_WINDOW_MS, now + EVENT_WINDOW_MS, finish, () => finish([]));
          if (done) window.setTimeout(() => stop?.(), 0);
        });
        const companyDoc = (await companyDocLoad) ?? {};
        const categories = normalizeCalendarCategories((companyDoc as Record<string, unknown>).calendarCategories);
        const categoryById = new Map(categories.map((c) => [c.id, c]));
        const viewer2 = { isAdmin: admin, roleKey: normalizeRoleKey(viewer.roleId || viewer.role), canViewCalendar };
        // A linked project they can't open makes the event "restricted" (as on the Calendar) — owners / admins see all.
        const openable = admin ? null : new Set((await projectsLoad).map((p) => p.id));
        const visible = events.filter((event) => calendarCategoryLevel(categoryById.get(event.categoryId), viewer2) !== "none");
        onKind(
          ["event"],
          visible.map((event) => {
            const restricted = Boolean(openable && event.projectId && !openable.has(event.projectId));
            return eventItem(event, categoryById.get(event.categoryId), restricted, now);
          }),
        );
      })(),
    );
  }

  await Promise.all(jobs.map((job) => job.catch(() => undefined)));
}
