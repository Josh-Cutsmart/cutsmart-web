"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, ImagePlus, Inbox, Plus, Search, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { FullscreenImageViewerShell } from "@/components/fullscreen-image-viewer-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyAccess, fetchPrimaryMembership } from "@/lib/membership";
import { fetchCompanyDoc, fetchCompanyMembers, fetchUserColorMapByUids, type CompanyLeadRow, type CompanyMemberOption } from "@/lib/firestore-data";
import { storage } from "@/lib/firebase";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";
import {
  LEAD_PROJECT_CREATED_EVENT,
  OPEN_NEW_PROJECT_EVENT,
  type NewProjectPrefillPayload,
} from "@/lib/new-project-bridge";

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const SAMPLE_LEADS_STORAGE_KEY_PREFIX = "cutsmart_sample_leads:";
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

function measureStatusPillWidth(options: string[]) {
  const labels = options.map((option) => String(option || "").trim()).filter(Boolean);
  if (!labels.length) return 60;
  if (typeof document === "undefined") {
    const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
    return Math.max(60, Math.ceil(longest * 6.6 + 10));
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
    return Math.max(60, Math.ceil(longest * 6.6 + 10));
  }
  context.font = '700 11px "Segoe UI", Arial, sans-serif';
  const widest = labels.reduce((max, label) => Math.max(max, context.measureText(label).width), 0);
  return Math.max(60, Math.ceil(widest + 10));
}

function sampleLeadsStorageKey(companyId: string) {
  return `${SAMPLE_LEADS_STORAGE_KEY_PREFIX}${String(companyId || "").trim()}`;
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
    if (score > bestScore) {
      bestField = field;
      bestScore = score;
  }
}

