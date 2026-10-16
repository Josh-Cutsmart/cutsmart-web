"use client";

import { activeDateTime, useCompanyFormats } from "@/lib/company-formats";
import { glassShineStyle } from "@/lib/glass-shine";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { Activity, ArrowUpDown, CalendarDays, Check, CheckCircle2, ChevronsLeftRight, ChevronsRightLeft, ImagePlus, Inbox, Kanban, ListChecks, ListFilter, Mail, MapPin, Pencil, Phone, Plus, Rows3, Search, Sparkles, Trash2, UserX, X } from "lucide-react";
import { DASHBOARD_STAT_CARDS_UPDATED_EVENT, readDashboardStatCardsEnabled } from "@/lib/ui-preferences";
import { flatPageBg } from "@/lib/flat-page";
import { GlassActionMenu, GlassDropdown } from "@/components/glass-dropdown";
import Link from "next/link";
import { FullscreenImageViewerShell } from "@/components/fullscreen-image-viewer-shell";
import { glassFieldClass, modalCloseButtonClass, primaryButtonClass, primaryButtonStyle, secondaryButtonClass } from "@/components/settings-ui";
import { LeadFormFields } from "@/components/lead-form-fields";
import {
  collectLeadFormAnswers,
  leadFormFieldLayout,
  MANUAL_LEAD_SOURCES,
  normalizeLeadForms,
  type LeadForm,
  type LeadFormAnswers,
} from "@/lib/lead-forms";
import { isPreviewMode } from "@/lib/preview-mode";
import { useBoardStickyRef } from "@/lib/board-sticky-scroll";
import { collapseBoardColumnAnimated, expandBoardColumnAnimated } from "@/lib/board-column-collapse";
import { BoardColumnFrame, ColumnCollapseChevrons } from "@/components/board-column-frame";
import { scrollBoardToSearchMatch } from "@/lib/board-search-scroll";
import { useAuth } from "@/lib/auth-context";
import { authorizedFetch } from "@/lib/api-fetch";
import {
  fetchChecklistTemplates,
  fetchCompanyDoc,
  fetchCompanyLeadDirect,
  fetchCompanyMembers,
  fetchUserColorMapByUids,
  subscribeCompanyLeads,
  type CompanyLeadRow,
  type CompanyMemberOption,
  type LeadNote,
} from "@/lib/firestore-data";
import { contactInitials } from "@/lib/contact-card";
import type { ChecklistTemplate, ProjectChecklist } from "@/lib/types";
import { readLastKnown, saveLastKnown } from "@/lib/last-known";
import { ACTIVE_COMPANY_STORAGE_KEY } from "@/lib/company-onboarding";
import { storage } from "@/lib/firebase";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { getFirebaseStorageQuotaExceededMessage, isFirebaseStorageQuotaExceeded } from "@/lib/firebase-storage-errors";
import { readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";
import { USER_COLOR_UPDATED_EVENT, type UserColorUpdatedDetail } from "@/lib/user-color-sync";
import { contrastTextForFill } from "@/lib/user-profile-format";
import {
  LEAD_PROJECT_CREATED_EVENT,
  OPEN_NEW_PROJECT_EVENT,
  type NewProjectPrefillPayload,
} from "@/lib/new-project-bridge";
import { retryAsync } from "@/lib/load-retry";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { useDragGhost, DragGhostLayer } from "@/lib/use-drag-ghost";
import {
  BOARD_DROP_PREVIEW_STYLE,
  boardDropIndex,
  boardOrderBetween,
  boardSortKey,
  normalizeBoardColumnSorts,
  normalizeBoardSortMode,
  sortBoardCards,
  sortedBoardDropIndex,
  withBoardDropPreview,
  type BoardCardSortInfo,
  type BoardSortMode,
} from "@/lib/board-drop-order";
import { BoardColumnSortMenu, BoardSortButton } from "@/components/board-sort-menu";
import { useHomeScreenApp } from "@/lib/home-screen-app";
import { useAppTabs } from "@/lib/app-tabs-context";

// The page's own padding when it's the Leads home-screen app (the app shell drops its <main> padding
// then) — clear of the notch and rounded corners.
const HOME_SCREEN_APP_PAGE_PADDING = {
  paddingTop: "max(12px, env(safe-area-inset-top, 0px))",
  paddingLeft: "max(12px, env(safe-area-inset-left, 0px))",
  paddingRight: "max(12px, env(safe-area-inset-right, 0px))",
  paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
};
import { readBoardSortPrefs, saveBoardSortPrefs } from "@/lib/board-sort-prefs";
import { clusterPins, computeSpreadPositions, findClusterContainingPin } from "@/lib/pin-clustering";
import { hasPermissionKey, isOwnerOrAdmin, useCompanyAccess } from "@/lib/use-company-access";

const SAMPLE_LEADS_STORAGE_KEY_PREFIX = "cutsmart_sample_leads:";
// A lead's place in its board column: newest first, except where it's been dragged to a spot of its
// own (lib/board-drop-order.ts).
function leadBoardKey(lead: CompanyLeadRow): number {
  return boardSortKey(lead.boardOrder, lead.createdAtIso || lead.submittedAtIso || lead.updatedAtIso);
}
function leadDateMs(lead: CompanyLeadRow): number {
  const ms = Date.parse(lead.createdAtIso || lead.submittedAtIso || lead.updatedAtIso || "");
  return Number.isFinite(ms) ? ms : 0;
}
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
  return { backgroundColor: bg, color: contrastTextForFill(bg, 0.75) };
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

// The company's date format (lib/company-formats.ts); the time is the viewer's own.
function formatLeadDate(value: string) {
  return activeDateTime(value) || "-";
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

// Returns consumedKeys alongside the built value — whichever raw field(s) fed into it — so
// buildLeadProjectPrefill can exclude them from the project's own "leadCustomFields" list; without
// that, an address already folded into projectAddress would also show up a second time as a
// generic custom field.
function buildLeadAddress(fields: LeadDynamicField[]): { value: string; consumedKeys: string[] } {
  const directAddress = findBestLeadField(fields, [/address/, /street/, /location/]);
  if (directAddress?.value) return { value: directAddress.value, consumedKeys: [directAddress.key] };
  const matched = fields.filter((field) =>
    [/(^|[^a-z])suburb([^a-z]|$)/, /city/, /region/, /postcode/, /zip/, /state/, /country/].some((pattern) =>
      pattern.test(`${field.key} ${field.label}`.toLowerCase()),
    ),
  );
  const parts = matched.map((field) => field.value.trim()).filter(Boolean);
  return { value: Array.from(new Set(parts)).join(", "), consumedKeys: matched.map((field) => field.key) };
}

// Project name = whichever field is mapped to "Client Name" + whichever field is mapped to
// "Client Last Name" (the "Use For" column in the lead field Customise settings), combined in
// that order — e.g. a form with separate first/last name fields mapped to these two targets
// produces "John Smith" as the new project's name, rather than guessing at a surname from a
// single full-name field.
function buildLeadProjectName(clientName: string, clientLastName: string) {
  const name = String(clientName || "").trim();
  const lastName = String(clientLastName || "").trim();
  // A full name in the "Client Name" field may already end with the surname — don't repeat it.
  if (name && lastName && name.toLowerCase().endsWith(lastName.toLowerCase())) return name;
  return [name, lastName].filter(Boolean).join(" ");
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
      consumedKeys: [explicitNameField.key, firstNameField?.key, lastNameField?.key].filter(
        (key): key is string => Boolean(key),
      ),
    };
  }

  const firstName = String(firstNameField?.value || "").trim();
  const lastName = String(lastNameField?.value || "").trim();
  return {
    fullName: [firstName, lastName].filter(Boolean).join(" ").trim(),
    firstName,
    lastName,
    consumedKeys: [firstNameField?.key, lastNameField?.key].filter((key): key is string => Boolean(key)),
  };
}

// The lead's name everywhere on this page — its card, drag preview, details, pop-ups and sorting:
// "Client Name" + "Client Last Name", the same name a project created from the lead gets (it used to
// be the "Client Name" field on its own, so a card read "John" while its project became "John Smith").
function leadClientName(fields: LeadDynamicField[], fieldLayout: LeadFieldLayoutRow[]) {
  const parts = buildLeadClientNameParts(fields, fieldLayout);
  return buildLeadProjectName(parts.fullName || parts.firstName, parts.lastName);
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
  // Tracks every raw field key that ends up folded into one of the fixed fields below, so the
  // custom-fields list further down can exclude them — otherwise a field already surfaced as the
  // project's real clientEmail/clientAddress/etc. would ALSO show up a second time as a generic
  // "custom field," duplicating the same data under two labels.
  const consumedKeys = new Set<string>();
  const emailField =
    findMappedField("clientEmail") ||
    findBestLeadField(fields, [/email/, /e-mail/], (field) => isLikelyEmailValue(field.value)) ||
    fields.find((field) => isLikelyEmailValue(field.value)) ||
    null;
  if (emailField) consumedKeys.add(emailField.key);
  const phoneField =
    findMappedField("clientPhone") ||
    findBestLeadField(fields, [/phone/, /mobile/, /cell/, /contact/], (field) => isLikelyPhoneValue(field.value)) ||
    fields.find((field) => isLikelyPhoneValue(field.value)) ||
    null;
  if (phoneField) consumedKeys.add(phoneField.key);
  const {
    fullName: clientName,
    firstName: clientFirstName,
    lastName: clientLastName,
    consumedKeys: nameConsumedKeys,
  } = buildLeadClientNameParts(fields, fieldLayout);
  nameConsumedKeys.forEach((key) => consumedKeys.add(key));
  const notesField = findMappedField("projectNotes");
  if (notesField) consumedKeys.add(notesField.key);
  const mappedAddressField = findMappedField("projectAddress");
  let projectAddress: string;
  if (mappedAddressField?.value) {
    projectAddress = mappedAddressField.value.trim();
    consumedKeys.add(mappedAddressField.key);
  } else {
    const builtAddress = buildLeadAddress(fields);
    projectAddress = builtAddress.value.trim();
    builtAddress.consumedKeys.forEach((key) => consumedKeys.add(key));
  }
  const leadCustomFields = fields
    .filter((field) => !consumedKeys.has(field.key))
    .map((field) => ({ key: field.key, label: field.label, value: field.value }));
  return {
    projectName: buildLeadProjectName(clientName, clientLastName),
    clientFirstName,
    clientLastName,
    clientName,
    clientPhone: String(phoneField?.value || "").trim(),
    clientEmail: String(emailField?.value || "").trim(),
    projectAddress,
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
    leadCustomFields: leadCustomFields.length > 0 ? leadCustomFields : undefined,
  };
}

// The stat cards across the top (the Dashboard's): leads still being worked on, new ones, converted ones (by their
// status — a lead made into a project isn't necessarily sold), and active ones no one's been assigned yet. phoneLabel:
// what a phone's narrow card says instead.
const LEAD_STAT_CARDS = [
  { label: "Active", phoneLabel: "Active", key: "active", icon: Activity, iconFrom: "#F3CD6C", iconTo: "#DC9A1F" },
  { label: "New", phoneLabel: "New", key: "new", icon: Sparkles, iconFrom: "#6EB4FF", iconTo: "#3577E0" },
  { label: "Converted", phoneLabel: "Converted", key: "converted", icon: CheckCircle2, iconFrom: "#6BC79A", iconTo: "#2E8C5C" },
  { label: "Unassigned", phoneLabel: "Unassigned", key: "unassigned", icon: UserX, iconFrom: "#A796F0", iconTo: "#6E56D9" },
] as const;
// Which statuses count as converted, or closed without converting (so not active) — by name, since each company names
// its own.
const LEAD_CONVERTED_STATUS = /convert|won|sold|accepted|signed/i;
const LEAD_CLOSED_STATUS = /lost|closed|declin|dead|reject|cancel|unsuccess|no sale|not interested|spam/i;

// The list view's rows (the Dashboard's list): a colour across a row that fades out over its last 72px at each end
// instead of stopping in a hard edge — the hover highlight, and the line between rows (a 1px line along the bottom of
// the row, in its background).
function fadedAcrossRow(color: string) {
  return `linear-gradient(90deg, transparent 0, ${color} 72px, ${color} calc(100% - 72px), transparent 100%)`;
}
function fadedRowLineStyle(lineColor: string, rowBackground = "none"): React.CSSProperties {
  return {
    backgroundImage: `${fadedAcrossRow(lineColor)}, ${rowBackground}`,
    backgroundSize: "100% 1px, 100% 100%",
    backgroundPosition: "left bottom, left top",
    backgroundRepeat: "no-repeat",
  };
}
// A lead in the list view: its name (first and last — the name a project made from it gets), phone, email and suburb
// (found as a project made from it finds them — buildLeadProjectPrefill — the suburb from a suburb field, else a town
// or city one), and when it came in (in the company's date format, with the time).
// The fields on a lead's card (none chosen: its first three) and in its pop-up (none chosen: all of them).
function leadRowFields(layout: LeadFieldLayoutRow[]) {
  const configured = layout.filter((field) => field.showInRow);
  return configured.length > 0 ? configured : layout.slice(0, 3);
}

function leadDetailFields(layout: LeadFieldLayoutRow[]) {
  const configured = layout.filter((field) => field.showInDetail);
  return configured.length > 0 ? configured : layout;
}

function leadListDetails(lead: CompanyLeadRow, fieldLayout: LeadFieldLayoutRow[]) {
  const fields = getLeadDynamicFields(lead);
  const mapped = (target: LeadProjectFieldTarget) => {
    const row = fieldLayout.find((item) => item.projectFieldTarget === target);
    return row ? fields.find((field) => normalizeLeadFieldKey(field.key) === normalizeLeadFieldKey(row.key)) ?? null : null;
  };
  const email =
    mapped("clientEmail") ||
    findBestLeadField(fields, [/email/, /e-mail/], (field) => isLikelyEmailValue(field.value)) ||
    fields.find((field) => isLikelyEmailValue(field.value)) ||
    null;
  const phone =
    mapped("clientPhone") ||
    findBestLeadField(fields, [/phone/, /mobile/, /cell/, /contact/], (field) => isLikelyPhoneValue(field.value)) ||
    fields.find((field) => isLikelyPhoneValue(field.value)) ||
    null;
  const suburb = findBestLeadField(fields, [/(^|[^a-z])suburb([^a-z]|$)/]) || findBestLeadField(fields, [/town/, /city/]) || null;
  return {
    name: leadClientName(fields, fieldLayout) || lead.name || lead.email || lead.phone || "Untitled Lead",
    phone: String(phone?.value || lead.phone || "").trim(),
    email: String(email?.value || lead.email || "").trim(),
    suburb: String(suburb?.value || "").trim(),
    received: activeDateTime(lead.createdAtIso || lead.submittedAtIso || "") || "-",
  };
}

// The lead pop-up's colour: its status's, washed softly across it — brightest from the top left — as the Calendar's
// event pop-up does with its category's.
function leadPopupTintStyle(color: string): React.CSSProperties {
  return {
    backgroundImage: [
      `radial-gradient(120% 70% at 0% 0%, color-mix(in srgb, ${color} 30%, transparent), transparent 70%)`,
      `radial-gradient(90% 60% at 100% 100%, color-mix(in srgb, ${color} 14%, transparent), transparent 70%)`,
      `linear-gradient(to bottom, color-mix(in srgb, ${color} 10%, transparent), color-mix(in srgb, ${color} 5%, transparent))`,
    ].join(", "),
  };
}
// Its white see-through boxes (each field, and its plain buttons), as the Calendar's event pop-up's.
const LEAD_POPUP_BOX_STYLE: React.CSSProperties = {
  borderColor: "var(--glass-border)",
  backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)",
};

