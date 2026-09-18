"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronsLeftRight, ChevronsRightLeft, ChevronUp, ImagePlus, Inbox, Kanban, LayoutGrid, Plus, Rows3, Search, X } from "lucide-react";
import { FullscreenImageViewerShell } from "@/components/fullscreen-image-viewer-shell";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyAccess, fetchPrimaryMembership } from "@/lib/membership";
import { fetchCompanyDoc, fetchCompanyMembers, fetchUserColorMapByUids, type CompanyLeadRow, type CompanyMemberOption } from "@/lib/firestore-data";
import { storage } from "@/lib/firebase";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { getFirebaseStorageQuotaExceededMessage, isFirebaseStorageQuotaExceeded } from "@/lib/firebase-storage-errors";
import { readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";
import { USER_COLOR_UPDATED_EVENT, type UserColorUpdatedDetail } from "@/lib/user-color-sync";
import {
  LEAD_PROJECT_CREATED_EVENT,
  OPEN_NEW_PROJECT_EVENT,
  type NewProjectPrefillPayload,
} from "@/lib/new-project-bridge";
import { retryAsync } from "@/lib/load-retry";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { useDragGhost, DragGhostLayer } from "@/lib/use-drag-ghost";
import { clusterPins, computeSpreadPositions, findClusterContainingPin } from "@/lib/pin-clustering";

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const SAMPLE_LEADS_STORAGE_KEY_PREFIX = "cutsmart_sample_leads:";
const LEADS_BOARD_PREFS_STORAGE_PREFIX = "cutsmart_leads_board_prefs:";
const LEAD_ARCHIVE_UPDATED_EVENT = "cutsmart_lead_archive_updated";
const RESERVED_LEAD_FIELD_KEYS = new Set([
  "companyid",
  "source",
  "status",
]);

type LeadProjectFieldTarget =
  | ""
  | "clientName"
  | "clientFirstName"
  | "clientLastName"
  | "clientPhone"
  | "clientEmail"
  | "projectAddress"
  | "projectNotes";
type LeadFieldLayoutRow = {
  key: string;
  label: string;
  showInRow: boolean;
  showInDetail: boolean;
  order: number;
  projectFieldTarget: LeadProjectFieldTarget;
};

type LeadDynamicField = {
  key: string;
  label: string;
  value: string;
};

type StatusRow = { name: string; color: string };

function buildTemporarySampleLeads(_companyId: string): CompanyLeadRow[] {
  return [];
}

function statusPillColors(status: string) {
  const key = String(status || "").trim().toLowerCase();
  const defaults: Record<string, string> = {
    new: "#3060D0",
    contacted: "#C77700",
    qualified: "#6B4FB3",
    converted: "#2A7A3B",
    archived: "#7F1D1D",
  };
  const bg = defaults[key] ?? "#64748B";
  return { backgroundColor: bg, color: "#FFFFFF" };
}

function normalizeLeadStatuses(raw: unknown): StatusRow[] {
  if (!Array.isArray(raw)) {
    return [
      { name: "New", color: "#3060D0" },
      { name: "Contacted", color: "#C77700" },
      { name: "Qualified", color: "#6B4FB3" },
      { name: "Converted", color: "#2A7A3B" },
    ];
  }
  const rows = raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        name: String(row.name ?? "").trim(),
        color: String(row.color ?? "").trim() || "#64748B",
      };
    })
    .filter((row) => row.name);
  return rows.length
    ? rows
    : [
        { name: "New", color: "#3060D0" },
        { name: "Contacted", color: "#C77700" },
        { name: "Qualified", color: "#6B4FB3" },
      { name: "Converted", color: "#2A7A3B" },
      ];
}