function measureStatusPillWidth(options: string[]) {
  const labels = options.map((option) => String(option || "").trim()).filter(Boolean);
  if (!labels.length) return 60;
  if (typeof document === "undefined") {
    const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
    return Math.max(60, Math.ceil(longest * 6.6 + 10));
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
    return Math.max(60, Math.ceil(longest * 6.6 + 10));
  }
  context.font = '700 11px "Segoe UI", Arial, sans-serif';
  const widest = labels.reduce((max, label) => Math.max(max, context.measureText(label).width), 0);
  return Math.max(60, Math.ceil(widest + 10));
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
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [companyAccessResolved, setCompanyAccessResolved] = useState(false);
  const [canAccessLeads, setCanAccessLeads] = useState(false);
  const [canViewOtherLeads, setCanViewOtherLeads] = useState(false);
  const [activeCompanyId, setActiveCompanyId] = useState("");
  const [leads, setLeads] = useState<CompanyLeadRow[]>([]);
  const [leadDetailsById, setLeadDetailsById] = useState<Record<string, CompanyLeadRow>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [listOrder, setListOrder] = useState<"status" | "az" | "za" | "newest" | "oldest">("newest");
  const [isLoading, setIsLoading] = useState(true);
  const [companyName, setCompanyName] = useState("");
  const [companyThemeColor, setCompanyThemeColor] = useState("#2F6BFF");
  const [leadStatusRows, setLeadStatusRows] = useState<StatusRow[]>(normalizeLeadStatuses(undefined));
  const [fieldLayout, setFieldLayout] = useState<LeadFieldLayoutRow[]>([]);
  const [openLeadId, setOpenLeadId] = useState("");
  const [detailLoadingLeadId, setDetailLoadingLeadId] = useState("");
  const [confirmDeleteLeadId, setConfirmDeleteLeadId] = useState("");
  const [deletingLeadId, setDeletingLeadId] = useState("");
  const [statusMenuLeadId, setStatusMenuLeadId] = useState("");
  const [statusMenuPos, setStatusMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [statusFilterMenuOpen, setStatusFilterMenuOpen] = useState(false);
  const [statusFilterMenuPos, setStatusFilterMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [statusUpdatingLeadId, setStatusUpdatingLeadId] = useState("");
  const [leadFormUrl, setLeadFormUrl] = useState("");
  const [hoveredLeadId, setHoveredLeadId] = useState("");
  const [companyMembers, setCompanyMembers] = useState<CompanyMemberOption[]>([]);
  const [assignLeadId, setAssignLeadId] = useState("");
  const [assignSearch, setAssignSearch] = useState("");
  const [assignSelectedUid, setAssignSelectedUid] = useState("");
  const [assigningLeadId, setAssigningLeadId] = useState("");
  const [leadImagesLeadId, setLeadImagesLeadId] = useState("");
  const [leadImagesUploading, setLeadImagesUploading] = useState(false);
  const [leadImagesDragActive, setLeadImagesDragActive] = useState(false);
  const [leadImagePreviewIndex, setLeadImagePreviewIndex] = useState(-1);
  const [leadImagePreviewScale, setLeadImagePreviewScale] = useState(1);
  const [leadImagePreviewOffset, setLeadImagePreviewOffset] = useState({ x: 0, y: 0 });
  const [leadImagePreviewDragging, setLeadImagePreviewDragging] = useState(false);
  const [leadImagePinsVisible, setLeadImagePinsVisible] = useState(true);
  const [leadImageCommentsCollapsed, setLeadImageCommentsCollapsed] = useState(true);
  const [leadImageThumbnailsCollapsed, setLeadImageThumbnailsCollapsed] = useState(false);
  const [leadImageDraftAnnotation, setLeadImageDraftAnnotation] = useState<{ x: number; y: number; xPx: number; yPx: number; note: string } | null>(null);
  const [leadImageActiveAnnotationId, setLeadImageActiveAnnotationId] = useState("");
  const [leadImageHighlightedAnnotationId, setLeadImageHighlightedAnnotationId] = useState("");
  const [leadImageEditingAnnotation, setLeadImageEditingAnnotation] = useState<{ id: string; note: string; width?: number; height?: number } | null>(null);
  const [leadImageListEditingAnnotation, setLeadImageListEditingAnnotation] = useState<{ id: string; note: string; width?: number } | null>(null);
  const [leadImageActiveAnnotationBoxSize, setLeadImageActiveAnnotationBoxSize] = useState<{ id: string; width: number; height: number } | null>(null);
  const [leadImageDraftAnnotationBoxSize, setLeadImageDraftAnnotationBoxSize] = useState<{ width: number; height: number } | null>(null);
  const [confirmDeleteLeadImageAnnotationId, setConfirmDeleteLeadImageAnnotationId] = useState("");
  const [leadImageExpandedAnnotationIds, setLeadImageExpandedAnnotationIds] = useState<Record<string, boolean>>({});
  const [leadImageOverflowAnnotationIds, setLeadImageOverflowAnnotationIds] = useState<Record<string, boolean>>({});
  const [leadImageNaturalSize, setLeadImageNaturalSize] = useState({ width: 0, height: 0 });
  const [leadImageStageSize, setLeadImageStageSize] = useState({ width: 0, height: 0 });
  const [currentUserPinColor, setCurrentUserPinColor] = useState("");
  const [leadImageCachedSrcMap, setLeadImageCachedSrcMap] = useState<Record<string, string>>({});
  const deleteConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const leadImageSuppressPinClickRef = useRef(false);
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

  const isDarkMode = themeMode === "dark";
  const palette = isDarkMode
    ? {
        pageBg: "#0f0f0f",
        panelBg: "#212121",
        panelMuted: "#272727",
        border: "#3f3f46",
        text: "#f1f1f1",
        textSoft: "#d1d5db",
        textMuted: "#aaaaaa",
        inputBg: "#303134",
        inputText: "#f1f1f1",
        rowHover: "#2a2a2a",
        shadow: "0 10px 30px rgba(0,0,0,0.38)",
      }
    : {
        pageBg: "#ffffff",
        panelBg: "#ffffff",
        panelMuted: "#F8FAFC",
        border: "#D7DEE8",
        text: "#1A1D23",
        textSoft: "#334155",
        textMuted: "#8A97A8",
        inputBg: "#ffffff",
        inputText: "#334155",
        rowHover: "#EEF4FF",
        shadow: "0 10px 24px rgba(15,23,42,0.09),0 2px 6px rgba(15,23,42,0.05)",
      };

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
      if (deleteConfirmTimeoutRef.current) {
        clearTimeout(deleteConfirmTimeoutRef.current);
      }
      if (leadImageDeleteConfirmTimeoutRef.current) {
        clearTimeout(leadImageDeleteConfirmTimeoutRef.current);
      }
      if (leadImageAnnotationDragRafRef.current !== null) {
        cancelAnimationFrame(leadImageAnnotationDragRafRef.current);
      }
    };
  }, []);

  const loadLeads = useCallback(async (companyId: string) => {
    const cid = String(companyId || "").trim();
    if (!cid) {
      setLeads([]);
      return;
    }
    const currentSampleLeads =
      sampleLeadsRef.current[cid] ??
      (sampleLeadsRef.current[cid] = readPersistedSampleLeads(cid) ?? buildTemporarySampleLeads(cid));
    persistSampleLeads(cid, currentSampleLeads);
    try {
      const response = await fetch(`/api/leads?companyId=${encodeURIComponent(cid)}&mode=summary`, {
        method: "GET",
        cache: "no-store",
      });
        const detail = (await response.json().catch(() => null)) as
          | { ok?: boolean; leads?: CompanyLeadRow[] }
          | null;
        const fetchedLeads = response.ok && Array.isArray(detail?.leads) ? detail.leads.filter((lead) => !lead.isDeleted) : [];
      const visibleLeads = canViewOtherLeads
        ? fetchedLeads
        : fetchedLeads.filter((lead) => String(lead.assignedToUid || "").trim() === currentUserUid);
      const visibleSampleLeads = canViewOtherLeads
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
      const visibleSampleLeads = canViewOtherLeads
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
      if (!user?.uid) {
        setCompanyAccessResolved(true);
        setCanAccessLeads(false);
        setCanViewOtherLeads(false);
        setIsLoading(false);
        return;
      }
      const storedCompanyId =
        typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() : "";
      const directCompanyId = String(user.companyId || "").trim();
      const fallbackMembership = !directCompanyId ? await fetchPrimaryMembership(user.uid) : null;
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
        setIsLoading(false);
        return;
      }
      const [access, companyDoc, userColorMap] = await Promise.all([
        fetchCompanyAccess(companyId, user.uid),
        fetchCompanyDoc(companyId),
        fetchUserColorMapByUids([user.uid], companyId),
      ]);
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
        setIsLoading(false);
        return;
      }
      await loadLeads(companyId);
      setIsLoading(false);
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

  const loadLeadDetail = useCallback(
    async (leadId: string) => {
      const id = String(leadId || "").trim();
      if (!id || !activeCompanyId) return null;
      if (leadDetailsById[id]) return leadDetailsById[id];
      const summaryLead = leads.find((lead) => String(lead.id || "").trim() === id) ?? null;
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
    [activeCompanyId, canViewOtherLeads, currentUserUid, leadDetailsById, leads],
  );

  useEffect(() => {
    if (!companyAccessResolved || !canAccessLeads || !activeCompanyId) return;
    const intervalId = window.setInterval(() => {
      void loadLeads(activeCompanyId);
    }, 4000);
    return () => window.clearInterval(intervalId);
  }, [activeCompanyId, canAccessLeads, companyAccessResolved, loadLeads]);

  useEffect(() => {
    if (!openLeadId) return;
    void loadLeadDetail(openLeadId);
  }, [loadLeadDetail, openLeadId]);

  useEffect(() => {
    if (!leadImagesLeadId) return;
    void loadLeadDetail(leadImagesLeadId);
  }, [leadImagesLeadId, loadLeadDetail]);

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
        return leadLabel(a).localeCompare(leadLabel(b));
      });
    }
    return sorted;
  }, [leads, listOrder, search, statusFilter]);

  const newCount = filteredLeads.filter((lead) => String(lead.status || "").trim().toLowerCase() === "new").length;
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
    return columns;
  }, [leads]);
  const mergedFieldLayout = useMemo(
    () => mergeLeadFieldLayout(availableFields, fieldLayout),
    [availableFields, fieldLayout],
  );
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
  const leadStatusPillWidth = useMemo(() => {
    return measureStatusPillWidth(leadStatusOptions);
  }, [leadStatusOptions]);
  const statusFilterPillWidth = useMemo(() => {
    return measureStatusPillWidth(["All Statuses", ...leadStatusOptions]);
  }, [leadStatusOptions]);

  const leadStatusPillStyle = (statusLabel: string) => {
    const configured = leadStatusColorByName.get(String(statusLabel || "").trim().toLowerCase());
    if (configured) {
      return { backgroundColor: configured, color: "#FFFFFF" };
    }
    return statusPillColors(statusLabel);
  };
  const currentStatusFilterLabel = statusFilter === "all"
    ? "All Statuses"
    : leadStatusOptions.find((status) => String(status).trim().toLowerCase() === statusFilter) || "All Statuses";
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
    setLeadImageDraftAnnotation(null);
    setLeadImageActiveAnnotationId("");
    setLeadImageHighlightedAnnotationId("");
    setLeadImageEditingAnnotation(null);
    setLeadImageListEditingAnnotation(null);
    setLeadImageActiveAnnotationBoxSize(null);
    setLeadImageDraftAnnotationBoxSize(null);
    setLeadImageCommentsCollapsed(true);
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
    [loadLeads, syncLeadImagesInState],
  );

  const armLeadDelete = (leadId: string) => {
    setConfirmDeleteLeadId(leadId);
    if (deleteConfirmTimeoutRef.current) {
      clearTimeout(deleteConfirmTimeoutRef.current);
    }
    deleteConfirmTimeoutRef.current = setTimeout(() => {
      setConfirmDeleteLeadId((current) => (current === leadId ? "" : current));
    }, 10000);
  };

  const handleDeleteLead = async (lead: CompanyLeadRow) => {
    const leadId = String(lead.id || "").trim();
    if (!leadId || deletingLeadId) return;
    if (confirmDeleteLeadId !== leadId) {
      armLeadDelete(leadId);
      return;
    }
    if (deleteConfirmTimeoutRef.current) {
      clearTimeout(deleteConfirmTimeoutRef.current);
      deleteConfirmTimeoutRef.current = null;
    }
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
      setOpenLeadId((current) => (current === leadId ? "" : current));
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
  const previewGridTemplate = useMemo(() => {
    const parts = ["40px", `${leadStatusPillWidth}px`];
    for (const _ of rowFields) parts.push("minmax(150px,1fr)");
    parts.push("152px");
    parts.push("minmax(190px,220px)");
    return parts.join(" ");
  }, [leadStatusPillWidth, rowFields]);

  const onSelectLeadStatus = async (lead: CompanyLeadRow, nextStatus: string) => {
    if (!nextStatus || statusUpdatingLeadId) return;
    if (isTemporarySampleLead(lead)) {
      sampleLeadsRef.current[lead.companyId] = (sampleLeadsRef.current[lead.companyId] || []).map((row) =>
        row.id === lead.id ? { ...row, status: nextStatus, updatedAtIso: new Date().toISOString() } : row,
      );
      persistSampleLeads(lead.companyId, sampleLeadsRef.current[lead.companyId]);
      setLeads((prev) => prev.map((row) => (row.id === lead.id ? { ...row, status: nextStatus, updatedAtIso: new Date().toISOString() } : row)));
      setStatusMenuLeadId("");
      setStatusMenuPos(null);
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
      setStatusMenuLeadId("");
      setStatusMenuPos(null);
      void loadLeads(lead.companyId);
    }
    setStatusUpdatingLeadId("");
  };

  const statusMenuLead = useMemo(() => leads.find((lead) => lead.id === statusMenuLeadId) ?? null, [leads, statusMenuLeadId]);

  useEffect(() => {
    if (!statusMenuLeadId) return;
    const closeMenu = () => {
      setStatusMenuLeadId("");
      setStatusMenuPos(null);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-lead-status-menu='true']")) return;
      if (target.closest("[data-lead-status-trigger='true']")) return;
      closeMenu();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [statusMenuLeadId]);

  useEffect(() => {
    if (!statusFilterMenuOpen) return;
    const closeMenu = () => {
      setStatusFilterMenuOpen(false);
      setStatusFilterMenuPos(null);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-status-filter-menu='true']")) return;
      if (target.closest("[data-status-filter-trigger='true']")) return;
      closeMenu();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [statusFilterMenuOpen]);

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
      if (!id || !cid) return;
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
      setOpenLeadId((current) => (current === id ? "" : current));
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
    [getLeadById, loadLeads],
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
    if (!openLeadId) return;
    if (!leads.some((lead) => String(lead.id || "").trim() === openLeadId)) {
      setOpenLeadId("");
    }
  }, [leads, openLeadId]);

  useEffect(() => {
    if (!assignLeadId) return;
    if (!leads.some((lead) => String(lead.id || "").trim() === assignLeadId)) {
      closeAssignLeadModal();
    }
  }, [assignLeadId, closeAssignLeadModal, leads]);

  const handleAssignLead = async () => {
    if (!assignLead || !assignSelectedUid || assigningLeadId) return;
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
    setLeadImagePreviewIndex(-1);
    setLeadImagePreviewScale(1);
    setLeadImagePreviewOffset({ x: 0, y: 0 });
    setLeadImagePreviewDragging(false);
    setLeadImageDraftAnnotation(null);
    setLeadImageActiveAnnotationId("");
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
        const uploaded = await Promise.all(
          selected.map(async (file, idx) => {
            try {
              const ext = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
              const path = `companies/${lead.companyId}/leads/${lead.id}/images/${Date.now()}_${idx + 1}.${ext}`;
              const ref = storageRef(storageClient, path);
              await uploadBytes(ref, file, { contentType: file.type || "image/jpeg" });
              return await getDownloadURL(ref);
            } catch {
              return "";
            }
          }),
        );
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
    setLeadImageEditingAnnotation(null);
    setLeadImageListEditingAnnotation(null);
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

  const handleLeadImagePreviewWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -0.12 : 0.12;
    setLeadImagePreviewScale((current) => {
      const next = Math.min(5, Math.max(1, Number((current + direction).toFixed(2))));
      if (next === 1) {
        setLeadImagePreviewOffset({ x: 0, y: 0 });
      }
      return next;
    });
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
    setLeadImagePreviewOffset({
      x: drag.originX + deltaX,
      y: drag.originY + deltaY,
    });
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
    const imageDrag = leadImageDragStateRef.current;
    if (imageDrag?.moved) {
      leadImageSuppressImageClickRef.current = true;
      window.setTimeout(() => {
        leadImageSuppressImageClickRef.current = false;
      }, 0);
    }
    setLeadImagePreviewDragging(false);
    leadImageDragStateRef.current = null;
  };

  const openLeadImagePreview = useCallback((nextIndex: number) => {
    setLeadImageNaturalSize({ width: 0, height: 0 });
    setLeadImagePreviewOffset({ x: 0, y: 0 });
    setLeadImagePreviewScale(1);
    setLeadImagePreviewDragging(false);
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

  return (
    <ProtectedRoute>
      <AppShell>
        {!companyAccessResolved ? (
          <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: palette.border, backgroundColor: palette.panelBg, color: palette.textSoft, boxShadow: palette.shadow }}>
            Checking access...
          </div>
        ) : !canAccessLeads ? (
          <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: palette.border, backgroundColor: palette.panelBg, color: palette.textSoft, boxShadow: palette.shadow }}>
            You do not have permission to access Leads.
          </div>
        ) : (
          <div className="space-y-4" style={{ color: palette.text }}>
            <section className="-mx-4 -mb-4 -mt-4 pb-4 pt-0 md:-mx-5" style={{ backgroundColor: palette.pageBg }}>
              <div className="flex h-[56px] flex-wrap items-center justify-between gap-2 border-b px-4 md:px-5" style={{ borderColor: palette.border, backgroundColor: palette.panelBg }}>
                <div className="flex min-w-0 items-center gap-2">
                  <Inbox size={16} color="#12345B" strokeWidth={2.1} />
                  <p className="truncate text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "#12345B" }}>
                    Leads
                  </p>
                  <span className="text-[14px] font-medium" style={{ color: "#6B7280" }}>
                    |
                  </span>
                  <p className="truncate text-[14px] font-medium" style={{ color: "#334155" }}>
                    {companyName || activeCompanyId || "Company"}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: palette.textSoft }}>
                  <button
                    type="button"
                    onClick={openLeadForm}
                    disabled={!leadFormUrl}
                    className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-bold"
                    style={{
                      borderColor: "#C8DAFF",
                      backgroundColor: "#EAF1FF",
                      color: "#24589A",
                      opacity: leadFormUrl ? 1 : 0.55,
                    }}
                  >
                    <Plus size={14} />
                    Create Lead
                  </button>
                  <button
                    type="button"
                    data-status-filter-trigger="true"
                    onClick={(e) => {
                      if (statusFilterMenuOpen) {
                        setStatusFilterMenuOpen(false);
                        setStatusFilterMenuPos(null);
                        return;
                      }
                      const trigger = e.currentTarget as HTMLButtonElement;
                      const rect = trigger.getBoundingClientRect();
                      const menuWidth = rect.width;
                      const estimatedMenuHeight = Math.max(92, (leadStatusOptions.length + 1) * 34);
                      const hasRoomBelow = rect.bottom + estimatedMenuHeight <= window.innerHeight - 8;
                      const hasRoomAbove = rect.top - estimatedMenuHeight >= 8;
                      const shouldOpenUp = !hasRoomBelow && hasRoomAbove;
                      const clampedLeft = Math.min(Math.max(8, rect.left), window.innerWidth - menuWidth - 8);
                      setStatusFilterMenuPos({
                        left: clampedLeft,
                        top: shouldOpenUp ? Math.max(8, rect.top - estimatedMenuHeight - 4) : rect.bottom + 4,
                        width: menuWidth,
                      });
                      setStatusFilterMenuOpen(true);
                    }}
                    className="inline-flex h-9 items-center justify-center rounded-[10px] border px-[5px] outline-none"
                    style={{
                      width: statusFilterPillWidth + 10,
                      borderColor: palette.border,
                      backgroundColor: palette.panelMuted,
                    }}
                    aria-label="Filter by status"
                  >
                    <span
                      className="inline-flex h-7 items-center justify-center rounded-[10px] px-[5px] text-[11px] font-bold whitespace-nowrap"
                      style={{
                        width: statusFilterPillWidth,
                        ...(statusFilter === "all"
                          ? { backgroundColor: palette.panelBg, color: palette.textSoft, border: `1px solid ${palette.border}` }
                          : leadStatusPillStyle(currentStatusFilterLabel)),
                      }}
                    >
                      {currentStatusFilterLabel}
                    </span>
                  </button>
                  <select
                    value={listOrder}
                    onChange={(e) => setListOrder((e.target.value as "status" | "az" | "za" | "newest" | "oldest") || "status")}
                    className="h-9 rounded-[10px] border px-3 text-[12px] outline-none"
                    style={{ borderColor: palette.border, backgroundColor: palette.panelMuted, color: palette.inputText }}
                  >
                    <option value="status">Sort: Status</option>
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="az">A &gt; Z</option>
                    <option value="za">Z &gt; A</option>
                  </select>
                  <div
                    className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-2"
                    style={{ width: 340, minWidth: 340, borderColor: palette.border, backgroundColor: palette.panelMuted }}
                  >
                    <Search size={14} className="shrink-0" style={{ color: palette.textMuted }} />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search leads..."
                      className="h-8 w-full bg-transparent text-[12px] outline-none"
                      style={{ color: palette.inputText }}
                    />
                  </div>
                  <span className="rounded-full px-3 py-1" style={{ backgroundColor: palette.panelMuted }}>{filteredLeads.length} total</span>
                  <span className="rounded-full px-3 py-1" style={{ backgroundColor: palette.panelMuted }}>{newCount} new</span>
                </div>
              </div>
            </section>
            {statusFilterMenuOpen && statusFilterMenuPos && typeof document !== "undefined"
              ? createPortal(
                  <div
                    data-status-filter-menu="true"
                    className="fixed z-[210] rounded-[12px] border py-[2px] shadow-[0_18px_42px_rgba(15,23,42,0.22)]"
                    style={{
                      left: statusFilterMenuPos.left,
                      top: statusFilterMenuPos.top,
                      width: statusFilterMenuPos.width,
                      borderColor: palette.border,
                      backgroundColor: palette.panelBg,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter("all");
                        setStatusFilterMenuOpen(false);
                        setStatusFilterMenuPos(null);
                      }}
                      className="flex w-full items-center justify-center px-[3px] py-[3px]"
                    >
                      <span
                        className="inline-flex h-7 items-center justify-center rounded-[10px] px-[5px] text-[11px] font-bold whitespace-nowrap"
                        style={{
                          width: statusFilterPillWidth,
                          backgroundColor: palette.panelBg,
                          color: palette.textSoft,
                          border: `1px solid ${palette.border}`,
                        }}
                      >
                        All Statuses
                      </span>
                    </button>
                    {leadStatusOptions.map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => {
                          setStatusFilter(String(status).trim().toLowerCase());
                          setStatusFilterMenuOpen(false);
                          setStatusFilterMenuPos(null);
                        }}
                        className="flex w-full items-center justify-center px-[3px] py-[3px]"
                      >
                        <span
                          className="inline-flex h-7 items-center justify-center rounded-[10px] px-[5px] text-[11px] font-bold whitespace-nowrap"
                          style={{
                            width: statusFilterPillWidth,
                            ...leadStatusPillStyle(status),
                          }}
                        >
                          {status}
                        </span>
                      </button>
                    ))}
                  </div>,
                  document.body,
                )
              : null}

            <section className="-mx-4 overflow-hidden border-x md:-mx-5" style={{ marginTop: "-1px", borderColor: palette.border, backgroundColor: palette.panelBg }}>
              {isLoading ? (
                <div className="px-4 py-8 text-[13px] font-semibold" style={{ color: palette.textMuted }}>
                  Loading leads...
                </div>
              ) : filteredLeads.length === 0 ? (
                <div className="px-4 py-10 text-center text-[13px] font-semibold" style={{ color: palette.textMuted }}>
                  No leads yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                    <div
                      className="grid min-w-full gap-3 border-b px-4 py-3 text-[11px] font-bold uppercase tracking-[0.8px]"
                    style={{
                      gridTemplateColumns: previewGridTemplate,
                      borderColor: palette.border,
                      backgroundColor: palette.panelMuted,
                      color: palette.textMuted,
                    }}
                    >
                      <p></p>
                      <p>Status</p>
                      {rowFields.length === 0 ? <p>No visible lead fields</p> : rowFields.map((column) => <p key={column.key}>{column.label}</p>)}
                      <p
                        className="text-right"
                        style={{ transform: "translateX(-68px)" }}
                      >
                        Received
                      </p>
                      <p>Assigned</p>
                    </div>
                  {filteredLeads.map((lead, idx) => {
                    const renderLead = leadDetailsById[lead.id] ?? lead;
                    const leadFields = getLeadDynamicFields(renderLead);
                    const isOpen = openLeadId === lead.id;
                    const isDetailLoading = detailLoadingLeadId === lead.id && !leadDetailsById[lead.id];
                    const assignedUid = String(lead.assignedToUid || "").trim();
                    const assignedMember = companyMembers.find((member) => member.uid === assignedUid) ?? null;
                    const assignedLabel = String(lead.assignedToName || lead.assignedTo || assignedMember?.displayName || "").trim();
                    const assignedColor =
                      String(assignedMember?.badgeColor || assignedMember?.userColor || companyThemeColor).trim() || companyThemeColor;
                    const assignedInitials = assignedLabel
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((part) => part[0]?.toUpperCase() || "")
                      .join("");
                    return (
                      <Fragment key={lead.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          onMouseEnter={() => setHoveredLeadId(lead.id)}
                          onMouseLeave={() => setHoveredLeadId((prev) => (prev === lead.id ? "" : prev))}
                          onClick={() => {
                            setOpenLeadId((prev) => (prev === lead.id ? "" : lead.id));
                            setConfirmDeleteLeadId("");
                            if (deleteConfirmTimeoutRef.current) {
                              clearTimeout(deleteConfirmTimeoutRef.current);
                              deleteConfirmTimeoutRef.current = null;
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            setOpenLeadId((prev) => (prev === lead.id ? "" : lead.id));
                            setConfirmDeleteLeadId("");
                            if (deleteConfirmTimeoutRef.current) {
                              clearTimeout(deleteConfirmTimeoutRef.current);
                              deleteConfirmTimeoutRef.current = null;
                            }
                          }}
                          className="grid min-w-full items-center gap-3 border-b px-4 py-[7px] text-left text-[12px] transition-colors"
                          style={{
                            gridTemplateColumns: previewGridTemplate,
                            borderColor: palette.border,
                            backgroundColor:
                              hoveredLeadId === lead.id ? palette.rowHover : idx % 2 === 0 ? palette.panelBg : palette.panelMuted,
                          }}
                        >
                          <span
                            className="flex h-6 w-6 items-center justify-center rounded-full"
                            style={{ backgroundColor: "transparent", color: palette.textSoft }}
                            aria-hidden="true"
                          >
                            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </span>
                          <div className="-ml-5 flex justify-center">
                            <button
                              type="button"
                              data-lead-status-trigger="true"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (statusMenuLeadId === lead.id) {
                                  setStatusMenuLeadId("");
                                  setStatusMenuPos(null);
                                  return;
                                }
                                const trigger = e.currentTarget as HTMLButtonElement;
                                const rect = trigger.getBoundingClientRect();
                                const menuWidth = Math.max(rect.width, leadStatusPillWidth + 6);
                                const estimatedMenuHeight = Math.max(120, leadStatusOptions.length * 34);
                                const hasRoomBelow = rect.bottom + estimatedMenuHeight <= window.innerHeight - 8;
                                const hasRoomAbove = rect.top - estimatedMenuHeight >= 8;
                                const shouldOpenUp = !hasRoomBelow && hasRoomAbove;
                                const clampedLeft = Math.min(Math.max(8, rect.left), window.innerWidth - menuWidth - 8);
                                setStatusMenuPos({
                                  left: clampedLeft,
                                  top: shouldOpenUp ? Math.max(8, rect.top - estimatedMenuHeight - 4) : rect.bottom + 4,
                                  width: menuWidth,
                                });
                                setStatusMenuLeadId(lead.id);
                              }}
                              className="inline-flex h-7 shrink-0 items-center justify-center rounded-[10px] px-3 text-[11px] font-bold whitespace-nowrap"
                              style={{
                                ...leadStatusPillStyle(lead.status || "New"),
                                width: leadStatusPillWidth,
                              }}
                              aria-label="Lead status"
                            >
                              {statusUpdatingLeadId === lead.id ? "Saving..." : lead.status || "New"}
                            </button>
                          </div>
                          {rowFields.length === 0 ? (
                            <span
                              className="min-w-0 text-left text-[12px] font-semibold"
                              style={{ gridColumn: "2 / span 1", color: palette.textSoft }}
                            >
                              No preview fields configured yet.
                            </span>
                          ) : (
                              rowFields.map((column) => {
                                const value = resolveLeadColumnValue(leadFields, column, mergedFieldLayout);
                                return (
                                  <span
                                    key={`${lead.id}:${column.key}`}
                                    className="min-w-0 overflow-hidden text-left"
                                  >
                                    <p className="truncate whitespace-nowrap text-[12px] font-semibold" style={{ color: palette.textSoft }}>
                                      {value || "-"}
                                    </p>
                                  </span>
                                );
                              })
                          )}
                          <div className="text-right">
                            <p
                              className="whitespace-nowrap text-[11px] font-semibold"
                              style={{ color: palette.textMuted, transform: "translateX(-68px)" }}
                            >
                              {formatLeadDate(lead.createdAtIso || "")}
                            </p>
                          </div>
                          <div className="min-w-0">
                            {assignedLabel ? (
                              <div className="flex min-w-0 items-center gap-2">
                                <span
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                                  style={{ backgroundColor: assignedColor }}
                                  aria-hidden="true"
                                >
                                  {assignedInitials || "?"}
                                </span>
                                <p className="truncate whitespace-nowrap text-[12px] font-semibold" style={{ color: palette.textSoft }}>
                                  {assignedLabel}
                                </p>
                              </div>
                            ) : null}
                          </div>
                        </div>
                        {isOpen ? (
                          <div
                            className="border-b px-4 pb-4 pt-3"
                            style={{
                              borderColor: palette.border,
                              backgroundColor: idx % 2 === 0 ? palette.panelMuted : palette.panelBg,
                            }}
                          >
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleCreateProjectFromLead(renderLead);
                                  }}
                                  className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-[8px] border px-3 text-[11px] font-bold text-white"
                                  style={{
                                    borderColor: companyThemeColor,
                                    backgroundColor: companyThemeColor,
                                  }}
                                >
                                  Create Project
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setLeadImagesLeadId(lead.id);
                                    setLeadImagesDragActive(false);
                                  }}
                                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[8px] border px-3 text-[11px] font-bold"
                                  style={{
                                    borderColor: palette.border,
                                    backgroundColor: palette.panelBg,
                                    color: palette.textSoft,
                                  }}
                                >
                                  <span
                                    aria-hidden="true"
                                    className="block shrink-0"
                                    style={{
                                      width: 13,
                                      height: 13,
                                      backgroundColor: String(palette.textSoft || "#64748B"),
                                      WebkitMaskImage: "url('/image.png')",
                                      WebkitMaskRepeat: "no-repeat",
                                      WebkitMaskPosition: "center",
                                      WebkitMaskSize: "contain",
                                      maskImage: "url('/image.png')",
                                      maskRepeat: "no-repeat",
                                      maskPosition: "center",
                                      maskSize: "contain",
                                    }}
                                  />
                                  Photos
                                  <span style={{ color: palette.textMuted }}>
                                    ({Array.isArray(renderLead.imageUrls) ? renderLead.imageUrls.length : 0})
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openAssignLeadModal(renderLead);
                                  }}
                                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[8px] border px-3 text-[11px] font-bold"
                                  style={{
                                    borderColor: palette.border,
                                    backgroundColor: palette.panelBg,
                                    color: palette.textSoft,
                                  }}
                                >
                                  {assignedLabel ? (
                                    <>
                                      <span style={{ color: palette.textMuted }}>Assigned:</span>
                                      <span
                                        className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                                        style={{ backgroundColor: assignedColor }}
                                      >
                                        {assignedInitials || "U"}
                                      </span>
                                      <span className="max-w-[140px] truncate">{assignedLabel}</span>
                                    </>
                                  ) : (
                                    "Assign"
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDeleteLead(lead);
                                  }}
                                  disabled={deletingLeadId === lead.id}
                                  className="inline-flex h-8 w-[88px] shrink-0 items-center justify-center whitespace-nowrap rounded-[8px] border px-3 text-[11px] font-bold transition-colors"
                                  style={{
                                    borderColor: confirmDeleteLeadId === lead.id ? "#991B1B" : "#F5B4BC",
                                    backgroundColor: confirmDeleteLeadId === lead.id ? "#991B1B" : "#FFF5F6",
                                    color: confirmDeleteLeadId === lead.id ? "#ffffff" : "#991B1B",
                                    opacity: deletingLeadId === lead.id ? 0.65 : 1,
                                  }}
                                >
                                  {deletingLeadId === lead.id ? "Deleting" : confirmDeleteLeadId === lead.id ? "Confirm" : "Delete"}
                                </button>
                              </div>
                              <p className="text-[10px] font-extrabold uppercase tracking-[0.7px]" style={{ color: palette.textMuted }}>
                                Lead Details
                              </p>
                            </div>
                            {isDetailLoading ? (
                              <div className="mb-3 rounded-[12px] border px-3 py-2 text-[12px] font-semibold" style={{ borderColor: palette.border, backgroundColor: palette.panelBg, color: palette.textMuted }}>
                                Loading lead details...
                              </div>
                            ) : null}
                            {detailFields.length === 0 ? (
                              <p className="text-[12px] font-semibold" style={{ color: palette.textMuted }}>
                                No detail fields configured yet.
                              </p>
                            ) : (
                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                  {detailFields.map((column) => {
                                    const value = resolveLeadColumnValue(leadFields, column, mergedFieldLayout);
                                    return (
                                      <div
                                        key={`${lead.id}:detail:${column.key}`}
                                        className="rounded-[12px] border px-3 py-2"
                                        style={{ borderColor: palette.border, backgroundColor: palette.panelBg }}
                                      >
                                      <p className="text-[10px] font-extrabold uppercase tracking-[0.7px]" style={{ color: palette.textMuted }}>
                                        {column.label}
                                      </p>
                                        <p className="mt-2 whitespace-pre-wrap text-[12px] font-semibold" style={{ color: palette.textSoft }}>
                                          {value || "-"}
                                        </p>
                                      </div>
                                    );
                                  })}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
        {statusMenuLead &&
          statusMenuPos &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              data-lead-status-menu="true"
              className="fixed z-[210] rounded-[12px] border py-[2px] shadow-[0_18px_42px_rgba(15,23,42,0.22)]"
              style={{
                left: statusMenuPos.left,
                top: statusMenuPos.top,
                width: statusMenuPos.width,
                borderColor: palette.border,
                backgroundColor: palette.panelBg,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {leadStatusOptions.map((option) => {
                const active = String(statusMenuLead.status || "").trim().toLowerCase() === option.toLowerCase();
                return (
                  <button
                    key={`${statusMenuLead.id}_${option}`}
                    type="button"
                    disabled={statusUpdatingLeadId === statusMenuLead.id}
                    onClick={() => void onSelectLeadStatus(statusMenuLead, option)}
                    className="flex w-full items-center justify-center px-[3px] py-[3px] disabled:opacity-55"
                  >
                    <span
                      className="inline-flex h-7 items-center justify-center rounded-[10px] px-[5px] text-[11px] font-bold whitespace-nowrap"
                      style={{
                        width: leadStatusPillWidth,
                        ...leadStatusPillStyle(option),
                        filter: active ? "brightness(0.96)" : "brightness(1)",
                      }}
                    >
                      {option}
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )}
        {assignLead &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="fixed inset-0 z-[235] flex items-center justify-center px-2 py-2"
              style={{
                backgroundColor: "rgba(8,12,20,0.52)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
              }}
              onClick={closeAssignLeadModal}
            >
              <div
                className="relative flex flex-col overflow-hidden rounded-[14px] border shadow-xl"
                style={{
                  width: "min(1000px, calc(100vw - 16px))",
                  height: "min(600px, calc(100vh - 16px))",
                  borderColor: palette.border,
                  backgroundColor: palette.panelBg,
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div
                  className="flex h-[56px] items-center justify-between gap-3 border-b px-5"
                  style={{ borderColor: palette.border }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "#12345B" }}>
                      Assign Lead
                    </p>
                    <span className="text-[14px] font-medium" style={{ color: "#6B7280" }}>
                      |
                    </span>
                    <p className="truncate text-[14px] font-medium" style={{ color: "#334155" }}>
                      {assignLeadName}
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <div
                      className="flex h-9 min-w-0 items-center gap-2 rounded-[10px] border px-3"
                      style={{ width: 340, minWidth: 340, borderColor: palette.border, backgroundColor: palette.panelMuted }}
                    >
                      <Search size={14} className="shrink-0" style={{ color: palette.textMuted }} />
                      <input
                        value={assignSearch}
                        onChange={(event) => setAssignSearch(event.currentTarget.value)}
                        placeholder="Search staff..."
                        className="w-full bg-transparent text-[12px] font-semibold outline-none"
                        style={{ color: palette.inputText }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={closeAssignLeadModal}
                      disabled={Boolean(assigningLeadId)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border"
                      style={{ borderColor: palette.border, color: palette.textSoft }}
                      aria-label="Close assign lead"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {filteredCompanyMembers.length ? (
                    filteredCompanyMembers.map((member, idx) => {
                      const memberColor = String(member.badgeColor || member.userColor || companyThemeColor).trim() || companyThemeColor;
                      const isSelected = assignSelectedUid === member.uid;
                      return (
                        <button
                          key={`lead_assign_member_${member.uid}`}
                          type="button"
                          onClick={() => setAssignSelectedUid(member.uid)}
                          className="grid w-full grid-cols-[44px_minmax(0,1fr)] items-center gap-3 px-5 py-3 text-left"
                          style={{
                            borderTop: "none",
                            borderBottom: `1px solid ${palette.border}`,
                            backgroundColor: isSelected ? "#EEF4FF" : idx % 2 === 0 ? palette.panelBg : palette.panelMuted,
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
                            <span className="block truncate text-[13px] font-bold" style={{ color: palette.text }}>
                              {member.displayName}
                            </span>
                            <span className="mt-1 block truncate text-[12px] font-semibold" style={{ color: palette.textSoft }}>
                              {member.email || "-"}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-5 py-8 text-[13px] font-semibold" style={{ color: palette.textMuted }}>
                      No staff found.
                    </div>
                  )}
                </div>
                <div className="border-t flex items-center px-[5px] pt-[5px] pb-[5px]" style={{ borderColor: palette.border }}>
                  <button
                    type="button"
                    onClick={() => void handleAssignLead()}
                    disabled={!selectedAssignedMember || assigningLeadId === assignLeadId}
                    className="flex h-11 w-full items-center justify-center whitespace-nowrap rounded-[10px] border px-4 text-[12px] font-bold text-white disabled:cursor-not-allowed"
                    style={{
                      borderColor: companyThemeColor,
                      backgroundColor: companyThemeColor,
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
        {leadImagesLead &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="fixed inset-0 z-[240] flex items-center justify-center px-2 py-2"
              style={{
                backgroundColor: "rgba(8,12,20,0.52)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
              }}
              onClick={closeLeadImagesModal}
            >
              <div
                className="relative flex flex-col overflow-hidden rounded-[14px] border shadow-xl"
                style={{
                  width: "min(1000px, calc(100vw - 16px))",
                  height: "min(600px, calc(100vh - 16px))",
                  borderColor: palette.border,
                  backgroundColor: palette.panelBg,
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div
                  className="flex h-[56px] items-center justify-between gap-3 border-b px-5"
                  style={{ borderColor: palette.border }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "#12345B" }}>
                      Lead Photos
                    </p>
                    <span className="text-[14px] font-medium" style={{ color: "#6B7280" }}>
                      |
                    </span>
                    <p className="truncate text-[14px] font-medium" style={{ color: "#334155" }}>
                      {buildLeadClientNameParts(getLeadDynamicFields(leadImagesLead), mergedFieldLayout).fullName || leadImagesLead.name || "Untitled Lead"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeLeadImagesModal}
                    disabled={leadImagesUploading}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border"
                    style={{ borderColor: palette.border, color: palette.textSoft }}
                    aria-label="Close lead photos"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="overflow-y-auto px-5 py-5">
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
                      void handleUploadLeadImages(leadImagesLead, event.dataTransfer.files);
                    }}
                    onClick={() => {
                      if (leadImagesUploading) return;
                      const input = document.getElementById(`lead-image-input-${leadImagesLead.id}`) as HTMLInputElement | null;
                      input?.click();
                    }}
                    className="flex min-h-[132px] w-full flex-col items-center justify-center rounded-[16px] border border-dashed px-5 py-6 text-center transition-colors"
                    style={{
                      borderColor: leadImagesDragActive ? companyThemeColor : palette.border,
                      backgroundColor: leadImagesDragActive ? `${companyThemeColor}12` : palette.panelMuted,
                      color: palette.textSoft,
                    }}
                  >
                    <ImagePlus size={26} />
                    <p className="mt-3 text-[13px] font-bold">
                      {leadImagesUploading ? "Uploading images..." : "Drag and drop images here or click to upload"}
                    </p>
                    <p className="mt-1 text-[11px] font-semibold" style={{ color: palette.textMuted }}>
                      {`${leadImageItems.length}/10 uploaded`}
                    </p>
                    <input
                      id={`lead-image-input-${leadImagesLead.id}`}
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: "none" }}
                      onChange={(event) => {
                        void handleUploadLeadImages(leadImagesLead, event.currentTarget.files);
                        event.currentTarget.value = "";
                      }}
                    />
                  </button>
                  <div className="mt-5">
                    {leadImageItems.length > 0 ? (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                        {leadImageItems.map((image, idx) => (
                          <div
                            key={`${leadImagesLead.id}:image:${idx}`}
                            className="group overflow-hidden rounded-[12px] border"
                            style={{ borderColor: palette.border, backgroundColor: palette.panelBg }}
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
                                onClick={() => void handleRemoveLeadImage(leadImagesLead, image.url)}
                                disabled={leadImagesUploading}
                                className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-55"
                                style={{ borderColor: "#7F1D1D", backgroundColor: "#DC2626" }}
                                aria-label="Remove lead image"
                              >
                                <X size={14} />
                              </button>
                            </div>
                            <div className="relative border-t px-2 pb-2 pt-2" style={{ borderColor: palette.border }}>
                              <input
                                type="text"
                                defaultValue={image.name}
                                placeholder={`Image ${idx + 1}`}
                                onClick={(event) => event.stopPropagation()}
                                onBlur={(event) => void handleRenameLeadImage(leadImagesLead, image.url, event.currentTarget.value)}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter") return;
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }}
                                className="h-8 w-full rounded-[8px] border px-2 text-[11px] font-semibold outline-none"
                                style={{
                                  borderColor: palette.border,
                                  backgroundColor: palette.panelBg,
                                  color: palette.textSoft,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div
                        className="rounded-[14px] border px-4 py-8 text-center text-[12px] font-semibold"
                        style={{ borderColor: palette.border, backgroundColor: palette.panelMuted, color: palette.textMuted }}
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
            onToggleComments={() => setLeadImageCommentsCollapsed((current) => !current)}
            onPinsVisibleChange={(nextChecked) => {
              setLeadImagePinsVisible(nextChecked);
              if (!nextChecked) {
                closeLeadImageAnnotationOverlays();
              }
            }}
            onClose={() => openLeadImagePreview(-1)}
            commentsSection={
              activeLeadImageAnnotations.length > 0 ? (
                <div className="border-t px-6 py-0" style={{ borderColor: "#E2E8F0", backgroundColor: "#ffffff" }}>
                  <div className="relative">
                    <button
                      type="button"
                      onMouseEnter={() => startLeadImageCommentsHoverScroll("left")}
                      onMouseLeave={stopLeadImageCommentsHoverScroll}
                      className="absolute inset-y-0 -left-6 z-[2] flex w-7 items-center justify-center"
                      style={{ backgroundColor: "#ffffff", borderRight: "1px solid #E2E8F0" }}
                      aria-label="Scroll comments left"
                    >
                      <span className="inline-flex items-center justify-center" style={{ width: 12, height: 12 }}>
                        <span
                          aria-hidden="true"
                          className="block"
                          style={{
                            width: 12,
                            height: 12,
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
                      </span>
                    </button>
                    <button
                      type="button"
                      onMouseEnter={() => startLeadImageCommentsHoverScroll("right")}
                      onMouseLeave={stopLeadImageCommentsHoverScroll}
                      className="absolute inset-y-0 -right-6 z-[2] flex w-7 items-center justify-center"
                      style={{ backgroundColor: "#ffffff", borderLeft: "1px solid #E2E8F0" }}
                      aria-label="Scroll comments right"
                    >
                      <span className="inline-flex items-center justify-center" style={{ width: 12, height: 12 }}>
                        <span
                          aria-hidden="true"
                          className="block"
                          style={{
                            width: 12,
                            height: 12,
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
                      </span>
                    </button>
                    <div
                      ref={leadImageCommentsScrollRef}
                      className="cutsmart-image-viewer-comments-strip flex items-stretch gap-0 overflow-x-auto overflow-y-hidden px-0"
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
                          className="group/comment relative min-w-[240px] max-w-[min(480px,calc(100vw-120px))] shrink-0 self-stretch px-3 py-0"
                          data-lead-image-annotation-list-card="true"
                          onClick={() => {
                            if (leadImageCommentsSuppressClickRef.current) {
                              return;
                            }
                            setLeadImageDraftAnnotation(null);
                            setLeadImageActiveAnnotationId("");
                            setLeadImageListEditingAnnotation(null);
                            setLeadImageHighlightedAnnotationId((current) =>
                              current === annotation.id ? "" : annotation.id,
                            );
                          }}
                          style={{
                            backgroundColor:
                              leadImageHighlightedAnnotationId === annotation.id ? `${companyThemeColor}12` : "#ffffff",
                            width:
                              leadImageListEditingAnnotation?.id === annotation.id && leadImageListEditingAnnotation.width
                                ? `${leadImageListEditingAnnotation.width}px`
                                : undefined,
                          }}
                        >
                          {idx > 0 ? (
                            <span
                              aria-hidden="true"
                              className="absolute bottom-0 left-0 top-0 w-px"
                              style={{ backgroundColor: "#E2E8F0" }}
                            />
                          ) : null}
                          <div className="flex h-full min-w-0 flex-1 flex-col text-left">
                            <div className="-mx-3 mb-0 flex items-center justify-between gap-3 border-b px-3 py-1.5" style={{ borderColor: "#E2E8F0", backgroundColor: "#ffffff" }}>
                              <div className="min-w-0 flex items-center gap-3">
                                <span
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                                  style={{ backgroundColor: String(annotation.createdByColor || "").trim() || companyThemeColor }}
                                >
                                  {idx + 1}
                                </span>
                                <span className="min-w-0 truncate text-[13px] font-bold" style={{ color: "#334155" }}>
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
                                    borderColor: leadImageListEditingAnnotation?.id === annotation.id ? "#15803D" : "#D7DEE8",
                                    backgroundColor: leadImageListEditingAnnotation?.id === annotation.id ? "#15803D" : "#ffffff",
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
                                      backgroundColor: leadImageListEditingAnnotation?.id === annotation.id ? "#ffffff" : "#64748B",
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
                                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border opacity-0 transition-opacity group-hover/comment:opacity-100"
                                  data-lead-image-comments-no-drag="true"
                                  style={{
                                    borderColor: confirmDeleteLeadImageAnnotationId === annotation.id ? "#991B1B" : "#F1B7BC",
                                    backgroundColor: confirmDeleteLeadImageAnnotationId === annotation.id ? "#991B1B" : "#FFF5F6",
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
                                  style={{ borderColor: "transparent", color: "#334155", backgroundColor: "transparent" }}
                                />
                              ) : (
                                <span
                                  ref={(node) => updateLeadImageAnnotationOverflow(annotation.id, node)}
                                  className="block w-full whitespace-pre-wrap text-left text-[12px] font-semibold leading-[18px]"
                                  style={{
                                    color: "#334155",
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
                                    color: "#334155",
                                    borderColor: "#D7DEE8",
                                    backgroundColor: "#ffffff",
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
                                      backgroundColor: "#334155",
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
                  </div>
                </div>
              ) : (
                <div className="border-t px-6 py-0" style={{ borderColor: "#E2E8F0", backgroundColor: "#ffffff" }}>
                  <p className="text-[12px] font-semibold" style={{ color: "#94A3B8" }}>
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
                  className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6 py-4"
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
                      className="absolute left-6 top-1/2 z-[3] inline-flex h-16 w-16 -translate-y-1/2 items-center justify-center rounded-full border"
                      style={{
                        borderColor: "#D7DEE8",
                        backgroundColor: "rgba(255,255,255,0.94)",
                        color: "#334155",
                        boxShadow: "0 4px 10px rgba(15,23,42,0.10)",
                      }}
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
                      transition: leadImagePreviewDragging ? "none" : "transform 120ms ease",
                      opacity: leadImageSizeReady ? 1 : 0,
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
                        transition: leadImagePreviewDragging ? "none" : "transform 120ms ease",
                        opacity: leadImageSizeReady ? 1 : 0,
                      }}
                    >
                      {activeLeadImageAnnotations.map((annotation, idx) => (
                        <button
                          key={`${annotation.id}:overlay-pin`}
                          type="button"
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
                            setLeadImageActiveAnnotationId((current) => (current === annotation.id ? "" : annotation.id));
                          }}
                          className="pointer-events-auto absolute inline-flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[11px] font-bold text-white"
                          style={{
                            ...getLeadAnnotationRenderPoint(
                              leadImageDraggingAnnotation?.id === annotation.id ? leadImageDraggingAnnotation : annotation,
                            ),
                            borderColor: "#ffffff",
                            backgroundColor: String(annotation.createdByColor || "").trim() || companyThemeColor,
                            boxShadow: "0 4px 10px rgba(15,23,42,0.18)",
                            transform: `translate(-50%, -50%) scale(${leadImageAnnotationUiScale})`,
                            opacity:
                              (leadImageActiveAnnotationId || leadImageHighlightedAnnotationId) &&
                              leadImageActiveAnnotationId !== annotation.id &&
                              leadImageHighlightedAnnotationId !== annotation.id
                                ? 0.25
                                : 1,
                            cursor:
                              leadImageDraggingAnnotation?.id === annotation.id
                                ? "grabbing"
                                : "grab",
                            animation:
                              leadImageHighlightedAnnotationId === annotation.id
                                ? "cutsmart-lead-pin-bounce 2s ease-in-out infinite"
                                : "none",
                          }}
                        >
                          {idx + 1}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {leadImagePinsVisible ? (
                    <div className="pointer-events-none absolute inset-0 z-[10]">
                      {activeLeadImageAnnotations.map((annotation, idx) =>
                        leadImageActiveAnnotationId === annotation.id ? (
                          <div
                            key={`${annotation.id}:screen-note`}
                            data-lead-image-annotation-editor="true"
                            className="pointer-events-auto absolute flex min-w-[240px] max-w-[min(480px,calc(100vw-48px))] flex-col rounded-[12px] border px-3 py-2 text-left"
                            ref={(node) => {
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
                              borderColor: "#D7DEE8",
                              backgroundColor: "#ffffff",
                              boxShadow: "0 14px 28px rgba(15,23,42,0.12)",
                              overflowY: "auto",
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
                                className="mt-2 block w-full flex-1 resize-none rounded-[10px] border px-3 py-2 text-[12px] font-semibold outline-none"
                                style={{
                                  minHeight: 0,
                                  height: "auto",
                                  borderColor: "#D7DEE8",
                                  color: "#334155",
                                  backgroundColor: "#ffffff",
                                  boxSizing: "border-box",
                                }}
                              />
                            ) : (
                              <p className="mt-2 whitespace-pre-wrap text-[12px] font-semibold" style={{ color: "#334155" }}>
                                {annotation.note}
                              </p>
                            )}
                          </div>
                        ) : null,
                      )}
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
                              borderColor: "#D7DEE8",
                              backgroundColor: "#ffffff",
                              boxShadow: "0 14px 28px rgba(15,23,42,0.12)",
                              overflowY: "auto",
                            }}
                          onClick={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                          onWheel={(event) => event.stopPropagation()}
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
                  ) : null}
                  {leadImageUrls.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        openLeadImagePreview(
                          leadImagePreviewIndex >= leadImageUrls.length - 1 ? 0 : leadImagePreviewIndex + 1,
                        )
                      }
                      className="absolute right-6 top-1/2 z-[3] inline-flex h-16 w-16 -translate-y-1/2 items-center justify-center rounded-full border"
                      style={{
                        borderColor: "#D7DEE8",
                        backgroundColor: "rgba(255,255,255,0.94)",
                        color: "#334155",
                        boxShadow: "0 4px 10px rgba(15,23,42,0.10)",
                      }}
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
      </AppShell>
    </ProtectedRoute>
  );
}