export default function LeadsPage() {
  // Re-render when the company's date format changes.
  useCompanyFormats();
  const { user } = useAuth();
  const currentUserUid = String(user?.uid || "").trim();
  // An unverified account can view leads but not edit/move/delete/assign them — see the same gate
  // in app/(app)/projects/[projectId]/page.tsx's own comment for the fuller reasoning.
  const isUserVerified = Boolean(user?.verified);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  // The list view's colours — the Dashboard list's own (its dashboardPalette).
  const leadsListPalette =
    themeMode === "dark"
      ? { panelBg: "#212121", border: "#3f3f46", text: "#f1f1f1", textMuted: "#aaaaaa", textSoft: "#c9d1d9", rowHover: "#2a2a2a" }
      : { panelBg: "#ffffff", border: "#D7DEE8", text: "#111827", textMuted: "#64748B", textSoft: "#475467", rowHover: "#F2F6FC" };
  // The toolbar's colours — the Dashboard toolbar's own (its dashboardPalette), so the two pages match.
  const leadsToolbarPalette =
    themeMode === "dark"
      ? { panelBg: "#212121", border: "#3f3f46", text: "#f1f1f1", textMuted: "#aaaaaa", inputText: "#f1f1f1" }
      : { panelBg: "#ffffff", border: "#D7DEE8", text: "#111827", textMuted: "#64748B", inputText: "#5B6472" };
  const access = useCompanyAccess();
  const activeCompanyId = access.companyId;
  const canAccessLeads = access.status === "ready" && (isOwnerOrAdmin(access.role) || hasPermissionKey(access.permissionKeys, "leads.view"));
  // Opened from Leads' own home-screen icon: just Leads, without the app around it (no sidebars, tab bar,
  // pull-down menu or side drawers — lib/home-screen-app.ts). Not when this person can't see leads, so
  // they aren't left on a dead end.
  const leadsChromeless = useHomeScreenApp() === "leads" && (access.status === "loading" || canAccessLeads);
  const { setChromeHidden } = useAppTabs();
  // Before paint, so the tab bar and sidebar don't flash up for a frame as the app opens.
  useLayoutEffect(() => {
    if (!leadsChromeless) return;
    setChromeHidden(true);
    return () => setChromeHidden(false);
  }, [leadsChromeless, setChromeHidden]);
  const canViewOtherLeads = access.status === "ready" && (isOwnerOrAdmin(access.role) || hasPermissionKey(access.permissionKeys, "leads.view.others"));
  const [leads, setLeads] = useState<CompanyLeadRow[]>([]);
  const [leadDetailsById, setLeadDetailsById] = useState<Record<string, CompanyLeadRow>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [leadsViewMode, setLeadsViewMode] = useState<"board" | "grid">("board");
  // Searching the board slides it over to the first column with a match (once typing pauses); Enter in the
  // search box goes on to the next one (lib/board-search-scroll.ts).
  const searchMatchColumnRef = useRef(-1);
  useEffect(() => {
    if (leadsViewMode !== "board" || !search.trim()) {
      searchMatchColumnRef.current = -1;
      return;
    }
    const timer = window.setTimeout(() => {
      searchMatchColumnRef.current = scrollBoardToSearchMatch(-1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search, leadsViewMode]);

  const [draggingLeadId, setDraggingLeadId] = useState("");
  const [dragOverStatusColumn, setDragOverStatusColumn] = useState("");
  // The column and spot (among its other cards) the dragged lead would land in — shows its preview.
  const [leadDropPreview, setLeadDropPreview] = useState<{ column: string; index: number } | null>(null);
  // Drops still saving, by lead: the 10-second refresh keeps them where they were dropped meanwhile.
  const pendingLeadMovesRef = useRef(new Map<string, Partial<CompanyLeadRow>>());
  const [collapsedStatusColumns, setCollapsedStatusColumns] = useState<Record<string, boolean>>({});
  // This user's own sort choices: per column (the sort button on the column), and for the whole board
  // (the toolbar's Sort — overrides every column while it's set). "custom" = the dragged order.
  const [leadColumnSorts, setLeadColumnSorts] = useState<Record<string, BoardSortMode>>({});
  const [leadBoardSort, setLeadBoardSort] = useState<BoardSortMode>("custom");
  const [isBoardCardsCompact, setIsBoardCardsCompact] = useState(false);
  const [compactCardOverrides, setCompactCardOverrides] = useState<Record<string, boolean>>({});
  const [isToolbarExpanded, setIsToolbarExpanded] = useState(true);
  // Phone: the search circle opening into the full bar as soon as it's touched (the Dashboard's — see its toolbar).
  const [searchOpening, setSearchOpening] = useState(false);
  // Phone (list view): the filter button's status menu or the order button's menu, and where it opens.
  const [leadsPhoneMenu, setLeadsPhoneMenu] = useState<{ kind: "status" | "order"; left: number; top: number; width: number } | null>(null);
  useEffect(() => {
    if (!leadsPhoneMenu) return;
    const close = () => setLeadsPhoneMenu(null);
    // A press outside closes it (the buttons that open it toggle it themselves).
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-leads-phone-menu='true'], [data-leads-phone-menu-trigger='true']")) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [leadsPhoneMenu]);
  const openLeadsPhoneMenu = (kind: "status" | "order", event: ReactMouseEvent<HTMLElement>) => {
    if (leadsPhoneMenu?.kind === kind) {
      setLeadsPhoneMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 200;
    const centeredLeft = rect.left + rect.width / 2 - menuWidth / 2;
    setLeadsPhoneMenu({ kind, left: Math.min(Math.max(8, centeredLeft), window.innerWidth - menuWidth - 8), top: rect.bottom + 4, width: menuWidth });
  };
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
    let nextColumnSorts: Record<string, BoardSortMode> = {};
    let nextBoardSort: BoardSortMode = "custom";
    let nextCompact = false;
    let nextCardOverrides: Record<string, boolean> = {};
    // Toolbar defaults to expanded for anyone who's never touched the
    // handle — the whole point is that it's visible from the start so
    // people discover it, only their own explicit collapse should hide it.
    let nextToolbarExpanded = true;
    // The view they last chose (columns or list) stays until they change it — columns the first time.
    let nextViewMode: "board" | "grid" = "board";
    try {
      const raw = window.localStorage.getItem(leadsBoardPrefsStorageKey(currentUserUid, activeCompanyId));
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") {
        if (parsed.collapsedColumns && typeof parsed.collapsedColumns === "object") {
          nextCollapsed = parsed.collapsedColumns as Record<string, boolean>;
        }
        nextColumnSorts = normalizeBoardColumnSorts(parsed.columnSorts);
        nextBoardSort = normalizeBoardSortMode(parsed.boardSort);
        nextCompact = Boolean(parsed.compactCards);
        if (parsed.compactCardOverrides && typeof parsed.compactCardOverrides === "object") {
          nextCardOverrides = parsed.compactCardOverrides as Record<string, boolean>;
        }
        if (typeof parsed.toolbarExpanded === "boolean") {
          nextToolbarExpanded = parsed.toolbarExpanded;
        }
        if (parsed.viewMode === "board" || parsed.viewMode === "grid") {
          nextViewMode = parsed.viewMode;
        }
      }
    } catch {}
    setCollapsedStatusColumns(nextCollapsed);
    setLeadColumnSorts(nextColumnSorts);
    setLeadBoardSort(nextBoardSort);
    setIsBoardCardsCompact(nextCompact);
    setCompactCardOverrides(nextCardOverrides);
    setIsToolbarExpanded(nextToolbarExpanded);
    setLeadsViewMode(nextViewMode);
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
          columnSorts: leadColumnSorts,
          boardSort: leadBoardSort,
          compactCards: isBoardCardsCompact,
          compactCardOverrides,
          toolbarExpanded: isToolbarExpanded,
          viewMode: leadsViewMode,
        }),
      );
    } catch {}
  }, [collapsedStatusColumns, leadColumnSorts, leadBoardSort, isBoardCardsCompact, compactCardOverrides, isToolbarExpanded, leadsViewMode, boardPrefsHydrated, currentUserUid, activeCompanyId]);
  // The sort choices are saved on the user's own profile (lib/board-sort-prefs.ts), so they follow
  // them to any device — the browser copy above only shows them straight away while that loads.
  // Nothing is saved until the profile's copy has loaded (null), so it's never overwritten unseen.
  const savedLeadSortPrefsRef = useRef<string | null>(null);
  useEffect(() => {
    savedLeadSortPrefsRef.current = null;
    if (!currentUserUid || !activeCompanyId) return;
    let cancelled = false;
    void readBoardSortPrefs(currentUserUid, "leads", activeCompanyId).then((prefs) => {
      if (cancelled) return;
      if (!prefs) {
        savedLeadSortPrefsRef.current = "";
        return;
      }
      savedLeadSortPrefsRef.current = JSON.stringify(prefs);
      setLeadColumnSorts(prefs.columnSorts);
      setLeadBoardSort(prefs.boardSort);
    });
    return () => {
      cancelled = true;
    };
  }, [currentUserUid, activeCompanyId]);
  useEffect(() => {
    if (!currentUserUid || !activeCompanyId || savedLeadSortPrefsRef.current === null) return;
    const prefs = { columnSorts: leadColumnSorts, boardSort: leadBoardSort };
    const serialized = JSON.stringify(prefs);
    if (serialized === savedLeadSortPrefsRef.current) return;
    savedLeadSortPrefsRef.current = serialized;
    void saveBoardSortPrefs(currentUserUid, "leads", activeCompanyId, prefs);
  }, [currentUserUid, activeCompanyId, leadColumnSorts, leadBoardSort]);
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
  // See lib/board-sticky-scroll.ts for the mechanism (position:sticky natively pinning the row +
  // column-height-reveal, plus the shared Left/Right arrow-key handling), and why it no longer
  // forces the page's own overflow to "hidden".
  const boardStickyRef = useBoardStickyRef(leadsViewModeRef, boardCheckRef, { bottomPadPx: 8, phoneBottomPadPx: 20, attachArrowKeyScroll: true });
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
  // Touch-driven pick-up-and-drag for lead cards — native HTML5 draggable/dragstart/dragover never
  // fire from a touch gesture, so the mouse-only drag system above is silently inert on phones.
  // This drives the SAME ghost/status-change plumbing from touch events instead, gated behind a
  // genuine long-press (not a quick tap, which still opens the lead's detail) so tapping a card
  // keeps working and the column's own horizontal snap-scroll / vertical card-list scroll keep
  // working for anything that isn't a deliberate pick-up.
  const LEAD_CARD_LONG_PRESS_MS = 450;
  const LEAD_CARD_MOVE_CANCEL_PX = 10;
  const leadCardTouchRef = useRef<{
    leadId: string;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    dragging: boolean;
    eligible: boolean;
    targetColumn: string;
    targetIndex: number | null;
  } | null>(null);
  // Set right when a touch-drag commits — checked (and cleared) at the top of the card's own
  // onClick so the synthetic click some browsers still fire right after that touchend doesn't ALSO
  // open the lead's detail modal right after dropping it into a new column.
  const suppressNextLeadCardClickRef = useRef("");
  const [listOrder, setListOrder] = useState<"status" | "az" | "za" | "newest" | "oldest">("newest");
  // The list view (the Dashboard's): how many rows a page shows, the row under the pointer, a row's status menu (where it
  // opens), and whether its column headings have stuck under the top bar.
  const [listPageSize, setListPageSize] = useState(20);
  const [hoveredLeadRowId, setHoveredLeadRowId] = useState("");
  const [listStatusMenu, setListStatusMenu] = useState<{ leadId: string; left: number; top: number; width: number } | null>(null);
  const [isLeadsListHeaderStuck, setIsLeadsListHeaderStuck] = useState(false);
  const leadsListHeadRef = useRef<HTMLTableSectionElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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
  const cardStatusMenuOriginElRef = useRef<HTMLElement | null>(null);
  const shouldRenderCardStatusMenu = useGlassModalPopOrigin(Boolean(cardStatusMenuLeadId), cardStatusMenuOrigin, cardStatusMenuPanelRef, {
    duration: 180,
    easing: "cubic-bezier(0.34, 1.35, 0.64, 1)",
  }, cardStatusMenuOriginElRef);
  const lastCardStatusMenuLeadIdRef = useRef("");
  if (cardStatusMenuLeadId) lastCardStatusMenuLeadIdRef.current = cardStatusMenuLeadId;
  const effectiveCardStatusMenuLeadId = shouldRenderCardStatusMenu
    ? cardStatusMenuLeadId || lastCardStatusMenuLeadIdRef.current
    : "";
  // The company's lead forms (Company Settings → Leads; lib/lead-forms.ts) — Create Lead's questions, and how a lead
  // from one of them is shown.
  const [leadForms, setLeadForms] = useState<LeadForm[]>([]);
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
  const leadDetailModalOriginElRef = useRef<HTMLElement | null>(null);
  const assignModalOriginElRef = useRef<HTMLElement | null>(null);
  const deleteConfirmModalOriginElRef = useRef<HTMLElement | null>(null);
  const [assignLeadId, setAssignLeadId] = useState("");
  const shouldRenderLeadDetailModal = useGlassModalPopOrigin(Boolean(selectedLeadId), leadDetailModalOrigin, leadDetailModalPanelRef, undefined, leadDetailModalOriginElRef);
  const shouldRenderAssignModal = useGlassModalPopOrigin(Boolean(assignLeadId), assignModalOrigin, assignModalPanelRef, undefined, assignModalOriginElRef);
  const shouldRenderDeleteConfirmModal = useGlassModalPopOrigin(Boolean(confirmDeleteLeadId), deleteConfirmModalOrigin, deleteConfirmModalPanelRef, undefined, deleteConfirmModalOriginElRef);
  // Create Lead: one of the company's lead forms, filled in by a staff member in a pop-up — plus how the lead came in,
  // its status and who it's assigned to (app/api/leads/manual).
  const [leadFormModalOpen, setLeadFormModalOpen] = useState(false);
  const [leadFormModalOrigin, setLeadFormModalOrigin] = useState<GlassModalOrigin>(null);
  const leadFormModalPanelRef = useRef<HTMLDivElement | null>(null);
  const leadFormModalOriginElRef = useRef<HTMLElement | null>(null);
  const shouldRenderLeadFormModal = useGlassModalPopOrigin(leadFormModalOpen, leadFormModalOrigin, leadFormModalPanelRef, undefined, leadFormModalOriginElRef);
  const [createLeadFormId, setCreateLeadFormId] = useState("");
  const [createLeadAnswers, setCreateLeadAnswers] = useState<LeadFormAnswers>({});
  const [createLeadErrors, setCreateLeadErrors] = useState<Record<string, string>>({});
  const [createLeadSource, setCreateLeadSource] = useState<string>(MANUAL_LEAD_SOURCES[0]);
  const [createLeadStatus, setCreateLeadStatus] = useState("");
  const [createLeadSaving, setCreateLeadSaving] = useState(false);
  const [createLeadMessage, setCreateLeadMessage] = useState("");
  const [assignSearch, setAssignSearch] = useState("");
  const [assignSelectedUid, setAssignSelectedUid] = useState("");
  const [assigningLeadId, setAssigningLeadId] = useState("");
  const [leadImagesLeadId, setLeadImagesLeadId] = useState("");
  const leadImagesModalOriginElRef = useRef<HTMLElement | null>(null);
  const shouldRenderLeadImagesModal = useGlassModalPopOrigin(Boolean(leadImagesLeadId), leadImagesModalOrigin, leadImagesModalPanelRef, undefined, leadImagesModalOriginElRef);
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
  // Same push-nudge + duck-behind-the-pin close treatment as elsewhere — safe here too even
  // though the pin marker's own on-screen position can move (image pan/zoom, cluster expand/
  // collapse) while this popup sits open: the nudge/duck-behind only ever apply a relative
  // transform/z-index to whichever DOM node this ref currently points at, wherever it's since
  // moved to — they never re-measure or depend on its original captured rect.
  const leadImagePinPopupOriginElRef = useRef<HTMLElement | null>(null);
  const leadImagePinPopupShouldRender = useGlassModalPopOrigin(
    Boolean(leadImageActiveAnnotationId),
    leadImagePinPopupOrigin,
    leadImagePinPopupPanelRef,
    undefined,
    leadImagePinPopupOriginElRef,
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

  // What's on screen now, so a refresh that brings nothing new can skip re-rendering the page.
  const shownLeadsRef = useRef(leads);
  useEffect(() => {
    shownLeadsRef.current = leads;
  }, [leads]);
  // Where the leads come from: read straight from Firestore and kept live (subscribeCompanyLeads — "direct", once its
  // first read arrives), or, when this browser can't read them that way (the leads rule not deployed yet, …), from
  // /api/leads, polled ("api"). "pending" until the first direct read answers.
  const [leadsSource, setLeadsSource] = useState<"pending" | "direct" | "api">("pending");
  const leadsSourceRef = useRef(leadsSource);
  // The latest direct read (every lead, before this user's visibility filter), and its first read's outcome (true once
  // it arrives; false if it can't, or takes over 8s) — what loadLeads waits on instead of also asking the server.
  const directLeadsRef = useRef<{ companyId: string; leads: CompanyLeadRow[] } | null>(null);
  const directFirstReadRef = useRef<{ companyId: string; done: Promise<boolean> } | null>(null);
  // Which company / view the direct read was last put on the page for (loadLeads does it once; see there).
  const directAppliedKeyRef = useRef("");

  // Fetched leads onto the page: the ones this user may see (all, or only theirs), with the local sample leads, a
  // board move still saving kept where it was dropped — and saved on this device, to show straight away next visit
  // (lib/last-known.ts; not when they came from there).
  const applyFetchedLeads = useCallback(
    (cid: string, fetched: CompanyLeadRow[], canViewOtherLeadsOverride?: boolean, options?: { fromSaved?: boolean }) => {
      const effectiveCanViewOtherLeads = canViewOtherLeadsOverride ?? canViewOtherLeads;
      const currentSampleLeads =
        sampleLeadsRef.current[cid] ??
        (sampleLeadsRef.current[cid] = readPersistedSampleLeads(cid) ?? buildTemporarySampleLeads(cid));
      const live = fetched.filter((lead) => !lead.isDeleted);
      const visibleLeads = effectiveCanViewOtherLeads
        ? live
        : live.filter((lead) => String(lead.assignedToUid || "").trim() === currentUserUid);
      const visibleSampleLeads = effectiveCanViewOtherLeads
        ? currentSampleLeads
        : currentSampleLeads.filter((lead) => String(lead.assignedToUid || "").trim() === currentUserUid);
      const fetchedLeads2 = [...visibleSampleLeads, ...visibleLeads];
      // A lead dropped on the board a moment ago stays where it was dropped while that save is on its way.
      const pendingMoves = pendingLeadMovesRef.current;
      const nextLeads = pendingMoves.size
        ? fetchedLeads2.map((lead) => {
            const move = pendingMoves.get(lead.id);
            return move ? { ...lead, ...move } : lead;
          })
        : fetchedLeads2;
      if (JSON.stringify(nextLeads) === JSON.stringify(shownLeadsRef.current)) return;
      if (!options?.fromSaved) saveLastKnown(`leads:list:${cid}`, currentUserUid, visibleLeads);
      setLeads(nextLeads);
      setLeadDetailsById((current) => {
        const nextIds = new Set(nextLeads.map((lead) => String(lead.id || "").trim()).filter(Boolean));
        const nextEntries = Object.entries(current).filter(([id]) => nextIds.has(id));
        return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
      });
    },
    [canViewOtherLeads, currentUserUid],
  );
  const applyFetchedLeadsRef = useRef(applyFetchedLeads);
  useEffect(() => {
    applyFetchedLeadsRef.current = applyFetchedLeads;
  }, [applyFetchedLeads]);

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
    // Read directly (and kept live): its first read's still on its way — wait for it rather than also asking the
    // server; once it's in, it goes on the page (with the sample leads) once — after that the live read brings each
    // change itself, so a refresh after a save doesn't put back what was on the page before the save.
    const firstDirectRead = directFirstReadRef.current;
    if (leadsSourceRef.current === "pending" && firstDirectRead?.companyId === cid) await firstDirectRead.done;
    const direct = directLeadsRef.current;
    if (leadsSourceRef.current === "direct" && direct?.companyId === cid) {
      const appliedKey = `${cid}|${effectiveCanViewOtherLeads}|${currentUserUid}`;
      if (directAppliedKeyRef.current === appliedKey) return;
      directAppliedKeyRef.current = appliedKey;
      applyFetchedLeads(cid, direct.leads, effectiveCanViewOtherLeads);
      return;
    }
    try {
      const response = await retryAsync(
        () =>
          authorizedFetch(`/api/leads?companyId=${encodeURIComponent(cid)}&mode=summary`, {
            method: "GET",
            cache: "no-store",
          }),
        { attempts: 2, delayMs: 300 },
      );
      const detail = (await response.json().catch(() => null)) as
        | { ok?: boolean; leads?: CompanyLeadRow[] }
        | null;
      applyFetchedLeads(cid, response.ok && Array.isArray(detail?.leads) ? detail.leads : [], effectiveCanViewOtherLeads);
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
  }, [applyFetchedLeads, canViewOtherLeads, currentUserUid]);

  // The leads, read straight from Firestore and kept live — started as soon as the company's known (this device's
  // last company while access is still being checked), not after access. They go on the page once access says this
  // user may see leads (the run below, via loadLeads); a later change goes straight on. If this browser can't read
  // them directly, the page asks /api/leads instead (and polls it).
  const accessReadyForLeadsRef = useRef(false);
  useEffect(() => {
    accessReadyForLeadsRef.current = access.status === "ready" && canAccessLeads;
  }, [access.status, canAccessLeads]);
  const leadsCompanyIdRef = useRef("");
  useEffect(() => {
    leadsCompanyIdRef.current = activeCompanyId;
  }, [activeCompanyId]);
  const [storedLeadsCompanyId] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim();
    } catch {
      return "";
    }
  });
  const leadsListenCompanyId = activeCompanyId || (access.status === "loading" ? storedLeadsCompanyId : "");
  const setLeadsSourceBoth = useCallback((next: "pending" | "direct" | "api") => {
    leadsSourceRef.current = next;
    setLeadsSource(next);
  }, []);
  useEffect(() => {
    const cid = leadsListenCompanyId;
    if (!cid || !currentUserUid) return;
    let active = true;
    let settle: (ok: boolean) => void = () => {};
    const done = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    // No first read in 8s: ask the server (and poll it) meanwhile — a read that turns up later still takes over.
    const timer = window.setTimeout(() => {
      if (!active) return;
      if (leadsSourceRef.current === "pending") setLeadsSourceBoth("api");
      settle(false);
    }, 8000);
    directFirstReadRef.current = { companyId: cid, done };
    directLeadsRef.current = null;
    directAppliedKeyRef.current = "";
    setLeadsSourceBoth("pending");
    const unsubscribe = subscribeCompanyLeads(
      cid,
      (rows) => {
        if (!active) return;
        directLeadsRef.current = { companyId: cid, leads: rows };
        setLeadsSourceBoth("direct");
        window.clearTimeout(timer);
        settle(true);
        // Access already says this user may see leads: straight onto the page (else the run below puts the first
        // read on, via loadLeads, once it does).
        if (accessReadyForLeadsRef.current && leadsCompanyIdRef.current === cid) applyFetchedLeadsRef.current(cid, rows);
      },
      () => {
        if (!active) return;
        setLeadsSourceBoth("api");
        window.clearTimeout(timer);
        settle(false);
      },
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
      settle(false);
      unsubscribe();
    };
  }, [currentUserUid, leadsListenCompanyId, setLeadsSourceBoth]);

  useEffect(() => {
    // Access itself is still loading/erroring — the render below is driven by access.status
    // directly; nothing to fetch here yet (see canAccessLeads/canViewOtherLeads above, both
    // derived from `access`).
    if (access.status !== "ready") {
      return;
    }
    if (activeCompanyId && !sampleLeadsRef.current[activeCompanyId]) {
      sampleLeadsRef.current[activeCompanyId] = readPersistedSampleLeads(activeCompanyId) ?? buildTemporarySampleLeads(activeCompanyId);
      persistSampleLeads(activeCompanyId, sampleLeadsRef.current[activeCompanyId]);
    }
    if (!activeCompanyId) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    // The company's lead set-up the page needs: its theme colour, lead forms, lead statuses and card fields.
    const applyLeadsCompanyDoc = (companyDoc: Record<string, unknown> | null) => {
      setCompanyThemeColor(String(companyDoc?.themeColor || "").trim() || "#2F6BFF");
      setLeadForms(normalizeLeadForms(companyDoc?.leadForms));
      setLeadStatusRows(normalizeLeadStatuses(companyDoc?.leadStatuses));
      setFieldLayout(
        normalizeLeadFieldLayout(
          ((companyDoc?.integrations as Record<string, unknown> | undefined)?.zapierLeads as Record<string, unknown> | undefined)?.fieldLayout,
        ),
      );
    };
    // Straight away: what this device last showed for this company (its leads and their set-up) — then refreshed
    // below, re-rendering only what changed (lib/last-known.ts).
    const savedCompany = readLastKnown<Record<string, unknown>>(`leads:company:${activeCompanyId}`, currentUserUid);
    const savedLeads = canAccessLeads ? readLastKnown<CompanyLeadRow[]>(`leads:list:${activeCompanyId}`, currentUserUid) : null;
    if (savedCompany && Array.isArray(savedLeads)) {
      applyLeadsCompanyDoc(savedCompany);
      applyFetchedLeads(activeCompanyId, savedLeads, canViewOtherLeads, { fromSaved: true });
      setIsLoading(false);
    }
    const run = async () => {
      const leadsLoad = canAccessLeads
        ? loadLeads(activeCompanyId, canViewOtherLeads).catch(() => {
            if (!cancelled) setLeads([]);
          })
        : null;
      try {
        const [companyDoc, userColorMap] = await retryAsync(
          () =>
            Promise.all([
              fetchCompanyDoc(activeCompanyId),
              user?.uid ? fetchUserColorMapByUids([user.uid], activeCompanyId) : Promise.resolve({} as Record<string, string>),
            ]),
          { attempts: 2, delayMs: 250 },
        );
        if (cancelled) return;
        const doc = (companyDoc ?? null) as Record<string, unknown> | null;
        applyLeadsCompanyDoc(doc);
        setCurrentUserPinColor(String(userColorMap[String(user?.uid || "").trim()] || "").trim());
        // Kept for next time (just the parts above).
        saveLastKnown(`leads:company:${activeCompanyId}`, currentUserUid, {
          themeColor: doc?.themeColor ?? "",
          leadForms: doc?.leadForms ?? [],
          leadStatuses: doc?.leadStatuses ?? [],
          integrations: { zapierLeads: { fieldLayout: ((doc?.integrations as Record<string, unknown> | undefined)?.zapierLeads as Record<string, unknown> | undefined)?.fieldLayout ?? [] } },
        });
        if (!canAccessLeads) {
          setLeads([]);
          return;
        }
        await leadsLoad;
      } catch {
        if (!cancelled) {
          setLeads([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [access.status, activeCompanyId, applyFetchedLeads, canAccessLeads, canViewOtherLeads, currentUserUid, loadLeads, user?.uid]);

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
        if (leadsSourceRef.current !== "api") {
          const direct = await fetchCompanyLeadDirect(activeCompanyId, id);
          if (direct === null) return null;
          if (direct) {
            if (!canViewOtherLeads && String(direct.assignedToUid || "").trim() !== currentUserUid) return null;
            setLeadDetailsById((current) => ({ ...current, [id]: direct }));
            return direct;
          }
        }
        const response = await authorizedFetch(
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

  // Only when the leads come from /api/leads — read directly, they're kept live already.
  useEffect(() => {
    if (access.status !== "ready" || !canAccessLeads || !activeCompanyId || leadsSource !== "api") return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void loadLeads(activeCompanyId);
    }, 10000);
    return () => window.clearInterval(intervalId);
  }, [access.status, activeCompanyId, canAccessLeads, leadsSource, loadLeads]);

  useEffect(() => {
    if (!selectedLeadId) return;
    void loadLeadDetail(selectedLeadId);
  }, [loadLeadDetail, selectedLeadId]);

  useEffect(() => {
    if (!cardStatusMenuLeadId) return;
    const handleOutsideClick = (e: PointerEvent) => {
      if (cardStatusMenuRef.current && !cardStatusMenuRef.current.contains(e.target as Node)) {
        setCardStatusMenuLeadId("");
        // That press only closes the menu — it doesn't also open the card (or anything else) it landed on.
        swallowNextClick();
      }
    };
    document.addEventListener("pointerdown", handleOutsideClick);
    return () => document.removeEventListener("pointerdown", handleOutsideClick);
  }, [cardStatusMenuLeadId]);

  useEffect(() => {
    if (!leadImagesLeadId) return;
    void loadLeadDetail(leadImagesLeadId);
  }, [leadImagesLeadId, loadLeadDetail]);

  const availableFields = useMemo(() => {
    const seen = new Set<string>();
    const columns: Array<{ key: string; label: string }> = [];
    for (const lead of leads) {
      // A lead from one of the company's own forms, or its leads email inbox, has a layout of its own
      // (fieldLayoutForLead).
      if (lead.formId || lead.source === "email") continue;
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
  // How a lead's fields are shown — its card, its pop-up, its name, what it fills in on a project. A lead from one of
  // the company's lead forms: that form's questions (lib/lead-forms.ts), then any answers it has to questions since
  // taken out; one whose form has since been deleted: its own answers, as they were filed. A lead from the leads email
  // inbox (app/api/leads/email-inbound): who it's from and how to reach them, the subject, anything else the email
  // said, then the message — its phone and subject on its card. Any other lead: the Zapier field layout above.
  const leadFormsById = useMemo(() => new Map(leadForms.map((form) => [form.id, form] as const)), [leadForms]);
  const fieldLayoutForLead = useCallback(
    (lead: CompanyLeadRow | null | undefined): LeadFieldLayoutRow[] => {
      const formId = String(lead?.formId || "").trim();
      if (lead && !formId && lead.source === "email") {
        const order = ["name", "email", "phone", "address", "subject"];
        const last = ["attachments", "message"];
        const rank = (key: string) => {
          const normalized = normalizeLeadFieldKey(key);
          if (order.includes(normalized)) return order.indexOf(normalized);
          if (last.includes(normalized)) return 100 + last.indexOf(normalized);
          return 50;
        };
        const targets: Record<string, LeadProjectFieldTarget> = {
          name: "clientName",
          email: "clientEmail",
          phone: "clientPhone",
          address: "projectAddress",
          message: "projectNotes",
        };
        return getLeadDynamicFields(lead)
          .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key))
          .map((field, index) => ({
            key: field.key,
            label: field.label,
            showInRow: ["phone", "subject"].includes(normalizeLeadFieldKey(field.key)),
            showInDetail: true,
            order: index,
            projectFieldTarget: targets[normalizeLeadFieldKey(field.key)] ?? "",
          }));
      }
      if (!lead || !formId) return mergedFieldLayout;
      const form = leadFormsById.get(formId);
      const rows: LeadFieldLayoutRow[] = form ? leadFormFieldLayout(form, lead.formFieldKeys) : [];
      const known = new Set(rows.map((row) => normalizeLeadFieldKey(row.key)));
      for (const field of getLeadDynamicFields(lead)) {
        const normalized = normalizeLeadFieldKey(field.key);
        if (known.has(normalized)) continue;
        known.add(normalized);
        rows.push({ key: field.key, label: field.label, showInRow: !form && rows.length < 2, showInDetail: true, order: rows.length, projectFieldTarget: "" });
      }
      return rows;
    },
    [leadFormsById, mergedFieldLayout],
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
        const derivedName = leadClientName(fields, fieldLayoutForLead(lead));
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
  }, [fieldLayoutForLead, leads, listOrder, search, statusFilter]);

  // The list view shows a page of rows at a time, the next page coming in as it's scrolled near the bottom (or straight
  // away while there's nothing to scroll) — back to one page whenever the search, filter, order or page size changes.
  const listRevealKey = `${search}|${statusFilter}|${listOrder}|${listPageSize}`;
  const [listReveal, setListReveal] = useState({ key: "", count: 20 });
  const listVisibleCount = listReveal.key === listRevealKey ? listReveal.count : listPageSize;
  const visibleListLeads = useMemo(() => filteredLeads.slice(0, listVisibleCount), [filteredLeads, listVisibleCount]);
  useEffect(() => {
    if (leadsViewMode !== "grid") return;
    let ticking = false;
    const loadOneMore = () =>
      setListReveal((prev) => {
        const current = prev.key === listRevealKey ? prev.count : listPageSize;
        return current >= filteredLeads.length ? prev : { key: listRevealKey, count: Math.min(filteredLeads.length, current + listPageSize) };
      });
    // Whichever is scrolling — the page (desktop) or <main> (below 1024px).
    const nearBottom = () => {
      const main = document.querySelector("main");
      const pageNear = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 600;
      const mainNear = Boolean(main && main.scrollHeight > main.clientHeight && main.scrollTop + main.clientHeight >= main.scrollHeight - 600);
      return pageNear || mainNear;
    };
    const check = () => {
      ticking = false;
      if (nearBottom()) loadOneMore();
      setIsLeadsListHeaderStuck(Boolean(leadsListHeadRef.current && leadsListHeadRef.current.getBoundingClientRect().top <= 49));
    };
    const onScrollOrResize = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(check);
    };
    const first = window.requestAnimationFrame(check);
    const main = document.querySelector("main");
    const canScroll = document.documentElement.scrollHeight > window.innerHeight + 40 || Boolean(main && main.scrollHeight > main.clientHeight + 40);
    const noScrollbarTimer = !canScroll && listVisibleCount < filteredLeads.length ? window.setTimeout(loadOneMore, 200) : null;
    document.addEventListener("scroll", onScrollOrResize, { capture: true, passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.cancelAnimationFrame(first);
      if (noScrollbarTimer) window.clearTimeout(noScrollbarTimer);
      document.removeEventListener("scroll", onScrollOrResize, { capture: true });
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [leadsViewMode, filteredLeads.length, listPageSize, listVisibleCount, listRevealKey]);
  // A row's status menu: a click anywhere else closes it.
  useEffect(() => {
    if (!listStatusMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-lead-status-menu='true'], [data-lead-status-trigger='true']")) return;
      setListStatusMenu(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [listStatusMenu]);
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

  // What a lead is sorted by: its dragged place, its date, and the name shown on its card.
  const leadSortInfo = useCallback(
    (lead: CompanyLeadRow): BoardCardSortInfo => ({
      key: leadBoardKey(lead),
      dateMs: leadDateMs(lead),
      name: leadClientName(getLeadDynamicFields(lead), fieldLayoutForLead(lead)) || lead.name || lead.email || lead.phone || "",
    }),
    [fieldLayoutForLead],
  );
  // A column's order for this user: the board-wide sort while one is set, else the column's own.
  const leadColumnSortFor = (columnName: string): BoardSortMode =>
    leadBoardSort !== "custom" ? leadBoardSort : leadColumnSorts[columnName] ?? "custom";
  const leadStatusBoardColumns = useMemo(() => {
    const columns = leadStatusRows.map((row) => ({ name: row.name, color: row.color, leads: [] as CompanyLeadRow[] }));
    const byKey = new Map(columns.map((col) => [col.name.trim().toLowerCase(), col]));
    const otherLeads: CompanyLeadRow[] = [];
    for (const lead of searchFilteredLeads) {
      const col = byKey.get(String(lead.status || "").trim().toLowerCase());
      if (col) col.leads.push(lead);
      else otherLeads.push(lead);
    }
    for (const col of columns) {
      col.leads = sortBoardCards(col.leads, leadBoardSort !== "custom" ? leadBoardSort : leadColumnSorts[col.name] ?? "custom", leadSortInfo);
    }
    return { columns, otherLeads: sortBoardCards(otherLeads, leadBoardSort, leadSortInfo) };
  }, [searchFilteredLeads, leadStatusRows, leadBoardSort, leadColumnSorts, leadSortInfo]);

  const newCount = filteredLeads.filter((lead) => String(lead.status || "").trim().toLowerCase() === "new").length;
  // The stat cards: on or off with User Settings' Stat Cards (the Dashboard's own switch).
  const [leadStatCardsEnabled, setLeadStatCardsEnabled] = useState(true);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setLeadStatCardsEnabled(readDashboardStatCardsEnabled()));
    const onUpdated = (event: Event) => setLeadStatCardsEnabled((event as CustomEvent<{ enabled: boolean }>).detail?.enabled ?? true);
    window.addEventListener(DASHBOARD_STAT_CARDS_UPDATED_EVENT, onUpdated as EventListener);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener(DASHBOARD_STAT_CARDS_UPDATED_EVENT, onUpdated as EventListener);
    };
  }, []);
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
  // Their numbers, from every lead (not the search or filter): active — not converted, nor closed without converting;
  // new — in the first status (New); converted; and unassigned — active ones with no one assigned. "+ N this week":
  // those that came in since Monday (converted ones: changed since Monday).
  const leadStats = useMemo(() => {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    const since = (iso: string | undefined) => {
      const ms = Date.parse(String(iso || ""));
      return Number.isFinite(ms) && ms >= weekStart.getTime();
    };
    const statusOf = (lead: CompanyLeadRow) => String(lead.status || "").trim();
    const firstStatus = String(leadStatusOptions[0] || "New").trim().toLowerCase();
    const converted = leads.filter((lead) => LEAD_CONVERTED_STATUS.test(statusOf(lead)));
    const active = leads.filter((lead) => !LEAD_CONVERTED_STATUS.test(statusOf(lead)) && !LEAD_CLOSED_STATUS.test(statusOf(lead)));
    const fresh = leads.filter((lead) => (statusOf(lead).toLowerCase() || firstStatus) === firstStatus);
    const received = (lead: CompanyLeadRow) => since(lead.createdAtIso || lead.submittedAtIso);
    const unassigned = active.filter((lead) => !String(lead.assignedToUid || lead.assignedToName || lead.assignedTo || "").trim());
    return {
      values: {
        active: String(active.length),
        new: String(fresh.length),
        converted: String(converted.length),
        unassigned: String(unassigned.length),
      },
      weekly: {
        active: active.filter(received).length,
        new: fresh.filter(received).length,
        converted: converted.filter((lead) => since(lead.updatedAtIso)).length,
        unassigned: unassigned.filter(received).length,
      },
    };
  }, [leads, leadStatusOptions]);
  // The status column fits the longest status name (the Dashboard's sizing).
  const listStatusPillWidthPx = useMemo(() => {
    const maxLen = leadStatusOptions.reduce((max, name) => Math.max(max, String(name || "").trim().length), 0);
    return maxLen === 0 ? 120 : Math.ceil(maxLen * 7) + 40;
  }, [leadStatusOptions]);
  const listStatusColumnWidthPx = listStatusPillWidthPx + 20;
  // A row's status pill: opens its status menu just under it (or above, without room below), as the Dashboard's.
  const openListStatusMenu = (event: ReactMouseEvent<HTMLElement>, lead: CompanyLeadRow) => {
    event.stopPropagation();
    if (statusUpdatingLeadId === lead.id) return;
    if (listStatusMenu?.leadId === lead.id) {
      setListStatusMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const isPhoneMenu = window.matchMedia("(max-width: 767px)").matches;
    const estimatedMenuHeight = leadStatusOptions.length * (isPhoneMenu ? 50 : 38) + 8;
    const hasRoomBelow = rect.bottom + estimatedMenuHeight <= window.innerHeight - 8;
    const hasRoomAbove = rect.top - estimatedMenuHeight >= 8;
    const menuWidth = Math.max(isPhoneMenu ? 170 : 120, Math.round(rect.width));
    setListStatusMenu({
      leadId: lead.id,
      left: Math.min(Math.max(8, rect.left), window.innerWidth - menuWidth - 8),
      top: !hasRoomBelow && hasRoomAbove ? Math.max(8, rect.top - estimatedMenuHeight - 4) : rect.bottom + 4,
      width: menuWidth,
    });
  };
  const openLeadFromListRow = (element: HTMLElement, lead: CompanyLeadRow) => {
    leadDetailModalOriginElRef.current = element;
    const rect = element.getBoundingClientRect();
    setLeadDetailModalOrigin({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    setSelectedLeadId(lead.id);
  };

  const leadStatusPillStyle = (statusLabel: string) => {
    const configured = leadStatusColorByName.get(String(statusLabel || "").trim().toLowerCase());
    if (configured) {
      return { backgroundColor: configured, color: contrastTextForFill(configured, 0.75) };
    }
    return statusPillColors(statusLabel);
  };
  const assignLead = useMemo(
    () => getLeadById(assignLeadId),
    [assignLeadId, getLeadById],
  );
  const assignLeadName = useMemo(() => {
    if (!assignLead) return "Untitled Lead";
    return leadClientName(getLeadDynamicFields(assignLead), fieldLayoutForLead(assignLead)) || assignLead.name || "Untitled Lead";
  }, [assignLead, fieldLayoutForLead]);
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
    ? leadClientName(getLeadDynamicFields(leadImagesLead), fieldLayoutForLead(leadImagesLead)) || leadImagesLead.name || "Untitled Lead"
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
  // event, same pattern already used by dashboard/company-settings/app-shell.
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
      const response = await authorizedFetch("/api/leads", {
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
      const response = await authorizedFetch("/api/leads", {
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
  // The lead pop-up's field being edited (its pencil, on hover): which lead, which field (its column key) and the text
  // being typed — null when none is.
  const [leadFieldEdit, setLeadFieldEdit] = useState<{ leadId: string; key: string; value: string } | null>(null);
  const [leadFieldSaving, setLeadFieldSaving] = useState(false);
  const [leadFieldError, setLeadFieldError] = useState("");
  // Esc: the field closes without its leaving then saving it.
  const leadFieldEditCancelledRef = useRef(false);

  // Saves the field being edited: into the answer it's shown from (the same rawFields key, whatever its case or
  // spacing — or a new one under the column's key), with the lead's name / email / phone worked out again (the card,
  // list, archive and notifications read those). Unchanged: it just closes.
  const saveLeadFieldEdit = async (lead: CompanyLeadRow, column: LeadFieldLayoutRow, layout: LeadFieldLayoutRow[]) => {
    const edit = leadFieldEdit;
    if (!edit || edit.leadId !== lead.id || edit.key !== column.key || leadFieldSaving || !isUserVerified) return;
    // Closes this field — unless another one has been opened since.
    const closeThis = () => setLeadFieldEdit((prev) => (prev && prev.leadId === lead.id && prev.key === column.key ? null : prev));
    const raw = (lead.rawFields ?? {}) as Record<string, unknown>;
    const next = edit.value.trim();
    if (next === resolveLeadColumnValue(getLeadDynamicFields(lead), column, layout).trim()) {
      closeThis();
      return;
    }
    const rawKey = Object.keys(raw).find((key) => normalizeLeadFieldKey(key) === normalizeLeadFieldKey(column.key)) ?? column.key;
    const fieldsPatch: Record<string, string> = { [rawKey]: next };
    const nextLead: CompanyLeadRow = { ...lead, rawFields: { ...raw, ...fieldsPatch } };
    const details = leadListDetails(nextLead, layout);
    const contact = {
      name: leadClientName(getLeadDynamicFields(nextLead), layout) || lead.name || "",
      email: details.email,
      phone: details.phone,
    };
    const updatedAtIso = new Date().toISOString();
    const apply = (row: CompanyLeadRow): CompanyLeadRow =>
      row.id === lead.id ? { ...row, rawFields: { ...((row.rawFields ?? {}) as Record<string, unknown>), ...fieldsPatch }, ...contact, updatedAtIso } : row;
    const applyEverywhere = () => {
      setLeads((prev) => prev.map(apply));
      setLeadDetailsById((prev) => (prev[lead.id] ? { ...prev, [lead.id]: apply(prev[lead.id]) } : prev));
    };
    if (isTemporarySampleLead(lead)) {
      sampleLeadsRef.current[lead.companyId] = (sampleLeadsRef.current[lead.companyId] || []).map(apply);
      persistSampleLeads(lead.companyId, sampleLeadsRef.current[lead.companyId]);
      applyEverywhere();
      closeThis();
      return;
    }
    setLeadFieldSaving(true);
    setLeadFieldError("");
    const response = await authorizedFetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: lead.companyId, leadId: lead.id, fieldsPatch, ...contact }),
    }).catch(() => null);
    setLeadFieldSaving(false);
    if (!response?.ok) {
      setLeadFieldError("Couldn't save — try again.");
      return;
    }
    applyEverywhere();
    closeThis();
  };

  // The lead pop-up's Notes: the note being written (for which lead), adding one, its error, and the note whose delete
  // is waiting for its second click (and the one being deleted).
  const [leadNoteDraft, setLeadNoteDraft] = useState<{ leadId: string; text: string }>({ leadId: "", text: "" });
  const [leadNoteSaving, setLeadNoteSaving] = useState(false);
  const [leadNoteError, setLeadNoteError] = useState<{ leadId: string; message: string }>({ leadId: "", message: "" });
  const [confirmDeleteLeadNoteId, setConfirmDeleteLeadNoteId] = useState("");
  const [deletingLeadNoteId, setDeletingLeadNoteId] = useState("");

  // A change to a lead's notes, onto the page (its list row, its opened details and — a sample lead — its saved copy).
  const applyLeadNotes = (lead: CompanyLeadRow, update: (notes: LeadNote[]) => LeadNote[]) => {
    const apply = (row: CompanyLeadRow): CompanyLeadRow => (row.id === lead.id ? { ...row, notes: update(row.notes ?? []) } : row);
    if (isTemporarySampleLead(lead)) {
      sampleLeadsRef.current[lead.companyId] = (sampleLeadsRef.current[lead.companyId] || []).map(apply);
      persistSampleLeads(lead.companyId, sampleLeadsRef.current[lead.companyId]);
    }
    setLeads((prev) => prev.map(apply));
    setLeadDetailsById((prev) => (prev[lead.id] ? { ...prev, [lead.id]: apply(prev[lead.id]) } : prev));
  };

  // Adds the note being written — who wrote it and when are the server's (a sample lead's stay on this device).
  const addLeadNote = async (lead: CompanyLeadRow) => {
    const text = leadNoteDraft.leadId === lead.id ? leadNoteDraft.text.trim() : "";
    if (!text || leadNoteSaving || !isUserVerified) return;
    setLeadNoteError({ leadId: "", message: "" });
    if (isTemporarySampleLead(lead)) {
      const note: LeadNote = {
        id: `note_${Date.now().toString(36)}`,
        text,
        createdAtIso: new Date().toISOString(),
        createdByUid: currentUserUid,
        createdByName: String(user?.displayName || "").trim(),
      };
      applyLeadNotes(lead, (notes) => [...notes, note]);
      setLeadNoteDraft({ leadId: lead.id, text: "" });
      return;
    }
    setLeadNoteSaving(true);
    const response = await authorizedFetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: lead.companyId, leadId: lead.id, addNote: text }),
    }).catch(() => null);
    const detail = (await response?.json().catch(() => null)) as { ok?: boolean; note?: LeadNote } | null;
    setLeadNoteSaving(false);
    const added = detail?.note;
    if (!response?.ok || !added) {
      setLeadNoteError({ leadId: lead.id, message: "Couldn't add the note — try again." });
      return;
    }
    // (The live list may have brought it already.)
    applyLeadNotes(lead, (notes) => (notes.some((note) => note.id === added.id) ? notes : [...notes, added]));
    setLeadNoteDraft((prev) => (prev.leadId === lead.id && prev.text.trim() === text ? { leadId: lead.id, text: "" } : prev));
  };

  const deleteLeadNote = async (lead: CompanyLeadRow, note: LeadNote) => {
    if (deletingLeadNoteId || !isUserVerified) return;
    setConfirmDeleteLeadNoteId("");
    setLeadNoteError({ leadId: "", message: "" });
    if (isTemporarySampleLead(lead)) {
      applyLeadNotes(lead, (notes) => notes.filter((row) => row.id !== note.id));
      return;
    }
    setDeletingLeadNoteId(note.id);
    const response = await authorizedFetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: lead.companyId, leadId: lead.id, deleteNoteId: note.id }),
    }).catch(() => null);
    setDeletingLeadNoteId("");
    if (!response?.ok) {
      setLeadNoteError({ leadId: lead.id, message: "Couldn't delete the note — try again." });
      return;
    }
    applyLeadNotes(lead, (notes) => notes.filter((row) => row.id !== note.id));
  };

  // The lead pop-up's Checklists: this user's saved checklists (User Settings) to add from — read when a lead's opened
  // (null until then) — the checklist whose remove is waiting for its second click, and an error.
  const [leadChecklistTemplates, setLeadChecklistTemplates] = useState<ChecklistTemplate[] | null>(null);
  const [confirmRemoveLeadChecklistId, setConfirmRemoveLeadChecklistId] = useState("");
  const [leadChecklistError, setLeadChecklistError] = useState<{ leadId: string; message: string }>({ leadId: "", message: "" });
  const isLeadPopupOpen = Boolean(selectedLeadId);
  useEffect(() => {
    if (!isLeadPopupOpen || !currentUserUid) return;
    let cancelled = false;
    void fetchChecklistTemplates(currentUserUid).then((templates) => {
      if (!cancelled) setLeadChecklistTemplates(templates);
    });
    return () => {
      cancelled = true;
    };
  }, [currentUserUid, isLeadPopupOpen]);

  // A lead's checklists as shown (its list row — kept live — else its opened details).
  const leadChecklistsOf = (lead: CompanyLeadRow) => (leads.find((row) => row.id === lead.id) ?? lead).checklists ?? [];
  // A change to them onto the page (its list row, its opened details and — a sample lead — its saved copy).
  const applyLeadChecklists = (lead: CompanyLeadRow, update: (checklists: ProjectChecklist[]) => ProjectChecklist[]) => {
    const apply = (row: CompanyLeadRow): CompanyLeadRow => (row.id === lead.id ? { ...row, checklists: update(row.checklists ?? []) } : row);
    if (isTemporarySampleLead(lead)) {
      sampleLeadsRef.current[lead.companyId] = (sampleLeadsRef.current[lead.companyId] || []).map(apply);
      persistSampleLeads(lead.companyId, sampleLeadsRef.current[lead.companyId]);
    }
    setLeads((prev) => prev.map(apply));
    setLeadDetailsById((prev) => (prev[lead.id] ? { ...prev, [lead.id]: apply(prev[lead.id]) } : prev));
  };
  // Each change shows straight away, then is saved; if it can't be, just that change is undone (`revert`).
  const saveLeadChecklistOp = async (
    lead: CompanyLeadRow,
    op: Record<string, unknown>,
    revert: (checklists: ProjectChecklist[]) => ProjectChecklist[],
    failMessage: string,
  ) => {
    if (isTemporarySampleLead(lead)) return;
    const response = await authorizedFetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: lead.companyId, leadId: lead.id, checklistOp: op }),
    }).catch(() => null);
    if (response?.ok) return;
    applyLeadChecklists(lead, revert);
    setLeadChecklistError({ leadId: lead.id, message: failMessage });
  };

  // Adds a copy of one of this user's saved checklists, every item unticked (as a project does).
  const addLeadChecklistFromTemplate = (lead: CompanyLeadRow, template: ChecklistTemplate) => {
    if (!isUserVerified) return;
    setLeadChecklistError({ leadId: "", message: "" });
    if (leadChecklistsOf(lead).length >= 20) {
      setLeadChecklistError({ leadId: lead.id, message: "A lead can have up to 20 checklists." });
      return;
    }
    const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const checklist: ProjectChecklist = {
      id: `checklist_${suffix()}`,
      name: template.name,
      items: template.items.map((item) => ({ id: `item_${suffix()}`, text: item.text, checked: false })),
      addedAt: new Date().toISOString(),
    };
    applyLeadChecklists(lead, (rows) => [...rows, checklist]);
    void saveLeadChecklistOp(
      lead,
      { type: "add", checklist },
      (rows) => rows.filter((row) => row.id !== checklist.id),
      "Couldn't add the checklist — try again.",
    );
  };

  const toggleLeadChecklistItem = (lead: CompanyLeadRow, checklistId: string, itemId: string) => {
    if (!isUserVerified) return;
    const item = leadChecklistsOf(lead).find((row) => row.id === checklistId)?.items.find((row) => row.id === itemId);
    if (!item) return;
    setLeadChecklistError({ leadId: "", message: "" });
    const setChecked = (checked: boolean) => (rows: ProjectChecklist[]) =>
      rows.map((row) =>
        row.id === checklistId ? { ...row, items: row.items.map((entry) => (entry.id === itemId ? { ...entry, checked } : entry)) } : row,
      );
    applyLeadChecklists(lead, setChecked(!item.checked));
    void saveLeadChecklistOp(lead, { type: "check", checklistId, itemId, checked: !item.checked }, setChecked(item.checked), "Couldn't save that — try again.");
  };

  const removeLeadChecklist = (lead: CompanyLeadRow, checklistId: string) => {
    if (!isUserVerified) return;
    const current = leadChecklistsOf(lead);
    const index = current.findIndex((row) => row.id === checklistId);
    if (index < 0) return;
    const removed = current[index];
    setConfirmRemoveLeadChecklistId("");
    setLeadChecklistError({ leadId: "", message: "" });
    applyLeadChecklists(lead, (rows) => rows.filter((row) => row.id !== checklistId));
    void saveLeadChecklistOp(
      lead,
      { type: "remove", checklistId },
      (rows) => (rows.some((row) => row.id === checklistId) ? rows : [...rows.slice(0, index), removed, ...rows.slice(index)]),
      "Couldn't remove the checklist — try again.",
    );
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
    const response = await authorizedFetch("/api/leads", {
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
      leadClientName(getLeadDynamicFields(lead), fieldLayoutForLead(lead)) ||
      lead.name || lead.email || lead.phone || "Untitled Lead";
    const color = String(leadStatusPillStyle(lead.status || "New").backgroundColor || "");
    leadBoardDragGhost.spawn(event, `lead-board-name-${lead.id}`, { label: displayName, color });
  };

  const onLeadBoardCardDragEnd = () => {
    setDraggingLeadId("");
    setDragOverStatusColumn("");
    setLeadDropPreview(null);
    // Its copy glides onto the card's spot — where it was dropped, or back where it was.
    leadBoardDragGhost.end(draggingLeadId);
  };

  // A lead dropped on the board moves straight away — into the column it was dropped on, at the
  // exact spot (dropIndex: among that column's other cards; null for a collapsed column, where it
  // only changes status and keeps its place by date) — and saves in the background, going back only
  // if that save fails. (It used to wait for the save before moving, then reload every lead, and
  // ignored any other drop made while a save was still going.)
  const moveLeadOnBoard = async (lead: CompanyLeadRow, statusName: string, dropIndex: number | null) => {
    if (!statusName || !isUserVerified) return;
    const sameStatus = String(lead.status || "").trim().toLowerCase() === statusName.trim().toLowerCase();
    const columnLeads =
      leadStatusBoardColumns.columns.find((col) => col.name.trim().toLowerCase() === statusName.trim().toLowerCase())?.leads ?? [];
    let boardOrder: number | undefined;
    // In a column this user has sorted, the sort decides where it goes — only its status changes.
    if (dropIndex !== null && leadColumnSortFor(statusName) === "custom") {
      if (sameStatus && columnLeads.findIndex((row) => row.id === lead.id) === dropIndex) return;
      const others = columnLeads.filter((row) => row.id !== lead.id);
      const before = others[dropIndex - 1];
      const after = others[dropIndex];
      boardOrder = boardOrderBetween(before ? leadBoardKey(before) : null, after ? leadBoardKey(after) : null);
    } else if (sameStatus) {
      return;
    }
    const move: Partial<CompanyLeadRow> = {
      status: statusName,
      updatedAtIso: new Date().toISOString(),
      ...(boardOrder !== undefined ? { boardOrder } : {}),
    };
    const previous: Partial<CompanyLeadRow> = { status: lead.status, updatedAtIso: lead.updatedAtIso, boardOrder: lead.boardOrder };
    // The detail cache too — getLeadById() prefers it (see onSelectLeadStatus).
    const applyToLead = (patch: Partial<CompanyLeadRow>) => {
      setLeads((prev) => prev.map((row) => (row.id === lead.id ? { ...row, ...patch } : row)));
      setLeadDetailsById((prev) => (prev[lead.id] ? { ...prev, [lead.id]: { ...prev[lead.id], ...patch } } : prev));
    };
    applyToLead(move);
    if (isTemporarySampleLead(lead)) {
      sampleLeadsRef.current[lead.companyId] = (sampleLeadsRef.current[lead.companyId] || []).map((row) =>
        row.id === lead.id ? { ...row, ...move } : row,
      );
      persistSampleLeads(lead.companyId, sampleLeadsRef.current[lead.companyId]);
      return;
    }
    pendingLeadMovesRef.current.set(lead.id, move);
    const response = await authorizedFetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: lead.companyId,
        leadId: lead.id,
        ...(sameStatus ? {} : { status: statusName }),
        ...(boardOrder !== undefined ? { boardOrder } : {}),
      }),
    }).catch(() => null);
    // A later drop of this same lead has taken over — that one decides.
    if (pendingLeadMovesRef.current.get(lead.id) !== move) return;
    pendingLeadMovesRef.current.delete(lead.id);
    if (!response?.ok) {
      applyToLead(previous);
      void loadLeads(lead.companyId);
    }
  };

  const leadDropIndexFor = (columnName: string, columnLeads: CompanyLeadRow[], columnEl: Element, clientY: number, leadId: string): number => {
    const mode = leadColumnSortFor(columnName);
    if (mode === "custom") return boardDropIndex(columnEl, clientY, leadId);
    const lead = getLeadById(leadId);
    return lead ? sortedBoardDropIndex(columnLeads, lead, mode, leadSortInfo) : 0;
  };

  const onLeadBoardColumnDrop = (event: ReactDragEvent<HTMLElement>, statusName: string, dropIndex: number | null) => {
    event.preventDefault();
    setDragOverStatusColumn("");
    setLeadDropPreview(null);
    const leadId = event.dataTransfer.getData("text/plain") || draggingLeadId;
    setDraggingLeadId("");
    // Also dismiss the drag ghost here rather than relying solely on the
    // source card's onDragEnd — a successful drop here can immediately move
    // the dragged lead into a different status column (a different parent
    // in the DOM, so React unmounts/remounts that card's element), and if
    // that happens before the browser gets around to dispatching `dragend`
    // on the now-detached original element, the native event never fires
    // and the ghost is left stuck on screen until the next drag. It glides onto the lead's new spot.
    leadBoardDragGhost.end(leadId);
    const lead = getLeadById(leadId);
    if (!lead) return;
    void moveLeadOnBoard(lead, statusName, dropIndex);
  };

  const onLeadCardTouchStart = (lead: CompanyLeadRow, event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    if (leadCardTouchRef.current?.longPressTimer) {
      clearTimeout(leadCardTouchRef.current.longPressTimer);
    }
    const state: NonNullable<typeof leadCardTouchRef.current> = {
      leadId: lead.id,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      longPressTimer: null,
      dragging: false,
      eligible: true,
      targetColumn: "",
      targetIndex: null,
    };
    state.longPressTimer = setTimeout(() => {
      const current = leadCardTouchRef.current;
      if (!current || current.leadId !== lead.id || !current.eligible || current.dragging) return;
      current.dragging = true;
      setDraggingLeadId(lead.id);
      const displayName =
        leadClientName(getLeadDynamicFields(lead), fieldLayoutForLead(lead)) ||
        lead.name || lead.email || lead.phone || "Untitled Lead";
      const color = String(leadStatusPillStyle(lead.status || "New").backgroundColor || "");
      leadBoardDragGhost.spawn({ clientX: current.lastX, clientY: current.lastY }, `lead-board-name-${lead.id}`, { label: displayName, color });
      if (typeof document !== "undefined") document.body.style.touchAction = "none";
    }, LEAD_CARD_LONG_PRESS_MS);
    leadCardTouchRef.current = state;
  };

  const onLeadCardTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const state = leadCardTouchRef.current;
    if (!state) return;
    const touch = event.touches[0];
    if (!touch) return;
    if (!state.dragging) {
      // Moved before the long-press fired — this is a scroll (horizontal column snap-scroll or
      // vertical card-list scroll), not a pick-up. Cancel the timer and leave the touch alone (no
      // preventDefault) so those keep working exactly as if this handler weren't here.
      const dx = Math.abs(touch.clientX - state.startX);
      const dy = Math.abs(touch.clientY - state.startY);
      if (dx > LEAD_CARD_MOVE_CANCEL_PX || dy > LEAD_CARD_MOVE_CANCEL_PX) {
        state.eligible = false;
        if (state.longPressTimer) {
          clearTimeout(state.longPressTimer);
          state.longPressTimer = null;
        }
      }
      return;
    }
    event.preventDefault();
    // useDragGhost's own tracking only runs off a native `dragover` listener, which touch never
    // dispatches — so the touch position is reported to it: the ghost follows (the same swing as a
    // mouse drag), and holding the card at the screen's left/right edge steps the board a column.
    state.lastX = touch.clientX;
    state.lastY = touch.clientY;
    leadBoardDragGhost.trackPointer(touch.clientX, touch.clientY);
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const columnEl = target?.closest<HTMLElement>("[data-board-column]");
    const columnName = columnEl?.getAttribute("data-column-name") || "";
    state.targetColumn = columnName;
    setDragOverStatusColumn((prev) => (prev === columnName ? prev : columnName));
    const touchColumnLeads = leadStatusBoardColumns.columns.find((col) => col.name === columnName)?.leads ?? [];
    const dropIndex =
      columnEl && columnName && columnEl.dataset.boardCollapsed !== "true"
        ? leadDropIndexFor(columnName, touchColumnLeads, columnEl, touch.clientY, state.leadId)
        : null;
    state.targetIndex = dropIndex;
    setLeadDropPreview((prev) =>
      dropIndex === null ? null : prev && prev.column === columnName && prev.index === dropIndex ? prev : { column: columnName, index: dropIndex },
    );
  };

  const endLeadCardTouchDrag = (commit: boolean) => {
    const state = leadCardTouchRef.current;
    leadCardTouchRef.current = null;
    if (typeof document !== "undefined") document.body.style.touchAction = "";
    if (!state) return;
    if (state.longPressTimer) clearTimeout(state.longPressTimer);
    if (!state.dragging) return;
    // Re-resolve the column under the finger at release: if the board auto-scrolled (edge hold)
    // while the finger stayed still, no touchmove ran to update targetColumn.
    if (commit && typeof document !== "undefined") {
      const columnEl = document.elementFromPoint(state.lastX, state.lastY)?.closest<HTMLElement>("[data-board-column]");
      if (columnEl) {
        state.targetColumn = columnEl.getAttribute("data-column-name") || state.targetColumn;
        const releaseColumnLeads = leadStatusBoardColumns.columns.find((col) => col.name === state.targetColumn)?.leads ?? [];
        state.targetIndex =
          columnEl.dataset.boardCollapsed !== "true"
            ? leadDropIndexFor(state.targetColumn, releaseColumnLeads, columnEl, state.lastY, state.leadId)
            : null;
      }
    }
    setDraggingLeadId("");
    setDragOverStatusColumn("");
    setLeadDropPreview(null);
    leadBoardDragGhost.end(state.leadId);
    suppressNextLeadCardClickRef.current = state.leadId;
    if (commit && state.targetColumn) {
      const lead = getLeadById(state.leadId);
      if (lead) void moveLeadOnBoard(lead, state.targetColumn, state.targetIndex);
    }
  };

  const onLeadCardTouchEnd = () => endLeadCardTouchDrag(true);
  const onLeadCardTouchCancel = () => endLeadCardTouchDrag(false);

  const handleCreateProjectFromLead = async (lead: CompanyLeadRow) => {
    if (typeof window === "undefined") return;
    const fullLead = (await loadLeadDetail(lead.id)) ?? getLeadById(lead.id) ?? lead;
    window.dispatchEvent(
      new CustomEvent<NewProjectPrefillPayload>(OPEN_NEW_PROJECT_EVENT, {
        detail: {
          ...buildLeadProjectPrefill(fullLead, fieldLayoutForLead(fullLead)),
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
        const response = await authorizedFetch("/api/leads", {
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
    const response = await authorizedFetch("/api/leads", {
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

  const createLeadForm = leadForms.find((form) => form.id === createLeadFormId) ?? leadForms[0] ?? null;
  const createLeadFormStorageKey = `cutsmart_create_lead_form:${activeCompanyId}`;

  const openLeadForm = (event: ReactMouseEvent<HTMLElement>) => {
    leadFormModalOriginElRef.current = event.currentTarget;
    setLeadFormModalOrigin(captureGlassModalOrigin(event));
    // The form used last time on this device, while it's still there; else the first.
    let lastFormId = "";
    try {
      lastFormId = window.localStorage.getItem(createLeadFormStorageKey) || "";
    } catch {
      lastFormId = "";
    }
    setCreateLeadFormId(leadForms.some((form) => form.id === lastFormId) ? lastFormId : (leadForms[0]?.id ?? ""));
    setCreateLeadAnswers({});
    setCreateLeadErrors({});
    setCreateLeadMessage("");
    setCreateLeadSource(MANUAL_LEAD_SOURCES[0]);
    setCreateLeadStatus(leadStatusOptions[0] || "New");
    setLeadFormModalOpen(true);
  };

  const closeLeadFormModal = () => {
    if (createLeadSaving) return;
    setLeadFormModalOpen(false);
  };

  const submitCreateLead = async () => {
    const form = createLeadForm;
    const cid = String(activeCompanyId || "").trim();
    if (!form || !cid || createLeadSaving) return;
    const result = collectLeadFormAnswers(form, createLeadAnswers, { skipRequired: true });
    setCreateLeadErrors(result.errors);
    if (Object.keys(result.errors).length > 0) {
      setCreateLeadMessage("");
      window.requestAnimationFrame(() => {
        const firstBad = form.questions.find((question) => result.errors[question.id]);
        if (firstBad) document.querySelector(`[data-lead-form-question="${CSS.escape(firstBad.id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      return;
    }
    if (result.answeredCount === 0) {
      setCreateLeadMessage("Fill in at least one answer.");
      return;
    }
    setCreateLeadSaving(true);
    setCreateLeadMessage("");
    // Nobody's yet (assign it from its pop-up) — except for someone who can only see their own leads: it's theirs.
    const assigneeUid = canViewOtherLeads ? "" : currentUserUid;
    try {
      if (isPreviewMode()) {
        // The Preview holds every server call (lib/preview-runtime.ts): the lead is one of its own sample leads instead.
        const nowIso = new Date().toISOString();
        const assignee = companyMembers.find((member) => member.uid === assigneeUid);
        const row: CompanyLeadRow = {
          id: `temporary-sample-lead-${Date.now().toString(36)}`,
          companyId: cid,
          name: result.contact.name,
          email: result.contact.email,
          phone: result.contact.phone,
          message: result.contact.message,
          formName: form.name,
          formId: form.id,
          formFieldKeys: result.formFieldKeys,
          submittedAtIso: nowIso,
          createdAtIso: nowIso,
          updatedAtIso: nowIso,
          source: "manual",
          sourceDetail: createLeadSource,
          status: createLeadStatus || leadStatusOptions[0] || "New",
          assignedToUid: assignee?.uid || "",
          assignedToName: assignee?.displayName || "",
          assignedTo: assignee?.displayName || "",
          imageItems: [],
          imageUrls: [],
          rawFields: result.rawFields,
        };
        sampleLeadsRef.current[cid] = [row, ...(sampleLeadsRef.current[cid] || [])];
        persistSampleLeads(cid, sampleLeadsRef.current[cid]);
      } else {
        const response = await authorizedFetch("/api/leads/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: cid,
            formId: form.id,
            answers: createLeadAnswers,
            sourceDetail: createLeadSource,
            status: createLeadStatus,
            assignedToUid: assigneeUid,
          }),
        });
        const detail = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; errors?: Record<string, string> } | null;
        if (!response.ok || !detail?.ok) {
          if (detail?.errors) setCreateLeadErrors(detail.errors);
          setCreateLeadMessage(
            detail?.error === "form-not-found"
              ? "That form has just been changed or deleted — close this and open Create Lead again."
              : detail?.error === "invalid-answers"
                ? "Check the answers marked in red."
                : "Couldn't save the lead. Try again.",
          );
          return;
        }
      }
      try {
        window.localStorage.setItem(createLeadFormStorageKey, form.id);
      } catch {
        // just not remembered
      }
      setLeadFormModalOpen(false);
      void loadLeads(cid);
    } catch {
      setCreateLeadMessage("Couldn't save the lead. Try again.");
    } finally {
      setCreateLeadSaving(false);
    }
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

  function renderLeadCard(lead: CompanyLeadRow, options?: { draggable?: boolean; accentColor?: string; compact?: boolean; preview?: boolean }) {
    const draggable = Boolean(options?.draggable);
    const accentColor = options?.accentColor;
    const compact = Boolean(options?.compact);
    const effectiveCompact = compactCardOverrides[lead.id] ?? compact;
    const leadFields = getLeadDynamicFields(lead);
    const leadLayout = fieldLayoutForLead(lead);
    const rowFields = leadRowFields(leadLayout);
    const displayName =
      leadClientName(leadFields, leadLayout) ||
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
        onTouchStart={draggable ? (e) => onLeadCardTouchStart(lead, e) : undefined}
        onTouchMove={draggable ? onLeadCardTouchMove : undefined}
        onTouchEnd={draggable ? onLeadCardTouchEnd : undefined}
        onTouchCancel={draggable ? onLeadCardTouchCancel : undefined}
        onClick={(e) => {
          // Set the instant a touch-drag commits (see endLeadCardTouchDrag) — the synthetic click
          // some browsers still fire right after that touchend would otherwise ALSO open this
          // lead's detail modal right after dropping it into a new column.
          if (suppressNextLeadCardClickRef.current === lead.id) {
            suppressNextLeadCardClickRef.current = "";
            return;
          }
          leadDetailModalOriginElRef.current = e.currentTarget;
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
          // Long-press on mobile is how you pick a card up to drag it — without these, the
          // browser's own default long-press UI (text-selection callout, tap-color flash) fires
          // first and visually fights with/masks the pick-up. Same fix as the mobile tab-bar drag.
          WebkitTouchCallout: draggable ? "none" : undefined,
          WebkitUserSelect: draggable ? "none" : undefined,
          userSelect: draggable ? "none" : undefined,
          WebkitTapHighlightColor: draggable ? "transparent" : undefined,
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
                        cardStatusMenuOriginElRef.current = e.currentTarget;
                        setCardStatusMenuOrigin(captureGlassModalOrigin(e));
                        setCardStatusMenuLeadId(lead.id);
                      }
                    }}
                    className="glass-shine relative z-40 inline-flex h-6 items-center justify-center rounded-full px-2.5 text-[10px] font-bold transition hover:brightness-95"
                    style={glassShineStyle(leadStatusPillStyle(lead.status || "New"))}
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
                            className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left text-[11px] font-bold transition hover:bg-[color-mix(in_srgb,var(--text-main)_7%,transparent)] disabled:cursor-wait disabled:opacity-60"
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
        <p id={options?.preview ? undefined : `lead-board-name-${lead.id}`} className="truncate pr-8 text-[14px] font-bold" style={{ color: boardTextColor }}>
          {displayName}
        </p>
        {!effectiveCompact && (
          <>
            {rowFields.length > 0 ? (
              <div className="space-y-1">
                {rowFields.map((column) => {
                  const value = resolveLeadColumnValue(leadFields, column, leadLayout);
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

  // A lead's Checklists: Add Checklist (a menu of this user's saved checklists — or, with none saved, a link to make one
  // in User Settings), then each one added: its name, how many are done (and a bar), and its items to tick off. Anyone
  // can tick; removing one takes a second click. "side": the panel on the pop-up's left; "inline": inside the pop-up.
  function renderLeadChecklists(lead: CompanyLeadRow, checklists: ProjectChecklist[], variant: "side" | "inline") {
    const canEdit = isUserVerified;
    const error = leadChecklistError.leadId === lead.id ? leadChecklistError.message : "";
    const templates = leadChecklistTemplates;
    const addControl = !canEdit ? null : templates && templates.length === 0 ? (
      <Link href="/user-settings" className="text-[12px] font-medium underline underline-offset-2" style={{ color: "var(--brand)" }}>
        Create a checklist in User Settings
      </Link>
    ) : (
      <GlassActionMenu
        items={(templates ?? []).map((template) => ({
          key: template.id,
          label: template.name,
          detail: `${template.items.length} item${template.items.length === 1 ? "" : "s"}`,
          onSelect: () => addLeadChecklistFromTemplate(lead, template),
        }))}
        openWithOneItem
        menuMinWidth={240}
        ariaLabel="Add a checklist"
        // Round-ended, with the glass shine (lib/glass-shine.ts) in the brand blue — as Add Note.
        triggerClassName="glass-shine inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-[12px] font-bold text-white transition hover:brightness-105"
        triggerStyle={glassShineStyle("var(--brand)")}
      >
        <Plus size={14} strokeWidth={2.75} />
        Add Checklist
      </GlassActionMenu>
    );
    const heading = (
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[16px] font-semibold" style={{ color: "var(--text-main)" }}>
          Checklists
          {checklists.length ? (
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[11px] font-bold"
              style={{ ...LEAD_POPUP_BOX_STYLE, color: "var(--text-main)" }}
            >
              {checklists.length}
            </span>
          ) : null}
        </p>
        {addControl}
      </div>
    );
    const list = checklists.length ? (
      <div className="space-y-2">
        {checklists.map((checklist) => {
          const total = checklist.items.length;
          const done = checklist.items.filter((item) => item.checked).length;
          const complete = total > 0 && done === total;
          const armed = confirmRemoveLeadChecklistId === checklist.id;
          return (
            <div
              key={checklist.id}
              className="group/checklist relative rounded-[14px] border px-3 py-2.5"
              style={LEAD_POPUP_BOX_STYLE}
              onMouseLeave={() => {
                if (armed) setConfirmRemoveLeadChecklistId("");
              }}
            >
              <div className={`flex items-center gap-2 ${canEdit ? "pr-8" : ""}`}>
                <p className="min-w-0 flex-1 truncate text-[14px] font-semibold" style={{ color: "var(--text-main)" }} title={checklist.name}>
                  {checklist.name}
                </p>
                <span className="shrink-0 text-[11px] font-bold" style={{ color: complete ? "#15803D" : "var(--text-muted)" }}>
                  {done}/{total}
                </span>
              </div>
              {/* How far through it is — green once it's all done. */}
              <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--text-main) 10%, transparent)" }}>
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{ width: `${total ? (done / total) * 100 : 0}%`, backgroundColor: complete ? "#16A34A" : "var(--brand)" }}
                />
              </div>
              <div className="mt-1.5 space-y-0.5">
                {checklist.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => toggleLeadChecklistItem(lead, checklist.id, item.id)}
                    className="flex w-full items-start gap-2.5 rounded-[8px] px-1.5 py-1.5 text-left transition enabled:hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] disabled:cursor-default"
                    aria-pressed={item.checked}
                  >
                    <span
                      className={`mt-px inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] border ${item.checked ? "glass-shine" : ""}`}
                      style={
                        item.checked
                          ? glassShineStyle("var(--brand)")
                          : { borderColor: "color-mix(in srgb, var(--text-main) 28%, transparent)", backgroundColor: "var(--panel-bg)" }
                      }
                    >
                      {item.checked ? <Check size={12} color="#ffffff" strokeWidth={3} /> : null}
                    </span>
                    <span
                      className="min-w-0 break-words text-[13.5px] font-medium"
                      style={{ color: item.checked ? "var(--text-muted)" : "var(--text-main)", textDecoration: item.checked ? "line-through" : "none" }}
                    >
                      {item.text}
                    </span>
                  </button>
                ))}
              </div>
              {canEdit ? (
                armed ? (
                  <button
                    type="button"
                    onClick={() => removeLeadChecklist(lead, checklist.id)}
                    className="glass-shine absolute right-2 top-2 inline-flex h-6 items-center justify-center rounded-full px-2.5 text-[11px] font-bold text-white hover:brightness-105"
                    style={glassShineStyle("#EF4444")}
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveLeadChecklistId(checklist.id)}
                    className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full transition-opacity hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/checklist:opacity-100"
                    style={{ color: "var(--text-muted)" }}
                    title="Remove checklist"
                    aria-label={`Remove ${checklist.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                )
              ) : null}
            </div>
          );
        })}
      </div>
    ) : null;
    const errorLine = error ? (
      <p className="text-[12px] font-medium" style={{ color: "var(--danger-strong)" }}>
        {error}
      </p>
    ) : null;
    if (variant === "inline") {
      return (
        <div className="mt-4 space-y-3">
          {heading}
          {errorLine}
          {list}
        </div>
      );
    }
    return (
      <div className="absolute inset-0 flex flex-col">
        <div className="shrink-0 space-y-3 px-5 pb-3 pt-5">
          {heading}
          {errorLine}
        </div>
        <div className="glass-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {list ?? (
            // Nothing added yet: what this is for, quietly.
            <div className="flex flex-col items-center gap-2 pt-10 text-center" style={{ color: "var(--text-muted)" }}>
              <ListChecks size={26} strokeWidth={1.75} />
              <p className="max-w-[220px] text-[12.5px] font-medium">Add one of your saved checklists to tick off for this lead.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // A lead's Notes: a box to write one (and Add Note), then its notes, newest first — each with who wrote it (their
  // initials in their colour) and when; the writer (or an owner / admin) can delete one (a second click confirms).
  // "side": the panel beside the pop-up, its notes scrolling under the box; "inline": inside the pop-up, under its
  // fields (a smaller screen).
  function renderLeadNotes(lead: CompanyLeadRow, notes: LeadNote[], variant: "side" | "inline") {
    const draft = leadNoteDraft.leadId === lead.id ? leadNoteDraft.text : "";
    const error = leadNoteError.leadId === lead.id ? leadNoteError.message : "";
    const canAdd = isUserVerified;
    const canDeleteAny = isOwnerOrAdmin(access.role);
    const newestFirst = [...notes].reverse();
    const composer = canAdd ? (
      <div>
        <textarea
          value={draft}
          rows={3}
          disabled={leadNoteSaving}
          placeholder="Add a note…"
          aria-label="New note"
          onChange={(e) => setLeadNoteDraft({ leadId: lead.id, text: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            // Ctrl / Cmd + Enter adds it (Enter is a new line).
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void addLeadNote(lead);
            }
          }}
          className="block w-full resize-none rounded-[14px] border px-3 py-2.5 text-[14px] font-medium outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--brand)] disabled:opacity-60"
          style={{ ...LEAD_POPUP_BOX_STYLE, color: "var(--text-main)" }}
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          {error ? (
            <p className="mr-auto text-[12px] font-medium" style={{ color: "var(--danger-strong)" }}>
              {error}
            </p>
          ) : null}
          {/* Round-ended, with the glass shine (lib/glass-shine.ts) in the brand blue. */}
          <button
            type="button"
            disabled={!draft.trim() || leadNoteSaving}
            onClick={() => void addLeadNote(lead)}
            className="glass-shine inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-[12px] font-bold text-white transition hover:brightness-105 disabled:opacity-50"
            style={glassShineStyle("var(--brand)")}
          >
            <Plus size={14} strokeWidth={2.75} />
            {leadNoteSaving ? "Adding..." : "Add Note"}
          </button>
        </div>
      </div>
    ) : null;
    const list = newestFirst.length ? (
      <div className="space-y-2">
        {newestFirst.map((note) => {
          const member = companyMembers.find((row) => row.uid === note.createdByUid) ?? null;
          const name = String(member?.displayName || note.createdByName || "A teammate").trim();
          const color = String(member?.badgeColor || member?.userColor || "").trim() || "#7D99B3";
          const canDelete = canAdd && (note.createdByUid === currentUserUid || canDeleteAny);
          const armed = confirmDeleteLeadNoteId === note.id;
          const deleting = deletingLeadNoteId === note.id;
          return (
            <div
              key={note.id}
              className="group/note relative rounded-[14px] border px-3 py-2.5"
              style={LEAD_POPUP_BOX_STYLE}
              onMouseLeave={() => {
                if (armed) setConfirmDeleteLeadNoteId("");
              }}
            >
              <div className={`flex items-center gap-2 ${canDelete ? "pr-8" : ""}`}>
                <span
                  className="glass-shine inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={glassShineStyle(color)}
                  aria-hidden="true"
                >
                  {contactInitials(name, "")}
                </span>
                <span className="min-w-0 truncate text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                  {name}
                </span>
                <span className="ml-auto shrink-0 text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                  {formatLeadDate(note.createdAtIso)}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-[13.5px] font-medium" style={{ color: "var(--text-main)" }}>
                {note.text}
              </p>
              {canDelete ? (
                armed ? (
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => void deleteLeadNote(lead, note)}
                    className="glass-shine absolute right-2 top-2 inline-flex h-6 items-center justify-center rounded-full px-2.5 text-[11px] font-bold text-white hover:brightness-105 disabled:opacity-60"
                    style={glassShineStyle("#EF4444")}
                  >
                    {deleting ? "Deleting..." : "Delete"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(deletingLeadNoteId)}
                    onClick={() => setConfirmDeleteLeadNoteId(note.id)}
                    className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full transition-opacity hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/note:opacity-100"
                    style={{ color: "var(--text-muted)" }}
                    title="Delete note"
                    aria-label="Delete note"
                  >
                    <Trash2 size={13} />
                  </button>
                )
              ) : null}
            </div>
          );
        })}
      </div>
    ) : null;
    const heading = (
      <p className="flex items-center gap-2 text-[16px] font-semibold" style={{ color: "var(--text-main)" }}>
        Notes
        {notes.length ? (
          <span
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[11px] font-bold"
            style={{ ...LEAD_POPUP_BOX_STYLE, color: "var(--text-main)" }}
          >
            {notes.length}
          </span>
        ) : null}
      </p>
    );
    if (variant === "inline") {
      return (
        <div className="mt-4 space-y-3">
          {heading}
          {composer}
          {list}
        </div>
      );
    }
    return (
      <div className="absolute inset-0 flex flex-col">
        <div className="shrink-0 space-y-3 px-5 pb-3 pt-5">
          {heading}
          {composer}
        </div>
        <div className="glass-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5">{list}</div>
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
    const leadLayout = fieldLayoutForLead(renderLead);
    const detailFields = leadDetailFields(leadLayout);
    const displayName =
      leadClientName(leadFields, leadLayout) ||
      lead.name || lead.email || lead.phone || "Untitled Lead";
    const isDetailLoading = detailLoadingLeadId === lead.id && !leadDetailsById[lead.id];
    const leadPhotoItems = normalizeLeadImageItems(renderLead);
    const assignedUid = String(lead.assignedToUid || "").trim();
    const assignedMember = companyMembers.find((member) => member.uid === assignedUid) ?? null;
    const assignedLabel = String(lead.assignedToName || lead.assignedTo || assignedMember?.displayName || "").trim();
    const assignedColor = String(assignedMember?.badgeColor || assignedMember?.userColor || companyThemeColor).trim() || companyThemeColor;
    const assignedInitials = assignedLabel.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
    // Its notes and checklists from the list (kept live), else its opened details.
    const leadNotes = (leads.find((row) => row.id === lead.id) ?? renderLead).notes ?? [];
    const leadChecklists = leadChecklistsOf(renderLead);
    const popupTint = leadPopupTintStyle(String(leadStatusPillStyle(lead.status || "New").backgroundColor || companyThemeColor));
    return createPortal(
      <div
        className="glass-modal-backdrop fixed inset-0 z-[230] flex items-center justify-center px-4 py-4 max-sm:p-0"
        onClick={() => {
          setSelectedLeadId("");
          setLeadFieldEdit(null);
        }}
      >
        {/* The pop-up, with its Checklists on its left and its Notes on its right — panels of the same look (a wide
            enough screen; smaller, they're inside it, under its fields): all three open and close together. */}
        <div
          ref={leadDetailModalPanelRef}
          onClick={(e) => e.stopPropagation()}
          className="flex items-stretch gap-3 max-sm:h-[100dvh] max-sm:w-full"
        >
        {/* Its Checklists: as tall as the pop-up (at least 440px), scrolling inside. */}
        <aside className="glass-modal-panel relative isolate hidden min-h-[440px] w-[320px] shrink-0 overflow-hidden xl:block" aria-label="Lead checklists">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={popupTint} />
          {renderLeadChecklists(renderLead, leadChecklists, "side")}
        </aside>
        <div
          // On a phone it takes the whole screen, square-cornered (its top and bottom clear of the notch / home bar).
          className="glass-modal-panel relative isolate flex max-h-[min(720px,90vh)] w-[min(560px,96vw)] flex-col overflow-hidden max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:rounded-none! max-sm:border-0!"
        >
          {/* The Calendar event pop-up's look: its status's colour washed across it, the X alone in the top right corner,
              the status (a dropdown pill) over the lead's name, and each field in a white see-through box. All its text
              black. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={popupTint} />
          <div className="relative shrink-0 px-5 pb-3 pt-5 max-sm:pt-[calc(1.25rem+env(safe-area-inset-top))]">
            <button
              type="button"
              onClick={() => {
                setSelectedLeadId("");
                setLeadFieldEdit(null);
              }}
              className={`${modalCloseButtonClass} absolute right-3 top-3 max-sm:top-[calc(0.75rem+env(safe-area-inset-top))]`}
              aria-label="Close lead details"
            >
              <X size={16} />
            </button>
            {/* Its name on the left; on the right (clear of the X) its status, as a pill that's also the dropdown to change
                it — each status with its colour. */}
            <div className="flex items-start justify-between gap-3 pr-10">
              <h2 className="min-w-0 flex-1 pt-0.5 text-left text-[22px] font-semibold leading-tight" style={{ color: "var(--text-main)" }}>
                {displayName}
              </h2>
              <div className="shrink-0">
              <GlassDropdown
                value={lead.status || "New"}
                options={leadStatusOptions.map((option) => ({
                  value: option,
                  label: option,
                  color: String(leadStatusPillStyle(option).backgroundColor || ""),
                }))}
                onChange={(next) => void onSelectLeadStatus(lead, next)}
                disabled={statusUpdatingLeadId === lead.id}
                hideTriggerDot
                menuMinWidth={170}
                ariaLabel="Lead status"
                // The Create Project button's size (h-9, px-3, 12px bold, a 1px border — here in the pill's own colour).
                triggerClassName="glass-shine h-9 max-w-full gap-1.5! rounded-full border px-3 text-[12px] font-bold transition hover:brightness-95 disabled:cursor-wait"
                triggerStyle={glassShineStyle(leadStatusPillStyle(lead.status || "New"))}
              />
              </div>
            </div>
          </div>
          {/* Its photos, as a strip of thumbnails under its name — a set height, scrolling sideways when there are more
              than fit (a mouse wheel turns it too). One opens that photo in the photo viewer. */}
          {leadPhotoItems.length > 0 ? (
            <div className="shrink-0 px-5 pb-3">
              <div
                className="hide-native-scrollbar flex h-[88px] gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain"
                onWheel={(e) => {
                  const strip = e.currentTarget;
                  if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && strip.scrollWidth > strip.clientWidth) strip.scrollLeft += e.deltaY;
                }}
              >
                {leadPhotoItems.map((item, index) => (
                  <button
                    key={`${item.url}_${index}`}
                    type="button"
                    onClick={(e) => {
                      leadImagesModalOriginElRef.current = e.currentTarget;
                      setLeadImagesModalOrigin(captureGlassModalOrigin(e));
                      setLeadImagesLeadId(lead.id);
                      setLeadImagesDragActive(false);
                      openLeadImagePreview(index);
                    }}
                    className="aspect-[4/3] h-full shrink-0 overflow-hidden rounded-[12px] border transition hover:brightness-95"
                    style={LEAD_POPUP_BOX_STYLE}
                    title={item.name || `Photo ${index + 1}`}
                    aria-label={`Open ${item.name || `photo ${index + 1}`}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="glass-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            {isDetailLoading ? (
              <div className="mb-2 rounded-[14px] border px-3 py-2.5 text-[13px] font-medium" style={{ ...LEAD_POPUP_BOX_STYLE, color: "var(--text-main)" }}>
                Loading lead details...
              </div>
            ) : null}
            {detailFields.length === 0 ? (
              <p className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                No detail fields configured yet.
              </p>
            ) : (
              <div className="space-y-2">
                {detailFields.map((column) => {
                  const value = resolveLeadColumnValue(leadFields, column, leadLayout);
                  const editing = leadFieldEdit && leadFieldEdit.leadId === lead.id && leadFieldEdit.key === column.key ? leadFieldEdit : null;
                  const canEdit = isUserVerified && !isDetailLoading;
                  const startEditingField = () => {
                    leadFieldEditCancelledRef.current = false;
                    setLeadFieldError("");
                    setLeadFieldEdit({ leadId: lead.id, key: column.key, value });
                  };
                  const cancelEditingField = () => {
                    leadFieldEditCancelledRef.current = true;
                    setLeadFieldError("");
                    setLeadFieldEdit(null);
                  };
                  // Longer answers (a message, notes, several lines) get a bigger box.
                  const draft = editing?.value ?? "";
                  const multiline = /message|note|comment|description|detail|enquiry|inquiry/i.test(`${column.key} ${column.label}`) || draft.includes("\n") || draft.length > 60;
                  const fieldClass = "mt-1 block w-full rounded-[10px] border px-2.5 text-[14px] font-medium outline-none transition focus:border-[var(--brand)]";
                  const fieldStyle = { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" };
                  const fieldProps = {
                    value: draft,
                    autoFocus: true,
                    disabled: leadFieldSaving,
                    "aria-label": column.label,
                    style: fieldStyle,
                    onChange: (e: { target: { value: string } }) =>
                      setLeadFieldEdit((prev) => (prev && prev.leadId === lead.id && prev.key === column.key ? { ...prev, value: e.target.value } : prev)),
                    // Clicking away saves it (as Client Details does) — not after Esc.
                    onBlur: () => {
                      if (leadFieldEditCancelledRef.current) return;
                      void saveLeadFieldEdit(renderLead, column, leadLayout);
                    },
                  };
                  return (
                    // Its pencil — the one Client Details uses — sits at its right: showing on hover (always on a touch
                    // screen); a tick while it's being edited, which saves.
                    <div key={`${lead.id}:detail:${column.key}`} className="group/field relative rounded-[14px] border py-2.5 pl-3 pr-11" style={LEAD_POPUP_BOX_STYLE}>
                      <p className="text-[11.5px] font-medium" style={{ color: "var(--text-main)" }}>
                        {column.label}
                      </p>
                      {editing ? (
                        multiline ? (
                          <textarea
                            {...fieldProps}
                            rows={4}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Escape") cancelEditingField();
                              // Ctrl / Cmd + Enter saves (Enter is a new line here).
                              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                void saveLeadFieldEdit(renderLead, column, leadLayout);
                              }
                            }}
                            className={`${fieldClass} resize-y py-2`}
                          />
                        ) : (
                          <input
                            {...fieldProps}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Escape") cancelEditingField();
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void saveLeadFieldEdit(renderLead, column, leadLayout);
                              }
                            }}
                            className={`${fieldClass} h-9`}
                          />
                        )
                      ) : (
                        <p className="mt-0.5 whitespace-pre-wrap text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
                          {value || "-"}
                        </p>
                      )}
                      {editing && leadFieldError ? (
                        <p className="mt-1 text-[12px] font-medium" style={{ color: "var(--danger-strong)" }}>
                          {leadFieldError}
                        </p>
                      ) : null}
                      {canEdit ? (
                        <button
                          type="button"
                          disabled={leadFieldSaving}
                          // Editing: the tick saves without the field losing focus first (which would save it too).
                          onMouseDown={(e) => {
                            if (editing) e.preventDefault();
                          }}
                          onClick={() => (editing ? void saveLeadFieldEdit(renderLead, column, leadLayout) : startEditingField())}
                          className={`absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[8px] transition-opacity hover:bg-[var(--panel-muted)] focus-visible:opacity-100 disabled:opacity-60 ${
                            editing ? "opacity-100" : "pointer-fine:opacity-0 pointer-fine:group-hover/field:opacity-100"
                          }`}
                          style={{ color: "var(--text-muted)" }}
                          title={editing ? "Save" : `Edit ${column.label}`}
                          aria-label={editing ? `Save ${column.label}` : `Edit ${column.label}`}
                        >
                          {editing ? <Check size={16} /> : <Pencil size={16} />}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="xl:hidden">
              {renderLeadChecklists(renderLead, leadChecklists, "inline")}
              {renderLeadNotes(renderLead, leadNotes, "inline")}
            </div>
          </div>
          {/* Its buttons along the bottom, under its fields. */}
          <div className="flex shrink-0 flex-wrap gap-2 border-t px-5 py-4 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]" style={{ borderTopColor: "var(--glass-border)" }}>
            <button
              type="button"
              onClick={() => void handleCreateProjectFromLead(renderLead)}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border px-3 text-[12px] font-bold text-white hover:brightness-95"
              style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
            >
              Create Project
            </button>
            <button
              type="button"
              onClick={(e) => {
                leadImagesModalOriginElRef.current = e.currentTarget;
                setLeadImagesModalOrigin(captureGlassModalOrigin(e));
                setLeadImagesLeadId(lead.id);
                setLeadImagesDragActive(false);
              }}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border px-3 text-[12px] font-bold hover:brightness-95"
              style={{ ...LEAD_POPUP_BOX_STYLE, color: "var(--text-main)" }}
            >
              <ImagePlus size={13} />
              Photos ({Array.isArray(renderLead.imageUrls) ? renderLead.imageUrls.length : 0})
            </button>
            <button
              type="button"
              onClick={(e) => {
                assignModalOriginElRef.current = e.currentTarget;
                setAssignModalOrigin(captureGlassModalOrigin(e));
                openAssignLeadModal(renderLead);
              }}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border px-3 text-[12px] font-bold hover:brightness-95"
              style={{ ...LEAD_POPUP_BOX_STYLE, color: "var(--text-main)" }}
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
                deleteConfirmModalOriginElRef.current = e.currentTarget;
                setDeleteConfirmModalOrigin(captureGlassModalOrigin(e));
                setConfirmDeleteLeadId(lead.id);
              }}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border px-3 text-[12px] font-bold text-white hover:brightness-95"
              style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
            >
              Archive
            </button>
          </div>
        </div>
        {/* Its Notes: as tall as the pop-up (at least 440px), its notes scrolling inside. */}
        <aside className="glass-modal-panel relative isolate hidden min-h-[440px] w-[320px] shrink-0 overflow-hidden xl:block" aria-label="Lead notes">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={popupTint} />
          {renderLeadNotes(renderLead, leadNotes, "side")}
        </aside>
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div style={leadsChromeless ? HOME_SCREEN_APP_PAGE_PADDING : { display: "contents" }}>
        {access.status === "loading" ? (
          <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}>
            Checking access...
          </div>
        ) : access.status === "error" ? (
          <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}>
            <p>Couldn&apos;t check your access to Leads — the connection may be slow or offline.</p>
            <button
              type="button"
              onClick={() => access.retry()}
              className="mt-3 inline-flex h-9 items-center rounded-full border px-3 text-[12px] font-bold hover:brightness-95"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-muted)" }}
            >
              Retry
            </button>
          </div>
        ) : !canAccessLeads ? (
          <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}>
            You do not have permission to access Leads.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Flat, like the Dashboard: one line — its search, the view toggle (grid on the left, columns on the right),
                the view's own controls (columns: Compact and Sort; grid: the status filters and the order), and at the end
                the counts and Create Lead. Every button round-ended. Phone: the search is a circle until it's tapped,
                then takes the whole line (the rest step aside); Compact and Create Lead are just their icons. */}
            {/* The stat cards across the top — the Dashboard's (look, tilt under the pointer, phone layout), on or off with
                User Settings' Stat Cards. Above the toolbar, their shadows over it. */}
            {leadStatCardsEnabled ? (
              // paddingBottom 13: with the 16px gap the page puts between this and the toolbar, the toolbar sits exactly
              // where the Dashboard's does (its cards' 16px, its toolbar's 1px top border and 12px padding).
              <div className="relative z-[18] -mt-3 md:-mt-4" style={{ paddingTop: 16, paddingBottom: 13 }}>
                <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
                  {LEAD_STAT_CARDS.map((card) => {
                    const Icon = card.icon;
                    const weekly = leadStats.weekly[card.key];
                    return (
                      <div
                        key={card.key}
                        onMouseMove={(e) => {
                          const el = e.currentTarget;
                          const rect = el.getBoundingClientRect();
                          const rotateY = ((e.clientX - rect.left - rect.width / 2) / (rect.width / 2)) * 3;
                          const rotateX = -((e.clientY - rect.top - rect.height / 2) / (rect.height / 2)) * 3;
                          el.style.transition = "transform 60ms linear";
                          el.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-1px) scale(1.008)`;
                        }}
                        onMouseLeave={(e) => {
                          const el = e.currentTarget;
                          el.style.transition = "transform 350ms cubic-bezier(0.22, 1, 0.36, 1)";
                          el.style.transform = "perspective(800px) rotateX(0deg) rotateY(0deg) translateY(0px) scale(1)";
                        }}
                        // The glass shine (lib/glass-shine.ts), as the Dashboard's — the card its container version, in a
                        // wash of its icon's colour, and its icon the full one.
                        className="glass-shine glass-shine-soft rounded-[18px] border px-3 py-2.5 sm:px-5 sm:py-4"
                        style={glassShineStyle(card.iconTo, { willChange: "transform" })}
                      >
                        <div className="flex items-center gap-2 sm:mb-3 sm:gap-2.5">
                          <div
                            className="glass-shine inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white sm:h-9 sm:w-9"
                            style={glassShineStyle(card.iconTo)}
                          >
                            <Icon size={15} strokeWidth={2.4} />
                          </div>
                          <p className="min-w-0 truncate text-[12px] font-semibold sm:text-[14px]" style={{ color: leadsListPalette.textSoft }}>
                            <span className="sm:hidden">{card.phoneLabel}</span>
                            <span className="max-sm:hidden">{card.label}</span>
                          </p>
                          <p className="ml-auto shrink-0 text-[18px] font-bold sm:hidden" style={{ color: leadsListPalette.text }}>{leadStats.values[card.key]}</p>
                        </div>
                        {/* The number, and "+ N this week" at the end of its line (the Dashboard's) — the same height with it
                            or without. */}
                        <div className="hidden min-w-0 items-end justify-between gap-2 sm:flex">
                          <p className="shrink-0 text-[32px] font-semibold leading-none sm:text-[38px] lg:text-[42px]" style={{ color: leadsListPalette.text }}>
                            {leadStats.values[card.key]}
                          </p>
                          {weekly > 0 ? (
                            <p className="min-w-0 truncate whitespace-nowrap text-[13px] font-bold" style={{ color: themeMode === "dark" ? "var(--success)" : "#2A7A3B" }}>
                              + {weekly} this week
                            </p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {/* With the stat cards off it starts where the Dashboard's does then — up at the page's top edge, 1px down (the
                Dashboard toolbar's own top border). */}
            {/* Phone (the Dashboard's layout): the search at the left, this view's buttons in the middle, and the view
                toggle at the right end (max-sm:pr-[90px] is its room) — the search taking the line up to the toggle while
                it's tapped into. */}
            <div className={`relative z-[15] flex flex-wrap items-center gap-2 max-sm:pr-[90px] ${leadStatCardsEnabled ? "" : "-mt-3 pt-px md:-mt-4"}`}>
              <div
                // Phone: opens as soon as it's touched (data-opening), not once it has focus (the Dashboard's).
                data-opening={searchOpening ? "true" : undefined}
                onPointerDown={(event) => {
                  setSearchOpening(true);
                  // A touch that turned into a scroll (the search never got focus): back it goes.
                  const wrap = event.currentTarget;
                  window.setTimeout(() => {
                    if (!wrap.contains(document.activeElement)) setSearchOpening(false);
                  }, 700);
                }}
                onBlur={() => setSearchOpening(false)}
                className={`peer relative w-9 min-w-9 shrink-0 flex-none transition-[flex-grow,width] duration-200 focus-within:flex-1 sm:w-auto sm:min-w-[260px] sm:max-w-[360px] sm:flex-none sm:focus-within:flex-none ${
                  search.trim() || searchOpening ? "max-sm:flex-1" : ""
                }`}
              >
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 max-sm:left-[11px]"
                  style={{ color: leadsToolbarPalette.textMuted }}
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || leadsViewMode !== "board" || !search.trim()) return;
                    e.preventDefault();
                    searchMatchColumnRef.current = scrollBoardToSearchMatch(searchMatchColumnRef.current);
                  }}
                  placeholder="Search"
                  aria-label="Search leads"
                  // cs-own-fill: its own fill and border in dark mode too (globals.css), as the Dashboard's.
                  className={`cs-own-fill h-9 w-full rounded-full border pl-9 pr-3.5 text-[12px] font-semibold outline-none transition-colors focus:border-[var(--brand)] max-sm:pl-[34px] ${
                    search.trim() ? "" : "max-sm:pr-0 max-sm:focus:pr-3.5"
                  }`}
                  style={{
                    borderColor: leadsToolbarPalette.border,
                    backgroundColor: leadsToolbarPalette.panelBg,
                    color: leadsToolbarPalette.inputText,
                    ["--field-bg" as string]: leadsToolbarPalette.panelBg,
                    ["--field-border" as string]: leadsToolbarPalette.border,
                  }}
                />
              </div>
              {/* Phone: this view's buttons, just their icons, centred between the search and the toggle — columns:
                  Compact and Sort; list: the status filter and the order (each opening its menu). They slide away while
                  the search is open (the Dashboard's). Create Lead floats at the bottom right instead (below). */}
              <div className="relative z-0 flex flex-1 translate-x-0 justify-center gap-2 overflow-hidden transition-[opacity,flex-grow,transform,margin] duration-200 peer-focus-within:pointer-events-none peer-focus-within:-ml-2 peer-focus-within:w-0 peer-focus-within:flex-none peer-focus-within:translate-x-6 peer-focus-within:opacity-0 peer-data-[opening=true]:pointer-events-none peer-data-[opening=true]:-ml-2 peer-data-[opening=true]:w-0 peer-data-[opening=true]:flex-none peer-data-[opening=true]:translate-x-6 peer-data-[opening=true]:opacity-0 sm:hidden">
                {leadsViewMode === "board" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setIsBoardCardsCompact((prev) => !prev);
                        setCompactCardOverrides({});
                      }}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition hover:brightness-95"
                      style={
                        isBoardCardsCompact
                          ? { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)", color: "#fff" }
                          : { borderColor: leadsToolbarPalette.border, backgroundColor: leadsToolbarPalette.panelBg, color: leadsToolbarPalette.textMuted }
                      }
                      title={isBoardCardsCompact ? "Show full cards" : "Collapse cards to names only"}
                      aria-label={isBoardCardsCompact ? "Show full cards" : "Collapse cards to names only"}
                    >
                      <Rows3 size={15} />
                    </button>
                    <BoardSortButton
                      value={leadBoardSort}
                      onChange={setLeadBoardSort}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center border transition hover:brightness-95"
                      labelClassName="hidden"
                      style={{
                        backgroundColor: leadsToolbarPalette.panelBg,
                        borderRadius: 9999,
                        ...(leadBoardSort === "custom" ? { color: leadsToolbarPalette.textMuted, borderColor: leadsToolbarPalette.border } : {}),
                      }}
                    />
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      data-leads-phone-menu-trigger="true"
                      onClick={(e) => openLeadsPhoneMenu("status", e)}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border"
                      style={
                        statusFilter === "all"
                          ? { borderColor: leadsToolbarPalette.border, backgroundColor: leadsToolbarPalette.panelBg, color: leadsToolbarPalette.textMuted }
                          : { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand)", color: "#FFFFFF" }
                      }
                      title="Filter by status"
                      aria-label="Filter by status"
                    >
                      <ListFilter size={16} />
                    </button>
                    <button
                      type="button"
                      data-leads-phone-menu-trigger="true"
                      onClick={(e) => openLeadsPhoneMenu("order", e)}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border"
                      style={
                        listOrder === "newest"
                          ? { borderColor: leadsToolbarPalette.border, backgroundColor: leadsToolbarPalette.panelBg, color: leadsToolbarPalette.textMuted }
                          : { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand)", color: "#FFFFFF" }
                      }
                      title="Order"
                      aria-label="Order"
                    >
                      <ArrowUpDown size={15} />
                    </button>
                  </>
                )}
              </div>
              {/* Phone: Create Lead, as a floating round + at the bottom right of the screen (the Calendar's New event) —
                  portalled so it's fixed to the screen whatever the page around it does. */}
              {typeof document !== "undefined"
                ? createPortal(
                    <button
                      type="button"
                      onClick={openLeadForm}
                      // The glass shine (lib/glass-shine.ts), in the brand blue — with a floating button's deeper shadow.
                      className="glass-shine fixed right-4 z-[60] inline-flex h-14 w-14 items-center justify-center rounded-full text-white transition hover:brightness-105 active:scale-95 disabled:opacity-55 sm:hidden"
                      style={glassShineStyle("var(--brand)", {
                        bottom: "calc(20px + env(safe-area-inset-bottom))",
                        boxShadow: "0 8px 22px rgba(15, 23, 42, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.5)",
                      })}
                      title="Create Lead"
                      aria-label="Create Lead"
                    >
                      <Plus size={28} strokeWidth={2.4} />
                    </button>,
                    document.body,
                  )
                : null}
              {leadsPhoneMenu && typeof document !== "undefined"
                ? createPortal(
                    <div
                      data-leads-phone-menu="true"
                      className="fixed overflow-hidden rounded-[10px] border p-1 shadow-[var(--shadow-md)]"
                      style={{
                        left: leadsPhoneMenu.left,
                        top: leadsPhoneMenu.top,
                        width: leadsPhoneMenu.width,
                        zIndex: 2147483647,
                        borderColor: "var(--glass-border)",
                        backgroundColor: "var(--glass-modal-bg)",
                        backdropFilter: "blur(12px) saturate(220%)",
                        WebkitBackdropFilter: "blur(12px) saturate(220%)",
                      }}
                    >
                      {(leadsPhoneMenu.kind === "status"
                        ? [
                            { key: "all", label: "All statuses", color: "" },
                            ...leadStatusOptions.map((status) => ({
                              key: String(status).trim().toLowerCase(),
                              label: status,
                              color: String(leadStatusPillStyle(status).backgroundColor || ""),
                            })),
                          ]
                        : [
                            { key: "newest", label: "Newest", color: "" },
                            { key: "oldest", label: "Oldest", color: "" },
                            { key: "status", label: "By status", color: "" },
                            { key: "az", label: "A – Z", color: "" },
                            { key: "za", label: "Z – A", color: "" },
                          ]
                      ).map((option) => {
                        const active = leadsPhoneMenu.kind === "status" ? statusFilter === option.key : listOrder === option.key;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => {
                              if (leadsPhoneMenu.kind === "status") setStatusFilter(option.key);
                              else setListOrder(option.key as "status" | "az" | "za" | "newest" | "oldest");
                              setLeadsPhoneMenu(null);
                            }}
                            className="flex w-full items-center gap-2 rounded-[10px] px-3.5 py-3 text-left text-[15px] font-bold"
                            style={{ backgroundImage: active ? "var(--brand-gradient)" : "none", color: active ? "#FFFFFF" : leadsToolbarPalette.text }}
                          >
                            {leadsPhoneMenu.kind === "status" ? (
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: option.color || "transparent" }} />
                            ) : null}
                            {option.label}
                          </button>
                        );
                      })}
                    </div>,
                    document.body,
                  )
                : null}
              <button
                type="button"
                role="switch"
                aria-checked={leadsViewMode === "board"}
                onClick={() => setLeadsViewMode((prev) => (prev === "board" ? "grid" : "board"))}
                // Phone: at the row's right end, apart from the rest (the Dashboard's), staying while the search is open.
                className="relative inline-flex h-[38px] w-[82px] shrink-0 items-center overflow-hidden rounded-full border p-1 max-sm:absolute max-sm:right-0 max-sm:top-1/2 max-sm:z-20 max-sm:-translate-y-1/2"
                style={{ borderColor: leadsToolbarPalette.border, backgroundColor: leadsToolbarPalette.panelBg }}
                title="Toggle lead view"
                aria-label="Toggle lead view"
              >
                <div
                  className="absolute top-1 h-7 w-9 rounded-full transition-all duration-200"
                  style={{ left: leadsViewMode === "grid" ? 4 : 40, backgroundImage: "var(--brand-gradient)" }}
                />
                <span className="relative z-[1] flex h-7 w-9 items-center justify-center rounded-full">
                  <Rows3 size={15} style={{ color: leadsViewMode === "grid" ? "#fff" : leadsToolbarPalette.textMuted }} />
                </span>
                <span className="relative z-[1] flex h-7 w-9 items-center justify-center rounded-full">
                  <Kanban size={15} style={{ color: leadsViewMode === "board" ? "#fff" : leadsToolbarPalette.textMuted }} />
                </span>
              </button>
              {leadsViewMode === "board" && (
                <button
                  type="button"
                  onClick={() => {
                    setIsBoardCardsCompact((prev) => !prev);
                    setCompactCardOverrides({});
                  }}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-[12px] font-bold transition hover:brightness-95 max-sm:hidden"
                  style={
                    isBoardCardsCompact
                      ? { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)", color: "#fff" }
                      : { borderColor: leadsToolbarPalette.border, backgroundColor: leadsToolbarPalette.panelBg, color: leadsToolbarPalette.textMuted }
                  }
                  title={isBoardCardsCompact ? "Show full cards" : "Collapse cards to names only"}
                  aria-label={isBoardCardsCompact ? "Show full cards" : "Collapse cards to names only"}
                >
                  <Rows3 size={14} />
                  <span className="max-sm:hidden">Compact</span>
                </button>
              )}
              {leadsViewMode === "board" && (
                // The Dashboard's: white like the search and toggle (blue once a sort's chosen), round-ended; just the
                // icon on a phone.
                <BoardSortButton
                  value={leadBoardSort}
                  onChange={setLeadBoardSort}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 border px-3 text-[12px] font-bold transition hover:brightness-95 max-sm:hidden"
                  labelClassName="max-sm:hidden"
                  style={{
                    backgroundColor: leadsToolbarPalette.panelBg,
                    borderRadius: 9999,
                    ...(leadBoardSort === "custom" ? { color: leadsToolbarPalette.textMuted, borderColor: leadsToolbarPalette.border } : {}),
                  }}
                />
              )}
              {leadsViewMode === "grid" && (
                // Which status to show (All, then each status with its colour) and the order — the same dropdown, the same
                // look. Beside the rest on a computer; on a phone, their own line under it.
                <div className="flex shrink-0 items-center gap-2 max-sm:hidden">
                  <GlassDropdown
                    value={statusFilter}
                    options={[
                      { value: "all", label: "All statuses" },
                      ...leadStatusOptions.map((status) => ({
                        value: String(status).trim().toLowerCase(),
                        label: status,
                        color: String(leadStatusPillStyle(status).backgroundColor || ""),
                      })),
                    ]}
                    onChange={setStatusFilter}
                    ariaLabel="Status"
                    triggerClassName="cs-own-fill h-9 min-w-[150px] shrink-0 justify-between rounded-full border px-3.5 text-[12px] font-bold max-sm:min-w-0 max-sm:flex-1"
                    triggerStyle={{
                      borderColor: statusFilter === "all" ? leadsToolbarPalette.border : "var(--brand)",
                      backgroundColor: leadsToolbarPalette.panelBg,
                      color: leadsToolbarPalette.text,
                    }}
                  />
                  <GlassDropdown
                    value={listOrder}
                    options={[
                      { value: "newest", label: "Newest" },
                      { value: "oldest", label: "Oldest" },
                      { value: "status", label: "By status" },
                      { value: "az", label: "A – Z" },
                      { value: "za", label: "Z – A" },
                    ]}
                    onChange={(next) => setListOrder((next as "status" | "az" | "za" | "newest" | "oldest") || "newest")}
                    ariaLabel="Order"
                    triggerClassName="cs-own-fill h-9 min-w-[120px] shrink-0 justify-between rounded-full border px-3.5 text-[12px] font-bold max-sm:min-w-0 max-sm:flex-1"
                    triggerStyle={{
                      borderColor: leadsToolbarPalette.border,
                      backgroundColor: leadsToolbarPalette.panelBg,
                      color: leadsToolbarPalette.text,
                    }}
                  />
                </div>
              )}
              <div className="ml-auto flex shrink-0 items-center gap-2 max-sm:hidden">
                {leadsViewMode === "grid" ? (
                  // The Dashboard's: how many rows a page shows (the next page comes in as it's scrolled). Not on a phone,
                  // where scrolling is all there is to it.
                  <div className="hidden items-center gap-1.5 sm:flex">
                    <span className="text-[11px] font-semibold" style={{ color: leadsToolbarPalette.textMuted }}>Show</span>
                    <select
                      value={listPageSize}
                      onChange={(e) => setListPageSize(Number(e.target.value))}
                      aria-label="Leads per page"
                      className="cs-own-fill h-9 border px-3 text-[12px] font-bold outline-none"
                      style={{
                        borderRadius: 9999,
                        borderColor: leadsToolbarPalette.border,
                        backgroundColor: leadsToolbarPalette.panelBg,
                        color: leadsToolbarPalette.text,
                        ["--field-bg" as string]: leadsToolbarPalette.panelBg,
                        ["--field-border" as string]: leadsToolbarPalette.border,
                      }}
                    >
                      {[10, 20, 30, 40, 50].map((size) => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </select>
                    <span className="text-[11px] font-semibold" style={{ color: leadsToolbarPalette.textMuted }}>per page</span>
                  </div>
                ) : null}
                {/* How many — the columns view only (the list, like the Dashboard's, has its rows and "Show N per page"
                    there instead, which keeps it all on one line), and only with the stat cards off (they say as much). */}
                {leadsViewMode === "board" && !leadStatCardsEnabled ? (
                  <span
                    className="inline-flex h-9 items-center rounded-full border px-3.5 text-[12px] font-bold max-sm:hidden"
                    style={{ borderColor: leadsToolbarPalette.border, backgroundColor: leadsToolbarPalette.panelBg, color: leadsToolbarPalette.textMuted }}
                  >
                    {filteredLeads.length} lead{filteredLeads.length === 1 ? "" : "s"} · {newCount} new
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={openLeadForm}
                  // The glass shine (lib/glass-shine.ts), in the brand blue.
                  className="glass-shine inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-[12px] font-bold text-white hover:brightness-105 disabled:opacity-55 max-sm:w-9 max-sm:px-0"
                  style={glassShineStyle("var(--brand)")}
                  title="Create Lead"
                  aria-label="Create Lead"
                >
                  <Plus size={14} />
                  <span className="max-sm:hidden">Create Lead</span>
                </button>
              </div>
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
                <>
                  {/* Phones and tablets (below lg): each lead a card, the Dashboard list's — its name and status, then its
                      phone, email and suburb, and when it came in. */}
                  <div className="-mx-3 md:-mx-4 lg:hidden">
                    <div className="grid grid-cols-1 gap-2 px-2 pb-2 pt-2 md:grid-cols-2">
                      {visibleListLeads.map((lead) => {
                        const details = leadListDetails(lead, fieldLayoutForLead(lead));
                        return (
                          <div
                            key={lead.id}
                            role="button"
                            tabIndex={0}
                            className="w-full cursor-pointer rounded-[14px] border px-3.5 py-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]"
                            style={{
                              borderColor: leadsListPalette.border,
                              backgroundColor: hoveredLeadRowId === lead.id ? leadsListPalette.rowHover : leadsListPalette.panelBg,
                            }}
                            onMouseEnter={() => setHoveredLeadRowId(lead.id)}
                            onMouseLeave={() => setHoveredLeadRowId((prev) => (prev === lead.id ? "" : prev))}
                            onClick={(e) => openLeadFromListRow(e.currentTarget, lead)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openLeadFromListRow(e.currentTarget, lead);
                              }
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="line-clamp-2 text-[16px] font-bold" style={{ color: leadsListPalette.text }}>{details.name}</p>
                              <button
                                type="button"
                                data-lead-status-trigger="true"
                                onClick={(e) => openListStatusMenu(e, lead)}
                                className="glass-shine inline-flex h-7 w-[118px] shrink-0 items-center justify-center rounded-full px-3 text-[11px] font-normal"
                                style={glassShineStyle(leadStatusPillStyle(lead.status || "New"))}
                                aria-label="Lead status"
                                title="Change lead status"
                              >
                                {statusUpdatingLeadId === lead.id ? "Saving..." : lead.status || "New"}
                              </button>
                            </div>
                            <div className="mt-2 flex items-end justify-between gap-2">
                              <div className="flex min-w-0 flex-col gap-1 text-[12px]" style={{ color: leadsListPalette.text }}>
                                {details.phone ? (
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <Phone size={11} className="shrink-0" style={{ color: leadsListPalette.textMuted }} />
                                    <span className="truncate">{details.phone}</span>
                                  </span>
                                ) : null}
                                {details.email ? (
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <Mail size={11} className="shrink-0" style={{ color: leadsListPalette.textMuted }} />
                                    <span className="truncate">{details.email}</span>
                                  </span>
                                ) : null}
                                {details.suburb ? (
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <MapPin size={11} className="shrink-0" style={{ color: leadsListPalette.textMuted }} />
                                    <span className="truncate">{details.suburb}</span>
                                  </span>
                                ) : null}
                              </div>
                              <p className="flex shrink-0 items-center gap-1 text-[11px]" style={{ color: leadsListPalette.textSoft }}>
                                <CalendarDays size={11} className="shrink-0" style={{ color: leadsListPalette.textMuted }} />
                                <span>{details.received}</span>
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {visibleListLeads.length < filteredLeads.length ? (
                      <div className="flex items-center justify-center gap-2 px-3 py-4 text-center text-[12px] font-semibold" style={{ color: leadsListPalette.textMuted }}>
                        Loading more leads...
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-[var(--glass-border)] border-t-[var(--brand-strong)]" role="status" aria-label="Loading" />
                      </div>
                    ) : null}
                  </div>
                  {/* Desktop: the Dashboard list's table, straight on the page — Date received, Name, Phone, Email, Suburb
                      and Status; its headings sticking under the top bar (frosted once they have), each row's line
                      fading out at each end, and a row lighting up under the pointer. */}
                  <div className="hidden lg:block">
                    <table className="w-full table-fixed text-[12px]" style={{ minWidth: 150 + 220 + 140 + 240 + 150 + listStatusColumnWidthPx }}>
                      <colgroup>
                        <col style={{ width: "150px" }} />
                        <col style={{ width: "220px" }} />
                        <col style={{ width: "140px" }} />
                        <col style={{ width: "240px" }} />
                        <col style={{ width: "150px" }} />
                        <col style={{ width: `${listStatusColumnWidthPx}px` }} />
                      </colgroup>
                      <thead
                        ref={leadsListHeadRef}
                        className="sticky top-12 z-20"
                        style={{
                          backgroundColor: isLeadsListHeaderStuck
                            ? themeMode === "dark"
                              ? "rgba(11,13,18,0.6)"
                              : "rgba(245,247,250,0.6)"
                            : flatPageBg(themeMode === "dark"),
                          backdropFilter: isLeadsListHeaderStuck ? "blur(12px) saturate(220%)" : "none",
                          WebkitBackdropFilter: isLeadsListHeaderStuck ? "blur(12px) saturate(220%)" : "none",
                          transition: "background-color 280ms ease, backdrop-filter 280ms ease",
                        }}
                      >
                        <tr style={fadedRowLineStyle(leadsListPalette.border)}>
                          <th className="py-2 pl-[10px] text-left text-[11px] font-bold" style={{ color: leadsListPalette.textMuted }}>Date Received</th>
                          <th className="py-2 text-left text-[11px] font-bold" style={{ color: leadsListPalette.textMuted }}>Name</th>
                          <th className="py-2 text-left text-[11px] font-bold" style={{ color: leadsListPalette.textMuted }}>Phone</th>
                          <th className="py-2 text-left text-[11px] font-bold" style={{ color: leadsListPalette.textMuted }}>Email</th>
                          <th className="py-2 text-left text-[11px] font-bold" style={{ color: leadsListPalette.textMuted }}>Suburb</th>
                          <th className="py-2 text-right text-[11px] font-bold" style={{ width: listStatusColumnWidthPx, color: leadsListPalette.textMuted }}>
                            <span className="inline-block text-center" style={{ width: listStatusPillWidthPx, marginRight: 10 }}>Status</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleListLeads.map((lead) => {
                          const details = leadListDetails(lead, fieldLayoutForLead(lead));
                          const rowHoverColor = themeMode === "dark" ? "rgba(0, 0, 0, 0.25)" : "#ECF0F6";
                          const rowBg = hoveredLeadRowId === lead.id ? fadedAcrossRow(rowHoverColor) : "none";
                          return (
                            <tr
                              key={lead.id}
                              className="cursor-pointer transition-colors"
                              style={fadedRowLineStyle(themeMode === "dark" ? "var(--glass-border)" : leadsListPalette.border, rowBg)}
                              onMouseEnter={() => setHoveredLeadRowId(lead.id)}
                              onMouseLeave={() => setHoveredLeadRowId((prev) => (prev === lead.id ? "" : prev))}
                              onClick={(e) => openLeadFromListRow(e.currentTarget, lead)}
                            >
                              <td className="truncate py-[11px] pl-[10px] text-[12px]" style={{ color: leadsListPalette.textSoft }}>{details.received}</td>
                              <td className="truncate py-[11px] font-bold" style={{ color: leadsListPalette.text }}>{details.name}</td>
                              <td className="truncate py-[11px] text-[12px]" style={{ color: leadsListPalette.text }}>{details.phone || "-"}</td>
                              <td className="truncate py-[11px] text-[12px]" style={{ color: leadsListPalette.text }}>{details.email || "-"}</td>
                              <td className="truncate py-[11px] text-[12px]" style={{ color: leadsListPalette.text }}>{details.suburb || "-"}</td>
                              <td className="relative py-[6px] text-right" style={{ width: listStatusColumnWidthPx }}>
                                <button
                                  type="button"
                                  data-lead-status-trigger="true"
                                  onClick={(e) => openListStatusMenu(e, lead)}
                                  className="glass-shine inline-flex items-center justify-center rounded-full px-3 py-2 text-[12px] font-normal"
                                  style={glassShineStyle({ ...leadStatusPillStyle(lead.status || "New"), width: listStatusPillWidthPx, marginRight: 10 })}
                                  aria-label="Lead status"
                                  title="Change lead status"
                                >
                                  {statusUpdatingLeadId === lead.id ? "Saving..." : lead.status || "New"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {visibleListLeads.length < filteredLeads.length ? (
                          <tr>
                            <td className="py-4 text-center" style={{ color: leadsListPalette.textMuted }} colSpan={6}>
                              <div className="flex items-center justify-center gap-2">
                                Loading more leads...
                                <div className="h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-[var(--glass-border)] border-t-[var(--brand-strong)]" role="status" aria-label="Loading" />
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                  {/* A row's status menu: each status in its own colour (the Dashboard's). */}
                  {listStatusMenu && typeof document !== "undefined"
                    ? createPortal(
                        <div
                          data-lead-status-menu="true"
                          className="fixed overflow-hidden rounded-[10px] border p-1 shadow-[var(--shadow-md)]"
                          style={{
                            left: listStatusMenu.left,
                            top: listStatusMenu.top,
                            width: listStatusMenu.width,
                            zIndex: 2147483647,
                            borderColor: "var(--glass-border)",
                            backgroundColor: "var(--glass-modal-bg)",
                            backdropFilter: "blur(12px) saturate(220%)",
                            WebkitBackdropFilter: "blur(12px) saturate(220%)",
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {leadStatusOptions.map((option) => {
                            const menuLead = getLeadById(listStatusMenu.leadId);
                            const active = String(menuLead?.status || "").trim().toLowerCase() === option.toLowerCase();
                            return (
                              <button
                                key={`${listStatusMenu.leadId}_${option}`}
                                type="button"
                                disabled={!menuLead || statusUpdatingLeadId === listStatusMenu.leadId}
                                onClick={() => {
                                  if (menuLead) void onSelectLeadStatus(menuLead, option);
                                  setListStatusMenu(null);
                                }}
                                className="glass-shine mb-1 block w-full rounded-full px-3 py-2 text-center text-[12px] font-semibold last:mb-0 disabled:opacity-55 max-md:py-3 max-md:text-[15px]"
                                style={glassShineStyle({ ...leadStatusPillStyle(option), filter: active ? "brightness(0.96)" : "brightness(1)" })}
                              >
                                {option}
                              </button>
                            );
                          })}
                        </div>,
                        document.body,
                      )
                    : null}
                </>
              )
            ) : searchFilteredLeads.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed px-4 py-10 text-center" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
                <Inbox size={22} style={{ color: "var(--text-muted)" }} />
                <p className="text-[13px] font-semibold" style={{ color: "var(--text-muted)" }}>No leads yet.</p>
              </div>
            ) : (
              <div
                ref={boardStickyRef}
                data-horizontal-swipe-scroll="true"
                // pt-7: room above the columns for their shadows (this scroller clips them), reaching
                // up under the toolbar (-mt-6 / max-md:-mt-3 against the space-y-4 gap above).
                //
                // Where it sticks: so the columns (28px down inside it) stop the same distance below
                // the top bar as their bottoms sit above the bottom of the screen — 8px (pb-2), 20px on
                // a phone (max-md:pb-5). That's top 28px on desktop (the document scrolls, under the
                // 48px bar), and -20px / -8px under 1024px, where <main> scrolls and already starts
                // below the bar; the height reaches the bottom of the screen from there. At rest the
                // columns sit 20px (32px on a phone) below the header, so by then it — and the
                // collapse button hanging 12px off its bottom — has gone under the bar. No native
                // scrollbar (same as the Dashboard board): it took 10px under the columns, on top of
                // that gap, whenever the columns didn't all fit across. Out to the page's own edges either side (back in
                // by as much — <main>'s px-3 / md:px-4 / lg:px-5), so the first and last columns' shadows have room
                // before this scroller cuts them off.
                className="glass-scroll hide-native-scrollbar sticky -top-5 flex h-[calc(100svh-28px)] min-h-[280px] snap-x snap-mandatory items-stretch gap-2 -mx-3 -mt-6 px-3 pb-2 pt-7 md:-mx-4 md:px-4 lg:-mx-5 lg:px-5 max-md:-top-2 max-md:-mt-3 max-md:h-[calc(100svh-40px)] max-md:pb-5 sm:snap-none lg:top-7 lg:h-[calc(100svh-28px)] lg:min-h-[320px]"
                style={{ overflowX: "auto", overflowY: "hidden" }}
              >
                {leadStatusBoardColumns.columns.map((column) => {
                  const isDragOver = dragOverStatusColumn === column.name;
                  const isCollapsed = Boolean(collapsedStatusColumns[column.name]);
                  const dragHandlers = {
                    onDragOver: (e: ReactDragEvent<HTMLElement>) => {
                      e.preventDefault();
                      if (dragOverStatusColumn !== column.name) setDragOverStatusColumn(column.name);
                      if (isCollapsed || !draggingLeadId) return;
                      const index = leadDropIndexFor(column.name, column.leads, e.currentTarget, e.clientY, draggingLeadId);
                      setLeadDropPreview((prev) => (prev && prev.column === column.name && prev.index === index ? prev : { column: column.name, index }));
                    },
                    onDragLeave: (e: ReactDragEvent<HTMLElement>) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                      setDragOverStatusColumn((prev) => (prev === column.name ? "" : prev));
                      setLeadDropPreview((prev) => (prev?.column === column.name ? null : prev));
                    },
                    // Lands where its preview showed (worked out again from the drop point if there wasn't one).
                    onDrop: (e: ReactDragEvent<HTMLElement>) =>
                      onLeadBoardColumnDrop(
                        e,
                        column.name,
                        isCollapsed
                          ? null
                          : leadDropPreview?.column === column.name
                            ? leadDropPreview.index
                            : leadDropIndexFor(column.name, column.leads, e.currentTarget, e.clientY, draggingLeadId || e.dataTransfer.getData("text/plain")),
                      ),
                  };
                  const glassColumnBg = leadStatusHexToRgba(column.color, 0.85);
                  const glassColumnBorder = "rgba(255,255,255,0.3)";
                  // No backdrop blur: the columns only ever sit over the plain page background, where a
                  // blur changes nothing you can see (and the frame's window stops it seeing past the
                  // column anyway) — but the browser would redo it on every frame of a board scroll.
                  // With the glass shine (lib/glass-shine.ts; className glass-shine) in its status colour, still a little
                  // see-through — as the Dashboard's columns.
                  const glassColumnSurface: React.CSSProperties = glassShineStyle({ backgroundColor: glassColumnBg });
                  const glassColumnShadow = isDragOver
                    ? "0 0 0 3px rgba(255,255,255,0.85), inset 0 1px 0 rgba(255,255,255,0.7)"
                    : "inset 0 1px 0 rgba(255,255,255,0.7), inset 0 30px 40px -32px rgba(255,255,255,0.35), var(--shadow-glass)";
                  const columnBadgeBg = themeMode === "dark" ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.55)";
                  const columnBadgeText = themeMode === "dark" ? "var(--text-main)" : "#000000";
                  // The column's name contrasts against its own colour — dark text on a light one, white on a
                  // dark one — the same as the dashboard's columns (its rowTextColorForFill, same 0.75 cut-off).
                  // The count badge and buttons keep their fixed light/dark colours.
                  const columnTitleTextColor = contrastTextForFill(column.color, 0.75);
                  if (isCollapsed) {
                    return (
                      // The frame cuts the column off at the bottom of the screen while the board
                      // scrolls into place.
                      <BoardColumnFrame
                        key={column.name}
                        {...dragHandlers}
                        data-column-name={column.name}
                        data-board-collapsed="true"
                        className="h-full w-[52px] shrink-0 snap-center sm:snap-align-none"
                        shadow={glassColumnShadow}
                      >
                        <button
                          type="button"
                          onClick={(e) =>
                            expandBoardColumnAnimated(e.currentTarget, () => setCollapsedStatusColumns((prev) => ({ ...prev, [column.name]: false })))
                          }
                          // pt-2: its expand button on the same line as a full column's header buttons,
                          // where the collapse button slides to (lib/board-column-collapse.ts).
                          className="glass-shine flex h-full w-full flex-col items-center gap-3 overflow-hidden rounded-[16px] border pb-3 pt-2 transition hover:brightness-105"
                          style={{
                            borderColor: glassColumnBorder,
                            ...glassColumnSurface,
                          }}
                          title={`Expand ${column.name}`}
                          aria-label={`Expand ${column.name}`}
                        >
                          <span
                            // Where a full column's collapse button slides to (lib/board-column-collapse.ts).
                            data-column-collapse-button="true"
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                            style={{ color: columnBadgeText, backgroundColor: columnBadgeBg }}
                          >
                            <ColumnCollapseChevrons size={14} flipped />
                          </span>
                          <span
                            className="inline-flex h-7 min-w-[28px] shrink-0 items-center justify-center rounded-full px-2 text-[11px] font-bold"
                            style={{ color: columnBadgeText, backgroundColor: columnBadgeBg }}
                          >
                            {column.leads.length}
                          </span>
                          <span
                            className="shrink-0 whitespace-nowrap text-[20px] font-medium"
                            style={{ writingMode: "vertical-rl", color: columnTitleTextColor, letterSpacing: "0.12em" }}
                          >
                            {column.name}
                          </span>
                        </button>
                      </BoardColumnFrame>
                    );
                  }
                  return (
                    // The frame cuts the column off at the bottom of the screen while the board scrolls
                    // into place.
                    <BoardColumnFrame
                      key={column.name}
                      {...dragHandlers}
                      data-column-name={column.name}
                      className="h-full w-[85vw] max-w-[320px] shrink-0 snap-center sm:w-[300px] sm:max-w-none sm:snap-align-none"
                      shadow={glassColumnShadow}
                    >
                      <div
                        className="glass-shine flex h-full w-full flex-col overflow-hidden rounded-[16px] border transition"
                        style={{
                          borderColor: glassColumnBorder,
                          ...glassColumnSurface,
                        }}
                      >
                        <div
                          // pl-[11px]: the collapse button exactly where the collapsed strip centres its own,
                          // so it doesn't move at all either way.
                          className="flex shrink-0 items-center justify-between gap-2 border-b py-2 pl-[11px] pr-3"
                          style={{ borderColor: "rgba(0,0,0,0.15)" }}
                        >
                          <div className="flex min-w-0 items-center gap-1.5">
                            <button
                              type="button"
                              // Left of the title — where the collapsed strip's own button sits — so it
                              // stays put as the column slides into its strip (lib/board-column-collapse.ts).
                              onClick={(e) =>
                                collapseBoardColumnAnimated(e.currentTarget, () => setCollapsedStatusColumns((prev) => ({ ...prev, [column.name]: true })))
                              }
                              data-column-collapse-button="true"
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition hover:brightness-95"
                              style={{ color: columnBadgeText, backgroundColor: columnBadgeBg }}
                              title={`Collapse ${column.name}`}
                              aria-label={`Collapse ${column.name}`}
                            >
                              <ColumnCollapseChevrons size={14} />
                            </button>
                            <p className="truncate text-[15px] font-semibold" style={{ color: columnTitleTextColor }}>{column.name}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span
                              className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-full px-2 text-[11px] font-bold"
                              style={{ color: columnBadgeText, backgroundColor: columnBadgeBg }}
                            >
                              {column.leads.length}
                            </span>
                            <BoardColumnSortMenu
                              columnName={column.name}
                              value={leadColumnSorts[column.name] ?? "custom"}
                              overriddenBy={leadBoardSort}
                              onChange={(mode) =>
                                setLeadColumnSorts((prev) => {
                                  const next = { ...prev };
                                  if (mode === "custom") delete next[column.name];
                                  else next[column.name] = mode;
                                  return next;
                                })
                              }
                              buttonStyle={{ color: columnBadgeText, backgroundColor: columnBadgeBg }}
                            />
                          </div>
                        </div>
                        <div className="glass-scroll board-column-scroll flex-1 space-y-2.5 overflow-y-hidden p-2.5" style={{ scrollbarWidth: "none" }}>
                          {(() => {
                            // While a lead is dragged over this column: a faded copy of it, in the spot it will land.
                            const previewIndex = leadDropPreview?.column === column.name ? leadDropPreview.index : null;
                            const previewLead = previewIndex !== null && draggingLeadId ? getLeadById(draggingLeadId) ?? null : null;
                            // An empty column is just empty — no "No leads." in it.
                            if (column.leads.length === 0 && !previewLead) return null;
                            return withBoardDropPreview(
                              column.leads,
                              draggingLeadId,
                              previewLead ? previewIndex : null,
                              (lead) => (
                                <div key={lead.id} data-board-card-id={lead.id}>
                                  {renderLeadCard(lead, { draggable: true, accentColor: column.color, compact: isBoardCardsCompact })}
                                </div>
                              ),
                              () =>
                                previewLead ? (
                                  <div key="lead-drop-preview" aria-hidden="true" inert className="pointer-events-none" style={BOARD_DROP_PREVIEW_STYLE}>
                                    {renderLeadCard(previewLead, { accentColor: column.color, compact: isBoardCardsCompact, preview: true })}
                                  </div>
                                ) : null,
                            );
                          })()}
                        </div>
                      </div>
                    </BoardColumnFrame>
                  );
                })}
                {leadStatusBoardColumns.otherLeads.length > 0 && (
                  // The frame cuts the column off at the bottom of the screen while the board scrolls into
                  // place. No backdrop blur — same reason as the status columns'.
                  <BoardColumnFrame
                    className="h-full w-[85vw] max-w-[320px] shrink-0 snap-center sm:w-[300px] sm:max-w-none sm:snap-align-none"
                    shadow="var(--shadow-glass)"
                  >
                    <div
                      className="flex h-full w-full flex-col overflow-hidden rounded-[16px] border"
                      style={{
                        borderColor: "var(--glass-border)",
                        backgroundColor: "var(--glass-bg-strong)",
                      }}
                    >
                      <div
                        className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2"
                        style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
                      >
                        <p className="truncate text-[15px] font-semibold" style={{ color: "var(--text-main)" }}>Other</p>
                        <span
                          className="inline-flex h-7 min-w-[28px] shrink-0 items-center justify-center rounded-full px-2 text-[11px] font-bold"
                          style={{ backgroundColor: "var(--text-muted)", color: "var(--panel-bg)" }}
                        >
                          {leadStatusBoardColumns.otherLeads.length}
                        </span>
                      </div>
                      <div className="glass-scroll board-column-scroll flex-1 space-y-2.5 overflow-y-hidden p-2.5" style={{ scrollbarWidth: "none" }}>
                        {leadStatusBoardColumns.otherLeads.map((lead) => renderLeadCard(lead, { compact: isBoardCardsCompact }))}
                      </div>
                    </div>
                  </BoardColumnFrame>
                )}
              </div>
            )}
          </div>
        )}
        {renderLeadDetailDrawer()}
        <DragGhostLayer controller={leadBoardDragGhost} />
        {shouldRenderLeadFormModal && typeof document !== "undefined"
          ? createPortal(
              // Create Lead: how it came in and its status, then a lead form's questions to fill in (none of them
              // required of staff — they don't always get everything on a call). All its text black. A phone: the whole
              // screen.
              <div className="fixed inset-0 z-[236] flex items-center justify-center p-0 sm:p-4">
                <button type="button" aria-label="Close create lead" onClick={closeLeadFormModal} className="glass-modal-backdrop absolute inset-0" />
                <div
                  ref={leadFormModalPanelRef}
                  className="glass-modal-panel relative flex h-[100dvh] w-full flex-col overflow-hidden max-sm:rounded-none! max-sm:border-0! sm:h-auto sm:max-h-[min(860px,92vh)] sm:w-[min(600px,96vw)]"
                >
                  <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-4 max-sm:pt-[calc(16px+env(safe-area-inset-top))]">
                    <h2 className="min-w-0 flex-1 truncate text-[20px] font-semibold" style={{ color: "var(--text-main)" }}>
                      Create Lead
                    </h2>
                    <button type="button" onClick={closeLeadFormModal} className={modalCloseButtonClass} aria-label="Close create lead">
                      <X size={16} />
                    </button>
                  </div>
                  {!createLeadForm ? (
                    <div className="px-5 pb-6">
                      <p className="text-[13px] font-medium leading-[1.5]" style={{ color: "var(--text-main)" }}>
                        There aren&apos;t any lead forms yet. Make one in Company Settings → Leads — its questions are what you fill in here.
                      </p>
                      <a href="/company-settings?section=leads" className={`${primaryButtonClass} mt-4`} style={primaryButtonStyle}>
                        Open Company Settings
                      </a>
                    </div>
                  ) : (
                    <>
                      <div className="glass-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5">
                        <div className="grid gap-3 sm:grid-cols-2">
                          {leadForms.length > 1 ? (
                            <div className="sm:col-span-2">
                              <span className="mb-1.5 block text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                                Form
                              </span>
                              <GlassDropdown
                                value={createLeadForm.id}
                                options={leadForms.map((form) => ({ value: form.id, label: form.name || "Untitled form" }))}
                                onChange={(next) => {
                                  setCreateLeadFormId(next);
                                  setCreateLeadAnswers({});
                                  setCreateLeadErrors({});
                                }}
                                ariaLabel="Form"
                                triggerClassName={`${glassFieldClass} justify-between`}
                              />
                            </div>
                          ) : null}
                          <div>
                            <span className="mb-1.5 block text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                              How it came in
                            </span>
                            <GlassDropdown
                              value={createLeadSource}
                              options={MANUAL_LEAD_SOURCES.map((source) => ({ value: source, label: source }))}
                              onChange={setCreateLeadSource}
                              ariaLabel="How it came in"
                              triggerClassName={`${glassFieldClass} justify-between`}
                            />
                          </div>
                          <div>
                            <span className="mb-1.5 block text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                              Status
                            </span>
                            <GlassDropdown
                              value={createLeadStatus}
                              options={leadStatusOptions.map((status) => ({
                                value: status,
                                label: status,
                                color: String(leadStatusPillStyle(status).backgroundColor || ""),
                              }))}
                              onChange={setCreateLeadStatus}
                              ariaLabel="Status"
                              triggerClassName={`${glassFieldClass} justify-between`}
                            />
                          </div>
                        </div>
                        <div className="my-5 h-px" style={{ backgroundColor: "var(--glass-border)" }} />
                        <LeadFormFields
                          form={createLeadForm}
                          answers={createLeadAnswers}
                          errors={createLeadErrors}
                          disabled={createLeadSaving}
                          hideRequiredMarks
                          strongHelp
                          idPrefix="create_lead"
                          onChange={(questionId, value) => {
                            setCreateLeadAnswers((prev) => ({ ...prev, [questionId]: value }));
                            setCreateLeadErrors((prev) => (prev[questionId] ? { ...prev, [questionId]: "" } : prev));
                          }}
                        />
                      </div>
                      <div
                        className="flex shrink-0 items-center gap-2 border-t px-5 py-3 max-sm:pb-[calc(12px+env(safe-area-inset-bottom))]"
                        style={{ borderColor: "var(--glass-border)" }}
                      >
                        <p className="min-w-0 flex-1 text-[12.5px] font-medium" style={{ color: "var(--danger)" }}>
                          {createLeadMessage}
                        </p>
                        <button type="button" onClick={closeLeadFormModal} disabled={createLeadSaving} className={secondaryButtonClass}>
                          Cancel
                        </button>
                        <button type="button" onClick={() => void submitCreateLead()} disabled={createLeadSaving} className={primaryButtonClass} style={primaryButtonStyle}>
                          {createLeadSaving ? "Saving…" : "Create Lead"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>,
              document.body,
            )
          : null}
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
                    className="flex h-11 w-full items-center justify-center whitespace-nowrap rounded-full border px-4 text-[12px] font-bold text-white hover:brightness-95 disabled:cursor-not-allowed"
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
                      {leadClientName(getLeadDynamicFields(displayLeadImagesLead), fieldLayoutForLead(displayLeadImagesLead)) || displayLeadImagesLead.name || "Untitled Lead"}
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
                    <p className="mt-3 text-[12px] font-semibold" style={{ color: "var(--danger-strong)" }}>{leadImagesError}</p>
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
                                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border opacity-0 transition-opacity group-hover/comment:opacity-100"
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
                                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border opacity-0 transition-opacity group-hover/comment:opacity-100"
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
                          backgroundColor: themeMode === "dark" ? "var(--text-main)" : "#334155",
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
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"
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
                                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"
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
                            className="inline-flex h-8 items-center justify-center rounded-full border px-3 text-[11px] font-bold"
                            style={{ borderColor: "#D7DEE8", color: "#64748B", backgroundColor: "#ffffff" }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSaveLeadImageAnnotation()}
                            className="inline-flex h-8 items-center justify-center rounded-full border px-3 text-[11px] font-bold text-white"
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
                              leadImagePinPopupOriginElRef.current = event.currentTarget;
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
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"
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
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"
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
                              className="inline-flex h-8 items-center justify-center rounded-full border px-3 text-[11px] font-bold"
                              style={{ borderColor: "var(--glass-border)", color: "var(--text-muted)", backgroundColor: "var(--panel-bg)" }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSaveLeadImageAnnotation()}
                              className="inline-flex h-8 items-center justify-center rounded-full border px-3 text-[11px] font-bold text-white"
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
                          backgroundColor: themeMode === "dark" ? "var(--text-main)" : "#334155",
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
                        borderColor: idx === leadImagePreviewIndex ? companyThemeColor : "var(--panel-border)",
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
              aria-label="Close archive lead dialog backdrop"
              onClick={() => setConfirmDeleteLeadId("")}
              className="glass-modal-backdrop absolute inset-0"
            />
            <div ref={deleteConfirmModalPanelRef} className="glass-modal-panel relative w-full max-w-[420px] overflow-hidden">
              <div className="glass-modal-header px-5 py-4">
                <h3 className="text-[15px] font-bold" style={{ color: "var(--text-main)" }}>Archive this lead?</h3>
              </div>
              <div className="px-5 py-4">
                <p className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                  Moves it to the Archive — you can restore it or delete it permanently from there.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteLeadId("")}
                    className="inline-flex h-9 items-center justify-center rounded-full border px-4 text-[12px] font-bold hover:brightness-95"
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
                    className="inline-flex h-9 items-center justify-center rounded-full border px-4 text-[12px] font-bold text-white hover:brightness-95 disabled:opacity-55"
                    style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                  >
                    {deletingLeadId === confirmDeleteLeadId ? "Archiving..." : "Archive"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