function normalizeLeadStatusHex(input: unknown): string | null {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value.startsWith("#")) return null;
  if (value.length === 4) {
    const r = value[1];
    const g = value[2];
    const b = value[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (value.length === 7) return value;
  return null;
}

// Blends a status color toward white for the board's card backgrounds — the
// column itself sits at full saturation, so cards need a genuinely lighter
// shade of the same hue (not just a transparent overlay, which would be
// indistinguishable from the column behind it).
function lightenLeadStatusHex(hex: string, amount: number): string {
  const safe = normalizeLeadStatusHex(hex) ?? "#64748B";
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const ratio = Math.max(0, Math.min(1, amount));
  const r = Number.parseInt(safe.slice(1, 3), 16);
  const g = Number.parseInt(safe.slice(3, 5), 16);
  const b = Number.parseInt(safe.slice(5, 7), 16);
  const nr = clamp(r + (255 - r) * ratio);
  const ng = clamp(g + (255 - g) * ratio);
  const nb = clamp(b + (255 - b) * ratio);
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

function darkenLeadStatusHex(hex: string, amount: number): string {
  const safe = normalizeLeadStatusHex(hex) ?? "#64748B";
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const ratio = Math.max(0, Math.min(1, amount));
  const r = Number.parseInt(safe.slice(1, 3), 16);
  const g = Number.parseInt(safe.slice(3, 5), 16);
  const b = Number.parseInt(safe.slice(5, 7), 16);
  const nr = clamp(r * (1 - ratio));
  const ng = clamp(g * (1 - ratio));
  const nb = clamp(b * (1 - ratio));
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

function leadStatusHexToRgba(hex: string, alpha: number): string {
  const safe = normalizeLeadStatusHex(hex) ?? "#64748B";
  const r = Number.parseInt(safe.slice(1, 3), 16);
  const g = Number.parseInt(safe.slice(3, 5), 16);
  const b = Number.parseInt(safe.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function sampleLeadsStorageKey(companyId: string) {
  return `${SAMPLE_LEADS_STORAGE_KEY_PREFIX}${String(companyId || "").trim()}`;
}

function leadsBoardPrefsStorageKey(uid: string, companyId: string) {
  return `${LEADS_BOARD_PREFS_STORAGE_PREFIX}${String(uid || "").trim()}:${String(companyId || "").trim()}`;
}

function readPersistedSampleLeads(companyId: string): CompanyLeadRow[] | null {
  if (typeof window === "undefined") return null;
  const cid = String(companyId || "").trim();
  if (!cid) return null;
  try {
    const raw = window.localStorage.getItem(sampleLeadsStorageKey(cid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as CompanyLeadRow[];
  } catch {
    return null;
  }
}

function persistSampleLeads(companyId: string, rows: CompanyLeadRow[]) {
  if (typeof window === "undefined") return;
  const cid = String(companyId || "").trim();
  if (!cid) return;
  try {
    window.localStorage.setItem(sampleLeadsStorageKey(cid), JSON.stringify(rows));
  } catch {
    // ignore local storage persistence failure
  }
}

function hasPermissionKey(permissionKeys: string[] | undefined, key: string): boolean {
  const target = String(key || "").trim().toLowerCase();
  if (!target) return false;
  return (permissionKeys ?? []).some((item) => {
    const normalized = String(item || "").trim().toLowerCase();
    if (normalized === "company.*" || normalized === target) {
      return true;
    }
    if (normalized === "leads.*" && (target === "leads.view" || target === "leads.view.others")) {
      return true;
    }
    return false;
  });
}

function formatLeadDate(value: string) {
  const d = new Date(String(value || ""));
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .replace(",", " |");
}

function formatLeadFieldLabel(key: string) {
  const raw = String(key || "").trim();
  if (!raw) return "Field";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeLeadFieldKey(key: string) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeLeadFieldLayout(raw: unknown): LeadFieldLayoutRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, idx) => {
      const row = (item ?? {}) as Record<string, unknown>;
      const key = String(row.key || "").trim();
      if (!key) return null;
      const label = String(row.label || "").trim() || formatLeadFieldLabel(key);
        return {
          key,
          label,
          showInRow: Boolean(row.showInRow),
          showInDetail: row.showInDetail == null ? true : Boolean(row.showInDetail),
          order: Number.isFinite(Number(row.order)) ? Number(row.order) : idx,
          projectFieldTarget: ([
            "",
            "clientName",
            "clientFirstName",
            "clientLastName",
            "clientPhone",
            "clientEmail",
            "projectAddress",
            "projectNotes",
        ] as LeadProjectFieldTarget[]).includes(String(row.projectFieldTarget || "").trim() as LeadProjectFieldTarget)
          ? (String(row.projectFieldTarget || "").trim() as LeadProjectFieldTarget)
          : "",
      } satisfies LeadFieldLayoutRow;
    })
    .filter((row): row is LeadFieldLayoutRow => Boolean(row));
}

function mergeLeadFieldLayout(
  availableFields: Array<{ key: string; label: string }>,
  savedLayout: LeadFieldLayoutRow[],
): LeadFieldLayoutRow[] {
  const byKey = new Map(
    savedLayout.map((row) => [normalizeLeadFieldKey(row.key), row] as const),
  );
  return availableFields
    .map((field, idx) => {
      const existing = byKey.get(normalizeLeadFieldKey(field.key));
      return {
        key: existing?.key || field.key,
        label: existing?.label || field.label,
        showInRow: existing?.showInRow ?? idx < 3,
        showInDetail: existing?.showInDetail ?? true,
        order: Number.isFinite(Number(existing?.order)) ? Number(existing?.order) : idx,
        projectFieldTarget: existing?.projectFieldTarget ?? "",
      } satisfies LeadFieldLayoutRow;
    })
    .sort((a, b) => {
      const orderDiff = Number(a.order) - Number(b.order);
      if (orderDiff !== 0) return orderDiff;
      return a.label.localeCompare(b.label);
    });
}

function isInternalTestLead(lead: CompanyLeadRow) {
  const raw = lead.rawFields ?? {};
  return (
    raw.__cutsmartTest === true ||
    String(raw.__cutsmartTest || "").trim().toLowerCase() === "true" ||
    String(raw.FullName || "").trim() === "CutSmart Test Lead" ||
    String(raw.Source || "").trim() === "CutSmart Integration Test"
  );
}

function isTemporarySampleLead(lead: CompanyLeadRow) {
  return String(lead.id || "").startsWith("temporary-sample-lead-") || String(lead.source || "").trim() === "local-sample";
}

function leadValueToText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => leadValueToText(item))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${formatLeadFieldLabel(key)}: ${leadValueToText(item)}`)
      .filter((item) => item.endsWith(": ") === false)
      .join(" | ");
  }
  return String(value).trim();
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

function normalizeLeadImageItems(
  lead: CompanyLeadRow,
): Array<{ url: string; name: string; annotations: Array<{ id: string; x: number; y: number; xPx?: number; yPx?: number; note: string; createdByName?: string; createdByColor?: string }> }> {
  if (Array.isArray(lead.imageItems) && lead.imageItems.length > 0) {
    return lead.imageItems
      .map((item) => ({
        url: String(item?.url || "").trim(),
        name: String(item?.name || "").trim(),
        annotations: Array.isArray(item?.annotations)
          ? item.annotations
              .map((annotation) => ({
                id: String(annotation?.id || "").trim(),
                x: Number(annotation?.x ?? 0),
                y: Number(annotation?.y ?? 0),
                xPx: Number(annotation?.xPx),
                yPx: Number(annotation?.yPx),
                note: String(annotation?.note || "").trim(),
                createdByName: String(annotation?.createdByName || "").trim(),
                createdByColor: String(annotation?.createdByColor || "").trim(),
              }))
              .filter(
                (annotation) =>
                  annotation.id &&
                  annotation.note &&
                  Number.isFinite(annotation.x) &&
                  Number.isFinite(annotation.y),
              )
          : [],
      }))
      .filter((item) => item.url)
      .slice(0, 10);
  }
  return (Array.isArray(lead.imageUrls) ? lead.imageUrls : [])
    .map((url) => ({ url: String(url || "").trim(), name: "", annotations: [] }))
    .filter((item) => item.url)
    .slice(0, 10);
}

function fileNameWithoutExtension(fileName: string): string {
  const raw = String(fileName || "").trim();
  if (!raw) return "";
  const parts = raw.split(".");
  if (parts.length <= 1) return raw;
  parts.pop();
  return parts.join(".").trim();
}

function getLeadDynamicFields(lead: CompanyLeadRow): LeadDynamicField[] {
  if (isInternalTestLead(lead)) return [];
  const raw = lead.rawFields ?? {};
  return Object.entries(raw)
    .filter(([key]) => {
      const normalized = normalizeLeadFieldKey(key);
      return !RESERVED_LEAD_FIELD_KEYS.has(normalized) && !String(key || "").startsWith("__");
    })
    .map(([key, value]) => ({
      key,
      label: formatLeadFieldLabel(key),
      value: leadValueToText(value),
    }))
    .filter((field) => field.value);
}

function scoreLeadFieldKey(field: LeadDynamicField, patterns: RegExp[]) {
  const haystack = `${field.key} ${field.label}`.toLowerCase();
  return patterns.reduce((best, pattern) => (pattern.test(haystack) ? best + 1 : best), 0);
}

function findBestLeadField(
  fields: LeadDynamicField[],
  patterns: RegExp[],
  predicate?: (field: LeadDynamicField) => boolean,
) {
  let bestField: LeadDynamicField | null = null;
  let bestScore = -1;
  for (const field of fields) {
    if (predicate && !predicate(field)) continue;
    const score = scoreLeadFieldKey(field, patterns);
    if (score <= 0) continue;
    // Tie-break alphabetically by key, not by array order — `fields` comes
    // from Object.entries() on data fetched fresh on every poll, and if the
    // server doesn't guarantee stable key order, a plain `score > bestScore`
    // check lets the winner among tied candidates flip between requests,
    // which reads as a field's value randomly flickering between two leads'
    // worth of otherwise-identical data.
    if (score > bestScore || (score === bestScore && bestField && field.key.localeCompare(bestField.key) < 0)) {
      bestField = field;
      bestScore = score;
    }
  }
  return bestScore > 0 ? bestField : null;
}

function isLikelyEmailValue(value: string) {
  return /\S+@\S+\.\S+/.test(String(value || "").trim());
}

function isLikelyPhoneValue(value: string) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  return /^[+\d()\s-]+$/.test(raw) || /^\d+$/.test(raw);
}

function buildLeadAddress(fields: LeadDynamicField[]) {
  const directAddress = findBestLeadField(fields, [/address/, /street/, /location/]);
  if (directAddress?.value) return directAddress.value;
  const parts = fields
    .filter((field) =>
      [/(^|[^a-z])suburb([^a-z]|$)/, /city/, /region/, /postcode/, /zip/, /state/, /country/].some((pattern) =>
        pattern.test(`${field.key} ${field.label}`.toLowerCase()),
      ),
    )
    .map((field) => field.value.trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).join(", ");
}

function suggestProjectName(clientName: string) {
  const parts = String(clientName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
  return parts[parts.length - 1] || parts[0] || "";
}

function splitClientName(fullName: string) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) {
    return { firstName: "", lastName: "" };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

function buildLeadClientNameParts(fields: LeadDynamicField[], fieldLayout: LeadFieldLayoutRow[]) {
  const findMappedField = (target: LeadProjectFieldTarget) => {
    const mapped = fieldLayout.find((row) => row.projectFieldTarget === target);
    if (!mapped) return null;
    return fields.find((field) => normalizeLeadFieldKey(field.key) === normalizeLeadFieldKey(mapped.key)) || null;
  };

  const explicitNameField =
    findMappedField("clientName") ||
    findBestLeadField(fields, [/client\s*name/, /full\s*name/, /(^|[^a-z])name([^a-z]|$)/], (field) => {
      const haystack = `${field.key} ${field.label}`.toLowerCase();
      return !/company|business|organisation|organization/.test(haystack);
    }) ||
    fields.find((field) => {
      const words = field.value.trim().split(/\s+/).filter(Boolean);
      return words.length >= 2 && /^[a-z ,.'-]+$/i.test(field.value.trim());
    }) ||
    null;

  const firstNameField =
    findMappedField("clientFirstName") ||
    findBestLeadField(fields, [/(^|[^a-z])first([^a-z]|$)/, /first\s*name/, /given\s*name/]) ||
    null;
  const lastNameField =
    findMappedField("clientLastName") ||
    findBestLeadField(fields, [/(^|[^a-z])last([^a-z]|$)/, /last\s*name/, /surname/, /family\s*name/]) ||
    null;

  if (explicitNameField?.value) {
    const split = splitClientName(explicitNameField.value);
    return {
      fullName: explicitNameField.value.trim(),
      firstName: firstNameField?.value?.trim() || split.firstName,
      lastName: lastNameField?.value?.trim() || split.lastName,
    };
  }

  const firstName = String(firstNameField?.value || "").trim();
  const lastName = String(lastNameField?.value || "").trim();
  return {
    fullName: [firstName, lastName].filter(Boolean).join(" ").trim(),
    firstName,
    lastName,
  };
}

function resolveLeadColumnValue(
  fields: LeadDynamicField[],
  column: LeadFieldLayoutRow,
  fieldLayout: LeadFieldLayoutRow[],
) {
  const match = fields.find((field) => normalizeLeadFieldKey(field.key) === normalizeLeadFieldKey(column.key));
  if (match?.value) return match.value;

  const nameParts = buildLeadClientNameParts(fields, fieldLayout);
  if (column.projectFieldTarget === "clientName") return nameParts.fullName;
  if (column.projectFieldTarget === "clientFirstName") return nameParts.firstName;
  if (column.projectFieldTarget === "clientLastName") return nameParts.lastName;

  const normalizedKey = normalizeLeadFieldKey(column.key);
  if (["name", "fullname", "clientname"].includes(normalizedKey)) {
    return nameParts.fullName;
  }
  return "";
}

function buildLeadProjectPrefill(lead: CompanyLeadRow, fieldLayout: LeadFieldLayoutRow[]): NewProjectPrefillPayload {
  const fields = getLeadDynamicFields(lead);
  const findMappedField = (target: LeadProjectFieldTarget) => {
    const mapped = fieldLayout.find((row) => row.projectFieldTarget === target);
    if (!mapped) return null;
    return (
      fields.find((field) => normalizeLeadFieldKey(field.key) === normalizeLeadFieldKey(mapped.key)) || null
    );
  };
  const emailField =
    findMappedField("clientEmail") ||
    findBestLeadField(fields, [/email/, /e-mail/], (field) => isLikelyEmailValue(field.value)) ||
    fields.find((field) => isLikelyEmailValue(field.value)) ||
    null;
  const phoneField =
    findMappedField("clientPhone") ||
    findBestLeadField(fields, [/phone/, /mobile/, /cell/, /contact/], (field) => isLikelyPhoneValue(field.value)) ||
    fields.find((field) => isLikelyPhoneValue(field.value)) ||
    null;
  const { fullName: clientName, firstName: clientFirstName, lastName: clientLastName } =
    buildLeadClientNameParts(fields, fieldLayout);
  const notesField = findMappedField("projectNotes");
  return {
    projectName: suggestProjectName(clientName),
    clientFirstName,
    clientLastName,
    clientName,
    clientPhone: String(phoneField?.value || "").trim(),
    clientEmail: String(emailField?.value || "").trim(),
    projectAddress: String(findMappedField("projectAddress")?.value || buildLeadAddress(fields)).trim(),
    projectNotes: String(notesField?.value || "").trim(),
    projectImages: normalizeLeadImageItems(lead).map((item) => item.url),
    projectImageItems: normalizeLeadImageItems(lead).map((item) => ({
      url: item.url,
      name: item.name,
      annotations: Array.isArray(item.annotations)
        ? item.annotations.map((annotation) => ({
            id: annotation.id,
            x: annotation.x,
            y: annotation.y,
            xPx: annotation.xPx,
            yPx: annotation.yPx,
            note: annotation.note,
            createdByName: annotation.createdByName,
            createdByColor: annotation.createdByColor,
          }))
        : [],
    })),
    assignedToUid: String(lead.assignedToUid || "").trim(),
    assignedToName: String(lead.assignedToName || lead.assignedTo || "").trim(),
  };
}

export default function LeadsPage() {
  const { user } = useAuth();
  const currentUserUid = String(user?.uid || "").trim();
  // An unverified account can view leads but not edit/move/delete/assign them — see the same gate
  // in app/(app)/projects/[projectId]/page.tsx's own comment for the fuller reasoning.
  const isUserVerified = Boolean(user?.verified);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [companyAccessResolved, setCompanyAccessResolved] = useState(false);
  const [canAccessLeads, setCanAccessLeads] = useState(false);
  const [canViewOtherLeads, setCanViewOtherLeads] = useState(false);
  const [activeCompanyId, setActiveCompanyId] = useState("");
  const [leads, setLeads] = useState<CompanyLeadRow[]>([]);
  const [leadDetailsById, setLeadDetailsById] = useState<Record<string, CompanyLeadRow>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [leadsViewMode, setLeadsViewMode] = useState<"board" | "grid">("board");
  const [draggingLeadId, setDraggingLeadId] = useState("");
  const [dragOverStatusColumn, setDragOverStatusColumn] = useState("");
  const [collapsedStatusColumns, setCollapsedStatusColumns] = useState<Record<string, boolean>>({});
  const [isBoardCardsCompact, setIsBoardCardsCompact] = useState(false);
  const [compactCardOverrides, setCompactCardOverrides] = useState<Record<string, boolean>>({});
  const [isToolbarExpanded, setIsToolbarExpanded] = useState(true);
  const [boardPrefsHydrated, setBoardPrefsHydrated] = useState(false);
  // Loads this user+company's saved board preferences (collapsed columns,
  // compact cards) once both are known. Deliberately kept separate from the
  // save effect below (rather than reading localStorage directly in
  // useState's initializer) since currentUserUid/activeCompanyId aren't
  // resolved yet on first render. Keyed per user+company (not just company)
  // so each person's board layout is their own — one user collapsing a
  // column or switching to compact cards doesn't affect what anyone else on
  // the same company sees.
  useEffect(() => {
    setBoardPrefsHydrated(false);
    if (typeof window === "undefined" || !currentUserUid || !activeCompanyId) return;
    let nextCollapsed: Record<string, boolean> = {};
    let nextCompact = false;
    let nextCardOverrides: Record<string, boolean> = {};
    // Toolbar defaults to expanded for anyone who's never touched the
    // handle — the whole point is that it's visible from the start so
    // people discover it, only their own explicit collapse should hide it.
    let nextToolbarExpanded = true;
    try {
      const raw = window.localStorage.getItem(leadsBoardPrefsStorageKey(currentUserUid, activeCompanyId));
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") {
        if (parsed.collapsedColumns && typeof parsed.collapsedColumns === "object") {
          nextCollapsed = parsed.collapsedColumns as Record<string, boolean>;
        }
        nextCompact = Boolean(parsed.compactCards);
        if (parsed.compactCardOverrides && typeof parsed.compactCardOverrides === "object") {
          nextCardOverrides = parsed.compactCardOverrides as Record<string, boolean>;
        }
        if (typeof parsed.toolbarExpanded === "boolean") {
          nextToolbarExpanded = parsed.toolbarExpanded;
        }
      }
    } catch {}
    setCollapsedStatusColumns(nextCollapsed);
    setIsBoardCardsCompact(nextCompact);
    setCompactCardOverrides(nextCardOverrides);
    setIsToolbarExpanded(nextToolbarExpanded);
    setBoardPrefsHydrated(true);
  }, [currentUserUid, activeCompanyId]);
  // Persists on every change, but only once hydration above has actually
  // completed for the current user+company — otherwise this would fire on
  // the same mount pass as the load effect, still holding the pre-load
  // defaults, and overwrite the just-loaded values before they ever reach
  // the screen.
  useEffect(() => {
    if (!boardPrefsHydrated) return;
    if (typeof window === "undefined" || !currentUserUid || !activeCompanyId) return;
    try {
      window.localStorage.setItem(
        leadsBoardPrefsStorageKey(currentUserUid, activeCompanyId),
        JSON.stringify({
          collapsedColumns: collapsedStatusColumns,
          compactCards: isBoardCardsCompact,
          compactCardOverrides,
          toolbarExpanded: isToolbarExpanded,
        }),
      );
    } catch {}
  }, [collapsedStatusColumns, isBoardCardsCompact, compactCardOverrides, isToolbarExpanded, boardPrefsHydrated, currentUserUid, activeCompanyId]);
  // The board column row is `position: sticky` (see its className below) — it scrolls up with
  // the page along with the header/toolbar above it until its own top edge reaches just below the
  // fixed nav bar(s), then locks there; only the columns' own internal scroll moves after that.
  // Its actual `height` is a fixed CSS value (see the className below) at all times — mutating an
  // element's real height on every scroll tick changes the page's total scrollable height, which
  // can fight with the browser's own scroll-position clamping and break scrolling entirely, so it
  // must stay constant. The "reveal more as you scroll" effect below is done with `clip-path`
  // instead, which is purely a paint-time mask — it never touches layout or scrollHeight.
  //
  // The row is behind `isLoading`/grid-mode/empty-state gates further down, so it can mount
  // *after* leadsViewMode has already settled to "board" — a plain `useEffect(() => ...,
  // [leadsViewMode])` would then hold a stale null ref forever, since leadsViewMode never changes
  // again to trigger a re-run. A callback ref sidesteps that: setup runs exactly when the node
  // itself mounts/unmounts, independent of render timing, and `leadsViewModeRef` (kept fresh every
  // render, no effect needed) lets the scroll handler always see the current mode.
  const leadsViewModeRef = useRef(leadsViewMode);
  leadsViewModeRef.current = leadsViewMode;
  const boardCheckRef = useRef<(() => void) | null>(null);
  const boardStickyCleanupRef = useRef<(() => void) | null>(null);
  const boardStickyRef = useCallback((el: HTMLDivElement | null) => {
    boardStickyCleanupRef.current?.();
    boardStickyCleanupRef.current = null;
    boardCheckRef.current = null;
    if (!el) return;
    let raf = 0;
    const mainEl = document.querySelector("main");
    // The page-scroll-blocked backstop below (see setPageScrollBlocked) only has an un-stick path
    // via the `wheel` event, which never fires for a touch-driven scroll — a coarse-pointer device
    // that engages the block while mid-scroll inside a column would then have no way to ever
    // un-block the page again (exactly "the page won't scroll back up"). Touch doesn't need the
    // backstop anyway: `.glass-scroll` has no overscroll-behavior set, so native touch scroll-
    // chaining already hands the gesture back to the page on its own once a column's card list
    // hits its own scroll boundary, the same way any ordinary nested scrollable does. Computed
    // once — pointer capability doesn't change over the component's lifetime.
    const isCoarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    // Each column's card list toggles overflow-y directly on the DOM (not via React state) for
    // the same reason clip-path is written directly below: going through setState here would add
    // a render cycle between "scroll crossed the lock threshold" and "the column can actually be
    // scrolled", long enough to eat the rest of a trackpad gesture and leave the user stuck until
    // they start a new one. A plain style write lands on the very next paint, same as clip-path.
    const setCardListsScrollable = (scrollable: boolean) => {
      el.querySelectorAll<HTMLElement>(".glass-scroll.flex-1").forEach((list) => {
        list.style.overflowY = scrollable ? "auto" : "hidden";
      });
    };
    // Each column is two nested elements: an outer shell (marked `data-board-column`) that owns
    // the box-shadow and layout sizing, and an inner element that owns the background/border/blur
    // and `rounded-[16px] overflow-hidden`. The reveal below sets the OUTER's real `height`
    // directly rather than clip-path-ing anything — that's what keeps the shadow (which always
    // renders around whatever size the outer currently is) and the rounded bottom (the inner's
    // own border-radius, which rounds correctly at any height) continuously in sync with how much
    // of the column is actually revealed, instead of a clip-path boundary that doesn't line up
    // with either. This is safe to do with a real `height` (unlike the row itself) because a
    // column's own height doesn't feed into the row's — the row's is fixed independently via its
    // own CSS height, so shrinking a column here never changes the page's total scrollable height.
    const getColumns = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>("[data-board-column]"));
    // Backs the wheel handler below — the EARLY_SCROLLABLE_PX buffer on setCardListsScrollable
    // helps, but a discrete wheel tick still resolves its scroll target once, based on what the
    // BROWSER already considers scrollable at that instant; it can't retroactively redirect a
    // tick that already committed to scrolling the page. `isLocked` (the precise, unbuffered
    // state — matching exactly when position:sticky has actually engaged) lets the wheel handler
    // redirect scroll to a column manually, on every tick, without waiting on the browser to
    // notice anything.
    let isLocked = false;
    // Tracks which element actually scrolls the page (mirrors the same check inside `check()`)
    // so the wheel handler below can manually drive it — see the un-stick comment there.
    let mainScrolls = false;
    // Declared up here (rather than down by onWheel, where it's set) so `check()` can also read
    // it for the page-scroll lock below — see `setPageScrollBlocked`.
    let unsticking = false;
    // Belt-and-suspenders backstop on top of the wheel redirect below: rather than rely solely on
    // preventDefault() suppressing the browser's native scroll on every single wheel tick, this
    // makes it structurally impossible for the page to scroll at all while locked — there's no
    // event-level mechanism (native default action, scroll latching, or anything else) that can
    // scroll a container that has nothing scrollable. Only lifted the instant we deliberately want
    // the page to move (mid un-stick), and re-applied as soon as we're back to "should stay put."
    let pageScrollBlocked = false;
    const setPageScrollBlocked = (blocked: boolean) => {
      if (pageScrollBlocked === blocked) return;
      pageScrollBlocked = blocked;
      const target = mainScrolls ? mainEl : document.documentElement;
      if (target) target.style.overflowY = blocked ? "hidden" : "";
    };
    // Backs the natural-height cache inside `check()` — see the comment down there for why this
    // isn't just remeasured every scroll frame.
    let cachedFullHeight = 0;
    let cachedFullHeightKey = "";
    const check = () => {
      raf = 0;
      // Each column's card list has a fixed, viewport-relative height from the moment it
      // renders — position:sticky only changes whether the row tracks scroll or holds still,
      // not its size — so if the card list were always overflow-y-auto, a swipe over an
      // unlocked (not-yet-stuck) column would scroll the cards instead of the page. Keep it
      // non-scrollable until the sticky row has actually reached its stuck offset, so the
      // gesture bubbles up to the page/main scroll and finishes bringing the board to the top.
      if (leadsViewModeRef.current !== "board") {
        isLocked = false;
        setCardListsScrollable(false);
        setPageScrollBlocked(false);
        getColumns().forEach((col) => { col.style.height = ""; });
        cachedFullHeightKey = "";
        return;
      }
      const stuckTop = Number.parseFloat(getComputedStyle(el).top) || 0;
      // getBoundingClientRect() is always viewport-relative, but the sticky `top` offset is
      // relative to whichever element is actually scrolling — on mobile that's `<main>` itself
      // (already offset ~48px below the fixed tab bar), on desktop it's the document (offset 0).
      // Comparing rect.top straight to the CSS top value only works for the latter, so add back
      // the scrollport's own offset when main is the one doing the scrolling.
      mainScrolls = Boolean(mainEl) && getComputedStyle(mainEl as HTMLElement).overflowY !== "visible";
      const containerTop = mainScrolls ? (mainEl as HTMLElement).getBoundingClientRect().top : 0;
      const rect = el.getBoundingClientRect();
      // A discrete wheel/trackpad tick resolves its scroll target ONCE, based on what's
      // scrollable at that instant — so if a card list only becomes overflow-y-auto exactly AT
      // the pixel the row finishes locking, the tick that lands the row there still scrolls the
      // page (the card list wasn't scrollable yet when the browser picked a target), and the user
      // needs one more, separate tick before the column responds. Unlocking a few pixels EARLY
      // (while the row's own scroll-into-place is still finishing) means the card list is already
      // scrollable by the time that happens, so the same continuous gesture carries straight
      // through. EARLY_SCROLLABLE_PX is small on purpose: position:sticky itself still won't let
      // the row move past its stuck offset regardless, so this can't reintroduce the original bug
      // (cards swallowing a swipe well before the row has scrolled into place) — it only shaves
      // the last few pixels of an already-almost-finished scroll.
      const EARLY_SCROLLABLE_PX = 24;
      isLocked = rect.top <= containerTop + stuckTop + 1;
      const nearlyLocked = rect.top <= containerTop + stuckTop + EARLY_SCROLLABLE_PX;
      setCardListsScrollable(nearlyLocked);
      // Blocked on the same EARLY_SCROLLABLE_PX lead as the card lists go scrollable, not just
      // once `isLocked` — so the page is already unable to scroll by the exact tick that finishes
      // locking, and that tick's wheel event has nothing left to resolve to except the column.
      setPageScrollBlocked(!isCoarsePointer && nearlyLocked && !unsticking);
      const columns = getColumns();
      const firstCol = columns[0];
      if (!firstCol) return;
      // The column's natural (fully-grown) height doesn't change from one scroll frame to the
      // next — only how much of it is currently revealed does — so it's cached here instead of
      // being remeasured on every single scroll-driven call. Remeasuring meant resetting height
      // to "" and immediately reading getBoundingClientRect(), a write-then-read that forces a
      // synchronous layout reflow; doing that (plus repainting every column's backdrop-filter
      // blur) on every scroll frame for the whole lock-in transition is what showed up as
      // stutter, especially visible right at the moving bottom edge, worse on mobile GPUs. The
      // cache key covers the two things that actually DO change it: the column count (data
      // load/filter swapping which columns exist) and the viewport size (resize/orientation).
      const fullHeightCacheKey = `${columns.length}:${window.innerWidth}x${window.innerHeight}`;
      if (fullHeightCacheKey !== cachedFullHeightKey) {
        const prevHeight = firstCol.style.height;
        firstCol.style.height = "";
        cachedFullHeight = firstCol.getBoundingClientRect().height;
        firstCol.style.height = prevHeight;
        cachedFullHeightKey = fullHeightCacheKey;
      }
      const colRect = firstCol.getBoundingClientRect();
      // BOTTOM_PAD gives the revealed edge breathing room from the viewport bottom — matching the
      // row's own pt-2/px-2/pb-2 (and the gap-2 between columns) so every side of a column has the
      // same padding — instead of running flush to the screen edge. It stays in the formula even
      // once locked — rect.top then holds steady at the sticky offset, so this settles just short
      // of the column's true height rather than snapping straight to it, avoiding a jump at the
      // handoff. Measured off each column's own rect (not the row's) so this stays correct
      // regardless of any padding between the row and the columns — they're all the same size and
      // position, so the first one stands in for all of them.
      const BOTTOM_PAD = 8;
      const grownHeight = Math.min(cachedFullHeight, Math.max(0, window.innerHeight - BOTTOM_PAD - colRect.top));
      const nextHeight = grownHeight < cachedFullHeight - 0.5 ? `${grownHeight}px` : "";
      columns.forEach((col) => {
        if (col.style.height !== nextHeight) col.style.height = nextHeight;
      });
    };
    boardCheckRef.current = check;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(check);
    };
    // For ordinary scrolling within a column, this does NOT intercept the wheel event at all —
    // `setPageScrollBlocked` above already makes the page unable to scroll while locked, so a
    // wheel/mouse notch's own native default action has nothing left to resolve to except the
    // column underneath (the only remaining scrollable thing), and scrolls it with the browser's
    // own native, smooth, momentum-preserving animation — the same feel as scrolling the page
    // itself, which a hand-rolled JS scrollTop animation can only ever approximate. This only
    // steps in for the one case native scrolling can't handle on its own: un-sticking the row
    // once a column has been scrolled all the way back to its own top.
    //
    // Once that scroll-up gesture starts un-sticking the row (see below), `isLocked` flips false
    // mid-gesture as soon as the row moves off its stuck offset — but the browser still won't
    // resume its own default scrolling for the REST of that gesture (it was prevented earlier in
    // this same gesture, to redirect it into the column). Without this flag, the moment isLocked
    // flips, onWheel's top guard would bail out and hand back to that browser default action,
    // which visibly reads as the scroll suddenly stopping ("gets stuck") partway through un-
    // sticking. Keeping this true — independent of isLocked — for the rest of the up-scroll keeps
    // driving the page manually all the way through, instead of only for the first tick or two.
    // (Declared up near `isLocked`/`mainScrolls` above, not here, so `check()` can read it too.)
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      if (unsticking) {
        if (e.deltaY > 0) {
          unsticking = false;
        } else {
          setPageScrollBlocked(false);
          const scroller = mainScrolls ? mainEl : null;
          if (scroller) scroller.scrollTop += e.deltaY;
          else window.scrollBy(0, e.deltaY);
          e.preventDefault();
          return;
        }
      }
      if (!isLocked || e.deltaY >= 0) return;
      const cardList = (e.target as HTMLElement | null)?.closest<HTMLElement>(".glass-scroll.flex-1");
      if (!cardList || cardList.scrollTop > 0) return;
      // Scroll the page/main back up manually too, rather than just releasing the event and
      // hoping the browser's default action takes over — this same continuous gesture has
      // already had preventDefault() called on it repeatedly (to redirect it into the column),
      // and the browser doesn't reliably hand default scrolling back to the page for the REST
      // of that gesture once reversed. Driving it ourselves, the same way we drive the column,
      // is what actually un-sticks the row within the same swipe instead of needing a new one.
      unsticking = true;
      setPageScrollBlocked(false);
      const scroller = mainScrolls ? mainEl : null;
      if (scroller) scroller.scrollTop += e.deltaY;
      else window.scrollBy(0, e.deltaY);
      e.preventDefault();
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    mainEl?.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    // Leads load asynchronously, so the very first `check()` call above can land before any
    // column has actually rendered (still showing the loading state) — `getColumns()` finds
    // nothing yet, so nothing gets sized, and nothing else was going to call `check()` again once
    // the columns actually mounted (the view-mode re-check effect below only reruns on
    // leadsViewMode, which by then has already settled). Watching `el` for child changes catches
    // that moment generically — real data finishing load, a filter/search change swapping which
    // columns exist, anything — without needing to name every state that could cause it. Calls
    // `check()` directly rather than going through the rAF-throttled `onScroll`: that throttle
    // exists to coalesce rapid-fire scroll events, but mutations here are infrequent, and a
    // backgrounded tab can leave a pending rAF callback waiting on the browser (which pauses
    // rAF, not MutationObserver, for hidden tabs) — no reason to route through it.
    const observer = new MutationObserver(() => check());
    observer.observe(el, { childList: true, subtree: true });
    boardStickyCleanupRef.current = () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      mainEl?.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      observer.disconnect();
      getColumns().forEach((col) => { col.style.height = ""; });
      setCardListsScrollable(false);
      setPageScrollBlocked(false);
    };
  }, []);
  // Re-run the check immediately on a view-mode toggle (rather than waiting for the next scroll
  // or resize) so switching into/out of board view updates the lock/height state right away.
  // useLayoutEffect, not useEffect: leadsViewMode can flip away from and back to "board" as the
  // localStorage-saved preference hydrates a tick after mount, repainting the panel with the
  // sticky classes (full, unclipped height) before this can apply the clip. A plain useEffect
  // runs after that paint, so returning users could see one frame of the panel's flat, un-rounded
  // true bottom before the mask snapped in; useLayoutEffect applies it first.
  useLayoutEffect(() => {
    boardCheckRef.current?.();
  }, [leadsViewMode]);
  const leadBoardDragGhost = useDragGhost();
  const [listOrder, setListOrder] = useState<"status" | "az" | "za" | "newest" | "oldest">("newest");
  const [isLoading, setIsLoading] = useState(true);
  const [companyName, setCompanyName] = useState("");
  const [companyThemeColor, setCompanyThemeColor] = useState("#2F6BFF");
  const [leadStatusRows, setLeadStatusRows] = useState<StatusRow[]>(normalizeLeadStatuses(undefined));
  const [fieldLayout, setFieldLayout] = useState<LeadFieldLayoutRow[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [detailLoadingLeadId, setDetailLoadingLeadId] = useState("");
  const [confirmDeleteLeadId, setConfirmDeleteLeadId] = useState("");
  const [deletingLeadId, setDeletingLeadId] = useState("");
  const [statusUpdatingLeadId, setStatusUpdatingLeadId] = useState("");
  const [cardStatusMenuLeadId, setCardStatusMenuLeadId] = useState("");
  const [cardStatusMenuOrigin, setCardStatusMenuOrigin] = useState<GlassModalOrigin>(null);
  const cardStatusMenuRef = useRef<HTMLDivElement | null>(null);
  const cardStatusMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const shouldRenderCardStatusMenu = useGlassModalPopOrigin(Boolean(cardStatusMenuLeadId), cardStatusMenuOrigin, cardStatusMenuPanelRef, {
    duration: 180,
    easing: "cubic-bezier(0.34, 1.35, 0.64, 1)",
  });
  const lastCardStatusMenuLeadIdRef = useRef("");
  if (cardStatusMenuLeadId) lastCardStatusMenuLeadIdRef.current = cardStatusMenuLeadId;
  const effectiveCardStatusMenuLeadId = shouldRenderCardStatusMenu
    ? cardStatusMenuLeadId || lastCardStatusMenuLeadIdRef.current
    : "";
  const [leadFormUrl, setLeadFormUrl] = useState("");
  const [companyMembers, setCompanyMembers] = useState<CompanyMemberOption[]>([]);
  const [assignModalOrigin, setAssignModalOrigin] = useState<GlassModalOrigin>(null);
  const [leadImagesModalOrigin, setLeadImagesModalOrigin] = useState<GlassModalOrigin>(null);
  const [deleteConfirmModalOrigin, setDeleteConfirmModalOrigin] = useState<GlassModalOrigin>(null);
  const lastLeadDetailModalLeadRef = useRef<CompanyLeadRow | null>(null);
  const [leadDetailModalOrigin, setLeadDetailModalOrigin] = useState<GlassModalOrigin>(null);
  const leadDetailModalPanelRef = useRef<HTMLDivElement | null>(null);
  const assignModalPanelRef = useRef<HTMLDivElement | null>(null);
  const leadImagesModalPanelRef = useRef<HTMLDivElement | null>(null);
  const deleteConfirmModalPanelRef = useRef<HTMLDivElement | null>(null);
  const [assignLeadId, setAssignLeadId] = useState("");
  const shouldRenderLeadDetailModal = useGlassModalPopOrigin(Boolean(selectedLeadId), leadDetailModalOrigin, leadDetailModalPanelRef);
  const shouldRenderAssignModal = useGlassModalPopOrigin(Boolean(assignLeadId), assignModalOrigin, assignModalPanelRef);
  const shouldRenderDeleteConfirmModal = useGlassModalPopOrigin(Boolean(confirmDeleteLeadId), deleteConfirmModalOrigin, deleteConfirmModalPanelRef);
  const [assignSearch, setAssignSearch] = useState("");
  const [assignSelectedUid, setAssignSelectedUid] = useState("");
  const [assigningLeadId, setAssigningLeadId] = useState("");
  const [leadImagesLeadId, setLeadImagesLeadId] = useState("");
  const shouldRenderLeadImagesModal = useGlassModalPopOrigin(Boolean(leadImagesLeadId), leadImagesModalOrigin, leadImagesModalPanelRef);
  const [leadImagesUploading, setLeadImagesUploading] = useState(false);
  const [leadImagesDragActive, setLeadImagesDragActive] = useState(false);
  const [leadImagesError, setLeadImagesError] = useState("");
  const [leadImagePreviewIndex, setLeadImagePreviewIndex] = useState(-1);
  const [leadImagePreviewScale, setLeadImagePreviewScale] = useState(1);
  const [leadImagePreviewOffset, setLeadImagePreviewOffset] = useState({ x: 0, y: 0 });
  const [leadImageIsZooming, setLeadImageIsZooming] = useState(false);
  const leadImageZoomTargetRef = useRef({ scale: 1, x: 0, y: 0 });
  const leadImageZoomRafRef = useRef<number | null>(null);
  const [leadImagePreviewDragging, setLeadImagePreviewDragging] = useState(false);
  const [leadImagePinsVisible, setLeadImagePinsVisible] = useState(true);
  const [leadImageCommentsCollapsed, setLeadImageCommentsCollapsed] = useState(true);
  const [leadImageCommentsClosing, setLeadImageCommentsClosing] = useState(false);
  const leadImageCommentsCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [leadImageThumbnailsCollapsed, setLeadImageThumbnailsCollapsed] = useState(false);
  const [leadImageDraftAnnotation, setLeadImageDraftAnnotation] = useState<{ x: number; y: number; xPx: number; yPx: number; note: string } | null>(null);
  const [leadImageActiveAnnotationId, setLeadImageActiveAnnotationId] = useState("");
  const [leadImageHighlightedAnnotationId, setLeadImageHighlightedAnnotationId] = useState("");
  const [leadImageDeleteHoverAnnotationId, setLeadImageDeleteHoverAnnotationId] = useState("");
  const [leadImageExpandedClusterId, setLeadImageExpandedClusterId] = useState("");
  const [leadImagePoppingClusterId, setLeadImagePoppingClusterId] = useState("");
  const [leadImageEditingAnnotation, setLeadImageEditingAnnotation] = useState<{ id: string; note: string; width?: number; height?: number } | null>(null);
  const [leadImageListEditingAnnotation, setLeadImageListEditingAnnotation] = useState<{ id: string; note: string; width?: number } | null>(null);
  const [leadImageActiveAnnotationBoxSize, setLeadImageActiveAnnotationBoxSize] = useState<{ id: string; width: number; height: number } | null>(null);
  const [leadImagePinPopupOrigin, setLeadImagePinPopupOrigin] = useState<GlassModalOrigin>(null);
  const leadImagePinPopupPanelRef = useRef<HTMLDivElement | null>(null);
  const leadImageLastActiveAnnotationIdRef = useRef<string>("");
  const leadImagePinPopupShouldRender = useGlassModalPopOrigin(
    Boolean(leadImageActiveAnnotationId),
    leadImagePinPopupOrigin,
    leadImagePinPopupPanelRef,
  );
  useEffect(() => {
    if (leadImageActiveAnnotationId) {
      leadImageLastActiveAnnotationIdRef.current = leadImageActiveAnnotationId;
    }
  }, [leadImageActiveAnnotationId]);
  const [leadImageDraftAnnotationBoxSize, setLeadImageDraftAnnotationBoxSize] = useState<{ width: number; height: number } | null>(null);
  const [confirmDeleteLeadImageAnnotationId, setConfirmDeleteLeadImageAnnotationId] = useState("");
  const [leadImageExpandedAnnotationIds, setLeadImageExpandedAnnotationIds] = useState<Record<string, boolean>>({});
  const [leadImageOverflowAnnotationIds, setLeadImageOverflowAnnotationIds] = useState<Record<string, boolean>>({});
  const [leadImageNaturalSize, setLeadImageNaturalSize] = useState({ width: 0, height: 0 });
  const [leadImageStageSize, setLeadImageStageSize] = useState({ width: 0, height: 0 });
  const [currentUserPinColor, setCurrentUserPinColor] = useState("");
  const [leadImageCachedSrcMap, setLeadImageCachedSrcMap] = useState<Record<string, string>>({});
  const sampleLeadsRef = useRef<Record<string, CompanyLeadRow[]>>({});
  const leadImageCachedUrlsRef = useRef<Set<string>>(new Set());
  const leadImageObjectUrlsRef = useRef<Record<string, string>>({});
  const leadImageCommentsScrollRef = useRef<HTMLDivElement | null>(null);
  const leadImageCommentsDragStateRef = useRef<{ startX: number; startScrollLeft: number; moved: boolean } | null>(null);
  const leadImageCommentsHoverScrollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const leadImageCommentsSuppressClickRef = useRef(false);
  const leadImageCommentEditTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const leadImageDragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const leadImageSuppressImageClickRef = useRef(false);
  const leadImageAnnotationDragStateRef = useRef<{
    annotationId: string;
    moved: boolean;
    startClientX: number;
    startClientY: number;
    originOverlayX: number;
    originOverlayY: number;
  } | null>(null);
  const leadImageAnnotationPendingPointRef = useRef<{ x: number; y: number; xPx: number; yPx: number } | null>(null);
  const leadImageAnnotationDragRafRef = useRef<number | null>(null);
  const leadImagePreviewPendingOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const leadImagePreviewDragRafRef = useRef<number | null>(null);
  const leadImageSuppressPinClickRef = useRef(false);
  const leadImageSuppressClickAfterClusterCollapseRef = useRef(false);
  const leadImageDeleteConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadImageElementRef = useRef<HTMLImageElement | null>(null);
  const leadImageStageRef = useRef<HTMLDivElement | null>(null);
  const [leadImageDraggingAnnotation, setLeadImageDraggingAnnotation] = useState<{
    id: string;
    x: number;
    y: number;
    xPx: number;
    yPx: number;
  } | null>(null);

  useEffect(() => {
    setThemeMode(readThemeMode());
    if (typeof window === "undefined") return;
    const onThemeUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: ThemeMode }>).detail;
      setThemeMode(detail?.mode === "dark" ? "dark" : "light");
    };
    window.addEventListener(THEME_MODE_UPDATED_EVENT, onThemeUpdated as EventListener);
    return () => window.removeEventListener(THEME_MODE_UPDATED_EVENT, onThemeUpdated as EventListener);
  }, []);

  useEffect(() => {
    return () => {
      for (const objectUrl of Object.values(leadImageObjectUrlsRef.current)) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          // ignore url cleanup failure
        }
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (leadImageDeleteConfirmTimeoutRef.current) {
        clearTimeout(leadImageDeleteConfirmTimeoutRef.current);
      }
      if (leadImageAnnotationDragRafRef.current !== null) {
        cancelAnimationFrame(leadImageAnnotationDragRafRef.current);
      }
    };
  }, []);

  const loadLeads = useCallback(async (companyId: string, canViewOtherLeadsOverride?: boolean) => {
    const cid = String(companyId || "").trim();
    if (!cid) {
      setLeads([]);
      return;
    }
    const effectiveCanViewOtherLeads = canViewOtherLeadsOverride ?? canViewOtherLeads;
    const currentSampleLeads =
      sampleLeadsRef.current[cid] ??
      (sampleLeadsRef.current[cid] = readPersistedSampleLeads(cid) ?? buildTemporarySampleLeads(cid));
    persistSampleLeads(cid, currentSampleLeads);
    try {
      const response = await retryAsync(
        () =>
          fetch(`/api/leads?companyId=${encodeURIComponent(cid)}&mode=summary`, {
            method: "GET",
            cache: "no-store",
          }),
        { attempts: 2, delayMs: 300 },
      );
        const detail = (await response.json().catch(() => null)) as
          | { ok?: boolean; leads?: CompanyLeadRow[] }
          | null;
        const fetchedLeads = response.ok && Array.isArray(detail?.leads) ? detail.leads.filter((lead) => !lead.isDeleted) : [];
      const visibleLeads = effectiveCanViewOtherLeads
        ? fetchedLeads
        : fetchedLeads.filter((lead) => String(lead.assignedToUid || "").trim() === currentUserUid);
      const visibleSampleLeads = effectiveCanViewOtherLeads
        ? currentSampleLeads
        : currentSampleLeads.filter((lead) => String(lead.assignedToUid || "").trim() === currentUserUid);
      const nextLeads = [...visibleSampleLeads, ...visibleLeads];
      setLeads(nextLeads);
      setLeadDetailsById((current) => {
        const nextIds = new Set(nextLeads.map((lead) => String(lead.id || "").trim()).filter(Boolean));
        const nextEntries = Object.entries(current).filter(([id]) => nextIds.has(id));
        return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
      });
    } catch {
      const visibleSampleLeads = effectiveCanViewOtherLeads
        ? currentSampleLeads
        : currentSampleLeads.filter((lead) => String(lead.assignedToUid || "").trim() === currentUserUid);
      setLeads(visibleSampleLeads);
      setLeadDetailsById((current) => {
        const nextIds = new Set(visibleSampleLeads.map((lead) => String(lead.id || "").trim()).filter(Boolean));
        const nextEntries = Object.entries(current).filter(([id]) => nextIds.has(id));
        return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
      });
    }
  }, [canViewOtherLeads, currentUserUid]);

  useEffect(() => {
    const run = async () => {
      try {
        if (!user?.uid) {
          setCompanyAccessResolved(true);
          setCanAccessLeads(false);
          setCanViewOtherLeads(false);
          return;
        }
        const storedCompanyId =
          typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() : "";
        const directCompanyId = String(user.companyId || "").trim();
        const fallbackMembership = !directCompanyId
          ? await retryAsync(() => fetchPrimaryMembership(user.uid!), { attempts: 2, delayMs: 250 })
          : null;
        const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
        setActiveCompanyId(companyId);
        if (companyId && !sampleLeadsRef.current[companyId]) {
          sampleLeadsRef.current[companyId] = readPersistedSampleLeads(companyId) ?? buildTemporarySampleLeads(companyId);
          persistSampleLeads(companyId, sampleLeadsRef.current[companyId]);
        }
        if (!companyId) {
          setCompanyAccessResolved(true);
          setCanAccessLeads(false);
          setCanViewOtherLeads(false);
          return;
        }
        const [access, companyDoc, userColorMap] = await retryAsync(
          () =>
            Promise.all([
              fetchCompanyAccess(companyId, user.uid!),
              fetchCompanyDoc(companyId),
              fetchUserColorMapByUids([user.uid!], companyId),
            ]),
          { attempts: 2, delayMs: 250 },
        );
        const role = String(access?.role || "").trim().toLowerCase();
        const permitted =
          role === "owner" ||
          role === "admin" ||
          hasPermissionKey(access?.permissionKeys, "leads.view");
        const canViewAll =
          role === "owner" ||
          role === "admin" ||
          hasPermissionKey(access?.permissionKeys, "leads.view.others");
        setCompanyName(String(companyDoc?.name || "").trim());
        setCompanyThemeColor(String(companyDoc?.themeColor || "").trim() || "#2F6BFF");
        setCurrentUserPinColor(String(userColorMap[String(user.uid || "").trim()] || "").trim());
        setLeadFormUrl(String(companyDoc?.salesLeadFormUrl || "").trim());
        setLeadStatusRows(normalizeLeadStatuses((companyDoc as Record<string, unknown> | null)?.leadStatuses));
        setFieldLayout(
          normalizeLeadFieldLayout(
            ((companyDoc?.integrations as Record<string, unknown> | undefined)?.zapierLeads as Record<string, unknown> | undefined)?.fieldLayout,
          ),
        );
        setCompanyAccessResolved(true);
        setCanAccessLeads(permitted);
        setCanViewOtherLeads(canViewAll);
        if (!permitted) {
          setLeads([]);
          return;
        }
        await loadLeads(companyId, canViewAll);
      } catch {
        setCompanyAccessResolved(true);
        setCanAccessLeads(false);
        setCanViewOtherLeads(false);
        setLeads([]);
      } finally {
        setIsLoading(false);
      }
    };
    void run();
  }, [loadLeads, user?.uid, user?.companyId]);

  const getLeadById = useCallback(
    (leadId: string) => {
      const id = String(leadId || "").trim();
      if (!id) return null;
      return leadDetailsById[id] ?? leads.find((lead) => lead.id === id) ?? null;
    },
    [leadDetailsById, leads],
  );

  // Mirrors of `leads`/`leadDetailsById` in refs so loadLeadDetail below can
  // read fresh state without needing them in its own dependency array — both
  // get a brand-new array/object reference from the 4s polling interval
  // (loadLeads) even when nothing actually changed, and having them as deps
  // meant loadLeadDetail's identity (and therefore the effect that calls it)
  // was recreated every poll tick, refetching the open lead's detail over
  // and over. That produced a flash of "Loading lead details..." each time
  // the redundant fetch's in-flight window happened to land on a render
  // before its (harmless but real) state update landed — the open card's
  // detail flickering every few seconds.
  const leadsRef = useRef<CompanyLeadRow[]>(leads);
  useEffect(() => {
    leadsRef.current = leads;
  }, [leads]);
  const leadDetailsByIdRef = useRef<Record<string, CompanyLeadRow>>(leadDetailsById);
  useEffect(() => {
    leadDetailsByIdRef.current = leadDetailsById;
  }, [leadDetailsById]);

  const loadLeadDetail = useCallback(
    async (leadId: string) => {
      const id = String(leadId || "").trim();
      if (!id || !activeCompanyId) return null;
      if (leadDetailsByIdRef.current[id]) return leadDetailsByIdRef.current[id];
      const summaryLead = leadsRef.current.find((lead) => String(lead.id || "").trim() === id) ?? null;
      if (!canViewOtherLeads && summaryLead && String(summaryLead.assignedToUid || "").trim() !== currentUserUid) {
        return null;
      }
      setDetailLoadingLeadId(id);
      try {
        const response = await fetch(
          `/api/leads?companyId=${encodeURIComponent(activeCompanyId)}&mode=detail&leadId=${encodeURIComponent(id)}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );
        const detail = (await response.json().catch(() => null)) as { ok?: boolean; lead?: CompanyLeadRow } | null;
        if (response.ok && detail?.ok && detail.lead) {
          if (!canViewOtherLeads && String(detail.lead.assignedToUid || "").trim() !== currentUserUid) {
            return null;
          }
          setLeadDetailsById((current) => ({ ...current, [id]: detail.lead! }));
          return detail.lead;
        }
        return null;
      } catch {
        return null;
      } finally {
        setDetailLoadingLeadId((current) => (current === id ? "" : current));
      }
    },
    [activeCompanyId, canViewOtherLeads, currentUserUid],
  );

  useEffect(() => {
    if (!companyAccessResolved || !canAccessLeads || !activeCompanyId) return;
    const intervalId = window.setInterval(() => {
      void loadLeads(activeCompanyId);
    }, 4000);
    return () => window.clearInterval(intervalId);
  }, [activeCompanyId, canAccessLeads, companyAccessResolved, loadLeads]);

  useEffect(() => {
    if (!selectedLeadId) return;
    void loadLeadDetail(selectedLeadId);
  }, [loadLeadDetail, selectedLeadId]);

  useEffect(() => {
    if (!cardStatusMenuLeadId) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (cardStatusMenuRef.current && !cardStatusMenuRef.current.contains(e.target as Node)) {
        setCardStatusMenuLeadId("");
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [cardStatusMenuLeadId]);

  useEffect(() => {
    if (!leadImagesLeadId) return;
    void loadLeadDetail(leadImagesLeadId);
  }, [leadImagesLeadId, loadLeadDetail]);

  const availableFields = useMemo(() => {
    const seen = new Set<string>();
    const columns: Array<{ key: string; label: string }> = [];
    for (const lead of leads) {
      for (const field of getLeadDynamicFields(lead)) {
        const normalized = normalizeLeadFieldKey(field.key);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        columns.push({ key: field.key, label: field.label });
      }
    }
    // Sorted by a stable key so which fields land in the "first 3" fallback
    // (mergeLeadFieldLayout) doesn't shuffle every time the 4s poll refetches
    // `leads` in a different order.
    return columns.sort((a, b) => normalizeLeadFieldKey(a.key).localeCompare(normalizeLeadFieldKey(b.key)));
  }, [leads]);
  const mergedFieldLayout = useMemo(
    () => mergeLeadFieldLayout(availableFields, fieldLayout),
    [availableFields, fieldLayout],
  );

  const filteredLeads = useMemo(() => {
    const query = String(search || "").trim().toLowerCase();
    const filtered = leads.filter((lead) => {
      if (statusFilter !== "all" && String(lead.status || "").trim().toLowerCase() !== statusFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const searchable = [
        lead.formName,
        lead.status,
        ...getLeadDynamicFields(lead).map((field) => field.value),
      ];
      return searchable.some((value) => String(value || "").toLowerCase().includes(query));
    });
    const sorted = [...filtered];
      const leadLabel = (lead: CompanyLeadRow) => {
        const fields = getLeadDynamicFields(lead);
        const derivedName = buildLeadClientNameParts(fields, mergedFieldLayout).fullName;
        const firstVisible = fields[0]?.value || "";
        return String(derivedName || firstVisible || lead.name || lead.email || lead.phone || "").trim().toLowerCase();
      };
    const leadTimestamp = (lead: CompanyLeadRow) => {
      const raw = String(lead.createdAtIso || lead.submittedAtIso || lead.updatedAtIso || "").trim();
      const parsed = raw ? new Date(raw).getTime() : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    };
    if (listOrder === "az") {
      sorted.sort((a, b) => leadLabel(a).localeCompare(leadLabel(b)));
    } else if (listOrder === "za") {
      sorted.sort((a, b) => leadLabel(b).localeCompare(leadLabel(a)));
    } else if (listOrder === "newest") {
      sorted.sort((a, b) => leadTimestamp(b) - leadTimestamp(a));
    } else if (listOrder === "oldest") {
      sorted.sort((a, b) => leadTimestamp(a) - leadTimestamp(b));
    } else {
      sorted.sort((a, b) => {
        const statusDiff = String(a.status || "").trim().toLowerCase().localeCompare(String(b.status || "").trim().toLowerCase());
        if (statusDiff !== 0) return statusDiff;
        return leadTimestamp(b) - leadTimestamp(a);
      });
    }
    return sorted;
  }, [leads, listOrder, search, statusFilter]);

  // Board view ignores `statusFilter` (every status gets its own column) but
  // still respects the search box, matching the grid's search behavior.
  const searchFilteredLeads = useMemo(() => {
    const query = String(search || "").trim().toLowerCase();
    if (!query) return leads;
    return leads.filter((lead) => {
      const searchable = [lead.formName, lead.status, ...getLeadDynamicFields(lead).map((field) => field.value)];
      return searchable.some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [leads, search]);

  const leadStatusBoardColumns = useMemo(() => {
    const leadTimestamp = (lead: CompanyLeadRow) => {
      const raw = String(lead.createdAtIso || lead.submittedAtIso || lead.updatedAtIso || "").trim();
      const parsed = raw ? new Date(raw).getTime() : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const columns = leadStatusRows.map((row) => ({ name: row.name, color: row.color, leads: [] as CompanyLeadRow[] }));
    const byKey = new Map(columns.map((col) => [col.name.trim().toLowerCase(), col]));
    const otherLeads: CompanyLeadRow[] = [];
    for (const lead of searchFilteredLeads) {
      const col = byKey.get(String(lead.status || "").trim().toLowerCase());
      if (col) col.leads.push(lead);
      else otherLeads.push(lead);
    }
    for (const col of columns) col.leads.sort((a, b) => leadTimestamp(b) - leadTimestamp(a));
    otherLeads.sort((a, b) => leadTimestamp(b) - leadTimestamp(a));
    return { columns, otherLeads };
  }, [searchFilteredLeads, leadStatusRows]);

  const newCount = filteredLeads.filter((lead) => String(lead.status || "").trim().toLowerCase() === "new").length;
  const rowFields = useMemo(() => {
    const configured = mergedFieldLayout.filter((field) => field.showInRow);
    return configured.length > 0 ? configured : mergedFieldLayout.slice(0, 3);
  }, [mergedFieldLayout]);
  const detailFields = useMemo(() => {
    const configured = mergedFieldLayout.filter((field) => field.showInDetail);
    return configured.length > 0 ? configured : mergedFieldLayout;
  }, [mergedFieldLayout]);
  const leadStatusColorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of leadStatusRows) {
      map.set(String(row.name || "").trim().toLowerCase(), String(row.color || "").trim() || "#64748B");
    }
    return map;
  }, [leadStatusRows]);
  const leadStatusOptions = useMemo(() => {
    const options = leadStatusRows.map((row) => row.name).filter(Boolean);
    return options.length ? options : ["New", "Contacted", "Qualified", "Converted"];
  }, [leadStatusRows]);
  const leadStatusPillStyle = (statusLabel: string) => {
    const configured = leadStatusColorByName.get(String(statusLabel || "").trim().toLowerCase());
    if (configured) {
      return { backgroundColor: configured, color: "#FFFFFF" };
    }
    return statusPillColors(statusLabel);
  };
  const assignLead = useMemo(
    () => getLeadById(assignLeadId),
    [assignLeadId, getLeadById],
  );
  const assignLeadName = useMemo(() => {
    if (!assignLead) return "Untitled Lead";
    return buildLeadClientNameParts(getLeadDynamicFields(assignLead), mergedFieldLayout).fullName || assignLead.name || "Untitled Lead";
  }, [assignLead, mergedFieldLayout]);
  const filteredCompanyMembers = useMemo(() => {
    const query = String(assignSearch || "").trim().toLowerCase();
    if (!query) return companyMembers;
    return companyMembers.filter((member) => `${member.displayName} ${member.email || ""}`.toLowerCase().includes(query));
  }, [assignSearch, companyMembers]);
  const selectedAssignedMember = useMemo(
    () => companyMembers.find((member) => member.uid === assignSelectedUid) ?? null,
    [companyMembers, assignSelectedUid],
  );
  const leadImagesLead = useMemo(
    () => getLeadById(leadImagesLeadId),
    [getLeadById, leadImagesLeadId],
  );
  const lastLeadImagesLeadRef = useRef<CompanyLeadRow | null>(null);
  if (leadImagesLead) lastLeadImagesLeadRef.current = leadImagesLead;
  const displayLeadImagesLead = leadImagesLead ?? lastLeadImagesLeadRef.current;
  const leadImageItems = leadImagesLead ? normalizeLeadImageItems(leadImagesLead) : [];
  const leadImageUrls = leadImageItems.map((item) => item.url);
  const activeLeadImagePreviewUrl =
    leadImagePreviewIndex >= 0 && leadImagePreviewIndex < leadImageUrls.length
      ? leadImageUrls[leadImagePreviewIndex]
      : "";
  const activeLeadImagePreviewName =
    leadImagePreviewIndex >= 0 && leadImagePreviewIndex < leadImageItems.length
      ? String(leadImageItems[leadImagePreviewIndex]?.name || "").trim()
      : "";
  const activeLeadImageAnnotations =
    leadImagePreviewIndex >= 0 && leadImagePreviewIndex < leadImageItems.length
      ? leadImageItems[leadImagePreviewIndex]?.annotations ?? []
      : [];
  const resolveLeadImageSrc = useCallback(
    (url: string) => {
      const normalized = String(url || "").trim();
      if (!normalized) return "";
      return leadImageCachedSrcMap[normalized] || normalized;
    },
    [leadImageCachedSrcMap],
  );
  const leadImageClientName = leadImagesLead
    ? buildLeadClientNameParts(getLeadDynamicFields(leadImagesLead), mergedFieldLayout).fullName || leadImagesLead.name || "Untitled Lead"
    : "Untitled Lead";
  const getLeadAnnotationRenderPoint = useCallback(
    (annotation: { x: number; y: number; xPx?: number; yPx?: number }) => {
      const naturalWidth = Number(leadImageNaturalSize.width || 0);
      const naturalHeight = Number(leadImageNaturalSize.height || 0);
      if (
        naturalWidth > 0 &&
        naturalHeight > 0 &&
        Number.isFinite(annotation.xPx) &&
        Number.isFinite(annotation.yPx)
      ) {
        return {
          left: `${Math.min(100, Math.max(0, (Number(annotation.xPx) / naturalWidth) * 100))}%`,
          top: `${Math.min(100, Math.max(0, (Number(annotation.yPx) / naturalHeight) * 100))}%`,
        };
      }
      return {
        left: `${Math.min(100, Math.max(0, Number(annotation.x) || 0))}%`,
        top: `${Math.min(100, Math.max(0, Number(annotation.y) || 0))}%`,
      };
    },
    [leadImageNaturalSize],
  );
  const getLeadAnnotationPopupStyle = useCallback(
    (annotation: { x: number; y: number; xPx?: number; yPx?: number }) => {
      const naturalWidth = Number(leadImageNaturalSize.width || 0);
      const naturalHeight = Number(leadImageNaturalSize.height || 0);
      const percentX =
        naturalWidth > 0 && Number.isFinite(annotation.xPx)
          ? Math.min(100, Math.max(0, (Number(annotation.xPx) / naturalWidth) * 100))
          : Math.min(100, Math.max(0, Number(annotation.x) || 0));
      const percentY =
        naturalHeight > 0 && Number.isFinite(annotation.yPx)
          ? Math.min(100, Math.max(0, (Number(annotation.yPx) / naturalHeight) * 100))
          : Math.min(100, Math.max(0, Number(annotation.y) || 0));
      const popupGap = leadImagePreviewScale > 1 ? Math.max(8, Math.round(22 / leadImagePreviewScale)) : 22;
      const horizontalTransform =
        percentX <= 20 ? "translateX(0)" : percentX >= 80 ? "translateX(-100%)" : "translateX(-50%)";
      const verticalTransform =
        percentY >= 72 ? `translateY(calc(-100% - ${popupGap}px))` : `translateY(${popupGap}px)`;
      return {
        left: `${percentX}%`,
        top: `${percentY}%`,
        transform: `${horizontalTransform} ${verticalTransform}`,
        transformOrigin:
          percentX <= 20
            ? percentY >= 72
              ? "left bottom"
              : "left top"
            : percentX >= 80
              ? percentY >= 72
                ? "right bottom"
                : "right top"
              : percentY >= 72
                ? "center bottom"
                : "center top",
      };
    },
    [leadImageNaturalSize, leadImagePreviewScale],
  );
  const fittedLeadImageSize = useMemo(() => {
    const naturalWidth = Number(leadImageNaturalSize.width || 0);
    const naturalHeight = Number(leadImageNaturalSize.height || 0);
    const stageWidth = Number(leadImageStageSize.width || 0);
    const stageHeight = Number(leadImageStageSize.height || 0);
    if (naturalWidth <= 0 || naturalHeight <= 0 || stageWidth <= 0 || stageHeight <= 0) {
      return { width: 0, height: 0 };
    }
    const scale = Math.min(1, stageWidth / naturalWidth, stageHeight / naturalHeight);
    return {
      width: Math.max(1, Math.round(naturalWidth * scale)),
      height: Math.max(1, Math.round(naturalHeight * scale)),
    };
  }, [leadImageNaturalSize, leadImageStageSize]);
  const leadImageSizeReady = fittedLeadImageSize.width > 0 && fittedLeadImageSize.height > 0;
  const getLeadAnnotationPopupScreenStyle = useCallback(
    (
      annotation: { x: number; y: number; xPx?: number; yPx?: number },
      options?: { width?: number; height?: number },
    ) => {
      const naturalWidth = Number(leadImageNaturalSize.width || 0);
      const naturalHeight = Number(leadImageNaturalSize.height || 0);
      const percentX =
        naturalWidth > 0 && Number.isFinite(annotation.xPx)
          ? Math.min(100, Math.max(0, (Number(annotation.xPx) / naturalWidth) * 100))
          : Math.min(100, Math.max(0, Number(annotation.x) || 0));
      const percentY =
        naturalHeight > 0 && Number.isFinite(annotation.yPx)
          ? Math.min(100, Math.max(0, (Number(annotation.yPx) / naturalHeight) * 100))
          : Math.min(100, Math.max(0, Number(annotation.y) || 0));
      const stageWidth = Number(leadImageStageSize.width || 0);
      const stageHeight = Number(leadImageStageSize.height || 0);
      const imageWidth = Number(fittedLeadImageSize.width || 0);
      const imageHeight = Number(fittedLeadImageSize.height || 0);
      const visibleImageLeft = Math.max(0, stageWidth / 2 + leadImagePreviewOffset.x - (imageWidth * leadImagePreviewScale) / 2);
      const visibleImageRight = Math.min(stageWidth, stageWidth / 2 + leadImagePreviewOffset.x + (imageWidth * leadImagePreviewScale) / 2);
      const visibleImageTop = Math.max(0, stageHeight / 2 + leadImagePreviewOffset.y - (imageHeight * leadImagePreviewScale) / 2);
      const visibleImageBottom = Math.min(stageHeight, stageHeight / 2 + leadImagePreviewOffset.y + (imageHeight * leadImagePreviewScale) / 2);
      const margin = 12;
      const availableWidth = Math.max(160, visibleImageRight - visibleImageLeft - margin * 2);
      const availableHeight = Math.max(96, visibleImageBottom - visibleImageTop - margin * 2);
      const popupWidth = Math.min(availableWidth, Math.min(480, Math.max(240, Number(options?.width || 320))));
      const popupHeight = Math.min(availableHeight, Math.max(96, Number(options?.height || 128)));
      const popupGap = leadImagePreviewScale > 1 ? Math.max(8, Math.round(22 / leadImagePreviewScale)) : 22;
      const baseX = (percentX / 100) * imageWidth;
      const baseY = (percentY / 100) * imageHeight;
      const pinX = stageWidth / 2 + leadImagePreviewOffset.x + (baseX - imageWidth / 2) * leadImagePreviewScale;
      const pinY = stageHeight / 2 + leadImagePreviewOffset.y + (baseY - imageHeight / 2) * leadImagePreviewScale;
      const preferAbove = percentY >= 72;
      const preferLeft = percentX >= 80;
      const preferRight = percentX <= 20;

      let left = preferLeft ? pinX : preferRight ? pinX - popupWidth : pinX - popupWidth / 2;
      const minLeft = visibleImageLeft + margin;
      const maxLeft = Math.max(minLeft, visibleImageRight - popupWidth - margin);
      left = Math.min(maxLeft, Math.max(minLeft, left));

      let top = preferAbove ? pinY - popupHeight - popupGap : pinY + popupGap;
      const minTop = visibleImageTop + margin;
      const maxTop = Math.max(minTop, visibleImageBottom - popupHeight - margin);
      top = Math.min(maxTop, Math.max(minTop, top));

      return {
        left: `${left}px`,
        top: `${top}px`,
        maxWidth: `${availableWidth}px`,
        maxHeight: `${availableHeight}px`,
      };
    },
    [fittedLeadImageSize, leadImageNaturalSize, leadImagePreviewOffset, leadImagePreviewScale, leadImageStageSize],
  );
  const leadImageAnnotationUiScale = useMemo(
    () => (leadImagePreviewScale > 0 ? 1 / leadImagePreviewScale : 1),
    [leadImagePreviewScale],
  );
  const getLeadAnnotationPercent = useCallback(
    (annotation: { x: number; y: number; xPx?: number; yPx?: number }) => {
      const naturalWidth = Number(leadImageNaturalSize.width || 0);
      const naturalHeight = Number(leadImageNaturalSize.height || 0);
      if (naturalWidth > 0 && naturalHeight > 0 && Number.isFinite(annotation.xPx) && Number.isFinite(annotation.yPx)) {
        return {
          xPct: Math.min(100, Math.max(0, (Number(annotation.xPx) / naturalWidth) * 100)),
          yPct: Math.min(100, Math.max(0, (Number(annotation.yPx) / naturalHeight) * 100)),
        };
      }
      return {
        xPct: Math.min(100, Math.max(0, Number(annotation.x) || 0)),
        yPct: Math.min(100, Math.max(0, Number(annotation.y) || 0)),
      };
    },
    [leadImageNaturalSize],
  );
  const leadImageAnnotationClusters = useMemo(() => {
    if (!leadImageSizeReady) return [];
    const points = activeLeadImageAnnotations.map((annotation) => {
      const live = leadImageDraggingAnnotation?.id === annotation.id ? leadImageDraggingAnnotation : annotation;
      const { xPct, yPct } = getLeadAnnotationPercent(live);
      return { id: annotation.id, xPct, yPct };
    });
    return clusterPins(points, fittedLeadImageSize.width, fittedLeadImageSize.height, leadImagePreviewScale, 30);
  }, [
    activeLeadImageAnnotations,
    leadImageDraggingAnnotation,
    fittedLeadImageSize,
    leadImagePreviewScale,
    leadImageSizeReady,
    getLeadAnnotationPercent,
  ]);
  const leadImageSpreadPositionsById = useMemo(() => {
    const expanded = leadImageAnnotationClusters.find(
      (cluster) => cluster.isCluster && cluster.clusterId === leadImageExpandedClusterId,
    );
    if (!expanded) return {} as Record<string, { xPct: number; yPct: number }>;
    const spread = computeSpreadPositions(expanded, fittedLeadImageSize.width, fittedLeadImageSize.height, leadImagePreviewScale, 22);
    return Object.fromEntries(spread.map((s) => [s.id, { xPct: s.xPct, yPct: s.yPct }]));
  }, [leadImageAnnotationClusters, leadImageExpandedClusterId, fittedLeadImageSize, leadImagePreviewScale]);
  useEffect(() => {
    if (!leadImagePoppingClusterId) return;
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        setLeadImagePoppingClusterId("");
      });
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
  }, [leadImagePoppingClusterId]);
  useEffect(() => {
    if (!leadImageExpandedClusterId) return;
    const handlePointerDownOutsideClusterGroup = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-lead-cluster-pin-group="true"]')) {
        return;
      }
      setLeadImageActiveAnnotationId("");
      setLeadImageDraftAnnotation(null);
      setLeadImageHighlightedAnnotationId("");
      setLeadImageExpandedClusterId("");
      setLeadImagePoppingClusterId("");
      setLeadImageEditingAnnotation(null);
      setLeadImageListEditingAnnotation(null);
      leadImageSuppressClickAfterClusterCollapseRef.current = true;
    };
    document.addEventListener("mousedown", handlePointerDownOutsideClusterGroup);
    return () => document.removeEventListener("mousedown", handlePointerDownOutsideClusterGroup);
  }, [leadImageExpandedClusterId]);

  const warmLeadImageUrl = useCallback((url: string) => {
    const normalized = String(url || "").trim();
    if (!normalized || typeof window === "undefined") return;
    if (leadImageCachedUrlsRef.current.has(normalized)) return;
    leadImageCachedUrlsRef.current.add(normalized);
    void fetch(normalized, { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) return;
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const previous = leadImageObjectUrlsRef.current[normalized];
        if (previous && previous !== objectUrl) {
          try {
            URL.revokeObjectURL(previous);
          } catch {
            // ignore stale object url cleanup failure
          }
        }
        leadImageObjectUrlsRef.current[normalized] = objectUrl;
        setLeadImageCachedSrcMap((current) =>
          current[normalized] === objectUrl ? current : { ...current, [normalized]: objectUrl },
        );
      })
      .catch(() => {
        // leave original URL in place on fetch failure
      });
    const preload = new Image();
    preload.decoding = "async";
    preload.onload = () => {};
    preload.onerror = () => {};
    preload.src = normalized;
  }, []);

  useEffect(() => {
    setLeadImagePreviewScale(1);
    setLeadImagePreviewOffset({ x: 0, y: 0 });
    setLeadImagePreviewDragging(false);
    setLeadImageIsZooming(false);
    if (leadImageZoomRafRef.current !== null) {
      cancelAnimationFrame(leadImageZoomRafRef.current);
      leadImageZoomRafRef.current = null;
    }
    leadImageZoomTargetRef.current = { scale: 1, x: 0, y: 0 };
    setLeadImageDraftAnnotation(null);
    setLeadImageActiveAnnotationId("");
    setLeadImageHighlightedAnnotationId("");
    setLeadImageDeleteHoverAnnotationId("");
    setLeadImageExpandedClusterId("");
    setLeadImagePoppingClusterId("");
    setLeadImageEditingAnnotation(null);
    setLeadImageListEditingAnnotation(null);
    setLeadImageActiveAnnotationBoxSize(null);
    setLeadImageDraftAnnotationBoxSize(null);
    if (leadImageCommentsCloseTimeoutRef.current) {
      clearTimeout(leadImageCommentsCloseTimeoutRef.current);
      leadImageCommentsCloseTimeoutRef.current = null;
    }
    setLeadImageCommentsCollapsed(true);
    setLeadImageCommentsClosing(false);
    setLeadImageThumbnailsCollapsed(false);
    setLeadImageNaturalSize({ width: 0, height: 0 });
    leadImageDragStateRef.current = null;
    leadImageAnnotationDragStateRef.current = null;
    leadImageAnnotationPendingPointRef.current = null;
    if (leadImageAnnotationDragRafRef.current !== null) {
      cancelAnimationFrame(leadImageAnnotationDragRafRef.current);
      leadImageAnnotationDragRafRef.current = null;
    }
    leadImageSuppressPinClickRef.current = false;
    setLeadImageDraggingAnnotation(null);
  }, [leadImagePreviewIndex]);

  useEffect(() => {
    if (leadImagePreviewIndex >= 0) {
      setLeadImagePinsVisible(true);
    }
  }, [leadImagesLeadId]);

  useEffect(() => {
    let cancelled = false;
    const companyId = String(activeCompanyId || "").trim();
    if (!companyId || !canAccessLeads) {
      setCompanyMembers([]);
      return;
    }
    void fetchCompanyMembers(companyId)
      .then((members) => {
        if (!cancelled) {
          setCompanyMembers(members);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCompanyMembers([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, canAccessLeads]);

  // companyMembers/currentUserPinColor above are both one-time fetches (fetchCompanyMembers/
  // fetchUserColorMapByUids) with no live Firestore listener — a badge color changed elsewhere in
  // the same tab (Company Settings, the personal profile panel) only reaches this page via this
  // event, same pattern already used by dashboard/company-settings/app-shell/recently-deleted.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onUserColorUpdated = (event: Event) => {
      const detail = (event as CustomEvent<UserColorUpdatedDetail>).detail;
      const uid = String(detail?.uid || "").trim();
      const color = String(detail?.color || "").trim();
      if (!uid) return;
      setCompanyMembers((prev) =>
        prev.map((member) =>
          String(member.uid || "").trim() === uid
            ? { ...member, badgeColor: color || undefined, userColor: color || undefined }
            : member,
        ),
      );
      if (String(user?.uid || "").trim() === uid) {
        setCurrentUserPinColor(color);
      }
    };
    window.addEventListener(USER_COLOR_UPDATED_EVENT, onUserColorUpdated as EventListener);
    return () => {
      window.removeEventListener(USER_COLOR_UPDATED_EVENT, onUserColorUpdated as EventListener);
    };
  }, [user?.uid]);

  useEffect(() => {
    setLeadImageExpandedAnnotationIds({});
    setLeadImageOverflowAnnotationIds({});
  }, [leadImagePreviewIndex]);

  useEffect(() => {
    if (!activeLeadImagePreviewUrl) return;
    let cancelled = false;
    warmLeadImageUrl(activeLeadImagePreviewUrl);
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      setLeadImageNaturalSize({
        width: Number(image.naturalWidth || 0),
        height: Number(image.naturalHeight || 0),
      });
    };
    image.onerror = () => {
      if (cancelled) return;
      setLeadImageNaturalSize({ width: 0, height: 0 });
    };
    image.src = activeLeadImagePreviewUrl;
    return () => {
      cancelled = true;
    };
  }, [activeLeadImagePreviewUrl, warmLeadImageUrl]);

  useEffect(() => {
    for (const url of leadImageUrls) {
      warmLeadImageUrl(url);
    }
  }, [leadImageUrls, warmLeadImageUrl]);

  useEffect(() => {
    if (!activeLeadImagePreviewUrl || typeof window === "undefined") return;
    const updateStageSize = () => {
      const rect = leadImageStageRef.current?.getBoundingClientRect();
      setLeadImageStageSize({
        width: Number(rect?.width || 0),
        height: Number(rect?.height || 0),
      });
    };
    updateStageSize();
    const stageElement = leadImageStageRef.current;
    const resizeObserver =
      stageElement && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            updateStageSize();
          })
        : null;
    if (stageElement && resizeObserver) {
      resizeObserver.observe(stageElement);
    }
    window.addEventListener("resize", updateStageSize);
    return () => {
      window.removeEventListener("resize", updateStageSize);
      resizeObserver?.disconnect();
    };
  }, [activeLeadImagePreviewUrl]);

  const syncLeadImagesInState = useCallback((
    lead: CompanyLeadRow,
    imageItems: Array<{ url: string; name: string; annotations?: Array<{ id: string; x: number; y: number; xPx?: number; yPx?: number; note: string; createdByName?: string; createdByColor?: string }> }>,
  ) => {
    const normalized = imageItems
      .map((item) => ({
        url: String(item?.url || "").trim(),
        name: String(item?.name || "").trim(),
        annotations: Array.isArray(item?.annotations)
          ? item.annotations
              .map((annotation) => ({
                id: String(annotation?.id || "").trim(),
                x: Number(annotation?.x ?? 0),
                y: Number(annotation?.y ?? 0),
                xPx: Number(annotation?.xPx),
                yPx: Number(annotation?.yPx),
                note: String(annotation?.note || "").trim(),
                createdByName: String(annotation?.createdByName || "").trim(),
                createdByColor: String(annotation?.createdByColor || "").trim(),
              }))
              .filter((annotation) => annotation.id && annotation.note && Number.isFinite(annotation.x) && Number.isFinite(annotation.y))
          : [],
      }))
      .filter((item) => item.url)
      .slice(0, 10);
    setLeads((current) =>
      current.map((item) =>
        item.id === lead.id ? { ...item, imageItems: normalized, imageUrls: normalized.map((image) => image.url) } : item,
      ),
    );
    setLeadDetailsById((current) => {
      if (!current[lead.id]) return current;
      return {
        ...current,
        [lead.id]: {
          ...current[lead.id],
          imageItems: normalized,
          imageUrls: normalized.map((image) => image.url),
        },
      };
    });
    if (isTemporarySampleLead(lead)) {
      sampleLeadsRef.current[lead.companyId] = (sampleLeadsRef.current[lead.companyId] || []).map((item) =>
        item.id === lead.id ? { ...item, imageItems: normalized, imageUrls: normalized.map((image) => image.url) } : item,
      );
      persistSampleLeads(lead.companyId, sampleLeadsRef.current[lead.companyId]);
    }
  }, []);

  const saveLeadImages = useCallback(
    async (
      lead: CompanyLeadRow,
      imageItems: Array<{ url: string; name: string; annotations?: Array<{ id: string; x: number; y: number; xPx?: number; yPx?: number; note: string; createdByName?: string; createdByColor?: string }> }>,
    ) => {
      const normalized = imageItems
        .map((item) => ({
          url: String(item?.url || "").trim(),
          name: String(item?.name || "").trim(),
          annotations: Array.isArray(item?.annotations)
            ? item.annotations
                .map((annotation) => ({
                  id: String(annotation?.id || "").trim(),
                  x: Number(annotation?.x ?? 0),
                  y: Number(annotation?.y ?? 0),
                  xPx: Number(annotation?.xPx),
                  yPx: Number(annotation?.yPx),
                  note: String(annotation?.note || "").trim(),
                  createdByName: String(annotation?.createdByName || "").trim(),
                  createdByColor: String(annotation?.createdByColor || "").trim(),
                }))
                .filter((annotation) => annotation.id && annotation.note && Number.isFinite(annotation.x) && Number.isFinite(annotation.y))
            : [],
        }))
        .filter((item) => item.url)
        .slice(0, 10);
      if (!isUserVerified) return false;
      if (isTemporarySampleLead(lead)) {
        syncLeadImagesInState(lead, normalized);
        return true;
      }
      const response = await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: lead.companyId,
          leadId: lead.id,
          imageItems: normalized,
        }),
      }).catch(() => null);
      if (!response?.ok) {
        return false;
      }
      syncLeadImagesInState(lead, normalized);
      void loadLeads(lead.companyId);
      return true;
    },
    [isUserVerified, loadLeads, syncLeadImagesInState],
  );

  const handleDeleteLead = async (lead: CompanyLeadRow) => {
    const leadId = String(lead.id || "").trim();
    if (!leadId || deletingLeadId || !isUserVerified) return;
    setDeletingLeadId(leadId);
    let didArchive = false;
    if (isTemporarySampleLead(lead)) {
      didArchive = true;
    } else {
      const response = await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: lead.companyId,
          leadId,
          isDeleted: true,
        }),
      }).catch(() => null);
      didArchive = Boolean(response?.ok);
    }
    if (didArchive) {
      if (isTemporarySampleLead(lead)) {
        sampleLeadsRef.current[lead.companyId] = (sampleLeadsRef.current[lead.companyId] || []).filter((item) => item.id !== leadId);
        persistSampleLeads(lead.companyId, sampleLeadsRef.current[lead.companyId]);
      }
      setLeads((current) => current.filter((item) => item.id !== leadId));
      setSelectedLeadId((current) => (current === leadId ? "" : current));
      setConfirmDeleteLeadId("");
      if (!isTemporarySampleLead(lead)) {
        void loadLeads(lead.companyId);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(LEAD_ARCHIVE_UPDATED_EVENT, {
              detail: {
                companyId: String(lead.companyId || "").trim(),
                leadId,
                isDeleted: true,
              },
            }),
          );
        }
      }
    }
    setDeletingLeadId("");
  };
  const onSelectLeadStatus = async (lead: CompanyLeadRow, nextStatus: string) => {
    if (!nextStatus || statusUpdatingLeadId || !isUserVerified) return;
    // getLeadById() (used by both the detail drawer and the board's drag-drop
    // handler) prefers leadDetailsById over the leads list once a lead's full
    // detail has been fetched — that cache never refetches on its own, so it
    // must be patched here too or every reader of getLeadById() keeps seeing
    // the pre-change status forever (this is what made dragging a card back
    // to its previous column silently no-op: the drop handler's "already in
    // this status" check compared against the stale cached status).
    const patchDetailCache = () =>
      setLeadDetailsById((prev) =>
        prev[lead.id] ? { ...prev, [lead.id]: { ...prev[lead.id], status: nextStatus, updatedAtIso: new Date().toISOString() } } : prev,
      );
    if (isTemporarySampleLead(lead)) {
      sampleLeadsRef.current[lead.companyId] = (sampleLeadsRef.current[lead.companyId] || []).map((row) =>
        row.id === lead.id ? { ...row, status: nextStatus, updatedAtIso: new Date().toISOString() } : row,
      );
      persistSampleLeads(lead.companyId, sampleLeadsRef.current[lead.companyId]);
      setLeads((prev) => prev.map((row) => (row.id === lead.id ? { ...row, status: nextStatus, updatedAtIso: new Date().toISOString() } : row)));
      patchDetailCache();
      return;
    }
    setStatusUpdatingLeadId(lead.id);
    const response = await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: lead.companyId,
        leadId: lead.id,
        status: nextStatus,
      }),
    }).catch(() => null);
    if (response?.ok) {
      setLeads((prev) => prev.map((row) => (row.id === lead.id ? { ...row, status: nextStatus, updatedAtIso: new Date().toISOString() } : row)));
      patchDetailCache();
      void loadLeads(lead.companyId);
    }
    setStatusUpdatingLeadId("");
  };

  const onLeadBoardCardDragStart = (event: ReactDragEvent<HTMLDivElement>, lead: CompanyLeadRow) => {
    event.dataTransfer.setData("text/plain", lead.id);
    event.dataTransfer.effectAllowed = "move";
    setDraggingLeadId(lead.id);
    if (leadBoardDragGhost.transparentImageRef.current) {
      event.dataTransfer.setDragImage(leadBoardDragGhost.transparentImageRef.current, 0, 0);
    }
    const displayName =
      buildLeadClientNameParts(getLeadDynamicFields(lead), mergedFieldLayout).fullName ||
      lead.name || lead.email || lead.phone || "Untitled Lead";
    const color = String(leadStatusPillStyle(lead.status || "New").backgroundColor || "");
    leadBoardDragGhost.spawn(event, `lead-board-name-${lead.id}`, { label: displayName, color });
  };

  const onLeadBoardCardDragEnd = () => {
    setDraggingLeadId("");
    setDragOverStatusColumn("");
    leadBoardDragGhost.end();
  };

  const onLeadBoardColumnDrop = (event: ReactDragEvent<HTMLElement>, statusName: string) => {
    event.preventDefault();
    setDragOverStatusColumn("");
    const leadId = event.dataTransfer.getData("text/plain") || draggingLeadId;
    setDraggingLeadId("");
    // Also dismiss the drag ghost here rather than relying solely on the
    // source card's onDragEnd — a successful drop here can immediately move
    // the dragged lead into a different status column (a different parent
    // in the DOM, so React unmounts/remounts that card's element), and if
    // that happens before the browser gets around to dispatching `dragend`
    // on the now-detached original element, the native event never fires
    // and the ghost is left stuck on screen until the next drag.
    leadBoardDragGhost.end();
    const lead = getLeadById(leadId);
    if (!lead) return;
    if (String(lead.status || "").trim().toLowerCase() === statusName.trim().toLowerCase()) return;
    void onSelectLeadStatus(lead, statusName);
  };

  const handleCreateProjectFromLead = async (lead: CompanyLeadRow) => {
    if (typeof window === "undefined") return;
    const fullLead = (await loadLeadDetail(lead.id)) ?? getLeadById(lead.id) ?? lead;
    window.dispatchEvent(
      new CustomEvent<NewProjectPrefillPayload>(OPEN_NEW_PROJECT_EVENT, {
        detail: {
          ...buildLeadProjectPrefill(fullLead, mergedFieldLayout),
          sourceLeadId: String(fullLead.id || "").trim(),
          sourceLeadCompanyId: String(fullLead.companyId || "").trim(),
        },
      }),
    );
  };

  const archiveLeadAfterProjectCreate = useCallback(
    async (leadId: string, companyId: string) => {
      const id = String(leadId || "").trim();
      const cid = String(companyId || "").trim();
      if (!id || !cid || !isUserVerified) return;
      const lead = getLeadById(id);
      if (!lead) return;

      let didArchive = false;
      if (isTemporarySampleLead(lead)) {
        sampleLeadsRef.current[cid] = (sampleLeadsRef.current[cid] || []).filter((item) => item.id !== id);
        persistSampleLeads(cid, sampleLeadsRef.current[cid]);
        didArchive = true;
      } else {
        const response = await fetch("/api/leads", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: cid,
            leadId: id,
            isDeleted: true,
          }),
        }).catch(() => null);
        didArchive = Boolean(response?.ok);
      }

      if (!didArchive) return;
      setLeads((current) => current.filter((item) => item.id !== id));
      setLeadDetailsById((current) => {
        if (!current[id]) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
      setSelectedLeadId((current) => (current === id ? "" : current));
      setLeadImagesLeadId((current) => (current === id ? "" : current));
      setAssignLeadId((current) => (current === id ? "" : current));
      setConfirmDeleteLeadId((current) => (current === id ? "" : current));
      if (!isTemporarySampleLead(lead) && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(LEAD_ARCHIVE_UPDATED_EVENT, {
            detail: {
              companyId: cid,
              leadId: id,
              isDeleted: true,
            },
          }),
        );
        void loadLeads(cid);
      }
    },
    [getLeadById, isUserVerified, loadLeads],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onLeadProjectCreated = (event: Event) => {
      const detail = (
        event as CustomEvent<{ leadId?: string; companyId?: string; projectId?: string }>
      ).detail;
      const leadId = String(detail?.leadId || "").trim();
      const companyId = String(detail?.companyId || "").trim();
      if (!leadId || !companyId) return;
      void archiveLeadAfterProjectCreate(leadId, companyId);
    };
    window.addEventListener(LEAD_PROJECT_CREATED_EVENT, onLeadProjectCreated as EventListener);
    return () => {
      window.removeEventListener(LEAD_PROJECT_CREATED_EVENT, onLeadProjectCreated as EventListener);
    };
  }, [archiveLeadAfterProjectCreate]);

  const openAssignLeadModal = (lead: CompanyLeadRow) => {
    setAssignLeadId(lead.id);
    setAssignSearch("");
    setAssignSelectedUid(String(lead.assignedToUid || "").trim());
  };

  const closeAssignLeadModal = () => {
    if (assigningLeadId) return;
    setAssignLeadId("");
    setAssignSearch("");
    setAssignSelectedUid("");
  };

  useEffect(() => {
    if (!selectedLeadId) return;
    if (!leads.some((lead) => String(lead.id || "").trim() === selectedLeadId)) {
      setSelectedLeadId("");
    }
  }, [leads, selectedLeadId]);

  useEffect(() => {
    if (!assignLeadId) return;
    if (!leads.some((lead) => String(lead.id || "").trim() === assignLeadId)) {
      closeAssignLeadModal();
    }
  }, [assignLeadId, closeAssignLeadModal, leads]);

  const handleAssignLead = async () => {
    if (!assignLead || !assignSelectedUid || assigningLeadId || !isUserVerified) return;
    const member = companyMembers.find((item) => item.uid === assignSelectedUid);
    if (!member) return;
    const assignedName = String(member.displayName || member.email || "").trim();
    if (!assignedName) return;
    const updatedAtIso = new Date().toISOString();
    setAssigningLeadId(assignLead.id);
    if (isTemporarySampleLead(assignLead)) {
      sampleLeadsRef.current[assignLead.companyId] = (sampleLeadsRef.current[assignLead.companyId] || []).map((row) =>
        row.id === assignLead.id
          ? { ...row, assignedToUid: member.uid, assignedToName: assignedName, assignedTo: assignedName, updatedAtIso }
          : row,
      );
      persistSampleLeads(assignLead.companyId, sampleLeadsRef.current[assignLead.companyId]);
      setLeads((current) => {
        const nextRows = current.map((row) =>
          row.id === assignLead.id
            ? { ...row, assignedToUid: member.uid, assignedToName: assignedName, assignedTo: assignedName, updatedAtIso }
            : row,
        );
        return canViewOtherLeads ? nextRows : nextRows.filter((row) => String(row.assignedToUid || "").trim() === currentUserUid);
      });
      setAssigningLeadId("");
      closeAssignLeadModal();
      return;
    }
    const response = await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: assignLead.companyId,
        leadId: assignLead.id,
        assignedToUid: member.uid,
        assignedToName: assignedName,
      }),
    }).catch(() => null);
    if (response?.ok) {
      setLeads((current) => {
        const nextRows = current.map((row) =>
          row.id === assignLead.id
            ? { ...row, assignedToUid: member.uid, assignedToName: assignedName, assignedTo: assignedName, updatedAtIso }
            : row,
        );
        return canViewOtherLeads ? nextRows : nextRows.filter((row) => String(row.assignedToUid || "").trim() === currentUserUid);
      });
      closeAssignLeadModal();
      void loadLeads(assignLead.companyId);
    }
    setAssigningLeadId("");
  };

  const openLeadForm = () => {
    const url = String(leadFormUrl || "").trim();
    if (!url || typeof window === "undefined") return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const closeLeadImagesModal = () => {
    if (leadImagesUploading) return;
    setLeadImagesLeadId("");
    setLeadImagesDragActive(false);
    setLeadImagesError("");
    setLeadImagePreviewIndex(-1);
    setLeadImagePreviewScale(1);
    setLeadImagePreviewOffset({ x: 0, y: 0 });
    setLeadImagePreviewDragging(false);
    setLeadImageIsZooming(false);
    if (leadImageZoomRafRef.current !== null) {
      cancelAnimationFrame(leadImageZoomRafRef.current);
      leadImageZoomRafRef.current = null;
    }
    leadImageZoomTargetRef.current = { scale: 1, x: 0, y: 0 };
    setLeadImageDraftAnnotation(null);
    setLeadImageActiveAnnotationId("");
    setLeadImageExpandedClusterId("");
    setLeadImagePoppingClusterId("");
    setLeadImageThumbnailsCollapsed(false);
    leadImageDragStateRef.current = null;
  };

  useEffect(() => {
    if (!leadImagesLeadId) return;
    if (!leads.some((lead) => String(lead.id || "").trim() === leadImagesLeadId)) {
      closeLeadImagesModal();
    }
  }, [closeLeadImagesModal, leadImagesLeadId, leads]);

  const handleUploadLeadImages = async (lead: CompanyLeadRow, incomingFiles: File[] | FileList | null) => {
    const files = Array.from(incomingFiles ?? []).filter((file) => file.type.startsWith("image/"));
    if (!files.length || leadImagesUploading) return;
    setLeadImagesError("");
    const existing = normalizeLeadImageItems(lead);
    const room = Math.max(0, 10 - existing.length);
    if (room <= 0) return;
    const selected = files.slice(0, room);
    setLeadImagesUploading(true);
    try {
      let nextItems: Array<{ url: string; name: string }> = [];
      if (isTemporarySampleLead(lead)) {
        const dataUrls = (await Promise.all(selected.map((file) => readFileAsDataUrl(file)))).filter(Boolean);
        nextItems = [
          ...existing,
          ...dataUrls.map((url, idx) => ({
            url,
            name: fileNameWithoutExtension(selected[idx]?.name || "") || `Image ${existing.length + idx + 1}`,
          })),
        ].slice(0, 10);
      } else {
        const storageClient = storage;
        if (!storageClient) {
          setLeadImagesUploading(false);
          return;
        }
        let uploadError: unknown = null;
        const uploaded = await Promise.all(
          selected.map(async (file, idx) => {
            try {
              const ext = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
              const path = `companies/${lead.companyId}/leads/${lead.id}/images/${Date.now()}_${idx + 1}.${ext}`;
              const ref = storageRef(storageClient, path);
              await uploadBytes(ref, file, { contentType: file.type || "image/jpeg" });
              return await getDownloadURL(ref);
            } catch (error) {
              if (!uploadError) uploadError = error;
              return "";
            }
          }),
        );
        if (uploadError) {
          setLeadImagesError(
            isFirebaseStorageQuotaExceeded(uploadError)
              ? getFirebaseStorageQuotaExceededMessage("Lead images")
              : "Could not upload lead images.",
          );
        }
        nextItems = [
          ...existing,
          ...uploaded
            .map((url, idx) => ({
              url: String(url || "").trim(),
              name: fileNameWithoutExtension(selected[idx]?.name || "") || `Image ${existing.length + idx + 1}`,
            }))
            .filter((item) => item.url),
        ].slice(0, 10);
      }
      await saveLeadImages(lead, nextItems);
    } finally {
      setLeadImagesUploading(false);
      setLeadImagesDragActive(false);
    }
  };

  const handleRemoveLeadImage = async (lead: CompanyLeadRow, imageUrl: string) => {
    if (leadImagesUploading) return;
    const existing = normalizeLeadImageItems(lead);
    const removedIndex = existing.findIndex((item) => item.url === imageUrl);
    const nextItems = existing.filter((item) => item.url !== imageUrl);
    setLeadImagesUploading(true);
    try {
      await saveLeadImages(lead, nextItems);
      setLeadImagePreviewIndex((current) => {
        if (current < 0) return current;
        if (removedIndex < 0) return current;
        if (!nextItems.length) return -1;
        if (current > removedIndex) return current - 1;
        if (current === removedIndex) return Math.min(current, nextItems.length - 1);
        return current;
      });
    } finally {
      setLeadImagesUploading(false);
    }
  };

  const handleRenameLeadImage = async (lead: CompanyLeadRow, imageUrl: string, nextName: string) => {
    const existing = normalizeLeadImageItems(lead);
    const normalizedName = String(nextName || "").trim();
    const current = existing.find((item) => item.url === imageUrl);
    if (!current || current.name === normalizedName) return;
    const nextItems = existing.map((item) => (item.url === imageUrl ? { ...item, name: normalizedName } : item));
    setLeadImagesUploading(true);
    try {
      await saveLeadImages(lead, nextItems);
    } finally {
      setLeadImagesUploading(false);
    }
  };

  const handleLeadImageClickForAnnotation = (event: ReactMouseEvent<HTMLImageElement>) => {
    if (leadImageDraggingAnnotation) return;
    if (leadImageSuppressImageClickRef.current) {
      leadImageSuppressImageClickRef.current = false;
      return;
    }
    if (leadImageSuppressClickAfterClusterCollapseRef.current) {
      leadImageSuppressClickAfterClusterCollapseRef.current = false;
      return;
    }
    if (leadImageActiveAnnotationId || leadImageDraftAnnotation) {
      setLeadImageActiveAnnotationId("");
      setLeadImageDraftAnnotation(null);
      setLeadImageEditingAnnotation(null);
      setLeadImageListEditingAnnotation(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const x = (offsetX / rect.width) * 100;
    const y = (offsetY / rect.height) * 100;
    const naturalWidth = Number(leadImageNaturalSize.width || 0);
    const naturalHeight = Number(leadImageNaturalSize.height || 0);
    const xPx = naturalWidth > 0 ? Math.round((offsetX / rect.width) * naturalWidth) : Math.round(offsetX);
    const yPx = naturalHeight > 0 ? Math.round((offsetY / rect.height) * naturalHeight) : Math.round(offsetY);
    setLeadImageActiveAnnotationId("");
    setLeadImageDraftAnnotation({
      x: Math.min(100, Math.max(0, Number(x.toFixed(2)))),
      y: Math.min(100, Math.max(0, Number(y.toFixed(2)))),
      xPx: Math.max(0, xPx),
      yPx: Math.max(0, yPx),
      note: "",
    });
  };

  const handleSaveLeadImageAnnotation = async () => {
    if (!leadImagesLead || leadImagePreviewIndex < 0 || !leadImageDraftAnnotation) return;
    const note = String(leadImageDraftAnnotation.note || "").trim();
    if (!note) return;
    const existing = normalizeLeadImageItems(leadImagesLead);
    const nextItems = existing.map((item, idx) =>
      idx === leadImagePreviewIndex
        ? {
            ...item,
            annotations: [
              ...(item.annotations ?? []),
              {
                id: `annotation_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                x: leadImageDraftAnnotation.x,
                y: leadImageDraftAnnotation.y,
                xPx: leadImageDraftAnnotation.xPx,
                yPx: leadImageDraftAnnotation.yPx,
                note,
                createdByName: String(user?.displayName || user?.email || "Unknown User").trim(),
                createdByColor: String(currentUserPinColor || companyThemeColor || "").trim() || companyThemeColor,
              },
            ],
          }
        : item,
    );
    setLeadImagesUploading(true);
    try {
      const ok = await saveLeadImages(leadImagesLead, nextItems);
      if (ok) {
        setLeadImageDraftAnnotation(null);
      }
    } finally {
      setLeadImagesUploading(false);
    }
  };

  const closeLeadImageAnnotationOverlays = useCallback(() => {
    setLeadImageActiveAnnotationId("");
    setLeadImageDraftAnnotation(null);
    setLeadImageHighlightedAnnotationId("");
    setLeadImageExpandedClusterId("");
    setLeadImagePoppingClusterId("");
    setLeadImageEditingAnnotation(null);
    setLeadImageListEditingAnnotation(null);
  }, []);

  const toggleLeadImageComments = useCallback(() => {
    if (leadImageCommentsCloseTimeoutRef.current) {
      clearTimeout(leadImageCommentsCloseTimeoutRef.current);
      leadImageCommentsCloseTimeoutRef.current = null;
    }
    if (leadImageCommentsCollapsed) {
      setLeadImageCommentsClosing(false);
      setLeadImageCommentsCollapsed(false);
      return;
    }
    // Keep the strip mounted (commentsCollapsed stays false) for one more animation frame so the
    // exit animation can play, then actually collapse it once the drop-out animation has finished.
    setLeadImageCommentsClosing(true);
    leadImageCommentsCloseTimeoutRef.current = setTimeout(() => {
      setLeadImageCommentsCollapsed(true);
      setLeadImageCommentsClosing(false);
      leadImageCommentsCloseTimeoutRef.current = null;
    }, 360);
  }, [leadImageCommentsCollapsed]);

  useEffect(() => {
    return () => {
      if (leadImageCommentsCloseTimeoutRef.current) {
        clearTimeout(leadImageCommentsCloseTimeoutRef.current);
      }
      if (leadImageZoomRafRef.current !== null) {
        cancelAnimationFrame(leadImageZoomRafRef.current);
      }
      if (leadImagePreviewDragRafRef.current !== null) {
        cancelAnimationFrame(leadImagePreviewDragRafRef.current);
      }
    };
  }, []);

  const buildLeadAnnotationPointFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const dragState = leadImageAnnotationDragStateRef.current;
      const imageWidth = Number(fittedLeadImageSize.width || 0);
      const imageHeight = Number(fittedLeadImageSize.height || 0);
      if (!dragState || imageWidth <= 0 || imageHeight <= 0 || leadImagePreviewScale <= 0) return null;
      const overlayX =
        dragState.originOverlayX + (clientX - dragState.startClientX) / leadImagePreviewScale;
      const overlayY =
        dragState.originOverlayY + (clientY - dragState.startClientY) / leadImagePreviewScale;
      const offsetX = Math.min(imageWidth, Math.max(0, overlayX));
      const offsetY = Math.min(imageHeight, Math.max(0, overlayY));
      const x = Math.min(100, Math.max(0, Number(((offsetX / imageWidth) * 100).toFixed(2))));
      const y = Math.min(100, Math.max(0, Number(((offsetY / imageHeight) * 100).toFixed(2))));
      const naturalWidth = Number(leadImageNaturalSize.width || 0);
      const naturalHeight = Number(leadImageNaturalSize.height || 0);
      const xPx = naturalWidth > 0 ? Math.round((offsetX / imageWidth) * naturalWidth) : Math.round(offsetX);
      const yPx = naturalHeight > 0 ? Math.round((offsetY / imageHeight) * naturalHeight) : Math.round(offsetY);
      return {
        x,
        y,
        xPx: Math.max(0, xPx),
        yPx: Math.max(0, yPx),
      };
    },
    [fittedLeadImageSize, leadImageNaturalSize, leadImagePreviewScale],
  );

  const handleMoveLeadImageAnnotation = useCallback(
    async (annotationId: string, nextPoint: { x: number; y: number; xPx: number; yPx: number }) => {
      if (!leadImagesLead || leadImagePreviewIndex < 0) return;
      const existing = normalizeLeadImageItems(leadImagesLead);
      const nextItems = existing.map((item, idx) =>
        idx === leadImagePreviewIndex
          ? {
              ...item,
              annotations: (item.annotations ?? []).map((annotation) =>
                annotation.id === annotationId ? { ...annotation, ...nextPoint } : annotation,
              ),
            }
          : item,
      );
      const optimisticLead: CompanyLeadRow = {
        ...leadImagesLead,
        imageItems: nextItems,
        imageUrls: nextItems.map((item) => item.url),
      };
      syncLeadImagesInState(leadImagesLead, nextItems);
      await saveLeadImages(optimisticLead, nextItems);
    },
    [leadImagePreviewIndex, leadImagesLead, saveLeadImages, syncLeadImagesInState],
  );

  const handleSaveEditedLeadImageAnnotation = useCallback(async () => {
    if (!leadImagesLead || leadImagePreviewIndex < 0 || !leadImageEditingAnnotation) return;
    const note = String(leadImageEditingAnnotation.note || "").trim();
    if (!note) return;
    const existing = normalizeLeadImageItems(leadImagesLead);
    const nextItems = existing.map((item, idx) =>
      idx === leadImagePreviewIndex
        ? {
            ...item,
            annotations: (item.annotations ?? []).map((annotation) =>
              annotation.id === leadImageEditingAnnotation.id ? { ...annotation, note } : annotation,
            ),
          }
        : item,
    );
    const optimisticLead: CompanyLeadRow = {
      ...leadImagesLead,
      imageItems: nextItems,
      imageUrls: nextItems.map((item) => item.url),
    };
    syncLeadImagesInState(leadImagesLead, nextItems);
    setLeadImageEditingAnnotation(null);
    await saveLeadImages(optimisticLead, nextItems);
  }, [leadImageEditingAnnotation, leadImagePreviewIndex, leadImagesLead, saveLeadImages, syncLeadImagesInState]);

  const handleSaveEditedLeadImageListAnnotation = useCallback(async () => {
    if (!leadImagesLead || leadImagePreviewIndex < 0 || !leadImageListEditingAnnotation) return;
    const note = String(leadImageListEditingAnnotation.note || "").trim();
    if (!note) return;
    const existing = normalizeLeadImageItems(leadImagesLead);
    const nextItems = existing.map((item, idx) =>
      idx === leadImagePreviewIndex
        ? {
            ...item,
            annotations: (item.annotations ?? []).map((annotation) =>
              annotation.id === leadImageListEditingAnnotation.id ? { ...annotation, note } : annotation,
            ),
          }
        : item,
    );
    const optimisticLead = {
      ...leadImagesLead,
      imageUrls: nextItems.map((item) => item.url),
      imageItems: nextItems,
    };
    syncLeadImagesInState(leadImagesLead, nextItems);
    setLeadImageListEditingAnnotation(null);
    await saveLeadImages(optimisticLead, nextItems);
  }, [leadImageListEditingAnnotation, leadImagePreviewIndex, leadImagesLead, saveLeadImages, syncLeadImagesInState]);

  const handleDeleteLeadImageAnnotation = useCallback(async (annotationId: string) => {
    if (!leadImagesLead || leadImagePreviewIndex < 0) return;
    const existing = normalizeLeadImageItems(leadImagesLead);
    const nextItems = existing.map((item, idx) =>
      idx === leadImagePreviewIndex
        ? {
            ...item,
            annotations: (item.annotations ?? []).filter((annotation) => annotation.id !== annotationId),
          }
        : item,
    );
    const optimisticLead: CompanyLeadRow = {
      ...leadImagesLead,
      imageItems: nextItems,
      imageUrls: nextItems.map((item) => item.url),
    };
    syncLeadImagesInState(leadImagesLead, nextItems);
    if (leadImageActiveAnnotationId === annotationId) {
      setLeadImageActiveAnnotationId("");
    }
    if (leadImageHighlightedAnnotationId === annotationId) {
      setLeadImageHighlightedAnnotationId("");
    }
    if (leadImageDeleteHoverAnnotationId === annotationId) {
      setLeadImageDeleteHoverAnnotationId("");
    }
    if (leadImageEditingAnnotation?.id === annotationId) {
      setLeadImageEditingAnnotation(null);
    }
    if (leadImageListEditingAnnotation?.id === annotationId) {
      setLeadImageListEditingAnnotation(null);
    }
    await saveLeadImages(optimisticLead, nextItems);
  }, [
    leadImageActiveAnnotationId,
    leadImageEditingAnnotation,
    leadImageListEditingAnnotation,
    leadImageHighlightedAnnotationId,
    leadImageDeleteHoverAnnotationId,
    leadImagePreviewIndex,
    leadImagesLead,
    saveLeadImages,
    syncLeadImagesInState,
  ]);

  const armDeleteLeadImageAnnotation = useCallback((annotationId: string) => {
    setConfirmDeleteLeadImageAnnotationId(annotationId);
    if (leadImageDeleteConfirmTimeoutRef.current) {
      clearTimeout(leadImageDeleteConfirmTimeoutRef.current);
    }
    leadImageDeleteConfirmTimeoutRef.current = setTimeout(() => {
      setConfirmDeleteLeadImageAnnotationId((current) => (current === annotationId ? "" : current));
      leadImageDeleteConfirmTimeoutRef.current = null;
    }, 5000);
  }, []);

  const startLeadImageCommentsDrag = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("textarea, input, [data-lead-image-comments-no-drag='true']")
    ) {
      return;
    }
    const container = leadImageCommentsScrollRef.current;
    if (!container) return;
    leadImageCommentsDragStateRef.current = {
      startX: event.clientX,
      startScrollLeft: container.scrollLeft,
      moved: false,
    };
  }, []);

  const moveLeadImageCommentsDrag = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const dragState = leadImageCommentsDragStateRef.current;
    const container = leadImageCommentsScrollRef.current;
    if (!dragState || !container) return;
    if (Math.abs(event.clientX - dragState.startX) > 4) {
      dragState.moved = true;
      leadImageCommentsSuppressClickRef.current = true;
    }
    container.scrollLeft = dragState.startScrollLeft - (event.clientX - dragState.startX);
  }, []);

  const stopLeadImageCommentsDrag = useCallback(() => {
    leadImageCommentsDragStateRef.current = null;
    window.setTimeout(() => {
      leadImageCommentsSuppressClickRef.current = false;
    }, 0);
  }, []);

  const updateLeadImageAnnotationOverflow = useCallback((annotationId: string, node: HTMLSpanElement | null) => {
    if (!node) return;
    const hasOverflow = node.scrollHeight > node.clientHeight + 1;
    setLeadImageOverflowAnnotationIds((current) =>
      current[annotationId] === hasOverflow ? current : { ...current, [annotationId]: hasOverflow },
    );
  }, []);

  const stopLeadImageCommentsHoverScroll = useCallback(() => {
    if (leadImageCommentsHoverScrollRef.current) {
      clearInterval(leadImageCommentsHoverScrollRef.current);
      leadImageCommentsHoverScrollRef.current = null;
    }
  }, []);

  const startLeadImageCommentsHoverScroll = useCallback((direction: "left" | "right") => {
    const container = leadImageCommentsScrollRef.current;
    if (!container) return;
    stopLeadImageCommentsHoverScroll();
    leadImageCommentsHoverScrollRef.current = setInterval(() => {
      const nextContainer = leadImageCommentsScrollRef.current;
      if (!nextContainer) return;
      nextContainer.scrollLeft += direction === "left" ? -12 : 12;
    }, 16);
  }, [stopLeadImageCommentsHoverScroll]);

  useEffect(() => {
    return () => {
      if (leadImageCommentsHoverScrollRef.current) {
        clearInterval(leadImageCommentsHoverScrollRef.current);
        leadImageCommentsHoverScrollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const textarea = leadImageCommentEditTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [leadImageEditingAnnotation, leadImageListEditingAnnotation]);

  const startLeadImageAnnotationDrag = (
    event: ReactMouseEvent<HTMLButtonElement>,
    annotation: { id: string; x: number; y: number; xPx?: number; yPx?: number },
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const naturalWidth = Number(leadImageNaturalSize.width || 0);
    const naturalHeight = Number(leadImageNaturalSize.height || 0);
    const imageWidth = Number(fittedLeadImageSize.width || 0);
    const imageHeight = Number(fittedLeadImageSize.height || 0);
    const percentX =
      naturalWidth > 0 && Number.isFinite(annotation.xPx)
        ? Math.min(100, Math.max(0, (Number(annotation.xPx) / naturalWidth) * 100))
        : Math.min(100, Math.max(0, Number(annotation.x) || 0));
    const percentY =
      naturalHeight > 0 && Number.isFinite(annotation.yPx)
        ? Math.min(100, Math.max(0, (Number(annotation.yPx) / naturalHeight) * 100))
        : Math.min(100, Math.max(0, Number(annotation.y) || 0));
    leadImageAnnotationDragStateRef.current = {
      annotationId: annotation.id,
      moved: false,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originOverlayX: (percentX / 100) * imageWidth,
      originOverlayY: (percentY / 100) * imageHeight,
    };
    setLeadImageDraggingAnnotation({
      id: annotation.id,
      x: annotation.x,
      y: annotation.y,
      xPx: Number.isFinite(annotation.xPx) ? Number(annotation.xPx) : 0,
      yPx: Number.isFinite(annotation.yPx) ? Number(annotation.yPx) : 0,
    });
  };

  const clampLeadImagePreviewOffsetX = useCallback(
    (x: number, scale: number) => {
      const stageWidth = Number(leadImageStageSize.width || 0);
      const imageWidth = Number(fittedLeadImageSize.width || 0);
      const maxX = Math.max(0, (imageWidth * scale - stageWidth) / 2);
      return Math.min(maxX, Math.max(-maxX, x));
    },
    [leadImageStageSize, fittedLeadImageSize],
  );

  // Chases leadImageZoomTargetRef every frame instead of snapping straight to it — each wheel
  // tick moves the target instantly (so input never feels delayed), while the actual displayed
  // scale/offset eases toward it, which is what makes rapid successive ticks read as one smooth
  // zoom instead of a staircase of instant jumps or a CSS transition restarting on every tick.
  const runLeadImageZoomAnimation = useCallback(() => {
    if (leadImageZoomRafRef.current !== null) return;
    const tick = () => {
      const target = leadImageZoomTargetRef.current;
      let stillAnimating = false;
      setLeadImagePreviewScale((current) => {
        const diff = target.scale - current;
        if (Math.abs(diff) < 0.0015) return target.scale;
        stillAnimating = true;
        return current + diff * 0.3;
      });
      setLeadImagePreviewOffset((current) => {
        const dx = target.x - current.x;
        const dy = target.y - current.y;
        if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) return { x: target.x, y: target.y };
        stillAnimating = true;
        return { x: current.x + dx * 0.3, y: current.y + dy * 0.3 };
      });
      if (stillAnimating) {
        leadImageZoomRafRef.current = window.requestAnimationFrame(tick);
      } else {
        leadImageZoomRafRef.current = null;
        setLeadImageIsZooming(false);
      }
    };
    setLeadImageIsZooming(true);
    leadImageZoomRafRef.current = window.requestAnimationFrame(tick);
  }, []);

  const handleLeadImagePreviewWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    // If no animation is currently chasing the target, the target may have gone stale (e.g. the
    // offset changed from a pan-drag since the last zoom) — resync it to the actual displayed
    // values first so this tick continues from where the image really is, not from old state.
    if (leadImageZoomRafRef.current === null) {
      leadImageZoomTargetRef.current = { scale: leadImagePreviewScale, x: leadImagePreviewOffset.x, y: leadImagePreviewOffset.y };
    }
    const target = leadImageZoomTargetRef.current;
    // Scale the step by the actual scroll delta (exponentially) instead of a fixed amount per
    // event — a physical mouse-wheel notch (large deltaY) zooms in a satisfying single jump,
    // while a trackpad's stream of tiny deltas still accumulates smoothly.
    const zoomFactor = Math.exp(-event.deltaY * 0.0022);
    const stageRect = leadImageStageRef.current?.getBoundingClientRect();
    // Cursor position relative to the stage's own center — the same origin the wrapper's
    // translate/scale transform is anchored to — so we can solve for the offset that keeps
    // the point under the cursor visually fixed while the scale changes around it.
    const cursorX = stageRect ? event.clientX - stageRect.left - stageRect.width / 2 : 0;
    const cursorY = stageRect ? event.clientY - stageRect.top - stageRect.height / 2 : 0;
    const nextScale = Math.min(5, Math.max(1, Number((target.scale * zoomFactor).toFixed(3))));
    if (nextScale === target.scale) return;
    const k = nextScale / target.scale;
    const nextOffset =
      nextScale === 1
        ? { x: 0, y: 0 }
        : {
            x: clampLeadImagePreviewOffsetX(cursorX * (1 - k) + k * target.x, nextScale),
            y: cursorY * (1 - k) + k * target.y,
          };
    leadImageZoomTargetRef.current = { scale: nextScale, x: nextOffset.x, y: nextOffset.y };
    runLeadImageZoomAnimation();
  };

  const startLeadImagePreviewDrag = (event: ReactMouseEvent<HTMLElement>) => {
    if (leadImagePreviewScale <= 1) return;
    event.preventDefault();
    leadImageDragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: leadImagePreviewOffset.x,
      originY: leadImagePreviewOffset.y,
      moved: false,
    };
  };

  const handleLeadImagePreviewDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (leadImageAnnotationDragStateRef.current) {
      const nextPoint = buildLeadAnnotationPointFromClient(event.clientX, event.clientY);
      if (!nextPoint) return;
      const drag = leadImageAnnotationDragStateRef.current;
      drag.moved = true;
      leadImageSuppressPinClickRef.current = true;
      leadImageAnnotationPendingPointRef.current = nextPoint;
      if (leadImageAnnotationDragRafRef.current === null) {
        leadImageAnnotationDragRafRef.current = window.requestAnimationFrame(() => {
          leadImageAnnotationDragRafRef.current = null;
          const point = leadImageAnnotationPendingPointRef.current;
          if (!point) return;
          setLeadImageDraggingAnnotation((current) =>
            current
              ? {
                  ...current,
                  ...point,
                }
              : null,
          );
        });
      }
      return;
    }
    if (!leadImageDragStateRef.current) return;
    const drag = leadImageDragStateRef.current;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(deltaX, deltaY) < 4) return;
      drag.moved = true;
      setLeadImagePreviewDragging(true);
    }
    // Batch pan updates to one per animation frame — applying every raw mousemove synchronously
    // (mousemove can fire much faster than 60fps) is what caused the stutter, since each one forced
    // a full re-render of this whole page's tree.
    leadImagePreviewPendingOffsetRef.current = { x: drag.originX + deltaX, y: drag.originY + deltaY };
    if (leadImagePreviewDragRafRef.current === null) {
      leadImagePreviewDragRafRef.current = window.requestAnimationFrame(() => {
        leadImagePreviewDragRafRef.current = null;
        const pending = leadImagePreviewPendingOffsetRef.current;
        if (!pending) return;
        setLeadImagePreviewOffset(pending);
      });
    }
  };

  const stopLeadImagePreviewDrag = () => {
    const annotationDrag = leadImageAnnotationDragStateRef.current;
    if (annotationDrag) {
      leadImageAnnotationDragStateRef.current = null;
      if (leadImageAnnotationDragRafRef.current !== null) {
        cancelAnimationFrame(leadImageAnnotationDragRafRef.current);
        leadImageAnnotationDragRafRef.current = null;
      }
      const pendingPoint = leadImageAnnotationPendingPointRef.current;
      if (annotationDrag.moved && pendingPoint) {
        void handleMoveLeadImageAnnotation(annotationDrag.annotationId, {
          x: pendingPoint.x,
          y: pendingPoint.y,
          xPx: pendingPoint.xPx,
          yPx: pendingPoint.yPx,
        });
      }
      leadImageAnnotationPendingPointRef.current = null;
      setLeadImageDraggingAnnotation(null);
      return;
    }
    if (leadImagePreviewDragRafRef.current !== null) {
      cancelAnimationFrame(leadImagePreviewDragRafRef.current);
      leadImagePreviewDragRafRef.current = null;
    }
    const imageDrag = leadImageDragStateRef.current;
    if (imageDrag?.moved) {
      leadImageSuppressImageClickRef.current = true;
      window.setTimeout(() => {
        leadImageSuppressImageClickRef.current = false;
      }, 0);
      const pendingOffset = leadImagePreviewPendingOffsetRef.current;
      setLeadImagePreviewOffset((current) => {
        const base = pendingOffset ?? current;
        return {
          x: clampLeadImagePreviewOffsetX(base.x, leadImagePreviewScale),
          y: base.y,
        };
      });
    }
    leadImagePreviewPendingOffsetRef.current = null;
    setLeadImagePreviewDragging(false);
    leadImageDragStateRef.current = null;
  };

  const openLeadImagePreview = useCallback((nextIndex: number) => {
    setLeadImageNaturalSize({ width: 0, height: 0 });
    setLeadImagePreviewOffset({ x: 0, y: 0 });
    setLeadImagePreviewScale(1);
    setLeadImagePreviewDragging(false);
    setLeadImageIsZooming(false);
    if (leadImageZoomRafRef.current !== null) {
      cancelAnimationFrame(leadImageZoomRafRef.current);
      leadImageZoomRafRef.current = null;
    }
    leadImageZoomTargetRef.current = { scale: 1, x: 0, y: 0 };
    setLeadImageDraftAnnotation(null);
    setLeadImageActiveAnnotationId("");
    setLeadImageEditingAnnotation(null);
    setLeadImageActiveAnnotationBoxSize(null);
    setLeadImageDraftAnnotationBoxSize(null);
    setLeadImageDraggingAnnotation(null);
    leadImageDragStateRef.current = null;
    leadImageAnnotationDragStateRef.current = null;
    leadImageSuppressPinClickRef.current = false;
    if (nextIndex >= 0) {
      setLeadImageThumbnailsCollapsed(false);
    }
    setLeadImagePreviewIndex(nextIndex);
  }, []);

  function renderLeadCard(lead: CompanyLeadRow, options?: { draggable?: boolean; accentColor?: string; compact?: boolean }) {
    const draggable = Boolean(options?.draggable);
    const accentColor = options?.accentColor;
    const compact = Boolean(options?.compact);
    const effectiveCompact = compactCardOverrides[lead.id] ?? compact;
    const leadFields = getLeadDynamicFields(lead);
    const displayName =
      buildLeadClientNameParts(leadFields, mergedFieldLayout).fullName ||
      leadFields[0]?.value ||
      lead.name || lead.email || lead.phone || "Untitled Lead";
    const assignedUid = String(lead.assignedToUid || "").trim();
    const assignedMember = companyMembers.find((member) => member.uid === assignedUid) ?? null;
    const assignedLabel = String(lead.assignedToName || lead.assignedTo || assignedMember?.displayName || "").trim();
    const assignedColor = String(assignedMember?.badgeColor || assignedMember?.userColor || companyThemeColor).trim() || companyThemeColor;
    const assignedInitials = assignedLabel.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
    const photoCount = normalizeLeadImageItems(lead).length;
    const isStatusMenuOpen = effectiveCardStatusMenuLeadId === lead.id;
    const isDarkMode = themeMode === "dark";
    const cardBg = accentColor
      ? isDarkMode
        ? darkenLeadStatusHex(accentColor, 0.75)
        : lightenLeadStatusHex(accentColor, 0.75)
      : "var(--glass-bg-strong)";
    const cardBorder = accentColor
      ? isDarkMode
        ? darkenLeadStatusHex(accentColor, 0.4)
        : lightenLeadStatusHex(accentColor, 0.45)
      : "var(--glass-border)";
    const boardTextColor = accentColor ? (isDarkMode ? "var(--text-main)" : "#000000") : "var(--text-main)";
    const boardMutedColor = accentColor ? (isDarkMode ? "var(--text-main)" : "#000000") : "var(--text-muted)";
    const toggleButtonBg = accentColor ? (isDarkMode ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.55)") : "var(--panel-muted)";
    return (
      <div
        key={lead.id}
        role="button"
        tabIndex={0}
        draggable={draggable}
        onDragStart={draggable ? (e) => onLeadBoardCardDragStart(e, lead) : undefined}
        onDragEnd={draggable ? onLeadBoardCardDragEnd : undefined}
        onClick={(e) => {
          setLeadDetailModalOrigin(captureGlassModalOrigin(e));
          setSelectedLeadId(lead.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            setLeadDetailModalOrigin({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
            setSelectedLeadId(lead.id);
          }
        }}
        className={`relative flex flex-col rounded-[16px] border text-left transition hover:brightness-[0.97] ${effectiveCompact ? "gap-0 px-4 py-3" : "gap-3 p-4"} ${draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
        style={{
          borderColor: cardBorder,
          backgroundColor: cardBg,
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          boxShadow: "var(--shadow-glass)",
          opacity: draggable && draggingLeadId === lead.id ? 0.4 : 1,
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCompactCardOverrides((prev) => ({ ...prev, [lead.id]: !effectiveCompact }));
          }}
          className="absolute right-3 top-3 z-10 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition hover:brightness-95"
          style={{
            color: boardMutedColor,
            backgroundColor: toggleButtonBg,
          }}
          title={effectiveCompact ? "Expand card" : "Collapse card"}
          aria-label={effectiveCompact ? "Expand card" : "Collapse card"}
        >
          {effectiveCompact ? <ChevronsLeftRight size={13} /> : <ChevronsRightLeft size={13} />}
        </button>
        {!effectiveCompact && (
          <div className="flex items-center justify-between gap-2 pr-8">
              {!accentColor && (
                <div className="relative" ref={isStatusMenuOpen ? cardStatusMenuRef : undefined}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isStatusMenuOpen) {
                        setCardStatusMenuLeadId("");
                      } else {
                        setCardStatusMenuOrigin(captureGlassModalOrigin(e));
                        setCardStatusMenuLeadId(lead.id);
                      }
                    }}
                    className="relative z-40 inline-flex h-6 items-center justify-center rounded-full px-2.5 text-[10px] font-bold transition hover:brightness-95"
                    style={leadStatusPillStyle(lead.status || "New")}
                  >
                    {lead.status || "New"}
                  </button>
                  {isStatusMenuOpen ? (
                    <div
                      ref={cardStatusMenuPanelRef}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute left-0 top-0 z-50 min-w-[170px] overflow-hidden rounded-[14px] border p-1.5"
                      style={{
                        borderColor: "var(--glass-border)",
                        backgroundColor: "var(--glass-modal-bg)",
                        backdropFilter: "blur(12px) saturate(220%)",
                        WebkitBackdropFilter: "blur(12px) saturate(220%)",
                        boxShadow: "var(--shadow-glass)",
                      }}
                    >
                      {leadStatusOptions.map((option) => {
                        const active = String(lead.status || "").trim().toLowerCase() === option.toLowerCase();
                        return (
                          <button
                            key={option}
                            type="button"
                            disabled={statusUpdatingLeadId === lead.id}
                            onClick={() => {
                              void onSelectLeadStatus(lead, option);
                              setCardStatusMenuLeadId("");
                            }}
                            className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left text-[11px] font-bold transition hover:bg-[var(--panel-muted)] disabled:cursor-wait disabled:opacity-60"
                            style={{ color: "var(--text-main)", ...(active ? { backgroundColor: "var(--panel-muted)" } : {}) }}
                          >
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: String(leadStatusPillStyle(option).backgroundColor || "") }} />
                            {option}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              )}
              <span className="ml-auto whitespace-nowrap text-[11px] font-semibold" style={{ color: boardMutedColor }}>
                {formatLeadDate(lead.createdAtIso || "")}
              </span>
            </div>
        )}
        <p id={`lead-board-name-${lead.id}`} className="truncate pr-8 text-[14px] font-bold" style={{ color: boardTextColor }}>
          {displayName}
        </p>
        {!effectiveCompact && (
          <>
            {rowFields.length > 0 ? (
              <div className="space-y-1">
                {rowFields.map((column) => {
                  const value = resolveLeadColumnValue(leadFields, column, mergedFieldLayout);
                  return (
                    <p key={`${lead.id}:${column.key}`} className="truncate text-[12px]" style={{ color: boardMutedColor }}>
                      <span className="font-semibold" style={{ color: boardTextColor }}>{column.label}: </span>
                      {value || "-"}
                    </p>
                  );
                })}
              </div>
            ) : null}
            <div className="mt-auto flex items-center justify-between gap-2 pt-1">
              {assignedLabel ? (
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: assignedColor }}
                  >
                    {assignedInitials || "?"}
                  </span>
                  <span className="truncate text-[12px] font-semibold" style={{ color: boardMutedColor }}>
                    {assignedLabel}
                  </span>
                </div>
              ) : <span />}
              {photoCount > 0 ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-bold"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: boardMutedColor }}
                >
                  <ImagePlus size={11} />
                  {photoCount}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
    );
  }

  function renderLeadDetailDrawer() {
    if (!shouldRenderLeadDetailModal || typeof document === "undefined") return null;
    const lead = selectedLeadId ? (getLeadById(selectedLeadId) ?? lastLeadDetailModalLeadRef.current) : lastLeadDetailModalLeadRef.current;
    if (!lead) return null;
    lastLeadDetailModalLeadRef.current = lead;
    const renderLead = leadDetailsById[lead.id] ?? lead;
    const leadFields = getLeadDynamicFields(renderLead);
    const displayName =
      buildLeadClientNameParts(leadFields, mergedFieldLayout).fullName ||
      lead.name || lead.email || lead.phone || "Untitled Lead";
    const isDetailLoading = detailLoadingLeadId === lead.id && !leadDetailsById[lead.id];
    const assignedUid = String(lead.assignedToUid || "").trim();
    const assignedMember = companyMembers.find((member) => member.uid === assignedUid) ?? null;
    const assignedLabel = String(lead.assignedToName || lead.assignedTo || assignedMember?.displayName || "").trim();
    const assignedColor = String(assignedMember?.badgeColor || assignedMember?.userColor || companyThemeColor).trim() || companyThemeColor;
    const assignedInitials = assignedLabel.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
    return createPortal(
      <div className="glass-modal-backdrop fixed inset-0 z-[230] flex items-center justify-center px-4 py-4" onClick={() => setSelectedLeadId("")}>
        <div
          ref={leadDetailModalPanelRef}
          onClick={(e) => e.stopPropagation()}
          className="glass-modal-panel relative flex flex-col overflow-hidden"
          style={{
            width: "min(560px, 96vw)",
            maxHeight: "min(720px, 90vh)",
          }}
        >
          <div className="glass-modal-header flex h-[56px] shrink-0 items-center justify-between px-5">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-[15px] font-bold" style={{ color: "var(--text-main)" }}>{displayName}</p>
              <span className="shrink-0 rounded-full px-2.5 py-[2px] text-[10px] font-bold" style={leadStatusPillStyle(lead.status || "New")}>
                {lead.status || "New"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedLeadId("")}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border hover:brightness-95"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
              aria-label="Close lead details"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 border-b px-5 py-3" style={{ borderColor: "var(--glass-border)" }}>
            {leadStatusOptions.map((option) => {
              const active = String(lead.status || "").trim().toLowerCase() === option.toLowerCase();
              return (
                <button
                  key={option}
                  type="button"
                  disabled={statusUpdatingLeadId === lead.id}
                  onClick={() => void onSelectLeadStatus(lead, option)}
                  className="rounded-full px-3 py-1 text-[11px] font-bold transition disabled:cursor-wait"
                  style={{ ...leadStatusPillStyle(option), opacity: active ? 1 : 0.55 }}
                >
                  {option}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 px-5 py-3">
            <button
              type="button"
              onClick={() => void handleCreateProjectFromLead(renderLead)}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-bold text-white hover:brightness-95"
              style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
            >
              Create Project
            </button>
            <button
              type="button"
              onClick={(e) => {
                setLeadImagesModalOrigin(captureGlassModalOrigin(e));
                setLeadImagesLeadId(lead.id);
                setLeadImagesDragActive(false);
              }}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-bold hover:brightness-95"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
            >
              <ImagePlus size={13} />
              Photos ({Array.isArray(renderLead.imageUrls) ? renderLead.imageUrls.length : 0})
            </button>
            <button
              type="button"
              onClick={(e) => {
                setAssignModalOrigin(captureGlassModalOrigin(e));
                openAssignLeadModal(renderLead);
              }}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-bold hover:brightness-95"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
            >
              {assignedLabel ? (
                <>
                  <span
                    className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                    style={{ backgroundColor: assignedColor }}
                  >
                    {assignedInitials || "U"}
                  </span>
                  <span className="max-w-[100px] truncate">{assignedLabel}</span>
                </>
              ) : (
                "Assign"
              )}
            </button>
            <button
              type="button"
              onClick={(e) => {
                setDeleteConfirmModalOrigin(captureGlassModalOrigin(e));
                setConfirmDeleteLeadId(lead.id);
              }}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-bold text-white hover:brightness-95"
              style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
            >
              Delete
            </button>
          </div>
          <div className="glass-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {isDetailLoading ? (
              <div className="mb-3 rounded-[12px] border px-3 py-2 text-[12px] font-semibold" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}>
                Loading lead details...
              </div>
            ) : null}
            {detailFields.length === 0 ? (
              <p className="text-[12px] font-semibold" style={{ color: "var(--text-muted)" }}>
                No detail fields configured yet.
              </p>
            ) : (
              <div className="space-y-2">
                {detailFields.map((column) => {
                  const value = resolveLeadColumnValue(leadFields, column, mergedFieldLayout);
                  return (
                    <div
                      key={`${lead.id}:detail:${column.key}`}
                      className="rounded-[12px] border px-3 py-2"
                      style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
                    >
                      <p className="text-[10px] font-extrabold uppercase tracking-[0.7px]" style={{ color: "var(--text-muted)" }}>
                        {column.label}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                        {value || "-"}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <>
        {!companyAccessResolved ? (
          <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}>
            Checking access...
          </div>
        ) : !canAccessLeads ? (
          <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}>
            You do not have permission to access Leads.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="glass-page-header relative -mx-4 -mt-3 px-4 pb-3 pt-5 md:-mx-5 md:-mt-4 md:px-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 flex-wrap items-center gap-5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Inbox size={16} style={{ color: "var(--text-main)" }} strokeWidth={2.1} />
                    <p className="truncate text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                      Leads
                    </p>
                    <span className="text-[14px] font-medium" style={{ color: "var(--text-muted)" }}>|</span>
                    <p className="truncate text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
                      {companyName || activeCompanyId || "Company"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 border-l pl-5" style={{ borderColor: "var(--glass-border)" }}>
                    <span className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--glass-bg)", color: "var(--text-muted)" }}>
                      {filteredLeads.length} total
                    </span>
                    <span className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--glass-bg)", color: "var(--text-muted)" }}>
                      {newCount} new
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={openLeadForm}
                    disabled={!leadFormUrl}
                    className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-4 text-[12px] font-bold text-white hover:brightness-95 disabled:opacity-55"
                    style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
                  >
                    <Plus size={14} />
                    Create Lead
                  </button>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-5">
                <div
                  className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-2.5"
                  style={{ width: 260, borderColor: "var(--glass-border)", backgroundColor: "var(--glass-bg)" }}
                >
                  <Search size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search leads..."
                    className="h-8 w-full bg-transparent text-[12px] outline-none"
                    style={{ color: "var(--text-main)" }}
                  />
                </div>
              </div>
              <div
                className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ gridTemplateRows: isToolbarExpanded ? "1fr" : "0fr" }}
                aria-hidden={!isToolbarExpanded}
              >
                <div className="overflow-hidden">
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={leadsViewMode === "grid"}
                      onClick={() => setLeadsViewMode((prev) => (prev === "board" ? "grid" : "board"))}
                      className="relative inline-flex h-[38px] w-[82px] shrink-0 items-center overflow-hidden rounded-full border p-1"
                      style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}
                      title="Toggle lead view"
                      aria-label="Toggle lead view"
                    >
                      <div
                        className="absolute top-1 h-7 w-9 rounded-full transition-all duration-200"
                        style={{ left: leadsViewMode === "board" ? 4 : 40, backgroundImage: "var(--brand-gradient)" }}
                      />
                      <span className="relative z-[1] flex h-7 w-9 items-center justify-center rounded-full">
                        <Kanban size={15} style={{ color: leadsViewMode === "board" ? "#fff" : "var(--text-muted)" }} />
                      </span>
                      <span className="relative z-[1] flex h-7 w-9 items-center justify-center rounded-full">
                        <LayoutGrid size={15} style={{ color: leadsViewMode === "grid" ? "#fff" : "var(--text-muted)" }} />
                      </span>
                    </button>
                    {leadsViewMode === "board" && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsBoardCardsCompact((prev) => !prev);
                          setCompactCardOverrides({});
                        }}
                        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-bold transition hover:brightness-95"
                        style={
                          isBoardCardsCompact
                            ? { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)", color: "#fff" }
                            : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }
                        }
                        title={isBoardCardsCompact ? "Show full cards" : "Collapse cards to names only"}
                        aria-label={isBoardCardsCompact ? "Show full cards" : "Collapse cards to names only"}
                      >
                        <Rows3 size={14} />
                        Compact
                      </button>
                    )}
                    {leadsViewMode === "grid" && (
                      <div className="flex flex-wrap items-center gap-2 border-l pl-3" style={{ borderColor: "var(--glass-border)" }}>
                        <button
                          type="button"
                          onClick={() => setStatusFilter("all")}
                          className="inline-flex h-8 items-center rounded-full border px-3.5 text-[11px] font-bold transition hover:brightness-95"
                          style={
                            statusFilter === "all"
                              ? { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)", color: "#fff" }
                              : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }
                          }
                        >
                          All Statuses
                        </button>
                        {leadStatusOptions.map((status) => {
                          const isActive = statusFilter === String(status).trim().toLowerCase();
                          return (
                            <button
                              key={status}
                              type="button"
                              onClick={() => setStatusFilter(String(status).trim().toLowerCase())}
                              className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-[11px] font-bold transition hover:brightness-95"
                              style={
                                isActive
                                  ? { ...leadStatusPillStyle(status), borderColor: "transparent", boxShadow: "0 0 0 1px var(--brand)" }
                                  : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }
                              }
                            >
                              {status}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {leadsViewMode === "grid" && (
                      <div className="border-l pl-3" style={{ borderColor: "var(--glass-border)" }}>
                        <select
                          value={listOrder}
                          onChange={(e) => setListOrder((e.target.value as "status" | "az" | "za" | "newest" | "oldest") || "newest")}
                          className="h-8 rounded-[8px] border pl-2.5 pr-2 text-[12px] outline-none"
                          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                        >
                          <option value="status">Sort: Status</option>
                          <option value="newest">Newest</option>
                          <option value="oldest">Oldest</option>
                          <option value="az">A &gt; Z</option>
                          <option value="za">Z &gt; A</option>
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsToolbarExpanded((prev) => !prev)}
                className="absolute bottom-0 left-1/2 flex h-6 w-6 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full border transition hover:brightness-95"
                style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: themeMode === "dark" ? "#aaaaaa" : "#475467" }}
                title={isToolbarExpanded ? "Collapse toolbar" : "Expand toolbar"}
                aria-label={isToolbarExpanded ? "Collapse toolbar" : "Expand toolbar"}
              >
                <ChevronUp
                  size={14}
                  className="transition-transform"
                  style={{ transform: isToolbarExpanded ? "rotate(0deg)" : "rotate(180deg)" }}
                />
              </button>
            </div>

            {isLoading ? (
              <div className="rounded-[14px] border px-4 py-8 text-[13px] font-semibold" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}>
                Loading leads...
              </div>
            ) : leadsViewMode === "grid" ? (
              filteredLeads.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed px-4 py-10 text-center" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
                  <Inbox size={22} style={{ color: "var(--text-muted)" }} />
                  <p className="text-[13px] font-semibold" style={{ color: "var(--text-muted)" }}>No leads yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filteredLeads.map((lead) => renderLeadCard(lead))}
                </div>
              )
            ) : searchFilteredLeads.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed px-4 py-10 text-center" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
                <Inbox size={22} style={{ color: "var(--text-muted)" }} />
                <p className="text-[13px] font-semibold" style={{ color: "var(--text-muted)" }}>No leads yet.</p>
              </div>
            ) : (
              <div
                ref={boardStickyRef}
                className="glass-scroll sticky top-0 flex h-[calc(100dvh-48px)] min-h-[280px] snap-x snap-mandatory items-stretch gap-2 -mx-2 -mt-2 px-2 pb-2 pt-2 sm:snap-none lg:top-[48px] lg:h-[calc(100dvh-48px)] lg:min-h-[320px]"
                style={{ overflowX: "auto", overflowY: "hidden" }}
              >
                {leadStatusBoardColumns.columns.map((column) => {
                  const isDragOver = dragOverStatusColumn === column.name;
                  const isCollapsed = Boolean(collapsedStatusColumns[column.name]);
                  const dragHandlers = {
                    onDragOver: (e: ReactDragEvent<HTMLElement>) => {
                      e.preventDefault();
                      if (dragOverStatusColumn !== column.name) setDragOverStatusColumn(column.name);
                    },
                    onDragLeave: (e: ReactDragEvent<HTMLElement>) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                      setDragOverStatusColumn((prev) => (prev === column.name ? "" : prev));
                    },
                    onDrop: (e: ReactDragEvent<HTMLElement>) => onLeadBoardColumnDrop(e, column.name),
                  };
                  const glassColumnBg = leadStatusHexToRgba(column.color, 0.85);
                  const glassColumnBorder = "rgba(255,255,255,0.3)";
                  const glassColumnSurface: React.CSSProperties = {
                    backgroundColor: glassColumnBg,
                    backdropFilter: "blur(20px) saturate(180%)",
                    WebkitBackdropFilter: "blur(20px) saturate(180%)",
                  };
                  const glassColumnShadow = isDragOver
                    ? "0 0 0 3px rgba(255,255,255,0.85), inset 0 1px 0 rgba(255,255,255,0.7)"
                    : "inset 0 1px 0 rgba(255,255,255,0.7), inset 0 30px 40px -32px rgba(255,255,255,0.35), var(--shadow-glass)";
                  const columnBadgeBg = themeMode === "dark" ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.55)";
                  const columnBadgeText = themeMode === "dark" ? "var(--text-main)" : "#000000";
                  if (isCollapsed) {
                    return (
                      // Shadow AND the scroll-reveal height live on this outer shell (not the button
                      // below) — the shadow always renders around whatever size the outer currently
                      // is, so setting the height here (rather than clip-path-ing the button) keeps
                      // it continuously in sync with the reveal instead of needing to be a separate
                      // unclipped layer.
                      <div
                        key={column.name}
                        {...dragHandlers}
                        data-board-column="true"
                        className="h-full w-[52px] shrink-0 snap-center sm:snap-align-none"
                        style={{ borderRadius: 16, boxShadow: glassColumnShadow }}
                      >
                        <button
                          type="button"
                          onClick={() => setCollapsedStatusColumns((prev) => ({ ...prev, [column.name]: false }))}
                          className="flex h-full w-full flex-col items-center gap-3 overflow-hidden rounded-[16px] border pb-3 pt-2.5 transition hover:brightness-105"
                          style={{
                            borderColor: glassColumnBorder,
                            ...glassColumnSurface,
                          }}
                          title={`Expand ${column.name}`}
                          aria-label={`Expand ${column.name}`}
                        >
                          <span
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                            style={{ color: columnBadgeText, backgroundColor: columnBadgeBg }}
                          >
                            <ChevronsLeftRight size={13} />
                          </span>
                          <span
                            className="inline-flex h-6 min-w-[24px] shrink-0 items-center justify-center rounded-full px-2 text-[10px] font-bold"
                            style={{ color: columnBadgeText, backgroundColor: columnBadgeBg }}
                          >
                            {column.leads.length}
                          </span>
                          <span
                            className="shrink-0 whitespace-nowrap text-[14px] font-normal"
                            style={{ writingMode: "vertical-rl", color: "#000000", letterSpacing: "0.12em" }}
                          >
                            {column.name}
                          </span>
                        </button>
                      </div>
                    );
                  }
                  return (
                    // See the collapsed-button case above for why the shadow and reveal height sit
                    // on this outer shell rather than on the column div below.
                    <div
                      key={column.name}
                      {...dragHandlers}
                      data-board-column="true"
                      className="h-full w-[85vw] max-w-[320px] shrink-0 snap-center sm:w-[300px] sm:max-w-none sm:snap-align-none"
                      style={{ borderRadius: 16, boxShadow: glassColumnShadow }}
                    >
                      <div
                        className="flex h-full w-full flex-col overflow-hidden rounded-[16px] border transition"
                        style={{
                          borderColor: glassColumnBorder,
                          ...glassColumnSurface,
                        }}
                      >
                        <div
                          className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5"
                          style={{ borderColor: "rgba(0,0,0,0.15)" }}
                        >
                          <p className="truncate text-[13px] font-semibold" style={{ color: "#000000" }}>{column.name}</p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span
                              className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-2 text-[10px] font-bold"
                              style={{ color: columnBadgeText, backgroundColor: columnBadgeBg }}
                            >
                              {column.leads.length}
                            </span>
                            <button
                              type="button"
                              onClick={() => setCollapsedStatusColumns((prev) => ({ ...prev, [column.name]: true }))}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full transition hover:brightness-95"
                              style={{ color: columnBadgeText, backgroundColor: columnBadgeBg }}
                              title={`Collapse ${column.name}`}
                              aria-label={`Collapse ${column.name}`}
                            >
                              <ChevronsRightLeft size={13} />
                            </button>
                          </div>
                        </div>
                        <div className="glass-scroll board-column-scroll flex-1 space-y-2.5 overflow-y-hidden p-2.5" style={{ scrollbarWidth: "none" }}>
                          {column.leads.length === 0 ? (
                            <p className="px-1 py-6 text-center text-[11px] font-semibold" style={{ color: "#000000" }}>
                              No leads.
                            </p>
                          ) : (
                            column.leads.map((lead) => renderLeadCard(lead, { draggable: true, accentColor: column.color, compact: isBoardCardsCompact }))
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {leadStatusBoardColumns.otherLeads.length > 0 && (
                  // See the column cases above for why the shadow and reveal height sit on this
                  // outer shell rather than on the column div below.
                  <div
                    data-board-column="true"
                    className="h-full w-[85vw] max-w-[320px] shrink-0 snap-center sm:w-[300px] sm:max-w-none sm:snap-align-none"
                    style={{ borderRadius: 16, boxShadow: "var(--shadow-glass)" }}
                  >
                    <div
                      className="flex h-full w-full flex-col overflow-hidden rounded-[16px] border"
                      style={{
                        borderColor: "var(--glass-border)",
                        backgroundColor: "var(--glass-bg-strong)",
                        backdropFilter: "blur(20px) saturate(180%)",
                        WebkitBackdropFilter: "blur(20px) saturate(180%)",
                      }}
                    >
                      <div
                        className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5"
                        style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
                      >
                        <p className="truncate text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>Other</p>
                        <span
                          className="shrink-0 rounded-full px-2 py-[1px] text-[10px] font-bold text-white"
                          style={{ backgroundColor: "var(--text-muted)" }}
                        >
                          {leadStatusBoardColumns.otherLeads.length}
                        </span>
                      </div>
                      <div className="glass-scroll board-column-scroll flex-1 space-y-2.5 overflow-y-hidden p-2.5" style={{ scrollbarWidth: "none" }}>
                        {leadStatusBoardColumns.otherLeads.map((lead) => renderLeadCard(lead, { compact: isBoardCardsCompact }))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {renderLeadDetailDrawer()}
        <DragGhostLayer controller={leadBoardDragGhost} />
        {shouldRenderAssignModal &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="glass-modal-backdrop fixed inset-0 z-[235] flex items-center justify-center px-2 py-2"
              style={{
                background: "rgba(15,23,42,0.14)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
              }}
              onClick={closeAssignLeadModal}
            >
              <div
                ref={assignModalPanelRef}
                className="glass-modal-panel relative flex flex-col overflow-hidden"
                style={{
                  width: "min(1000px, calc(100vw - 16px))",
                  height: "min(600px, calc(100vh - 16px))",
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="glass-modal-header flex h-[56px] items-center justify-between gap-3 px-5">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-[14px] font-bold" style={{ color: "var(--text-main)" }}>
                      Assign Lead
                    </p>
                    <span className="text-[14px] font-medium" style={{ color: "var(--text-muted)" }}>
                      |
                    </span>
                    <p className="truncate text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
                      {assignLeadName}
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <div
                      className="flex h-9 min-w-0 items-center gap-2 rounded-[10px] border px-3"
                      style={{ width: "min(340px, 40vw)", minWidth: 90, borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
                    >
                      <Search size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                      <input
                        value={assignSearch}
                        onChange={(event) => setAssignSearch(event.currentTarget.value)}
                        placeholder="Search staff..."
                        className="w-full bg-transparent text-[12px] font-semibold outline-none"
                        style={{ color: "var(--text-main)" }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={closeAssignLeadModal}
                      disabled={Boolean(assigningLeadId)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border hover:brightness-95"
                      style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                      aria-label="Close assign lead"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
                <div className="glass-scroll min-h-0 flex-1 overflow-y-auto">
                  {filteredCompanyMembers.length ? (
                    filteredCompanyMembers.map((member) => {
                      const memberColor = String(member.badgeColor || member.userColor || companyThemeColor).trim() || companyThemeColor;
                      const isSelected = assignSelectedUid === member.uid;
                      return (
                        <button
                          key={`lead_assign_member_${member.uid}`}
                          type="button"
                          onClick={() => setAssignSelectedUid(member.uid)}
                          className="grid w-full grid-cols-[44px_minmax(0,1fr)] items-center gap-3 border-t px-5 py-3 text-left transition hover:brightness-95"
                          style={{
                            borderColor: "var(--glass-border)",
                            backgroundColor: isSelected ? "var(--brand-soft)" : "transparent",
                          }}
                        >
                          <span
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white"
                            style={{ backgroundColor: memberColor }}
                          >
                            {String(member.displayName || member.email || member.uid)
                              .split(/\s+/)
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((part) => part[0]?.toUpperCase() || "")
                              .join("") || "U"}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-bold" style={{ color: "var(--text-main)" }}>
                              {member.displayName}
                            </span>
                            <span className="mt-1 block truncate text-[12px] font-semibold" style={{ color: "var(--text-muted)" }}>
                              {member.email || "-"}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-5 py-8 text-[13px] font-semibold" style={{ color: "var(--text-muted)" }}>
                      No staff found.
                    </div>
                  )}
                </div>
                <div className="flex items-center border-t px-[5px] pb-[5px] pt-[5px]" style={{ borderColor: "var(--glass-border)" }}>
                  <button
                    type="button"
                    onClick={() => void handleAssignLead()}
                    disabled={!selectedAssignedMember || assigningLeadId === assignLeadId}
                    className="flex h-11 w-full items-center justify-center whitespace-nowrap rounded-[10px] border px-4 text-[12px] font-bold text-white hover:brightness-95 disabled:cursor-not-allowed"
                    style={{
                      backgroundImage: "var(--brand-gradient)",
                      borderColor: "var(--brand-strong)",
                      opacity: !selectedAssignedMember || assigningLeadId === assignLeadId ? 0.55 : 1,
                    }}
                  >
                    {assigningLeadId === assignLeadId
                      ? "Assigning..."
                      : `Assign ${selectedAssignedMember?.displayName || "staff member"}`}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}
        {shouldRenderLeadImagesModal &&
          displayLeadImagesLead &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="glass-modal-backdrop fixed inset-0 z-[240] flex items-center justify-center px-2 py-2"
              style={{
                background: "rgba(15,23,42,0.14)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
              }}
              onClick={closeLeadImagesModal}
            >
              <div
                ref={leadImagesModalPanelRef}
                className="glass-modal-panel relative flex flex-col overflow-hidden"
                style={{
                  width: "min(1000px, calc(100vw - 16px))",
                  height: "min(600px, calc(100vh - 16px))",
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="glass-modal-header flex h-[56px] items-center justify-between gap-3 px-5">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-[14px] font-bold" style={{ color: "var(--text-main)" }}>
                      Lead Photos
                    </p>
                    <span className="text-[14px] font-medium" style={{ color: "var(--text-muted)" }}>
                      |
                    </span>
                    <p className="truncate text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
                      {buildLeadClientNameParts(getLeadDynamicFields(displayLeadImagesLead), mergedFieldLayout).fullName || displayLeadImagesLead.name || "Untitled Lead"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeLeadImagesModal}
                    disabled={leadImagesUploading}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border hover:brightness-95"
                    style={{ borderColor: "var(--glass-border)", color: "var(--text-main)" }}
                    aria-label="Close lead photos"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="glass-scroll overflow-y-auto px-5 py-5">
                  <button
                    type="button"
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setLeadImagesDragActive(true);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setLeadImagesDragActive(true);
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                      setLeadImagesDragActive(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setLeadImagesDragActive(false);
                      void handleUploadLeadImages(displayLeadImagesLead, event.dataTransfer.files);
                    }}
                    onClick={() => {
                      if (leadImagesUploading) return;
                      const input = document.getElementById(`lead-image-input-${displayLeadImagesLead.id}`) as HTMLInputElement | null;
                      input?.click();
                    }}
                    className="flex min-h-[132px] w-full flex-col items-center justify-center rounded-[16px] border border-dashed px-5 py-6 text-center transition-colors"
                    style={{
                      borderColor: leadImagesDragActive ? companyThemeColor : "var(--glass-border)",
                      backgroundColor: leadImagesDragActive ? `${companyThemeColor}12` : "var(--panel-muted)",
                      color: "var(--text-main)",
                    }}
                  >
                    <ImagePlus size={26} />
                    <p className="mt-3 text-[13px] font-bold">
                      {leadImagesUploading ? "Uploading images..." : "Drag and drop images here or click to upload"}
                    </p>
                    <p className="mt-1 text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
                      {`${leadImageItems.length}/10 uploaded`}
                    </p>
                    <input
                      id={`lead-image-input-${displayLeadImagesLead.id}`}
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: "none" }}
                      onChange={(event) => {
                        void handleUploadLeadImages(displayLeadImagesLead, event.currentTarget.files);
                        event.currentTarget.value = "";
                      }}
                    />
                  </button>
                  {!!leadImagesError && (
                    <p className="mt-3 text-[12px] font-semibold text-[#B42318]">{leadImagesError}</p>
                  )}
                  <div className="mt-5">
                    {leadImageItems.length > 0 ? (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                        {leadImageItems.map((image, idx) => (
                          <div
                            key={`${displayLeadImagesLead.id}:image:${idx}`}
                            className="group overflow-hidden rounded-[12px] border"
                            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
                          >
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => openLeadImagePreview(idx)}
                                className="block h-[118px] w-full cursor-zoom-in"
                                aria-label={`Open lead image ${idx + 1}`}
                              >
                                <img
                                  src={resolveLeadImageSrc(image.url)}
                                  alt={`Lead image ${idx + 1}`}
                                  className="h-full w-full object-cover"
                                  loading="eager"
                                  decoding="async"
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleRemoveLeadImage(displayLeadImagesLead, image.url)}
                                disabled={leadImagesUploading}
                                className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-55"
                                style={{ borderColor: "#7F1D1D", backgroundColor: "#DC2626" }}
                                aria-label="Remove lead image"
                              >
                                <X size={14} />
                              </button>
                            </div>
                            <div className="relative border-t px-2 pb-2 pt-2" style={{ borderColor: "var(--glass-border)" }}>
                              <input
                                type="text"
                                defaultValue={image.name}
                                placeholder={`Image ${idx + 1}`}
                                onClick={(event) => event.stopPropagation()}
                                onBlur={(event) => void handleRenameLeadImage(displayLeadImagesLead, image.url, event.currentTarget.value)}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter") return;
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }}
                                className="h-8 w-full rounded-[8px] border px-2 text-[11px] font-semibold outline-none"
                                style={{
                                  borderColor: "var(--glass-border)",
                                  backgroundColor: "var(--panel-muted)",
                                  color: "var(--text-main)",
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div
                        className="rounded-[14px] border px-4 py-8 text-center text-[12px] font-semibold"
                        style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
                      >
                        No images on this lead yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )}
        {leadImagesLead && activeLeadImagePreviewUrl ? (
          <FullscreenImageViewerShell
            open={Boolean(leadImagesLead && activeLeadImagePreviewUrl)}
            zIndex={260}
            titleLabel="LEAD PHOTOS"
            subjectName={leadImageClientName}
            imageName={activeLeadImagePreviewName || `Image ${leadImagePreviewIndex + 1}`}
            imageIndex={leadImagePreviewIndex}
            imageCount={leadImageUrls.length}
            commentsCollapsed={leadImageCommentsCollapsed}
            pinsVisible={leadImagePinsVisible}
            onToggleComments={toggleLeadImageComments}
            onPinsVisibleChange={(nextChecked) => {
              setLeadImagePinsVisible(nextChecked);
              if (!nextChecked) {
                closeLeadImageAnnotationOverlays();
              }
            }}
            onClose={() => openLeadImagePreview(-1)}
            commentsSection={
              activeLeadImageAnnotations.length > 0 ? (
                <div className="px-6 pb-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onMouseEnter={() => startLeadImageCommentsHoverScroll("left")}
                      onMouseLeave={stopLeadImageCommentsHoverScroll}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition hover:brightness-95"
                      style={{
                        borderColor: "var(--glass-border)",
                        backgroundColor: "var(--glass-bg-strong)",
                        backdropFilter: "blur(16px) saturate(180%)",
                        WebkitBackdropFilter: "blur(16px) saturate(180%)",
                        boxShadow: "var(--shadow-glass)",
                        animation: leadImageCommentsClosing
                          ? "glass-comment-drop-out 280ms ease both"
                          : "glass-comment-drop-in 480ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
                        animationDelay: leadImageCommentsClosing ? "0ms" : `${Math.round(Math.random() * 280)}ms`,
                      }}
                      aria-label="Scroll comments left"
                    >
                      <span
                        aria-hidden="true"
                        className="block"
                        style={{
                          width: 12,
                          height: 12,
                          backgroundColor: "var(--text-main)",
                          WebkitMaskImage: "url('/angle-left.png')",
                          WebkitMaskRepeat: "no-repeat",
                          WebkitMaskPosition: "center",
                          WebkitMaskSize: "contain",
                          maskImage: "url('/angle-left.png')",
                          maskRepeat: "no-repeat",
                          maskPosition: "center",
                          maskSize: "contain",
                        }}
                      />
                    </button>
                    <div
                      ref={leadImageCommentsScrollRef}
                      className="cutsmart-image-viewer-comments-strip flex min-w-0 flex-1 items-stretch gap-3 overflow-x-auto overflow-y-hidden px-4 pb-8 pt-3"
                      onMouseDown={startLeadImageCommentsDrag}
                      onMouseMove={moveLeadImageCommentsDrag}
                      onMouseUp={stopLeadImageCommentsDrag}
                      onMouseLeave={() => {
                        stopLeadImageCommentsDrag();
                        stopLeadImageCommentsHoverScroll();
                      }}
                      style={{ cursor: leadImageCommentsDragStateRef.current ? "grabbing" : "grab" }}
                    >
                      {activeLeadImageAnnotations.map((annotation, idx) => (
                        <div
                          key={`${annotation.id}:list`}
                          className="group/comment relative min-w-[240px] max-w-[min(480px,calc(100vw-120px))] shrink-0 self-stretch overflow-hidden rounded-[14px] border px-3 pb-2 pt-1.5"
                          data-lead-image-annotation-list-card="true"
                          onClick={() => {
                            if (leadImageCommentsSuppressClickRef.current) {
                              return;
                            }
                            setLeadImageDraftAnnotation(null);
                            setLeadImageActiveAnnotationId("");
                            setLeadImageListEditingAnnotation(null);
                            const owningCluster = findClusterContainingPin(leadImageAnnotationClusters, annotation.id);
                            if (owningCluster?.isCluster) {
                              setLeadImageExpandedClusterId(owningCluster.clusterId);
                              setLeadImagePoppingClusterId(owningCluster.clusterId);
                            }
                            setLeadImageHighlightedAnnotationId((current) =>
                              current === annotation.id ? "" : annotation.id,
                            );
                          }}
                          style={{
                            borderColor:
                              leadImageDeleteHoverAnnotationId === annotation.id
                                ? "var(--danger-strong)"
                                : leadImageHighlightedAnnotationId === annotation.id
                                  ? companyThemeColor
                                  : "var(--glass-border)",
                            backgroundColor: "var(--glass-bg)",
                            backgroundImage:
                              leadImageDeleteHoverAnnotationId === annotation.id
                                ? "linear-gradient(var(--danger-tint), var(--danger-tint))"
                                : leadImageHighlightedAnnotationId === annotation.id
                                  ? `linear-gradient(${companyThemeColor}1A, ${companyThemeColor}1A)`
                                  : undefined,
                            backdropFilter: "blur(16px) saturate(180%)",
                            WebkitBackdropFilter: "blur(16px) saturate(180%)",
                            boxShadow:
                              leadImageDeleteHoverAnnotationId === annotation.id
                                ? "0 0 0 2px var(--danger-ring), 0 4px 14px rgba(15, 23, 42, 0.16), 0 1px 2px rgba(15, 23, 42, 0.08)"
                                : leadImageHighlightedAnnotationId === annotation.id
                                  ? `0 0 0 2px ${companyThemeColor}40, 0 4px 14px rgba(15, 23, 42, 0.16), 0 1px 2px rgba(15, 23, 42, 0.08)`
                                  : "0 4px 14px rgba(15, 23, 42, 0.16), 0 1px 2px rgba(15, 23, 42, 0.08)",
                            transition: "background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease",
                            animation: leadImageCommentsClosing
                              ? "glass-comment-drop-out 280ms ease both"
                              : "glass-comment-drop-in 480ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
                            animationDelay: leadImageCommentsClosing ? "0ms" : `${Math.round(Math.random() * 280)}ms`,
                            width:
                              leadImageListEditingAnnotation?.id === annotation.id && leadImageListEditingAnnotation.width
                                ? `${leadImageListEditingAnnotation.width}px`
                                : undefined,
                          }}
                        >
                          <div className="flex h-full min-w-0 flex-1 flex-col text-left">
                            <div className="-mx-3 mb-0 flex items-center justify-between gap-3 border-b px-3 pb-1.5" style={{ borderColor: "var(--glass-border)", backgroundColor: "transparent" }}>
                              <div className="min-w-0 flex items-center gap-3">
                                <span
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold text-white"
                                  style={{
                                    backgroundColor: String(annotation.createdByColor || "").trim() || companyThemeColor,
                                    borderColor: "rgba(255,255,255,0.6)",
                                  }}
                                >
                                  {idx + 1}
                                </span>
                                <span className="min-w-0 truncate text-[13px] font-bold" style={{ color: "var(--text-main)" }}>
                                  {String(annotation.createdByName || "").trim() || `Comment ${idx + 1}`}
                                </span>
                              </div>
                              <div className="flex shrink-0 items-center gap-3">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (leadImageCommentsSuppressClickRef.current) {
                                      return;
                                    }
                                    if (leadImageListEditingAnnotation?.id === annotation.id) {
                                      void handleSaveEditedLeadImageListAnnotation();
                                      return;
                                    }
                                    setLeadImageDraftAnnotation(null);
                                    setLeadImageActiveAnnotationId("");
                                    setLeadImageHighlightedAnnotationId(annotation.id);
                                    const listCard = event.currentTarget.closest("[data-lead-image-annotation-list-card='true']");
                                    const measuredWidth =
                                      listCard instanceof HTMLElement ? Math.round(listCard.getBoundingClientRect().width) : undefined;
                                    setLeadImageListEditingAnnotation({
                                      id: annotation.id,
                                      note: annotation.note,
                                      width: measuredWidth,
                                    });
                                  }}
                                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border opacity-0 transition-opacity group-hover/comment:opacity-100"
                                  data-lead-image-comments-no-drag="true"
                                  style={{
                                    borderColor: leadImageListEditingAnnotation?.id === annotation.id ? "var(--success-strong)" : "var(--brand-strong)",
                                    backgroundImage: leadImageListEditingAnnotation?.id === annotation.id ? "var(--success-gradient)" : "var(--brand-gradient)",
                                    opacity: leadImageListEditingAnnotation?.id === annotation.id ? 1 : undefined,
                                  }}
                                  aria-label={leadImageListEditingAnnotation?.id === annotation.id ? "Save comment" : "Edit comment"}
                                >
                                  <span
                                    aria-hidden="true"
                                    className="block"
                                    style={{
                                      width: 14,
                                      height: 14,
                                      backgroundColor: "#ffffff",
                                      WebkitMaskImage:
                                        leadImageListEditingAnnotation?.id === annotation.id ? "url('/tick.png')" : "url('/edit.png')",
                                      WebkitMaskRepeat: "no-repeat",
                                      WebkitMaskPosition: "center",
                                      WebkitMaskSize: "contain",
                                      maskImage:
                                        leadImageListEditingAnnotation?.id === annotation.id ? "url('/tick.png')" : "url('/edit.png')",
                                      maskRepeat: "no-repeat",
                                      maskPosition: "center",
                                      maskSize: "contain",
                                    }}
                                  />
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (leadImageCommentsSuppressClickRef.current) {
                                      return;
                                    }
                                    if (confirmDeleteLeadImageAnnotationId !== annotation.id) {
                                      armDeleteLeadImageAnnotation(annotation.id);
                                      return;
                                    }
                                    if (leadImageDeleteConfirmTimeoutRef.current) {
                                      clearTimeout(leadImageDeleteConfirmTimeoutRef.current);
                                      leadImageDeleteConfirmTimeoutRef.current = null;
                                    }
                                    setConfirmDeleteLeadImageAnnotationId("");
                                    void handleDeleteLeadImageAnnotation(annotation.id);
                                  }}
                                  onMouseEnter={() => setLeadImageDeleteHoverAnnotationId(annotation.id)}
                                  onMouseLeave={() =>
                                    setLeadImageDeleteHoverAnnotationId((prev) => (prev === annotation.id ? "" : prev))
                                  }
                                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border opacity-0 transition-opacity group-hover/comment:opacity-100"
                                  data-lead-image-comments-no-drag="true"
                                  style={{
                                    borderColor: "var(--danger-strong)",
                                    backgroundImage: "var(--danger-gradient)",
                                    opacity: confirmDeleteLeadImageAnnotationId === annotation.id ? 1 : undefined,
                                  }}
                                  aria-label="Delete comment"
                                >
                                  <span
                                    aria-hidden="true"
                                    className="block"
                                    style={{
                                      width: 14,
                                      height: 14,
                                      backgroundColor: "#ffffff",
                                      WebkitMaskImage:
                                        confirmDeleteLeadImageAnnotationId === annotation.id ? "url('/tick.png')" : "url('/trash.png')",
                                      WebkitMaskRepeat: "no-repeat",
                                      WebkitMaskPosition: "center",
                                      WebkitMaskSize: "contain",
                                      maskImage:
                                        confirmDeleteLeadImageAnnotationId === annotation.id ? "url('/tick.png')" : "url('/trash.png')",
                                      maskRepeat: "no-repeat",
                                      maskPosition: "center",
                                      maskSize: "contain",
                                    }}
                                  />
                                </button>
                              </div>
                            </div>
                            <div className="relative min-w-0 flex-1 pt-1 pb-[5px]">
                              {leadImageListEditingAnnotation?.id === annotation.id ? (
                                <textarea
                                  ref={leadImageCommentEditTextareaRef}
                                  value={leadImageListEditingAnnotation.note}
                                  onClick={(event) => event.stopPropagation()}
                                  onMouseDown={(event) => event.stopPropagation()}
                                  onChange={(event) => {
                                    const nextValue = event.currentTarget.value;
                                    setLeadImageListEditingAnnotation((current) =>
                                      current ? { ...current, note: nextValue } : current,
                                    );
                                  }}
                                  onBlur={(event) => {
                                    const nextFocusTarget = event.relatedTarget;
                                    if (
                                      nextFocusTarget instanceof HTMLElement &&
                                      nextFocusTarget.closest("[data-lead-image-annotation-list-editor='true']")
                                    ) {
                                      return;
                                    }
                                    void handleSaveEditedLeadImageListAnnotation();
                                  }}
                                  rows={1}
                                  className="block w-full resize-none overflow-hidden bg-transparent px-0 py-0 text-[12px] font-semibold leading-[18px] outline-none"
                                  style={{ borderColor: "transparent", color: "var(--text-main)", backgroundColor: "transparent" }}
                                />
                              ) : (
                                <span
                                  ref={(node) => updateLeadImageAnnotationOverflow(annotation.id, node)}
                                  className="block w-full whitespace-pre-wrap text-left text-[12px] font-semibold leading-[18px]"
                                  style={{
                                    color: "var(--text-main)",
                                    maxHeight: leadImageExpandedAnnotationIds[annotation.id] ? "none" : "72px",
                                    overflow: leadImageExpandedAnnotationIds[annotation.id] ? "visible" : "hidden",
                                  }}
                                >
                                  {annotation.note}
                                </span>
                              )}
                              {(leadImageOverflowAnnotationIds[annotation.id] || leadImageExpandedAnnotationIds[annotation.id]) &&
                              leadImageListEditingAnnotation?.id !== annotation.id ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setLeadImageExpandedAnnotationIds((current) => ({
                                      ...current,
                                      [annotation.id]: !current[annotation.id],
                                    }));
                                  }}
                                  className="absolute bottom-[10px] right-0 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold opacity-0 transition-opacity group-hover/comment:opacity-100"
                                  data-lead-image-comments-no-drag="true"
                                  style={{
                                    color: "var(--text-main)",
                                    borderColor: "var(--glass-border)",
                                    backgroundColor: "var(--panel-bg)",
                                    boxShadow: "0 2px 6px rgba(15,23,42,0.08)",
                                  }}
                                >
                                  {leadImageExpandedAnnotationIds[annotation.id] ? "less" : "more"}
                                  <span
                                    aria-hidden="true"
                                    className="block"
                                    style={{
                                      width: 10,
                                      height: 10,
                                      backgroundColor: "var(--text-main)",
                                      transform: leadImageExpandedAnnotationIds[annotation.id] ? "rotate(180deg)" : "rotate(0deg)",
                                      WebkitMaskImage: "url('/angle-down.png')",
                                      WebkitMaskRepeat: "no-repeat",
                                      WebkitMaskPosition: "center",
                                      WebkitMaskSize: "contain",
                                      maskImage: "url('/angle-down.png')",
                                      maskRepeat: "no-repeat",
                                      maskPosition: "center",
                                      maskSize: "contain",
                                    }}
                                  />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onMouseEnter={() => startLeadImageCommentsHoverScroll("right")}
                      onMouseLeave={stopLeadImageCommentsHoverScroll}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition hover:brightness-95"
                      style={{
                        borderColor: "var(--glass-border)",
                        backgroundColor: "var(--glass-bg-strong)",
                        backdropFilter: "blur(16px) saturate(180%)",
                        WebkitBackdropFilter: "blur(16px) saturate(180%)",
                        boxShadow: "var(--shadow-glass)",
                        animation: leadImageCommentsClosing
                          ? "glass-comment-drop-out 280ms ease both"
                          : "glass-comment-drop-in 480ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
                        animationDelay: leadImageCommentsClosing ? "0ms" : `${Math.round(Math.random() * 280)}ms`,
                      }}
                      aria-label="Scroll comments right"
                    >
                      <span
                        aria-hidden="true"
                        className="block"
                        style={{
                          width: 12,
                          height: 12,
                          backgroundColor: "var(--text-main)",
                          WebkitMaskImage: "url('/angle-right.png')",
                          WebkitMaskRepeat: "no-repeat",
                          WebkitMaskPosition: "center",
                          WebkitMaskSize: "contain",
                          maskImage: "url('/angle-right.png')",
                          maskRepeat: "no-repeat",
                          maskPosition: "center",
                          maskSize: "contain",
                        }}
                      />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="px-6 pb-4 pt-3">
                  <p className="text-[12px] font-semibold" style={{ color: "var(--text-muted)" }}>
                    No comments on this image yet.
                  </p>
                </div>
              )
            }
            stageSection={
              <>
                <style jsx global>{`
                  @keyframes cutsmart-lead-pin-bounce {
                    0% { margin-top: 0; }
                    8% { margin-top: -5px; }
                    14% { margin-top: 0; }
                    18% { margin-top: -2px; }
                    22%, 100% { margin-top: 0; }
                  }
                `}</style>
                <div
                  className="relative flex min-h-0 flex-1 items-center justify-center overflow-visible px-6 py-4"
                  ref={leadImageStageRef}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.target === event.currentTarget && (leadImageActiveAnnotationId || leadImageDraftAnnotation)) {
                      closeLeadImageAnnotationOverlays();
                    }
                  }}
                  onWheel={handleLeadImagePreviewWheel}
                  onMouseMove={handleLeadImagePreviewDrag}
                  onMouseUp={stopLeadImagePreviewDrag}
                  onMouseLeave={stopLeadImagePreviewDrag}
                >
                  {leadImageUrls.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        openLeadImagePreview(
                          leadImagePreviewIndex <= 0 ? leadImageUrls.length - 1 : leadImagePreviewIndex - 1,
                        )
                      }
                      className="glass-nav-arrow absolute left-6 top-1/2 z-[3] inline-flex h-16 w-16 -translate-y-1/2 items-center justify-center rounded-full transition hover:brightness-95"
                      aria-label="Previous image"
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none block"
                        style={{
                          width: 34,
                          height: 34,
                          transform: "translateX(-3px)",
                          backgroundColor: "#334155",
                          WebkitMaskImage: "url('/angle-left.png')",
                          WebkitMaskRepeat: "no-repeat",
                          WebkitMaskPosition: "center",
                          WebkitMaskSize: "contain",
                          maskImage: "url('/angle-left.png')",
                          maskRepeat: "no-repeat",
                          maskPosition: "center",
                          maskSize: "contain",
                        }}
                      />
                    </button>
                  ) : null}
                  <div
                    className="relative inline-flex items-center justify-center"
                    onMouseDown={startLeadImagePreviewDrag}
                    style={{
                      width: leadImageSizeReady ? `${fittedLeadImageSize.width}px` : "1px",
                      height: leadImageSizeReady ? `${fittedLeadImageSize.height}px` : "1px",
                      transform: `translate(${leadImagePreviewOffset.x}px, ${leadImagePreviewOffset.y}px) scale(${leadImagePreviewScale})`,
                      opacity: leadImageSizeReady ? 1 : 0,
                      // No transition while actively panning or wheel-zooming — each state update is
                      // already a discrete step, and layering a 120ms ease on top of rapid successive
                      // wheel ticks makes zoom feel laggy since every tick restarts the animation before
                      // the last one finishes. A short ease is only useful for non-continuous jumps.
                      transition: leadImagePreviewDragging || leadImageIsZooming ? "none" : "transform 80ms ease",
                    }}
                  >
                    <img
                      ref={leadImageElementRef}
                      src={resolveLeadImageSrc(activeLeadImagePreviewUrl)}
                      alt={`Lead preview ${leadImagePreviewIndex + 1}`}
                      className="block h-full w-full object-contain select-none"
                      loading="eager"
                      decoding="async"
                      onClick={handleLeadImageClickForAnnotation}
                      draggable={false}
                      style={{
                        cursor:
                          leadImagePreviewDragging
                            ? "grabbing"
                            : leadImageActiveAnnotationId || leadImageDraftAnnotation
                              ? "pointer"
                              : "crosshair",
                      }}
                    />
                    {leadImagePinsVisible ? activeLeadImageAnnotations.map((annotation, idx) =>
                      leadImageActiveAnnotationId === annotation.id ? (
                        <div
                          key={`${annotation.id}:note`}
                          data-lead-image-annotation-editor="true"
                          className="absolute z-[4] min-w-[240px] max-w-[min(480px,calc(100vw-48px))] rounded-[12px] border px-3 py-2 text-left"
                          style={{
                            ...getLeadAnnotationPopupStyle(annotation),
                            borderColor: "#D7DEE8",
                            backgroundColor: "#ffffff",
                            boxShadow: "0 14px 28px rgba(15,23,42,0.12)",
                            transform: `${getLeadAnnotationPopupStyle(annotation).transform} scale(${leadImageAnnotationUiScale})`,
                            width:
                              leadImageEditingAnnotation?.id === annotation.id && leadImageEditingAnnotation.width
                                ? `${leadImageEditingAnnotation.width}px`
                                : undefined,
                            height:
                              leadImageEditingAnnotation?.id === annotation.id && leadImageEditingAnnotation.height
                                ? `${leadImageEditingAnnotation.height}px`
                                : undefined,
                            visibility: "hidden",
                            pointerEvents: "none",
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[10px] font-extrabold uppercase tracking-[0.7px]" style={{ color: "#64748B" }}>
                              {String(annotation.createdByName || "").trim() || `Comment ${idx + 1}`}
                            </p>
                            <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(event) => {
                                if (leadImageEditingAnnotation?.id === annotation.id) {
                                  void handleSaveEditedLeadImageAnnotation();
                                  return;
                                }
                                const popup = event.currentTarget.closest("[data-lead-image-annotation-editor='true']");
                                const measuredWidth =
                                  popup instanceof HTMLElement ? Math.round(popup.getBoundingClientRect().width) : undefined;
                                const measuredHeight =
                                  popup instanceof HTMLElement ? Math.round(popup.getBoundingClientRect().height) : undefined;
                                setLeadImageEditingAnnotation({
                                  id: annotation.id,
                                  note: annotation.note,
                                  width: measuredWidth,
                                  height: measuredHeight,
                                });
                              }}
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border"
                              style={{
                                borderColor: leadImageEditingAnnotation?.id === annotation.id ? "#15803D" : "#D7DEE8",
                                  backgroundColor: leadImageEditingAnnotation?.id === annotation.id ? "#15803D" : "#ffffff",
                                }}
                                aria-label={leadImageEditingAnnotation?.id === annotation.id ? "Save note" : "Edit note"}
                              >
                                <span
                                  aria-hidden="true"
                                  className="block"
                                  style={{
                                    width: 13,
                                    height: 13,
                                    backgroundColor: leadImageEditingAnnotation?.id === annotation.id ? "#ffffff" : "#64748B",
                                    WebkitMaskImage:
                                      leadImageEditingAnnotation?.id === annotation.id ? "url('/tick.png')" : "url('/edit.png')",
                                    WebkitMaskRepeat: "no-repeat",
                                    WebkitMaskPosition: "center",
                                    WebkitMaskSize: "contain",
                                    maskImage:
                                      leadImageEditingAnnotation?.id === annotation.id ? "url('/tick.png')" : "url('/edit.png')",
                                    maskRepeat: "no-repeat",
                                    maskPosition: "center",
                                    maskSize: "contain",
                                  }}
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirmDeleteLeadImageAnnotationId !== annotation.id) {
                                    armDeleteLeadImageAnnotation(annotation.id);
                                    return;
                                  }
                                  if (leadImageDeleteConfirmTimeoutRef.current) {
                                    clearTimeout(leadImageDeleteConfirmTimeoutRef.current);
                                    leadImageDeleteConfirmTimeoutRef.current = null;
                                  }
                                  setConfirmDeleteLeadImageAnnotationId("");
                                  void handleDeleteLeadImageAnnotation(annotation.id);
                                }}
                                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border"
                                style={{
                                  borderColor: confirmDeleteLeadImageAnnotationId === annotation.id ? "#991B1B" : "#F1B7BC",
                                  backgroundColor: confirmDeleteLeadImageAnnotationId === annotation.id ? "#991B1B" : "#FFF5F6",
                                }}
                                aria-label="Delete note"
                              >
                                <span
                                  aria-hidden="true"
                                  className="block"
                                  style={{
                                    width: 13,
                                    height: 13,
                                    backgroundColor: confirmDeleteLeadImageAnnotationId === annotation.id ? "#ffffff" : "#991B1B",
                                    WebkitMaskImage:
                                      confirmDeleteLeadImageAnnotationId === annotation.id ? "url('/tick.png')" : "url('/trash.png')",
                                    WebkitMaskRepeat: "no-repeat",
                                    WebkitMaskPosition: "center",
                                    WebkitMaskSize: "contain",
                                    maskImage:
                                      confirmDeleteLeadImageAnnotationId === annotation.id ? "url('/tick.png')" : "url('/trash.png')",
                                    maskRepeat: "no-repeat",
                                    maskPosition: "center",
                                    maskSize: "contain",
                                  }}
                                />
                              </button>
                            </div>
                          </div>
                          {leadImageEditingAnnotation?.id === annotation.id ? (
                            <textarea
                              value={leadImageEditingAnnotation.note}
                              onWheel={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                const nextValue = event.currentTarget.value;
                                setLeadImageEditingAnnotation((current) =>
                                  current ? { ...current, note: nextValue } : current,
                                );
                              }}
                              onBlur={(event) => {
                                const nextFocusTarget = event.relatedTarget;
                                if (
                                  nextFocusTarget instanceof HTMLElement &&
                                  nextFocusTarget.closest("[data-lead-image-annotation-editor='true']")
                                ) {
                                  return;
                                }
                                void handleSaveEditedLeadImageAnnotation();
                              }}
                              className="mt-2 w-full rounded-[10px] border px-3 py-2 text-[12px] font-semibold outline-none"
                              style={{
                                minHeight:
                                  leadImageEditingAnnotation?.id === annotation.id && leadImageEditingAnnotation.height
                                    ? `${Math.max(48, leadImageEditingAnnotation.height - 44)}px`
                                    : "80px",
                                height:
                                  leadImageEditingAnnotation?.id === annotation.id && leadImageEditingAnnotation.height
                                    ? `${Math.max(48, leadImageEditingAnnotation.height - 44)}px`
                                    : undefined,
                                borderColor: "#D7DEE8",
                                color: "#334155",
                                backgroundColor: "#ffffff",
                              }}
                            />
                          ) : (
                            <p className="mt-2 whitespace-pre-wrap text-[12px] font-semibold" style={{ color: "#334155" }}>
                              {annotation.note}
                            </p>
                          )}
                        </div>
                      ) : null,
                    ) : null}
                    {leadImageDraftAnnotation ? (
                      <div
                        className="absolute z-[5] w-[min(420px,calc(100vw-48px))] rounded-[12px] border px-3 py-3 text-left"
                        style={{
                          ...getLeadAnnotationPopupStyle(leadImageDraftAnnotation),
                          borderColor: "#D7DEE8",
                          backgroundColor: "#ffffff",
                          boxShadow: "0 14px 28px rgba(15,23,42,0.12)",
                          transform: `${getLeadAnnotationPopupStyle(leadImageDraftAnnotation).transform} scale(${leadImageAnnotationUiScale})`,
                          visibility: "hidden",
                          pointerEvents: "none",
                        }}
                    >
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.7px]" style={{ color: "#64748B" }}>
                          Add Note
                        </p>
                      <textarea
                        value={leadImageDraftAnnotation.note}
                        onWheel={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          const nextValue = event.currentTarget.value;
                          setLeadImageDraftAnnotation((current) =>
                              current ? { ...current, note: nextValue } : current,
                            );
                          }}
                          placeholder="Add note for this point..."
                          className="mt-2 min-h-[80px] w-full rounded-[10px] border px-3 py-2 text-[12px] font-semibold outline-none"
                          style={{ borderColor: "#D7DEE8", color: "#334155", backgroundColor: "#ffffff" }}
                        />
                        <div className="mt-3 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setLeadImageDraftAnnotation(null)}
                            className="inline-flex h-8 items-center justify-center rounded-[8px] border px-3 text-[11px] font-bold"
                            style={{ borderColor: "#D7DEE8", color: "#64748B", backgroundColor: "#ffffff" }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSaveLeadImageAnnotation()}
                            className="inline-flex h-8 items-center justify-center rounded-[8px] border px-3 text-[11px] font-bold text-white"
                            style={{ borderColor: companyThemeColor, backgroundColor: companyThemeColor }}
                          >
                            Save Note
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {leadImagePinsVisible ? (
                    <div
                      className="pointer-events-none absolute z-[1]"
                      style={{
                        left: "50%",
                        top: "50%",
                        width: leadImageSizeReady ? `${fittedLeadImageSize.width}px` : "1px",
                        height: leadImageSizeReady ? `${fittedLeadImageSize.height}px` : "1px",
                        transform: `translate(calc(-50% + ${leadImagePreviewOffset.x}px), calc(-50% + ${leadImagePreviewOffset.y}px)) scale(${leadImagePreviewScale})`,
                        transformOrigin: "center center",
                        transition: leadImagePreviewDragging || leadImageIsZooming ? "none" : "transform 80ms ease",
                        opacity: leadImageSizeReady ? 1 : 0,
                      }}
                    >
                      {leadImageAnnotationClusters.map((cluster) => {
                        if (!cluster.isCluster || cluster.clusterId === leadImageExpandedClusterId) return null;
                        return (
                          <button
                            key={`${cluster.clusterId}:cluster-pin`}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setLeadImageDraftAnnotation(null);
                              setLeadImageActiveAnnotationId("");
                              setLeadImageHighlightedAnnotationId("");
                              setLeadImageEditingAnnotation(null);
                              setLeadImageExpandedClusterId(cluster.clusterId);
                              setLeadImagePoppingClusterId(cluster.clusterId);
                            }}
                            className="pointer-events-auto absolute inline-flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[11px] font-bold text-white"
                            style={{
                              left: `${cluster.centroidXPct}%`,
                              top: `${cluster.centroidYPct}%`,
                              borderWidth: 2,
                              borderColor: "rgba(255,255,255,0.75)",
                              backgroundColor: companyThemeColor,
                              boxShadow:
                                "inset 0 1px 1.5px rgba(255,255,255,0.6), 0 4px 14px rgba(15,23,42,0.3), 0 0 0 1px rgba(255,255,255,0.12)",
                              transform: `translate(-50%, -50%) scale(${leadImageAnnotationUiScale})`,
                              cursor: "pointer",
                            }}
                          >
                            <span
                              className="absolute -right-1 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full border px-1 text-[9px] font-bold"
                              style={{
                                color: companyThemeColor,
                                backgroundColor: "rgba(255,255,255,0.92)",
                                borderColor: "rgba(255,255,255,0.6)",
                                backdropFilter: "blur(4px)",
                                WebkitBackdropFilter: "blur(4px)",
                                boxShadow: "0 1px 3px rgba(15,23,42,0.25)",
                              }}
                            >
                              {cluster.members.length}
                            </span>
                          </button>
                        );
                      })}
                      {activeLeadImageAnnotations.map((annotation, idx) => {
                        const containingCluster = findClusterContainingPin(leadImageAnnotationClusters, annotation.id);
                        if (containingCluster?.isCluster && containingCluster.clusterId !== leadImageExpandedClusterId) return null;
                        const isDragging = leadImageDraggingAnnotation?.id === annotation.id;
                        // Only trust the dragging position once real pointer movement has occurred — otherwise a
                        // spread pin would visually snap from its spread slot to its real (overlapping) position
                        // the instant mousedown fires, moving it out from under the cursor before mouseup/click.
                        const hasDragMoved = leadImageAnnotationDragStateRef.current?.moved === true;
                        const spread =
                          !(leadImageDraggingAnnotation?.id === annotation.id && hasDragMoved)
                            ? leadImageSpreadPositionsById[annotation.id]
                            : undefined;
                        // While a cluster is mid "pop out" (the first paint right after expanding), render its
                        // members at the merged pin's own centroid so the very next render can transition them
                        // out to their spread slots — producing the bubble-out-and-settle animation.
                        const isPopping = Boolean(spread) && containingCluster?.clusterId === leadImagePoppingClusterId;
                        const positionSource = leadImageDraggingAnnotation?.id === annotation.id && hasDragMoved
                          ? leadImageDraggingAnnotation
                          : isPopping && containingCluster
                            ? { ...annotation, x: containingCluster.centroidXPct, y: containingCluster.centroidYPct, xPx: undefined, yPx: undefined }
                            : spread
                              ? { ...annotation, x: spread.xPct, y: spread.yPct, xPx: undefined, yPx: undefined }
                              : annotation;
                        return (
                          <button
                            key={`${annotation.id}:overlay-pin`}
                            type="button"
                            data-lead-cluster-pin-group={containingCluster ? "true" : undefined}
                            onMouseDown={(event) => startLeadImageAnnotationDrag(event, annotation)}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (leadImageSuppressPinClickRef.current) {
                                leadImageSuppressPinClickRef.current = false;
                                return;
                              }
                              setLeadImageDraftAnnotation(null);
                              setLeadImageHighlightedAnnotationId("");
                              setLeadImageEditingAnnotation(null);
                              setLeadImagePinPopupOrigin(captureGlassModalOrigin(event));
                              setLeadImageActiveAnnotationId((current) => (current === annotation.id ? "" : annotation.id));
                            }}
                            className="pointer-events-auto absolute inline-flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[11px] font-bold text-white"
                            style={{
                              ...getLeadAnnotationRenderPoint(positionSource),
                              borderWidth: 2,
                              borderColor: "rgba(255,255,255,0.75)",
                              backgroundColor: String(annotation.createdByColor || "").trim() || companyThemeColor,
                              boxShadow:
                                "inset 0 1px 1.5px rgba(255,255,255,0.6), 0 4px 14px rgba(15,23,42,0.3), 0 0 0 1px rgba(255,255,255,0.12)",
                              transform: `translate(-50%, -50%) scale(${leadImageAnnotationUiScale})`,
                              transition:
                                !isDragging && spread
                                  ? "left 420ms cubic-bezier(0.34, 1.56, 0.64, 1), top 420ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 240ms ease"
                                  : "none",
                              opacity: isPopping
                                ? 0
                                : (leadImageActiveAnnotationId || leadImageHighlightedAnnotationId) &&
                                    leadImageActiveAnnotationId !== annotation.id &&
                                    leadImageHighlightedAnnotationId !== annotation.id
                                  ? 0.25
                                  : 1,
                              cursor: isDragging ? "grabbing" : "grab",
                              animation:
                                leadImageHighlightedAnnotationId === annotation.id
                                  ? "cutsmart-lead-pin-bounce 2s ease-in-out infinite"
                                  : "none",
                            }}
                          >
                            {idx + 1}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {leadImagePinsVisible ? (
                    <div className="pointer-events-none absolute inset-0 z-[10]">
                      {activeLeadImageAnnotations.map((annotation, idx) => {
                        const isActiveNow = leadImageActiveAnnotationId === annotation.id;
                        const isClosingThis =
                          !leadImageActiveAnnotationId &&
                          leadImagePinPopupShouldRender &&
                          leadImageLastActiveAnnotationIdRef.current === annotation.id;
                        if (!isActiveNow && !isClosingThis) return null;
                        return (
                          <div
                            key={`${annotation.id}:screen-note`}
                            data-lead-image-annotation-editor="true"
                            data-lead-cluster-pin-group={
                              findClusterContainingPin(leadImageAnnotationClusters, annotation.id)?.isCluster ? "true" : undefined
                            }
                            className="absolute flex min-w-[240px] max-w-[min(480px,calc(100vw-48px))] flex-col rounded-[12px] border px-3 py-2 text-left"
                            ref={(node) => {
                              leadImagePinPopupPanelRef.current = node;
                              if (!node) return;
                              const width = Math.round(node.getBoundingClientRect().width);
                              const height = Math.max(112, Math.round(node.getBoundingClientRect().height));
                              setLeadImageActiveAnnotationBoxSize((current) =>
                                current?.id === annotation.id && current.width === width && current.height === height
                                  ? current
                                  : { id: annotation.id, width, height },
                              );
                            }}
                            style={{
                              ...getLeadAnnotationPopupScreenStyle(annotation, {
                                width:
                                  leadImageEditingAnnotation?.id === annotation.id && leadImageEditingAnnotation.width
                                    ? leadImageEditingAnnotation.width
                                    : leadImageActiveAnnotationBoxSize?.id === annotation.id && leadImageActiveAnnotationBoxSize.width
                                      ? leadImageActiveAnnotationBoxSize.width
                                    : 320,
                                height:
                                  leadImageEditingAnnotation?.id === annotation.id && leadImageEditingAnnotation.height
                                      ? Math.max(112, leadImageEditingAnnotation.height)
                                    : leadImageActiveAnnotationBoxSize?.id === annotation.id && leadImageActiveAnnotationBoxSize.height
                                      ? leadImageActiveAnnotationBoxSize.height
                                    : 112,
                              }),
                              borderColor: leadImageDeleteHoverAnnotationId === annotation.id ? "var(--danger-strong)" : "var(--glass-border)",
                              backgroundColor: "var(--glass-modal-bg)",
                              backgroundImage:
                                leadImageDeleteHoverAnnotationId === annotation.id
                                  ? "linear-gradient(var(--danger-tint), var(--danger-tint))"
                                  : undefined,
                              backdropFilter: "blur(12px) saturate(220%)",
                              WebkitBackdropFilter: "blur(12px) saturate(220%)",
                              boxShadow:
                                leadImageDeleteHoverAnnotationId === annotation.id
                                  ? "0 0 0 2px var(--danger-ring), var(--shadow-glass)"
                                  : "var(--shadow-glass)",
                              transition: "background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease",
                              overflowY: "auto",
                              pointerEvents: isActiveNow ? "auto" : "none",
                              width:
                                leadImageEditingAnnotation?.id === annotation.id && leadImageEditingAnnotation.width
                                  ? `${leadImageEditingAnnotation.width}px`
                                  : undefined,
                              height:
                                leadImageEditingAnnotation?.id === annotation.id && leadImageEditingAnnotation.height
                                  ? `${Math.max(112, leadImageEditingAnnotation.height)}px`
                                  : undefined,
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            onWheel={(event) => event.stopPropagation()}
                          >
                            <div className="flex shrink-0 items-start justify-between gap-2">
                              <p className="text-[10px] font-extrabold uppercase tracking-[0.7px]" style={{ color: "var(--text-main)" }}>
                                {String(annotation.createdByName || "").trim() || `Comment ${idx + 1}`}
                              </p>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    if (leadImageEditingAnnotation?.id === annotation.id) {
                                      void handleSaveEditedLeadImageAnnotation();
                                      return;
                                    }
                                    const popup = event.currentTarget.closest("[data-lead-image-annotation-editor='true']");
                                    const measuredWidth =
                                      popup instanceof HTMLElement ? Math.round(popup.getBoundingClientRect().width) : undefined;
                                    const measuredHeight =
                                      popup instanceof HTMLElement ? Math.max(112, Math.round(popup.getBoundingClientRect().height)) : undefined;
                                    setLeadImageEditingAnnotation({
                                      id: annotation.id,
                                      note: annotation.note,
                                      width: measuredWidth,
                                      height: measuredHeight,
                                    });
                                  }}
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border"
                                  style={{
                                    borderColor: leadImageEditingAnnotation?.id === annotation.id ? "var(--success-strong)" : "var(--brand-strong)",
                                    backgroundImage: leadImageEditingAnnotation?.id === annotation.id ? "var(--success-gradient)" : "var(--brand-gradient)",
                                  }}
                                  aria-label={leadImageEditingAnnotation?.id === annotation.id ? "Save note" : "Edit note"}
                                >
                                  <span
                                    aria-hidden="true"
                                    className="block"
                                    style={{
                                      width: 13,
                                      height: 13,
                                      backgroundColor: "#ffffff",
                                      WebkitMaskImage:
                                        leadImageEditingAnnotation?.id === annotation.id ? "url('/tick.png')" : "url('/edit.png')",
                                      WebkitMaskRepeat: "no-repeat",
                                      WebkitMaskPosition: "center",
                                      WebkitMaskSize: "contain",
                                      maskImage:
                                        leadImageEditingAnnotation?.id === annotation.id ? "url('/tick.png')" : "url('/edit.png')",
                                      maskRepeat: "no-repeat",
                                      maskPosition: "center",
                                      maskSize: "contain",
                                    }}
                                  />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (confirmDeleteLeadImageAnnotationId !== annotation.id) {
                                      armDeleteLeadImageAnnotation(annotation.id);
                                      return;
                                    }
                                    if (leadImageDeleteConfirmTimeoutRef.current) {
                                      clearTimeout(leadImageDeleteConfirmTimeoutRef.current);
                                      leadImageDeleteConfirmTimeoutRef.current = null;
                                    }
                                    setConfirmDeleteLeadImageAnnotationId("");
                                    void handleDeleteLeadImageAnnotation(annotation.id);
                                  }}
                                  onMouseEnter={() => setLeadImageDeleteHoverAnnotationId(annotation.id)}
                                  onMouseLeave={() =>
                                    setLeadImageDeleteHoverAnnotationId((prev) => (prev === annotation.id ? "" : prev))
                                  }
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border"
                                  style={{
                                    borderColor: "var(--danger-strong)",
                                    backgroundImage: "var(--danger-gradient)",
                                  }}
                                  aria-label="Delete note"
                                >
                                  <span
                                    aria-hidden="true"
                                    className="block"
                                    style={{
                                      width: 13,
                                      height: 13,
                                      backgroundColor: "#ffffff",
                                      WebkitMaskImage:
                                        confirmDeleteLeadImageAnnotationId === annotation.id ? "url('/tick.png')" : "url('/trash.png')",
                                      WebkitMaskRepeat: "no-repeat",
                                      WebkitMaskPosition: "center",
                                      WebkitMaskSize: "contain",
                                      maskImage:
                                        confirmDeleteLeadImageAnnotationId === annotation.id ? "url('/tick.png')" : "url('/trash.png')",
                                      maskRepeat: "no-repeat",
                                      maskPosition: "center",
                                      maskSize: "contain",
                                    }}
                                  />
                                </button>
                              </div>
                            </div>
                            {leadImageEditingAnnotation?.id === annotation.id ? (
                              <textarea
                                value={leadImageEditingAnnotation.note}
                                onWheel={(event) => event.stopPropagation()}
                                onChange={(event) => {
                                  const nextValue = event.currentTarget.value;
                                  setLeadImageEditingAnnotation((current) =>
                                    current ? { ...current, note: nextValue } : current,
                                  );
                                }}
                                onBlur={(event) => {
                                  const nextFocusTarget = event.relatedTarget;
                                  if (
                                    nextFocusTarget instanceof HTMLElement &&
                                    nextFocusTarget.closest("[data-lead-image-annotation-editor='true']")
                                  ) {
                                    return;
                                  }
                                  void handleSaveEditedLeadImageAnnotation();
                                }}
                                className="mt-2 block w-full flex-1 resize-none rounded-[10px] border px-3 py-2 text-[12px] font-semibold outline-none"
                                style={{
                                  minHeight: 0,
                                  height: "auto",
                                  borderColor: "var(--glass-border)",
                                  color: "var(--text-main)",
                                  backgroundColor: "var(--panel-bg)",
                                  boxSizing: "border-box",
                                }}
                              />
                            ) : (
                              <p className="mt-2 whitespace-pre-wrap text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                                {annotation.note}
                              </p>
                            )}
                          </div>
                        );
                      })}
                        {leadImageDraftAnnotation ? (
                          <div
                            className="pointer-events-auto absolute w-[min(420px,calc(100vw-48px))] rounded-[12px] border px-3 py-3 text-left"
                            ref={(node) => {
                              if (!node) return;
                              const width = Math.round(node.getBoundingClientRect().width);
                              const height = Math.max(112, Math.round(node.getBoundingClientRect().height));
                              setLeadImageDraftAnnotationBoxSize((current) =>
                                current && current.width === width && current.height === height
                                  ? current
                                  : { width, height },
                              );
                            }}
                            style={{
                              ...getLeadAnnotationPopupScreenStyle(leadImageDraftAnnotation, {
                                width: leadImageDraftAnnotationBoxSize?.width || 420,
                                height: leadImageDraftAnnotationBoxSize?.height || 150,
                              }),
                              borderColor: "var(--glass-border)",
                              backgroundColor: "var(--glass-modal-bg)",
                              backdropFilter: "blur(12px) saturate(220%)",
                              WebkitBackdropFilter: "blur(12px) saturate(220%)",
                              boxShadow: "var(--shadow-glass)",
                              overflowY: "auto",
                            }}
                          onClick={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                          onWheel={(event) => event.stopPropagation()}
                        >
                          <p className="text-[10px] font-extrabold uppercase tracking-[0.7px]" style={{ color: "var(--text-main)" }}>
                            Add Note
                          </p>
                          <textarea
                            value={leadImageDraftAnnotation.note}
                            onWheel={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              const nextValue = event.currentTarget.value;
                              setLeadImageDraftAnnotation((current) =>
                                current ? { ...current, note: nextValue } : current,
                              );
                            }}
                            placeholder="Add note for this point..."
                            className="mt-2 min-h-[80px] w-full rounded-[10px] border px-3 py-2 text-[12px] font-semibold outline-none"
                            style={{ borderColor: "var(--glass-border)", color: "var(--text-main)", backgroundColor: "var(--panel-bg)" }}
                          />
                          <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setLeadImageDraftAnnotation(null)}
                              className="inline-flex h-8 items-center justify-center rounded-[8px] border px-3 text-[11px] font-bold"
                              style={{ borderColor: "var(--glass-border)", color: "var(--text-muted)", backgroundColor: "var(--panel-bg)" }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSaveLeadImageAnnotation()}
                              className="inline-flex h-8 items-center justify-center rounded-[8px] border px-3 text-[11px] font-bold text-white"
                              style={{ borderColor: "var(--brand-strong)", backgroundImage: "var(--brand-gradient)" }}
                            >
                              Save Note
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {leadImageUrls.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        openLeadImagePreview(
                          leadImagePreviewIndex >= leadImageUrls.length - 1 ? 0 : leadImagePreviewIndex + 1,
                        )
                      }
                      className="glass-nav-arrow absolute right-6 top-1/2 z-[3] inline-flex h-16 w-16 -translate-y-1/2 items-center justify-center rounded-full transition hover:brightness-95"
                      aria-label="Next image"
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none block"
                        style={{
                          width: 34,
                          height: 34,
                          transform: "translateX(3px)",
                          backgroundColor: "#334155",
                          WebkitMaskImage: "url('/angle-right.png')",
                          WebkitMaskRepeat: "no-repeat",
                          WebkitMaskPosition: "center",
                          WebkitMaskSize: "contain",
                          maskImage: "url('/angle-right.png')",
                          maskRepeat: "no-repeat",
                          maskPosition: "center",
                          maskSize: "contain",
                        }}
                      />
                    </button>
                  ) : null}
                </div>
              </>
            }
            thumbnailsCollapsed={leadImageThumbnailsCollapsed}
            onCollapseThumbnails={() => setLeadImageThumbnailsCollapsed(true)}
            onExpandThumbnails={() => setLeadImageThumbnailsCollapsed(false)}
            thumbnailStrip={
              <div className="flex justify-center">
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {leadImageUrls.map((url, idx) => (
                    <button
                      key={`${leadImagesLead.id}:preview-thumb:${idx}`}
                      type="button"
                      onClick={() => openLeadImagePreview(idx)}
                      className="shrink-0 overflow-hidden rounded-[10px] border"
                      style={{
                        width: 102,
                        height: 78,
                        borderColor: idx === leadImagePreviewIndex ? companyThemeColor : "#D7DEE8",
                        boxShadow: idx === leadImagePreviewIndex ? `0 0 0 2px ${companyThemeColor}22` : "none",
                      }}
                    >
                      <img src={resolveLeadImageSrc(url)} alt={`Lead thumbnail ${idx + 1}`} className="h-full w-full object-cover" loading="eager" decoding="async" />
                    </button>
                  ))}
                </div>
              </div>
            }
            showPrevNext={leadImageUrls.length > 1}
          />
        ) : null}
        {shouldRenderDeleteConfirmModal && typeof document !== "undefined" && createPortal(
          <div className="fixed inset-0 z-[245] flex items-center justify-center px-4">
            <button
              type="button"
              aria-label="Close delete lead dialog backdrop"
              onClick={() => setConfirmDeleteLeadId("")}
              className="glass-modal-backdrop absolute inset-0"
            />
            <div ref={deleteConfirmModalPanelRef} className="glass-modal-panel relative w-full max-w-[420px] overflow-hidden">
              <div className="glass-modal-header px-5 py-4">
                <h3 className="text-[15px] font-bold" style={{ color: "var(--text-main)" }}>Delete this lead?</h3>
              </div>
              <div className="px-5 py-4">
                <p className="text-[13px]" style={{ color: "var(--text-main)" }}>
                  This archives the lead — it can be restored later, but it will disappear from this list.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteLeadId("")}
                    className="inline-flex h-9 items-center justify-center rounded-[10px] border px-4 text-[12px] font-bold hover:brightness-95"
                    style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={deletingLeadId === confirmDeleteLeadId}
                    onClick={() => {
                      const lead = getLeadById(confirmDeleteLeadId);
                      if (lead) void handleDeleteLead(lead);
                    }}
                    className="inline-flex h-9 items-center justify-center rounded-[10px] border px-4 text-[12px] font-bold text-white hover:brightness-95 disabled:opacity-55"
                    style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                  >
                    {deletingLeadId === confirmDeleteLeadId ? "Deleting..." : "Confirm Delete"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
