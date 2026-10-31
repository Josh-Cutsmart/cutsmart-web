"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { SETTINGS_SEARCH_INDEX, SETTINGS_SECTIONS as sections, type SettingsSection } from "@/lib/company-settings-sections";
import { CART_COPY_PLACEHOLDERS, DEFAULT_CART_COPY_FORMAT, formatCartCopyLine } from "@/lib/production-hardware";
import { glassShineStyle } from "@/lib/glass-shine";
import { useUndo } from "@/components/undo-bar";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Building2, Check, CheckCircle2, ChevronDown, CircleHelp, ClipboardList, Clock3, DatabaseBackup, Download, GripVertical, HardHat, Layers3, Loader2, Package2, Plus, RotateCcw, Search, Settings, Trophy, Upload, Users, X } from "lucide-react";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { useAuth } from "@/lib/auth-context";
import { authorizedFetch } from "@/lib/api-fetch";
import { useAppTabs } from "@/lib/app-tabs-context";
import {
  addUserNotification,
  createCompanyInviteDetailed,
  fetchCompanyDoc,
  fetchCompanyMembers,
  fetchProjects,
  removeTagsFromCompanyProjects,
  removeCompanyMemberDetailed,
  fetchUserColorMapByUids,
  previewCompanyMemberRemoval,
  saveCompanyDocPatchDetailed,
  saveCompanyMemberDisplayName,
  saveCompanyMemberRole,
  type CompanyMemberOption,
  type MemberRemovalCounts,
  type MemberRemovalDataKind,
} from "@/lib/firestore-data";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";
import { storage } from "@/lib/firebase";
import { getFirebaseStorageQuotaExceededMessage, isFirebaseStorageQuotaExceeded } from "@/lib/firebase-storage-errors";
import { retryAsync } from "@/lib/load-retry";
import { hasPermissionKey, invalidateCompanyAccessCache, isOwnerOrAdmin, useCompanyAccess } from "@/lib/use-company-access";
import { downloadCompanyExport, type CompanyExportProgress } from "@/lib/company-export";
import { appendRoleAudit, describeRoleChanges, newRoleAuditEntry, normalizeRoleAuditLog, type RoleAuditEntry } from "@/lib/role-audit";
import { setViewAsRole } from "@/lib/view-as-role";
import { ColumnAutomationButton, useColumnAutomations } from "@/components/column-automations";
import { invalidateCompanyRoleOverridesCache } from "@/lib/membership";
import { type RoleRow, normalizeRoles, normalizeRoleKey } from "@/lib/company-roles";
import { QUOTE_TEMPLATE_PLACEHOLDERS } from "@/lib/quote-template-placeholders";
import { USER_COLOR_UPDATED_EVENT, type UserColorUpdatedDetail } from "@/lib/user-color-sync";
import SpecsGridEditor from "@/components/specs-grid-editor-lazy";
import { type SpecsGrid, createEmptyGrid, normalizeSpecsGrid } from "@/lib/specs-grid-types";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { GlassDropdown, type GlassDropdownOption } from "@/components/glass-dropdown";
import { DragGhostLayer, useDragGhost } from "@/lib/use-drag-ghost";
import {
  CALENDAR_RETENTION_OPTIONS,
  newCalendarId,
  normalizeCalendarCategories,
  normalizeCalendarRetention,
  normalizeCalendarWorkdays,
  type CalendarAccessLevel,
  type CalendarCategory,
  type CalendarRetention,
} from "@/lib/calendar-data";
import {
  completedStatusMatcher,
  normalizeProjectArchiveDelay,
  PROJECT_ARCHIVE_DELAY_OPTIONS,
  type ProjectArchiveDelay,
} from "@/lib/project-archive";
import {
  CURRENCY_OPTIONS,
  DATE_FORMAT_OPTIONS,
  formatDate,
  formatLength,
  formatMoney,
  currencySymbol,
  normalizeCurrencyCode,
  normalizeDateFormat,
  normalizeMeasurementUnit,
  setActiveCompanyFormats,
  activeLength,
  activeDate,
  activeDateTime,
} from "@/lib/company-formats";
import { NZ_HOLIDAY_REGION_OPTIONS, normalizeNzHolidayRegion, nzPublicHolidays, type NzHolidayRegion } from "@/lib/nz-public-holidays";
import { AccessCodesList, CompanyJoinCodesModal } from "@/components/company-join-codes-modal";
import { BONUS_PAID_OPTIONS, BONUS_PERIOD_MONTH_OPTIONS, completionBonusSettingsFrom } from "@/lib/completion-bonus";
import { LeadFormsPanel, LeadInboxPanel } from "@/components/lead-forms-settings";
import { normalizeLeadForms, type LeadForm } from "@/lib/lead-forms";
import {
  cancelCompanyInvite,
  createTemporaryJoinCode,
  linkJoinCodeToInvite,
  revokeJoinCodesForInvite,
  fetchCompanyInvites,
  fetchJoinCodes,
  revokeTemporaryJoinCode,
  type CompanyInviteRow,
  type JoinCodeRecord,
  type JoinCodesState,
} from "@/lib/company-join-codes";
import { FileText, Lightbulb } from "lucide-react";
import { Box, FolderTree, History, LayoutTemplate, Lock, Percent, Receipt, Shield, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { isStaffContactCategory, withStaffContactCategory } from "@/lib/staff-contacts";
import { Archive, Award, CalendarDays, CircleDashed, Cog, Columns3, Contact, Copy, Cpu, DoorClosed, DoorOpen, Eye, Factory, Globe2, Hammer, HardHat as TradeIcon, ImageUp, Inbox, KanbanSquare, KeyRound, Link2, Palette, PanelLeft, RefreshCw, Ruler, Shapes, SlidersHorizontal, Star, Tags, Trash2 } from "lucide-react";
import { normalizeSmallJobStatuses } from "@/lib/small-jobs";
import { Skeleton, SkeletonGroup, SkeletonRows } from "@/components/skeleton";
import { EmptyState } from "@/components/empty-state";
import {
  ColorCircle,
  GlassSwitch,
  Segmented,
  SettingRow,
  SettingsCard,
  LengthField,
  ThemeColorPicker,
  chipAddClass,
  chipClass,
  columnHeadClass,
  countPillClass,
  glassFieldClass,
  glassFieldSmClass,
  gripClass,
  iconRemoveButtonClass,
  listRowClass,
  primaryButtonClass,
  primaryButtonStyle,
  rowFieldClass,
  smallButtonClass,
  useGlassConfirm,
  useGlassPrompt,
} from "@/components/settings-ui";


type SubStageRow = { name: string; color: string; isDefault?: boolean };
// isComplete: the "Completed" toggle — projects in this status count as finished (stats, client portal
// closing and archiving; see lib/project-archive.ts). isWon: the "Won" toggle — a project reaching this status (or
// any after it on the board) counts as a won job in Reports, as one whose quote the client accepted does. One status
// each at most. Project statuses only.
type StatusRow = { name: string; color: string; subStages?: SubStageRow[]; isComplete?: boolean; isWon?: boolean };
type SheetSizeRow = { h: string; w: string; isDefault: boolean };
type BoardEdgingMemoryRow = { value: string; count: string };
type BoardColourMemoryRow = { value: string; count: string; edgings: BoardEdgingMemoryRow[] };
type TagUsageRow = { value: string; count: string };
// Every pop-up on this page is put on the page's top level (document.body), not inside the settings content it's
// written in — inside it, it sat in <main>, the page's scroll area: focusing a field in a pop-up scrolled the settings
// page behind it (and back again on saving), and a drag or swipe in it could reach the page underneath.
function ModalPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

// customPrice: no set price — staff enter one each time it's added to a room (Design › Items).
type ItemCategoryItemRow = {
  name: string;
  description: string;
  subcategory: string;
  price: string;
  markupPercent: string;
  customPrice?: boolean;
};
// subcategoryColors: each sub-category's own colour (by lower-case name) — its items' circle in Design › Items; none:
// the category's.
type ItemCategoryRow = {
  name: string;
  color: string;
  subcategories: string;
  subcategoryColors: Record<string, string>;
  items: ItemCategoryItemRow[];
};
// Company-wide categories for Contacts-page contacts — kept here (not per-user) so staff stay
// consistent about what categories exist. Matched by name (not a synthetic id), same loose
// convention Part Types/Item Categories already use.
type ContactCategoryRow = { name: string; color: string };
// A product's sheet size, its price per sheet and the margin added on that price for quotes.
type JobTypeSheetPriceRow = { sheetSize: string; pricePerSheet: string; marginPercent: string };
// Something charged on a quote for every sheet of the product a room uses (e.g. cutting, handling).
type JobTypeMiscChargeRow = { name: string; price: string; marginPercent: string };
// "Grain" used to be its own checkbox; it's now one value of this Type dropdown, alongside the two
// lacquer-sidedness options that drive the Company Wrapped lacquer-SQM calculation and "Melteca"
// (a laminate finish that isn't lacquer at all — it simply never matches the lacquer-sidedness
// lookup, so it needs no special-case handling anywhere).
type JobTypeProductType = "" | "grain" | "lacquer-1" | "lacquer-2" | "melteca";
// Pricing for quotes (Sales > a room's price): each sheet size's price + its margin, then by type — Grain and
// Melteca: edge tape per linear metre (+ margin); Lacquer (1 / 2 side): lacquer per m² (+ margin) — and the misc
// charges, per sheet used.
type JobTypeRow = {
  name: string;
  // Just for telling the products apart in Company Settings (its rows' colour).
  color: string;
  sheetPrices: JobTypeSheetPriceRow[];
  type: JobTypeProductType;
  edgeTapePrice: string;
  edgeTapeMarginPercent: string;
  lacquerSqmPrice: string;
  lacquerMarginPercent: string;
  miscCharges: JobTypeMiscChargeRow[];
};
type EdgebandingRuleRow = { upToMeters: string; addMeters: string };
// A CNC or table saw's own copy of what used to be the single global "Nesting Settings" panel —
// same five fields, same string-typed form-input convention as every other settings object in this
// file (converted to numbers only at save time, see the save patch's own nestingSettings handling).
// Deliberately no sheetHeight/sheetWidth here — the real per-sheet size already lives on each
// board/material's own entry in Materials & Board Types (nestingBoardLayouts' own parseBoardSize,
// in the project page, reads it from there); a machine only needs what's genuinely its own —
// cutting kerf, safety margin, and the smallest piece it can reliably handle.
type MachineNestingSettings = { kerf: string; margin: string; minPieceSize: string };
// An edge bander's own copy of what used to be the single global "Edgebanding" panel — same shape
// normalizeEdgebandingSettings already produces.
type MachineEdgebandingSettings = {
  rules: EdgebandingRuleRow[];
  excessPerEndMm: string;
  roundEnabled: boolean;
  roundDirection: "up" | "down";
  roundNearestMeters: string;
};
type MachineServiceLogEntry = { id: string; date: string; notes: string };
type MachineMaintenanceContact = { name: string; phone: string; email: string };
// "other" covers any machine type without its own special settings section (drill press, dowel
// inserter, etc.) — customTypeLabel is the free-text name shown for it, since "Other" alone isn't
// a useful label on its own row.
type MachineType = "cnc" | "table-saw" | "edge-bander" | "other";
type Machine = {
  id: string;
  type: MachineType;
  customTypeLabel: string;
  name: string;
  model: string;
  serialNumber: string;
  notes: string;
  maintenanceContact: MachineMaintenanceContact;
  serviceHistory: MachineServiceLogEntry[];
  // At most one machine per `type` may have this true — see setMachineAsDefault's own comment.
  isDefaultForType: boolean;
  nestingSettings: MachineNestingSettings;
  edgebandingSettings: MachineEdgebandingSettings;
};
type GapAllowancesSettings = {
  baseBelowBenchToTopOfDoorDrawer: string;
  baseHorizontalGapNormalHandles: string;
  baseHorizontalGapWrapOverHandles: string;
  baseVerticalGapDoorsPanels: string;
  tallTopOfDoorToTopWithScribers: string;
  tallTopOfDoorToTopNoScribers: string;
  tallVerticalGapDoorsPanels: string;
};
// "custom": a piece cut to a shape of its own (an L-shaped corner shelf, a notched top...) — drawn in the Production
// Cutlist (components/cutlist-shape-editor.tsx) instead of typed as a Height × Width.
type PartTypeCategory = "" | "cabinetry" | "drawer" | "door" | "panel" | "extra" | "custom";
type PartTypeRow = {
  name: string;
  color: string;
  category: PartTypeCategory;
  autoClashLeft: string;
  autoClashRight: string;
  initialMeasure: boolean;
  inCutlists: boolean;
  inNesting: boolean;
};
type QuoteHelperRow = { id: string; content: string };
type DiscountTierRow = { low: string; high: string; discount: string };
// Company Settings → Sales → Extra charges: a named charge with a price that a project's quote can include (each one
// toggled on / off in the project's Design tab). `isDefault`: on for every project's quote unless turned off there.
// `id` stays the same through renames — it's what a project's toggles are kept against.
type ExtraChargeRow = { id: string; name: string; price: string; isDefault: boolean };
type HardwareRow = {
  name: string;
  color: string;
  default: boolean;
  drawersJson: string;
  hingesJson: string;
  otherJson: string;
  // How a project's order copies this brand's items for its supplier's quick order (the Ordering tab). "" — the default.
  cartCopyFormat: string;
};
type BackupTemplateSettings = {
  quoteTemplateHeaderHtml: string;
  quoteTemplateFooterHtml: string;
  quoteTemplatePageSize: string;
  quoteTemplateMarginMm: string;
  quoteTemplateFooterPinBottom: boolean;
};
type ZapierLeadsSettings = {
  enabled: boolean;
  webhookSecret: string;
  fieldLayout: LeadFieldLayoutRow[];
};
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

const LEAD_PROJECT_FIELD_TARGET_OPTIONS: Array<{ value: LeadProjectFieldTarget; label: string }> = [
  { value: "", label: "Not Used" },
  { value: "clientName", label: "Client Name" },
  { value: "clientFirstName", label: "Client First Name" },
  { value: "clientLastName", label: "Client Last Name" },
  { value: "clientPhone", label: "Client Phone" },
  { value: "clientEmail", label: "Client Email" },
  { value: "projectAddress", label: "Project Address" },
  { value: "projectNotes", label: "Project Notes" },
];

function defaultSheetSizeValue(sheetSizes: SheetSizeRow[]): string {
  const defaultSize = sheetSizes.find((row) => row.isDefault) ?? sheetSizes[0] ?? null;
  const h = toStr(defaultSize?.h);
  const w = toStr(defaultSize?.w);
  return h && w ? `${h} x ${w}` : "";
}

function normalizeLeadFieldLayoutOrder(rows: LeadFieldLayoutRow[]): LeadFieldLayoutRow[] {
  return rows.map((row, idx) => ({ ...row, order: idx }));
}
type PendingOwnerTransferState = {
  currentOwnerUid: string;
  currentOwnerName: string;
  nextRoleId: string;
};

type PendingStaffRemovalState = {
  uid: string;
  displayName: string;
  roleId: string;
  // How much of each kind of company data is tied to them — null when it couldn't be counted.
  counts: MemberRemovalCounts | null;
  // Which kinds go to transferToUid. The rest keep their "not transferred" behaviour (STAFF_REMOVAL_DATA_ROWS).
  transfer: Record<MemberRemovalDataKind, boolean>;
  transferToUid: string;
  typedName: string;
  confirmPhase: "prompt" | "type_name";
  // Set when this removal is revoking the temporary join code they joined with (Join key pop-up):
  // revoked once they're removed.
  revokeCode?: { key: string; code: string };
};

// The Remove Staff Member pop-up's hand-over rows: one per kind of company data tied to the person
// being removed. `keep` is what happens when it is NOT transferred — nothing is ever deleted; the
// server side of each is app/api/company/remove-member (TRANSFER_KINDS). `name` is the person being
// removed, `to` the person receiving.
const STAFF_REMOVAL_DATA_ROWS: Array<{
  kind: MemberRemovalDataKind;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  move: (to: string, name: string) => string;
  keep: (name: string) => string;
}> = [
  {
    kind: "assignedProjects",
    label: "Active projects assigned to them",
    icon: KanbanSquare,
    move: (to) => `Reassigned to ${to}.`,
    keep: () => "Left unassigned, for someone who can see all projects to pick up.",
  },
  {
    kind: "createdProjects",
    label: "Projects they created",
    icon: ClipboardList,
    move: (to, name) => `${to} becomes their creator, with the access ${name} had to them.`,
    keep: (name) => `Stay as they are, still credited to ${name}.`,
  },
  {
    kind: "contacts",
    label: "Contacts linked to them",
    icon: Contact,
    move: (to, name) =>
      `${to} takes ${name}'s place on these contacts — except any ${to} already has (same email, phone number or name), which stay as they are.`,
    keep: (name) => `Stay in Contacts, still linked to ${name} — staff who can see all contacts still see them.`,
  },
  {
    kind: "leads",
    label: "Leads assigned to them",
    icon: Inbox,
    move: (to) => `Reassigned to ${to}.`,
    keep: () => "Left unassigned, for someone who can see everyone's leads to pick up.",
  },
  {
    kind: "calendarEvents",
    label: "Calendar events they added",
    icon: CalendarDays,
    move: (to) => `Shown as added by ${to}.`,
    keep: (name) => `Stay on the calendar, still showing ${name} as who added them.`,
  },
];

// Whether anything switched on actually has data to move (and so needs someone to move it to). With
// no counts (the preview failed) a switched-on kind is assumed to have some.
function staffRemovalNeedsRecipient(pending: PendingStaffRemovalState): boolean {
  return STAFF_REMOVAL_DATA_ROWS.some(({ kind }) => pending.transfer[kind] && (pending.counts ? pending.counts[kind] > 0 : true));
}

const desktopPermissionKeys = [
  "company.*",
  "company.dashboard.view",
  "clients.view",
  "clients.view.all",
  "leads.view",
  "leads.view.others",
  "projects.create",
  "projects.create.other",
  "projects.view",
  "projects.view.others",
  "projects.edit.others",
  "projects.status",
  "projects.assign.other",
  "projects.create.others",
  "projects.automate",
  "sales.view",
  "sales.edit",
  "production.view",
  "production.edit",
  "production.key",
  "staff.add",
  "staff.remove",
  "staff.change.role",
  "staff.change.display_name",
  "company.settings",
  "company.report",
  "dashboard.complete.bonus",
  "calendar.view",
];

// The role pop-up lists permissions in these groups (any key not matched lands in "Other").
const PERMISSION_GROUPS: Array<{ label: string; match: (key: string) => boolean }> = [
  { label: "Company", match: (k) => k === "company.*" || k === "company.settings" || k === "company.report" },
  { label: "Dashboard & Contacts", match: (k) => k.startsWith("company.dashboard") || k.startsWith("dashboard.") || k.startsWith("clients.") },
  { label: "Leads", match: (k) => k.startsWith("leads.") },
  { label: "Projects", match: (k) => k.startsWith("projects.") },
  { label: "Sales & Production", match: (k) => k.startsWith("sales.") || k.startsWith("production.") },
  { label: "Staff", match: (k) => k.startsWith("staff.") },
  { label: "Calendar", match: (k) => k.startsWith("calendar.") },
];
function groupPermissionKeys(keys: string[]): Array<{ label: string; keys: string[] }> {
  const groups = PERMISSION_GROUPS.map((g) => ({ label: g.label, keys: [] as string[] }));
  const other: string[] = [];
  for (const key of keys) {
    const idx = PERMISSION_GROUPS.findIndex((g) => g.match(key));
    if (idx >= 0) groups[idx].keys.push(key);
    else other.push(key);
  }
  if (other.length) groups.push({ label: "Other", keys: other });
  return groups.filter((g) => g.keys.length);
}

// A permission's name as the audit log says it: "View Dashboard" (its label, without its key or note).
function readablePermission(key: string): string {
  const label = permissionLabels[key];
  if (!label) return key;
  return (label.split(" - ")[1] ?? label).replace(/\s*\(.*\)\s*$/, "").trim() || key;
}

const permissionLabels: Record<string, string> = {
  "calendar.view": "calendar.view - Access Calendar Tab (who can edit / view each category is set in Company Settings > Calendar)",
  "company.*": "company.* - Full Company Access",
  "company.dashboard.view": "company.dashboard.view - View Dashboard",
  "clients.view": "clients.view - Access Contacts Tab (Own Created / Assigned Contacts)",
  "clients.view.all": "clients.view.all - View All Company Contacts",
  "leads.view": "leads.view - Access Leads Tab (Own Assigned Leads)",
  "leads.view.others": "leads.view.others - View All Leads For All Users",
  "projects.create": "projects.create - Create Projects",
  "projects.create.other": "projects.create.other - Change Project Creator / Handover Project",
  "projects.view": "projects.view - View Projects",
  "projects.view.others": "projects.view.others - View Other Users' Projects",
  "projects.edit.others": "projects.edit.others - Edit Other Users' Projects",
  "projects.status": "projects.status - Edit Any Project Status",
  "projects.assign.other": "projects.assign.other - Assign Projects To Other Staff",
  "projects.create.others": "projects.create.others - Legacy Assign/Create Other Projects",
  "projects.automate": "projects.automate - Automate Board Columns (Right-Click A Dashboard Or Leads Column To Notify Staff As Projects Enter, Leave Or Stay)",
  "sales.view": "sales.view - View Sales Tab",
  "sales.edit": "sales.edit - Edit Sales Tab",
  "production.view": "production.view - View Production Tab",
  "production.edit": "production.edit - Edit Production Tab",
  "production.key": "production.key - Grant Temporary Production Edit Access",
  "staff.add": "staff.add - Add Staff To Company",
  "staff.remove": "staff.remove - Remove Staff From Company",
  "staff.change.role": "staff.change.role - Change Staff Member Role",
  "staff.change.display_name": "staff.change.display_name - Change Staff Display Name",
  "company.settings": "company.settings - View/Change Company Settings",
  "company.report": "company.report - Access Reports Tab (Company-Wide Sales, Leads And Project Figures)",
  "dashboard.complete.bonus": "dashboard.complete.bonus - Bonus Completed Projects Dashboard View",
};


const cutlistColumnDefaults = ["Board", "Part Name", "Height", "Width", "Depth", "Quantity", "Clashing", "Information", "Grain"];
const autoClashLeftOptions = ["1L", "2L"];
const RESERVED_LEAD_FIELD_KEYS = new Set(["companyid", "source", "status"]);
const ZAPIER_LEADS_VISIBILITY_UPDATED_EVENT = "cutsmart:zapier-leads-visibility-updated";
const LEAD_PROJECT_FIELD_TARGET_VALUES = new Set<LeadProjectFieldTarget>([
  "",
  "clientName",
  "clientFirstName",
  "clientLastName",
  "clientPhone",
  "clientEmail",
  "projectAddress",
  "projectNotes",
]);

function normalizeLeadFieldKey(key: string) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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

function normalizeLeadFieldLayout(raw: unknown): LeadFieldLayoutRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => {
      const row = item as Record<string, unknown>;
      const key = String(row.key ?? "").trim();
      return {
        key,
        label: String(row.label ?? formatLeadFieldLabel(key)).trim() || formatLeadFieldLabel(key),
        showInRow: Boolean(row.showInRow),
        showInDetail: row.showInDetail == null ? true : Boolean(row.showInDetail),
        order: Number.isFinite(Number(row.order)) ? Number(row.order) : idx,
        projectFieldTarget: LEAD_PROJECT_FIELD_TARGET_VALUES.has(String(row.projectFieldTarget ?? "").trim() as LeadProjectFieldTarget)
          ? (String(row.projectFieldTarget ?? "").trim() as LeadProjectFieldTarget)
          : "",
      };
    })
    .filter((row) => row.key);
}

function mergeLeadFieldLayout(
  availableFields: Array<{ key: string; label: string }>,
  savedLayout: LeadFieldLayoutRow[],
): LeadFieldLayoutRow[] {
  const savedByKey = new Map(savedLayout.map((row) => [normalizeLeadFieldKey(row.key), row]));
  return availableFields
    .map((field, idx) => {
      const existing = savedByKey.get(normalizeLeadFieldKey(field.key));
      return {
        key: field.key,
        label: existing?.label || field.label,
        showInRow: existing?.showInRow ?? idx < 3,
        showInDetail: existing?.showInDetail ?? true,
        order: existing?.order ?? idx,
        projectFieldTarget: existing?.projectFieldTarget ?? "",
      };
    })
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}
const autoClashRightOptions = ["1S", "2S"];

// What the sidebar search can find: every card (plus key individual settings) and the tab it's on.
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const ACTIVE_COMPANY_THEME_COLOR_STORAGE_KEY = "cutsmart_active_company_theme_color";

function toStr(v: unknown, fallback = "") {
  const t = String(v ?? "").trim();
  return t || fallback;
}

// The Undo bar (components/undo-bar.tsx) putting something back on a list it was taken off: at the place it was — or
// at the end, if the list has got shorter than that since.
function insertAt<T>(list: T[], index: number, item: T): T[] {
  return [...list.slice(0, index), item, ...list.slice(index)];
}

// Case-insensitive compare for the "type this name to confirm" safety check — a name typed with
// different casing than it happens to be stored in (or auto-capitalized by a mobile keyboard,
// which most browsers do by default on a plain text input) is still unambiguously the right
// answer, and the exact-match version of this check was failing those silently.
function namesMatchForConfirmation(a: unknown, b: unknown): boolean {
  return toStr(a).toLowerCase() === toStr(b).toLowerCase();
}

function isProtectedStarterRole(value: unknown): boolean {
  const roleKey = normalizeRoleKey(value);
  return roleKey === "owner" || roleKey === "admin" || roleKey === "staff";
}

function autoCapStaffName(v: unknown): string {
  const raw = toStr(v);
  if (!raw) return "";
  return raw
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function tintHex(hex: string, mixWithWhite = 0.86): string {
  const clean = String(hex || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return "#F8FAFC";
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  const t = Math.max(0, Math.min(1, mixWithWhite));
  const rr = Math.round(r + (255 - r) * t);
  const gg = Math.round(g + (255 - g) * t);
  const bb = Math.round(b + (255 - b) * t);
  return `rgb(${rr}, ${gg}, ${bb})`;
}

function textColorForHex(hex: string): string {
  const clean = String(hex || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return "#0F172A";
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#0F172A" : "#FFFFFF";
}

function generateZapierSecret() {
  const randomPart = () => Math.random().toString(36).slice(2, 10);
  return `zpr_${randomPart()}${randomPart()}${Date.now().toString(36)}`;
}

function genMachineId() {
  return `mch_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function genExtraChargeId() {
  return `xc_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function genMachineServiceLogId() {
  return `msl_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

// Every settings card: the redesign's glass card (components/settings-ui.tsx) — title, optional one-line
// description and icon tile, optional header control.
function Panel({
  title,
  description,
  icon,
  badge,
  headerRight,
  children,
  allowOverflow = false,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  badge?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  allowOverflow?: boolean;
  className?: string;
}) {
  return (
    <SettingsCard title={title} description={description} icon={icon} badge={badge} headerRight={headerRight} allowOverflow={allowOverflow} className={className}>
      {children}
    </SettingsCard>
  );
}

// Shared field primitives for every settings panel below — label-above-input on narrow screens,
// a fixed label column once there's room, all colors via CSS vars so light/dark and glass both
// stay correct without repeating a style object at every call site. Using Tailwind's arbitrary-
// value syntax (bg-[var(--panel-bg)] etc.) instead of inline `style` keeps these compact enough
// to read at a glance across the hundreds of fields in this file.
const fieldInputClass = glassFieldClass;
const BONUS_MONTH_NAMES = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("en-NZ", { month: "long" }).format(new Date(2024, month, 1)));
// Same purpose as fieldInputClass but chromeless — no border/background of its own — for a
// spreadsheet-style grid where the row/column lines already do the separating and a bordered
// textbox per cell would just be visual noise. Only becomes visible on focus, so it's still
// discoverable as editable.
const gridCellInputClass = rowFieldClass;
const secondaryButtonClass = smallButtonClass;
// Row delete buttons: a quiet X that only turns red on hover (was a always-red tile).
const dangerIconButtonClass = iconRemoveButtonClass;

// Products are edited in a full-screen sheet (like Item Categories): one table, each product a header row (its name,
// type) with its lines under it in labelled sections — Sheets (a row per size), Misc (a row per charge) and On the
// quote (its Edge tape — Grain / Melteca — or Lacquer row) — all sharing the same columns: Item (which size / charge),
// Cost, Margin, and Sell price (cost + margin, what the quote charges). Every column a set width — the cards are only
// as wide as their columns (centred in the sheet), rather than the item column soaking up a wide screen.
const PRODUCT_SHEET_GRID = "grid grid-cols-[56px_240px_128px_100px_176px_36px] items-center gap-x-3";

// Colours a product starts with (in turn) until it's given its own — clearly different from one another, so the
// products are easy to tell apart (the palette's own first few are all blues).
const PRODUCT_START_COLORS = ["#2F6BFF", "#16A34A", "#E8721C", "#8B5CF6", "#DC2626", "#0EA5E9", "#EAB308", "#D946EF", "#14B8A6", "#A16207"];

const PRODUCT_TYPE_LABELS: Record<JobTypeProductType, string> = {
  "": "No type",
  grain: "Grain",
  "lacquer-1": "Lacquer (1 side)",
  "lacquer-2": "Lacquer (2 side)",
  melteca: "Melteca",
};

function sheetSizeLabel(value: string) {
  return String(value || "").replace(/\s*x\s*/i, " × ") || "No size";
}

// A margin box with its % inside it.
function MarginInput({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <span className="relative block">
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${glassFieldSmClass} pr-6 text-right`}
        placeholder="0"
        aria-label="Margin percent"
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
        %
      </span>
    </span>
  );
}

// A status's place in its list — 1, 2, 3, … Number 1 is where every new project / lead starts, so it's picked out.
function StatusNumber({ index, startsHere }: { index: number; startsHere: string }) {
  const first = index === 0;
  return (
    <span
      className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-[11.5px] font-semibold tabular-nums"
      style={
        first
          ? { backgroundImage: "var(--brand-gradient)", color: "#FFFFFF" }
          : { backgroundColor: "color-mix(in srgb, var(--text-main) 8%, transparent)", color: "var(--text-main)" }
      }
      title={first ? startsHere : undefined}
    >
      {index + 1}
    </span>
  );
}

function FieldRow({
  label,
  hint,
  children,
  align = "center",
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  align?: "center" | "start";
}) {
  return (
    <SettingRow label={label} hint={hint} align={align}>
      {children}
    </SettingRow>
  );
}

// A label-above field, for inside pop-ups.
function StackField({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`grid min-w-0 gap-1.5 text-[12px] font-semibold text-[var(--text-main)] ${className}`}>
      {label}
      {children}
    </label>
  );
}

const MACHINE_TILE_STYLE: Record<MachineType, { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; gradient: string }> = {
  cnc: { icon: Cpu, gradient: "linear-gradient(135deg,#2B9CFF,#0064D6)" },
  "table-saw": { icon: CircleDashed, gradient: "linear-gradient(135deg,#F59E0B,#B45309)" },
  "edge-bander": { icon: PanelLeft, gradient: "linear-gradient(135deg,#14B8A6,#0F766E)" },
  other: { icon: Cog, gradient: "linear-gradient(135deg,#94A3B8,#475569)" },
};

// A small uppercase divider label for grouping related fields within one panel — purely visual,
// no new state. Optional `first` drops the top border/margin for a group at the very top.
function FieldGroupHeading({ children, first = false }: { children: React.ReactNode; first?: boolean }) {
  return (
    <p
      className={`text-[10.5px] font-bold uppercase tracking-[0.8px] text-[var(--text-muted)] ${first ? "" : "mt-1 border-t border-[var(--glass-border)] pt-3"}`}
    >
      {children}
    </p>
  );
}

function normalizeSubStages(raw: unknown): SubStageRow[] {
  if (!Array.isArray(raw)) return [];
  const rows = raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      return { name: toStr(row.name), color: toStr(row.color, "#64748B"), isDefault: Boolean(row.isDefault) };
    })
    .filter((row) => row.name);
  // Defensive: only one default per status, ever — if stale/bad data somehow has more than one,
  // keep just the first and clear the rest rather than letting an ambiguous state through.
  let sawDefault = false;
  return rows.map((row) => {
    if (!row.isDefault) return row;
    if (sawDefault) return { ...row, isDefault: false };
    sawDefault = true;
    return row;
  });
}

function normalizeStatuses(raw: unknown): StatusRow[] {
  if (!Array.isArray(raw)) {
    return [
      { name: "New", color: "#3060D0", isComplete: false },
      { name: "In Production", color: "#2A7A3B", isComplete: false },
      { name: "Completed", color: "#2A7A3B", isComplete: true },
    ];
  }
  // A company that's never set the Completed toggle starts with it showing whatever already counts
  // as completed for them (the old name-based rule), so saving doesn't quietly change anything.
  // Only one status can be the completed one — if more than one would be ticked (older data, or the
  // old rule matching several names), the first in the list keeps it.
  const isCompletedStatus = completedStatusMatcher(raw);
  let completedTaken = false;
  let wonTaken = false;
  const out = raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      const name = toStr(row.name);
      const isComplete = !completedTaken && Boolean(name) && isCompletedStatus(name);
      if (isComplete) completedTaken = true;
      const isWon = !wonTaken && Boolean(name) && row.isWon === true;
      if (isWon) wonTaken = true;
      return { name, color: toStr(row.color, "#64748B"), subStages: normalizeSubStages(row.subStages), isComplete, isWon };
    })
    .filter((row) => row.name);
  return out.length ? out : [{ name: "New", color: "#3060D0", isComplete: false }];
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
  const out = raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      return { name: toStr(row.name), color: toStr(row.color, "#64748B") };
    })
    .filter((row) => row.name);
  return out.length
    ? out
    : [
        { name: "New", color: "#3060D0" },
        { name: "Contacted", color: "#C77700" },
        { name: "Qualified", color: "#6B4FB3" },
        { name: "Converted", color: "#2A7A3B" },
      ];
}

function normalizeStringList(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const rows = raw.map((v) => toStr(v)).filter(Boolean);
  return rows.length ? rows : [...fallback];
}

function mergeCutlistColumnOrder(baseOrder: unknown, production: string[], initial: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (value: unknown) => {
    const col = toStr(value);
    if (!col || seen.has(col)) return;
    seen.add(col);
    merged.push(col);
  };
  if (Array.isArray(baseOrder)) {
    for (const col of baseOrder) pushUnique(col);
  }
  for (const col of cutlistColumnDefaults) pushUnique(col);
  for (const col of production) pushUnique(col);
  for (const col of initial) pushUnique(col);
  return merged;
}

function sortCutlistSelectionsByOrder(selected: string[], order: string[]): string[] {
  const ranked = order.map((v, idx) => [v, idx] as const);
  const rankMap = new Map<string, number>(ranked);
  return [...new Set(selected.map((v) => toStr(v)).filter(Boolean))].sort((a, b) => {
    const ai = rankMap.get(a);
    const bi = rankMap.get(b);
    if (ai == null && bi == null) return a.localeCompare(b);
    if (ai == null) return 1;
    if (bi == null) return -1;
    return ai - bi;
  });
}

function normalizeSheetSizes(raw: unknown): SheetSizeRow[] {
  if (!Array.isArray(raw)) return [{ h: "2440", w: "1220", isDefault: true }];
  const rows = raw
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      const row = r as Record<string, unknown>;
      return {
        h: toStr(row.h ?? row.height),
        w: toStr(row.w ?? row.width),
        isDefault: Boolean(row.isDefault ?? row.default),
      };
    })
    .filter((r) => r.h && r.w);
  return rows.length ? rows : [{ h: "2440", w: "1220", isDefault: true }];
}

function contrastTextForFill(fill: string): string {
  const clean = String(fill || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return "#0F172A";
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#0F172A" : "#FFFFFF";
}

function normalizeProjectTagUsage(raw: unknown): TagUsageRow[] {
  const rows: Array<Record<string, unknown>> = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry && typeof entry === "object") rows.push(entry as Record<string, unknown>);
    }
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const tags = Array.isArray(obj.tags) ? obj.tags : [];
    for (const entry of tags) {
      if (entry && typeof entry === "object") rows.push(entry as Record<string, unknown>);
    }
  }
  return rows
    .map((row) => ({
      value: toStr(row.value ?? row.tag),
      count: toStr(row.count ?? 0, "0"),
    }))
    .filter((row) => row.value)
    .sort((a, b) => {
      const ac = Number(a.count || 0);
      const bc = Number(b.count || 0);
      return bc - ac || a.value.localeCompare(b.value);
    });
}

function normalizeBoardEdgingMemory(raw: unknown): BoardEdgingMemoryRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = row as Record<string, unknown>;
      return { value: toStr(item.value), count: toStr(item.count ?? 0, "0") };
    })
    .filter((row) => row.value)
    .sort((a, b) => Number(b.count) - Number(a.count) || a.value.localeCompare(b.value));
}

function normalizeBoardColourMemory(raw: unknown): BoardColourMemoryRow[] {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const colours = Array.isArray(obj.colours) ? obj.colours : [];
    return colours
      .filter((row) => row && typeof row === "object")
      .map((row) => {
        const item = row as Record<string, unknown>;
        return { value: toStr(item.value), count: toStr(item.count ?? 0, "0"), edgings: normalizeBoardEdgingMemory(item.edgings) };
      })
      .filter((row) => row.value)
      .sort((a, b) => Number(b.count) - Number(a.count) || a.value.localeCompare(b.value));
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        value: toStr(item.value ?? item.colour ?? item.color),
        count: toStr(item.count ?? 0, "0"),
        edgings: normalizeBoardEdgingMemory(item.edgings),
      };
    })
    .filter((row) => row.value)
    .sort((a, b) => Number(b.count) - Number(a.count) || a.value.localeCompare(b.value));
}

function normalizeItemCategories(raw: unknown): ItemCategoryRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      const subRows = Array.isArray(row.subcategories) ? (row.subcategories as Array<Record<string, unknown> | string>) : [];
      const subs = subRows.map((s) => toStr(typeof s === "string" ? s : s?.name)).filter(Boolean);
      const subcategoryColors: Record<string, string> = {};
      for (const sub of subRows) {
        if (!sub || typeof sub !== "object") continue;
        const subName = toStr(sub.name).toLowerCase();
        const subColor = toStr(sub.color);
        if (subName && subColor) subcategoryColors[subName] = subColor;
      }
      const items = Array.isArray(row.items)
        ? (row.items as Array<Record<string, unknown>>).map((it) => ({
            name: toStr(it?.name),
            description: toStr(it?.description),
            subcategory: toStr(it?.subcategory),
            price: toStr(it?.price),
            markupPercent: toStr(it?.markupPercent),
            customPrice: Boolean(it?.customPrice),
          }))
        : [];
      return {
        name: toStr(row.name),
        color: toStr(row.color, "#7D99B3"),
        subcategories: subs.join(", "),
        subcategoryColors,
        items,
      };
    })
    .filter((r) => r.name);
}

function normalizeJobTypes(raw: unknown): JobTypeRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const row = item as Record<string, unknown>;
      const sheetPrices = Array.isArray(row.sheetPrices)
        ? (row.sheetPrices as Array<Record<string, unknown>>).map((sp) => ({
            sheetSize: toStr(sp?.sheetSize),
            pricePerSheet: toStr(sp?.pricePerSheet),
            marginPercent: toStr(sp?.marginPercent),
          }))
        : [];
      const fallbackSheetSize = toStr(row.sheetSize);
      const fallbackPrice = toStr(row.pricePerSheet);
      return {
        name: toStr(row.name),
        // One from the palette, in turn, for a product that hasn't been given one.
        color: /^#[0-9a-f]{6}$/i.test(toStr(row.color)) ? toStr(row.color) : PRODUCT_START_COLORS[index % PRODUCT_START_COLORS.length],
        sheetPrices:
          sheetPrices.length > 0
            ? sheetPrices
            : fallbackSheetSize || fallbackPrice
              ? [{ sheetSize: fallbackSheetSize, pricePerSheet: fallbackPrice, marginPercent: "" }]
              : [],
        // Legacy docs only ever had `grain: boolean` — a previously-ticked row keeps reading as
        // "grain" once opened under the new Type dropdown instead of silently reverting to blank.
        type: (["grain", "lacquer-1", "lacquer-2", "melteca"].includes(toStr(row.type))
          ? toStr(row.type)
          : Boolean(row.grain ?? row.isGrain ?? false)
            ? "grain"
            : "") as JobTypeProductType,
        edgeTapePrice: toStr(row.edgeTapePrice),
        edgeTapeMarginPercent: toStr(row.edgeTapeMarginPercent),
        lacquerSqmPrice: toStr(row.lacquerSqmPrice),
        lacquerMarginPercent: toStr(row.lacquerMarginPercent),
        miscCharges: Array.isArray(row.miscCharges)
          ? (row.miscCharges as Array<Record<string, unknown>>).map((charge) => ({
              name: toStr(charge?.name),
              price: toStr(charge?.price),
              marginPercent: toStr(charge?.marginPercent),
            }))
          : [],
      };
    })
    .filter((r) => r.name);
}

// Edge tape is priced for every typed product (Grain, Melteca and the Lacquers); lacquer per m² for the two Lacquer
// types too.
function jobTypeHasEdgeTape(type: JobTypeProductType) {
  return type === "grain" || type === "melteca" || type === "lacquer-1" || type === "lacquer-2";
}
function jobTypeHasLacquer(type: JobTypeProductType) {
  return type === "lacquer-1" || type === "lacquer-2";
}

function normalizeContactCategories(raw: unknown): ContactCategoryRow[] {
  const defaults: ContactCategoryRow[] = [
    { name: "Clients", color: "#4ADE80" },
    { name: "Contractor", color: "#F2A33C" },
    { name: "Supplier", color: "#7D99B3" },
  ];
  const rows = !Array.isArray(raw)
    ? defaults
    : raw
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const row = item as Record<string, unknown>;
          return { name: toStr(row.name), color: toStr(row.color, "#7D99B3") };
        })
        .filter((row) => row.name);
  // Every staff member is in everyone's Contacts under "Staff" (lib/staff-contacts.ts).
  return withStaffContactCategory(rows, (name, color) => ({ name, color }));
}

function normalizePartTypes(raw: unknown): PartTypeRow[] {
  const defaults: PartTypeRow[] = [
    { name: "Front", color: "#F2D57A", category: "", autoClashLeft: "", autoClashRight: "", initialMeasure: true, inCutlists: true, inNesting: true },
    { name: "Panel", color: "#C6E8AE", category: "panel", autoClashLeft: "", autoClashRight: "", initialMeasure: true, inCutlists: true, inNesting: true },
    { name: "Extra", color: "#B7A4EB", category: "extra", autoClashLeft: "", autoClashRight: "", initialMeasure: false, inCutlists: true, inNesting: true },
    { name: "Drawer", color: "#B8D8F8", category: "drawer", autoClashLeft: "", autoClashRight: "", initialMeasure: false, inCutlists: true, inNesting: true },
    { name: "Cabinet", color: "#4B5563", category: "cabinetry", autoClashLeft: "", autoClashRight: "", initialMeasure: false, inCutlists: true, inNesting: true },
    { name: "Special Panel", color: "#BF1D1D", category: "", autoClashLeft: "", autoClashRight: "", initialMeasure: false, inCutlists: true, inNesting: false },
  ];
  if (!Array.isArray(raw)) return defaults;
  const out = raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      const name = toStr(row.name);
      const categoryRaw = toStr(row.category ?? row.kind ?? row.type).trim().toLowerCase();
      const category: PartTypeCategory =
        categoryRaw === "cabinetry" || categoryRaw === "drawer" || categoryRaw === "door" || categoryRaw === "panel" || categoryRaw === "extra" || categoryRaw === "custom"
          ? categoryRaw
          : Boolean(row.cabinetry ?? row.isCabinetry ?? false)
            ? "cabinetry"
            : Boolean(row.drawer ?? row.isDrawer ?? false)
              ? "drawer"
              : Boolean(row.door ?? row.isDoor ?? false)
                ? "door"
                : Boolean(row.panel ?? row.isPanel ?? false)
                  ? "panel"
                  : Boolean(row.extra ?? row.isExtra ?? false)
                    ? "extra"
                    : Boolean(row.custom ?? row.isCustom ?? false)
                      ? "custom"
                : "";
      return {
        name,
        color: toStr(row.color, "#7D99B3"),
        category,
        autoClashLeft: toStr(row.autoClashLeft ?? row.clashLeft),
        autoClashRight: toStr(row.autoClashRight ?? row.clashRight),
        initialMeasure: Boolean(row.initialMeasure ?? row.inInitialMeasure ?? false),
        inCutlists: Boolean(row.inCutlists ?? row.includeInCutlists ?? true),
        inNesting: Boolean(row.inNesting ?? row.includeInNesting ?? true),
      };
    })
    .filter((row) => row.name);
  return out.length ? out : defaults;
}

function normalizeEdgebandingSettings(raw: unknown): {
  rules: EdgebandingRuleRow[];
  excessPerEndMm: string;
  roundEnabled: boolean;
  roundDirection: "up" | "down";
  roundNearestMeters: string;
} {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rulesRaw = Array.isArray(obj.addToTotalRules) ? obj.addToTotalRules : [];
  const rules = rulesRaw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        upToMeters: toStr(item.upToMeters),
        addMeters: toStr(item.addMeters),
      };
    })
    .filter((r) => r.upToMeters || r.addMeters);
  return {
    rules,
    excessPerEndMm: toStr(obj.excessPerEndMm),
    roundEnabled: Boolean(obj.roundEnabled ?? false),
    roundDirection: toStr(obj.roundDirection).toLowerCase() === "down" ? "down" : "up",
    roundNearestMeters: toStr(obj.roundNearestMeters),
  };
}

const MACHINE_TYPES: MachineType[] = ["cnc", "table-saw", "edge-bander", "other"];
function isMachineType(value: unknown): value is MachineType {
  return typeof value === "string" && (MACHINE_TYPES as string[]).includes(value);
}
function machineTypeLabel(m: Pick<Machine, "type" | "customTypeLabel">): string {
  if (m.type === "cnc") return "CNC";
  if (m.type === "table-saw") return "Table Saw";
  if (m.type === "edge-bander") return "Edge Bander";
  return toStr(m.customTypeLabel, "Other");
}
function emptyMachineNestingSettings(): MachineNestingSettings {
  return { kerf: "5", margin: "10", minPieceSize: "100" };
}
function emptyMachineEdgebandingSettings(): MachineEdgebandingSettings {
  return { rules: [], excessPerEndMm: "", roundEnabled: false, roundDirection: "up", roundNearestMeters: "" };
}
function normalizeMachineNestingSettings(raw: unknown): MachineNestingSettings {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    kerf: toStr(obj.kerf, "5"),
    margin: toStr(obj.margin, "10"),
    minPieceSize: toStr(obj.minPieceSize, "100"),
  };
}
function normalizeMachineServiceHistory(raw: unknown): MachineServiceLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = row as Record<string, unknown>;
      return { id: toStr(item.id) || genMachineServiceLogId(), date: toStr(item.date), notes: toStr(item.notes) };
    })
    .filter((row) => row.date || row.notes);
}
function normalizeMachine(raw: unknown): Machine | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name = toStr(row.name);
  const type = isMachineType(row.type) ? row.type : "other";
  if (!name && !toStr(row.id)) return null;
  const contactRaw = row.maintenanceContact && typeof row.maintenanceContact === "object" ? (row.maintenanceContact as Record<string, unknown>) : {};
  return {
    id: toStr(row.id) || genMachineId(),
    type,
    customTypeLabel: toStr(row.customTypeLabel),
    name,
    model: toStr(row.model),
    serialNumber: toStr(row.serialNumber),
    notes: toStr(row.notes),
    maintenanceContact: { name: toStr(contactRaw.name), phone: toStr(contactRaw.phone), email: toStr(contactRaw.email) },
    serviceHistory: normalizeMachineServiceHistory(row.serviceHistory),
    isDefaultForType: Boolean(row.isDefaultForType),
    nestingSettings: normalizeMachineNestingSettings(row.nestingSettings),
    edgebandingSettings: normalizeEdgebandingSettings(row.edgebandingSettings) as MachineEdgebandingSettings,
  };
}
// legacyNesting/legacyEdgebanding are this company doc's OWN pre-Machining values (already parsed by
// the load effect for the old, now-hidden global panels) — used ONLY the very first time a company
// opens Machining with no machines saved yet, so production math (which immediately switches to
// reading from the default machine of each type) doesn't go blank the moment this ships. Once any
// machines exist, this seed path never runs again for that company.
function normalizeMachines(raw: unknown, legacyNesting: MachineNestingSettings, legacyEdgebanding: MachineEdgebandingSettings): Machine[] {
  if (Array.isArray(raw) && raw.length > 0) {
    const out = raw.map(normalizeMachine).filter((m): m is Machine => m !== null);
    if (out.length > 0) return out;
  }
  return [
    {
      id: genMachineId(),
      type: "cnc",
      customTypeLabel: "",
      name: "CNC 1",
      model: "",
      serialNumber: "",
      notes: "",
      maintenanceContact: { name: "", phone: "", email: "" },
      serviceHistory: [],
      isDefaultForType: true,
      nestingSettings: legacyNesting,
      edgebandingSettings: emptyMachineEdgebandingSettings(),
    },
    {
      id: genMachineId(),
      type: "edge-bander",
      customTypeLabel: "",
      name: "Edge Bander 1",
      model: "",
      serialNumber: "",
      notes: "",
      maintenanceContact: { name: "", phone: "", email: "" },
      serviceHistory: [],
      isDefaultForType: true,
      nestingSettings: emptyMachineNestingSettings(),
      edgebandingSettings: legacyEdgebanding,
    },
  ];
}

// Mirrors the exact string->number conversion the old global nestingSettings/edgebandingSettings
// save-patch entries already used (see their own call sites) — same fallback values, same "strip
// commas before parsing" treatment for edgebanding's numeric fields.
function serializeMachineForSave(m: Machine) {
  return {
    id: m.id,
    type: m.type,
    customTypeLabel: m.customTypeLabel,
    name: m.name,
    model: m.model,
    serialNumber: m.serialNumber,
    notes: m.notes,
    maintenanceContact: { ...m.maintenanceContact },
    serviceHistory: m.serviceHistory.map((entry) => ({ ...entry })),
    isDefaultForType: m.isDefaultForType,
    nestingSettings: {
      kerf: Number(m.nestingSettings.kerf || 5),
      margin: Number(m.nestingSettings.margin || 10),
      minPieceSize: Number(m.nestingSettings.minPieceSize || 100),
    },
    edgebandingSettings: {
      addToTotalRules: m.edgebandingSettings.rules
        .map((r) => ({
          upToMeters: Number(toStr(r.upToMeters).replace(/,/g, "")),
          addMeters: Number(toStr(r.addMeters).replace(/,/g, "")),
        }))
        .filter((r) => Number.isFinite(r.upToMeters) && Number.isFinite(r.addMeters) && r.upToMeters > 0 && r.addMeters > 0),
      excessPerEndMm: (() => {
        const n = Number(toStr(m.edgebandingSettings.excessPerEndMm).replace(/,/g, ""));
        return Number.isFinite(n) && n > 0 ? n : 0;
      })(),
      roundEnabled: Boolean(m.edgebandingSettings.roundEnabled),
      roundDirection: m.edgebandingSettings.roundDirection === "down" ? "down" : "up",
      roundNearestMeters: (() => {
        const n = Number(toStr(m.edgebandingSettings.roundNearestMeters).replace(/,/g, ""));
        return Number.isFinite(n) && n > 0 ? n : 0;
      })(),
    },
  };
}

function normalizeGapAllowancesSettings(raw: unknown): GapAllowancesSettings {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    baseBelowBenchToTopOfDoorDrawer: toStr(row.baseBelowBenchToTopOfDoorDrawer),
    baseHorizontalGapNormalHandles: toStr(row.baseHorizontalGapNormalHandles),
    baseHorizontalGapWrapOverHandles: toStr(row.baseHorizontalGapWrapOverHandles),
    baseVerticalGapDoorsPanels: toStr(row.baseVerticalGapDoorsPanels),
    tallTopOfDoorToTopWithScribers: toStr(row.tallTopOfDoorToTopWithScribers),
    tallTopOfDoorToTopNoScribers: toStr(row.tallTopOfDoorToTopNoScribers),
    tallVerticalGapDoorsPanels: toStr(row.tallVerticalGapDoorsPanels),
  };
}

function normalizeDiscountTiers(raw: unknown): DiscountTierRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      return { low: toStr(row.low), high: toStr(row.high), discount: toStr(row.discount) };
    })
    .filter((r) => r.low || r.high || r.discount);
}

function normalizeExtraCharges(raw: unknown): ExtraChargeRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      return { id: toStr(row.id) || genExtraChargeId(), name: toStr(row.name), price: toStr(row.price), isDefault: Boolean(row.isDefault) };
    });
}

function normalizeHardware(raw: unknown): HardwareRow[] {
  if (!Array.isArray(raw)) return [];
  const rows = raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      const drawers = Array.isArray(row.drawers) ? row.drawers : [];
      const hinges = Array.isArray(row.hinges) ? row.hinges : [];
      const other = Array.isArray(row.other) ? row.other : [];
      return {
        name: toStr(row.name),
        color: toStr(row.color, "#7D99B3"),
        default: Boolean(row.default),
        drawersJson: JSON.stringify(drawers),
        hingesJson: JSON.stringify(hinges),
        otherJson: JSON.stringify(other),
        cartCopyFormat: toStr(row.cartCopyFormat),
      };
    })
    .filter((r) => r.name);
  return sanitizeHardwareRows(rows);
}

function escapeQuoteRichTextHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeAllowedQuoteInlineStyle(styleText: string): string {
  const allowed: string[] = [];
  for (const rawPart of String(styleText || "").split(";")) {
    const [rawName, ...rawValueParts] = rawPart.split(":");
    const name = String(rawName || "").trim().toLowerCase();
    const value = rawValueParts.join(":").trim();
    if (!name || !value) continue;
    if (
      name === "color" &&
      (/^#[0-9a-fA-F]{3,8}$/.test(value) ||
        /^[a-zA-Z]+$/.test(value) ||
        /^rgba?\([\d\s.,%]+\)$/i.test(value))
    ) {
      allowed.push(`color:${value}`);
      continue;
    }
    if (name === "font-family" && /^[a-zA-Z0-9\s,'"()-]+$/.test(value)) {
      allowed.push(`font-family:${value}`);
      continue;
    }
    if (name === "font-size" && /^\d+(px|pt|em|rem|%)$/.test(value)) {
      allowed.push(`font-size:${value}`);
      continue;
    }
    if (name === "text-align" && /^(left|center|right|justify)$/i.test(value)) {
      allowed.push(`text-align:${value.toLowerCase()}`);
    }
  }
  return allowed.join("; ");
}

function sanitizeQuoteRichTextMarkup(value: string): string {
  if (typeof document === "undefined") {
    return escapeQuoteRichTextHtml(value)
      .replace(/\r\n/g, "\n")
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
      .join("");
  }

  const template = document.createElement("template");
  template.innerHTML = String(value || "");

  const renderNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeQuoteRichTextHtml(node.textContent || "").replace(/\r?\n/g, "<br />");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    const children = Array.from(element.childNodes).map(renderNode).join("");

    if (tag === "br") return "<br />";
    if (tag === "div" || tag === "p") {
      const safeStyle = sanitizeAllowedQuoteInlineStyle(element.getAttribute("style") || "");
      return safeStyle
        ? `<p style="${safeStyle}">${children || "<br />"}</p>`
        : `<p>${children || "<br />"}</p>`;
    }
    if (tag === "strong" || tag === "b") return `<strong>${children}</strong>`;
    if (tag === "em" || tag === "i") return `<em>${children}</em>`;
    if (tag === "u") return `<u>${children}</u>`;
    if (tag === "s" || tag === "strike" || tag === "del") return `<s>${children}</s>`;
    if (tag === "span" || tag === "font") {
      const rawStyle =
        tag === "font"
          ? [
              element.getAttribute("color") ? `color:${element.getAttribute("color")}` : "",
              element.getAttribute("face") ? `font-family:${element.getAttribute("face")}` : "",
            ]
              .filter(Boolean)
              .join("; ")
          : (element.getAttribute("style") || "");
      const safeStyle = sanitizeAllowedQuoteInlineStyle(rawStyle);
      return safeStyle ? `<span style="${safeStyle}">${children}</span>` : children;
    }
    return children;
  };

  return Array.from(template.content.childNodes)
    .map(renderNode)
    .join("")
    .replace(/(?:<p><br \/><\/p>){3,}/gi, "<p><br /></p><p><br /></p>");
}

function renderQuoteRichTextHtml(value: string): string {
  return sanitizeQuoteRichTextMarkup(value);
}

function applyQuoteRichTextCommand(
  editor: HTMLDivElement | null,
  command: "bold" | "italic" | "underline" | "strikeThrough",
  onChange: (nextValue: string) => void,
) {
  if (!editor || typeof document === "undefined") return;
  editor.focus();
  document.execCommand(command);
  onChange(sanitizeQuoteRichTextMarkup(editor.innerHTML));
}

function normalizeQuoteHelpers(raw: unknown): QuoteHelperRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => {
      const row = item as Record<string, unknown>;
      const content = sanitizeQuoteRichTextMarkup(String(row.content ?? ""));
      return {
        id: toStr(row.id, `quote_helper_${idx + 1}`),
        content,
      };
    })
    .filter((row) => row.content);
}

function parseJsonList(value: string): unknown[] {
  try {
    const parsed = JSON.parse(String(value || "").trim() || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObjects(value: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(String(value || "").trim() || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({ ...(item as Record<string, unknown>) }));
  } catch {
    return [];
  }
}

// Hardware item names are kept exactly as typed while editing (so spaces can be typed), and tidied
// when saved.
function trimHardwareItemNames(items: unknown[]): unknown[] {
  return items.map((item) => {
    if (!item || typeof item !== "object") return item;
    const row = { ...(item as Record<string, unknown>) };
    if (typeof row.name === "string") row.name = row.name.trim();
    // (Its item number, too — none: left off.)
    if (typeof row.itemNumber === "string") {
      const itemNumber = row.itemNumber.trim();
      if (itemNumber) row.itemNumber = itemNumber;
      else delete row.itemNumber;
    }
    return row;
  });
}

function stringifyJsonObjects(items: Array<Record<string, unknown>>): string {
  return JSON.stringify(items);
}

function sanitizeDrawerDefaults(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (!items.length) return items;
  let firstDefault = -1;
  const normalized = items.map((item, idx) => {
    const isDefault = Boolean(item.default);
    if (isDefault && firstDefault < 0) firstDefault = idx;
    return { ...item, default: false };
  });
  if (firstDefault >= 0) {
    normalized[firstDefault] = { ...normalized[firstDefault], default: true };
  }
  return normalized;
}

function sanitizeHardwareRows(rows: HardwareRow[]): HardwareRow[] {
  if (!rows.length) return rows;
  let firstDefaultHardware = -1;
  const out = rows.map((row, idx) => {
    const drawers = sanitizeDrawerDefaults(parseJsonObjects(row.drawersJson));
    const normalizedRow: HardwareRow = {
      ...row,
      default: false,
      drawersJson: stringifyJsonObjects(drawers),
    };
    if (row.default && firstDefaultHardware < 0) firstDefaultHardware = idx;
    return normalizedRow;
  });
  if (firstDefaultHardware >= 0) {
    out[firstDefaultHardware] = { ...out[firstDefaultHardware], default: true };
  }
  return out;
}

function readDrawerName(item: Record<string, unknown>): string {
  return toStr(item.name);
}

function readDrawerBottomWidth(item: Record<string, unknown>): string {
  const bottoms = item.bottoms && typeof item.bottoms === "object" ? (item.bottoms as Record<string, unknown>) : {};
  return toStr(bottoms.widthMinus ?? item.widthMinus);
}

function readDrawerBottomDepth(item: Record<string, unknown>): string {
  const bottoms = item.bottoms && typeof item.bottoms === "object" ? (item.bottoms as Record<string, unknown>) : {};
  return toStr(bottoms.depthMinus ?? item.depthMinus);
}

function readDrawerBackWidth(item: Record<string, unknown>): string {
  const backs = item.backs && typeof item.backs === "object" ? (item.backs as Record<string, unknown>) : {};
  return toStr(backs.widthMinus);
}

function readDrawerBackHeights(item: Record<string, unknown>): string[] {
  const backs = item.backs && typeof item.backs === "object" ? (item.backs as Record<string, unknown>) : {};
  const rows = Array.isArray(backs.heights) ? backs.heights : [];
  return rows.map((v) => toStr(v)).filter(Boolean);
}

function readDrawerHeightLabel(value: string): string {
  const raw = toStr(value);
  if (!raw) return "";
  const [first] = raw.split(/\s+/, 1);
  return first || raw;
}

function readDrawerHeightNumber(value: string): string {
  const raw = toStr(value);
  if (!raw) return "";
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(1).join(" ");
}

function readDrawerSpaceRequirement(item: Record<string, unknown>): string {
  return toStr(item.spaceRequirement ?? item.clearance);
}

function readDrawerLengths(item: Record<string, unknown>): string[] {
  const rows = Array.isArray(item.hardwareLengths) ? item.hardwareLengths : [];
  return rows.map((v) => toStr(v)).filter(Boolean);
}

// A drawer type's runner weights, in kg (Blum's 30 and 65).
function readDrawerWeights(item: Record<string, unknown>): string[] {
  const rows = Array.isArray(item.hardwareWeights) ? item.hardwareWeights : [];
  return rows.map((v) => toStr(v)).filter(Boolean);
}

// A height's own details: the runner lengths it doesn't come in, the weights each of its lengths doesn't come in
// ("500|65" — a length and weight together), and its supplier's ID numbers — one for each weight a length comes in
// ("500|65"), or for the length ("500") on a drawer type with no weights. Kept beside its heights (backs.heights stays as
// it was, "M 90"), by the height's letter in lower case:
// { m: { lengthsOff: ["300"], combosOff: ["350|65"], itemNumbers: { "500|30": "770M5002S", "500|65": "770M5002T" } } }.
// Nothing set: no entry — so a length or weight added later is on for every height.
type DrawerHeightDetails = { lengthsOff: string[]; combosOff: string[]; itemNumbers: Record<string, string> };
type DrawerHeightDraft = DrawerHeightDetails & { label: string; size: string };

const drawerComboKey = (length: string, weight: string) => `${length.trim()}|${weight.trim()}`;

function readDrawerHeightDetailsMap(item: Record<string, unknown>): Record<string, unknown> {
  return item.heightDetails && typeof item.heightDetails === "object" ? { ...(item.heightDetails as Record<string, unknown>) } : {};
}

function readDrawerHeightDetails(item: Record<string, unknown>, label: string): DrawerHeightDetails {
  const entry = readDrawerHeightDetailsMap(item)[label.trim().toLowerCase()];
  const list = (value: unknown) => (Array.isArray(value) ? value.map((v) => toStr(v)).filter(Boolean) : []);
  if (!entry || typeof entry !== "object") return { lengthsOff: [], combosOff: [], itemNumbers: {} };
  const row = entry as Record<string, unknown>;
  const itemNumbers: Record<string, string> = {};
  if (row.itemNumbers && typeof row.itemNumbers === "object") {
    for (const [key, value] of Object.entries(row.itemNumbers as Record<string, unknown>)) {
      if (toStr(value)) itemNumbers[key] = toStr(value);
    }
  }
  return { lengthsOff: list(row.lengthsOff), combosOff: list(row.combosOff), itemNumbers };
}

// What a height comes in, in words — its chip's tooltip: "350 (30kg), 400 (30kg 770M4002S), 500 (30kg, 65kg)".
// `restricted`: not every length and weight.
function describeDrawerHeight(item: Record<string, unknown>, label: string): { text: string; restricted: boolean } {
  const details = readDrawerHeightDetails(item, label);
  const lengths = readDrawerLengths(item);
  const weights = readDrawerWeights(item);
  const parts = lengths
    .filter((length) => !details.lengthsOff.includes(length))
    .map((length) => {
      const on = weights.filter((weight) => !details.combosOff.includes(drawerComboKey(length, weight)));
      const withId = (text: string, key: string) => (details.itemNumbers[key] ? `${text} ${details.itemNumbers[key]}` : text);
      const notes = weights.length
        ? on.length
          ? on.map((weight) => withId(`${weight}kg`, drawerComboKey(length, weight))).join(", ")
          : "no weight"
        : withId("", length).trim();
      return notes ? `${length} (${notes})` : length;
    });
  const restricted = details.lengthsOff.some((v) => lengths.includes(v)) || details.combosOff.length > 0;
  return { text: lengths.length ? `lengths ${parts.join(", ") || "none"}` : "", restricted };
}

function writeDrawerHeightDetailsMap(item: Record<string, unknown>, map: Record<string, unknown>): Record<string, unknown> {
  const next = { ...item };
  if (Object.keys(map).length) next.heightDetails = map;
  else delete next.heightDetails;
  return next;
}

// A height written back: its "M 90" in backs.heights (at `index`, or added on the end — null), and its details, moved
// along with it if its letter changed.
function writeDrawerHeight(item: Record<string, unknown>, index: number | null, height: DrawerHeightDraft): Record<string, unknown> {
  const label = height.label.trim();
  const size = height.size.trim();
  const heights = readDrawerBackHeights(item);
  const previousLabel = index != null ? readDrawerHeightLabel(heights[index] ?? "") : "";
  const text = size ? `${label} ${size}` : label;
  const nextHeights = index != null && index < heights.length ? heights.map((v, i) => (i === index ? text : v)) : [...heights, text];
  const map = readDrawerHeightDetailsMap(item);
  if (previousLabel) delete map[previousLabel.toLowerCase()];
  const own: Record<string, unknown> = {};
  if (height.lengthsOff.length) own.lengthsOff = height.lengthsOff;
  if (height.combosOff.length) own.combosOff = height.combosOff;
  const itemNumbers = Object.fromEntries(
    Object.entries(height.itemNumbers)
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([, value]) => value),
  );
  if (Object.keys(itemNumbers).length) own.itemNumbers = itemNumbers;
  if (Object.keys(own).length) map[label.toLowerCase()] = own;
  return writeDrawerHeightDetailsMap(writeDrawerField(item, "backHeights", nextHeights), map);
}

// A drawer type's default weight ("" — none chosen): its drawers' weight, at every height and length that comes in it.
function readDrawerDefaultWeight(item: Record<string, unknown>): string {
  return toStr(item.defaultWeight);
}

function writeDrawerDefaultWeight(item: Record<string, unknown>, weight: string): Record<string, unknown> {
  const next = { ...item };
  if (weight.trim()) next.defaultWeight = weight.trim();
  else delete next.defaultWeight;
  return next;
}

// A weight changed (or removed — null) that was the default: the default follows it (or goes).
function renameDrawerDefaultWeight(item: Record<string, unknown>, kind: "length" | "weight", from: string, to: string | null): Record<string, unknown> {
  if (kind !== "weight" || readDrawerDefaultWeight(item) !== from.trim()) return item;
  return writeDrawerDefaultWeight(item, (to ?? "").trim());
}

// Undoing a length, weight or height taken off: the drawer's lengths, weights (and its default), heights and their
// details back as they were (`before`) — the rest of it (its name, cutting, depth requirement) as it is now.
function restoreDrawerOptions(item: Record<string, unknown>, before: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = writeDrawerDefaultWeight(
    { ...item, hardwareLengths: readDrawerLengths(before), hardwareWeights: readDrawerWeights(before) },
    readDrawerDefaultWeight(before),
  );
  const backs = item.backs && typeof item.backs === "object" ? { ...(item.backs as Record<string, unknown>) } : {};
  backs.heights = readDrawerBackHeights(before);
  next.backs = backs;
  return writeDrawerHeightDetailsMap(next, readDrawerHeightDetailsMap(before));
}

function removeDrawerHeight(item: Record<string, unknown>, index: number): Record<string, unknown> {
  const heights = readDrawerBackHeights(item);
  const map = readDrawerHeightDetailsMap(item);
  delete map[readDrawerHeightLabel(heights[index] ?? "").toLowerCase()];
  return writeDrawerHeightDetailsMap(
    writeDrawerField(
      item,
      "backHeights",
      heights.filter((_, i) => i !== index),
    ),
    map,
  );
}

// A length or weight changed (or removed — null): what each height had switched off for it follows it.
function renameDrawerHeightOption(item: Record<string, unknown>, kind: "length" | "weight", from: string, to: string | null): Record<string, unknown> {
  const map = readDrawerHeightDetailsMap(item);
  const was = from.trim();
  const now = (to ?? "").trim();
  for (const [label, entry] of Object.entries(map)) {
    if (!entry || typeof entry !== "object") continue;
    const row = { ...(entry as Record<string, unknown>) };
    const list = (key: string) => (Array.isArray(row[key]) ? (row[key] as unknown[]).map((v) => toStr(v)).filter(Boolean) : []);
    const put = (key: string, values: string[]) => {
      if (values.length) row[key] = values;
      else delete row[key];
    };
    if (kind === "length") {
      const lengthsOff = list("lengthsOff");
      put("lengthsOff", now ? lengthsOff.map((v) => (v === was ? now : v)) : lengthsOff.filter((v) => v !== was));
    }
    // (Its ID numbers, too — "500", "500|65".)
    if (row.itemNumbers && typeof row.itemNumbers === "object") {
      const itemNumbers: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row.itemNumbers as Record<string, unknown>)) {
        const [length = "", weight] = key.split("|");
        const hit = kind === "length" ? length === was : weight === was;
        if (!hit) itemNumbers[key] = value;
        else if (now) itemNumbers[kind === "length" ? (weight == null ? now : drawerComboKey(now, weight)) : drawerComboKey(length, now)] = value;
      }
      if (Object.keys(itemNumbers).length) row.itemNumbers = itemNumbers;
      else delete row.itemNumbers;
    }
    const combos = list("combosOff").flatMap((combo) => {
      const [length = "", weight = ""] = combo.split("|");
      const hit = kind === "length" ? length === was : weight === was;
      if (!hit) return [combo];
      if (!now) return [];
      return [kind === "length" ? drawerComboKey(now, weight) : drawerComboKey(length, now)];
    });
    put("combosOff", combos);
    if (Object.keys(row).length) map[label] = row;
    else delete map[label];
  }
  return writeDrawerHeightDetailsMap(item, map);
}

// A drawer type's height, in a small pop-up under its chip: its name and back height, then the drawer type's runner
// lengths down the side and its weights across the top — a length switched off: the height doesn't come in it; a weight
// under a length switched off: that length doesn't come in that weight for this height (Blum's M: 350–450 in 30 kg only,
// 500 and 550 in 30 or 65) — each weight's tick with its supplier's ID number beside it (no weights: each length's). An
// existing height is saved as it's changed (whenever it has a name of its own); a new one — the same pop-up, empty — when
// Add height is pressed.
function DrawerHeightEditor({
  drawer,
  heightIndex,
  color,
  left,
  onCommit,
  onRemove,
  onClose,
}: {
  drawer: Record<string, unknown>;
  // Which of its heights (readDrawerBackHeights); null — a new one.
  heightIndex: number | null;
  color: string;
  // How far along the Heights row it opens (under the chip pressed).
  left: number;
  onCommit: (height: DrawerHeightDraft) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const heights = readDrawerBackHeights(drawer);
  const existing = heightIndex != null ? (heights[heightIndex] ?? null) : null;
  const lengths = readDrawerLengths(drawer);
  const weights = readDrawerWeights(drawer);
  const [draft, setDraft] = useState<DrawerHeightDraft>(() =>
    existing != null
      ? { label: readDrawerHeightLabel(existing), size: readDrawerHeightNumber(existing), ...readDrawerHeightDetails(drawer, readDrawerHeightLabel(existing)) }
      : { label: "", size: "", lengthsOff: [], combosOff: [], itemNumbers: {} },
  );
  const isTaken = (label: string) =>
    Boolean(label.trim()) && heights.some((height, i) => i !== heightIndex && readDrawerHeightLabel(height).toLowerCase() === label.trim().toLowerCase());
  const taken = isTaken(draft.label);
  const valid = Boolean(draft.label.trim()) && !taken;
  const change = (patch: Partial<DrawerHeightDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (existing != null && next.label.trim() && !isTaken(next.label)) onCommit(next);
  };
  const toggleIn = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const onColor = textColorForHex(color);
  // Under its row — or over it, when under would run off the bottom of the screen and there's more room above. (Placed
  // straight onto it before it's painted, measured under first.)
  const panelRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const row = panel?.parentElement;
    if (!panel || !row) return;
    Object.assign(panel.style, { top: "100%", bottom: "auto", marginTop: "6px", marginBottom: "0px", transformOrigin: "50% 0%" });
    const rowRect = row.getBoundingClientRect();
    const roomBelow = window.innerHeight - rowRect.bottom;
    if (roomBelow < panel.offsetHeight + 16 && rowRect.top > roomBelow) {
      Object.assign(panel.style, { top: "auto", bottom: "100%", marginTop: "0px", marginBottom: "6px", transformOrigin: "50% 100%" });
    }
  }, [lengths.length, weights.length]);
  // A length it comes in (on: the brand's colour, ticked) — or doesn't (off: struck through).
  const lengthChip = (length: string) => {
    const on = !draft.lengthsOff.includes(length);
    return (
      <button
        key={`length_${length}`}
        type="button"
        onClick={() => change({ lengthsOff: toggleIn(draft.lengthsOff, length) })}
        aria-pressed={on}
        className={`glass-shine inline-flex h-7 items-center justify-center gap-1 rounded-full border px-2.5 text-[12px] font-medium transition hover:brightness-95 ${on ? "" : "glass-shine-neutral line-through"}`}
        style={on ? glassShineStyle(color, { color: onColor }) : { color: "var(--text-muted)" }}
        title={on ? `Comes in ${length}mm — click to switch it off` : `Doesn't come in ${length}mm — click to switch it on`}
      >
        {on ? <Check size={12} strokeWidth={2.6} /> : null}
        {length}mm
      </button>
    );
  };
  // Whether a length it comes in comes in a weight: a round tick (none for a length it doesn't come in).
  const weightCell = (length: string, weight: string) => {
    const lengthOn = !draft.lengthsOff.includes(length);
    const key = drawerComboKey(length, weight);
    const on = lengthOn && !draft.combosOff.includes(key);
    return (
      <span key={key} className="flex justify-center">
        <button
          type="button"
          disabled={!lengthOn}
          onClick={() => change({ combosOff: toggleIn(draft.combosOff, key) })}
          aria-pressed={on}
          aria-label={`${length}mm in ${weight}kg`}
          className={`glass-shine inline-flex h-7 w-7 items-center justify-center rounded-full border transition hover:brightness-95 disabled:cursor-default disabled:opacity-35 ${on ? "" : "glass-shine-neutral"}`}
          style={on ? glassShineStyle(color, { color: onColor }) : { color: "var(--text-muted)" }}
          title={
            !lengthOn
              ? `Switch ${length}mm on first`
              : on
                ? `${length}mm comes in ${weight}kg — click to switch it off`
                : `${length}mm doesn't come in ${weight}kg — click to switch it on`
          }
        >
          {on ? <Check size={13} strokeWidth={2.6} /> : null}
        </button>
      </span>
    );
  };
  // An ID number for this height (copied from a project's order, to find it in the supplier's cart): a length's, at a
  // weight — or the length's own, with no weights. None for what it doesn't come in (its space kept, so the rows line up).
  const idField = (length: string, weight?: string) => {
    const key = weight != null ? drawerComboKey(length, weight) : length;
    const off = draft.lengthsOff.includes(length) || (weight != null && draft.combosOff.includes(key));
    if (off) return <span key={`id_${key}`} aria-hidden />;
    return (
      <input
        key={`id_${key}`}
        value={draft.itemNumbers[key] ?? ""}
        onChange={(e) => change({ itemNumbers: { ...draft.itemNumbers, [key]: e.target.value } })}
        placeholder="ID number"
        aria-label={weight != null ? `${length}mm ${weight}kg ID number` : `${length}mm ID number`}
        className={glassFieldSmClass}
      />
    );
  };
  const submit = () => {
    if (existing == null) {
      if (!valid) return;
      onCommit(draft);
    }
    onClose();
  };
  return (
    <div
      ref={panelRef}
      data-drawer-height-editor="true"
      role="dialog"
      aria-label={existing == null ? "New height" : `Height ${draft.label}`}
      className="glass-menu-squeeze absolute z-40 w-[480px] max-w-[calc(100vw-48px)] space-y-3 rounded-[14px] border p-3 shadow-[0_12px_30px_rgba(15,23,42,0.14)]"
      style={{
        left,
        borderColor: "var(--glass-border)",
        backgroundColor: "var(--glass-modal-bg)",
        backdropFilter: "blur(16px) saturate(200%)",
        WebkitBackdropFilter: "blur(16px) saturate(200%)",
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      }}
    >
      <p className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
        {existing == null ? "New height" : `Height ${draft.label || readDrawerHeightLabel(existing)}`}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 space-y-1">
          <span className="block text-[11.5px] font-medium text-[var(--text-main)]">Name</span>
          <input
            autoFocus
            value={draft.label}
            onChange={(e) => change({ label: e.target.value.replace(/\s+/g, "") })}
            placeholder="e.g. M"
            className={glassFieldSmClass}
          />
        </label>
        <label className="min-w-0 space-y-1">
          <span className="block text-[11.5px] font-medium text-[var(--text-main)]">Back height</span>
          <span className="relative block">
            <input
              inputMode="decimal"
              value={draft.size}
              onChange={(e) => change({ size: e.target.value.replace(/\s+/g, "") })}
              placeholder="e.g. 90"
              className={glassFieldSmClass}
              style={{ paddingRight: 32 }}
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-muted)]">mm</span>
          </span>
        </label>
      </div>
      {taken ? (
        <p className="text-[11.5px] font-medium" style={{ color: "var(--danger)" }}>
          This drawer already has a {draft.label.trim()} height.
        </p>
      ) : null}
      <div className="space-y-1.5">
        <p className="text-[11.5px] font-medium text-[var(--text-main)]">{weights.length ? "Lengths and weights it comes in" : "Lengths it comes in"}</p>
        {!lengths.length ? (
          <span className="text-[11.5px] text-[var(--text-muted)]">Add the drawer&apos;s hardware lengths first.</span>
        ) : (
          <div
            className="grid items-center gap-x-2 gap-y-1.5"
            style={{
              gridTemplateColumns: weights.length ? `auto ${weights.map(() => "28px minmax(0, 1fr)").join(" ")}` : "auto minmax(0, 1fr)",
            }}
          >
            <span />
            {weights.length ? (
              weights.map((weight) => (
                <span key={`weight_${weight}`} className="col-span-2 pl-1 text-[11.5px] font-medium text-[var(--text-main)]">
                  {weight}kg
                </span>
              ))
            ) : (
              <span className="text-[11.5px] font-medium text-[var(--text-main)]">ID number</span>
            )}
            {lengths.map((length) => (
              <Fragment key={`row_${length}`}>
                {lengthChip(length)}
                {weights.length
                  ? weights.map((weight) => (
                      <Fragment key={`cell_${length}_${weight}`}>
                        {weightCell(length, weight)}
                        {idField(length, weight)}
                      </Fragment>
                    ))
                  : idField(length)}
              </Fragment>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 pt-0.5">
        {existing != null ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]"
            style={{ color: "var(--danger)" }}
          >
            <Trash2 size={13} /> Remove height
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="glass-shine glass-shine-neutral inline-flex h-8 items-center rounded-full border px-4 text-[12px] font-medium"
            style={{ color: "var(--text-main)" }}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          disabled={existing == null && !valid}
          onClick={submit}
          className="glass-shine inline-flex h-8 items-center rounded-full border px-4 text-[12px] font-medium text-white transition hover:brightness-105 disabled:opacity-55"
          style={glassShineStyle("var(--brand)")}
        >
          {existing == null ? "Add height" : "Done"}
        </button>
      </div>
    </div>
  );
}

function writeDrawerField(item: Record<string, unknown>, field: string, value: string | boolean | string[]): Record<string, unknown> {
  const next = { ...item };
  if (field === "name") {
    next.name = String(value ?? "");
    return next;
  }
  if (field === "default") {
    next.default = Boolean(value);
    return next;
  }
  if (field === "bottomWidth" || field === "bottomDepth") {
    const bottoms = next.bottoms && typeof next.bottoms === "object" ? { ...(next.bottoms as Record<string, unknown>) } : {};
    if (field === "bottomWidth") bottoms.widthMinus = String(value ?? "");
    if (field === "bottomDepth") bottoms.depthMinus = String(value ?? "");
    next.bottoms = bottoms;
    return next;
  }
  if (field === "backWidth") {
    const backs = next.backs && typeof next.backs === "object" ? { ...(next.backs as Record<string, unknown>) } : {};
    backs.widthMinus = String(value ?? "");
    next.backs = backs;
    return next;
  }
  if (field === "backHeights") {
    const backs = next.backs && typeof next.backs === "object" ? { ...(next.backs as Record<string, unknown>) } : {};
    const rows = Array.isArray(value)
      ? (value as unknown[]).map((v) => toStr(v)).filter(Boolean)
      : String(value ?? "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
    backs.heights = rows;
    next.backs = backs;
    return next;
  }
  if (field === "spaceRequirement") {
    next.spaceRequirement = String(value ?? "");
    return next;
  }
  if (field === "hardwareLengths" || field === "hardwareWeights") {
    const rows = Array.isArray(value)
      ? (value as unknown[]).map((v) => toStr(v)).filter(Boolean)
      : String(value ?? "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
    next[field] = rows;
    return next;
  }
  return next;
}

export default function CompanySettingsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { setReduceMainTopPadding, setSaveAndBackHandler } = useAppTabs();
  // This page's own sticky header used a negative top margin on its ancestor to cancel <main>'s
  // default top padding, which reproducibly froze the header at its unshifted (i.e. under the
  // fixed global top bar) position on load instead of the intended flush-below-it start — the
  // exact bug already diagnosed and fixed for project details (see that page's own comments).
  // Opting out of <main>'s own top padding here directly, the same way, fixes it without a
  // negative margin.
  useEffect(() => {
    setReduceMainTopPadding(true);
    return () => setReduceMainTopPadding(false);
  }, [setReduceMainTopPadding]);
  const searchParams = useSearchParams();
  // Opens on the URL's ?section= (a link to a given section, or a refresh — see below), else Company. Only read on
  // first load — the sidebar's own onClick is the source of truth for `active` after that.
  const [active, setActive] = useState<SettingsSection>(() => {
    const requestedSection = searchParams.get("section");
    return requestedSection && sections.some((item) => item.key === requestedSection) ? (requestedSection as SettingsSection) : "company";
  });
  // The open section is kept in the URL, so refreshing the page opens it again rather than going back to Company.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (active === "company") url.searchParams.delete("section");
    else url.searchParams.set("section", active);
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  }, [active]);
  // A link to a section, and to a card in it (?card= — e.g. from the app's global search, components/global-search.tsx):
  // that section, then the card scrolled into view and flashed, as the rail's own search does. Also when it's followed
  // with this page already open. The card is taken off the address once it's been shown.
  const linkedSection = searchParams.get("section") || "";
  const linkedCard = searchParams.get("card") || "";
  useEffect(() => {
    if (!linkedSection || !sections.some((item) => item.key === linkedSection)) return;
    setActive(linkedSection as SettingsSection);
    if (!linkedCard) return;
    const timer = window.setTimeout(() => {
      const card = Array.from(document.querySelectorAll<HTMLElement>("[data-settings-card]")).find(
        (el) => el.dataset.settingsCard?.toLowerCase() === linkedCard.toLowerCase(),
      );
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.animate(
          [{ boxShadow: "0 0 0 3px var(--brand), var(--shadow-glass)" }, { boxShadow: "0 0 0 0 transparent, var(--shadow-glass)" }],
          { duration: 1600, easing: "ease-out" },
        );
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("card");
      window.history.replaceState(null, "", url);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [linkedSection, linkedCard]);
  const [search, setSearch] = useState("");
  // The search results list under the rail's search box — hidden by a press anywhere else (the
  // query stays, and focusing the box shows the results again).
  const [searchMenuOpen, setSearchMenuOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!searchMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (searchBoxRef.current?.contains(event.target as Node)) return;
      // Only closes the results — the press must not also act on whatever is under it.
      swallowNextClick();
      setSearchMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [searchMenuOpen]);
  const [company, setCompany] = useState<Record<string, unknown> | null>(null);
  const [activeCompanyId, setActiveCompanyId] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!activeCompanyId) return;
    window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, activeCompanyId);
  }, [activeCompanyId]);
  const [staff, setStaff] = useState<CompanyMemberOption[]>([]);
  const [staffIconColorByUid, setStaffIconColorByUid] = useState<Record<string, string>>({});
  const [savingStaffNameUid, setSavingStaffNameUid] = useState("");
  const staffNameEditStartRef = useRef<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [saveLabel, setSaveLabel] = useState("Saved");
  const [isHydrated, setIsHydrated] = useState(false);
  const blurAutoSaveTimerRef = useRef<number | null>(null);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);
  // Temporary — lets a template be moved from one company to another by hand (download the JSON
  // from company A's builder, upload it into company B's). Remove once there's a real cross-
  // company template transfer flow.
  const specsTemplateFileInputRef = useRef<HTMLInputElement | null>(null);
  const quoteTemplateFileInputRef = useRef<HTMLInputElement | null>(null);
  const hasPendingBlurSaveRef = useRef(false);
  // A row (a category, an item, a status…) is being dragged: the list reorders live as it moves, but nothing is
  // saved until it's dropped (endRowDrag) — not each in-between order.
  const isRowDraggingRef = useRef(false);
  const saveQueuedWhileBusyRef = useRef(false);
  const skipFirstDirtyEffectRef = useRef(true);
  const skipFirstZapierPersistEffectRef = useRef(true);
  const lastZapierPersistSignatureRef = useRef("");
  const skipFirstContactCategoriesPersistEffectRef = useRef(true);
  const lastContactCategoriesPersistSignatureRef = useRef("");
  const contactCategoriesPersistTimerRef = useRef<number | null>(null);
  const isSavingLatestRef = useRef(false);
  const [statuses, setStatuses] = useState<StatusRow[]>([]);
  // Whether a status is already ticked as the completed one (Project statuses hides the others' button).
  const hasCompletedStatus = statuses.some((row) => Boolean(row.isComplete));
  // ...and as the won one (Reports).
  const hasWonStatus = statuses.some((row) => Boolean(row.isWon));
  const [leadStatuses, setLeadStatuses] = useState<StatusRow[]>([]);
  // Small Jobs' statuses (lib/small-jobs.ts — Open and Closed to start with).
  const [smallJobStatuses, setSmallJobStatuses] = useState<StatusRow[]>([]);
  const [smallJobStatusDragIndex, setSmallJobStatusDragIndex] = useState<number | null>(null);
  // The company's lead forms (Company Settings → Leads — components/lead-forms-settings.tsx; lib/lead-forms.ts).
  const [leadForms, setLeadForms] = useState<LeadForm[]>([]);
  // Dashboard > Completion bonus (lib/completion-bonus.ts — seen only with dashboard.complete.bonus): the bonus period's
  // length and the month it starts in, how many months after it it's paid, and the least a job's quote can be to qualify
  // (as typed; "" for no minimum).
  const [bonusPeriodMonths, setBonusPeriodMonths] = useState(3);
  const [bonusStartMonth, setBonusStartMonth] = useState(0);
  const [bonusPaidMonthsAfter, setBonusPaidMonthsAfter] = useState(1);
  const [bonusMinimumQuote, setBonusMinimumQuote] = useState("");
  const [statusDragIndex, setStatusDragIndex] = useState<number | null>(null);
  const [statusDragOverIndex, setStatusDragOverIndex] = useState<number | null>(null);
  const [leadStatusDragIndex, setLeadStatusDragIndex] = useState<number | null>(null);
  const [leadStatusDragOverIndex, setLeadStatusDragOverIndex] = useState<number | null>(null);
  const [projectTagUsage, setProjectTagUsage] = useState<TagUsageRow[]>([]);
  // Dashboard > Tags: the tag waiting on "Delete tag?" (its row, name and how many projects use it).
  const [pendingTagDelete, setPendingTagDelete] = useState<{ index: number; value: string; count: number } | null>(null);
  // Tags deleted but still on the Undo bar (lower-case names): hidden from the list, though not yet taken off anything
  // (see commitTagDelete).
  const [hiddenTagKeys, setHiddenTagKeys] = useState<string[]>([]);
  const [tagDeleteOrigin, setTagDeleteOrigin] = useState<GlassModalOrigin>(null);
  const tagDeletePanelRef = useRef<HTMLDivElement | null>(null);
  const tagDeleteOriginElRef = useRef<HTMLElement | null>(null);
  const [boardColourMemory, setBoardColourMemory] = useState<BoardColourMemoryRow[]>([]);
  const [expandedBoardColourMemoryRows, setExpandedBoardColourMemoryRows] = useState<Set<string>>(new Set());
  const [boardThicknesses, setBoardThicknesses] = useState<string[]>(["16", "18"]);
  const [boardFinishes, setBoardFinishes] = useState<string[]>(["Satin"]);
  // Drag-to-reorder for the Sheet thicknesses / Board finishes chips.
  const [thicknessDragIndex, setThicknessDragIndex] = useState<number | null>(null);
  const [finishDragIndex, setFinishDragIndex] = useState<number | null>(null);
  const [sheetSizes, setSheetSizes] = useState<SheetSizeRow[]>([{ h: "2440", w: "1220", isDefault: true }]);
  const [partTypes, setPartTypes] = useState<PartTypeRow[]>([]);
  const [contactCategories, setContactCategories] = useState<ContactCategoryRow[]>([]);
  const [contactCategoryDragIndex, setContactCategoryDragIndex] = useState<number | null>(null);
  const [calendarCategories, setCalendarCategories] = useState<CalendarCategory[]>([]);
  const [calendarCategoryDragIndex, setCalendarCategoryDragIndex] = useState<number | null>(null);
  // Company Settings > Calendar > a category's "who can see / edit it" pop-up.
  const [calendarAccessIndex, setCalendarAccessIndex] = useState<number | null>(null);
  const [calendarAccessOrigin, setCalendarAccessOrigin] = useState<GlassModalOrigin>(null);
  const calendarAccessPanelRef = useRef<HTMLDivElement | null>(null);
  const calendarAccessOriginElRef = useRef<HTMLElement | null>(null);
  const [calendarWorkdays, setCalendarWorkdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [calendarRetention, setCalendarRetention] = useState<CalendarRetention>("never");
  // Dashboard > Finished projects: how long a project sits in a Completed status before it's archived
  // and its client portal link stops working — or "instant", as soon as it's completed (company doc
  // projectArchiveAfter).
  const [projectArchiveAfter, setProjectArchiveAfter] = useState<ProjectArchiveDelay>("never");
  // Whether "Show on client portal" starts on when a project is linked to an event.
  const [calendarShowToClientDefault, setCalendarShowToClientDefault] = useState(false);
  // Calendar > Workdays > "Show non-workdays". Off = the calendar's Month and Week views leave the
  // non-workdays out (the Year view always shows every day). Saved as calendarShowNonWorkdays; on by default.
  const [calendarShowNonWorkdays, setCalendarShowNonWorkdays] = useState(true);
  // Calendar > Public holidays: New Zealand's, with this region's anniversary day (or none at all — lib/nz-public-holidays).
  // Saved as calendarHolidayRegion; the national ones only by default.
  const [calendarHolidayRegion, setCalendarHolidayRegion] = useState<NzHolidayRegion>("nz");
  const [contractors, setContractors] = useState<string[]>([]);
  // Room names (roomNames): one list, shown in both Sales and Production — offered when adding a room to a project, and
  // in the offline cutlist template.
  const [roomNames, setRoomNames] = useState<string[]>([]);
  // The room row being dragged (its order is the dropdown's).
  const [roomNameDragIndex, setRoomNameDragIndex] = useState<number | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  // Staff & Permissions › Audit log (lib/role-audit.ts): its entries, newest first; and the roles as last saved — what a
  // save's changes are found against.
  const [roleAuditLog, setRoleAuditLog] = useState<RoleAuditEntry[]>([]);
  const [roleAuditShown, setRoleAuditShown] = useState(15);
  const savedRolesRef = useRef<RoleRow[] | null>(null);
  // Fed to both the Specs and Quote grid builders' group-editor modal ("Allow Editable By") — the
  // actual enforcement of it only happens in a project's own live window (see that page's own
  // canEditSpecsGroup), not here, so this is purely so a company's own role names are pickable when
  // setting a group's restriction while authoring a template.
  const specsGroupRoleOptions = useMemo(() => roles.map((r) => ({ id: r.id, name: r.name })), [roles]);
  const [roleDragIndex, setRoleDragIndex] = useState<number | null>(null);
  const [roleDragOverIndex, setRoleDragOverIndex] = useState<number | null>(null);
  const [activeRoleModalIndex, setActiveRoleModalIndex] = useState<number | null>(null);
  const [roleModalOrigin, setRoleModalOrigin] = useState<GlassModalOrigin>(null);
  const roleModalPanelRef = useRef<HTMLDivElement | null>(null);
  const roleModalOriginElRef = useRef<HTMLElement | null>(null);
  const [itemCategories, setItemCategories] = useState<ItemCategoryRow[]>([]);
  const [isSpecsLayoutModalOpen, setIsSpecsLayoutModalOpen] = useState(false);
  const [isSpecsTemplateResetConfirmOpen, setIsSpecsTemplateResetConfirmOpen] = useState(false);
  const [specsTemplateResetConfirmOrigin, setSpecsTemplateResetConfirmOrigin] = useState<GlassModalOrigin>(null);
  const specsTemplateResetConfirmPanelRef = useRef<HTMLDivElement | null>(null);
  const specsTemplateResetConfirmOriginElRef = useRef<HTMLElement | null>(null);
  // Surfaces the isolated specs-template write's real failure reason — previously it was fired via
  // `void saveCompanyDocPatchDetailed(...)` with the result thrown away, so a failed write (e.g. a
  // Firestore document-too-large error once the template grows, or a permission error) had zero
  // visible symptom beyond "my edits don't survive a refresh."
  const [specsTemplateSaveError, setSpecsTemplateSaveError] = useState("");
  // Bumped on every reset to force <SpecsGridEditor> to unmount/remount — its own internal
  // selection/drag state isn't derived from `value`, so a plain prop change wouldn't reset it.
  const [specsTemplateEditorKey, setSpecsTemplateEditorKey] = useState(0);
  const [specsTemplateGrid, setSpecsTemplateGrid] = useState<SpecsGrid | null>(null);
  const specsTemplateSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Quote Layout — same cell/grid builder as Specs Layout above, same modal-in-place pattern, just a
  // separate template field (a project's Quote and Specifications sheets are unrelated documents).
  const [isQuoteLayoutModalOpen, setIsQuoteLayoutModalOpen] = useState(false);
  const [isQuoteTemplateResetConfirmOpen, setIsQuoteTemplateResetConfirmOpen] = useState(false);
  const [quoteTemplateResetConfirmOrigin, setQuoteTemplateResetConfirmOrigin] = useState<GlassModalOrigin>(null);
  const quoteTemplateResetConfirmPanelRef = useRef<HTMLDivElement | null>(null);
  const quoteTemplateResetConfirmOriginElRef = useRef<HTMLElement | null>(null);
  const [quoteTemplateSaveError, setQuoteTemplateSaveError] = useState("");
  const [quoteTemplateEditorKey, setQuoteTemplateEditorKey] = useState(0);
  const [quoteGridTemplate, setQuoteGridTemplate] = useState<SpecsGrid | null>(null);
  const quoteTemplateSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [statusSubStagesExpanded, setStatusSubStagesExpanded] = useState<Record<number, boolean>>({});
  const [itemCategoryExpanded, setItemCategoryExpanded] = useState<Record<number, boolean>>({});
  const [itemCategoryDragIndex, setItemCategoryDragIndex] = useState<number | null>(null);
  const [itemCategoryDragOverIndex, setItemCategoryDragOverIndex] = useState<number | null>(null);
  // Item categories: the category waiting on "Delete item category?" (its row, name and how many items it has) — or,
  // with itemIndex, one of its items waiting on "Delete item?".
  const [pendingItemCategoryDelete, setPendingItemCategoryDelete] = useState<{
    index: number;
    name: string;
    itemCount: number;
    itemIndex?: number;
    itemName?: string;
  } | null>(null);
  const [itemCategoryDeleteOrigin, setItemCategoryDeleteOrigin] = useState<GlassModalOrigin>(null);
  const itemCategoryDeletePanelRef = useRef<HTMLDivElement | null>(null);
  const itemCategoryDeleteOriginElRef = useRef<HTMLElement | null>(null);
  // An item being dragged up or down within its own category (Item categories' item rows).
  const [itemCategoryItemDrag, setItemCategoryItemDrag] = useState<{ catIndex: number; itemIndex: number } | null>(null);
  const [isItemCategoriesModalOpen, setIsItemCategoriesModalOpen] = useState(false);
  const [itemCategoriesModalOrigin, setItemCategoriesModalOrigin] = useState<GlassModalOrigin>(null);
  const itemCategoriesModalPanelRef = useRef<HTMLDivElement | null>(null);
  const itemCategoriesModalOriginElRef = useRef<HTMLElement | null>(null);
  const [jobTypes, setJobTypes] = useState<JobTypeRow[]>([]);
  // Sales Product names offered in the Quote/Specs group editor's Rules "IF <Product>" dropdown —
  // the same products as a project's own "Product" checklist (every product — see companySalesProductConfigs in
  // app/(app)/projects/[projectId]/page.tsx), so a rule can only ever reference a product that actually appears there.
  const specsGroupProductOptions = useMemo(() => jobTypes.map((row) => row.name.trim()).filter(Boolean), [jobTypes]);
  // Products folded shut in the Products sheet (by their place in the list).
  const [productCollapsed, setProductCollapsed] = useState<Record<number, boolean>>({});
  // The full-screen Products sheet (Company Settings → Sales → Products → Edit products).
  const [isProductsSheetOpen, setIsProductsSheetOpen] = useState(false);
  const [productsSheetOrigin, setProductsSheetOrigin] = useState<GlassModalOrigin>(null);
  const productsSheetPanelRef = useRef<HTMLDivElement | null>(null);
  const productsSheetOriginElRef = useRef<HTMLElement | null>(null);
  const [jobTypeDragIndex, setJobTypeDragIndex] = useState<number | null>(null);
  const [jobTypeDragOverIndex, setJobTypeDragOverIndex] = useState<number | null>(null);
  const [quoteHelpers, setQuoteHelpers] = useState<QuoteHelperRow[]>([]);
  const [quoteHelperDragIndex, setQuoteHelperDragIndex] = useState<number | null>(null);
  const [quoteHelperDragOverIndex, setQuoteHelperDragOverIndex] = useState<number | null>(null);
  const [discountTiers, setDiscountTiers] = useState<DiscountTierRow[]>([]);
  const [discountTierDragIndex, setDiscountTierDragIndex] = useState<number | null>(null);
  const [discountTierDragOverIndex, setDiscountTierDragOverIndex] = useState<number | null>(null);
  const [minusOffQuoteTotal, setMinusOffQuoteTotal] = useState(false);
  const [extraCharges, setExtraCharges] = useState<ExtraChargeRow[]>([]);
  const [extraChargeDragIndex, setExtraChargeDragIndex] = useState<number | null>(null);
  // Defaults true (allowed) — this only ever RESTRICTS an existing capability (the "Reopen for
  // editing" safety-valve buttons on a sent/submitted Quote or Specifications sheet), so an
  // existing company that's never touched this setting should keep working exactly as before.
  const [salesAllowReopenForEditing, setSalesAllowReopenForEditing] = useState(true);
  // GST: when on, its percent goes on top of every quote's total (after any discount).
  const [salesGstEnabled, setSalesGstEnabled] = useState(false);
  const [salesGstPercent, setSalesGstPercent] = useState("15");
  const quoteHelperRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [hardware, setHardware] = useState<HardwareRow[]>([]);
  const [hardwareExpanded, setHardwareExpanded] = useState<Record<number, boolean>>({});
  const [hardwareActiveTab, setHardwareActiveTab] = useState<Record<number, "drawers" | "hinges" | "other" | "ordering">>({});
  const [hardwareDragIndex, setHardwareDragIndex] = useState<number | null>(null);
  const [hardwareDragOverIndex, setHardwareDragOverIndex] = useState<number | null>(null);
  const [drawerRowExpanded, setDrawerRowExpanded] = useState<Record<string, boolean>>({});
  // The drawer height pop-up (a drawer type's Heights): which brand, drawer and height (null — a new one), and how far
  // along its row it opens. Closes on a press outside it (or its chips, which move it), or Escape.
  const [drawerHeightEditor, setDrawerHeightEditor] = useState<{ hardwareIdx: number; drawerIdx: number; heightIdx: number | null; left: number } | null>(null);
  useEffect(() => {
    if (!drawerHeightEditor) return;
    const onPress = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.("[data-drawer-height-editor], [data-drawer-height-chip]")) return;
      setDrawerHeightEditor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerHeightEditor(null);
    };
    document.addEventListener("pointerdown", onPress);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPress);
      document.removeEventListener("keydown", onKey);
    };
  }, [drawerHeightEditor]);
  const [drawerDragHardwareIndex, setDrawerDragHardwareIndex] = useState<number | null>(null);
  const [drawerDragIndex, setDrawerDragIndex] = useState<number | null>(null);
  const [drawerDragOverIndex, setDrawerDragOverIndex] = useState<number | null>(null);
  const [hingeDrag, setHingeDrag] = useState<{ hardwareIndex: number; hingeIndex: number } | null>(null);
  // Set once a dragged hinge has actually moved, so a drop that misses a row (e.g. in the grid's gap)
  // still saves the new order.
  const hingeDragMovedRef = useRef(false);
  const [otherDrag, setOtherDrag] = useState<{ hardwareIndex: number; otherIndex: number } | null>(null);
  const otherDragMovedRef = useRef(false);
  const [nesting, setNesting] = useState({ sheetHeight: "2440", sheetWidth: "1220", kerf: "5", margin: "10", minPieceSize: "100" });
  const [cutlistProduction, setCutlistProduction] = useState<string[]>([]);
  const [cutlistInitial, setCutlistInitial] = useState<string[]>([]);
  const [cutlistColumnOrder, setCutlistColumnOrder] = useState<string[]>([...cutlistColumnDefaults]);
  const [cutlistColumnDragIndex, setCutlistColumnDragIndex] = useState<number | null>(null);
  // Production › Part types dragged into order — the order they're in on both cutlists (Initial Measure and Production).
  const [partTypeDragIndex, setPartTypeDragIndex] = useState<number | null>(null);
  const [cutlistColumnDragOverIndex, setCutlistColumnDragOverIndex] = useState<number | null>(null);
  const [edgebandingRules, setEdgebandingRules] = useState<EdgebandingRuleRow[]>([]);
  const [edgebandingExcessPerEndMm, setEdgebandingExcessPerEndMm] = useState("");
  const [edgebandingRoundEnabled, setEdgebandingRoundEnabled] = useState(false);
  const [edgebandingRoundDirection, setEdgebandingRoundDirection] = useState<"up" | "down">("up");
  const [edgebandingRoundNearestMeters, setEdgebandingRoundNearestMeters] = useState("");
  // Machining (the old "Nesting Settings" tab, now a list of physical machines) — see normalizeMachines'
  // own comment for how this seeds itself from the old global nesting/edgebanding settings above the
  // very first time a company opens this tab with nothing saved yet.
  const [machines, setMachines] = useState<Machine[]>([]);
  const [activeMachineModalId, setActiveMachineModalId] = useState<string | null>(null);
  const [machineModalOrigin, setMachineModalOrigin] = useState<GlassModalOrigin>(null);
  const machineModalPanelRef = useRef<HTMLDivElement | null>(null);
  const machineModalOriginElRef = useRef<HTMLElement | null>(null);
  const [newMachineTypePickerOpen, setNewMachineTypePickerOpen] = useState(false);
  const [addMachineOrigin, setAddMachineOrigin] = useState<GlassModalOrigin>(null);
  const addMachinePanelRef = useRef<HTMLDivElement | null>(null);
  const shouldRenderAddMachineModal = useGlassModalPopOrigin(newMachineTypePickerOpen, addMachineOrigin, addMachinePanelRef);
  const [gapAllowances, setGapAllowances] = useState<GapAllowancesSettings>({
    baseBelowBenchToTopOfDoorDrawer: "",
    baseHorizontalGapNormalHandles: "",
    baseHorizontalGapWrapOverHandles: "",
    baseVerticalGapDoorsPanels: "",
    tallTopOfDoorToTopWithScribers: "",
    tallTopOfDoorToTopNoScribers: "",
    tallVerticalGapDoorsPanels: "",
  });
  const [unlockSuffix, setUnlockSuffix] = useState("");
  const [unlockHours, setUnlockHours] = useState("6");
  const [zapierLeads, setZapierLeads] = useState<ZapierLeadsSettings>({ enabled: false, webhookSecret: "", fieldLayout: [] });
  const [zapierCopyStatus, setZapierCopyStatus] = useState("");
  const [confirmZapierRegenerate, setConfirmZapierRegenerate] = useState(false);
  const [showZapierHelp, setShowZapierHelp] = useState(false);
  const [showLeadFieldsCustomize, setShowLeadFieldsCustomize] = useState(false);
  const zapierHelpPanelRef = useRef<HTMLDivElement | null>(null);
  const leadFieldsPanelRef = useRef<HTMLDivElement | null>(null);
  const shouldRenderZapierHelp = useGlassModalPopOrigin(showZapierHelp, null, zapierHelpPanelRef);
  const shouldRenderLeadFieldsCustomize = useGlassModalPopOrigin(showLeadFieldsCustomize, null, leadFieldsPanelRef);
  const [appOrigin, setAppOrigin] = useState("");
  const zapierCopyResetTimerRef = useRef<number | null>(null);
  const zapierRegenerateConfirmTimerRef = useRef<number | null>(null);
  const [availableLeadFields, setAvailableLeadFields] = useState<Array<{ key: string; label: string }>>([]);
  const [leadFieldsLoading, setLeadFieldsLoading] = useState(false);
  // Which company's lead fields have been loaded (see the effect that loads them). Until they have,
  // saving keeps the stored field layout as it is — merging against an empty list wiped it.
  const [leadFieldsLoadedFor, setLeadFieldsLoadedFor] = useState("");
  const [leadFieldDragIndex, setLeadFieldDragIndex] = useState<number | null>(null);
  const [leadFieldDragOverIndex, setLeadFieldDragOverIndex] = useState<number | null>(null);
  const [backupTemplate, setBackupTemplate] = useState<BackupTemplateSettings>({
    quoteTemplateHeaderHtml: "",
    quoteTemplateFooterHtml: "",
    quoteTemplatePageSize: "A4",
    quoteTemplateMarginMm: "10",
    quoteTemplateFooterPinBottom: false,
  });
  const [isInvitingStaff, setIsInvitingStaff] = useState(false);
  // The Add staff pop-up: who (email), which access code they'll have (one of the company's waiting ones, or "" for a
  // new one), and the role they start in. It grows out of the Add staff button, and back into it.
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [addStaffEmail, setAddStaffEmail] = useState("");
  const [addStaffEmailTouched, setAddStaffEmailTouched] = useState(false);
  const [addStaffCodeKey, setAddStaffCodeKey] = useState("");
  // A new code's name — null: it follows the email typed (the default), till it's typed over.
  const [addStaffCodeName, setAddStaffCodeName] = useState<string | null>(null);
  const [addStaffRoleId, setAddStaffRoleId] = useState("");
  const [addStaffError, setAddStaffError] = useState("");
  const [addStaffOrigin, setAddStaffOrigin] = useState<GlassModalOrigin>(null);
  const addStaffPanelRef = useRef<HTMLDivElement | null>(null);
  const addStaffOriginElRef = useRef<HTMLElement | null>(null);
  const [savingStaffRoleUid, setSavingStaffRoleUid] = useState("");
  const [openStaffRoleUid, setOpenStaffRoleUid] = useState("");
  const [pendingOwnerTransfer, setPendingOwnerTransfer] = useState<PendingOwnerTransferState | null>(null);
  const [pendingOwnerTransferTargetUid, setPendingOwnerTransferTargetUid] = useState("");
  const [ownerTransferOrigin, setOwnerTransferOrigin] = useState<GlassModalOrigin>(null);
  const ownerTransferPanelRef = useRef<HTMLDivElement | null>(null);
  const ownerTransferOriginElRef = useRef<HTMLElement | null>(null);
  const [pendingStaffRemoval, setPendingStaffRemoval] = useState<PendingStaffRemovalState | null>(null);
  const [staffRemovalOrigin, setStaffRemovalOrigin] = useState<GlassModalOrigin>(null);
  const staffRemovalPanelRef = useRef<HTMLDivElement | null>(null);
  const staffRemovalOriginElRef = useRef<HTMLElement | null>(null);
  const [preparingStaffRemovalUid, setPreparingStaffRemovalUid] = useState("");
  const [removingStaffUid, setRemovingStaffUid] = useState("");
  // Shown inline in the Remove Staff Member popup itself — a validation/API failure here used to
  // only ever reach the tiny save-status pill in the page's own sticky header (via setSaveLabel),
  // which sits far from this modal and is easy to miss entirely. From the user's seat, clicking
  // Confirm then looked like nothing happened at all.
  const [staffRemovalError, setStaffRemovalError] = useState("");
  // Company > Join key pop-up, and the codes it shows (also used for Staff's "Joined with").
  const [joinCodesOpen, setJoinCodesOpen] = useState(false);
  const [joinCodes, setJoinCodes] = useState<JoinCodesState | null>(null);
  const [joinCodesError, setJoinCodesError] = useState("");
  const [joinCodesReloadTick, setJoinCodesReloadTick] = useState(0);
  // Staff > Invited: invites still waiting to be accepted.
  const [pendingInvites, setPendingInvites] = useState<CompanyInviteRow[]>([]);
  const [invitesReloadTick, setInvitesReloadTick] = useState(0);
  const [confirmCancelInviteId, setConfirmCancelInviteId] = useState("");
  const [cancellingInviteId, setCancellingInviteId] = useState("");
  const openStaffRoleMenuRef = useRef<HTMLDivElement | null>(null);
  const [form, setForm] = useState({
    name: "",
    defaultCurrency: "NZD - New Zealand Dollar",
    measurementUnit: "mm",
    dateFormat: "DD/MM/YYYY",
    timeZone: "Pacific/Auckland",
    themeColor: "#2F6BFF",
    logoPath: "",
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!form?.themeColor) return;
    window.localStorage.setItem(ACTIVE_COMPANY_THEME_COLOR_STORAGE_KEY, String(form.themeColor));
  }, [form.themeColor]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setAppOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isHydrated || !activeCompanyId) return;
    window.dispatchEvent(
      new CustomEvent(ZAPIER_LEADS_VISIBILITY_UPDATED_EVENT, {
        detail: {
          companyId: activeCompanyId,
          enabled: Boolean(zapierLeads.enabled),
        },
      }),
    );
  }, [activeCompanyId, isHydrated, zapierLeads.enabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (zapierRegenerateConfirmTimerRef.current != null) {
      window.clearTimeout(zapierRegenerateConfirmTimerRef.current);
      zapierRegenerateConfirmTimerRef.current = null;
    }
    if (!confirmZapierRegenerate) return;
    zapierRegenerateConfirmTimerRef.current = window.setTimeout(() => {
      setConfirmZapierRegenerate(false);
      zapierRegenerateConfirmTimerRef.current = null;
    }, 5000);
    return () => {
      if (zapierRegenerateConfirmTimerRef.current != null) {
        window.clearTimeout(zapierRegenerateConfirmTimerRef.current);
        zapierRegenerateConfirmTimerRef.current = null;
      }
    };
  }, [confirmZapierRegenerate]);

  useEffect(() => {
    const run = async () => {
      if (!user?.uid) {
        setIsLoading(false);
        return;
      }
      const candidateIds = new Set<string>();
      const addCandidate = (id: unknown) => {
        const value = String(id ?? "").trim();
        if (value) {
          candidateIds.add(value);
        }
      };

      addCandidate(user.companyId);
      addCandidate(process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID);
      addCandidate("cmp_mykm_91647c");
      // The company's member list loads alongside its doc (both come from the shared cache when
      // another page already loaded them) rather than after it.
      const expectedCompanyId = String(user.companyId || "").trim();
      const earlyMembers = expectedCompanyId ? fetchCompanyMembers(expectedCompanyId).catch(() => null) : null;

      // Everything from here down used to have no try/catch at all — any single rejection (a
      // network/Firestore hiccup on any of the reads below) meant setIsLoading(false) at the end
      // was never reached, leaving the page stuck showing its loading state (Save/upload/invite
      // controls permanently disabled) forever. Wrapping it — with retries on the reads most
      // likely to hit a transient blip — means a rejection now just falls through to `finally`
      // instead of hanging.
      try {
        const tried = new Set<string>();
        const tryCandidates = async (): Promise<{ id: string; data: Record<string, unknown> } | null> => {
          for (const companyId of candidateIds) {
            if (tried.has(companyId)) continue;
            tried.add(companyId);
            // Try each candidate until we find a readable company doc.
            const hit = await retryAsync(() => fetchCompanyDoc(companyId), { attempts: 2, delayMs: 300 });
            if (hit) return { id: companyId, data: hit };
          }
          return null;
        };
        let found = await tryCandidates();
        // Only if none of those is readable: the companies of the user's projects. (This used to load
        // every project up front on every visit, just to collect company ids nearly always known already.)
        if (!found) {
          try {
            const projects = await fetchProjects(user.uid, undefined, { lightweight: true });
            for (const project of projects) {
              addCandidate(project.companyId);
            }
          } catch {
            // ignore project-based fallback errors
          }
          found = await tryCandidates();
        }
        const selectedCompanyId = found?.id ?? "";
        const doc: Record<string, unknown> | null = found?.data ?? null;

        setActiveCompanyId(selectedCompanyId);
        const members = selectedCompanyId
          ? (selectedCompanyId === expectedCompanyId ? await earlyMembers : null) ??
            (await retryAsync(() => fetchCompanyMembers(selectedCompanyId), { attempts: 2, delayMs: 300 }))
          : [];
        setCompany(doc);
        setStaff(members);
        if (doc) {
        const nestingRaw = (doc.nestingSettings ?? {}) as Record<string, unknown>;
        const appPrefsRaw = (doc.applicationPreferences ?? {}) as Record<string, unknown>;
        const cutCols = (doc.cutlistColumnsByContext ?? {}) as Record<string, unknown>;
        setForm({
          name: toStr(doc.name ?? doc.companyName ?? appPrefsRaw.companyName),
          defaultCurrency: toStr(doc.defaultCurrency, "NZD - New Zealand Dollar"),
          measurementUnit: toStr(doc.measurementUnit, "mm"),
          dateFormat: toStr(doc.dateFormat, "DD/MM/YYYY"),
          timeZone: toStr(doc.timeZone, "Pacific/Auckland"),
          themeColor: toStr(doc.themeColor, "#2F6BFF"),
          logoPath: toStr(doc.logoPath),
        });
        setStatuses(normalizeStatuses(doc.projectStatuses));
        setLeadStatuses(normalizeLeadStatuses((doc as Record<string, unknown>).leadStatuses));
        setSmallJobStatuses(normalizeSmallJobStatuses((doc as Record<string, unknown>).smallJobStatuses));
        setLeadForms(normalizeLeadForms((doc as Record<string, unknown>).leadForms));
        {
          const bonus = completionBonusSettingsFrom(doc);
          setBonusPeriodMonths(bonus.periodMonths);
          setBonusStartMonth(bonus.startMonth);
          setBonusPaidMonthsAfter(bonus.paidMonthsAfter);
          setBonusMinimumQuote(bonus.minimumQuote === null ? "" : String(bonus.minimumQuote));
        }
        setProjectTagUsage(normalizeProjectTagUsage(doc.projectTagUsage));
        setBoardColourMemory(normalizeBoardColourMemory(doc.boardMaterialUsage));
        setBoardThicknesses(normalizeStringList(doc.boardThicknesses, ["16", "18"]));
        setBoardFinishes(normalizeStringList(doc.boardFinishes, ["Satin"]));
        setSheetSizes(normalizeSheetSizes(doc.sheetSizes));
        setPartTypes(normalizePartTypes(doc.partTypes));
        setContactCategories(normalizeContactCategories((doc as Record<string, unknown>).contactCategories));
        setCalendarCategories(normalizeCalendarCategories((doc as Record<string, unknown>).calendarCategories));
        setCalendarWorkdays(normalizeCalendarWorkdays((doc as Record<string, unknown>).calendarWorkdays));
        setCalendarRetention(normalizeCalendarRetention((doc as Record<string, unknown>).calendarEventRetention));
        setProjectArchiveAfter(normalizeProjectArchiveDelay((doc as Record<string, unknown>).projectArchiveAfter));
        setCalendarShowToClientDefault((doc as Record<string, unknown>).calendarShowToClientDefault === true);
        setCalendarShowNonWorkdays((doc as Record<string, unknown>).calendarShowNonWorkdays !== false);
        setCalendarHolidayRegion(normalizeNzHolidayRegion((doc as Record<string, unknown>).calendarHolidayRegion));
        setContractors(normalizeStringList(doc.contractors, []));
        setRoomNames(normalizeStringList((doc as Record<string, unknown>).roomNames, []));
        setRoles(normalizeRoles(doc.roles));
        savedRolesRef.current = normalizeRoles(doc.roles);
        setRoleAuditLog(normalizeRoleAuditLog(doc.roleAuditLog));
        setItemCategories(normalizeItemCategories(doc.itemCategories));
        setSpecsTemplateGrid(normalizeSpecsGrid(doc.specsTemplateGrid));
        setQuoteGridTemplate(normalizeSpecsGrid(doc.quoteGridTemplate));
        setJobTypes(normalizeJobTypes(doc.salesJobTypes));
        setQuoteHelpers(normalizeQuoteHelpers(doc.salesQuoteHelpers));
        setDiscountTiers(normalizeDiscountTiers(doc.salesQuoteDiscountTiers));
        setMinusOffQuoteTotal(Boolean(doc.salesMinusOffQuoteTotal));
        setExtraCharges(normalizeExtraCharges(doc.salesExtraCharges));
        setSalesAllowReopenForEditing(doc.salesAllowReopenForEditing !== false);
        setSalesGstEnabled(Boolean(doc.salesGstEnabled));
        setSalesGstPercent(doc.salesGstPercent == null || doc.salesGstPercent === "" ? "15" : toStr(doc.salesGstPercent));
        const hardwareRows = normalizeHardware(doc.hardwareSettings);
        setHardware(sanitizeHardwareRows(hardwareRows));
        setNesting({
          sheetHeight: toStr(nestingRaw.sheetHeight, "2440"),
          sheetWidth: toStr(nestingRaw.sheetWidth, "1220"),
          kerf: toStr(nestingRaw.kerf, "5"),
          margin: toStr(nestingRaw.margin, "10"),
          minPieceSize: toStr(nestingRaw.minPieceSize, "100"),
        });
        const nextCutlistProduction = normalizeStringList(cutCols.production, []);
        const nextCutlistInitial = normalizeStringList(cutCols.initialMeasure, []);
        setCutlistProduction(nextCutlistProduction);
        setCutlistInitial(nextCutlistInitial);
        const orderRaw =
          Array.isArray(doc.cutlistColumnOrder)
            ? doc.cutlistColumnOrder
            : (cutCols.order as unknown);
        setCutlistColumnOrder(mergeCutlistColumnOrder(orderRaw, nextCutlistProduction, nextCutlistInitial));
        const edgeSettings = normalizeEdgebandingSettings(doc.edgebandingSettings);
        setEdgebandingRules(edgeSettings.rules);
        setEdgebandingExcessPerEndMm(edgeSettings.excessPerEndMm);
        setEdgebandingRoundEnabled(edgeSettings.roundEnabled);
        setEdgebandingRoundDirection(edgeSettings.roundDirection);
        setEdgebandingRoundNearestMeters(edgeSettings.roundNearestMeters);
        setMachines(normalizeMachines((doc as Record<string, unknown>).machines, normalizeMachineNestingSettings(nestingRaw), edgeSettings as MachineEdgebandingSettings));
        setGapAllowances(normalizeGapAllowancesSettings(doc.gapAllowancesSettings));
        setUnlockSuffix(toStr(doc.productionUnlockPasswordSuffix));
        setUnlockHours(toStr(doc.productionUnlockDurationHours, "6"));
        const integrationsDoc =
          doc.integrations && typeof doc.integrations === "object"
            ? (doc.integrations as Record<string, unknown>)
            : {};
        const zapierDoc =
          integrationsDoc.zapierLeads && typeof integrationsDoc.zapierLeads === "object"
            ? (integrationsDoc.zapierLeads as Record<string, unknown>)
            : {};
        setZapierLeads({
          enabled: Boolean(zapierDoc.enabled),
          webhookSecret: toStr(zapierDoc.webhookSecret),
          fieldLayout: normalizeLeadFieldLayout(zapierDoc.fieldLayout),
        });
        setBackupTemplate({
          quoteTemplateHeaderHtml: toStr(doc.quoteTemplateHeaderHtml),
          quoteTemplateFooterHtml: toStr(doc.quoteTemplateFooterHtml),
          quoteTemplatePageSize: toStr(doc.quoteTemplatePageSize, "A4"),
          quoteTemplateMarginMm: toStr(doc.quoteTemplateMarginMm, "10"),
          quoteTemplateFooterPinBottom: Boolean(doc.quoteTemplateFooterPinBottom),
        });
        }
        setIsHydrated(true);
      } finally {
        setIsLoading(false);
      }
    };
    void run();
  }, [user?.uid, user?.companyId]);

  useEffect(() => {
    const run = async () => {
      const uids = Array.from(new Set(staff.map((row) => toStr(row.uid)).filter(Boolean)));
      if (!uids.length) {
        setStaffIconColorByUid({});
        return;
      }
      const colorMap = await fetchUserColorMapByUids(uids, activeCompanyId);
      setStaffIconColorByUid(colorMap);
    };
    void run();
  }, [activeCompanyId, staff]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onUserColorUpdated = (event: Event) => {
      const detail = (event as CustomEvent<UserColorUpdatedDetail>).detail;
      const uid = String(detail?.uid || "").trim();
      const color = String(detail?.color || "").trim();
      const companyId = String(detail?.companyId || "").trim();
      if (!uid) return;
      if (companyId && activeCompanyId && companyId !== activeCompanyId) return;
      setStaffIconColorByUid((prev) => {
        const next = { ...prev };
        if (color) next[uid] = color;
        else delete next[uid];
        return next;
      });
      setStaff((prev) =>
        prev.map((member) =>
          String(member.uid || "").trim() === uid
            ? { ...member, badgeColor: color || undefined, userColor: color || undefined }
            : member,
        ),
      );
    };
    window.addEventListener(USER_COLOR_UPDATED_EVENT, onUserColorUpdated as EventListener);
    return () => {
      window.removeEventListener(USER_COLOR_UPDATED_EVENT, onUserColorUpdated as EventListener);
    };
  }, [activeCompanyId]);

  useEffect(() => {
    if (active !== "hardware") return;
    setHardwareExpanded({});
    setDrawerRowExpanded({});
    setDrawerHeightEditor(null);
  }, [active]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (activeRoleModalIndex === null) return;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    // clip, not hidden — a hidden <body> under a hidden <html> becomes a scroll container, and sticky bars
    // stick to it instead of the window (globals.css, html.cs-scroll-locked body).
    document.body.style.overflow = "clip";
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, [activeRoleModalIndex]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!pendingOwnerTransfer) return;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    // clip, not hidden — a hidden <body> under a hidden <html> becomes a scroll container, and sticky bars
    // stick to it instead of the window (globals.css, html.cs-scroll-locked body).
    document.body.style.overflow = "clip";
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, [pendingOwnerTransfer]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!pendingStaffRemoval) return;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    // clip, not hidden — a hidden <body> under a hidden <html> becomes a scroll container, and sticky bars
    // stick to it instead of the window (globals.css, html.cs-scroll-locked body).
    document.body.style.overflow = "clip";
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, [pendingStaffRemoval]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!openStaffRoleUid) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (openStaffRoleMenuRef.current?.contains(target)) return;
      // This press only closes the menu — it must not also act on whatever it landed on.
      swallowNextClick();
      setOpenStaffRoleUid("");
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenStaffRoleUid("");
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openStaffRoleUid]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return SETTINGS_SEARCH_INDEX.filter((item) => {
      const tab = sections.find((sec) => sec.key === item.section)?.label ?? "";
      return [item.label, item.card, item.keywords ?? "", tab].join(" ").toLowerCase().includes(q);
    }).slice(0, 12);
  }, [search]);
  // Jump to a search hit: switch tab, then scroll its card into view and flash it.
  const goToSearchResult = (item: (typeof SETTINGS_SEARCH_INDEX)[number]) => {
    setActive(item.section);
    setSearch("");
    window.setTimeout(() => {
      const card = Array.from(document.querySelectorAll<HTMLElement>("[data-settings-card]")).find(
        (el) => el.dataset.settingsCard?.toLowerCase() === item.card.toLowerCase(),
      );
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.animate(
        [{ boxShadow: "0 0 0 3px var(--brand), var(--shadow-glass)" }, { boxShadow: "0 0 0 0 transparent, var(--shadow-glass)" }],
        { duration: 1600, easing: "ease-out" },
      );
    }, 60);
  };

  const access = useCompanyAccess();
  // Each project status (and its sub-stages) and lead status has an Automate button (projects.automate) — that board
  // column's automations (components/column-automations.tsx), as right-clicking it on the board opens. The lists as
  // they stand here, named, for where a move can go.
  const projectAutomationColumns = useMemo(
    () =>
      statuses
        .filter((row) => row.name.trim())
        .flatMap((row) => [
          { status: row.name.trim(), subStage: "", color: row.color || "#64748B" },
          ...(row.subStages ?? [])
            .filter((sub) => sub.name.trim())
            .map((sub) => ({ status: row.name.trim(), subStage: sub.name.trim(), color: sub.color || "#64748B" })),
        ]),
    [statuses],
  );
  const leadAutomationColumns = useMemo(
    () => leadStatuses.filter((row) => row.name.trim()).map((row) => ({ status: row.name.trim(), subStage: "", color: row.color || "#64748B" })),
    [leadStatuses],
  );
  const projectAutomations = useColumnAutomations("projects", projectAutomationColumns);
  const leadAutomations = useColumnAutomations("leads", leadAutomationColumns);

  const currentMemberRole = useMemo(() => {
    const fromMembership = staff.find((m) => m.uid === user?.uid)?.role;
    const fromUser = (user as { role?: string } | null)?.role;
    if (access.status === "ready") {
      return String(fromMembership ?? access.role ?? fromUser ?? "").trim().toLowerCase();
    }
    return String(fromMembership ?? fromUser ?? "").trim().toLowerCase();
  }, [access.role, access.status, staff, user]);

  // Unverified accounts never actually reach this page (see app/(app)/layout.tsx's own
  // VerifyEmailGate), but these guards stay as a second layer of defense in case that gate is
  // ever bypassed by a future change.
  const isUserVerified = Boolean(user?.verified);
  const canEditCompanySettings = isUserVerified;

  const canAddStaff = useMemo(() => {
    if (isOwnerOrAdmin(currentMemberRole)) {
      return true;
    }
    const perms = access.status === "ready" ? access.permissionKeys : Array.isArray(user?.permissions) ? user.permissions : [];
    return hasPermissionKey(perms, "staff.add");
  }, [access.permissionKeys, access.status, currentMemberRole, user?.permissions]);

  const canChangeStaffDisplayName = useMemo(() => {
    if (currentMemberRole === "owner") return true;
    const perms = access.status === "ready" ? access.permissionKeys : Array.isArray(user?.permissions) ? user.permissions : [];
    return hasPermissionKey(perms, "staff.change.display_name");
  }, [access.permissionKeys, access.status, currentMemberRole, user?.permissions]);

  const canChangeStaffRole = useMemo(() => {
    if (currentMemberRole === "owner") return true;
    const perms = access.status === "ready" ? access.permissionKeys : Array.isArray(user?.permissions) ? user.permissions : [];
    return hasPermissionKey(perms, "staff.change.role");
  }, [access.permissionKeys, access.status, currentMemberRole, user?.permissions]);

  const canRemoveStaff = useMemo(() => {
    if (currentMemberRole === "owner") return true;
    const perms = access.status === "ready" ? access.permissionKeys : Array.isArray(user?.permissions) ? user.permissions : [];
    return hasPermissionKey(perms, "staff.remove");
  }, [access.permissionKeys, access.status, currentMemberRole, user?.permissions]);

  const canAccessCompanySettings = useMemo(() => {
    if (isOwnerOrAdmin(currentMemberRole)) {
      return true;
    }
    const perms = access.status === "ready" ? access.permissionKeys : Array.isArray(user?.permissions) ? user.permissions : [];
    return hasPermissionKey(perms, "company.settings");
  }, [access.permissionKeys, access.status, currentMemberRole, user?.permissions]);

  // Dashboard > Completion bonus: only with dashboard.complete.bonus (owners and admins have every permission).
  const canSeeCompletionBonus = useMemo(() => {
    if (isOwnerOrAdmin(currentMemberRole)) return true;
    const perms = access.status === "ready" ? access.permissionKeys : Array.isArray(user?.permissions) ? user.permissions : [];
    return hasPermissionKey(perms, "dashboard.complete.bonus");
  }, [access.permissionKeys, access.status, currentMemberRole, user?.permissions]);

  // The same people the server lets manage join codes (lib/company-join-codes-server.ts).
  const canManageJoinCodes = canAddStaff || canAccessCompanySettings;

  useEffect(() => {
    if (!activeCompanyId || !canManageJoinCodes || (active !== "staff" && !joinCodesOpen)) return;
    let cancelled = false;
    void fetchJoinCodes(activeCompanyId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setJoinCodes(result.data);
        setJoinCodesError("");
      } else {
        setJoinCodesError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [active, activeCompanyId, canManageJoinCodes, joinCodesOpen, joinCodesReloadTick]);

  useEffect(() => {
    if (!activeCompanyId || active !== "staff") return;
    let cancelled = false;
    void fetchCompanyInvites(activeCompanyId).then((rows) => {
      if (!cancelled) setPendingInvites(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [active, activeCompanyId, invitesReloadTick]);

  const joinCodesByKey = useMemo(() => new Map((joinCodes?.codes ?? []).map((row) => [row.key, row] as const)), [joinCodes]);

  // How a staff member joined, for their row: the code they used (and what kind), an invite, or
  // creating the company.
  const joinedWithFor = (row: CompanyMemberOption, isOwnerRow: boolean): { code: string; kind: string } => {
    const key = toStr(row.joinCodeKey).toLowerCase();
    if (toStr(row.joinedVia) === "invite") return { code: "", kind: "Joined from an invite" };
    if (!key) return { code: "", kind: isOwnerRow ? "Created the company" : "—" };
    const record = joinCodesByKey.get(key);
    if (joinCodes?.masterKey && key === joinCodes.masterKey) return { code: joinCodes.masterCode, kind: "Master code" };
    if (record?.kind === "temporary") return { code: record.code, kind: "Access code" };
    if (record?.kind === "master") return { code: record.code, kind: "Old master code" };
    return { code: key.toUpperCase(), kind: "Code" };
  };

  const cancelInvite = async (invite: CompanyInviteRow) => {
    if (confirmCancelInviteId !== invite.id) {
      setConfirmCancelInviteId(invite.id);
      return;
    }
    setConfirmCancelInviteId("");
    // Off the list straight away, but only really cancelled (the invite deleted, its join code revoked — not something
    // that can be put back) as the Undo bar goes without Undo being pressed. Undo shows it again.
    const companyId = activeCompanyId;
    const at = pendingInvites.findIndex((row) => row.id === invite.id);
    const showAgain = () =>
      setPendingInvites((prev) => (prev.some((row) => row.id === invite.id) ? prev : insertAt(prev, at < 0 ? prev.length : at, invite)));
    setPendingInvites((prev) => prev.filter((row) => row.id !== invite.id));
    offerUndo(`Invite to ${invite.email} cancelled`, showAgain, {
      commit: async () => {
        setCancellingInviteId(invite.id);
        const ok = companyId ? await cancelCompanyInvite(companyId, invite.id) : false;
        setCancellingInviteId("");
        if (!ok) {
          showAgain();
          setSaveLabel("Couldn't cancel the invite");
          return;
        }
        setSaveLabel(`Invite cancelled: ${invite.email}`);
        // Its join code stops working too.
        if (companyId) void revokeJoinCodesForInvite(companyId, invite.id).then(() => setJoinCodesReloadTick((tick) => tick + 1));
      },
    });
  };

  // Revoking an access code (a temporary code) someone has already joined with: remove them first (Staff's Remove
  // pop-up, with the hand-over of their data), then the code is revoked. If they've already left,
  // it's just revoked.
  const revokeUsedJoinCode = async (record: JoinCodeRecord) => {
    const member = staff.find((row) => toStr(row.uid) === toStr(record.usedByUid));
    if (!member) {
      const result = activeCompanyId ? await revokeTemporaryJoinCode(activeCompanyId, record.key) : { ok: false, error: "" };
      setJoinCodesReloadTick((tick) => tick + 1);
      if (!result.ok) setJoinCodesError(result.error || "Couldn't revoke the code.");
      return;
    }
    setJoinCodesOpen(false);
    setActive("staff");
    staffRemovalOriginElRef.current = null;
    setStaffRemovalOrigin(null);
    void openStaffRemovalDialog(member, { key: record.key, code: record.code });
  };

  // Phones/tablets: the section tabs are a sideways-scrolling strip — keep the selected one in view
  // (after a search jump, a ?section= link, or tapping one half off the edge). On desktop the tabs are
  // a column that doesn't scroll sideways, so this does nothing there.
  const sectionNavRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const nav = sectionNavRef.current;
    if (!nav || nav.scrollWidth <= nav.clientWidth) return;
    const tab = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (!tab) return;
    const navBox = nav.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    nav.scrollBy({ left: tabBox.left + tabBox.width / 2 - (navBox.left + navBox.width / 2), behavior: "smooth" });
  }, [active, canAccessCompanySettings, access.status]);

  const staffRoleOptions = useMemo(() => {
    const merged = new Map<string, RoleRow>();
    for (const row of roles) {
      const key = normalizeRoleKey(row.id || row.name);
      if (!key) continue;
      merged.set(key, {
        ...row,
        id: key,
        name: toStr(row.name, key),
        color: toStr(row.color, "#7D99B3"),
      });
    }
    return Array.from(merged.values());
  }, [roles]);

  const roleNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of staffRoleOptions) {
      const id = normalizeRoleKey(row.id || row.name);
      const name = toStr(row.name);
      if (!id || !name) continue;
      map.set(id, name);
    }
    return map;
  }, [staffRoleOptions]);

  const roleColorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of staffRoleOptions) {
      const id = normalizeRoleKey(row.id || row.name);
      const color = toStr(row.color, "#7D99B3");
      if (!id) continue;
      map.set(id, color);
    }
    return map;
  }, [staffRoleOptions]);

  const hasAnotherOwnerBesidesCurrentUser = useMemo(() => {
    const currentUid = toStr(user?.uid);
    if (!currentUid) return false;
    return staff.some(
      (member) =>
        toStr(member.uid) !== currentUid &&
        normalizeRoleKey(member.roleId || member.role) === "owner",
    );
  }, [staff, user?.uid]);

  const ownerTransferCandidates = useMemo(() => {
    const currentOwnerUid = toStr(pendingOwnerTransfer?.currentOwnerUid);
    return staff.filter((member) => toStr(member.uid) && toStr(member.uid) !== currentOwnerUid);
  }, [pendingOwnerTransfer?.currentOwnerUid, staff]);

  const staffRemovalTransferCandidates = useMemo(() => {
    const targetUid = toStr(pendingStaffRemoval?.uid);
    return staff.filter((member) => {
      const uid = toStr(member.uid);
      return uid && uid !== targetUid;
    });
  }, [pendingStaffRemoval?.uid, staff]);

  // Add staff's Access code: the company's codes still waiting for someone (active, not used, not an invite's already).
  const linkableAccessCodes = useMemo(
    () => (joinCodes?.codes ?? []).filter((row) => row.kind === "temporary" && row.status === "active" && !row.usedByUid && !row.inviteId),
    [joinCodes],
  );
  // Add staff's Role: the Staff table's roles and colours, without Owner, and with Admin only for an owner or admin —
  // the server checks the same (lib/company-join-code-role.ts). It starts on Staff, what everyone joining gets otherwise.
  const inviteRoleOptions = useMemo<GlassDropdownOption[]>(
    () =>
      staffRoleOptions
        .filter((role) => {
          const key = normalizeRoleKey(role.id || role.name);
          return key !== "owner" && (key !== "admin" || isOwnerOrAdmin(currentMemberRole));
        })
        .map((role) => ({ value: normalizeRoleKey(role.id || role.name), label: toStr(role.name, role.id), color: toStr(role.color, "#7D99B3") })),
    [currentMemberRole, staffRoleOptions],
  );
  const defaultInviteRoleId = inviteRoleOptions.some((role) => role.value === "staff") ? "staff" : inviteRoleOptions[0]?.value ?? "staff";
  // The Access codes list's role pills: the role's name and colour, as the Staff table has them.
  const accessCodeRoleFor = (roleId: string) => {
    const key = normalizeRoleKey(roleId);
    const name = roleNameById.get(key);
    return name ? { name, color: roleColorById.get(key) || "#7D99B3" } : null;
  };
  const addStaffEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addStaffEmail.trim());

  const openAddStaff = () => {
    if (!activeCompanyId || !canAddStaff || !canEditCompanySettings || isInvitingStaff) return;
    setAddStaffEmail("");
    setAddStaffEmailTouched(false);
    setAddStaffCodeKey("");
    setAddStaffCodeName(null);
    setAddStaffRoleId(defaultInviteRoleId);
    setAddStaffError("");
    setAddStaffOpen(true);
  };
  const closeAddStaff = () => {
    if (isInvitingStaff) return;
    setAddStaffOpen(false);
  };

  // Escape closes it too (a dropdown open in it closes first: GlassDropdown keeps that Escape to itself).
  useEffect(() => {
    if (!addStaffOpen || isInvitingStaff) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddStaffOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [addStaffOpen, isInvitingStaff]);

  const sendStaffInvite = async () => {
    const cleanEmail = addStaffEmail.trim();
    if (!activeCompanyId || !canAddStaff || !canEditCompanySettings || isInvitingStaff) return;
    if (!addStaffEmailValid) {
      setAddStaffEmailTouched(true);
      return;
    }
    const pickedCode = addStaffCodeKey ? linkableAccessCodes.find((row) => row.key === addStaffCodeKey) : null;
    if (addStaffCodeKey && !pickedCode) {
      setAddStaffError("That access code can't be used any more. Pick another one.");
      return;
    }
    // Without a say over roles, no role is sent: they join as Staff (and the server would refuse any other).
    const roleId = canChangeStaffRole ? normalizeRoleKey(addStaffRoleId) : "";
    const invitedBefore = pendingInvites.some((invite) => invite.email.toLowerCase() === cleanEmail.toLowerCase());

    setIsInvitingStaff(true);
    setAddStaffError("");
    const result = await createCompanyInviteDetailed(activeCompanyId, cleanEmail, {
      companyName: toStr(form.name || company?.name || company?.companyName || activeCompanyId),
      invitedByUid: String(user?.uid || ""),
      invitedByName: String(user?.displayName || user?.email || ""),
    });
    if (!result.ok || !result.inviteId) {
      const why = result.error || "unknown";
      setSaveLabel(`Invite failed (${why})`);
      setAddStaffError(`The invite couldn't be sent (${why}).`);
      setIsInvitingStaff(false);
      return;
    }
    // Their Access code (a one-person join code), linked to the invite (the one picked, or a new one), with the role
    // they start in. They never type it: accepting the invite uses it up, so they show as having joined with it, in that
    // role. Revoking it removes them.
    const invite = { inviteId: result.inviteId, invitedEmail: cleanEmail, ...(roleId ? { roleId } : {}) };
    const code = pickedCode
      ? await linkJoinCodeToInvite(activeCompanyId, pickedCode.key, invite)
      : await createTemporaryJoinCode(activeCompanyId, (addStaffCodeName ?? cleanEmail).trim() || cleanEmail, invite);
    if (!code.ok) {
      // Without its code, accepting the invite would make them Staff whatever role was picked, so a new invite is taken
      // back and the pop-up stays open to try again. (One sent before stays as it was.)
      if (!invitedBefore) await cancelCompanyInvite(activeCompanyId, result.inviteId);
      setSaveLabel(`Invite failed (${code.error})`);
      setAddStaffError(code.error);
      setInvitesReloadTick((tick) => tick + 1);
      setJoinCodesReloadTick((tick) => tick + 1);
      setIsInvitingStaff(false);
      return;
    }
    const codeText = code.code || pickedCode?.code || "";
    setSaveLabel(codeText ? `Invite sent: ${cleanEmail} · access code ${codeText}` : `Invite sent: ${cleanEmail}`);
    setInvitesReloadTick((tick) => tick + 1);
    setJoinCodesReloadTick((tick) => tick + 1);
    setIsInvitingStaff(false);
    setAddStaffOpen(false);
  };

  const persistStaffDisplayName = async (row: CompanyMemberOption) => {
    const uid = toStr(row.uid);
    const nextName = toStr(row.displayName);
    const startedWith = toStr(staffNameEditStartRef.current[uid]);
    if (!uid || !activeCompanyId || !canChangeStaffDisplayName || !canEditCompanySettings) return;
    if (!nextName) {
      setStaff((prev) =>
        prev.map((member) => (member.uid === uid ? { ...member, displayName: startedWith || member.displayName } : member)),
      );
      setSaveLabel("Display name cannot be empty");
      return;
    }
    if (nextName === startedWith) return;

    setSavingStaffNameUid(uid);
    const result = await saveCompanyMemberDisplayName(activeCompanyId, uid, nextName);
    setSavingStaffNameUid("");
    if (!result.ok) {
      setStaff((prev) =>
        prev.map((member) => (member.uid === uid ? { ...member, displayName: startedWith || member.displayName } : member)),
      );
      setSaveLabel(`Display name save failed (${result.error || "unknown"})`);
      return;
    }

    staffNameEditStartRef.current[uid] = nextName;
    setStaff((prev) =>
      prev.map((member) =>
        member.uid === uid
          ? {
              ...member,
              displayName: nextName,
              membershipDisplayName: nextName,
            }
          : member,
      ),
    );
    setSaveLabel("Saved");
  };

  const persistStaffRole = async (row: CompanyMemberOption, nextRoleIdRaw: string) => {
    const uid = toStr(row.uid);
    const nextRoleId = normalizeRoleKey(nextRoleIdRaw);
    if (!uid || !activeCompanyId || !canChangeStaffRole || !canEditCompanySettings) return;
    if (!nextRoleId) {
      setSaveLabel("Staff role cannot be empty");
      return;
    }
    const selectedRole = staffRoleOptions.find((role) => normalizeRoleKey(role.id || role.name) === nextRoleId);
    if (!selectedRole) {
      setSaveLabel("Selected role not found");
      return;
    }
    const currentRoleId = normalizeRoleKey(row.roleId || row.role);
    if (currentRoleId === nextRoleId) return;
    if (
      uid === toStr(user?.uid) &&
      currentRoleId === "owner" &&
      nextRoleId !== "owner" &&
      !hasAnotherOwnerBesidesCurrentUser
    ) {
      setPendingOwnerTransfer({
        currentOwnerUid: uid,
        currentOwnerName: toStr(row.displayName, "Current Owner"),
        nextRoleId,
      });
      setPendingOwnerTransferTargetUid("");
      return;
    }

    setSavingStaffRoleUid(uid);
    const result = await saveCompanyMemberRole(activeCompanyId, uid, nextRoleId, selectedRole.permissions);
    setSavingStaffRoleUid("");
    if (!result.ok) {
      setStaff((prev) =>
        prev.map((member) =>
          member.uid === uid
            ? {
                ...member,
                role: currentRoleId || member.role,
                roleId: currentRoleId || member.roleId,
              }
            : member,
        ),
      );
      setSaveLabel(`Staff role save failed (${result.error || "unknown"})`);
      return;
    }

    setStaff((prev) =>
      prev.map((member) =>
        member.uid === uid
          ? {
              ...member,
              role: nextRoleId,
              roleId: nextRoleId,
            }
          : member,
      ),
    );
    invalidateCompanyAccessCache({ companyId: activeCompanyId });
    // (In the audit log: who, whose, from what to what.)
    const roleName = (id: string) => staffRoleOptions.find((role) => normalizeRoleKey(role.id || role.name) === id)?.name || id;
    void appendRoleAudit(activeCompanyId, [
      newRoleAuditEntry(`changed ${toStr(row.displayName, "a staff member")}'s role from ${roleName(currentRoleId) || "none"} to ${roleName(nextRoleId)}`, {
        uid: toStr(user?.uid),
        name: toStr(user?.displayName || user?.email, "Someone"),
      }),
    ]).then((next) => {
      if (next) setRoleAuditLog(next);
    });
    setSaveLabel("Saved");
    const previousRole = staffRoleOptions.find((role) => normalizeRoleKey(role.id || role.name) === currentRoleId);
    void addUserNotification(uid, {
      title: "Role updated",
      message: `Your role in ${toStr(company?.name, "your company")} changed from "${previousRole?.name || currentRoleId}" to "${selectedRole.name}".`,
      type: "role_change",
      companyId: activeCompanyId,
    });
  };

  const confirmOwnerTransferAndRoleChange = async () => {
    const currentOwnerUid = toStr(pendingOwnerTransfer?.currentOwnerUid);
    const nextRoleId = normalizeRoleKey(pendingOwnerTransfer?.nextRoleId);
    const nextOwnerUid = toStr(pendingOwnerTransferTargetUid);
    if (!currentOwnerUid || !nextRoleId || !nextOwnerUid || !activeCompanyId || !canEditCompanySettings) {
      setSaveLabel("Choose the new Owner first");
      return;
    }
    const nextOwnerMember = staff.find((member) => toStr(member.uid) === nextOwnerUid);
    if (!nextOwnerMember) {
      setSaveLabel("Selected new Owner was not found");
      return;
    }

    setSavingStaffRoleUid(currentOwnerUid);
    const promoteResult = await saveCompanyMemberRole(activeCompanyId, nextOwnerUid, "owner", []);
    if (!promoteResult.ok) {
      setSavingStaffRoleUid("");
      setSaveLabel(`Owner transfer failed (${promoteResult.error || "unknown"})`);
      return;
    }

    setStaff((prev) =>
      prev.map((member) =>
        toStr(member.uid) === nextOwnerUid
          ? { ...member, role: "owner", roleId: "owner" }
          : member,
      ),
    );

    const demoteResult = await saveCompanyMemberRole(activeCompanyId, currentOwnerUid, nextRoleId, []);
    setSavingStaffRoleUid("");
    if (!demoteResult.ok) {
      setSaveLabel(`Role change failed (${demoteResult.error || "unknown"})`);
      return;
    }

    setStaff((prev) =>
      prev.map((member) =>
        toStr(member.uid) === currentOwnerUid
          ? { ...member, role: nextRoleId, roleId: nextRoleId }
          : member,
      ),
    );
    invalidateCompanyAccessCache({ companyId: activeCompanyId });
    setPendingOwnerTransfer(null);
    setPendingOwnerTransferTargetUid("");
    setSaveLabel("Saved");
  };

  const openStaffRemovalDialog = async (row: CompanyMemberOption, revokeCode?: { key: string; code: string }) => {
    const uid = toStr(row.uid);
    const roleId = normalizeRoleKey(row.roleId || row.role);
    if (!uid || !activeCompanyId || !canRemoveStaff || roleId === "owner") {
      if (roleId === "owner") {
        setSaveLabel("Owner cannot be removed from the company");
      }
      return;
    }
    setPreparingStaffRemovalUid(uid);
    try {
      // Counted server-side: leads (and other staff members' data) aren't readable from here.
      const preview = await previewCompanyMemberRemoval(activeCompanyId, uid);
      const counts = preview.ok ? preview.counts : null;
      const hasRecipients = staff.some((member) => toStr(member.uid) && toStr(member.uid) !== uid);
      // Everything they have starts switched on, so nothing is left behind by accident.
      const transfer = Object.fromEntries(
        STAFF_REMOVAL_DATA_ROWS.map(({ kind }) => [kind, hasRecipients && (counts ? counts[kind] > 0 : true)]),
      ) as Record<MemberRemovalDataKind, boolean>;
      setStaffRemovalError(preview.ok ? "" : `Couldn't check what data they have (${preview.error || "unknown"}).`);
      setPendingStaffRemoval({
        uid,
        displayName: toStr(row.displayName || row.email || row.uid),
        roleId,
        counts,
        transfer,
        transferToUid: "",
        typedName: "",
        confirmPhase: "prompt",
        revokeCode,
      });
    } finally {
      setPreparingStaffRemovalUid("");
    }
  };

  const advanceStaffRemovalConfirmation = () => {
    if (!pendingStaffRemoval) return;
    if (normalizeRoleKey(pendingStaffRemoval.roleId) === "owner") {
      setStaffRemovalError("Owner cannot be removed from the company");
      return;
    }
    if (staffRemovalNeedsRecipient(pendingStaffRemoval) && !toStr(pendingStaffRemoval.transferToUid)) {
      setStaffRemovalError("Choose who to transfer their data to, or switch off what you don't want to transfer");
      return;
    }
    setStaffRemovalError("");
    setPendingStaffRemoval((current) =>
      current
        ? {
            ...current,
            confirmPhase: "type_name",
          }
        : current,
    );
  };

  const confirmStaffRemoval = async () => {
    if (!pendingStaffRemoval || !activeCompanyId || !canEditCompanySettings) return;
    if (normalizeRoleKey(pendingStaffRemoval.roleId) === "owner") {
      setStaffRemovalError("Owner cannot be removed from the company");
      return;
    }
    if (!namesMatchForConfirmation(pendingStaffRemoval.typedName, pendingStaffRemoval.displayName)) {
      setStaffRemovalError("Type the staff member name exactly to confirm");
      return;
    }
    setStaffRemovalError("");
    const needsRecipient = staffRemovalNeedsRecipient(pendingStaffRemoval);
    const transferTarget = needsRecipient
      ? staff.find((member) => toStr(member.uid) === toStr(pendingStaffRemoval.transferToUid))
      : undefined;
    if (needsRecipient && !transferTarget) {
      setStaffRemovalError("Choose who to transfer their data to");
      return;
    }
    // Off the list straight away, but only really removed (their data handed over, their place in the company gone —
    // neither can be put back afterwards) as the Undo bar goes without Undo being pressed. Undo shows them again.
    const removal = pendingStaffRemoval;
    const companyId = activeCompanyId;
    const at = staff.findIndex((member) => toStr(member.uid) === removal.uid);
    const removedMember = at >= 0 ? staff[at] : undefined;
    const showAgain = () => {
      if (!removedMember) return;
      setStaff((prev) => (prev.some((member) => toStr(member.uid) === removal.uid) ? prev : insertAt(prev, at, removedMember)));
    };
    setStaff((prev) => prev.filter((member) => toStr(member.uid) !== removal.uid));
    setOpenStaffRoleUid((current) => (current === removal.uid ? "" : current));
    setPendingStaffRemoval(null);
    offerUndo(`${removal.displayName} removed`, showAgain, {
      commit: async () => {
        setRemovingStaffUid(removal.uid);
        const result = await removeCompanyMemberDetailed(companyId, removal.uid, {
          transferToUid: toStr(transferTarget?.uid),
          transferToName: toStr(transferTarget?.displayName || transferTarget?.email || transferTarget?.uid),
          // Every kind is sent, on or off, so the server never falls back to its older "projects only" default.
          transfer: transferTarget
            ? removal.transfer
            : (Object.fromEntries(STAFF_REMOVAL_DATA_ROWS.map(({ kind }) => [kind, false])) as Record<MemberRemovalDataKind, boolean>),
        });
        setRemovingStaffUid("");
        if (!result.ok) {
          // (Still in the company, then — back on the list.)
          showAgain();
          setSaveLabel(`Staff removal failed (${result.error || "unknown"})`);
          return;
        }
        const revokeCode = removal.revokeCode;
        if (revokeCode) {
          void revokeTemporaryJoinCode(companyId, revokeCode.key).then(() => setJoinCodesReloadTick((tick) => tick + 1));
        }
        const transferredTotal = Object.values(result.transferred ?? {}).reduce((sum, n) => sum + n, 0);
        const skippedContacts = result.skippedContacts ?? 0;
        const skippedNote = skippedContacts
          ? ` (${skippedContacts} contact${skippedContacts === 1 ? "" : "s"} skipped — already in their contacts)`
          : "";
        setSaveLabel(
          transferredTotal > 0
            ? `Removed ${removal.displayName} and transferred ${transferredTotal} item${transferredTotal === 1 ? "" : "s"}${skippedNote}`
            : `Removed ${removal.displayName}${skippedNote}`,
        );
      },
    });
  };

  const cutlistColumnRows = useMemo(
    () => mergeCutlistColumnOrder(cutlistColumnOrder, cutlistProduction, cutlistInitial),
    [cutlistColumnOrder, cutlistProduction, cutlistInitial],
  );

  const moveRow = <T,>(items: T[], index: number, dir: -1 | 1): T[] => {
    const next = [...items];
    const target = index + dir;
    if (target < 0 || target >= next.length) return next;
    const [picked] = next.splice(index, 1);
    next.splice(target, 0, picked);
    return next;
  };

  const parseSubcategoryNames = (value: string): string[] =>
    String(value || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

  const addItemCategorySubcategory = async (index: number) => {
    const input = await ask.prompt({ title: "Add sub-category", label: "Sub-category name", placeholder: "e.g. Stone" });
    const nextName = String(input || "").trim();
    if (!nextName) return;
    setItemCategories((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const current = parseSubcategoryNames(row.subcategories);
        if (current.some((v) => v.toLowerCase() === nextName.toLowerCase())) {
          return row;
        }
        return { ...row, subcategories: [...current, nextName].join(", ") };
      }),
    );
  };

  const removeItemCategorySubcategory = (index: number, name: string) => {
    const key = String(name || "").toLowerCase();
    const before = itemCategories[index];
    const at = before ? parseSubcategoryNames(before.subcategories).findIndex((v) => v.toLowerCase() === key) : -1;
    const color = before?.subcategoryColors[key];
    setItemCategories((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const current = parseSubcategoryNames(row.subcategories);
        const next = current.filter((v) => v.toLowerCase() !== String(name || "").toLowerCase());
        const subcategoryColors = { ...row.subcategoryColors };
        delete subcategoryColors[String(name || "").toLowerCase()];
        return { ...row, subcategories: next.join(", "), subcategoryColors };
      }),
    );
    if (at < 0) return;
    // Undo: back in its place among the category's sub-categories, with its own colour (if it had one).
    offerUndo(`${toStr(name, "Sub-category")} removed`, () =>
      setItemCategories((prev) =>
        prev.map((row, i) => {
          if (i !== index) return row;
          const current = parseSubcategoryNames(row.subcategories);
          if (current.some((v) => v.toLowerCase() === key)) return row;
          return {
            ...row,
            subcategories: insertAt(current, at, name).join(", "),
            subcategoryColors: color ? { ...row.subcategoryColors, [key]: color } : row.subcategoryColors,
          };
        }),
      ),
    );
  };

  const toggleItemCategoryExpanded = (index: number) => {
    setItemCategoryExpanded((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const toggleStatusSubStagesExpanded = (index: number) => {
    setStatusSubStagesExpanded((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const addStatusSubStage = (index: number) => {
    setStatuses((prev) =>
      prev.map((row, i) => (i === index ? { ...row, subStages: [...(row.subStages ?? []), { name: "", color: "#64748B" }] } : row)),
    );
    setStatusSubStagesExpanded((prev) => ({ ...prev, [index]: true }));
  };

  const updateStatusSubStage = (statusIndex: number, subIndex: number, patch: Partial<SubStageRow>) => {
    setStatuses((prev) =>
      prev.map((row, i) => {
        if (i !== statusIndex) return row;
        const nextSubStages = (row.subStages ?? []).map((sub, j) => (j === subIndex ? { ...sub, ...patch } : sub));
        return { ...row, subStages: nextSubStages };
      }),
    );
  };

  const removeStatusSubStage = (statusIndex: number, subIndex: number) => {
    const removed = statuses[statusIndex]?.subStages?.[subIndex];
    setStatuses((prev) =>
      prev.map((row, i) => {
        if (i !== statusIndex) return row;
        return { ...row, subStages: (row.subStages ?? []).filter((_, j) => j !== subIndex) };
      }),
    );
    if (!removed) return;
    offerUndo(`${toStr(removed.name, "Sub-stage")} removed`, () =>
      setStatuses((prev) => prev.map((row, i) => (i === statusIndex ? { ...row, subStages: insertAt(row.subStages ?? [], subIndex, removed) } : row))),
    );
  };

  // Exclusive within one status's own sub-stages: ticking one un-ticks every other; ticking the
  // already-ticked one un-ticks it (no default set — the sub-board then falls back to "Other" for
  // newly-arriving cards). Never touches other statuses' sub-stages.
  const setDefaultStatusSubStage = (statusIndex: number, subIndex: number) => {
    setStatuses((prev) =>
      prev.map((row, i) => {
        if (i !== statusIndex) return row;
        const wasDefault = Boolean((row.subStages ?? [])[subIndex]?.isDefault);
        const nextSubStages = (row.subStages ?? []).map((sub, j) => ({ ...sub, isDefault: j === subIndex ? !wasDefault : false }));
        return { ...row, subStages: nextSubStages };
      }),
    );
  };

  // Prices are kept as text in the company's currency (e.g. "$1,234.50", "£1,234.50"); everything that
  // reads them strips the symbol back off, so switching currency never breaks saved prices.
  const ensureDollarFormat = (value: string) => {
    const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
    const n = Number(cleaned);
    return formatMoney(Number.isFinite(n) ? n : 0, companyCurrency);
  };

  // A margin as saved: just its number ("25", "12.5"), "" when there's none.
  const percentForSave = (value: string) => {
    const cleaned = String(value || "").replace(/[^0-9.]/g, "");
    const n = Number(cleaned);
    return cleaned && Number.isFinite(n) ? String(n) : "";
  };

  const parseNumberLoose = (value: string) => {
    const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  };

  // A price with its margin on, as a number (computeOutputPrice below formats it).
  const sellAmount = (price: string, marginPercent: string) => parseNumberLoose(price) * (1 + parseNumberLoose(marginPercent) / 100);

  const computeOutputPrice = (price: string, markupPercent: string) => {
    const base = parseNumberLoose(price);
    const markup = parseNumberLoose(markupPercent);
    const out = base * (1 + markup / 100);
    return formatMoney(out, companyCurrency);
  };

  const formatDiscountCurrency = (value: string) => ensureDollarFormat(value);

  const addItemCategoryItem = (index: number) => {
    setItemCategories((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const firstSub = parseSubcategoryNames(row.subcategories)[0] ?? "";
        const nextItems = [...(row.items ?? []), { name: "", description: "", subcategory: firstSub, price: formatMoney(0, companyCurrency), markupPercent: "0" }];
        return { ...row, items: nextItems };
      }),
    );
    setItemCategoryExpanded((prev) => ({ ...prev, [index]: true }));
  };

  const updateItemCategoryItem = (catIndex: number, itemIndex: number, patch: Partial<ItemCategoryItemRow>) => {
    setItemCategories((prev) =>
      prev.map((row, i) => {
        if (i !== catIndex) return row;
        const nextItems = (row.items ?? []).map((it, j) => (j === itemIndex ? { ...it, ...patch } : it));
        return { ...row, items: nextItems };
      }),
    );
  };

  // An item taken out of a category (straight away when it's blank, or once its pop-up's been confirmed) — matched by
  // its name too when it has one, in case the list changed while that pop-up was open.
  const removeItemCategoryItem = (catIndex: number, itemIndex: number, itemName?: string) => {
    const removed = itemCategories[catIndex]?.items?.[itemIndex];
    if (!removed || (itemName !== undefined && removed.name.trim() !== itemName)) return;
    setItemCategories((prev) =>
      prev.map((row, i) => {
        if (i !== catIndex) return row;
        const nextItems = (row.items ?? []).filter((_, j) => j !== itemIndex);
        return { ...row, items: nextItems };
      }),
    );
    offerUndo(`${toStr(removed.name, "Item")} deleted`, () =>
      setItemCategories((prev) => prev.map((row, i) => (i === catIndex ? { ...row, items: insertAt(row.items ?? [], itemIndex, removed) } : row))),
    );
  };


  const toggleProductCollapsed = (index: number) => {
    setProductCollapsed((prev) => ({ ...prev, [index]: !prev[index] }));
  };
  const openProductsSheet = (event: ReactMouseEvent<HTMLElement>) => {
    productsSheetOriginElRef.current = event.currentTarget;
    setProductsSheetOrigin(captureGlassModalOrigin(event));
    setIsProductsSheetOpen(true);
  };
  const addProduct = () => {
    setJobTypes((prev) => [
      ...prev,
      {
        name: "",
        color: PRODUCT_START_COLORS[prev.length % PRODUCT_START_COLORS.length],
        sheetPrices: [{ sheetSize: defaultSheetSizeValue(sheetSizes), pricePerSheet: ensureDollarFormat("0"), marginPercent: "" }],
        type: "",
        edgeTapePrice: "",
        edgeTapeMarginPercent: "",
        lacquerSqmPrice: "",
        lacquerMarginPercent: "",
        miscCharges: [],
      },
    ]);
    // Its row brought into view at the bottom of the sheet.
    window.requestAnimationFrame(() => {
      const rows = document.querySelectorAll("[data-products-sheet-product]");
      rows[rows.length - 1]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };

  const addJobTypeSheetPrice = (index: number) => {
    const defaultSize = sheetSizes.find((s) => s.isDefault) ?? sheetSizes[0];
    const defaultValue = defaultSize ? `${defaultSize.h} x ${defaultSize.w}` : "";
    setJobTypes((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        return { ...row, sheetPrices: [...(row.sheetPrices ?? []), { sheetSize: defaultValue, pricePerSheet: formatMoney(0, companyCurrency), marginPercent: "" }] };
      }),
    );
    setProductCollapsed((prev) => ({ ...prev, [index]: false }));
  };

  const updateJobTypeSheetPrice = (jobTypeIndex: number, sheetPriceIndex: number, patch: Partial<JobTypeSheetPriceRow>) => {
    setJobTypes((prev) =>
      prev.map((row, i) => {
        if (i !== jobTypeIndex) return row;
        const nextRows = (row.sheetPrices ?? []).map((sp, j) => (j === sheetPriceIndex ? { ...sp, ...patch } : sp));
        return { ...row, sheetPrices: nextRows };
      }),
    );
  };

  const updateJobType = (index: number, patch: Partial<JobTypeRow>) => {
    setJobTypes((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const updateJobTypeMiscCharge = (jobTypeIndex: number, chargeIndex: number, patch: Partial<JobTypeMiscChargeRow>) => {
    setJobTypes((prev) =>
      prev.map((row, i) =>
        i === jobTypeIndex ? { ...row, miscCharges: (row.miscCharges ?? []).map((charge, j) => (j === chargeIndex ? { ...charge, ...patch } : charge)) } : row,
      ),
    );
  };

  const removeJobTypeSheetPrice = (jobTypeIndex: number, sheetPriceIndex: number) => {
    const removed = jobTypes[jobTypeIndex]?.sheetPrices?.[sheetPriceIndex];
    setJobTypes((prev) =>
      prev.map((row, i) => {
        if (i !== jobTypeIndex) return row;
        const nextRows = (row.sheetPrices ?? []).filter((_, j) => j !== sheetPriceIndex);
        return { ...row, sheetPrices: nextRows };
      }),
    );
    if (!removed) return;
    offerUndo(`${removed.sheetSize ? sheetSizeLabel(removed.sheetSize) : "Sheet size"} removed`, () =>
      setJobTypes((prev) =>
        prev.map((row, i) => (i === jobTypeIndex ? { ...row, sheetPrices: insertAt(row.sheetPrices ?? [], sheetPriceIndex, removed) } : row)),
      ),
    );
  };

  // A misc charge taken off a product.
  const removeJobTypeMiscCharge = (jobTypeIndex: number, chargeIndex: number) => {
    const removed = jobTypes[jobTypeIndex]?.miscCharges?.[chargeIndex];
    if (!removed) return;
    setJobTypes((prev) =>
      prev.map((row, i) => (i === jobTypeIndex ? { ...row, miscCharges: (row.miscCharges ?? []).filter((_, j) => j !== chargeIndex) } : row)),
    );
    offerUndo(`${toStr(removed.name, "Charge")} removed`, () =>
      setJobTypes((prev) =>
        prev.map((row, i) => (i === jobTypeIndex ? { ...row, miscCharges: insertAt(row.miscCharges ?? [], chargeIndex, removed) } : row)),
      ),
    );
  };

  const moveRowTo = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
    const next = [...items];
    if (fromIndex < 0 || fromIndex >= next.length) return next;
    const target = Math.max(0, Math.min(next.length - 1, toIndex));
    if (fromIndex === target) return next;
    const [picked] = next.splice(fromIndex, 1);
    next.splice(target, 0, picked);
    return next;
  };

  const toggleRolePermission = (roleIndex: number, permissionKey: string) => {
    setRoles((prev) =>
      prev.map((role, idx) => {
        if (idx !== roleIndex) return role;
        const has = role.permissions.includes(permissionKey);
        return {
          ...role,
          permissions: has ? role.permissions.filter((p) => p !== permissionKey) : [...role.permissions, permissionKey],
        };
      }),
    );
  };

  const activeRoleModal = activeRoleModalIndex !== null ? roles[activeRoleModalIndex] ?? null : null;
  const activeRoleIsProtected = isProtectedStarterRole(activeRoleModal?.id || activeRoleModal?.name);
  const shouldRenderRoleModal = useGlassModalPopOrigin(
    activeRoleModalIndex !== null,
    roleModalOrigin,
    roleModalPanelRef,
    undefined,
    roleModalOriginElRef,
  );
  const activeMachine = activeMachineModalId !== null ? machines.find((m) => m.id === activeMachineModalId) ?? null : null;
  const shouldRenderMachineModal = useGlassModalPopOrigin(
    activeMachineModalId !== null,
    machineModalOrigin,
    machineModalPanelRef,
    undefined,
    machineModalOriginElRef,
  );
  // Updates one field on whichever machine is currently open in the modal — every field in that
  // modal goes through this, same "patch the active record by id" shape the rest of this file's
  // list+modal pairs (e.g. roles, above) use via index instead, since machines are looked up by id
  // (stable even if the list gets reordered/filtered) rather than array position.
  const updateActiveMachine = (patch: Partial<Machine> | ((m: Machine) => Partial<Machine>)) => {
    setMachines((prev) =>
      prev.map((m) => (m.id === activeMachineModalId ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m)),
    );
  };
  // Something taken off the open machine (a service entry, an edgebanding rule): its Undo puts it back on that same
  // machine — found by its id, so it still lands there once the pop-up's been closed or another machine opened.
  const removeFromActiveMachine = (message: string, remove: (m: Machine) => Partial<Machine>, putBack: (m: Machine) => Partial<Machine>) => {
    const machineId = activeMachineModalId;
    if (machineId === null) return;
    updateActiveMachine(remove);
    offerUndo(message, () => setMachines((prev) => prev.map((m) => (m.id === machineId ? { ...m, ...putBack(m) } : m))));
  };
  // Clears the flag on every OTHER machine of the SAME type first — at most one default per type,
  // ever. Used both from the modal (a toggle on the active machine) and the list row (a quick-set
  // star/badge) — see each call site's own comment.
  const setMachineAsDefault = (id: string) => {
    setMachines((prev) => {
      const target = prev.find((m) => m.id === id);
      if (!target) return prev;
      return prev.map((m) => (m.type === target.type ? { ...m, isDefaultForType: m.id === id } : m));
    });
  };
  const shouldRenderItemCategoryDeleteModal = useGlassModalPopOrigin(
    Boolean(pendingItemCategoryDelete),
    itemCategoryDeleteOrigin,
    itemCategoryDeletePanelRef,
    undefined,
    itemCategoryDeleteOriginElRef,
  );
  const shouldRenderTagDeleteModal = useGlassModalPopOrigin(
    Boolean(pendingTagDelete),
    tagDeleteOrigin,
    tagDeletePanelRef,
    undefined,
    tagDeleteOriginElRef,
  );
  const shouldRenderOwnerTransferModal = useGlassModalPopOrigin(
    Boolean(pendingOwnerTransfer),
    ownerTransferOrigin,
    ownerTransferPanelRef,
    undefined,
    ownerTransferOriginElRef,
  );
  const shouldRenderStaffRemovalModal = useGlassModalPopOrigin(
    Boolean(pendingStaffRemoval),
    staffRemovalOrigin,
    staffRemovalPanelRef,
    undefined,
    staffRemovalOriginElRef,
  );
  const shouldRenderAddStaffModal = useGlassModalPopOrigin(addStaffOpen, addStaffOrigin, addStaffPanelRef, undefined, addStaffOriginElRef);
  const shouldRenderItemCategoriesModal = useGlassModalPopOrigin(
    isItemCategoriesModalOpen,
    itemCategoriesModalOrigin,
    itemCategoriesModalPanelRef,
    undefined,
    itemCategoriesModalOriginElRef,
  );
  const shouldRenderProductsSheet = useGlassModalPopOrigin(
    isProductsSheetOpen,
    productsSheetOrigin,
    productsSheetPanelRef,
    undefined,
    productsSheetOriginElRef,
  );
  const shouldRenderSpecsTemplateResetConfirmModal = useGlassModalPopOrigin(
    isSpecsTemplateResetConfirmOpen,
    specsTemplateResetConfirmOrigin,
    specsTemplateResetConfirmPanelRef,
    undefined,
    specsTemplateResetConfirmOriginElRef,
  );
  const shouldRenderQuoteTemplateResetConfirmModal = useGlassModalPopOrigin(
    isQuoteTemplateResetConfirmOpen,
    quoteTemplateResetConfirmOrigin,
    quoteTemplateResetConfirmPanelRef,
    undefined,
    quoteTemplateResetConfirmOriginElRef,
  );
  const shouldRenderCalendarAccessModal = useGlassModalPopOrigin(
    calendarAccessIndex !== null,
    calendarAccessOrigin,
    calendarAccessPanelRef,
    undefined,
    calendarAccessOriginElRef,
  );
  const activeCalendarCategory = calendarAccessIndex !== null ? calendarCategories[calendarAccessIndex] ?? null : null;
  // What a non-admin role gets on a calendar category when nothing has been set for it: View.
  const DEFAULT_CALENDAR_LEVEL: CalendarAccessLevel = "view";
  const calendarLevelFor = (category: CalendarCategory, role: RoleRow): CalendarAccessLevel =>
    category.access?.[normalizeRoleKey(role.id || role.name)] ?? DEFAULT_CALENDAR_LEVEL;
  const setCalendarLevel = (role: RoleRow, level: CalendarAccessLevel) => {
    const key = normalizeRoleKey(role.id || role.name);
    setCalendarCategories((prev) =>
      prev.map((cat, i) => {
        if (i !== calendarAccessIndex) return cat;
        const access = { ...(cat.access ?? {}) };
        // The default (View) is stored as "no override".
        if (level === DEFAULT_CALENDAR_LEVEL) delete access[key];
        else access[key] = level;
        return { ...cat, access };
      }),
    );
  };
  const openCalendarAccess = (idx: number, e: ReactMouseEvent<HTMLElement>) => {
    calendarAccessOriginElRef.current = e.currentTarget;
    setCalendarAccessOrigin(captureGlassModalOrigin(e));
    setCalendarAccessIndex(idx);
  };
  const zapierWebhookBaseUrl = appOrigin ? `${appOrigin}/api/leads` : "";
  const existingZapierWebhookSecret = useMemo(() => {
    const integrations =
      company && typeof company.integrations === "object"
        ? (company.integrations as Record<string, unknown>)
        : {};
    const zapierDoc =
      integrations.zapierLeads && typeof integrations.zapierLeads === "object"
        ? (integrations.zapierLeads as Record<string, unknown>)
        : {};
    return toStr(zapierDoc.webhookSecret);
  }, [company]);
  const zapierWebhookUrl = useMemo(() => {
    if (!zapierWebhookBaseUrl || !activeCompanyId || !zapierLeads.webhookSecret) return "";
    const params = new URLSearchParams({
      companyId: activeCompanyId,
      token: zapierLeads.webhookSecret,
    });
    return `${zapierWebhookBaseUrl}?${params.toString()}`;
  }, [activeCompanyId, zapierLeads.webhookSecret, zapierWebhookBaseUrl]);
  const leadFieldLayoutForSave = (): LeadFieldLayoutRow[] =>
    leadFieldsLoadedFor === activeCompanyId ? mergedLeadFieldLayout : zapierLeads.fieldLayout;
  const mergedLeadFieldLayout = useMemo(
    () => mergeLeadFieldLayout(availableLeadFields, zapierLeads.fieldLayout),
    [availableLeadFields, zapierLeads.fieldLayout],
  );

  // The lead fields come from the company's leads (up to 500), so they're only loaded once the
  // Integrations section is opened — not every time Company Settings opens.
  useEffect(() => {
    if (active !== "integrations" || !activeCompanyId || leadFieldsLoadedFor === activeCompanyId) return;
    const run = async () => {
      setLeadFieldsLoading(true);
      try {
        const response = await authorizedFetch(`/api/leads?companyId=${encodeURIComponent(activeCompanyId)}`, {
          method: "GET",
          cache: "no-store",
        });
        const detail = (await response.json().catch(() => null)) as
          | { ok?: boolean; leads?: Array<{ rawFields?: Record<string, unknown> }> }
          | null;
        const nextFields: Array<{ key: string; label: string }> = [];
        const seen = new Set<string>();
        for (const lead of Array.isArray(detail?.leads) ? detail!.leads : []) {
          for (const key of Object.keys(lead?.rawFields ?? {})) {
            const normalized = normalizeLeadFieldKey(key);
            if (!normalized || RESERVED_LEAD_FIELD_KEYS.has(normalized) || key.startsWith("__") || seen.has(normalized)) {
              continue;
            }
            seen.add(normalized);
            nextFields.push({ key, label: formatLeadFieldLabel(key) });
          }
        }
        setAvailableLeadFields(nextFields);
        setLeadFieldsLoadedFor(activeCompanyId);
      } catch {
        setAvailableLeadFields([]);
      } finally {
        setLeadFieldsLoading(false);
      }
    };
    void run();
  }, [active, activeCompanyId, leadFieldsLoadedFor]);

  // The company doc's completion bonus fields (lib/completion-bonus.ts).
  const completionBonusPatch = {
    bonusPeriodMonths,
    completedPeriodStartMonth: bonusStartMonth,
    bonusPaidMonthsAfter,
    bonusMinimumQuote: Number.parseFloat(bonusMinimumQuote.replace(/[^\d.]/g, "")) > 0 ? Number.parseFloat(bonusMinimumQuote.replace(/[^\d.]/g, "")) : null,
  };

  // Backup & Output › Full data export (lib/company-export.ts): as it goes, and what it saved (or that it failed).
  const [companyExportProgress, setCompanyExportProgress] = useState<CompanyExportProgress | null>(null);
  const [companyExportResult, setCompanyExportResult] = useState<{ ok: boolean; counts?: Record<string, number> } | null>(null);
  const runCompanyExport = async () => {
    if (!activeCompanyId || companyExportProgress) return;
    setCompanyExportResult(null);
    setCompanyExportProgress({ step: "Starting", done: 0, total: 0 });
    try {
      const counts = await downloadCompanyExport(activeCompanyId, toStr(form.name), setCompanyExportProgress);
      setCompanyExportResult({ ok: true, counts });
    } catch {
      setCompanyExportResult({ ok: false });
    }
    setCompanyExportProgress(null);
  };

  const downloadBackupSnapshot = () => {
    const snapshot = {
      companyId: activeCompanyId,
      exportedAtIso: new Date().toISOString(),
      settings: {
        form,
        statuses,
        completionBonus: { bonusPeriodMonths, bonusStartMonth, bonusPaidMonthsAfter, bonusMinimumQuote },
        projectTagUsage,
        boardThicknesses,
        boardFinishes,
        sheetSizes,
        roles,
        itemCategories,
        specsTemplateGrid,
        quoteGridTemplate,
        salesJobTypes: jobTypes,
        salesQuoteHelpers: quoteHelpers,
        salesQuoteDiscountTiers: discountTiers,
        salesMinusOffQuoteTotal: minusOffQuoteTotal,
        salesExtraCharges: extraCharges,
        salesAllowReopenForEditing,
        salesGstEnabled,
        salesGstPercent,
        backupTemplate,
        hardware,
        nesting,
        cutlistColumnsByContext: {
          production: cutlistProduction,
          initialMeasure: cutlistInitial,
        },
        cutlistColumnOrder,
        productionUnlockPasswordSuffix: unlockSuffix,
        productionUnlockDurationHours: unlockHours,
      },
    };

    try {
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cutsmart-settings-${activeCompanyId || "company"}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
      setSaveLabel("Backup JSON exported");
    } catch {
      setSaveLabel("Backup export failed");
    }
  };

  const updateHardwareJsonList = (
    hardwareIndex: number,
    key: "drawersJson" | "hingesJson" | "otherJson",
    updater: (items: Array<Record<string, unknown>>) => Array<Record<string, unknown>>,
  ) => {
    setHardware((prev) =>
      sanitizeHardwareRows(prev.map((row, idx) => {
        if (idx !== hardwareIndex) return row;
        const list = parseJsonObjects(String(row[key] || "[]"));
        const nextList = key === "drawersJson" ? sanitizeDrawerDefaults(updater(list)) : updater(list);
        return { ...row, [key]: stringifyJsonObjects(nextList) };
      })),
    );
  };

  // A drawer type, hinge or other part taken off a brand — and its Undo, putting it back in the same place.
  const removeHardwareJsonItem = (hardwareIndex: number, key: "drawersJson" | "hingesJson" | "otherJson", itemIndex: number, fallbackName: string) => {
    const removed = parseJsonObjects(String(hardware[hardwareIndex]?.[key] || "[]"))[itemIndex];
    if (!removed) return;
    updateHardwareJsonList(hardwareIndex, key, (items) => items.filter((_, i) => i !== itemIndex));
    offerUndo(`${toStr(removed.name, fallbackName)} removed`, () => updateHardwareJsonList(hardwareIndex, key, (items) => insertAt(items, itemIndex, removed)));
  };

  const toggleHardwareExpanded = (index: number) => {
    setHardwareExpanded((prev) => ({ ...prev, [index]: !(prev[index] ?? false) }));
  };

  const toggleDrawerRowExpanded = (hardwareIndex: number, drawerIndex: number) => {
    const key = `${hardwareIndex}:${drawerIndex}`;
    setDrawerRowExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
  };

  const onUploadCompanyLogo = async (file: File | null) => {
    if (!file || !activeCompanyId || !canEditCompanySettings) return;
    const client = storage;
    if (!client) {
      setSaveLabel("Save failed (storage-unavailable)");
      return;
    }
    setIsUploadingLogo(true);
    try {
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "png";
      const safeExt = String(ext || "png").replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "png";
      const nextPath = `companies/${activeCompanyId}/branding/logo_${Date.now()}.${safeExt}`;
      const uploadRef = storageRef(client, nextPath);
      await uploadBytes(uploadRef, file, { contentType: file.type || "image/png" });
      const nextUrl = await getDownloadURL(uploadRef);

      const result = await saveCompanyDocPatchDetailed(activeCompanyId, {
        logoPath: nextUrl,
      });
      if (!result.ok) {
        setSaveLabel(`Save failed (${result.error || "logo-save-failed"})`);
        return;
      }

      setForm((prev) => ({ ...prev, logoPath: nextUrl }));
      setCompany((prev) => (prev ? { ...prev, logoPath: nextUrl } : prev));
      setSaveLabel("Saved");
      // The previous logo's file is kept: quotes, specifications and their PDFs and sent copies can still
      // have its address in a cell (deleting it showed them a broken image) — they show the new logo
      // anyway (withCurrentCompanyLogo in lib/specs-grid-types.ts).
    } catch (error) {
      setSaveLabel(
        isFirebaseStorageQuotaExceeded(error)
          ? getFirebaseStorageQuotaExceededMessage("Logo")
          : "Save failed (logo-upload-failed)",
      );
    } finally {
      setIsUploadingLogo(false);
      if (logoFileInputRef.current) {
        logoFileInputRef.current.value = "";
      }
    }
  };

  // Board colour memory's counts are live — incremented/decremented from the
  // project page whenever a board colour row is added/removed on a job.
  // Deleting a row here must fetch a fresh copy immediately before saving
  // (like the project page's own sync functions do) rather than reusing the
  // `boardColourMemory` snapshot this page loaded at mount, otherwise this
  // delete could revert counts changed elsewhere since this page opened. Every write here goes
  // through patchBoardColourMemory: `update` is handed that fresh copy and returns it changed.
  const patchBoardColourMemory = async (update: (rows: BoardColourMemoryRow[]) => BoardColourMemoryRow[], failCode: string) => {
    if (!activeCompanyId) return;
    try {
      const fresh = await fetchCompanyDoc(activeCompanyId);
      const freshRows = update(normalizeBoardColourMemory(fresh?.boardMaterialUsage));
      const result = await saveCompanyDocPatchDetailed(activeCompanyId, {
        boardMaterialUsage: {
          colours: freshRows.map((row) => ({
            value: row.value,
            count: Number(row.count || 0),
            edgings: row.edgings.map((edging) => ({ value: edging.value, count: Number(edging.count || 0) })),
          })),
        },
      });
      if (!result.ok) {
        setSaveLabel(`Save failed (${result.error || failCode})`);
      }
    } catch {
      setSaveLabel(`Save failed (${failCode})`);
    }
  };

  // Its Undo writes it back the same way, once the delete itself has gone through — with the count
  // and edgings the fresh copy had for it, unless a project has recorded that colour again since.
  const onDeleteBoardColourMemoryRow = async (value: string) => {
    if (!activeCompanyId || !canEditCompanySettings) return;
    const targetValue = toStr(value);
    if (!targetValue) return;
    const at = boardColourMemory.findIndex((row) => row.value === targetValue);
    let removed = boardColourMemory[at];
    let freshAt = at;
    setBoardColourMemory((prev) => prev.filter((row) => row.value !== targetValue));
    const deleted = patchBoardColourMemory((rows) => {
      const i = rows.findIndex((row) => row.value === targetValue);
      if (i >= 0) {
        removed = rows[i];
        freshAt = i;
      }
      return rows.filter((row) => row.value !== targetValue);
    }, "board-colour-remove-failed");
    if (removed) {
      offerUndo(`${targetValue} removed`, async () => {
        await deleted;
        const back = removed;
        const putBack = (rows: BoardColourMemoryRow[], index: number) => (rows.some((row) => row.value === targetValue) ? rows : insertAt(rows, index, back));
        setBoardColourMemory((prev) => putBack(prev, at));
        await patchBoardColourMemory((rows) => putBack(rows, freshAt), "board-colour-restore-failed");
      });
    }
    await deleted;
  };

  // Same fetch-fresh-then-patch reasoning as onDeleteBoardColourMemoryRow above — an edging's
  // count is also live, bumped from the project page whenever a board row's edging changes. Its
  // Undo too: back on its colour (if that's still there) once the delete has gone through.
  const onDeleteBoardEdgingMemoryRow = async (colourValue: string, edgingValue: string) => {
    if (!activeCompanyId || !canEditCompanySettings) return;
    const targetColour = toStr(colourValue);
    const targetEdging = toStr(edgingValue);
    if (!targetColour || !targetEdging) return;
    const colourRow = boardColourMemory.find((row) => row.value === targetColour);
    const at = colourRow ? colourRow.edgings.findIndex((edging) => edging.value === targetEdging) : -1;
    let removed = at >= 0 ? colourRow?.edgings[at] : undefined;
    let freshAt = at;
    const withoutIt = (row: BoardColourMemoryRow) =>
      row.value === targetColour ? { ...row, edgings: row.edgings.filter((edging) => edging.value !== targetEdging) } : row;
    setBoardColourMemory((prev) => prev.map(withoutIt));
    const deleted = patchBoardColourMemory((rows) => {
      const freshColour = rows.find((row) => row.value === targetColour);
      const i = freshColour ? freshColour.edgings.findIndex((edging) => edging.value === targetEdging) : -1;
      if (freshColour && i >= 0) {
        removed = freshColour.edgings[i];
        freshAt = i;
      }
      return rows.map(withoutIt);
    }, "board-edging-remove-failed");
    if (removed) {
      offerUndo(`${targetEdging} removed`, async () => {
        await deleted;
        const back = removed;
        if (!back) return;
        const putBack = (rows: BoardColourMemoryRow[], index: number) =>
          rows.map((row) =>
            row.value === targetColour && !row.edgings.some((edging) => edging.value === targetEdging)
              ? { ...row, edgings: insertAt(row.edgings, index, back) }
              : row,
          );
        setBoardColourMemory((prev) => putBack(prev, at));
        await patchBoardColourMemory((rows) => putBack(rows, freshAt), "board-edging-restore-failed");
      });
    }
    await deleted;
  };

  const save = async (mode: "manual" | "auto" = "manual") => {
    if (!activeCompanyId || isSaving || !canEditCompanySettings) return;
    if (mode === "manual") {
      hasPendingBlurSaveRef.current = false;
      saveQueuedWhileBusyRef.current = false;
    }
    setIsSaving(true);
    const existingTagRows = normalizeProjectTagUsage((company?.projectTagUsage as unknown) ?? []);
    const nextTagSet = new Set(projectTagUsage.map((row) => toStr(row.value).toLowerCase()).filter(Boolean));
    const removedTags = Array.from(
      new Set(
        existingTagRows
          .map((row) => toStr(row.value))
          .filter((value) => value && !nextTagSet.has(value.toLowerCase())),
      ),
    );
    if (removedTags.length > 0) {
      const removedOk = await removeTagsFromCompanyProjects(activeCompanyId, removedTags);
      if (!removedOk) {
        setIsSaving(false);
        setSaveLabel("Save failed (tags-remove-failed)");
        return;
      }
    }
    const hardwareForSave = sanitizeHardwareRows(hardware);
    const result = await saveCompanyDocPatchDetailed(activeCompanyId, {
      name: form.name,
      companyName: form.name,
      applicationPreferences: {
        ...((company?.applicationPreferences as Record<string, unknown> | undefined) ?? {}),
        companyName: form.name,
      },
      defaultCurrency: form.defaultCurrency,
      measurementUnit: form.measurementUnit,
      dateFormat: form.dateFormat,
      timeZone: form.timeZone,
      themeColor: form.themeColor,
      logoPath: form.logoPath,
      projectStatuses: statuses.map((row, idx) => ({
        id: toStr(row.name, `status_${idx + 1}`).toLowerCase().replace(/\s+/g, "_"),
        name: toStr(row.name),
        color: toStr(row.color, "#64748B"),
        // Saved on every row, on or off — once any row has it, only the ones switched on count as
        // completed (see completedStatusMatcher in lib/project-archive.ts).
        isComplete: Boolean(row.isComplete),
        isWon: Boolean(row.isWon),
        subStages: (row.subStages ?? [])
          .map((sub) => ({ name: toStr(sub.name), color: toStr(sub.color, "#64748B"), isDefault: Boolean(sub.isDefault) }))
          .filter((sub) => sub.name),
      })),
      leadStatuses: leadStatuses.map((row, idx) => ({
        id: toStr(row.name, `lead_status_${idx + 1}`).toLowerCase().replace(/\s+/g, "_"),
        name: toStr(row.name),
        color: toStr(row.color, "#64748B"),
      })),
      smallJobStatuses: smallJobStatuses
        .map((row, idx) => ({
          id: toStr(row.name, `small_job_status_${idx + 1}`).toLowerCase().replace(/\s+/g, "_"),
          name: toStr(row.name),
          color: toStr(row.color, "#64748B"),
        }))
        .filter((row) => row.name),
      leadForms: normalizeLeadForms(leadForms),
      ...completionBonusPatch,
      projectTagUsage: {
        tags: projectTagUsage
          .map((row) => {
            const value = toStr(row.value);
            if (!value) return null;
            return { value, count: Number(row.count || 0) };
          })
          .filter(Boolean),
      },
      // boardMaterialUsage is deliberately excluded here — it's a live usage
      // counter incremented/decremented from the project page whenever a
      // board colour row is added/removed, using a fresh-fetch-then-patch so
      // concurrent edits from different tabs/sessions don't clobber each
      // other. Including it in this form's general save patch would write
      // back whatever stale snapshot was loaded when this settings page was
      // opened, silently reverting any counts changed elsewhere in the
      // meantime (that was the actual bug — no field-name mismatch, no
      // missing call, just this page stomping the live counters on every
      // save). The only edit this page offers (deleting a row) now goes
      // through its own dedicated fetch-then-patch call instead.
      boardThicknesses: boardThicknesses.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0),
      boardFinishes: boardFinishes.map((v) => toStr(v)).filter(Boolean),
      contractors: contractors.map((v) => toStr(v)).filter(Boolean),
      roomNames: Array.from(new Set(roomNames.map((v) => toStr(v)).filter(Boolean))),
      sheetSizes: sheetSizes
        .map((r) => ({ h: Number(r.h), w: Number(r.w), isDefault: r.isDefault }))
        .filter((r) => Number.isFinite(r.h) && Number.isFinite(r.w) && r.h > 0 && r.w > 0),
      partTypes: partTypes
        .map((row) => {
          const name = toStr(row.name);
          if (!name) return null;
          const category: PartTypeCategory =
            row.category === "cabinetry" || row.category === "drawer" || row.category === "door" || row.category === "panel" || row.category === "extra" || row.category === "custom"
              ? row.category
              : "";
            return {
              name,
              color: toStr(row.color, "#7D99B3"),
              category,
              kind: category,
              cabinetry: category === "cabinetry",
              drawer: category === "drawer",
              door: category === "door",
              panel: category === "panel",
              extra: category === "extra",
              custom: category === "custom",
              autoClashLeft: toStr(row.autoClashLeft),
              autoClashRight: toStr(row.autoClashRight),
              initialMeasure: Boolean(row.initialMeasure),
              inCutlists: Boolean(row.inCutlists),
              inNesting: Boolean(row.inNesting),
          };
        })
        .filter(Boolean),
      calendarWorkdays,
      calendarEventRetention: calendarRetention,
      projectArchiveAfter,
      calendarShowToClientDefault,
      calendarShowNonWorkdays,
      calendarHolidayRegion,
      calendarCategories: calendarCategories
        .map((row) => ({
          id: toStr(row.id) || newCalendarId("cat"),
          name: toStr(row.name),
          color: toStr(row.color, "#7D99B3"),
          ...(row.access && Object.keys(row.access).length ? { access: row.access } : {}),
        }))
        .filter((row) => row.name),
      contactCategories: withStaffContactCategory(contactCategories, (name, color) => ({ name, color }))
        .map((row) => {
          const name = toStr(row.name);
          if (!name) return null;
          return { name, color: toStr(row.color, "#7D99B3") };
        })
        .filter(Boolean),
      nestingSettings: {
        sheetHeight: Number(nesting.sheetHeight || 2440),
        sheetWidth: Number(nesting.sheetWidth || 1220),
        kerf: Number(nesting.kerf || 5),
        margin: Number(nesting.margin || 10),
        minPieceSize: Number(nesting.minPieceSize || 100),
      },
      cutlistColumnsByContext: {
        production: cutlistProduction.filter(Boolean),
        initialMeasure: cutlistInitial.filter(Boolean),
        order: cutlistColumnRows,
      },
      cutlistColumnOrder: cutlistColumnRows,
      cutlistColumns: cutlistProduction.filter(Boolean),
      edgebandingSettings: {
        addToTotalRules: edgebandingRules
          .map((r) => ({
            upToMeters: Number(toStr(r.upToMeters).replace(/,/g, "")),
            addMeters: Number(toStr(r.addMeters).replace(/,/g, "")),
          }))
          .filter((r) => Number.isFinite(r.upToMeters) && Number.isFinite(r.addMeters) && r.upToMeters > 0 && r.addMeters > 0),
        excessPerEndMm: (() => {
          const n = Number(toStr(edgebandingExcessPerEndMm).replace(/,/g, ""));
          return Number.isFinite(n) && n > 0 ? n : 0;
        })(),
        roundEnabled: Boolean(edgebandingRoundEnabled),
        roundDirection: edgebandingRoundDirection === "down" ? "down" : "up",
        roundNearestMeters: (() => {
          const n = Number(toStr(edgebandingRoundNearestMeters).replace(/,/g, ""));
          return Number.isFinite(n) && n > 0 ? n : 0;
        })(),
      },
      machines: machines.map(serializeMachineForSave),
      gapAllowancesSettings: {
        baseBelowBenchToTopOfDoorDrawer: toStr(gapAllowances.baseBelowBenchToTopOfDoorDrawer),
        baseHorizontalGapNormalHandles: toStr(gapAllowances.baseHorizontalGapNormalHandles),
        baseHorizontalGapWrapOverHandles: toStr(gapAllowances.baseHorizontalGapWrapOverHandles),
        baseVerticalGapDoorsPanels: toStr(gapAllowances.baseVerticalGapDoorsPanels),
        tallTopOfDoorToTopWithScribers: toStr(gapAllowances.tallTopOfDoorToTopWithScribers),
        tallTopOfDoorToTopNoScribers: toStr(gapAllowances.tallTopOfDoorToTopNoScribers),
        tallVerticalGapDoorsPanels: toStr(gapAllowances.tallVerticalGapDoorsPanels),
      },
      productionUnlockPasswordSuffix: unlockSuffix.replace(/\D/g, ""),
      productionUnlockDurationHours: Number(unlockHours || 6),
      roles: roles
        .map((row) => {
          const id = normalizeRoleKey(row.id || row.name);
          const name = toStr(row.name);
          if (!id || !name) return null;
          const perms: Record<string, boolean> = {};
          for (const p of row.permissions.map((v) => toStr(v)).filter(Boolean)) perms[p] = true;
          return { id, name, color: toStr(row.color, "#7D99B3"), permissions: perms };
        })
        .filter(Boolean),
      itemCategories: itemCategories
        .map((row) => {
          const name = toStr(row.name);
          if (!name) return null;
          const subcategories = row.subcategories
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
            .map((nameVal) => ({ name: nameVal, color: toStr(row.subcategoryColors?.[nameVal.toLowerCase()], toStr(row.color, "#7D99B3")) }));
          const items = (row.items ?? [])
            .map((item) => {
              const itemName = toStr(item.name);
              if (!itemName) return null;
              return {
                name: itemName,
                description: toStr(item.description),
                subcategory: toStr(item.subcategory),
                price: ensureDollarFormat(toStr(item.price, "$0.00")),
                markupPercent: toStr(item.markupPercent, "0"),
                ...(item.customPrice ? { customPrice: true } : {}),
              };
            })
            .filter(Boolean);
          return { name, color: toStr(row.color, "#7D99B3"), subcategories, items };
        })
        .filter(Boolean),
      // specsTemplateGrid is deliberately excluded here — it has its own small, isolated,
      // independently-debounced write (onSpecsTemplateChange) so a continuously-edited template
      // doesn't force this whole (large) combined settings save to re-fire on every edit.
      // quoteGridTemplate follows the exact same pattern (onQuoteTemplateChange) and is excluded
      // for the same reason.
      salesJobTypes: jobTypes
        .map((row) => {
          const name = toStr(row.name);
          if (!name) return null;
          const sheetPrices = (row.sheetPrices ?? [])
            .map((sp) => ({
              sheetSize: toStr(sp.sheetSize),
              pricePerSheet: ensureDollarFormat(toStr(sp.pricePerSheet, "$0.00")),
              marginPercent: percentForSave(sp.marginPercent),
            }))
            .filter((sp) => sp.sheetSize || sp.pricePerSheet);
          return {
            name,
            color: toStr(row.color),
            pricePerSheet: toStr(sheetPrices[0]?.pricePerSheet),
            sheetSize: toStr(sheetPrices[0]?.sheetSize),
            sheetPrices,
            // Every product shows in Sales now (the old per-product switch is gone) — kept for anything still reading it.
            showInSales: true,
            type: row.type,
            edgeTapePrice: toStr(row.edgeTapePrice) ? ensureDollarFormat(row.edgeTapePrice) : "",
            edgeTapeMarginPercent: percentForSave(row.edgeTapeMarginPercent),
            lacquerSqmPrice: toStr(row.lacquerSqmPrice) ? ensureDollarFormat(row.lacquerSqmPrice) : "",
            lacquerMarginPercent: percentForSave(row.lacquerMarginPercent),
            miscCharges: (row.miscCharges ?? [])
              .map((charge) => ({
                name: toStr(charge.name),
                price: toStr(charge.price) ? ensureDollarFormat(charge.price) : "",
                marginPercent: percentForSave(charge.marginPercent),
              }))
              .filter((charge) => charge.name || charge.price),
          };
        })
        .filter(Boolean),
      salesQuoteHelpers: quoteHelpers
        .map((row) => {
          const content = sanitizeQuoteRichTextMarkup(toStr(row.content));
          if (!content.trim()) return null;
          return {
            id: toStr(row.id),
            content,
          };
        })
        .filter(Boolean),
      salesQuoteDiscountTiers: discountTiers
        .map((row) => ({ low: toStr(row.low), high: toStr(row.high), discount: toStr(row.discount) }))
        .filter((row) => row.low && row.high && row.discount),
      salesMinusOffQuoteTotal: Boolean(minusOffQuoteTotal),
      salesExtraCharges: extraCharges
        .filter((row) => row.name.trim())
        .map((row) => ({ id: row.id, name: row.name.trim(), price: toStr(row.price), isDefault: Boolean(row.isDefault) })),
      salesAllowReopenForEditing: Boolean(salesAllowReopenForEditing),
      salesGstEnabled: Boolean(salesGstEnabled),
      salesGstPercent: Math.max(0, parseNumberLoose(salesGstPercent)),
      integrations: {
        ...(((company as Record<string, unknown> | null)?.integrations as Record<string, unknown> | undefined) ?? {}),
        zapierLeads: {
          enabled: Boolean(zapierLeads.enabled),
          webhookSecret: toStr(zapierLeads.webhookSecret, existingZapierWebhookSecret),
          fieldLayout: leadFieldLayoutForSave().map((row, idx) => ({
            key: row.key,
            label: row.label,
            showInRow: Boolean(row.showInRow),
            showInDetail: Boolean(row.showInDetail),
            order: Number.isFinite(Number(row.order)) ? Number(row.order) : idx,
            projectFieldTarget: row.projectFieldTarget || "",
          })),
        },
      },
      quoteTemplateHeaderHtml: toStr(backupTemplate.quoteTemplateHeaderHtml),
      quoteTemplateFooterHtml: toStr(backupTemplate.quoteTemplateFooterHtml),
      quoteTemplatePageSize: toStr(backupTemplate.quoteTemplatePageSize, "A4"),
      quoteTemplateMarginMm: Number(backupTemplate.quoteTemplateMarginMm || 10),
      quoteTemplateFooterPinBottom: Boolean(backupTemplate.quoteTemplateFooterPinBottom),
      hardwareSettings: hardwareForSave
        .map((row, idx) => {
          const name = toStr(row.name);
          if (!name) return null;
          return {
            name,
            color: toStr(row.color, "#7D99B3"),
            default: Boolean(row.default),
            drawers: trimHardwareItemNames(parseJsonList(row.drawersJson)),
            hinges: trimHardwareItemNames(parseJsonList(row.hingesJson)),
            other: trimHardwareItemNames(parseJsonList(row.otherJson)),
            ...(toStr(row.cartCopyFormat) ? { cartCopyFormat: toStr(row.cartCopyFormat) } : {}),
            order: idx,
          };
        })
        .filter(Boolean),
    });
    const ok = result.ok;
    setSaveLabel(ok ? (mode === "auto" ? "Autosaved" : "Saved") : "Save failed");
    if (!ok && result.error) {
      setSaveLabel(`Save failed (${result.error})`);
    }
    if (ok) {
        // Roles changed since they were last saved: noted in the audit log, by whoever saved them.
        const rolesBefore = savedRolesRef.current;
        savedRolesRef.current = roles;
        if (rolesBefore) {
          const by = { uid: toStr(user?.uid), name: toStr(user?.displayName || user?.email, "Someone") };
          const entries = describeRoleChanges(rolesBefore, roles, readablePermission).map((text) => newRoleAuditEntry(text, by));
          if (entries.length) {
            void appendRoleAudit(activeCompanyId, entries).then((next) => {
              if (next) setRoleAuditLog(next);
            });
          }
        }
        // This save includes `roles` (permission definitions) — anyone whose effective
        // permissions come from a role affected by this change needs a fresh lookup, not a
        // stale cached one from before the save.
        invalidateCompanyAccessCache({ companyId: activeCompanyId });
        invalidateCompanyRoleOverridesCache(activeCompanyId);
        setCompany((prev) => ({
          ...(prev ?? {}),
          ...form,
        projectStatuses: statuses,
        leadStatuses,
        smallJobStatuses,
        leadForms,
        ...completionBonusPatch,
        projectTagUsage: { tags: projectTagUsage },
        boardThicknesses,
        boardFinishes,
        contractors,
        roomNames,
        sheetSizes,
        partTypes,
        nestingSettings: nesting,
        cutlistColumnsByContext: { production: cutlistProduction, initialMeasure: cutlistInitial, order: cutlistColumnRows },
        cutlistColumnOrder: cutlistColumnRows,
        cutlistColumns: cutlistProduction,
        edgebandingSettings: {
          addToTotalRules: edgebandingRules,
          excessPerEndMm: edgebandingExcessPerEndMm,
          roundEnabled: edgebandingRoundEnabled,
          roundDirection: edgebandingRoundDirection,
          roundNearestMeters: edgebandingRoundNearestMeters,
        },
        gapAllowancesSettings: gapAllowances,
        productionUnlockPasswordSuffix: unlockSuffix,
        productionUnlockDurationHours: unlockHours,
        roles,
        itemCategories,
        specsTemplateGrid,
        quoteGridTemplate,
        salesJobTypes: jobTypes,
          salesQuoteHelpers: quoteHelpers,
          salesQuoteDiscountTiers: discountTiers,
          salesMinusOffQuoteTotal: minusOffQuoteTotal,
          salesExtraCharges: extraCharges
            .filter((row) => row.name.trim())
            .map((row) => ({ id: row.id, name: row.name.trim(), price: toStr(row.price), isDefault: Boolean(row.isDefault) })),
          salesAllowReopenForEditing,
          salesGstEnabled: Boolean(salesGstEnabled),
          salesGstPercent: Math.max(0, parseNumberLoose(salesGstPercent)),
          integrations: {
            ...((((prev ?? {}) as Record<string, unknown>).integrations as Record<string, unknown> | undefined) ?? {}),
            zapierLeads: {
              enabled: Boolean(zapierLeads.enabled),
              webhookSecret: toStr(zapierLeads.webhookSecret, existingZapierWebhookSecret),
              fieldLayout: leadFieldLayoutForSave().map((row, idx) => ({
                key: row.key,
                label: row.label,
                showInRow: Boolean(row.showInRow),
                showInDetail: Boolean(row.showInDetail),
                order: Number.isFinite(Number(row.order)) ? Number(row.order) : idx,
                projectFieldTarget: row.projectFieldTarget || "",
              })),
            },
          },
          quoteTemplateHeaderHtml: backupTemplate.quoteTemplateHeaderHtml,
        quoteTemplateFooterHtml: backupTemplate.quoteTemplateFooterHtml,
        quoteTemplatePageSize: backupTemplate.quoteTemplatePageSize,
        quoteTemplateMarginMm: backupTemplate.quoteTemplateMarginMm,
        quoteTemplateFooterPinBottom: backupTemplate.quoteTemplateFooterPinBottom,
        hardwareSettings: hardwareForSave,
      }));
    }
    setIsSaving(false);
    if (saveQueuedWhileBusyRef.current) {
      saveQueuedWhileBusyRef.current = false;
      if (hasPendingBlurSaveRef.current) {
        triggerBlurAutoSave();
      }
    }
  };

  useEffect(() => {
    return () => {
      if (blurAutoSaveTimerRef.current != null) {
        window.clearTimeout(blurAutoSaveTimerRef.current);
      }
    };
  }, []);

  // Mobile pull-down gesture's "Save & Back" zone (app-shell.tsx) — kept in a ref since
  // save is recreated every render and the effect below should only re-register once.
  const saveRef = useRef(save);
  saveRef.current = save;
  isSavingLatestRef.current = isSaving;
  useEffect(() => {
    setSaveAndBackHandler(async () => {
      await saveRef.current("manual");
      router.back();
    });
    return () => setSaveAndBackHandler(null);
  }, [router, setSaveAndBackHandler]);

  const triggerBlurAutoSave = () => {
    if (!isHydrated || isLoading || !activeCompanyId || !canEditCompanySettings) {
      return;
    }
    // Mid-drag: waits for the drop (the change stays pending — endRowDrag saves it).
    if (isRowDraggingRef.current) return;
    if (!hasPendingBlurSaveRef.current) {
      return;
    }
    if (isSaving) {
      saveQueuedWhileBusyRef.current = true;
      return;
    }
    if (blurAutoSaveTimerRef.current != null) {
      window.clearTimeout(blurAutoSaveTimerRef.current);
    }
    setSaveLabel("Autosaving...");
    blurAutoSaveTimerRef.current = window.setTimeout(() => {
      hasPendingBlurSaveRef.current = false;
      // saveRef, not the `save` captured by this render: by the time this fires the change that
      // scheduled it has re-rendered, and that newer save carries it.
      void saveRef.current("auto");
    }, 120);
  };

  const triggerBlurAutoSaveRef = useRef(triggerBlurAutoSave);
  triggerBlurAutoSaveRef.current = triggerBlurAutoSave;
  // Text fields anywhere on the page (including inside its pop-ups, which portal outside <main>) save
  // when they lose focus. The Specs/Quote layout builders keep their own isolated saves.
  useEffect(() => {
    const onFocusOut = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || el.closest('[data-specs-layout-modal="true"], [data-quote-layout-modal="true"]')) return;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable) {
        if (hasPendingBlurSaveRef.current) triggerBlurAutoSaveRef.current();
      }
    };
    document.addEventListener("focusout", onFocusOut);
    return () => document.removeEventListener("focusout", onFocusOut);
  }, []);

  // Row dragging everywhere on this page uses the same "grab and swing" ghost as dragging a project on
  // the Leads / Dashboard boards (lib/use-drag-ghost.tsx): the native drag image is swapped for the
  // floating glass pill, which grows out of the row being dragged. The rows' own live reorder-on-
  // dragEnter logic is unchanged.
  const rowDragGhost = useDragGhost();
  const startRowDrag = (e: React.DragEvent<HTMLElement>, originId: string, label: string, color?: string) => {
    isRowDraggingRef.current = true;
    e.dataTransfer.effectAllowed = "move";
    const img = rowDragGhost.transparentImageRef.current;
    if (img) e.dataTransfer.setDragImage(img, 0, 0);
    rowDragGhost.spawn(e, originId, { label: label.trim() || "Untitled", color: color || "var(--brand)" });
  };
  // Dropped (or let go anywhere): the new order is saved now, once.
  const endRowDrag = () => {
    rowDragGhost.end();
    if (!isRowDraggingRef.current) return;
    isRowDraggingRef.current = false;
    if (hasPendingBlurSaveRef.current) triggerBlurAutoSaveRef.current();
  };
  const ask = useGlassPrompt();
  // Removing a hardware brand asks first; removing anything shows the Undo bar (components/undo-bar.tsx).
  const confirmRemove = useGlassConfirm();
  const offerUndo = useUndo();
  // A row taken off one of this page's plain lists (rooms, statuses, charges…): its Undo puts the same row back where
  // it was — and the page's autosave picks that up, as it did the removal.
  const removeFromList = <T,>(setList: React.Dispatch<React.SetStateAction<T[]>>, index: number, item: T, message: string) => {
    setList((prev) => prev.filter((_, i) => i !== index));
    offerUndo(message, () => setList((prev) => insertAt(prev, index, item)));
  };
  // A tag's delete, done once its Undo bar has gone without Undo: off every project using it (the part that can't be
  // put back), then off the company's list. Written to the company here rather than left to this page's own save, so
  // it's still done if the page has been left by then.
  const commitTagDelete = async (companyId: string, value: string) => {
    const key = value.toLowerCase();
    const isIt = (row: TagUsageRow) => toStr(row.value).toLowerCase() === key;
    const removedOk = companyId ? await removeTagsFromCompanyProjects(companyId, [value]) : false;
    setHiddenTagKeys((prev) => prev.filter((k) => k !== key));
    if (!removedOk) {
      setSaveLabel("Save failed (tags-remove-failed)");
      return;
    }
    setProjectTagUsage((prev) => prev.filter((row) => !isIt(row)));
    // (So this page's own save sees it's already gone, rather than taking it off every project again.)
    setCompany((prev) => (prev ? { ...prev, projectTagUsage: { tags: normalizeProjectTagUsage(prev.projectTagUsage).filter((row) => !isIt(row)) } } : prev));
    try {
      const fresh = await fetchCompanyDoc(companyId);
      const tags = normalizeProjectTagUsage(fresh?.projectTagUsage)
        .filter((row) => !isIt(row))
        .map((row) => ({ value: row.value, count: Number(row.count || 0) }));
      const result = await saveCompanyDocPatchDetailed(companyId, { projectTagUsage: { tags } });
      if (!result.ok) setSaveLabel(`Save failed (${result.error || "tags-remove-failed"})`);
    } catch {
      setSaveLabel("Save failed (tags-remove-failed)");
    }
  };

  // The company's chosen unit/currency, for every length and price shown on this page.
  const companyUnit = normalizeMeasurementUnit(form.measurementUnit);
  const companyCurrency = normalizeCurrencyCode(form.defaultCurrency);
  const companyDateFormat = normalizeDateFormat(form.dateFormat);
  // Apply format changes to the whole app straight away (prices, lengths and dates everywhere).
  useEffect(() => {
    if (!isHydrated || isLoading) return;
    setActiveCompanyFormats({ currency: companyCurrency, unit: companyUnit, dateFormat: companyDateFormat });
  }, [companyCurrency, companyDateFormat, companyUnit, isHydrated, isLoading]);

  const triggerAutosaveAfterRowDrop = () => {
    hasPendingBlurSaveRef.current = true;
    triggerBlurAutoSave();
  };

  const triggerToggleAutosave = () => {
    hasPendingBlurSaveRef.current = true;
    triggerBlurAutoSave();
  };

  // The Specs Layout template gets its own small, isolated, independently-debounced write instead of
  // going through the page's big combined save() — that function re-uploads every settings field
  // (item categories, quote helpers, board finishes, all of it) on every debounced save, which for a
  // continuously-edited spreadsheet meant repeatedly re-sending the whole settings document and
  // exhausting Firestore's write queue. Writing only this one field, on a longer 2s debounce, keeps
  // each write small and infrequent regardless of how fast someone types.
  const onSpecsTemplateChange = (data: SpecsGrid) => {
    if (!canEditCompanySettings) return;
    setSpecsTemplateGrid(data);
    if (specsTemplateSaveTimeoutRef.current) clearTimeout(specsTemplateSaveTimeoutRef.current);
    specsTemplateSaveTimeoutRef.current = setTimeout(() => {
      if (!activeCompanyId) return;
      void saveCompanyDocPatchDetailed(activeCompanyId, { specsTemplateGrid: data }).then((result) => {
        if (!result.ok) {
          console.error("Specs template save failed:", result.error);
          setSpecsTemplateSaveError(result.error || "unknown-save-error");
        } else {
          setSpecsTemplateSaveError("");
        }
      });
    }, 2000);
  };

  // Explicit, deliberate reset (confirmed via its own popup) — saves immediately rather than on the
  // usual 2s debounce, since there's no reason to delay persisting a state the user just confirmed.
  // Its Undo puts the template back as it was, saved straight away the same way.
  const writeSpecsTemplateNow = (grid: SpecsGrid | null) => {
    if (specsTemplateSaveTimeoutRef.current) clearTimeout(specsTemplateSaveTimeoutRef.current);
    setSpecsTemplateGrid(grid);
    setSpecsTemplateEditorKey((prev) => prev + 1);
    if (activeCompanyId) {
      void saveCompanyDocPatchDetailed(activeCompanyId, { specsTemplateGrid: grid }).then((result) => {
        if (!result.ok) {
          console.error(grid ? "Specs template undo failed:" : "Specs template reset failed:", result.error);
          setSpecsTemplateSaveError(result.error || "unknown-save-error");
        } else {
          setSpecsTemplateSaveError("");
        }
      });
    }
  };
  const resetSpecsTemplate = () => {
    if (!canEditCompanySettings) return;
    const before = specsTemplateGrid;
    writeSpecsTemplateNow(null);
    setIsSpecsTemplateResetConfirmOpen(false);
    offerUndo("Specs template reset", () => writeSpecsTemplateNow(before));
  };

  // Quote Layout's own isolated, independently-debounced write — same reasoning as Specs Layout's
  // above (a continuously-edited template must never ride along on the page's big combined save()).
  const onQuoteTemplateChange = (data: SpecsGrid) => {
    if (!canEditCompanySettings) return;
    setQuoteGridTemplate(data);
    if (quoteTemplateSaveTimeoutRef.current) clearTimeout(quoteTemplateSaveTimeoutRef.current);
    quoteTemplateSaveTimeoutRef.current = setTimeout(() => {
      if (!activeCompanyId) return;
      void saveCompanyDocPatchDetailed(activeCompanyId, { quoteGridTemplate: data }).then((result) => {
        if (!result.ok) {
          console.error("Quote template save failed:", result.error);
          setQuoteTemplateSaveError(result.error || "unknown-save-error");
        } else {
          setQuoteTemplateSaveError("");
        }
      });
    }, 2000);
  };
  // Reset (and its Undo) as the Specs one is.
  const writeQuoteTemplateNow = (grid: SpecsGrid | null) => {
    if (quoteTemplateSaveTimeoutRef.current) clearTimeout(quoteTemplateSaveTimeoutRef.current);
    setQuoteGridTemplate(grid);
    setQuoteTemplateEditorKey((prev) => prev + 1);
    if (activeCompanyId) {
      void saveCompanyDocPatchDetailed(activeCompanyId, { quoteGridTemplate: grid }).then((result) => {
        if (!result.ok) {
          console.error(grid ? "Quote template undo failed:" : "Quote template reset failed:", result.error);
          setQuoteTemplateSaveError(result.error || "unknown-save-error");
        } else {
          setQuoteTemplateSaveError("");
        }
      });
    }
  };
  const resetQuoteTemplate = () => {
    if (!canEditCompanySettings) return;
    const before = quoteGridTemplate;
    writeQuoteTemplateNow(null);
    setIsQuoteTemplateResetConfirmOpen(false);
    offerUndo("Quote template reset", () => writeQuoteTemplateNow(before));
  };

  // Temporary — moves a template between companies by hand: download it as JSON from one
  // company's builder, upload that same file into another company's. Same Blob/anchor pattern as
  // downloadBackupSnapshot above, just scoped to one grid instead of the whole settings document.
  const downloadSpecsTemplate = () => {
    try {
      const blob = new Blob([JSON.stringify(specsTemplateGrid ?? createEmptyGrid(), null, 2)], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cutsmart-specs-template-${activeCompanyId || "company"}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setSpecsTemplateSaveError("download-failed");
    }
  };
  const downloadQuoteTemplate = () => {
    try {
      const blob = new Blob([JSON.stringify(quoteGridTemplate ?? createEmptyGrid(), null, 2)], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cutsmart-quote-template-${activeCompanyId || "company"}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setQuoteTemplateSaveError("download-failed");
    }
  };
  // Validated via the same normalizeSpecsGrid used to load a template from Firestore, so a
  // malformed/unrelated JSON file can't get saved as a broken template — it just reports an error
  // and leaves the current template untouched.
  const uploadSpecsTemplateFile = async (file: File | null) => {
    if (!file || !canEditCompanySettings || !activeCompanyId) return;
    try {
      const parsed = JSON.parse(await file.text());
      const normalized = normalizeSpecsGrid(parsed);
      if (!normalized) {
        setSpecsTemplateSaveError("invalid-template-file");
        return;
      }
      if (specsTemplateSaveTimeoutRef.current) clearTimeout(specsTemplateSaveTimeoutRef.current);
      setSpecsTemplateGrid(normalized);
      setSpecsTemplateEditorKey((prev) => prev + 1);
      const result = await saveCompanyDocPatchDetailed(activeCompanyId, { specsTemplateGrid: normalized });
      setSpecsTemplateSaveError(result.ok ? "" : result.error || "unknown-save-error");
    } catch {
      setSpecsTemplateSaveError("invalid-template-file");
    }
  };
  const uploadQuoteTemplateFile = async (file: File | null) => {
    if (!file || !canEditCompanySettings || !activeCompanyId) return;
    try {
      const parsed = JSON.parse(await file.text());
      const normalized = normalizeSpecsGrid(parsed);
      if (!normalized) {
        setQuoteTemplateSaveError("invalid-template-file");
        return;
      }
      if (quoteTemplateSaveTimeoutRef.current) clearTimeout(quoteTemplateSaveTimeoutRef.current);
      setQuoteGridTemplate(normalized);
      setQuoteTemplateEditorKey((prev) => prev + 1);
      const result = await saveCompanyDocPatchDetailed(activeCompanyId, { quoteGridTemplate: normalized });
      setQuoteTemplateSaveError(result.ok ? "" : result.error || "unknown-save-error");
    } catch {
      setQuoteTemplateSaveError("invalid-template-file");
    }
  };

  useEffect(() => {
    if (!isHydrated || isLoading || !activeCompanyId) return;
    const nextSignature = JSON.stringify({
      companyId: activeCompanyId,
      enabled: Boolean(zapierLeads.enabled),
      webhookSecret: String(zapierLeads.webhookSecret || ""),
    });
    if (skipFirstZapierPersistEffectRef.current) {
      skipFirstZapierPersistEffectRef.current = false;
      lastZapierPersistSignatureRef.current = nextSignature;
      return;
    }
    if (lastZapierPersistSignatureRef.current === nextSignature) {
      return;
    }
    lastZapierPersistSignatureRef.current = nextSignature;
    if (blurAutoSaveTimerRef.current != null) {
      window.clearTimeout(blurAutoSaveTimerRef.current);
      blurAutoSaveTimerRef.current = null;
    }
    if (isSaving) {
      hasPendingBlurSaveRef.current = true;
      saveQueuedWhileBusyRef.current = true;
      setSaveLabel("Autosaving...");
      return;
    }
    hasPendingBlurSaveRef.current = false;
    setSaveLabel("Autosaving...");
    void save("auto");
  }, [activeCompanyId, isHydrated, isLoading, zapierLeads.enabled, zapierLeads.webhookSecret]);

  // Contact Categories save themselves shortly after any change (name, colour, add, delete) instead of
  // waiting on the Save button or an unrelated input's blur. Debounced so typing a name isn't one write
  // per keystroke; goes through saveRef so the write carries the latest state, and retries while a
  // previous save is still in flight (save() itself silently no-ops when it's busy).
  useEffect(() => {
    if (!isHydrated || isLoading || !activeCompanyId) return;
    const nextSignature = JSON.stringify({
      companyId: activeCompanyId,
      categories: contactCategories.map((row) => [toStr(row.name), toStr(row.color)]).filter(([name]) => name),
    });
    if (skipFirstContactCategoriesPersistEffectRef.current) {
      skipFirstContactCategoriesPersistEffectRef.current = false;
      lastContactCategoriesPersistSignatureRef.current = nextSignature;
      return;
    }
    if (lastContactCategoriesPersistSignatureRef.current === nextSignature) return;
    lastContactCategoriesPersistSignatureRef.current = nextSignature;
    if (contactCategoriesPersistTimerRef.current != null) {
      window.clearTimeout(contactCategoriesPersistTimerRef.current);
    }
    setSaveLabel("Autosaving...");
    const attempt = () => {
      contactCategoriesPersistTimerRef.current = null;
      if (isSavingLatestRef.current) {
        contactCategoriesPersistTimerRef.current = window.setTimeout(attempt, 300);
        return;
      }
      hasPendingBlurSaveRef.current = false;
      void saveRef.current("auto");
    };
    contactCategoriesPersistTimerRef.current = window.setTimeout(attempt, 500);
  }, [activeCompanyId, contactCategories, isHydrated, isLoading]);

  // Leaving the page inside the debounce window must not drop the pending category change: flush it
  // (save carries the latest state via saveRef) instead of just clearing the timer.
  useEffect(() => {
    return () => {
      if (contactCategoriesPersistTimerRef.current != null) {
        window.clearTimeout(contactCategoriesPersistTimerRef.current);
        contactCategoriesPersistTimerRef.current = null;
        if (!isSavingLatestRef.current) void saveRef.current("auto");
      }
    };
  }, []);

  useEffect(() => {
    if (!isHydrated || isLoading || !activeCompanyId) return;
    if (skipFirstDirtyEffectRef.current) {
      skipFirstDirtyEffectRef.current = false;
      return;
    }
    hasPendingBlurSaveRef.current = true;
    setSaveLabel("Unsaved changes");
    // Glass dropdowns, switches, colour circles, drag-reorders and add/remove buttons aren't text
    // fields, so there's no blur to save on — save them now. Typing in a text field still waits for
    // that field's blur (see the focusout listener below) so it isn't one write per keystroke.
    const focused = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    const typing = Boolean(focused && (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA" || focused.isContentEditable));
    if (!typing) triggerBlurAutoSaveRef.current();
  }, [
    isHydrated,
    isLoading,
    activeCompanyId,
    form,
    statuses,
    leadStatuses,
    smallJobStatuses,
    leadForms,
    bonusPeriodMonths,
    bonusStartMonth,
    bonusPaidMonthsAfter,
    bonusMinimumQuote,
    calendarCategories,
    calendarWorkdays,
    calendarRetention,
    projectArchiveAfter,
    calendarShowToClientDefault,
    calendarShowNonWorkdays,
    calendarHolidayRegion,
    projectTagUsage,
    boardThicknesses,
    boardFinishes,
    contractors,
    roomNames,
    sheetSizes,
    partTypes,
    roles,
    itemCategories,
    jobTypes,
      quoteHelpers,
      discountTiers,
      minusOffQuoteTotal,
      extraCharges,
      salesAllowReopenForEditing,
      salesGstEnabled,
      salesGstPercent,
      zapierLeads,
      backupTemplate,
    hardware,
    nesting,
    cutlistProduction,
    cutlistInitial,
    cutlistColumnOrder,
    edgebandingRules,
    edgebandingExcessPerEndMm,
    edgebandingRoundEnabled,
    edgebandingRoundDirection,
    edgebandingRoundNearestMeters,
    unlockSuffix,
    unlockHours,
  ]);

  // Sales › Rooms and Production › Rooms: the same list in both.
  const renderRoomNamesPanel = () => (
    <Panel
      title="Rooms"
      icon={DoorOpen}
      description="Room names to pick from when adding a room to a project, and in the offline cutlist template — drag to set their order. Shared by Sales and Production."
    >
      <div className="space-y-1.5">
        {roomNames.map((value, idx) => (
          <div
            key={`room_name_${idx}`}
            id={`settings_room_name_${idx}`}
            className="flex items-center gap-2"
            style={{ opacity: roomNameDragIndex === idx ? 0.45 : 1 }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              if (roomNameDragIndex == null || roomNameDragIndex === idx) return;
              setRoomNames((prev) => moveRowTo(prev, roomNameDragIndex, idx));
              setRoomNameDragIndex(idx);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setRoomNameDragIndex(null);
              endRowDrag();
              triggerAutosaveAfterRowDrop();
            }}
          >
            <button
              type="button"
              draggable
              onDragStart={(e) => {
                setRoomNameDragIndex(idx);
                startRowDrag(e, `settings_room_name_${idx}`, value || "Room", "#64748B");
              }}
              onDragEnd={() => {
                setRoomNameDragIndex(null);
                endRowDrag();
              }}
              className={gripClass}
              title="Drag to reorder"
            >
              <GripVertical size={15} />
            </button>
            <input
              value={value}
              placeholder="e.g. Kitchen"
              onChange={(e) => setRoomNames((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))}
              className={fieldInputClass}
            />
            <button
              type="button"
              onClick={() => removeFromList(setRoomNames, idx, value, `${toStr(value, "Room")} removed`)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
              style={{ color: "var(--text-muted)" }}
              title="Remove"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setRoomNames((prev) => [...prev, ""])} className={chipAddClass}>
          <Plus size={14} /> Add room
        </button>
      </div>
    </Panel>
  );

  return (
    <>
        {access.status === "loading" ? (
          <SkeletonGroup label="Checking access" className="grid w-full grid-cols-1 gap-[18px] lg:grid-cols-[264px_minmax(0,1fr)]">
            <div className="space-y-3 rounded-[20px] border border-[var(--glass-border)] p-3.5 max-lg:hidden">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-9 w-full rounded-[10px]" />
              {[70, 56, 64, 48, 60, 52].map((width) => (
                <Skeleton key={width} className="h-3.5" style={{ width: `${width}%` }} />
              ))}
            </div>
            <div className="space-y-[18px]">
              <div className="flex items-center gap-3.5 px-1 pt-1">
                <Skeleton className="h-[46px] w-[46px] shrink-0 rounded-[14px]" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="mt-2 h-3 w-72 max-w-full" />
                </div>
              </div>
              <div className="rounded-[20px] border border-[var(--glass-border)] px-4 py-2">
                {[44, 58, 36, 50].map((width) => (
                  <div key={width} className="flex items-center justify-between gap-3 border-b border-[var(--glass-border)] py-3.5 last:border-b-0">
                    <Skeleton className="h-3" style={{ width: `${width}%` }} />
                    <Skeleton className="h-8 w-32 rounded-[10px]" />
                  </div>
                ))}
              </div>
            </div>
          </SkeletonGroup>
        ) : access.status === "error" ? (
          <div
            className="rounded-[16px] border p-6 text-[13px] font-semibold"
            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
          >
            <p>Couldn&apos;t check your access to Company Settings — the connection may be slow or offline.</p>
            <button
              type="button"
              onClick={() => access.retry()}
              className="mt-3 inline-flex h-9 items-center rounded-[8px] border px-3 text-[12px] font-semibold hover:brightness-95"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-muted)" }}
            >
              Retry
            </button>
          </div>
        ) : !canAccessCompanySettings ? (
          <div
            className="rounded-[16px] border p-6 text-[13px] font-semibold"
            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
          >
            You do not have permission to access Company Settings.
          </div>
        ) : (
        <div
          className="flex flex-col bg-transparent"
          style={{
            marginLeft: "calc(-1 * max(12px, env(safe-area-inset-left)))",
            marginRight: "calc(-1 * max(12px, env(safe-area-inset-right)))",
          }}
        >
          {/* Not centred: on a wide screen a centred max-width left a big empty band between the app's
              sidebar and this page. The outer padding equals the gap between cards (18px) so every
              gap on the page — sidebar edge, rail to content, card to card — is the same.
              grid-cols-1 (= minmax(0,1fr)) below desktop: an implicit grid column grows to fit its
              widest content, which let the sideways tab strip and wide tables stretch the whole page
              past a phone's screen edge (and so the tab strip never had anything to scroll). */}
          <div className="grid w-full grid-cols-1 gap-[18px] p-3 md:p-[18px] lg:grid-cols-[264px_minmax(0,1fr)]">
            {/* Settings rail: title, search (jumps to any setting), the tabs grouped, and the company info card. */}
            <aside
              className="flex h-fit flex-col gap-3 rounded-[20px] border p-3.5 lg:sticky lg:top-[68px] lg:max-h-[calc(100svh-88px)]"
              style={{
                borderColor: "var(--glass-border)",
                backgroundColor: "var(--glass-bg-strong)",
                backdropFilter: "blur(20px) saturate(180%)",
                WebkitBackdropFilter: "blur(20px) saturate(180%)",
                boxShadow: "inset 0 1px 0 var(--glass-highlight), var(--shadow-glass)",
              }}
            >
              <div className="flex items-center gap-2 px-1.5 pt-0.5 text-[18px] font-bold" style={{ color: "var(--text-main)" }}>
                <Settings size={18} strokeWidth={2.1} />
                Settings
              </div>
              <div ref={searchBoxRef} className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSearchMenuOpen(true);
                  }}
                  onFocus={() => setSearchMenuOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setSearch("");
                    if (e.key === "Enter" && searchResults[0]) goToSearchResult(searchResults[0]);
                  }}
                  placeholder="Search settings..."
                  className={`${glassFieldClass} pl-9`}
                />
                {search.trim() && searchMenuOpen ? (
                  <div
                    className="glass-bubble-pop absolute inset-x-0 top-[calc(100%+6px)] z-[60] max-h-[320px] overflow-auto rounded-[14px] border p-1.5"
                    style={{
                      borderColor: "var(--glass-border)",
                      backgroundColor: "var(--glass-bg-strong)",
                      backdropFilter: "blur(24px) saturate(180%)",
                      WebkitBackdropFilter: "blur(24px) saturate(180%)",
                      boxShadow: "var(--shadow-glass), 0 18px 40px rgba(15,23,42,0.16)",
                    }}
                  >
                    {searchResults.length === 0 ? (
                      <EmptyState compact icon={<Search size={16} />} title="No matches" hint="Try a different search" />
                    ) : (
                      searchResults.map((item) => (
                        <button
                          key={`${item.section}_${item.label}`}
                          type="button"
                          onClick={() => goToSearchResult(item)}
                          className="flex w-full flex-col items-start rounded-[9px] px-2.5 py-2 text-left transition hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)]"
                        >
                          <span className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>{item.label}</span>
                          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                            {sections.find((sec) => sec.key === item.section)?.label}
                            {item.card !== item.label ? ` › ${item.card}` : ""}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
              {/* data-horizontal-swipe-scroll: on phones this strip scrolls sideways, so a sideways swipe on it
                  scrolls it rather than opening the app's side drawers (see AppShell's swipe handling). */}
              <nav
                ref={sectionNavRef}
                data-horizontal-swipe-scroll="true"
                className="-mx-1 flex gap-1 overflow-x-auto overscroll-x-contain px-1 lg:mx-0 lg:min-h-0 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:px-0"
              >
                {sections.map((item, idx) => {
                  const Icon = item.icon;
                  const selected = active === item.key;
                  const showGroup = idx === 0 || sections[idx - 1].group !== item.group;
                  return (
                    <div key={item.key} className="contents">
                      {showGroup ? (
                        <p className="hidden px-2.5 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-[0.8px] first:pt-1 lg:block" style={{ color: "var(--text-muted)" }}>
                          {item.group}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        aria-current={selected ? "page" : undefined}
                        onClick={() => setActive(item.key)}
                        className="inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[11px] px-2.5 py-[9px] text-left text-[13px] font-medium transition hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] lg:w-full"
                        style={
                          selected
                            ? { backgroundImage: "var(--brand-gradient)", color: "#fff", boxShadow: "0 6px 18px rgba(0,100,214,0.28)" }
                            : { color: "var(--text-main)" }
                        }
                      >
                        <span style={{ color: selected ? "#fff" : "var(--text-muted)" }} className="inline-flex">
                          <Icon size={16} strokeWidth={2} />
                        </span>
                        {item.label}
                      </button>
                    </div>
                  );
                })}
              </nav>
            </aside>

            <main
              className="min-w-0 space-y-[18px] pb-6"
              onInputCapture={(e) => {
                const el = e.target as HTMLElement | null;
                const tag = String(el?.tagName || "").toLowerCase();
                // The Specs Layout and Quote Layout modals' own cell color-popovers render real
                // <input> elements (hex text field, native color input) — since React's blur/input
                // event delegation catches events regardless of the modal's fixed positioning, every
                // keystroke/commit in there would otherwise also trigger this page-wide combined-save
                // trigger, on top of (and completely bypassing) each template's own small, isolated,
                // independently-debounced save path.
                if (el?.closest('[data-specs-layout-modal="true"], [data-quote-layout-modal="true"]')) return;
                if (tag === "input" || tag === "textarea" || tag === "select") {
                  hasPendingBlurSaveRef.current = true;
                }
              }}
            >
              {/* Page header: the tab's icon, name and what it's for, plus the save status. Everything
                  saves on its own (fields when you leave them, everything else as you change it). */}
              {(() => {
                const current = sections.find((sec) => sec.key === active) ?? sections[0];
                const Icon = current.icon;
                const failed = saveLabel.toLowerCase().includes("fail");
                const busy = isLoading || isSaving || saveLabel.toLowerCase().includes("autosaving");
                const pending = saveLabel === "Unsaved changes";
                return (
                  <div className="flex flex-wrap items-center gap-3.5 px-1 pt-1">
                    <span
                      className="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[14px] text-white"
                      style={{ backgroundImage: "var(--brand-gradient)", boxShadow: "0 8px 22px rgba(0,100,214,0.3)" }}
                    >
                      <Icon size={22} strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h1 className="text-[24px] font-bold leading-tight tracking-[-0.2px]" style={{ color: "var(--text-main)" }}>{current.label}</h1>
                      <p className="mt-0.5 text-[13px]" style={{ color: "var(--text-muted)" }}>{current.description}</p>
                    </div>
                    {/* The save status keeps one size whatever it says — "Save now" coming and going used to squeeze the
                        title onto more lines (on a phone, a word a line), moving the whole page up and down on every
                        edit. A phone: its own line under the title. Wider: a fixed slot at the right. */}
                    <div className="flex min-h-9 items-center gap-2 max-md:w-full md:w-[270px] md:shrink-0 md:justify-end">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-[7px] text-[12px] font-semibold"
                        style={
                          failed
                            ? { backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }
                            : busy || pending
                              ? { backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }
                              : { backgroundColor: "var(--success-soft)", color: "var(--success)" }
                        }
                      >
                        {failed ? <X size={14} /> : busy ? <Loader2 size={14} className="animate-spin" /> : pending ? <Clock3 size={14} /> : <CheckCircle2 size={14} />}
                        {isLoading ? "Loading..." : failed ? saveLabel : busy ? "Saving..." : pending ? "Unsaved changes" : "All changes saved"}
                      </span>
                      {failed || pending ? (
                        <button type="button" onClick={() => void save()} disabled={isSaving || isLoading} className={primaryButtonClass} style={primaryButtonStyle}>
                          {failed ? "Retry" : "Save now"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })()}
              {active === "company" && (
                <div className="grid gap-[18px] max-lg:grid-cols-1">
                  {!canEditCompanySettings && (
                    <div
                      className="rounded-[14px] border px-3.5 py-2.5 text-[12.5px] font-semibold"
                      style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
                    >
                      Verify your account (in User Settings) to edit Company Settings.
                    </div>
                  )}
                  <Panel title="Company" icon={Building2} description="Your company's details, and the codes people join it with.">
                    <FieldRow label="Company name" hint="Change it under Brand below.">
                      <span className="text-[13.5px] font-semibold" style={{ color: "var(--text-main)" }}>{toStr(company?.name, "Unknown")}</span>
                    </FieldRow>
                    <FieldRow label="Company ID" hint="Quote this if you contact CutSmart support.">
                      <span className="font-mono text-[12.5px]" style={{ color: "var(--text-main)" }}>{toStr(company?.id, activeCompanyId)}</span>
                    </FieldRow>
                    <FieldRow label="Plan">
                      <span className="rounded-full px-2.5 py-0.5 text-[11.5px] font-medium" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}>
                        {toStr(company?.planName, "Free")}
                      </span>
                    </FieldRow>
                    <FieldRow label="Join key" hint="The master code people join with, and one-person Access codes you can revoke.">
                      <button
                        type="button"
                        onClick={() => setJoinCodesOpen(true)}
                        disabled={!canManageJoinCodes || !activeCompanyId}
                        className={secondaryButtonClass}
                        title={canManageJoinCodes ? undefined : "Only people who can add staff can manage join codes"}
                      >
                        <KeyRound size={14} /> Join key
                      </button>
                    </FieldRow>
                  </Panel>
                  {joinCodesOpen ? (
                    <CompanyJoinCodesModal
                      companyId={activeCompanyId}
                      companyName={toStr(company?.name)}
                      data={joinCodes}
                      loading={!joinCodes && !joinCodesError}
                      loadError={joinCodesError}
                      onReload={() => setJoinCodesReloadTick((tick) => tick + 1)}
                      onClose={() => setJoinCodesOpen(false)}
                      onRevokeUsedCode={(record) => void revokeUsedJoinCode(record)}
                      roleFor={accessCodeRoleFor}
                    />
                  ) : null}
                  <Panel title="Brand" icon={Palette} description="How your company appears on quotes, documents and across the app.">
                    <FieldRow label="Company name" hint="Shown on quotes, specs sheets and in the sidebar.">
                      <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} className={`${fieldInputClass} max-w-[380px]`} />
                    </FieldRow>
                    <FieldRow
                      label="Company logo"
                      align="start"
                      hint={
                        <>
                          A PNG or SVG with a transparent background looks best. Shown in the sidebar and on documents.
                          {/* Replace / Remove sit under this text, not over the logo. */}
                          {form.logoPath ? (
                            <span className="mt-2.5 flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={() => logoFileInputRef.current?.click()}
                                disabled={isUploadingLogo || isLoading || !activeCompanyId}
                                className={smallButtonClass}
                              >
                                <Upload size={14} /> {isUploadingLogo ? "Uploading..." : "Replace"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  // (The file itself stays in storage, so Undo only has to point back at it.)
                                  const logoPath = form.logoPath;
                                  setForm((prev) => ({ ...prev, logoPath: "" }));
                                  offerUndo("Logo removed", () => setForm((prev) => ({ ...prev, logoPath })));
                                }}
                                disabled={isUploadingLogo || !canEditCompanySettings}
                                className={smallButtonClass}
                              >
                                <Trash2 size={14} /> Remove
                              </button>
                            </span>
                          ) : null}
                        </>
                      }
                    >
                      <input
                        ref={logoFileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          void onUploadCompanyLogo(file);
                        }}
                      />
                      <div
                        className="relative flex h-[180px] w-full max-w-[440px] items-center justify-center overflow-hidden rounded-[16px] border-2 border-dashed p-5"
                        style={{ borderColor: "color-mix(in srgb, var(--text-main) 16%, transparent)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}
                      >
                        {form.logoPath ? (
                          <img src={form.logoPath} alt="Company logo" className="block max-h-full max-w-full object-contain" />
                        ) : (
                          <button
                            type="button"
                            onClick={() => logoFileInputRef.current?.click()}
                            disabled={isUploadingLogo || isLoading || !activeCompanyId}
                            className="flex flex-col items-center gap-2 text-[13px] font-semibold"
                            style={{ color: "var(--text-muted)" }}
                          >
                            <ImageUp size={28} strokeWidth={1.8} />
                            {isUploadingLogo ? "Uploading..." : "Upload your logo"}
                          </button>
                        )}
                      </div>
                    </FieldRow>
                    <FieldRow label="Theme colour" hint="Used for buttons, highlights and the default colour of new items.">
                      <ThemeColorPicker
                        value={/^#[0-9A-Fa-f]{6}$/.test(form.themeColor) ? form.themeColor : "#2F6BFF"}
                        onChange={(hex) => setForm((prev) => ({ ...prev, themeColor: hex }))}
                        disabled={!canEditCompanySettings}
                      />
                    </FieldRow>
                  </Panel>
                  <Panel
                    title="Regional formats"
                    icon={Globe2}
                    description="Every price, measurement and date across CutSmart — quotes, rooms, cutlists, specs and exports — follows these."
                    allowOverflow
                  >
                    <FieldRow label="Currency" hint="Every price in the app: quotes, rooms, item prices and discounts.">
                      <GlassDropdown
                        value={normalizeCurrencyCode(form.defaultCurrency)}
                        options={CURRENCY_OPTIONS.map((c) => ({ value: c.code, label: c.label }))}
                        onChange={(code) => setForm((prev) => ({ ...prev, defaultCurrency: code }))}
                        ariaLabel="Currency"
                        disabled={!canEditCompanySettings}
                        menuMinWidth={260}
                        triggerClassName={`${fieldInputClass} max-w-[240px] justify-between`}
                      />
                      <span className="inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[12px] font-semibold" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}>
                        <Eye size={14} /> {formatMoney(12450.5, normalizeCurrencyCode(form.defaultCurrency))}
                      </span>
                    </FieldRow>
                    <FieldRow label="Measurement unit" hint="Replaces the fixed “mm” everywhere — cutlists, gap allowances, sheet sizes and machine settings.">
                      <Segmented
                        value={normalizeMeasurementUnit(form.measurementUnit)}
                        options={[
                          { value: "mm", label: "Millimetres (mm)" },
                          { value: "in", label: "Inches (in)" },
                        ]}
                        onChange={(unit) => setForm((prev) => ({ ...prev, measurementUnit: unit }))}
                        disabled={!canEditCompanySettings}
                      />
                      <span className="inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[12px] font-semibold" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}>
                        <Ruler size={14} /> {formatLength(600, normalizeMeasurementUnit(form.measurementUnit))}
                      </span>
                    </FieldRow>
                    <FieldRow label="Date format" hint="How dates appear across projects, quotes, the dashboard and exports.">
                      <GlassDropdown
                        value={normalizeDateFormat(form.dateFormat)}
                        options={DATE_FORMAT_OPTIONS.map((f) => ({ value: f, label: `${f}  ·  ${formatDate(new Date(), f)}` }))}
                        onChange={(next) => setForm((prev) => ({ ...prev, dateFormat: next }))}
                        ariaLabel="Date format"
                        disabled={!canEditCompanySettings}
                        menuMinWidth={260}
                        triggerClassName={`${fieldInputClass} max-w-[240px] justify-between`}
                      />
                      <span className="inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[12px] font-semibold" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}>
                        <CalendarDays size={14} /> {formatDate(new Date(), normalizeDateFormat(form.dateFormat))}
                      </span>
                    </FieldRow>
                  </Panel>
                </div>
              )}

              {active === "materials" && (
                <div className="grid gap-[18px] max-lg:grid-cols-1 xl:grid-cols-2">
                  <Panel title="Sheet thicknesses" icon={Layers3} description="Board thicknesses you can pick when building cutlists. Drag to set their order.">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {boardThicknesses.map((value, idx) => (
                        <span
                          key={idx}
                          className={chipClass}
                          id={`settings_thickness_${idx}`}
                          style={{ opacity: thicknessDragIndex === idx ? 0.45 : 1 }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDragEnter={(e) => {
                            e.preventDefault();
                            if (thicknessDragIndex == null || thicknessDragIndex === idx) return;
                            setBoardThicknesses((prev) => moveRowTo(prev, thicknessDragIndex, idx));
                            setThicknessDragIndex(idx);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setThicknessDragIndex(null);
                            endRowDrag();
                          }}
                        >
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              setThicknessDragIndex(idx);
                              e.dataTransfer.setData("text/plain", `${idx}`);
                              startRowDrag(e, `settings_thickness_${idx}`, activeLength(value));
                            }}
                            onDragEnd={() => {
                              setThicknessDragIndex(null);
                              endRowDrag();
                            }}
                            className="-ml-1.5 inline-flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded-full active:cursor-grabbing"
                            style={{ color: "var(--text-muted)" }}
                            title="Drag to reorder"
                          >
                            <GripVertical size={13} />
                          </button>
                          <LengthField
                            valueMm={value}
                            onChangeMm={(mm) => setBoardThicknesses((prev) => prev.map((v, i) => (i === idx ? mm : v)))}
                            unit={companyUnit}
                            width={72}
                            className="h-7 w-full rounded-full bg-transparent text-[12.5px] font-semibold text-[var(--text-main)] outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => removeFromList(setBoardThicknesses, idx, value, `${value.trim() ? activeLength(value) : "Thickness"} removed`)}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                            style={{ color: "var(--text-muted)" }}
                            title="Remove"
                          >
                            <X size={13} />
                          </button>
                        </span>
                      ))}
                      <button type="button" onClick={() => setBoardThicknesses((prev) => [...prev, ""])} className={chipAddClass}>
                        <Plus size={14} /> Add
                      </button>
                    </div>
                  </Panel>
                  <Panel title="Board finishes" icon={Palette} description="Finishes you can pick for a board. Drag to set their order.">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {boardFinishes.map((value, idx) => (
                        <span
                          key={idx}
                          className={chipClass}
                          id={`settings_finish_${idx}`}
                          style={{ opacity: finishDragIndex === idx ? 0.45 : 1 }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDragEnter={(e) => {
                            e.preventDefault();
                            if (finishDragIndex == null || finishDragIndex === idx) return;
                            setBoardFinishes((prev) => moveRowTo(prev, finishDragIndex, idx));
                            setFinishDragIndex(idx);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setFinishDragIndex(null);
                            endRowDrag();
                          }}
                        >
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              setFinishDragIndex(idx);
                              e.dataTransfer.setData("text/plain", `${idx}`);
                              startRowDrag(e, `settings_finish_${idx}`, value);
                            }}
                            onDragEnd={() => {
                              setFinishDragIndex(null);
                              endRowDrag();
                            }}
                            className="-ml-1.5 inline-flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded-full active:cursor-grabbing"
                            style={{ color: "var(--text-muted)" }}
                            title="Drag to reorder"
                          >
                            <GripVertical size={13} />
                          </button>
                          <input
                            value={value}
                            placeholder="Finish"
                            size={Math.max(5, value.length + 1)}
                            onChange={(e) => setBoardFinishes((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))}
                            className="min-w-0 bg-transparent text-[12.5px] font-semibold outline-none"
                            style={{ color: "var(--text-main)" }}
                          />
                          <button
                            type="button"
                            onClick={() => removeFromList(setBoardFinishes, idx, value, `${toStr(value, "Finish")} removed`)}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                            style={{ color: "var(--text-muted)" }}
                            title="Remove"
                          >
                            <X size={13} />
                          </button>
                        </span>
                      ))}
                      <button type="button" onClick={() => setBoardFinishes((prev) => [...prev, ""])} className={chipAddClass}>
                        <Plus size={14} /> Add
                      </button>
                    </div>
                  </Panel>
                  <Panel title="Sheet sizes" icon={Package2} description="Stock sheet sizes. The default is used for nesting and new products.">
                    <div className="space-y-1.5">
                      {sheetSizes.map((row, idx) => (
                        <div key={idx} className={`${listRowClass} max-sm:flex-wrap`}>
                          <LengthField valueMm={row.h} onChangeMm={(mm) => setSheetSizes((prev) => prev.map((r, i) => (i === idx ? { ...r, h: mm } : r)))} unit={companyUnit} placeholder="Height" width={110} wrapperClassName="max-sm:w-[76px]!" />
                          <span style={{ color: "var(--text-muted)" }}>×</span>
                          <LengthField valueMm={row.w} onChangeMm={(mm) => setSheetSizes((prev) => prev.map((r, i) => (i === idx ? { ...r, w: mm } : r)))} unit={companyUnit} placeholder="Width" width={110} wrapperClassName="max-sm:w-[76px]!" />
                          <span className="flex-1" />
                          <button
                            type="button"
                            onClick={() =>
                              setSheetSizes((prev) => prev.map((r, i) => ({ ...r, isDefault: i === idx ? !r.isDefault : false })))
                            }
                            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11.5px] font-semibold"
                            style={{ color: row.isDefault ? "var(--brand-strong)" : "var(--text-muted)" }}
                            title="Use this size by default"
                          >
                            <span
                              className="inline-flex h-4 w-4 items-center justify-center rounded-full border-[1.5px]"
                              style={{ borderColor: row.isDefault ? "var(--brand)" : "color-mix(in srgb, var(--text-main) 25%, transparent)" }}
                            >
                              {row.isDefault ? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--brand)" }} /> : null}
                            </span>
                            Default
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              removeFromList(
                                setSheetSizes,
                                idx,
                                row,
                                `${row.h.trim() && row.w.trim() ? `${activeLength(row.h, { withUnit: false })} × ${activeLength(row.w)}` : "Sheet size"} removed`,
                              )
                            }
                            className={dangerIconButtonClass}
                            title="Remove"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                      <button type="button" onClick={() => setSheetSizes((prev) => [...prev, { h: "", w: "", isDefault: false }])} className={`${secondaryButtonClass} mt-1.5`}>
                        <Plus size={14} /> Add sheet size
                      </button>
                    </div>
                  </Panel>
                  <Panel title="Board colour memory" icon={Palette} description="Recorded automatically from your cutlists, with the edging tapes used on each colour.">
                    <div className="space-y-1.5">
                      {boardColourMemory.length === 0 ? (
                        <EmptyState compact icon={<Palette size={16} />} title="No colours recorded yet" hint="Colours appear here as they're used in cutlists." />
                      ) : null}
                      {boardColourMemory.map((row, idx) => {
                        const isExpanded = expandedBoardColourMemoryRows.has(row.value);
                        const hasEdgings = row.edgings.length > 0;
                        return (
                          <div key={`board_colour_${idx}`}>
                            <div className={listRowClass}>
                              <button
                                type="button"
                                disabled={!hasEdgings}
                                onClick={() =>
                                  setExpandedBoardColourMemoryRows((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(row.value)) next.delete(row.value);
                                    else next.add(row.value);
                                    return next;
                                  })
                                }
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] disabled:opacity-30"
                                style={{ color: "var(--text-muted)" }}
                                title={hasEdgings ? "Show edging tapes used with this colour" : "No edging tapes recorded yet"}
                              >
                                <ChevronDown size={15} style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms ease" }} />
                              </button>
                              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>{row.value}</span>
                              <span className={countPillClass} title="Times used">{String(row.count || "0")}</span>
                              <button type="button" onClick={() => void onDeleteBoardColourMemoryRow(row.value)} className={dangerIconButtonClass} title="Forget this colour">
                                <X size={15} />
                              </button>
                            </div>
                            {isExpanded && hasEdgings && (
                              <div className="my-1.5 ml-8 grid gap-1 rounded-[12px] border border-dashed p-2 max-sm:ml-3" style={{ borderColor: "color-mix(in srgb, var(--text-main) 16%, transparent)" }}>
                                {row.edgings.map((edging, edgingIdx) => (
                                  <div key={`board_edging_${idx}_${edgingIdx}`} className="flex items-center gap-2 px-1 text-[12.5px]">
                                    <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-main)" }}>{edging.value}</span>
                                    <span className={countPillClass} title="Times used">{String(edging.count || "0")}</span>
                                    <button type="button" onClick={() => void onDeleteBoardEdgingMemoryRow(row.value, edging.value)} className={dangerIconButtonClass} title="Forget this edging">
                                      <X size={14} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Panel>
                </div>
              )}

                {active === "integrations" && (
                  <div className="grid gap-[18px] max-lg:grid-cols-1 xl:grid-cols-2">
                    <Panel
                      title="Zapier Forms"
                      description="Send submissions from any Zapier form straight into your Leads tab."
                      headerRight={
                        <GlassSwitch
                          checked={zapierLeads.enabled}
                          ariaLabel="Zapier Forms"
                          disabled={!canEditCompanySettings}
                          onChange={() => {
                            setConfirmZapierRegenerate(false);
                            setZapierLeads((prev) => ({
                              ...prev,
                              enabled: !prev.enabled,
                              webhookSecret: prev.webhookSecret || generateZapierSecret(),
                            }));
                            triggerToggleAutosave();
                          }}
                        />
                      }
                    >
                      <div className="flex items-start gap-3">
                        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[#FF5A1F] shadow-[0_8px_20px_rgba(255,90,31,0.24)]">
                          <img src="/logos/Zapier-logo.png" alt="Zapier" className="h-6 w-6 object-contain" />
                        </span>
                        <p className="pt-1 text-[12.5px] leading-[1.5]" style={{ color: "var(--text-muted)" }}>
                          {zapierLeads.enabled
                            ? "Connected. Paste the webhook URL below into Zapier's “Webhooks by Zapier → POST” action."
                            : "Turn on to get a webhook URL for Zapier."}
                        </p>
                      </div>
                      {zapierLeads.enabled ? (
                        <div className="mt-3 grid gap-3">
                          <FieldRow label="Webhook URL" hint="Already includes your secure company token — no extra headers needed.">
                            <button
                              type="button"
                              title="Copy webhook URL"
                              onClick={async () => {
                                if (!zapierWebhookUrl) return;
                                try {
                                  await navigator.clipboard.writeText(zapierWebhookUrl);
                                  setZapierCopyStatus("copied");
                                  if (zapierCopyResetTimerRef.current) window.clearTimeout(zapierCopyResetTimerRef.current);
                                  zapierCopyResetTimerRef.current = window.setTimeout(() => {
                                    setZapierCopyStatus("");
                                    zapierCopyResetTimerRef.current = null;
                                  }, 1400);
                                } catch {
                                  setZapierCopyStatus("");
                                }
                              }}
                              className="flex h-9 w-full min-w-0 items-center gap-2 rounded-[11px] border border-dashed px-3 text-left font-mono text-[11.5px] transition"
                              style={{
                                borderColor: zapierCopyStatus === "copied" ? "var(--success-border)" : "color-mix(in srgb, var(--text-main) 18%, transparent)",
                                backgroundColor: zapierCopyStatus === "copied" ? "var(--success-soft)" : "transparent",
                                color: zapierCopyStatus === "copied" ? "var(--success-strong)" : "var(--text-muted)",
                              }}
                            >
                              <Copy size={14} className="shrink-0" />
                              <span className="min-w-0 flex-1 truncate">{zapierCopyStatus === "copied" ? "Copied to clipboard" : zapierWebhookUrl}</span>
                            </button>
                          </FieldRow>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmZapierRegenerate(false);
                                setShowLeadFieldsCustomize(true);
                              }}
                              className={smallButtonClass}
                            >
                              <SlidersHorizontal size={14} /> Customise lead fields
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmZapierRegenerate(false);
                                setShowZapierHelp(true);
                              }}
                              className={smallButtonClass}
                            >
                              <CircleHelp size={14} /> How to connect
                            </button>
                            <button
                              type="button"
                              disabled={!canEditCompanySettings}
                              onClick={() => {
                                if (!confirmZapierRegenerate) {
                                  setConfirmZapierRegenerate(true);
                                  return;
                                }
                                if (zapierCopyResetTimerRef.current) {
                                  window.clearTimeout(zapierCopyResetTimerRef.current);
                                  zapierCopyResetTimerRef.current = null;
                                }
                                setZapierCopyStatus("");
                                setConfirmZapierRegenerate(false);
                                setZapierLeads((prev) => ({ ...prev, webhookSecret: generateZapierSecret() }));
                                triggerToggleAutosave();
                              }}
                              className={smallButtonClass}
                              style={confirmZapierRegenerate ? { backgroundImage: "var(--danger-gradient)", color: "#fff", borderColor: "transparent" } : undefined}
                              title="Makes a new URL — the old one stops working"
                            >
                              <RefreshCw size={14} /> {confirmZapierRegenerate ? "Click again to confirm" : "Regenerate URL"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmZapierRegenerate(false);
                              setShowZapierHelp(true);
                            }}
                            className={smallButtonClass}
                          >
                            <CircleHelp size={14} /> How it works
                          </button>
                        </div>
                      )}
                    </Panel>
                  </div>
              )}

              {active === "nesting" && (
                <div>
                  <Panel title="Machines" icon={Factory} description="Each machine's details, servicing history and cutting settings. The default machine of each type is used when a job doesn't pick one.">
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
                      {machines.map((m) => {
                        const tile = MACHINE_TILE_STYLE[m.type];
                        const TileIcon = tile.icon;
                        return (
                          <div
                            key={m.id}
                            className="group relative grid gap-2.5 rounded-[16px] border p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-glass)]"
                            style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[12px] text-white" style={{ backgroundImage: tile.gradient }}>
                                <TileIcon size={18} />
                              </span>
                              <div className="flex items-center gap-1">
                                {m.type !== "other" ? (
                                  <button
                                    type="button"
                                    onClick={() => setMachineAsDefault(m.id)}
                                    title={m.isDefaultForType ? `Default ${machineTypeLabel(m)}` : `Make this the default ${machineTypeLabel(m)}`}
                                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold transition"
                                    style={
                                      m.isDefaultForType
                                        ? { backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }
                                        : { color: "var(--text-muted)" }
                                    }
                                  >
                                    <Star size={11} fill={m.isDefaultForType ? "currentColor" : "none"} /> {m.isDefaultForType ? "Default" : "Set default"}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const at = machines.findIndex((row) => row.id === m.id);
                                    setMachines((prev) => prev.filter((row) => row.id !== m.id));
                                    offerUndo(`${toStr(m.name, machineTypeLabel(m))} removed`, () =>
                                      setMachines((prev) => (prev.some((row) => row.id === m.id) ? prev : insertAt(prev, Math.max(0, at), m))),
                                    );
                                  }}
                                  className={dangerIconButtonClass}
                                  title="Remove machine"
                                >
                                  <X size={15} />
                                </button>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                machineModalOriginElRef.current = e.currentTarget;
                                setMachineModalOrigin(captureGlassModalOrigin(e));
                                setActiveMachineModalId(m.id);
                              }}
                              className="text-left after:absolute after:inset-0 after:content-['']"
                            >
                              <p className="truncate text-[14px] font-semibold" style={{ color: "var(--text-main)" }}>{toStr(m.name, "Untitled Machine")}</p>
                              <p className="truncate text-[12px]" style={{ color: "var(--text-muted)" }}>
                                {machineTypeLabel(m)}
                                {m.model ? ` · ${m.model}` : ""}
                              </p>
                            </button>
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={(e) => {
                          setAddMachineOrigin(captureGlassModalOrigin(e));
                          setNewMachineTypePickerOpen(true);
                        }}
                        className="flex min-h-[118px] flex-col items-center justify-center gap-1.5 rounded-[16px] border border-dashed text-[13px] font-semibold transition hover:bg-[var(--brand-soft)]"
                        style={{ borderColor: "color-mix(in srgb, var(--text-main) 20%, transparent)", color: "var(--brand-strong)" }}
                      >
                        <Plus size={18} /> Add machine
                      </button>
                    </div>
                  </Panel>
                  {shouldRenderAddMachineModal ? (
                    <ModalPortal>
                    <div className="fixed inset-0 z-[1700] flex items-center justify-center px-4 py-4">
                      <button type="button" aria-label="Cancel" onClick={() => setNewMachineTypePickerOpen(false)} className="glass-modal-backdrop absolute inset-0" />
                      <div ref={addMachinePanelRef} className="glass-modal-panel relative z-[1701] w-full max-w-[520px] overflow-hidden">
                        <GlassModalHeader title="Add machine" onClose={() => setNewMachineTypePickerOpen(false)} />
                        <div className="grid grid-cols-2 gap-2.5 p-4">
                          {([
                            ["cnc", "CNC"],
                            ["table-saw", "Table Saw"],
                            ["edge-bander", "Edge Bander"],
                            ["other", "Other"],
                          ] as [MachineType, string][]).map(([type, label]) => {
                            const tile = MACHINE_TILE_STYLE[type];
                            const TileIcon = tile.icon;
                            return (
                              <button
                                key={type}
                                type="button"
                                onClick={(e) => {
                                  const newMachine: Machine = {
                                    id: genMachineId(),
                                    type,
                                    customTypeLabel: type === "other" ? "Drill Press" : "",
                                    name: `${label} ${machines.filter((m) => m.type === type).length + 1}`,
                                    model: "",
                                    serialNumber: "",
                                    notes: "",
                                    maintenanceContact: { name: "", phone: "", email: "" },
                                    serviceHistory: [],
                                    isDefaultForType: type !== "other" && !machines.some((m) => m.type === type),
                                    nestingSettings: emptyMachineNestingSettings(),
                                    edgebandingSettings: emptyMachineEdgebandingSettings(),
                                  };
                                  setMachines((prev) => [...prev, newMachine]);
                                  setNewMachineTypePickerOpen(false);
                                  machineModalOriginElRef.current = e.currentTarget;
                                  setMachineModalOrigin(captureGlassModalOrigin(e));
                                  setActiveMachineModalId(newMachine.id);
                                }}
                                className="flex items-center gap-3 rounded-[14px] border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-glass)]"
                                style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}
                              >
                                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-white" style={{ backgroundImage: tile.gradient }}>
                                  <TileIcon size={17} />
                                </span>
                                <span className="text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>{label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    </ModalPortal>
                  ) : null}
                  {shouldRenderMachineModal ? (
                    <ModalPortal>
                    <div className="fixed inset-0 z-[1700] flex items-center justify-center px-4 py-4">
                      <button
                        type="button"
                        aria-label="Close machine settings"
                        onClick={() => setActiveMachineModalId(null)}
                        className="glass-modal-backdrop absolute inset-0"
                      />
                      <div
                        ref={machineModalPanelRef}
                        className="glass-modal-panel relative z-[1701] flex h-[min(760px,calc(100svh-32px))] w-full max-w-[880px] flex-col overflow-hidden"
                      >
                        <GlassModalHeader
                          title={<>{activeMachine ? machineTypeLabel(activeMachine) : "Machine"} Settings</>}
                          onClose={() => setActiveMachineModalId(null)}
                        />
                        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
                          {activeMachine ? (
                            <>
                              <div className="space-y-2">
                                <FieldGroupHeading first>Machine</FieldGroupHeading>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                  <StackField label="Name">
                                    <input
                                      value={activeMachine.name}
                                      onChange={(e) => updateActiveMachine({ name: e.target.value })}
                                      className={fieldInputClass}
                                    />
                                  </StackField>
                                  {activeMachine.type === "other" ? (
                                    <StackField label="Type">
                                      <input
                                        value={activeMachine.customTypeLabel}
                                        onChange={(e) => updateActiveMachine({ customTypeLabel: e.target.value })}
                                        placeholder="e.g. Drill Press"
                                        className={fieldInputClass}
                                      />
                                    </StackField>
                                  ) : null}
                                  <StackField label="Model">
                                    <input
                                      value={activeMachine.model}
                                      onChange={(e) => updateActiveMachine({ model: e.target.value })}
                                      className={fieldInputClass}
                                    />
                                  </StackField>
                                  <StackField label="Serial number">
                                    <input
                                      value={activeMachine.serialNumber}
                                      onChange={(e) => updateActiveMachine({ serialNumber: e.target.value })}
                                      className={fieldInputClass}
                                    />
                                  </StackField>
                                </div>
                                <StackField label="Notes">
                                  <textarea
                                    value={activeMachine.notes}
                                    onChange={(e) => updateActiveMachine({ notes: e.target.value })}
                                    rows={3}
                                    className={`${fieldInputClass} h-auto py-2`}
                                  />
                                </StackField>
                                {activeMachine.type !== "other" ? (
                                  <div className="flex items-center gap-2.5">
                                    <GlassSwitch
                                      checked={activeMachine.isDefaultForType}
                                      onChange={() => setMachineAsDefault(activeMachine.id)}
                                      ariaLabel={`Default ${machineTypeLabel(activeMachine)}`}
                                    />
                                    <p className="text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
                                      Default {machineTypeLabel(activeMachine)} <span style={{ color: "var(--text-muted)" }}>— used when a job doesn&apos;t pick one</span>
                                    </p>
                                  </div>
                                ) : null}
                              </div>

                              <div className="space-y-2">
                                <FieldGroupHeading>Maintenance Contact</FieldGroupHeading>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                  <StackField label="Name">
                                    <input
                                      value={activeMachine.maintenanceContact.name}
                                      onChange={(e) => updateActiveMachine((m) => ({ maintenanceContact: { ...m.maintenanceContact, name: e.target.value } }))}
                                      className={fieldInputClass}
                                    />
                                  </StackField>
                                  <StackField label="Phone">
                                    <input inputMode="tel"
                                      value={activeMachine.maintenanceContact.phone}
                                      onChange={(e) => updateActiveMachine((m) => ({ maintenanceContact: { ...m.maintenanceContact, phone: e.target.value } }))}
                                      className={fieldInputClass}
                                    />
                                  </StackField>
                                  <StackField label="Email">
                                    <input
                                      value={activeMachine.maintenanceContact.email}
                                      onChange={(e) => updateActiveMachine((m) => ({ maintenanceContact: { ...m.maintenanceContact, email: e.target.value } }))}
                                      className={fieldInputClass}
                                    />
                                  </StackField>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <FieldGroupHeading>Servicing History</FieldGroupHeading>
                                <div className="space-y-1.5">
                                  {activeMachine.serviceHistory.length === 0 ? (
                                    <EmptyState compact icon={<Factory size={16} />} title="No service entries yet" hint="Add an entry each time the machine is serviced." />
                                  ) : null}
                                  {activeMachine.serviceHistory.map((entry, idx) => (
                                    <div key={entry.id} className={`${listRowClass} flex-wrap`}>
                                      <input
                                        type="date"
                                        value={entry.date}
                                        onChange={(e) =>
                                          updateActiveMachine((m) => ({
                                            serviceHistory: m.serviceHistory.map((row, i) => (i === idx ? { ...row, date: e.target.value } : row)),
                                          }))
                                        }
                                        className={`${glassFieldSmClass} w-[150px]`}
                                      />
                                      <input
                                        value={entry.notes}
                                        onChange={(e) =>
                                          updateActiveMachine((m) => ({
                                            serviceHistory: m.serviceHistory.map((row, i) => (i === idx ? { ...row, notes: e.target.value } : row)),
                                          }))
                                        }
                                        placeholder="What was done"
                                        className={`${gridCellInputClass} min-w-[200px] flex-1`}
                                      />
                                      <button
                                        type="button"
                                        onClick={() =>
                                          removeFromActiveMachine(
                                            "Service entry removed",
                                            (m) => ({ serviceHistory: m.serviceHistory.filter((_, i) => i !== idx) }),
                                            (m) => ({ serviceHistory: insertAt(m.serviceHistory, idx, entry) }),
                                          )
                                        }
                                        className={dangerIconButtonClass}
                                        title="Remove entry"
                                      >
                                        <X size={15} />
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateActiveMachine((m) => ({
                                        serviceHistory: [{ id: genMachineServiceLogId(), date: "", notes: "" }, ...m.serviceHistory],
                                      }))
                                    }
                                    className={secondaryButtonClass}
                                  >
                                    <Plus size={14} /> Add entry
                                  </button>
                                </div>
                              </div>

                              {activeMachine.type === "cnc" || activeMachine.type === "table-saw" ? (
                                <div className="space-y-2">
                                  <FieldGroupHeading>Nesting Settings</FieldGroupHeading>
                                  <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                                    Sheet size comes from each board&apos;s own entry in Materials &amp; Boards —
                                    only this machine&apos;s own cutting settings live here.
                                  </p>
                                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                    {(
                                      [
                                        ["Kerf", "kerf"],
                                        ["Margin", "margin"],
                                        ["Minimum piece size", "minPieceSize"],
                                      ] as [string, keyof MachineNestingSettings][]
                                    ).map(([label, key]) => (
                                      <StackField key={key} label={label}>
                                        <LengthField
                                          valueMm={activeMachine.nestingSettings[key]}
                                          onChangeMm={(mm) => updateActiveMachine((m) => ({ nestingSettings: { ...m.nestingSettings, [key]: mm } }))}
                                          unit={companyUnit}
                                          className={glassFieldClass}
                                          width={160}
                                        />
                                      </StackField>
                                    ))}
                                  </div>
                                </div>
                              ) : null}

                              {activeMachine.type === "edge-bander" ? (
                                <div className="space-y-2">
                                  <FieldGroupHeading>Edgebanding</FieldGroupHeading>
                                  <div className="space-y-1.5">
                                    {activeMachine.edgebandingSettings.rules.map((rule, idx) => (
                                      <div key={`machine_edgeband_rule_${idx}`} className={`${listRowClass} flex-wrap text-[12.5px] font-medium`} style={{ color: "var(--text-main)" }}>
                                        <span className="pl-1">If edge tape is</span>
                                        <input inputMode="decimal"
                                          value={rule.upToMeters}
                                          onChange={(e) =>
                                            updateActiveMachine((m) => ({
                                              edgebandingSettings: {
                                                ...m.edgebandingSettings,
                                                rules: m.edgebandingSettings.rules.map((v, i) => (i === idx ? { ...v, upToMeters: e.target.value } : v)),
                                              },
                                            }))
                                          }
                                          className={`${glassFieldSmClass} w-[80px] text-center`}
                                        />
                                        <span>m or less, add</span>
                                        <input inputMode="decimal"
                                          value={rule.addMeters}
                                          onChange={(e) =>
                                            updateActiveMachine((m) => ({
                                              edgebandingSettings: {
                                                ...m.edgebandingSettings,
                                                rules: m.edgebandingSettings.rules.map((v, i) => (i === idx ? { ...v, addMeters: e.target.value } : v)),
                                              },
                                            }))
                                          }
                                          className={`${glassFieldSmClass} w-[80px] text-center`}
                                        />
                                        <span>m</span>
                                        <span className="flex-1" />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            removeFromActiveMachine(
                                              "Rule removed",
                                              (m) => ({ edgebandingSettings: { ...m.edgebandingSettings, rules: m.edgebandingSettings.rules.filter((_, i) => i !== idx) } }),
                                              (m) => ({ edgebandingSettings: { ...m.edgebandingSettings, rules: insertAt(m.edgebandingSettings.rules, idx, rule) } }),
                                            )
                                          }
                                          className={dangerIconButtonClass}
                                          title="Remove rule"
                                        >
                                          <X size={15} />
                                        </button>
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateActiveMachine((m) => ({
                                          edgebandingSettings: { ...m.edgebandingSettings, rules: [...m.edgebandingSettings.rules, { upToMeters: "", addMeters: "" }] },
                                        }))
                                      }
                                      className={secondaryButtonClass}
                                    >
                                      <Plus size={14} /> Add rule
                                    </button>
                                  </div>
                                  <FieldRow label="Excess per end" hint="Added to each end of every edged part.">
                                    <LengthField
                                      valueMm={activeMachine.edgebandingSettings.excessPerEndMm}
                                      onChangeMm={(mm) => updateActiveMachine((m) => ({ edgebandingSettings: { ...m.edgebandingSettings, excessPerEndMm: mm } }))}
                                      unit={companyUnit}
                                      className={glassFieldClass}
                                      width={140}
                                    />
                                  </FieldRow>
                                  <div className="flex flex-wrap items-center gap-2.5 text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
                                    <GlassSwitch
                                      checked={activeMachine.edgebandingSettings.roundEnabled}
                                      onChange={(next) =>
                                        updateActiveMachine((m) => ({ edgebandingSettings: { ...m.edgebandingSettings, roundEnabled: next } }))
                                      }
                                      ariaLabel="Round edge tape totals"
                                    />
                                    <span>Round</span>
                                    <Segmented
                                      size="sm"
                                      value={activeMachine.edgebandingSettings.roundDirection === "down" ? "down" : "up"}
                                      options={[
                                        { value: "up", label: "up" },
                                        { value: "down", label: "down" },
                                      ]}
                                      onChange={(dir) =>
                                        updateActiveMachine((m) => ({ edgebandingSettings: { ...m.edgebandingSettings, roundDirection: dir } }))
                                      }
                                      disabled={!activeMachine.edgebandingSettings.roundEnabled}
                                    />
                                    <span>to the nearest</span>
                                    <input inputMode="decimal"
                                      value={activeMachine.edgebandingSettings.roundNearestMeters}
                                      onChange={(e) =>
                                        updateActiveMachine((m) => ({ edgebandingSettings: { ...m.edgebandingSettings, roundNearestMeters: e.target.value } }))
                                      }
                                      disabled={!activeMachine.edgebandingSettings.roundEnabled}
                                      className={`${glassFieldSmClass} w-[72px] text-center`}
                                    />
                                    <span>m</span>
                                  </div>
                                </div>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    </ModalPortal>
                  ) : null}
                </div>
              )}

              {active === "production" && (
                <div className="grid gap-[18px] max-lg:grid-cols-1 xl:grid-cols-2">
                  <Panel title="Cutlist columns" icon={Columns3} description="Which columns show in Production and Initial Measure cutlists. Drag to set their order.">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 px-2 pb-0.5">
                        <span className="w-6 shrink-0" />
                        <span className={`min-w-0 flex-1 ${columnHeadClass}`}>Column</span>
                        <span className={`w-[96px] shrink-0 text-center max-sm:w-[80px] ${columnHeadClass}`}>Production</span>
                        <span className={`w-[110px] shrink-0 text-center max-sm:w-[64px] max-sm:leading-tight ${columnHeadClass}`}>Initial measure</span>
                      </div>
                      {cutlistColumnRows.map((columnName) => {
                        const prodChecked = cutlistProduction.includes(columnName);
                        const initialChecked = cutlistInitial.includes(columnName);
                        const idx = cutlistColumnRows.findIndex((v) => v === columnName);
                        const toggleIn = (list: string[], on: boolean) =>
                          on
                            ? sortCutlistSelectionsByOrder(list.includes(columnName) ? list : [...list, columnName], cutlistColumnRows)
                            : list.filter((v) => v !== columnName);
                        return (
                          <div
                            key={columnName}
                            id={`settings_cutlist_col_${idx}`}
                            className={listRowClass}
                            style={{ opacity: cutlistColumnDragIndex === idx ? 0.45 : 1 }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                            }}
                            onDragEnter={(e) => {
                              e.preventDefault();
                              if (cutlistColumnDragIndex == null || cutlistColumnDragIndex === idx) return;
                              const nextRows = moveRowTo(cutlistColumnRows, cutlistColumnDragIndex, idx);
                              setCutlistColumnOrder(nextRows);
                              setCutlistProduction((prev) => sortCutlistSelectionsByOrder(prev, nextRows));
                              setCutlistInitial((prev) => sortCutlistSelectionsByOrder(prev, nextRows));
                              setCutlistColumnDragIndex(idx);
                              setCutlistColumnDragOverIndex(idx);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              setCutlistColumnDragIndex(null);
                              setCutlistColumnDragOverIndex(null);
                              endRowDrag();
                              triggerAutosaveAfterRowDrop();
                            }}
                          >
                            <button
                              type="button"
                              draggable
                              onDragStart={(e) => {
                                setCutlistColumnDragIndex(idx);
                                setCutlistColumnDragOverIndex(idx);
                                startRowDrag(e, `settings_cutlist_col_${idx}`, columnName, "#64748B");
                              }}
                              onDragEnd={() => {
                                setCutlistColumnDragIndex(null);
                                setCutlistColumnDragOverIndex(null);
                                endRowDrag();
                              }}
                              className={gripClass}
                              title="Drag to reorder"
                            >
                              <GripVertical size={15} />
                            </button>
                            <span className="min-w-0 flex-1 truncate pl-1 text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>{columnName}</span>
                            <span className="flex w-[96px] shrink-0 justify-center max-sm:w-[80px]">
                              <GlassSwitch size="sm" checked={prodChecked} onChange={(on) => setCutlistProduction((prev) => toggleIn(prev, on))} ariaLabel={`${columnName} in Production`} />
                            </span>
                            <span className="flex w-[110px] shrink-0 justify-center max-sm:w-[64px]">
                              <GlassSwitch size="sm" checked={initialChecked} onChange={(on) => setCutlistInitial((prev) => toggleIn(prev, on))} ariaLabel={`${columnName} in Initial Measure`} />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </Panel>
                  <div className="grid content-start gap-[18px] max-lg:grid-cols-1">
                    <Panel title="Production access" icon={KeyRound} description="Temporary unlock codes for editing a production cutlist.">
                      <FieldRow label="Unlock suffix" hint="Added to the end of each generated unlock code.">
                        <input value={unlockSuffix} onChange={(e) => setUnlockSuffix(e.target.value)} className={`${fieldInputClass} max-w-[160px]`} />
                      </FieldRow>
                      <FieldRow label="Unlock lasts for">
                        <span className="relative inline-flex w-[120px] items-center">
                          <input value={unlockHours} inputMode="numeric" onChange={(e) => setUnlockHours(e.target.value)} className={`${fieldInputClass} pr-12 text-center`} />
                          <span className="pointer-events-none absolute right-3 text-[12px]" style={{ color: "var(--text-muted)" }}>hours</span>
                        </span>
                      </FieldRow>
                    </Panel>
                    <Panel title="Contractors" icon={TradeIcon} description="Trades you can assign work to on a project.">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {contractors.map((value, idx) => (
                          <span key={`contractor_${idx}`} className={chipClass}>
                            <input
                              value={value}
                              placeholder="e.g. Electrician"
                              size={Math.max(10, value.length + 1)}
                              onChange={(e) => setContractors((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))}
                              className="min-w-0 bg-transparent text-[12.5px] font-semibold outline-none"
                              style={{ color: "var(--text-main)" }}
                            />
                            <button
                              type="button"
                              onClick={() => removeFromList(setContractors, idx, value, `${toStr(value, "Contractor")} removed`)}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                              style={{ color: "var(--text-muted)" }}
                              title="Remove"
                            >
                              <X size={13} />
                            </button>
                          </span>
                        ))}
                        <button type="button" onClick={() => setContractors((prev) => [...prev, ""])} className={chipAddClass}>
                          <Plus size={14} /> Add
                        </button>
                      </div>
                    </Panel>
                    {renderRoomNamesPanel()}
                  </div>
                  {/* Edgebanding used to be its own panel here — it now lives inside each Edge Bander
                      machine's own settings pop-up (Machining tab). */}
                  <Panel
                    className="xl:col-span-2"
                    title="Gap allowances"
                    icon={Ruler}
                    description={`Gaps used when working out door, drawer and panel sizes. Shown in ${companyUnit === "in" ? "inches" : "millimetres"} — follows the measurement unit in Company.`}
                  >
                    <div className="grid gap-3 max-lg:grid-cols-1 xl:grid-cols-2">
                      {([
                        [Archive, "Base cabinets", [
                          ["baseBelowBenchToTopOfDoorDrawer", "Below bench to top of door / drawer"],
                          ["baseHorizontalGapNormalHandles", "Gap between drawers — normal handles"],
                          ["baseHorizontalGapWrapOverHandles", "Gap between drawers — wrap-over handles"],
                          ["baseVerticalGapDoorsPanels", "Vertical gap between doors / panels"],
                        ]],
                        [DoorClosed, "Tall cabinets", [
                          ["tallTopOfDoorToTopWithScribers", "Top of door to top of cabinet — with top scribers"],
                          ["tallTopOfDoorToTopNoScribers", "Top of door to top of cabinet — no top scribers"],
                          ["tallVerticalGapDoorsPanels", "Vertical gap between doors / panels"],
                        ]],
                      ] as Array<[React.ComponentType<{ size?: number }>, string, string[][]]>).map(([GroupIcon, groupLabel, rows]) => (
                        <div key={groupLabel} className="grid gap-2 rounded-[14px] border p-3" style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}>
                          <p className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: "var(--text-main)" }}>
                            <GroupIcon size={14} /> {groupLabel}
                          </p>
                          {rows.map(([key, label]) => (
                            <div key={key} className="flex items-center justify-between gap-3 text-[12.5px]" style={{ color: "var(--text-main)" }}>
                              <span>{label}</span>
                              <LengthField
                                valueMm={gapAllowances[key as keyof GapAllowancesSettings]}
                                onChangeMm={(mm) => setGapAllowances((prev) => ({ ...prev, [key]: mm }))}
                                unit={companyUnit}
                                width={92}
                              />
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </Panel>
                  <Panel className="xl:col-span-2" title="Part types" icon={Shapes} description="The kinds of part in a cutlist — their colour, behaviour and where they're included." allowOverflow>
                    <div className="overflow-x-auto" data-horizontal-swipe-scroll="true">
                      <div className="min-w-[900px] space-y-1.5">
                        <div className="grid grid-cols-[28px_36px_minmax(140px,1fr)_150px_210px_96px_86px_80px_32px] items-center gap-2 px-2">
                          <span />
                          <span />
                          <span className={columnHeadClass}>Name</span>
                          <span className={columnHeadClass}>Type</span>
                          <span className={columnHeadClass}>Autoclash</span>
                          <span className={`text-center ${columnHeadClass}`}>Initial measure</span>
                          <span className={`text-center ${columnHeadClass}`}>Cutlists</span>
                          <span className={`text-center ${columnHeadClass}`}>Nesting</span>
                          <span />
                        </div>
                        {partTypes.map((row, idx) => (
                          // Dragged by its grip into the order the cutlists show them in.
                          <div
                            key={`part_type_${idx}`}
                            id={`settings_part_type_${idx}`}
                            className={`${listRowClass} grid grid-cols-[28px_36px_minmax(140px,1fr)_150px_210px_96px_86px_80px_32px]`}
                            style={{ opacity: partTypeDragIndex === idx ? 0.45 : 1 }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                            }}
                            onDragEnter={(e) => {
                              e.preventDefault();
                              if (partTypeDragIndex == null || partTypeDragIndex === idx) return;
                              setPartTypes((prev) => moveRowTo(prev, partTypeDragIndex, idx));
                              setPartTypeDragIndex(idx);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              setPartTypeDragIndex(null);
                              endRowDrag();
                              triggerAutosaveAfterRowDrop();
                            }}
                          >
                            <button
                              type="button"
                              draggable
                              onDragStart={(e) => {
                                setPartTypeDragIndex(idx);
                                startRowDrag(e, `settings_part_type_${idx}`, row.name || "Part type", row.color || "#7D99B3");
                              }}
                              onDragEnd={() => {
                                setPartTypeDragIndex(null);
                                endRowDrag();
                              }}
                              className={gripClass}
                              title="Drag to reorder"
                              aria-label="Drag to reorder"
                            >
                              <GripVertical size={15} />
                            </button>
                            <span className="flex justify-center">
                              <ColorCircle value={row.color || "#7D99B3"} onChange={(hex) => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, color: hex } : v)))} />
                            </span>
                            <input value={row.name} placeholder="Part type" onChange={(e) => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))} className={gridCellInputClass} />
                            <GlassDropdown
                              value={row.category}
                              options={[
                                { value: "", label: "None" },
                                { value: "cabinetry", label: "Cabinetry" },
                                { value: "drawer", label: "Drawer" },
                                { value: "door", label: "Doors" },
                                { value: "panel", label: "Panels" },
                                { value: "extra", label: "Extras" },
                                { value: "custom", label: "Custom" },
                              ]}
                              onChange={(next) =>
                                setPartTypes((prev) =>
                                  prev.map((v, i) =>
                                    i === idx
                                      ? { ...v, category: next === "cabinetry" || next === "drawer" || next === "door" || next === "panel" || next === "extra" || next === "custom" ? next : "" }
                                      : v,
                                  ),
                                )
                              }
                              ariaLabel="Part type category"
                              triggerClassName={`${glassFieldSmClass} justify-between`}
                            />
                            <span className="flex items-center gap-1.5">
                              {/* Autoclash: Off, or which long / short edges clash — the selected option in brand blue. */}
                              <Segmented
                                size="sm"
                                tone="brand"
                                value={row.autoClashLeft || ""}
                                options={[{ value: "", label: "Off" }, ...autoClashLeftOptions.map((opt) => ({ value: opt, label: opt }))]}
                                onChange={(next) => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, autoClashLeft: next } : v)))}
                              />
                              <Segmented
                                size="sm"
                                tone="brand"
                                value={row.autoClashRight || ""}
                                options={[{ value: "", label: "Off" }, ...autoClashRightOptions.map((opt) => ({ value: opt, label: opt }))]}
                                onChange={(next) => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, autoClashRight: next } : v)))}
                              />
                            </span>
                            <span className="flex justify-center">
                              <GlassSwitch size="sm" checked={row.initialMeasure} onChange={(on) => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, initialMeasure: on } : v)))} ariaLabel="Initial measure" />
                            </span>
                            <span className="flex justify-center">
                              <GlassSwitch size="sm" checked={row.inCutlists} onChange={(on) => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, inCutlists: on } : v)))} ariaLabel="Include in cutlists" />
                            </span>
                            <span className="flex justify-center">
                              <GlassSwitch size="sm" checked={row.inNesting} onChange={(on) => setPartTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, inNesting: on } : v)))} ariaLabel="Include in nesting" />
                            </span>
                            <button
                              type="button"
                              onClick={() => removeFromList(setPartTypes, idx, row, `${toStr(row.name, "Part type")} removed`)}
                              className={dangerIconButtonClass}
                              title="Remove"
                            >
                              <X size={15} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPartTypes((prev) => [...prev, { name: "", color: "#7D99B3", category: "", autoClashLeft: "", autoClashRight: "", initialMeasure: false, inCutlists: true, inNesting: true }])}
                      className={`${secondaryButtonClass} mt-2`}
                    >
                      <Plus size={14} /> Add part type
                    </button>
                  </Panel>
                </div>
              )}

              {active === "staff" && (
                <div className="grid gap-[18px] max-lg:grid-cols-1 xl:grid-flow-row-dense xl:grid-cols-[minmax(0,1fr)_340px]">
                  <Panel
                    title="Staff"
                    icon={Users}
                    description="Everyone in your company. Change someone's role from their role pill."
                    allowOverflow
                    headerRight={
                      canAddStaff ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            addStaffOriginElRef.current = e.currentTarget;
                            setAddStaffOrigin(captureGlassModalOrigin(e));
                            openAddStaff();
                          }}
                          disabled={isInvitingStaff || isLoading || !activeCompanyId}
                          className={primaryButtonClass}
                          style={primaryButtonStyle}
                        >
                          <UserPlus size={15} /> {isInvitingStaff ? "Inviting..." : "Add staff"}
                        </button>
                      ) : null
                    }
                  >
                    <div className="overflow-x-auto" data-horizontal-swipe-scroll="true">
                      {/* Desktop: a table. Below desktop each person is a two-line row — name, role and
                          remove on top, email and mobile under the name — instead of a table that
                          needed sideways scrolling. */}
                      <div className="space-y-1.5 lg:min-w-[720px]">
                        <div className="hidden items-center gap-2 px-2 lg:grid lg:grid-cols-[minmax(180px,1.2fr)_minmax(160px,1fr)_130px_170px_32px]">
                          <span className={columnHeadClass}>Name</span>
                          <span className={columnHeadClass}>Email</span>
                          <span className={columnHeadClass}>Mobile</span>
                          <span className={columnHeadClass}>Role</span>
                          <span />
                        </div>
                        {staff.map((row) => {
                          const roleKeyForRow = normalizeRoleKey(row.roleId || row.role);
                          const isOwnerRow = roleKeyForRow === "owner";
                          const name = toStr(row.displayName, "CU");
                          const parts = name.split(/\s+/).filter(Boolean);
                          const initials =
                            parts.length >= 2 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() : `${parts[0]?.[0] ?? name[0] ?? ""}`.toUpperCase();
                          const currentUserRowColor = String(row.uid || "").trim() === String(user?.uid || "").trim() ? toStr(user?.userColor) : "";
                          const iconColor =
                            currentUserRowColor || toStr(staffIconColorByUid[row.uid]) || toStr(row.badgeColor) || toStr(row.userColor) || toStr(form.themeColor) || "#7D99B3";
                          const roleColor = roleColorById.get(roleKeyForRow) || "#7D99B3";
                          const roleOptions: GlassDropdownOption[] = [
                            ...staffRoleOptions.map((role) => ({ value: normalizeRoleKey(role.id || role.name), label: toStr(role.name, role.id), color: toStr(role.color, "#7D99B3") })),
                            ...(!staffRoleOptions.some((role) => normalizeRoleKey(role.id || role.name) === roleKeyForRow) && toStr(row.roleId || row.role)
                              ? [{ value: roleKeyForRow, label: toStr(roleNameById.get(roleKeyForRow) || row.roleId || row.role), color: roleColor }]
                              : []),
                          ];
                          return (
                            <div
                              key={row.uid}
                              className={`${listRowClass} grid grid-cols-[minmax(0,1fr)_auto_32px] max-lg:gap-y-0.5 lg:grid-cols-[minmax(180px,1.2fr)_minmax(160px,1fr)_130px_170px_32px]`}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: iconColor }}>
                                  {initials || "CU"}
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col">
                                <input
                                  value={String(row.displayName ?? "")}
                                  onFocus={() => {
                                    staffNameEditStartRef.current[row.uid] = String(row.displayName ?? "");
                                  }}
                                  onChange={(e) =>
                                    setStaff((prev) => prev.map((member) => (member.uid === row.uid ? { ...member, displayName: e.target.value } : member)))
                                  }
                                  onBlur={(e) => void persistStaffDisplayName({ ...row, displayName: e.currentTarget.value })}
                                  readOnly={!canChangeStaffDisplayName}
                                  disabled={savingStaffNameUid === row.uid}
                                  className={`${gridCellInputClass} font-semibold ${savingStaffNameUid === row.uid ? "opacity-60" : ""}`}
                                />
                                {(() => {
                                  // How they joined: the code they used (and what kind), an invite, or creating the company.
                                  const joinedWith = joinedWithFor(row, isOwnerRow);
                                  return (
                                    <span className="truncate px-1 text-[11px] leading-tight" style={{ color: "var(--text-muted)" }}>
                                      {joinedWith.code ? (
                                        <>
                                          Joined with <span className="font-mono font-semibold" style={{ color: "var(--text-main)" }}>{joinedWith.code}</span> · {joinedWith.kind}
                                        </>
                                      ) : joinedWith.kind === "—" ? (
                                        "Joined with: not recorded"
                                      ) : (
                                        joinedWith.kind
                                      )}
                                    </span>
                                  );
                                })()}
                                </span>
                              </span>
                              <span className="truncate px-1 text-[12.5px] max-lg:col-start-1 max-lg:row-start-2 max-lg:pl-[46px]" style={{ color: "var(--text-muted)" }}>{toStr(row.email) || "—"}</span>
                              <span className="truncate px-1 text-[12.5px] max-lg:col-start-2 max-lg:col-end-4 max-lg:row-start-2 max-lg:text-right" style={{ color: "var(--text-muted)" }}>{toStr(row.mobile) || "—"}</span>
                              <span className="min-w-0 max-lg:col-start-2 max-lg:row-start-1">
                                <GlassDropdown
                                  value={roleKeyForRow}
                                  options={roleOptions}
                                  disabled={!canChangeStaffRole || savingStaffRoleUid === row.uid}
                                  ariaLabel={`Role for ${name}`}
                                  menuMinWidth={180}
                                  hideChevron
                                  onChange={(roleKey) => {
                                    setOwnerTransferOrigin(null);
                                    ownerTransferOriginElRef.current = null;
                                    // Same rule as before: the only owner can't step down until someone else is made owner.
                                    const shouldRequireOwnerTransfer =
                                      toStr(row.uid) === toStr(user?.uid) && isOwnerRow && roleKey !== "owner" && !hasAnotherOwnerBesidesCurrentUser;
                                    if (!shouldRequireOwnerTransfer) {
                                      setStaff((prev) => prev.map((member) => (member.uid === row.uid ? { ...member, role: roleKey, roleId: roleKey } : member)));
                                    }
                                    void persistStaffRole(row, roleKey);
                                  }}
                                  triggerClassName={`inline-flex h-7 max-w-full items-center rounded-full px-3 text-[12px] font-semibold ${savingStaffRoleUid === row.uid ? "opacity-60" : ""}`}
                                  triggerStyle={{ backgroundColor: roleColor, color: contrastTextForFill(roleColor) }}
                                />
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  // Captured synchronously here, before openStaffRemovalDialog's own
                                  // internal `await previewCompanyMemberRemoval(...)` — by the time that resolves,
                                  // React may have already re-rendered this row away from under
                                  // `e.currentTarget`, per captureGlassModalOrigin's own doc comment.
                                  staffRemovalOriginElRef.current = e.currentTarget;
                                  setStaffRemovalOrigin(captureGlassModalOrigin(e));
                                  void openStaffRemovalDialog(row);
                                }}
                                disabled={!canRemoveStaff || isOwnerRow || preparingStaffRemovalUid === row.uid || removingStaffUid === row.uid}
                                title={isOwnerRow ? "Owner cannot be removed" : "Remove staff member"}
                                className={`${dangerIconButtonClass} max-lg:col-start-3 max-lg:row-start-1`}
                              >
                                <UserMinus size={15} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {pendingInvites.length ? (
                      <div className="mt-4 space-y-1.5 border-t pt-3" style={{ borderColor: "var(--glass-border)" }}>
                        <div className="flex items-center gap-2 px-2">
                          <span className={columnHeadClass}>Invited</span>
                          <span className={countPillClass}>{pendingInvites.length}</span>
                        </div>
                        {pendingInvites.map((invite) => (
                          <div key={invite.id} className={`${listRowClass} flex flex-wrap items-center gap-x-3 gap-y-1`}>
                            <span className="min-w-[180px] flex-1 truncate text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>{invite.email}</span>
                            <span
                              className="rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
                              style={{ backgroundColor: "color-mix(in srgb, var(--accent-amber) 20%, transparent)", color: "var(--text-main)" }}
                            >
                              Pending
                            </span>
                            <span className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                              {[invite.createdAtIso ? `Invited ${activeDateTime(invite.createdAtIso)}` : "Invited", invite.invitedByName ? `by ${invite.invitedByName}` : ""]
                                .filter(Boolean)
                                .join(" ")}
                            </span>
                            {(() => {
                              // The Access code made for this invite (Access codes, below).
                              const code = joinCodes?.codes.find((row) => row.inviteId === invite.id && row.status === "active");
                              return code ? (
                                <span className="font-mono text-[12px] font-semibold tracking-[1px]" style={{ color: "var(--text-main)" }} title="Their access code">
                                  {code.code}
                                </span>
                              ) : null;
                            })()}
                            {canAddStaff ? (
                              <button
                                type="button"
                                onClick={() => void cancelInvite(invite)}
                                disabled={cancellingInviteId === invite.id}
                                className={secondaryButtonClass}
                                style={
                                  confirmCancelInviteId === invite.id
                                    ? { backgroundImage: "var(--danger-gradient)", color: "#fff", borderColor: "transparent" }
                                    : undefined
                                }
                              >
                                {cancellingInviteId === invite.id ? "Cancelling…" : confirmCancelInviteId === invite.id ? "Cancel invite?" : "Cancel invite"}
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </Panel>
                  {/* Access codes: one-person codes to join with — made here, or for someone invited with Add staff. */}
                  {canManageJoinCodes ? (
                    <Panel
                      title="Access codes"
                      icon={KeyRound}
                      description="A code for one person to join with. Revoke one any time — once used, that removes them."
                      className="xl:col-start-1"
                    >
                      {joinCodes ? (
                        <AccessCodesList
                          companyId={activeCompanyId}
                          data={joinCodes}
                          onReload={() => setJoinCodesReloadTick((tick) => tick + 1)}
                          onRevokeUsedCode={(record) => void revokeUsedJoinCode(record)}
                          roleFor={accessCodeRoleFor}
                        />
                      ) : joinCodesError ? (
                        <p className="text-[13px] font-medium" style={{ color: "var(--danger)" }}>
                          {joinCodesError}
                        </p>
                      ) : (
                        <SkeletonGroup label="Loading access codes" className="space-y-2">
                          <Skeleton className="h-9 w-full rounded-[12px]" />
                          <Skeleton className="h-11 w-full rounded-[12px]" />
                        </SkeletonGroup>
                      )}
                    </Panel>
                  ) : null}
                  <Panel title="Roles" icon={Shield} description="Click a role to edit what it can do. Drag to reorder.">
                    <div className="space-y-1.5">
                      {roles.map((row, idx) => {
                        const fill = row.color || "#7D99B3";
                        const fg = contrastTextForFill(fill);
                        return (
                          <div
                            key={`${row.id}_${idx}`}
                            id={`settings_role_${idx}`}
                            className="flex items-center gap-2 rounded-[12px] px-2 py-1.5 transition"
                            style={{ backgroundColor: fill, color: fg, opacity: roleDragIndex === idx ? 0.45 : 1 }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                            }}
                            onDragEnter={(e) => {
                              e.preventDefault();
                              if (roleDragIndex == null || roleDragIndex === idx) return;
                              setRoles((prev) => moveRowTo(prev, roleDragIndex, idx));
                              setRoleDragIndex(idx);
                              setRoleDragOverIndex(idx);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              setRoleDragIndex(null);
                              setRoleDragOverIndex(null);
                              endRowDrag();
                              triggerAutosaveAfterRowDrop();
                            }}
                          >
                            <button
                              type="button"
                              draggable
                              onDragStart={(e) => {
                                setRoleDragIndex(idx);
                                setRoleDragOverIndex(idx);
                                e.dataTransfer.setData("text/plain", `${row.id}`);
                                startRowDrag(e, `settings_role_${idx}`, toStr(row.name, "Untitled Role"), fill);
                              }}
                              onDragEnd={() => {
                                setRoleDragIndex(null);
                                setRoleDragOverIndex(null);
                                endRowDrag();
                              }}
                              className="inline-flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded-[7px] opacity-80 transition hover:bg-white/15 hover:opacity-100 active:cursor-grabbing"
                              title="Drag to reorder"
                            >
                              <GripVertical size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                roleModalOriginElRef.current = e.currentTarget;
                                setRoleModalOrigin(captureGlassModalOrigin(e));
                                setActiveRoleModalIndex(idx);
                              }}
                              className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-[13px] font-semibold"
                            >
                              <span className="min-w-0 flex-1 truncate">{toStr(row.name, "Untitled Role")}</span>
                              {isProtectedStarterRole(row.id || row.name) ? <Lock size={13} className="shrink-0 opacity-80" /> : null}
                              <span className="shrink-0 text-[11px] opacity-80">{row.permissions.length} perms</span>
                            </button>
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={(e) => {
                          roleModalOriginElRef.current = e.currentTarget;
                          setRoleModalOrigin(captureGlassModalOrigin(e));
                          setRoles((prev) => {
                            const next = [...prev, { id: `role_${prev.length + 1}`, name: "", color: "#7D99B3", permissions: ["company.dashboard.view"] }];
                            setActiveRoleModalIndex(next.length - 1);
                            return next;
                          });
                        }}
                        className={`${secondaryButtonClass} mt-1.5`}
                      >
                        <Plus size={14} /> Add role
                      </button>
                    </div>
                  </Panel>
                  {/* Who changed roles and permissions, and when (lib/role-audit.ts) — owners and admins. */}
                  {isOwnerOrAdmin(currentMemberRole) ? (
                    <Panel title="Audit log" icon={History} description="Every change to roles and permissions — who made it and when. Newest first.">
                      {roleAuditLog.length === 0 ? (
                        <EmptyState compact icon={<History size={16} />} title="No changes yet" hint="Changing someone's role, or what a role can do, is noted here." />
                      ) : (
                        // (Its own scroll past a few dozen lines, so the page doesn't keep growing.)
                        <div className="glass-scroll -mr-2 max-h-[420px] overflow-y-auto pr-2">
                          {roleAuditLog.slice(0, roleAuditShown).map((entry) => (
                            <div key={entry.id} className="flex items-start gap-3 border-b border-[var(--glass-border)] py-2.5 last:border-b-0">
                              <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "var(--brand)" }} />
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                                  <span className="font-semibold">{entry.byName}</span> {entry.text}
                                </p>
                                <p className="mt-0.5 text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                                  {activeDateTime(entry.atIso)}
                                </p>
                              </div>
                            </div>
                          ))}
                          {roleAuditLog.length > roleAuditShown ? (
                            <button
                              type="button"
                              onClick={() => setRoleAuditShown((count) => count + 30)}
                              className="mt-2 inline-flex h-8 items-center rounded-full px-3 text-[12px] font-semibold transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]"
                              style={{ color: "var(--brand-strong)" }}
                            >
                              Show more ({roleAuditLog.length - roleAuditShown})
                            </button>
                          ) : null}
                        </div>
                      )}
                    </Panel>
                  ) : null}
                  {shouldRenderRoleModal ? (
                    <ModalPortal>
                    <div className="fixed inset-0 z-[1600] flex items-center justify-center px-4 py-4">
                      <button type="button" aria-label="Close role permissions" onClick={() => setActiveRoleModalIndex(null)} className="glass-modal-backdrop absolute inset-0" />
                      <div ref={roleModalPanelRef} className="glass-modal-panel relative z-[1601] flex max-h-[calc(100svh-32px)] w-full max-w-[820px] flex-col overflow-hidden">
                        <GlassModalHeader title="Role permissions" onClose={() => setActiveRoleModalIndex(null)} />
                        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                          <div className="flex items-end gap-3">
                            <StackField label="Role name" className="flex-1">
                              <input
                                value={activeRoleModal?.name ?? ""}
                                onChange={(e) => setRoles((prev) => prev.map((role, idx) => (idx === activeRoleModalIndex ? { ...role, name: e.target.value } : role)))}
                                className={fieldInputClass}
                              />
                            </StackField>
                            <div className="grid gap-1.5 text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                              Colour
                              <ColorCircle
                                size={36}
                                value={activeRoleModal?.color || "#7D99B3"}
                                onChange={(hex) => setRoles((prev) => prev.map((role, idx) => (idx === activeRoleModalIndex ? { ...role, color: hex } : role)))}
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="text-[10.5px] font-bold uppercase tracking-[0.8px]" style={{ color: "var(--text-muted)" }}>Permissions</p>
                            <span className={countPillClass}>{activeRoleModal?.permissions.length ?? 0} on</span>
                          </div>
                          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                            {groupPermissionKeys(desktopPermissionKeys).map((group) => (
                              <div key={group.label} className="rounded-[14px] border px-3 py-2" style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}>
                                <p className="pb-1 text-[10.5px] font-bold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>{group.label}</p>
                                {group.keys.map((perm) => {
                                  const label = permissionLabels[perm] ?? perm;
                                  const [, ...rest] = label.split(" - ");
                                  return (
                                    <div key={perm} className="flex items-center justify-between gap-3 border-t py-2 first:border-t-0" style={{ borderColor: "var(--glass-border)" }}>
                                      <div className="min-w-0">
                                        <p className="text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>{rest.length ? rest.join(" - ") : label}</p>
                                        <p className="font-mono text-[10.5px] max-lg:[overflow-wrap:anywhere]" style={{ color: "var(--text-muted)" }}>{perm}</p>
                                      </div>
                                      <GlassSwitch
                                        size="sm"
                                        checked={activeRoleModal?.permissions.includes(perm) ?? false}
                                        onChange={() => {
                                          if (activeRoleModalIndex !== null) toggleRolePermission(activeRoleModalIndex, perm);
                                        }}
                                        ariaLabel={label}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center justify-between border-t px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (activeRoleModalIndex === null || activeRoleIsProtected || !activeRoleModal) return;
                              removeFromList(setRoles, activeRoleModalIndex, activeRoleModal, `${toStr(activeRoleModal.name, "Role")} deleted`);
                              setActiveRoleModalIndex(null);
                            }}
                            disabled={activeRoleIsProtected}
                            className={smallButtonClass}
                            style={activeRoleIsProtected ? undefined : { backgroundImage: "var(--danger-gradient)", color: "#fff", borderColor: "transparent" }}
                          >
                            {activeRoleIsProtected ? (
                              <>
                                <Lock size={14} /> Protected role
                              </>
                            ) : (
                              <>
                                <Trash2 size={14} /> Delete role
                              </>
                            )}
                          </button>
                          <div className="flex items-center gap-2">
                            {/* See the app as this role would (lib/view-as-role.ts) — an owner's or admin's preview, not for the
                                owner and admin roles themselves (they see everything). */}
                            {isOwnerOrAdmin(currentMemberRole) && activeRoleModal && !isOwnerOrAdmin(normalizeRoleKey(activeRoleModal.id || activeRoleModal.name)) ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setViewAsRole({
                                    companyId: activeCompanyId,
                                    roleId: normalizeRoleKey(activeRoleModal.id || activeRoleModal.name),
                                    roleName: toStr(activeRoleModal.name, "this role"),
                                    roleColor: toStr(activeRoleModal.color, "#7D99B3"),
                                    permissionKeys: activeRoleModal.permissions,
                                  });
                                  setActiveRoleModalIndex(null);
                                  router.push("/dashboard");
                                }}
                                className={smallButtonClass}
                                title="See the app as someone with this role would — until you press Exit"
                              >
                                <Eye size={14} /> View as this role
                              </button>
                            ) : null}
                            <button type="button" onClick={() => setActiveRoleModalIndex(null)} className={primaryButtonClass} style={primaryButtonStyle}>
                              Done
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    </ModalPortal>
                  ) : null}
                  {shouldRenderOwnerTransferModal ? (
                    <ModalPortal>
                    <div className="fixed inset-0 z-[1700] flex items-center justify-center px-4 py-4">
                      <button
                        type="button"
                        aria-label="Close owner transfer popup"
                        onClick={() => {
                          setPendingOwnerTransfer(null);
                          setPendingOwnerTransferTargetUid("");
                        }}
                        className="glass-modal-backdrop absolute inset-0"
                      />
                      <div ref={ownerTransferPanelRef} className="glass-modal-panel relative z-[1701] flex w-full max-w-[520px] flex-col overflow-hidden">
                        <GlassModalHeader
                          title="Transfer Owner Role"
                          onClose={() => {
                            setPendingOwnerTransfer(null);
                            setPendingOwnerTransferTargetUid("");
                          }}
                        />
                        <div className="space-y-4 px-4 py-4">
                          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                            <span className="font-bold" style={{ color: "var(--text-main)" }}>{pendingOwnerTransfer?.currentOwnerName}</span>
                            {" "}
                            is changing out of the <span className="font-bold" style={{ color: "var(--text-main)" }}>Owner</span>{" "}role.
                            Choose another staff member to become the new Owner first.
                          </p>
                          <div className="space-y-1">
                            <p className="text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>New owner</p>
                            <GlassDropdown
                              value={pendingOwnerTransferTargetUid}
                              options={[
                                { value: "", label: "Choose staff member" },
                                ...ownerTransferCandidates.map((member) => ({ value: member.uid, label: toStr(member.displayName || member.email || member.uid) })),
                              ]}
                              onChange={(uid) => setPendingOwnerTransferTargetUid(toStr(uid))}
                              ariaLabel="New owner"
                              triggerClassName={`${fieldInputClass} justify-between`}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingOwnerTransfer(null);
                              setPendingOwnerTransferTargetUid("");
                            }}
                            className={secondaryButtonClass}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void confirmOwnerTransferAndRoleChange()}
                            disabled={!pendingOwnerTransferTargetUid || !!savingStaffRoleUid}
                            className={primaryButtonClass}
                            style={primaryButtonStyle}
                          >
                            Confirm transfer
                          </button>
                        </div>
                      </div>
                    </div>
                    </ModalPortal>
                  ) : null}
                  {shouldRenderAddStaffModal ? (
                    <ModalPortal>
                    <div className="fixed inset-0 z-[1700] flex items-center justify-center px-4 py-4">
                      <button type="button" aria-label="Close add staff popup" onClick={closeAddStaff} className="glass-modal-backdrop absolute inset-0" />
                      <div
                        ref={addStaffPanelRef}
                        role="dialog"
                        aria-label="Add staff"
                        className="glass-modal-panel relative z-[1701] flex max-h-[calc(100svh-32px)] w-full max-w-[480px] flex-col overflow-hidden"
                      >
                        <GlassModalHeader title="Add staff" icon={<UserPlus size={16} />} onClose={closeAddStaff} closeDisabled={isInvitingStaff} />
                        <form
                          className="flex min-h-0 flex-1 flex-col"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void sendStaffInvite();
                          }}
                        >
                          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                            <div className="space-y-1.5">
                              <label htmlFor="add-staff-email" className="block text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                                Email
                              </label>
                              <input
                                id="add-staff-email"
                                type="email"
                                inputMode="email"
                                value={addStaffEmail}
                                onChange={(e) => {
                                  setAddStaffEmail(e.target.value);
                                  setAddStaffError("");
                                }}
                                onBlur={() => setAddStaffEmailTouched(true)}
                                placeholder="name@company.co.nz"
                                className={glassFieldClass}
                                autoComplete="off"
                                autoFocus
                                disabled={isInvitingStaff}
                                data-1p-ignore=""
                                data-lpignore="true"
                              />
                              {addStaffEmailTouched && addStaffEmail.trim() && !addStaffEmailValid ? (
                                <p className="text-[11.5px] font-medium" style={{ color: "var(--danger-strong)" }}>
                                  Enter a full email address, like name@company.co.nz.
                                </p>
                              ) : null}
                            </div>
                            <div className="space-y-1.5">
                              <p className="text-[12px] font-medium" style={{ color: "var(--text-main)" }}>Access code</p>
                              {/* The code, and a new one's name beside it. */}
                              <div className="flex items-center gap-2 max-sm:flex-col max-sm:items-stretch">
                                <GlassDropdown
                                  value={addStaffCodeKey}
                                  options={[
                                    { value: "", label: "Create a new code" },
                                    ...linkableAccessCodes.map((row) => ({ value: row.key, label: row.label ? `${row.code} · ${row.label}` : row.code })),
                                  ]}
                                  onChange={(key) => {
                                    setAddStaffCodeKey(toStr(key));
                                    setAddStaffError("");
                                  }}
                                  disabled={isInvitingStaff}
                                  ariaLabel="Access code"
                                  triggerClassName={`${fieldInputClass} min-w-0 flex-1 justify-between`}
                                />
                                {/* A new code: its name, their email unless it's typed over (empty again: back to the email). */}
                                {!addStaffCodeKey ? (
                                  <input
                                    value={addStaffCodeName ?? addStaffEmail}
                                    onChange={(event) => setAddStaffCodeName(event.target.value || null)}
                                    placeholder="Code name (their email if left blank)"
                                    aria-label="New code's name"
                                    maxLength={80}
                                    disabled={isInvitingStaff}
                                    className={`${fieldInputClass} min-w-0 flex-1`}
                                    autoComplete="off"
                                    data-1p-ignore=""
                                    data-lpignore="true"
                                  />
                                ) : null}
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              <p className="text-[12px] font-medium" style={{ color: "var(--text-main)" }}>Role to start in</p>
                              {canChangeStaffRole ? (
                                <GlassDropdown
                                  value={addStaffRoleId}
                                  options={inviteRoleOptions}
                                  onChange={(roleId) => {
                                    setAddStaffRoleId(toStr(roleId));
                                    setAddStaffError("");
                                  }}
                                  disabled={isInvitingStaff || !inviteRoleOptions.length}
                                  ariaLabel="Role to start in"
                                  triggerClassName={`${fieldInputClass} justify-between`}
                                />
                              ) : (
                                <>
                                  <span className={`${fieldInputClass} inline-flex items-center gap-2`}>
                                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: roleColorById.get("staff") || "#7D99B3" }} />
                                    {roleNameById.get("staff") || "Staff"}
                                  </span>
                                  <p className="text-[11.5px] leading-[1.45]" style={{ color: "var(--text-muted)" }}>
                                    New staff start as {roleNameById.get("staff") || "Staff"}. Someone who can change staff roles can change it once they&apos;ve joined.
                                  </p>
                                </>
                              )}
                            </div>
                            {addStaffError ? (
                              <p className="text-[12.5px] font-medium" style={{ color: "var(--danger)" }}>{addStaffError}</p>
                            ) : null}
                          </div>
                          <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
                            <button type="button" onClick={closeAddStaff} disabled={isInvitingStaff} className={secondaryButtonClass}>
                              Cancel
                            </button>
                            <button type="submit" disabled={isInvitingStaff || !addStaffEmailValid} className={primaryButtonClass} style={primaryButtonStyle}>
                              <UserPlus size={15} /> {isInvitingStaff ? "Sending…" : "Send invite"}
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                    </ModalPortal>
                  ) : null}
                  {shouldRenderStaffRemovalModal ? (
                    <ModalPortal>
                    <div className="fixed inset-0 z-[1725] flex items-center justify-center px-4 py-4">
                      <button
                        type="button"
                        aria-label="Close remove staff popup"
                        onClick={() => {
                          if (removingStaffUid) return;
                          setPendingStaffRemoval(null);
                          setStaffRemovalError("");
                        }}
                        className="glass-modal-backdrop absolute inset-0"
                      />
                      <div
                        ref={staffRemovalPanelRef}
                        role="dialog"
                        className="glass-modal-panel relative z-[1726] flex max-h-[calc(100svh-32px)] w-full max-w-[560px] flex-col overflow-hidden"
                      >
                        <GlassModalHeader
                          title="Remove Staff Member"
                          onClose={() => {
                            if (removingStaffUid) return;
                            setPendingStaffRemoval(null);
                            setStaffRemovalError("");
                          }}
                        />
                        {(() => {
                          const removalName = toStr(pendingStaffRemoval?.displayName, "this staff member");
                          const recipient = staffRemovalTransferCandidates.find(
                            (member) => toStr(member.uid) === toStr(pendingStaffRemoval?.transferToUid),
                          );
                          const recipientName = recipient ? toStr(recipient.displayName || recipient.email || recipient.uid) : "the person you choose";
                          const locked = pendingStaffRemoval?.confirmPhase === "type_name" || !!removingStaffUid;
                          return (
                            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                              <div className="space-y-1">
                                <p className="text-[16px] font-semibold" style={{ color: "var(--text-main)" }}>Remove {removalName}?</p>
                                <p className="text-[12.5px] leading-[1.5]" style={{ color: "var(--text-muted)" }}>
                                  They lose access to {toStr(company?.name, "the company")}{" "}straight away. Choose which of their data to hand
                                  to someone else. Nothing is deleted — whatever you don&apos;t transfer stays in the company.
                                </p>
                                {pendingStaffRemoval?.revokeCode ? (
                                  <p className="text-[12.5px] leading-[1.5]" style={{ color: "var(--text-main)" }}>
                                    Their access code{" "}
                                    <span className="font-mono font-semibold">{pendingStaffRemoval.revokeCode.code}</span>
                                    {" "}is revoked once they&apos;re removed.
                                  </p>
                                ) : null}
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-[12px] font-medium" style={{ color: "var(--text-main)" }}>Transfer to</p>
                                <GlassDropdown
                                  value={pendingStaffRemoval?.transferToUid ?? ""}
                                  options={[
                                    { value: "", label: "Choose staff member" },
                                    ...staffRemovalTransferCandidates.map((member) => ({ value: member.uid, label: toStr(member.displayName || member.email || member.uid) })),
                                  ]}
                                  onChange={(uid) => {
                                    setStaffRemovalError("");
                                    setPendingStaffRemoval((current) => (current ? { ...current, transferToUid: toStr(uid) } : current));
                                  }}
                                  disabled={locked || !staffRemovalTransferCandidates.length}
                                  ariaLabel="Transfer their data to"
                                  triggerClassName={`${fieldInputClass} justify-between`}
                                />
                                {!staffRemovalTransferCandidates.length ? (
                                  <p className="text-[11.5px] font-medium" style={{ color: "var(--danger-strong)" }}>
                                    There&apos;s no one else in the company to transfer their data to — it stays as described below.
                                  </p>
                                ) : null}
                              </div>
                              <div className="space-y-1.5">
                                {STAFF_REMOVAL_DATA_ROWS.map((row) => {
                                  const RowIcon = row.icon;
                                  const count = pendingStaffRemoval?.counts ? pendingStaffRemoval.counts[row.kind] : null;
                                  const nothing = count === 0;
                                  const on = !nothing && Boolean(pendingStaffRemoval?.transfer[row.kind]) && staffRemovalTransferCandidates.length > 0;
                                  return (
                                    <div
                                      key={row.kind}
                                      className="flex items-start gap-3 rounded-[12px] border border-[var(--glass-border)] bg-[color-mix(in_srgb,var(--panel-bg)_55%,transparent)] px-3 py-2.5"
                                      style={{ opacity: nothing ? 0.6 : 1 }}
                                    >
                                      <span
                                        className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
                                        style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                                      >
                                        <RowIcon size={15} strokeWidth={2.1} />
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                                          {row.label}
                                          <span className={countPillClass} title={count === null ? "Couldn't be counted" : undefined}>{count === null ? "?" : count}</span>
                                        </p>
                                        <p className="mt-0.5 text-[12px] leading-[1.45]" style={{ color: on ? "var(--text-main)" : "var(--text-muted)" }}>
                                          {nothing ? "Nothing to transfer." : on ? row.move(recipientName, removalName) : row.keep(removalName)}
                                        </p>
                                      </div>
                                      <span className="self-center">
                                        <GlassSwitch
                                          size="sm"
                                          checked={on}
                                          disabled={nothing || locked || !staffRemovalTransferCandidates.length}
                                          ariaLabel={`Transfer: ${row.label}`}
                                          onChange={(next) => {
                                            setStaffRemovalError("");
                                            setPendingStaffRemoval((current) =>
                                              current ? { ...current, transfer: { ...current.transfer, [row.kind]: next } } : current,
                                            );
                                          }}
                                        />
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                              <p className="text-[11.5px] leading-[1.45]" style={{ color: "var(--text-muted)" }}>
                                Completed projects keep {removalName} as their assignee, as part of their history.
                              </p>
                              {pendingStaffRemoval?.confirmPhase === "type_name" ? (
                                <div className="space-y-1">
                                  <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                                    Type{" "}
                                    <span className="font-medium" style={{ color: "var(--text-main)" }}>{pendingStaffRemoval?.displayName}</span>
                                    {" "}
                                    to remove this user from the company.
                                  </p>
                                  <input
                                    value={pendingStaffRemoval?.typedName ?? ""}
                                    onChange={(e) => {
                                      setStaffRemovalError("");
                                      setPendingStaffRemoval((current) =>
                                        current
                                          ? {
                                              ...current,
                                              typedName: e.target.value,
                                            }
                                          : current,
                                      );
                                    }}
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    className={fieldInputClass}
                                    placeholder={pendingStaffRemoval?.displayName}
                                  />
                                </div>
                              ) : null}
                              {staffRemovalError ? (
                                <p className="text-[12px] font-semibold" style={{ color: "var(--danger-strong)" }}>
                                  {staffRemovalError}
                                </p>
                              ) : null}
                            </div>
                          );
                        })()}
                        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
                          {pendingStaffRemoval?.confirmPhase === "type_name" ? (
                            <button
                              type="button"
                              onClick={() => {
                                setStaffRemovalError("");
                                setPendingStaffRemoval((current) => (current ? { ...current, confirmPhase: "prompt", typedName: "" } : current));
                              }}
                              disabled={!!removingStaffUid}
                              className={`${secondaryButtonClass} mr-auto`}
                            >
                              Back
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              setPendingStaffRemoval(null);
                              setStaffRemovalError("");
                            }}
                            disabled={!!removingStaffUid}
                            className={secondaryButtonClass}
                          >
                            Cancel
                          </button>
                          {pendingStaffRemoval?.confirmPhase === "type_name" ? (
                            <button
                              type="button"
                              onClick={() => void confirmStaffRemoval()}
                              disabled={
                                !!removingStaffUid ||
                                !namesMatchForConfirmation(pendingStaffRemoval?.typedName ?? "", pendingStaffRemoval?.displayName ?? "")
                              }
                              className={primaryButtonClass}
                              style={{ backgroundImage: "var(--danger-gradient)" }}
                            >
                              {removingStaffUid ? "Removing..." : "Remove"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={advanceStaffRemovalConfirmation}
                              disabled={
                                !!removingStaffUid ||
                                (!!pendingStaffRemoval && staffRemovalNeedsRecipient(pendingStaffRemoval) && !pendingStaffRemoval.transferToUid)
                              }
                              className={primaryButtonClass}
                              style={primaryButtonStyle}
                            >
                              Continue
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    </ModalPortal>
                  ) : null}
                </div>
              )}

              {active === "dashboard" && (
                <div className="grid gap-[18px] max-lg:grid-cols-1 xl:grid-cols-2">
                  <Panel
                    title="Project statuses"
                    icon={KanbanSquare}
                    description="The columns on your Dashboard board, in order — number 1 is where every new project starts. Drag to reorder; expand a status to add sub-stages. Tick Completed on the status that means a job is finished."
                  >
                    {/* Narrower than 448px (beside another card on most desktops, as well as on a phone): the Completed
                        button and the sub-stage count shrink to their icon and number, so the name keeps its room. */}
                    <div className="@container space-y-1.5">
                      {statuses.map((row, idx) => (
                        <div key={`project_status_${idx}`}>
                          <div
                            id={`settings_status_${idx}`}
                            className={`${listRowClass} @max-md:gap-1`}
                            style={{ opacity: statusDragIndex === idx ? 0.45 : 1 }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                            }}
                            onDragEnter={(e) => {
                              e.preventDefault();
                              if (statusDragIndex == null || statusDragIndex === idx) return;
                              setStatuses((prev) => moveRowTo(prev, statusDragIndex, idx));
                              setStatusDragIndex(idx);
                              setStatusDragOverIndex(idx);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              setStatusDragIndex(null);
                              setStatusDragOverIndex(null);
                              endRowDrag();
                              triggerAutosaveAfterRowDrop();
                            }}
                          >
                            <button
                              type="button"
                              draggable
                              onDragStart={(e) => {
                                setStatusDragIndex(idx);
                                setStatusDragOverIndex(idx);
                                e.dataTransfer.setData("text/plain", `${idx}`);
                                startRowDrag(e, `settings_status_${idx}`, row.name, row.color);
                              }}
                              onDragEnd={() => {
                                setStatusDragIndex(null);
                                setStatusDragOverIndex(null);
                                endRowDrag();
                              }}
                              className={gripClass}
                              title="Drag to reorder"
                            >
                              <GripVertical size={15} />
                            </button>
                            <StatusNumber index={idx} startsHere="New projects start here" />
                            <ColorCircle value={row.color || "#64748B"} onChange={(hex) => setStatuses((prev) => prev.map((v, i) => (i === idx ? { ...v, color: hex } : v)))} />
                            <input
                              value={row.name}
                              placeholder="Status name"
                              onChange={(e) => setStatuses((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))}
                              className={gridCellInputClass}
                            />
                            {/* Icon only on phones, where the row has no room for the word. Once a status is
                                ticked as the completed one, only that row shows the button (to un-tick it); the
                                others keep an invisible copy so their rows don't shift. */}
                            <button
                              type="button"
                              role="switch"
                              aria-checked={Boolean(row.isComplete)}
                              aria-label="Completed status"
                              aria-hidden={(hasCompletedStatus && !row.isComplete) || undefined}
                              tabIndex={hasCompletedStatus && !row.isComplete ? -1 : undefined}
                              disabled={hasCompletedStatus && !row.isComplete}
                              // Only one status can be the completed one: switching this on switches the others off.
                              onClick={() =>
                                setStatuses((prev) => prev.map((v, i) => ({ ...v, isComplete: i === idx ? !v.isComplete : false })))
                              }
                              title={
                                row.isComplete
                                  ? "The completed status — projects here count as finished, and are archived as set under Finished projects"
                                  : "Make this the completed status (only one status can be)"
                              }
                              className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium transition max-sm:w-7 max-sm:justify-center max-sm:px-0 @max-md:w-7 @max-md:justify-center @max-md:px-0 ${
                                hasCompletedStatus && !row.isComplete ? "invisible" : ""
                              }`}
                              style={
                                row.isComplete
                                  ? { borderColor: "var(--success-border)", backgroundColor: "var(--success-soft)", color: "var(--success-strong)" }
                                  : { borderColor: "var(--glass-border)", backgroundColor: "transparent", color: "var(--text-muted)" }
                              }
                            >
                              <CheckCircle2 size={13} />
                              <span className="max-sm:hidden @max-md:hidden">Completed</span>
                            </button>
                            {/* Won (Reports): the same — one status at most, the others' an invisible copy. */}
                            <button
                              type="button"
                              role="switch"
                              aria-checked={Boolean(row.isWon)}
                              aria-label="Won status"
                              aria-hidden={(hasWonStatus && !row.isWon) || undefined}
                              tabIndex={hasWonStatus && !row.isWon ? -1 : undefined}
                              disabled={hasWonStatus && !row.isWon}
                              onClick={() => setStatuses((prev) => prev.map((v, i) => ({ ...v, isWon: i === idx ? !v.isWon : false })))}
                              title={
                                row.isWon
                                  ? "The won status — in Reports, a project reaching it (or any status after it) counts as a won job, as one whose quote was accepted does"
                                  : "Make this the won status for Reports (only one status can be)"
                              }
                              className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium transition max-sm:w-7 max-sm:justify-center max-sm:px-0 @max-md:w-7 @max-md:justify-center @max-md:px-0 ${
                                hasWonStatus && !row.isWon ? "invisible" : ""
                              }`}
                              style={
                                row.isWon
                                  ? { borderColor: "color-mix(in srgb, #D97706 45%, var(--glass-border))", backgroundColor: "color-mix(in srgb, #F59E0B 14%, transparent)", color: "#B45309" }
                                  : { borderColor: "var(--glass-border)", backgroundColor: "transparent", color: "var(--text-muted)" }
                              }
                            >
                              <Trophy size={13} />
                              <span className="max-sm:hidden @max-md:hidden">Won</span>
                            </button>
                            {projectAutomations.canAutomate ? (
                              <ColumnAutomationButton
                                count={projectAutomations.countFor(row.name.trim())}
                                disabled={!row.name.trim()}
                                onOpen={() => projectAutomations.open({ status: row.name.trim(), subStage: "", color: row.color || "#64748B" })}
                              />
                            ) : null}
                            {(row.subStages ?? []).length > 0 ? (
                              <span className={countPillClass} title="Sub-stages">
                                {(row.subStages ?? []).length}
                                <span className="max-sm:hidden @max-md:hidden">&nbsp;sub-stages</span>
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => toggleStatusSubStagesExpanded(idx)}
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]"
                              style={{ color: "var(--text-muted)" }}
                              title={statusSubStagesExpanded[idx] ? "Hide sub-stages" : "Sub-stages"}
                            >
                              <ChevronDown
                                size={15}
                                style={{ transform: statusSubStagesExpanded[idx] ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms ease" }}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeFromList(setStatuses, idx, row, `${toStr(row.name, "Status")} removed`)}
                              className={dangerIconButtonClass}
                              title="Remove"
                            >
                              <X size={15} />
                            </button>
                          </div>
                          {statusSubStagesExpanded[idx] && (
                            <div className="my-1.5 ml-8 grid gap-1.5 rounded-[12px] border border-dashed p-2.5 max-sm:ml-3" style={{ borderColor: "color-mix(in srgb, var(--text-main) 16%, transparent)" }}>
                              <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                                Sub-stages are optional — click this status&apos;s column header on the Dashboard board to drill in.
                              </p>
                              {(row.subStages ?? []).map((sub, subIdx) => (
                                <div key={`project_status_${idx}_sub_${subIdx}`} className={listRowClass}>
                                  <ColorCircle value={sub.color || "#64748B"} size={24} onChange={(hex) => updateStatusSubStage(idx, subIdx, { color: hex })} />
                                  <input
                                    value={sub.name}
                                    onChange={(e) => updateStatusSubStage(idx, subIdx, { name: e.target.value })}
                                    placeholder="Sub-stage name"
                                    className={gridCellInputClass}
                                  />
                                  {projectAutomations.canAutomate ? (
                                    <ColumnAutomationButton
                                      count={projectAutomations.countFor(row.name.trim(), sub.name.trim())}
                                      disabled={!row.name.trim() || !sub.name.trim()}
                                      onOpen={() =>
                                        projectAutomations.open({ status: row.name.trim(), subStage: sub.name.trim(), color: sub.color || "#64748B" })
                                      }
                                    />
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => setDefaultStatusSubStage(idx, subIdx)}
                                    title="Cards entering this status land here by default — only one sub-stage per status can be the default"
                                    className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11.5px] font-semibold"
                                    style={{ color: sub.isDefault ? "var(--brand-strong)" : "var(--text-muted)" }}
                                  >
                                    <span
                                      className="inline-flex h-4 w-4 items-center justify-center rounded-full border-[1.5px]"
                                      style={{ borderColor: sub.isDefault ? "var(--brand)" : "color-mix(in srgb, var(--text-main) 25%, transparent)" }}
                                    >
                                      {sub.isDefault ? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--brand)" }} /> : null}
                                    </span>
                                    Default
                                  </button>
                                  <button type="button" onClick={() => removeStatusSubStage(idx, subIdx)} className={dangerIconButtonClass} title="Remove">
                                    <X size={15} />
                                  </button>
                                </div>
                              ))}
                              <div>
                                <button type="button" onClick={() => addStatusSubStage(idx)} className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: "var(--brand-strong)" }}>
                                  <Plus size={14} /> Add sub-stage
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      <button type="button" onClick={() => setStatuses((prev) => [...prev, { name: "", color: "#64748B", isComplete: false }])} className={`${secondaryButtonClass} mt-1.5`}>
                        <Plus size={14} /> Add status
                      </button>
                    </div>
                  </Panel>
                  <Panel title="Contact categories" icon={Contact} description="Group your contacts — the colour themes each contact's card. Drag to set the order they're listed in. Staff is built in: every staff member is in everyone's Contacts under it.">
                    <div className="space-y-1.5">
                      {contactCategories.map((row, idx) => (
                        <div
                          key={`contact_category_${idx}`}
                          id={`settings_contact_category_${idx}`}
                          className={listRowClass}
                          style={{ opacity: contactCategoryDragIndex === idx ? 0.45 : 1 }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDragEnter={(e) => {
                            e.preventDefault();
                            if (contactCategoryDragIndex == null || contactCategoryDragIndex === idx) return;
                            setContactCategories((prev) => moveRowTo(prev, contactCategoryDragIndex, idx));
                            setContactCategoryDragIndex(idx);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setContactCategoryDragIndex(null);
                            endRowDrag();
                          }}
                        >
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              setContactCategoryDragIndex(idx);
                              e.dataTransfer.setData("text/plain", `${idx}`);
                              startRowDrag(e, `settings_contact_category_${idx}`, row.name, row.color);
                            }}
                            onDragEnd={() => {
                              setContactCategoryDragIndex(null);
                              endRowDrag();
                            }}
                            className={gripClass}
                            title="Drag to reorder"
                          >
                            <GripVertical size={15} />
                          </button>
                          <ColorCircle value={row.color || "#7D99B3"} onChange={(hex) => setContactCategories((prev) => prev.map((v, i) => (i === idx ? { ...v, color: hex } : v)))} />
                          <input
                            value={row.name}
                            placeholder="Category name"
                            readOnly={isStaffContactCategory(row.name)}
                            title={isStaffContactCategory(row.name) ? "Built in — every staff member is listed under Staff" : undefined}
                            onChange={(e) => setContactCategories((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))}
                            className={gridCellInputClass}
                          />
                          {isStaffContactCategory(row.name) ? (
                            <span className={`${dangerIconButtonClass} pointer-events-none`} title="Built in — can't be removed" aria-label="Built in — can't be removed">
                              <Lock size={14} />
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => removeFromList(setContactCategories, idx, row, `${toStr(row.name, "Category")} removed`)}
                              className={dangerIconButtonClass}
                              title="Remove"
                            >
                              <X size={15} />
                            </button>
                          )}
                        </div>
                      ))}
                      <button type="button" onClick={() => setContactCategories((prev) => [...prev, { name: "", color: "#7D99B3" }])} className={`${secondaryButtonClass} mt-1.5`}>
                        <Plus size={14} /> Add category
                      </button>
                    </div>
                  </Panel>
                  {canSeeCompletionBonus ? (
                    <Panel
                      title="Completion bonus"
                      icon={Award}
                      description="Jobs completed within a bonus period count towards that period's bonus, paid after it ends — the Completed pop-up on the Dashboard sorts them into these periods. Only people with dashboard.complete.bonus see this."
                      allowOverflow
                    >
                      {/* Labels above full-width fields — this panel sits in a half-width column, too narrow for
                          FieldRow's label column. */}
                      <div className="grid gap-3.5">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="grid min-w-0 gap-1.5">
                            <p className="text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>Bonus period</p>
                            <GlassDropdown
                              value={String(bonusPeriodMonths)}
                              options={BONUS_PERIOD_MONTH_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
                              onChange={(next) => setBonusPeriodMonths(Number(next) || 3)}
                              ariaLabel="Bonus period"
                              disabled={!canEditCompanySettings}
                              triggerClassName={`${fieldInputClass} w-full justify-between`}
                            />
                          </div>
                          <div className="grid min-w-0 gap-1.5">
                            <p className="text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>Starting in</p>
                            <GlassDropdown
                              value={String(bonusStartMonth)}
                              options={BONUS_MONTH_NAMES.map((name, month) => ({ value: String(month), label: name }))}
                              onChange={(next) => setBonusStartMonth(Number(next) || 0)}
                              ariaLabel="Bonus period starts in"
                              disabled={!canEditCompanySettings}
                              triggerClassName={`${fieldInputClass} w-full justify-between`}
                            />
                          </div>
                        </div>
                        <div className="grid min-w-0 gap-1.5 border-t border-[var(--glass-border)] pt-3.5">
                          <p className="text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>Bonus paid</p>
                          <GlassDropdown
                            value={String(bonusPaidMonthsAfter)}
                            options={BONUS_PAID_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
                            onChange={(next) => setBonusPaidMonthsAfter(Number(next))}
                            ariaLabel="Bonus paid"
                            disabled={!canEditCompanySettings}
                            triggerClassName={`${fieldInputClass} w-full justify-between`}
                          />
                          <p className="text-[12px] leading-[1.45]" style={{ color: "var(--text-muted)" }}>
                            {(() => {
                              // An example: this cycle's first period and the month it's paid in.
                              const last = (bonusStartMonth + bonusPeriodMonths - 1) % 12;
                              const paid = (bonusStartMonth + bonusPeriodMonths - 1 + bonusPaidMonthsAfter) % 12;
                              const span =
                                bonusPeriodMonths === 1
                                  ? BONUS_MONTH_NAMES[bonusStartMonth]
                                  : `${BONUS_MONTH_NAMES[bonusStartMonth].slice(0, 3)} – ${BONUS_MONTH_NAMES[last].slice(0, 3)}`;
                              return `e.g. jobs completed ${span} are paid in ${BONUS_MONTH_NAMES[paid]}.`;
                            })()}
                          </p>
                        </div>
                        <div className="grid min-w-0 gap-1.5 border-t border-[var(--glass-border)] pt-3.5">
                          <p className="text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>Non qualified below</p>
                          <label className={`${fieldInputClass} flex w-full items-center gap-1`}>
                            <span style={{ color: "var(--text-muted)" }}>{currencySymbol(companyCurrency)}</span>
                            <input
                              value={bonusMinimumQuote}
                              onChange={(e) => setBonusMinimumQuote(e.target.value.replace(/[^\d.]/g, ""))}
                              inputMode="decimal"
                              placeholder="No minimum"
                              aria-label="Non qualified below"
                              disabled={!canEditCompanySettings}
                              className="min-w-0 flex-1 bg-transparent outline-none"
                            />
                          </label>
                          <p className="text-[12px] leading-[1.45]" style={{ color: "var(--text-muted)" }}>
                            A completed job whose accepted quote is under this is flagged in the Completed pop-up. Leave blank for no minimum.
                          </p>
                        </div>
                      </div>
                    </Panel>
                  ) : null}
                  <Panel title="Tags" icon={Tags} description="Tags you can put on projects. The number is how many projects use each one.">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {projectTagUsage.map((row, idx) => hiddenTagKeys.includes(row.value.trim().toLowerCase()) ? null : (
                        <span key={`tag_row_${idx}`} className={chipClass}>
                          <input
                            value={row.value}
                            onChange={(e) => setProjectTagUsage((prev) => prev.map((v, i) => (i === idx ? { ...v, value: e.target.value } : v)))}
                            placeholder="Tag"
                            size={Math.max(4, row.value.length + 1)}
                            className="min-w-0 bg-transparent text-[12.5px] font-semibold outline-none"
                            style={{ color: "var(--text-main)" }}
                          />
                          <span className={countPillClass} title="Projects using this tag">{String(row.count || "0")}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              // A blank tag that was never named goes straight away; a real one asks first,
                              // because deleting it also takes it off every project using it.
                              if (!row.value.trim()) {
                                removeFromList(setProjectTagUsage, idx, row, "Tag removed");
                                return;
                              }
                              tagDeleteOriginElRef.current = e.currentTarget;
                              setTagDeleteOrigin(captureGlassModalOrigin(e));
                              setPendingTagDelete({ index: idx, value: row.value.trim(), count: Math.max(0, Number(row.count || 0) || 0) });
                            }}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                            style={{ color: "var(--text-muted)" }}
                            title="Remove tag"
                          >
                            <X size={13} />
                          </button>
                        </span>
                      ))}
                      <button type="button" onClick={() => setProjectTagUsage((prev) => [...prev, { value: "", count: "0" }])} className={chipAddClass}>
                        <Plus size={14} /> Add tag
                      </button>
                    </div>
                  </Panel>
                  {shouldRenderTagDeleteModal && pendingTagDelete ? (
                    <ModalPortal>
                    <div className="fixed inset-0 z-[1700] flex items-center justify-center px-4 py-4">
                      <button
                        type="button"
                        aria-label="Close delete tag popup"
                        onClick={() => setPendingTagDelete(null)}
                        className="glass-modal-backdrop absolute inset-0"
                      />
                      <div ref={tagDeletePanelRef} className="glass-modal-panel relative z-[1701] flex w-full max-w-[440px] flex-col overflow-hidden">
                        <GlassModalHeader title="Delete tag?" onClose={() => setPendingTagDelete(null)} />
                        <div className="space-y-2 px-4 py-4">
                          <p className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                            {pendingTagDelete.count > 0
                              ? `“${pendingTagDelete.value}” is on ${pendingTagDelete.count} ${pendingTagDelete.count === 1 ? "project" : "projects"}. Deleting it takes it off ${pendingTagDelete.count === 1 ? "that project" : "all of them"}, including archived ones.`
                              : `“${pendingTagDelete.value}” isn't on any projects.`}
                          </p>
                          {pendingTagDelete.count > 0 ? (
                            <p className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                              The projects themselves stay as they are — only the tag is removed. Once it&apos;s gone, adding the tag again won&apos;t put it back on them.
                            </p>
                          ) : null}
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
                          <button type="button" onClick={() => setPendingTagDelete(null)} className={secondaryButtonClass}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const target = pendingTagDelete;
                              setPendingTagDelete(null);
                              // Hidden straight away, but only taken off the projects (which can't be put back) as the
                              // Undo bar goes without Undo being pressed — commitTagDelete. Undo just shows it again.
                              const key = target.value.toLowerCase();
                              const companyId = activeCompanyId;
                              setHiddenTagKeys((prev) => [...prev, key]);
                              offerUndo(`${target.value} deleted`, () => setHiddenTagKeys((prev) => prev.filter((k) => k !== key)), {
                                commit: () => commitTagDelete(companyId, target.value),
                              });
                            }}
                            className="inline-flex h-9 items-center justify-center rounded-[10px] border px-4 text-[12px] font-medium text-white transition hover:brightness-95"
                            style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                    </ModalPortal>
                  ) : null}
                  <Panel
                    title="Finished projects"
                    icon={Archive}
                    description={
                      projectArchiveAfter === "instant"
                        ? "As soon as a project is set to the Completed status, its client portal link stops working and it moves to the Archive. A project restored from the Archive stays out until it's completed again. Archived projects are kept until someone restores them or deletes them permanently."
                        : "Once a project has been in the Completed status for this long, its client portal link stops working and it moves to the Archive. Archived projects are kept until someone restores them or deletes them permanently."
                    }
                    allowOverflow
                  >
                    <FieldRow label="Archive completed projects after">
                      <GlassDropdown
                        value={projectArchiveAfter}
                        options={PROJECT_ARCHIVE_DELAY_OPTIONS}
                        onChange={(next) => setProjectArchiveAfter(normalizeProjectArchiveDelay(next))}
                        ariaLabel="Archive completed projects after"
                        disabled={!canEditCompanySettings}
                        triggerClassName={`${fieldInputClass} max-w-[220px] justify-between`}
                      />
                    </FieldRow>
                  </Panel>
                </div>
              )}

              {active === "calendar" && (
                <div className="grid gap-[18px] max-lg:grid-cols-1 xl:grid-cols-2">
                  {/* Settings column: client portal, old events, workdays. Categories sit in the other column. */}
                  <div className="grid content-start gap-[18px] max-lg:grid-cols-1">
                    <Panel
                      title="Client portal"
                      icon={Eye}
                      description="Events linked to a project can show on that project's client portal, in a Schedule tab. Each event has its own switch — this sets whether it starts on or off."
                    >
                      <FieldRow label="Show linked events to the client by default">
                        <GlassSwitch
                          checked={calendarShowToClientDefault}
                          ariaLabel="Show linked events to the client by default"
                          disabled={!canEditCompanySettings}
                          onChange={(on) => setCalendarShowToClientDefault(on)}
                        />
                      </FieldRow>
                    </Panel>
                    <Panel
                      title="Old events"
                      icon={Archive}
                      description="Events that finished longer ago than this are archived automatically — they're kept, but no longer shown on the calendar."
                    >
                      <FieldRow label="Archive events after">
                        <GlassDropdown
                          value={calendarRetention}
                          options={CALENDAR_RETENTION_OPTIONS}
                          onChange={(next) => setCalendarRetention(normalizeCalendarRetention(next))}
                          ariaLabel="Archive events after"
                          disabled={!canEditCompanySettings}
                          triggerClassName={`${fieldInputClass} max-w-[220px] justify-between`}
                        />
                      </FieldRow>
                    </Panel>
                    <Panel title="Workdays" icon={CalendarDays} description="The days your business works. The rest are shown crossed out on the calendar (you can still add events to them), or can be left out.">
                      <div className="flex flex-wrap gap-1.5">
                        {([1, 2, 3, 4, 5, 6, 0] as const).map((dow) => {
                          const on = calendarWorkdays.includes(dow);
                          const label = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(2024, 0, 7 + dow));
                          return (
                            <button
                              key={dow}
                              type="button"
                              aria-pressed={on}
                              disabled={!canEditCompanySettings}
                              onClick={() =>
                                setCalendarWorkdays((prev) => (prev.includes(dow) ? prev.filter((v) => v !== dow) : [...prev, dow].sort()))
                              }
                              className="inline-flex h-9 min-w-[52px] items-center justify-center rounded-full border px-3 text-[13px] font-semibold transition disabled:opacity-60"
                              style={
                                on
                                  ? { backgroundImage: "var(--brand-gradient)", color: "#fff", borderColor: "transparent" }
                                  : {
                                      borderColor: "var(--glass-border)",
                                      color: "var(--text-muted)",
                                      textDecoration: "line-through",
                                      backgroundImage:
                                        "repeating-linear-gradient(135deg, color-mix(in srgb, var(--text-main) 7%, transparent) 0 2px, transparent 2px 7px)",
                                    }
                              }
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-3 border-t border-[var(--glass-border)]">
                        <FieldRow
                          label="Show non-workdays"
                          hint="When off, the Month and Week views leave the non-workdays out. The Year view always shows every day."
                        >
                          <GlassSwitch
                            checked={calendarShowNonWorkdays}
                            ariaLabel="Show non-workdays"
                            disabled={!canEditCompanySettings}
                            onChange={(on) => setCalendarShowNonWorkdays(on)}
                          />
                        </FieldRow>
                      </div>
                    </Panel>
                    <Panel
                      title="Public holidays"
                      icon={Globe2}
                      description="New Zealand's public holidays show on the calendar with their name, crossed out like a non-workday — worked out for every year automatically. Pick your region to add its anniversary day."
                      allowOverflow
                    >
                      <FieldRow label="Region" hint="Not listed? Pick the region whose anniversary day your area takes.">
                        <GlassDropdown
                          value={calendarHolidayRegion}
                          options={NZ_HOLIDAY_REGION_OPTIONS}
                          onChange={(next) => setCalendarHolidayRegion(normalizeNzHolidayRegion(next))}
                          ariaLabel="Public holidays region"
                          disabled={!canEditCompanySettings}
                          triggerClassName={`${fieldInputClass} max-w-[260px] justify-between`}
                        />
                      </FieldRow>
                      {/* The next few, for the region picked — to see what it'll show. */}
                      {(() => {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const upcoming = [
                          ...nzPublicHolidays(today.getFullYear(), calendarHolidayRegion),
                          ...nzPublicHolidays(today.getFullYear() + 1, calendarHolidayRegion),
                        ]
                          .filter((h) => h.date.getTime() >= today.getTime())
                          .slice(0, 5);
                        if (!upcoming.length) return null;
                        return (
                          <div className="mt-3 border-t border-[var(--glass-border)] pt-3">
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
                              Coming up
                            </p>
                            {upcoming.map((h) => (
                              <div
                                key={`${h.date.getTime()}_${h.name}`}
                                className="flex items-center justify-between gap-3 py-1 text-[13px] font-medium"
                                style={{ color: "var(--text-main)" }}
                              >
                                <span className="min-w-0 truncate">{h.name}</span>
                                <span className="shrink-0" style={{ color: "var(--text-muted)" }}>
                                  {new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(h.date)} {activeDate(h.date)}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </Panel>
                  </div>
                  <Panel
                    title="Calendar categories"
                    icon={CalendarDays}
                    description="Every event on the Calendar tab belongs to one of these — its colour shows on the calendar and each can be shown or hidden there. Click a category to choose which roles can edit, view or not see it. Drag to set the order."
                  >
                    <div className="space-y-1.5">
                      {calendarCategories.map((row, idx) => (
                        <div
                          key={row.id || `calendar_category_${idx}`}
                          id={`settings_calendar_category_${idx}`}
                          className={`${listRowClass} cursor-pointer`}
                          style={{ opacity: calendarCategoryDragIndex === idx ? 0.45 : 1 }}
                          onClick={(e) => {
                            // Ignore controls, and clicks bubbling from portalled pop-overs (e.g. the colour picker).
                            if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest("input, button")) return;
                            openCalendarAccess(idx, e);
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDragEnter={(e) => {
                            e.preventDefault();
                            if (calendarCategoryDragIndex == null || calendarCategoryDragIndex === idx) return;
                            setCalendarCategories((prev) => moveRowTo(prev, calendarCategoryDragIndex, idx));
                            setCalendarCategoryDragIndex(idx);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setCalendarCategoryDragIndex(null);
                            endRowDrag();
                          }}
                        >
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              setCalendarCategoryDragIndex(idx);
                              e.dataTransfer.setData("text/plain", `${idx}`);
                              startRowDrag(e, `settings_calendar_category_${idx}`, row.name, row.color);
                            }}
                            onDragEnd={() => {
                              setCalendarCategoryDragIndex(null);
                              endRowDrag();
                            }}
                            className={gripClass}
                            title="Drag to reorder"
                          >
                            <GripVertical size={15} />
                          </button>
                          <ColorCircle value={row.color || "#7D99B3"} onChange={(hex) => setCalendarCategories((prev) => prev.map((v, i) => (i === idx ? { ...v, color: hex } : v)))} />
                          <input
                            value={row.name}
                            placeholder="Category name"
                            onChange={(e) => setCalendarCategories((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))}
                            className={gridCellInputClass}
                          />
                          <button
                            type="button"
                            onClick={(e) => openCalendarAccess(idx, e)}
                            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition hover:brightness-95"
                            style={{ borderColor: "var(--glass-border)", color: "var(--text-main)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}
                            title="Choose which roles can see and edit this category"
                          >
                            <Shield size={13} style={{ color: "var(--text-muted)" }} />
                            <span className="hidden sm:inline">Access</span>
                            {row.access && Object.keys(row.access).length ? (
                              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--brand)" }} title="Custom access set" />
                            ) : null}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFromList(setCalendarCategories, idx, row, `${toStr(row.name, "Category")} removed`)}
                            className={dangerIconButtonClass}
                            title="Remove — its events stay, shown as uncategorised"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setCalendarCategories((prev) => [...prev, { id: newCalendarId("cat"), name: "", color: form.themeColor || "#2F6BFF" }])}
                        className={`${secondaryButtonClass} mt-1.5`}
                      >
                        <Plus size={14} /> Add category
                      </button>
                    </div>
                  </Panel>
                  {shouldRenderCalendarAccessModal && activeCalendarCategory ? (
                    <ModalPortal>
                    <div className="fixed inset-0 z-[1750] flex items-center justify-center px-4 py-4">
                      <button type="button" aria-label="Close category access" onClick={() => setCalendarAccessIndex(null)} className="glass-modal-backdrop absolute inset-0" />
                      <div ref={calendarAccessPanelRef} role="dialog" className="glass-modal-panel relative z-[1751] flex max-h-[calc(100svh-32px)] w-full max-w-[560px] flex-col overflow-hidden">
                        <GlassModalHeader
                          title={<>{activeCalendarCategory.name || "Untitled category"} access</>}
                          icon={<span className="block h-3.5 w-3.5 rounded-full" style={{ backgroundColor: activeCalendarCategory.color || "#7D99B3" }} />}
                          onClose={() => setCalendarAccessIndex(null)}
                        />
                        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
                          <p className="pb-1 text-[12.5px]" style={{ color: "var(--text-muted)" }}>
                            <b className="font-medium" style={{ color: "var(--text-main)" }}>Edit</b> can add, move and delete events in this category.{" "}
                            <b className="font-medium" style={{ color: "var(--text-main)" }}>View</b> can only open them.{" "}
                            <b className="font-medium" style={{ color: "var(--text-main)" }}>No access</b> doesn&apos;t see them at all.
                          </p>
                          {roles.map((role) => {
                            const roleKey = normalizeRoleKey(role.id || role.name);
                            const alwaysEdit = roleKey === "owner" || roleKey === "admin";
                            const level = alwaysEdit ? "edit" : calendarLevelFor(activeCalendarCategory, role);
                            const noCalendar = !alwaysEdit && !hasPermissionKey(role.permissions, "calendar.view");
                            return (
                              <div key={role.id || role.name} className={`${listRowClass} flex-wrap`}>
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: role.color || "#7D99B3" }} />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[13.5px] font-medium" style={{ color: "var(--text-main)" }}>{toStr(role.name, "Untitled Role")}</p>
                                  {noCalendar && level !== "none" ? (
                                    <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>Needs the Calendar permission to open the Calendar tab</p>
                                  ) : null}
                                </div>
                                {alwaysEdit ? (
                                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}>
                                    <Lock size={12} /> Always edit
                                  </span>
                                ) : (
                                  <Segmented<CalendarAccessLevel>
                                    size="sm"
                                    tone="brand"
                                    value={level}
                                    disabled={!canEditCompanySettings}
                                    options={[
                                      { value: "edit", label: "Edit" },
                                      { value: "view", label: "View" },
                                      { value: "none", label: "No access" },
                                    ]}
                                    onChange={(next) => setCalendarLevel(role, next)}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
                          <button type="button" onClick={() => setCalendarAccessIndex(null)} className={primaryButtonClass} style={primaryButtonStyle}>
                            Done
                          </button>
                        </div>
                      </div>
                    </div>
                    </ModalPortal>
                  ) : null}
                </div>
              )}

              {active === "leads" && (
                <div className="grid gap-[18px] max-lg:grid-cols-1 xl:grid-cols-2">
                  <div className="min-w-0 xl:col-span-2">
                    <LeadFormsPanel companyId={activeCompanyId} forms={leadForms} setForms={setLeadForms} />
                  </div>
                  <LeadInboxPanel key={activeCompanyId} companyId={activeCompanyId} savedInbox={company?.leadInbox} />
                  <Panel
                    title="Lead statuses"
                    icon={Inbox}
                    description="The columns on your Leads board, in order — number 1 is where every new lead starts, whether it comes from a form, your leads inbox, Zapier or Create Lead. Drag to reorder."
                  >
                    <div className="space-y-1.5">
                      {leadStatuses.map((row, idx) => (
                        <div
                          key={`lead_status_${idx}`}
                          id={`settings_lead_status_${idx}`}
                          className={listRowClass}
                          style={{ opacity: leadStatusDragIndex === idx ? 0.45 : 1 }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDragEnter={(e) => {
                            e.preventDefault();
                            if (leadStatusDragIndex == null || leadStatusDragIndex === idx) return;
                            setLeadStatuses((prev) => moveRowTo(prev, leadStatusDragIndex, idx));
                            setLeadStatusDragIndex(idx);
                            setLeadStatusDragOverIndex(idx);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setLeadStatusDragIndex(null);
                            setLeadStatusDragOverIndex(null);
                            endRowDrag();
                            triggerAutosaveAfterRowDrop();
                          }}
                        >
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              setLeadStatusDragIndex(idx);
                              setLeadStatusDragOverIndex(idx);
                              e.dataTransfer.setData("text/plain", `${idx}`);
                              startRowDrag(e, `settings_lead_status_${idx}`, row.name, row.color);
                            }}
                            onDragEnd={() => {
                              setLeadStatusDragIndex(null);
                              setLeadStatusDragOverIndex(null);
                              endRowDrag();
                            }}
                            className={gripClass}
                            title="Drag to reorder"
                          >
                            <GripVertical size={15} />
                          </button>
                          <StatusNumber index={idx} startsHere="New leads start here" />
                          <ColorCircle value={row.color || "#64748B"} onChange={(hex) => setLeadStatuses((prev) => prev.map((v, i) => (i === idx ? { ...v, color: hex } : v)))} />
                          <input
                            value={row.name}
                            placeholder="Status name"
                            onChange={(e) => setLeadStatuses((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))}
                            className={gridCellInputClass}
                          />
                          {leadAutomations.canAutomate ? (
                            <ColumnAutomationButton
                              count={leadAutomations.countFor(row.name.trim())}
                              disabled={!row.name.trim()}
                              onOpen={() => leadAutomations.open({ status: row.name.trim(), subStage: "", color: row.color || "#64748B" })}
                            />
                          ) : null}
                          <button
                            type="button"
                            onClick={() => removeFromList(setLeadStatuses, idx, row, `${toStr(row.name, "Status")} removed`)}
                            className={dangerIconButtonClass}
                            title="Remove"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                      <button type="button" onClick={() => setLeadStatuses((prev) => [...prev, { name: "", color: "#64748B" }])} className={`${secondaryButtonClass} mt-1.5`}>
                        <Plus size={14} /> Add status
                      </button>
                    </div>
                  </Panel>
                </div>
              )}

              {active === "smalljobs" && (
                <div className="grid gap-[18px] max-lg:grid-cols-1 xl:grid-cols-2">
                  <Panel
                    title="Small job statuses"
                    icon={Hammer}
                    description="The statuses on your Small Jobs list, in order — number 1 is where every new small job starts. Drag to reorder."
                  >
                    <div className="space-y-1.5">
                      {smallJobStatuses.map((row, idx) => (
                        <div
                          key={`small_job_status_${idx}`}
                          id={`settings_small_job_status_${idx}`}
                          className={listRowClass}
                          style={{ opacity: smallJobStatusDragIndex === idx ? 0.45 : 1 }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDragEnter={(e) => {
                            e.preventDefault();
                            if (smallJobStatusDragIndex == null || smallJobStatusDragIndex === idx) return;
                            setSmallJobStatuses((prev) => moveRowTo(prev, smallJobStatusDragIndex, idx));
                            setSmallJobStatusDragIndex(idx);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setSmallJobStatusDragIndex(null);
                            endRowDrag();
                            triggerAutosaveAfterRowDrop();
                          }}
                        >
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              setSmallJobStatusDragIndex(idx);
                              e.dataTransfer.setData("text/plain", `${idx}`);
                              startRowDrag(e, `settings_small_job_status_${idx}`, row.name, row.color);
                            }}
                            onDragEnd={() => {
                              setSmallJobStatusDragIndex(null);
                              endRowDrag();
                            }}
                            className={gripClass}
                            title="Drag to reorder"
                          >
                            <GripVertical size={15} />
                          </button>
                          <StatusNumber index={idx} startsHere="New small jobs start here" />
                          <ColorCircle value={row.color || "#64748B"} onChange={(hex) => setSmallJobStatuses((prev) => prev.map((v, i) => (i === idx ? { ...v, color: hex } : v)))} />
                          <input
                            value={row.name}
                            placeholder="Status name"
                            onChange={(e) => setSmallJobStatuses((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))}
                            className={gridCellInputClass}
                          />
                          <button
                            type="button"
                            onClick={() => removeFromList(setSmallJobStatuses, idx, row, `${toStr(row.name, "Status")} removed`)}
                            disabled={smallJobStatuses.length <= 1}
                            className={dangerIconButtonClass}
                            title={smallJobStatuses.length <= 1 ? "Small jobs need at least one status" : "Remove"}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                      <button type="button" onClick={() => setSmallJobStatuses((prev) => [...prev, { name: "", color: "#64748B" }])} className={`${secondaryButtonClass} mt-1.5`}>
                        <Plus size={14} /> Add status
                      </button>
                    </div>
                  </Panel>
                </div>
              )}

              {active === "sales" && (
                <div className="grid gap-[18px] max-lg:grid-cols-1 xl:grid-cols-2">
                  <Panel title="GST" icon={Receipt} description="Tax added on top of the quote total.">
                    <FieldRow label="Add GST to the quote total" hint="Adds the GST rate on top of each quote's total, after any discount, so the total includes GST.">
                      <GlassSwitch checked={salesGstEnabled} onChange={(on) => setSalesGstEnabled(on)} ariaLabel="Add GST to the quote total" />
                    </FieldRow>
                    <FieldRow label="GST rate" hint={salesGstEnabled ? "The percent added to the quote total." : "Used once GST is turned on."}>
                      <span className="relative block w-[110px]" style={{ opacity: salesGstEnabled ? 1 : 0.55 }}>
                        <input
                          inputMode="decimal"
                          value={salesGstPercent}
                          onChange={(e) => setSalesGstPercent(e.target.value.replace(/[^0-9.]/g, ""))}
                          className={`${glassFieldSmClass} pr-6 text-right`}
                          placeholder="15"
                          aria-label="GST rate percent"
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                          %
                        </span>
                      </span>
                    </FieldRow>
                  </Panel>
                  <Panel title="Client confirmation" icon={ShieldCheck} description="What staff can do once a quote or specs sheet has gone to the client.">
                    <FieldRow
                      label="Allow reopening for editing"
                      hint="When off, the “Reopen for Editing” button is hidden once a Quote is sent or Specs submitted — the only way back is Reset to Template."
                    >
                      <GlassSwitch checked={salesAllowReopenForEditing} onChange={(on) => setSalesAllowReopenForEditing(on)} ariaLabel="Allow reopening for editing" />
                    </FieldRow>
                  </Panel>
                  <Panel className="xl:col-span-2" title="Layout builders" icon={LayoutTemplate} description="The templates every new quote and specifications sheet starts from, and the items in the Sales item picker.">
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
                      {([
                        { key: "specs", title: "Specs layout", desc: "Grid template with placeholders for project data.", icon: ClipboardList, gradient: "linear-gradient(135deg,#8B5CF6,#6B4FB3)" },
                        { key: "quote", title: "Quote layout", desc: "Grid template, quote extras and grouped pricing.", icon: Receipt, gradient: "var(--brand-gradient)" },
                        {
                          key: "items",
                          title: "Item categories",
                          desc: `${itemCategories.length} categor${itemCategories.length === 1 ? "y" : "ies"} · ${itemCategories.reduce((sum, c) => sum + (c.items?.length ?? 0), 0)} items for the Sales item picker.`,
                          icon: FolderTree,
                          gradient: "linear-gradient(135deg,#14B8A6,#0F766E)",
                        },
                      ] as const).map((tile) => {
                        const TileIcon = tile.icon;
                        return (
                          <button
                            key={tile.key}
                            type="button"
                            onClick={(e) => {
                              if (tile.key === "specs") setIsSpecsLayoutModalOpen(true);
                              else if (tile.key === "quote") setIsQuoteLayoutModalOpen(true);
                              else {
                                itemCategoriesModalOriginElRef.current = e.currentTarget;
                                setItemCategoriesModalOrigin(captureGlassModalOrigin(e));
                                setIsItemCategoriesModalOpen(true);
                              }
                            }}
                            className="grid gap-2.5 rounded-[16px] border p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-glass)]"
                            style={{ borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" }}
                          >
                            <span className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[12px] text-white" style={{ backgroundImage: tile.gradient }}>
                              <TileIcon size={18} />
                            </span>
                            <span>
                              <span className="block text-[14px] font-semibold" style={{ color: "var(--text-main)" }}>{tile.title}</span>
                              <span className="block text-[12px]" style={{ color: "var(--text-muted)" }}>{tile.desc}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </Panel>
                  {renderRoomNamesPanel()}
                  {shouldRenderItemCategoryDeleteModal && pendingItemCategoryDelete ? (
                    // "Delete item category?" — over the Item categories pop-up it opens from (z-1800 > its 1750).
                    <ModalPortal>
                    <div className="fixed inset-0 z-[1800] flex items-center justify-center px-4 py-4">
                      <button
                        type="button"
                        aria-label="Close delete item category popup"
                        onClick={() => setPendingItemCategoryDelete(null)}
                        className="glass-modal-backdrop absolute inset-0"
                      />
                      <div ref={itemCategoryDeletePanelRef} className="glass-modal-panel relative z-[1801] flex w-full max-w-[440px] flex-col overflow-hidden">
                        <GlassModalHeader
                          title={pendingItemCategoryDelete.itemIndex === undefined ? "Delete item category?" : "Delete item?"}
                          onClose={() => setPendingItemCategoryDelete(null)}
                        />
                        <div className="space-y-2 px-4 py-4">
                          <p className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                            {pendingItemCategoryDelete.itemIndex === undefined
                              ? `“${pendingItemCategoryDelete.name || "Untitled category"}”${
                                  pendingItemCategoryDelete.itemCount > 0
                                    ? ` and its ${pendingItemCategoryDelete.itemCount} ${pendingItemCategoryDelete.itemCount === 1 ? "item" : "items"} will be removed`
                                    : " will be removed"
                                } from the Sales item picker.`
                              : `“${pendingItemCategoryDelete.itemName || "Untitled item"}” will be removed from “${
                                  pendingItemCategoryDelete.name || "Untitled category"
                                }” in the Sales item picker.`}
                          </p>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
                          <button type="button" onClick={() => setPendingItemCategoryDelete(null)} className={secondaryButtonClass}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const target = pendingItemCategoryDelete;
                              setPendingItemCategoryDelete(null);
                              // Matched by position and name, in case the list changed while this was open.
                              if (target.itemIndex !== undefined) {
                                removeItemCategoryItem(target.index, target.itemIndex, target.itemName ?? "");
                                return;
                              }
                              const category = itemCategories[target.index];
                              if (!category || category.name.trim() !== target.name) return;
                              removeFromList(setItemCategories, target.index, category, `${toStr(category.name, "Category")} deleted`);
                              setItemCategoryExpanded({});
                            }}
                            className="inline-flex h-9 items-center justify-center rounded-[10px] border px-4 text-[12px] font-medium text-white transition hover:brightness-95"
                            style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                    </ModalPortal>
                  ) : null}
                  {shouldRenderItemCategoriesModal ? (
                    <ModalPortal>
                    {/* Full screen, like the layout builders — room for every category's items and their columns. */}
                    <div ref={itemCategoriesModalPanelRef} data-full-screen-window="true" className="fixed inset-0 z-[1750] flex flex-col bg-[var(--bg-app)]">
                        <div className="glass-page-header flex h-[56px] shrink-0 items-center justify-between gap-2 px-4 md:px-5">
                          <div className="inline-flex min-w-0 items-center gap-2 text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                            <FolderTree size={14} className="shrink-0" />
                            <span className="truncate">Item Categories</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsItemCategoriesModalOpen(false)}
                            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-semibold transition hover:brightness-95"
                            style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                          >
                            <ArrowLeft size={14} />
                            <span className="max-sm:sr-only">Back</span>
                          </button>
                        </div>
                        <div className="glass-scroll m-3 min-h-0 flex-1 overflow-y-auto rounded-[10px] border max-lg:overflow-x-auto" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}>
                          {/* Below desktop this spreadsheet-style editor keeps its desktop column widths and
                              scrolls sideways inside the pop-up, rather than squeezing the columns apart. */}
                          <div className="max-lg:min-w-[880px]">
                          <div
                            className="grid grid-cols-[30px_30px_30px_72px_1fr_1fr] gap-2 border-b px-4 py-2 text-[10.5px] font-bold uppercase tracking-[0.6px]"
                            style={{ borderColor: "var(--glass-border)", color: "var(--text-muted)" }}
                          >
                            <p></p>
                            <p></p>
                            <p></p>
                            <p className="text-center">Colour</p>
                            <p>Name</p>
                            <p>Sub-categories</p>
                          </div>
                          {itemCategories.map((row, idx) => (
                              <div key={idx}>
                                <div
                                  id={`settings_item_category_${idx}`}
                                  className={`grid grid-cols-[30px_30px_30px_72px_1fr_1fr] items-center gap-2 px-4 py-2 transition-colors ${idx < itemCategories.length - 1 || itemCategoryExpanded[idx] ? "border-b" : ""}`}
                                  style={{ borderColor: "var(--glass-border)", opacity: itemCategoryDragIndex === idx ? 0.45 : 1 }}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "move";
                                  }}
                                  onDragEnter={(e) => {
                                    e.preventDefault();
                                    if (itemCategoryDragIndex == null || itemCategoryDragIndex === idx) return;
                                    setItemCategories((prev) => moveRowTo(prev, itemCategoryDragIndex, idx));
                                    setItemCategoryDragIndex(idx);
                                    setItemCategoryDragOverIndex(idx);
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    setItemCategoryDragIndex(null);
                                    setItemCategoryDragOverIndex(null);
                                    endRowDrag();
                                    triggerAutosaveAfterRowDrop();
                                  }}
                                >
                                  <button
                                    type="button"
                                    draggable
                                    onDragStart={(e) => {
                                      setItemCategoryDragIndex(idx);
                                      setItemCategoryDragOverIndex(idx);
                                      e.dataTransfer.setData("text/plain", `itemcat_${idx}`);
                                      startRowDrag(e, `settings_item_category_${idx}`, row.name, row.color);
                                    }}
                                    onDragEnd={() => {
                                      setItemCategoryDragIndex(null);
                                      setItemCategoryDragOverIndex(null);
                                      endRowDrag();
                                    }}
                                    className={gripClass}
                                    title="Drag to reorder"
                                  >
                                    <GripVertical size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      const itemCount = (row.items ?? []).length;
                                      // A blank new one (no name, no items) just goes; anything else asks first.
                                      if (!row.name.trim() && itemCount === 0) {
                                        removeFromList(setItemCategories, idx, row, "Category removed");
                                        return;
                                      }
                                      itemCategoryDeleteOriginElRef.current = e.currentTarget;
                                      setItemCategoryDeleteOrigin(captureGlassModalOrigin(e));
                                      setPendingItemCategoryDelete({ index: idx, name: row.name.trim(), itemCount });
                                    }}
                                    className={dangerIconButtonClass}
                                    title="Remove category"
                                  >
                                    <X size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => toggleItemCategoryExpanded(idx)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]"
                                    style={{ color: "var(--text-muted)" }}
                                    title={itemCategoryExpanded[idx] ? "Hide items" : "Show items"}
                                  >
                                    <ChevronDown
                                      size={15}
                                      style={{ transform: itemCategoryExpanded[idx] ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 120ms ease" }}
                                    />
                                  </button>
                                  <span className="flex justify-center">
                                    <ColorCircle value={row.color || "#7D99B3"} onChange={(hex) => setItemCategories((prev) => prev.map((v, i) => (i === idx ? { ...v, color: hex } : v)))} />
                                  </span>
                                  <input value={row.name} placeholder="Category name" onChange={(e) => setItemCategories((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))} className={gridCellInputClass} />
                                  <div className="flex min-h-8 flex-wrap items-center gap-1 px-1 py-1">
                                    <button type="button" onClick={() => void addItemCategorySubcategory(idx)} className={chipAddClass} title="Add sub-category">
                                      <Plus size={13} /> Sub-category
                                    </button>
                                    {parseSubcategoryNames(row.subcategories).map((sub) => (
                                      <span
                                        key={`${idx}_${sub}`}
                                        className={chipClass}
                                      >
                                        {/* Its own colour (its items' circle in Design › Items) — the category's to start with. */}
                                        <ColorCircle
                                          size={16}
                                          title="Sub-category colour"
                                          value={row.subcategoryColors[sub.toLowerCase()] || row.color || "#7D99B3"}
                                          onChange={(hex) =>
                                            setItemCategories((prev) =>
                                              prev.map((v, i) => (i === idx ? { ...v, subcategoryColors: { ...v.subcategoryColors, [sub.toLowerCase()]: hex } } : v)),
                                            )
                                          }
                                        />
                                        {sub}
                                        <button
                                          type="button"
                                          onClick={() => removeItemCategorySubcategory(idx, sub)}
                                          className="inline-flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                                          style={{ color: "var(--text-muted)" }}
                                          title="Remove sub-category"
                                        >
                                          <X size={12} />
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                </div>

                                {itemCategoryExpanded[idx] && (
                                  <div
                                    className={idx < itemCategories.length - 1 ? "border-b" : ""}
                                    style={{ backgroundColor: `color-mix(in srgb, ${row.color || "#7D99B3"} 8%, transparent)`, borderColor: "var(--glass-border)" }}
                                  >
                                    <div
                                      className="grid grid-cols-[30px_30px_1fr_2.2fr_130px_150px_100px_110px] items-center gap-2 border-b px-4 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.6px]"
                                      style={{ borderColor: "var(--glass-border)", color: "var(--text-muted)" }}
                                    >
                                      <p></p>
                                      <p></p>
                                      <p>Name</p>
                                      <p>Description</p>
                                      <p>Sub Category</p>
                                      <p>Price</p>
                                      <p>Markup %</p>
                                      <p>Output Price</p>
                                    </div>
                                    {(row.items ?? []).map((itemRow, itemIdx) => {
                                      const subcategoryOptions = parseSubcategoryNames(row.subcategories);
                                      const isLastItem = itemIdx === (row.items ?? []).length - 1;
                                      return (
                                        <div
                                          key={`${idx}_item_${itemIdx}`}
                                          id={`settings_item_category_${idx}_item_${itemIdx}`}
                                          className={`group/itemrow grid grid-cols-[30px_30px_1fr_2.2fr_130px_150px_100px_110px] items-center gap-2 px-4 py-1.5 ${isLastItem ? "" : "border-b"}`}
                                          style={{
                                            borderColor: "var(--glass-border)",
                                            opacity: itemCategoryItemDrag?.catIndex === idx && itemCategoryItemDrag.itemIndex === itemIdx ? 0.45 : 1,
                                          }}
                                          // Up and down within its own category only — another category's items aren't a drop place.
                                          onDragOver={(e) => {
                                            if (itemCategoryItemDrag?.catIndex !== idx) return;
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = "move";
                                          }}
                                          onDragEnter={(e) => {
                                            if (itemCategoryItemDrag?.catIndex !== idx) return;
                                            e.preventDefault();
                                            const from = itemCategoryItemDrag.itemIndex;
                                            if (from === itemIdx) return;
                                            setItemCategories((prev) =>
                                              prev.map((cat, i) => (i === idx ? { ...cat, items: moveRowTo(cat.items ?? [], from, itemIdx) } : cat)),
                                            );
                                            setItemCategoryItemDrag({ catIndex: idx, itemIndex: itemIdx });
                                          }}
                                          onDrop={(e) => {
                                            if (itemCategoryItemDrag?.catIndex !== idx) return;
                                            e.preventDefault();
                                            setItemCategoryItemDrag(null);
                                            endRowDrag();
                                            triggerAutosaveAfterRowDrop();
                                          }}
                                        >
                                          <button
                                            type="button"
                                            draggable
                                            onDragStart={(e) => {
                                              setItemCategoryItemDrag({ catIndex: idx, itemIndex: itemIdx });
                                              e.dataTransfer.setData("text/plain", `itemcat_${idx}_item_${itemIdx}`);
                                              startRowDrag(e, `settings_item_category_${idx}_item_${itemIdx}`, itemRow.name, row.color);
                                            }}
                                            onDragEnd={() => {
                                              setItemCategoryItemDrag(null);
                                              endRowDrag();
                                            }}
                                            className={gripClass}
                                            title="Drag to reorder"
                                            aria-label="Drag to reorder this item"
                                          >
                                            <GripVertical size={15} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              // A blank new one (nothing filled in) just goes; anything else asks first.
                                              const filled = Boolean(itemRow.customPrice) || [itemRow.name, itemRow.description, itemRow.price, itemRow.markupPercent].some((v) => String(v ?? "").trim());
                                              if (!filled) {
                                                removeItemCategoryItem(idx, itemIdx);
                                                return;
                                              }
                                              itemCategoryDeleteOriginElRef.current = e.currentTarget;
                                              setItemCategoryDeleteOrigin(captureGlassModalOrigin(e));
                                              setPendingItemCategoryDelete({
                                                index: idx,
                                                name: row.name.trim(),
                                                itemCount: (row.items ?? []).length,
                                                itemIndex: itemIdx,
                                                itemName: itemRow.name.trim(),
                                              });
                                            }}
                                            className={dangerIconButtonClass}
                                            title="Delete item"
                                          >
                                            <X size={15} />
                                          </button>
                                          <input
                                            value={itemRow.name}
                                            onChange={(e) => updateItemCategoryItem(idx, itemIdx, { name: e.target.value })}
                                            className={gridCellInputClass}
                                          />
                                          <input
                                            value={itemRow.description}
                                            onChange={(e) => updateItemCategoryItem(idx, itemIdx, { description: e.target.value })}
                                            className={gridCellInputClass}
                                          />
                                          <GlassDropdown
                                            value={itemRow.subcategory}
                                            options={[{ value: "", label: "None" }, ...subcategoryOptions.map((sub) => ({ value: sub, label: sub }))]}
                                            onChange={(next) => updateItemCategoryItem(idx, itemIdx, { subcategory: next })}
                                            ariaLabel="Sub-category"
                                            triggerClassName={`${glassFieldSmClass} justify-between`}
                                          />
                                          {/* Its price — or, switched to Custom, none: staff enter one each time it's added to a room
                                              (Design › Items asks), and its markup goes on top of what they enter. */}
                                          <div className="relative min-w-0">
                                            <input inputMode="decimal"
                                              value={itemRow.customPrice ? "" : itemRow.price}
                                              readOnly={Boolean(itemRow.customPrice)}
                                              tabIndex={itemRow.customPrice ? -1 : undefined}
                                              onChange={(e) => updateItemCategoryItem(idx, itemIdx, { price: e.target.value })}
                                              onBlur={(e) => {
                                                if (!itemRow.customPrice) updateItemCategoryItem(idx, itemIdx, { price: ensureDollarFormat(e.target.value) });
                                              }}
                                              className={gridCellInputClass}
                                              style={{ paddingRight: 66 }}
                                              placeholder={itemRow.customPrice ? "" : formatMoney(0, companyCurrency)}
                                            />
                                            {/* On: "Custom price", in the brand colour. Off: "Custom", showing while the row's hovered. */}
                                            <button
                                              type="button"
                                              onClick={() => updateItemCategoryItem(idx, itemIdx, { customPrice: !itemRow.customPrice })}
                                              aria-pressed={Boolean(itemRow.customPrice)}
                                              title={itemRow.customPrice ? "Custom price — staff enter the price each time it's added. Click to set a price instead." : "Make this a custom price — staff enter the price each time it's added"}
                                              className={`absolute top-1/2 -translate-y-1/2 rounded-full border px-2 py-[1px] text-[10.5px] font-semibold transition hover:brightness-95 ${
                                                itemRow.customPrice ? "left-1" : "right-1 opacity-0 focus-visible:opacity-100 group-hover/itemrow:opacity-100"
                                              }`}
                                              style={
                                                itemRow.customPrice
                                                  ? { borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }
                                                  : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }
                                              }
                                            >
                                              {itemRow.customPrice ? "Custom price" : "Custom"}
                                            </button>
                                          </div>
                                          <input inputMode="decimal"
                                            value={itemRow.markupPercent}
                                            onChange={(e) => updateItemCategoryItem(idx, itemIdx, { markupPercent: e.target.value })}
                                            className={gridCellInputClass}
                                            placeholder="0"
                                          />
                                          <p className="truncate px-2 text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                                            {itemRow.customPrice
                                              ? parseNumberLoose(itemRow.markupPercent) > 0
                                                ? `Entered + ${parseNumberLoose(itemRow.markupPercent)}%`
                                                : "When added"
                                              : computeOutputPrice(itemRow.price, itemRow.markupPercent)}
                                          </p>
                                        </div>
                                      );
                                    })}
                                    <div className="px-4 py-2">
                                      <button
                                        type="button"
                                        onClick={() => addItemCategoryItem(idx)}
                                        className="inline-flex items-center gap-1 text-[12px] font-semibold"
                                        style={{ color: "var(--brand-strong)" }}
                                      >
                                        <Plus size={14} />
                                        Add item
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          <div className="px-4 py-3">
                            <button type="button" onClick={() => setItemCategories((prev) => [...prev, { name: "", color: "#7D99B3", subcategories: "", subcategoryColors: {}, items: [] }])} className={secondaryButtonClass}><Plus size={14} /> Add category</button>
                          </div>
                          </div>
                        </div>
                    </div>
                    </ModalPortal>
                  ) : null}
                  {isSpecsLayoutModalOpen ? (
                    <div data-specs-layout-modal="true" data-full-screen-window="true" className="fixed inset-0 z-[1000] flex flex-col bg-[var(--bg-app)]">
                      <div className="glass-page-header flex h-[56px] shrink-0 items-center justify-between gap-2 px-4 md:px-5">
                        <div className="inline-flex min-w-0 items-center gap-3">
                          <div className="inline-flex min-w-0 items-center gap-2 text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                            <ClipboardList size={14} className="shrink-0" />
                            <span className="max-lg:truncate">Specs Layout Builder</span>
                          </div>
                          {specsTemplateSaveError ? (
                            <span className="min-w-0 rounded-[8px] border px-2 py-1 text-[11px] font-bold max-lg:truncate" style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}>
                              {specsTemplateSaveError === "invalid-template-file"
                                ? "That file isn't a valid template"
                                : specsTemplateSaveError === "download-failed"
                                  ? "Download failed"
                                  : `Save failed (${specsTemplateSaveError}) — your last edit may not have saved`}
                            </span>
                          ) : null}
                        </div>
                        <div className="inline-flex shrink-0 items-center gap-2">
                          {/* Temporary — see specsTemplateFileInputRef's own comment: lets this
                              template be downloaded from one company and uploaded into another. */}
                          <input
                            ref={specsTemplateFileInputRef}
                            type="file"
                            accept="application/json"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0] ?? null;
                              void uploadSpecsTemplateFile(file);
                              if (specsTemplateFileInputRef.current) specsTemplateFileInputRef.current.value = "";
                            }}
                          />
                          <button
                            type="button"
                            onClick={downloadSpecsTemplate}
                            title="Download this template as a JSON file"
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-semibold transition hover:brightness-95"
                            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                          >
                            <Download size={14} />
                            <span className="max-sm:sr-only">Download</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => specsTemplateFileInputRef.current?.click()}
                            title="Upload a template JSON file exported from another company"
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-semibold transition hover:brightness-95"
                            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                          >
                            <Upload size={14} />
                            <span className="max-sm:sr-only">Upload</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              specsTemplateResetConfirmOriginElRef.current = e.currentTarget;
                              setSpecsTemplateResetConfirmOrigin(captureGlassModalOrigin(e));
                              setIsSpecsTemplateResetConfirmOpen(true);
                            }}
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-semibold transition hover:brightness-95"
                            style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
                          >
                            <RotateCcw size={14} />
                            <span className="max-sm:sr-only">Reset</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsSpecsLayoutModalOpen(false)}
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-semibold transition hover:brightness-95"
                            style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                          >
                            <ArrowLeft size={14} />
                            <span className="max-sm:sr-only">Back</span>
                          </button>
                        </div>
                      </div>
                      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 text-[12px] max-lg:grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[1fr_280px]">
                          <div className="min-h-0 overflow-hidden rounded-[10px] border" style={{ borderColor: "var(--glass-border)" }}>
                            <SpecsGridEditor
                              key={specsTemplateEditorKey}
                              value={specsTemplateGrid ?? createEmptyGrid()}
                              onChange={onSpecsTemplateChange}
                              className="flex h-full w-full flex-col"
                              showPageSizeSelector
                              companyLogoUrl={form.logoPath || undefined}
                              companyColor={/^#[0-9A-Fa-f]{6}$/.test(form.themeColor) ? form.themeColor : undefined}
                              companyRoleOptions={specsGroupRoleOptions}
                              productOptions={specsGroupProductOptions}
                              // Lets a Specs group's "Link to Quote Groups" section pick from the
                              // Quote template's own current groups — see linkedQuoteSourceGrid's
                              // own comment on SpecsGridEditorProps. quoteGridTemplate is already a
                              // sibling state in this same component, so no extra fetch is needed.
                              linkedQuoteSourceGrid={quoteGridTemplate ?? undefined}
                              // Enables the template builder's own "Mark Confirmable" toolbar button
                              // — a client-confirmation concept that only makes sense on
                              // Specifications, same as the live project view's identical gate.
                              allowConfirmationMarking
                            />
                          </div>
                          <div
                            className="overflow-y-auto rounded-[14px] border p-3 max-lg:max-h-[30svh]"
                            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", boxShadow: "var(--shadow-sm)" }}
                          >
                            <p className="text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>Placeholders</p>
                            <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                              Type these tokens into a cell. They&apos;ll be replaced with that project&apos;s real data the first time its specifications sheet is created from this template.
                            </p>
                            <div className="mt-3 space-y-2">
                              {QUOTE_TEMPLATE_PLACEHOLDERS.map((item) => (
                                <div key={item.token} className="rounded-[10px] border px-3 py-2" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
                                  <p className="text-[11px] font-semibold" style={{ color: "var(--text-main)" }}>{item.label}</p>
                                  <p className="mt-1 break-all font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>{item.token}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                    </div>
                  ) : null}
                  {shouldRenderSpecsTemplateResetConfirmModal ? (
                    <ModalPortal>
                    <div className="fixed inset-0 z-[1010] flex items-center justify-center px-4 py-4">
                      <button
                        type="button"
                        aria-label="Close reset confirmation backdrop"
                        onClick={() => setIsSpecsTemplateResetConfirmOpen(false)}
                        className="glass-modal-backdrop absolute inset-0"
                      />
                      <div ref={specsTemplateResetConfirmPanelRef} className="glass-modal-panel relative w-[min(420px,96vw)] overflow-hidden">
                        <GlassModalHeader title="Reset Template" onClose={() => setIsSpecsTemplateResetConfirmOpen(false)} />
                        <div className="space-y-4 px-5 py-4">
                          <p className="text-[12px]" style={{ color: "var(--text-main)" }}>
                            This will clear the entire specs template — every cell, row, column, and formatting choice.
                          </p>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setIsSpecsTemplateResetConfirmOpen(false)}
                              className="h-9 rounded-[9px] border px-4 text-[12px] font-semibold hover:brightness-95"
                              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={resetSpecsTemplate}
                              className="h-9 rounded-[9px] border px-4 text-[12px] font-semibold text-white hover:brightness-95"
                              style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                            >
                              Reset Template
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    </ModalPortal>
                  ) : null}
                  {isQuoteLayoutModalOpen ? (
                    <div data-quote-layout-modal="true" data-full-screen-window="true" className="fixed inset-0 z-[1000] flex flex-col bg-[var(--bg-app)]">
                      <div className="glass-page-header flex h-[56px] shrink-0 items-center justify-between gap-2 px-4 md:px-5">
                        <div className="inline-flex min-w-0 items-center gap-3">
                          <div className="inline-flex min-w-0 items-center gap-2 text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                            <ClipboardList size={14} className="shrink-0" />
                            <span className="max-lg:truncate">Quote Layout Builder</span>
                          </div>
                          {quoteTemplateSaveError ? (
                            <span className="min-w-0 rounded-[8px] border px-2 py-1 text-[11px] font-bold max-lg:truncate" style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}>
                              {quoteTemplateSaveError === "invalid-template-file"
                                ? "That file isn't a valid template"
                                : quoteTemplateSaveError === "download-failed"
                                  ? "Download failed"
                                  : `Save failed (${quoteTemplateSaveError}) — your last edit may not have saved`}
                            </span>
                          ) : null}
                        </div>
                        <div className="inline-flex shrink-0 items-center gap-2">
                          {/* Temporary — see quoteTemplateFileInputRef's own comment: lets this
                              template be downloaded from one company and uploaded into another. */}
                          <input
                            ref={quoteTemplateFileInputRef}
                            type="file"
                            accept="application/json"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0] ?? null;
                              void uploadQuoteTemplateFile(file);
                              if (quoteTemplateFileInputRef.current) quoteTemplateFileInputRef.current.value = "";
                            }}
                          />
                          <button
                            type="button"
                            onClick={downloadQuoteTemplate}
                            title="Download this template as a JSON file"
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-semibold transition hover:brightness-95"
                            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                          >
                            <Download size={14} />
                            <span className="max-sm:sr-only">Download</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => quoteTemplateFileInputRef.current?.click()}
                            title="Upload a template JSON file exported from another company"
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-semibold transition hover:brightness-95"
                            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                          >
                            <Upload size={14} />
                            <span className="max-sm:sr-only">Upload</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              quoteTemplateResetConfirmOriginElRef.current = e.currentTarget;
                              setQuoteTemplateResetConfirmOrigin(captureGlassModalOrigin(e));
                              setIsQuoteTemplateResetConfirmOpen(true);
                            }}
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-semibold transition hover:brightness-95"
                            style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
                          >
                            <RotateCcw size={14} />
                            <span className="max-sm:sr-only">Reset</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsQuoteLayoutModalOpen(false)}
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-semibold transition hover:brightness-95"
                            style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                          >
                            <ArrowLeft size={14} />
                            <span className="max-sm:sr-only">Back</span>
                          </button>
                        </div>
                      </div>
                      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 text-[12px] max-lg:grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[1fr_280px]">
                          <div className="min-h-0 overflow-hidden rounded-[10px] border" style={{ borderColor: "var(--glass-border)" }}>
                            <SpecsGridEditor
                              key={quoteTemplateEditorKey}
                              value={quoteGridTemplate ?? createEmptyGrid()}
                              onChange={onQuoteTemplateChange}
                              className="flex h-full w-full flex-col"
                              showPageSizeSelector
                              companyLogoUrl={form.logoPath || undefined}
                              companyColor={/^#[0-9A-Fa-f]{6}$/.test(form.themeColor) ? form.themeColor : undefined}
                              groupsSupportPricing
                              companyRoleOptions={specsGroupRoleOptions}
                              productOptions={specsGroupProductOptions}
                            />
                          </div>
                          <div
                            className="overflow-y-auto rounded-[14px] border p-3 max-lg:max-h-[30svh]"
                            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", boxShadow: "var(--shadow-sm)" }}
                          >
                            <p className="text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>Placeholders</p>
                            <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                              Type these tokens into a cell. They&apos;ll be replaced with that project&apos;s real data the first time its quote is created from this template.
                            </p>
                            <div className="mt-3 space-y-2">
                              {QUOTE_TEMPLATE_PLACEHOLDERS.map((item) => (
                                <div key={item.token} className="rounded-[10px] border px-3 py-2" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
                                  <p className="text-[11px] font-semibold" style={{ color: "var(--text-main)" }}>{item.label}</p>
                                  <p className="mt-1 break-all font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>{item.token}</p>
                                </div>
                              ))}
                            </div>
                            <div className="mt-4 rounded-[10px] border px-3 py-2" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
                              <p className="text-[11px] font-semibold" style={{ color: "var(--text-main)" }}>Quote Extras</p>
                              <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                                Highlight some rows and right-click a row number → &quot;Link Rows as Group&quot;. Give the group a Price and it automatically becomes a toggleable quote extra — no separate setup needed.
                              </p>
                            </div>
                          </div>
                        </div>
                    </div>
                  ) : null}
                  {shouldRenderQuoteTemplateResetConfirmModal ? (
                    <ModalPortal>
                    <div className="fixed inset-0 z-[1010] flex items-center justify-center px-4 py-4">
                      <button
                        type="button"
                        aria-label="Close reset confirmation backdrop"
                        onClick={() => setIsQuoteTemplateResetConfirmOpen(false)}
                        className="glass-modal-backdrop absolute inset-0"
                      />
                      <div ref={quoteTemplateResetConfirmPanelRef} className="glass-modal-panel relative w-[min(420px,96vw)] overflow-hidden">
                        <GlassModalHeader title="Reset Template" onClose={() => setIsQuoteTemplateResetConfirmOpen(false)} />
                        <div className="space-y-4 px-5 py-4">
                          <p className="text-[12px]" style={{ color: "var(--text-main)" }}>
                            This will clear the entire quote template — every cell, row, column, and formatting choice.
                          </p>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setIsQuoteTemplateResetConfirmOpen(false)}
                              className="h-9 rounded-[9px] border px-4 text-[12px] font-semibold hover:brightness-95"
                              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={resetQuoteTemplate}
                              className="h-9 rounded-[9px] border px-4 text-[12px] font-semibold text-white hover:brightness-95"
                              style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                            >
                              Reset Template
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    </ModalPortal>
                  ) : null}
                  <Panel
                    className="xl:col-span-2"
                    title="Products"
                    icon={Box}
                    description="Your products and how they're priced on a quote — each sheet size with its own margin and misc charges per sheet used, plus edge tape per metre, and lacquer per m² (Lacquer), on the metres / m² in the project's Product table."
                    headerRight={
                      <button type="button" onClick={openProductsSheet} className={primaryButtonClass} style={primaryButtonStyle}>
                        <Box size={15} /> Edit products
                      </button>
                    }
                  >
                    {/* At a glance: each product's sell prices (cost + margin). Click any row to edit them all in the sheet. */}
                    {jobTypes.length === 0 ? (
                      <div className="rounded-[14px] border border-dashed" style={{ borderColor: "color-mix(in srgb, var(--text-main) 18%, transparent)" }}>
                        <EmptyState
                          compact
                          icon={<Box size={16} />}
                          title="No products yet"
                          hint="Add your products and how they're priced on a quote."
                          action={{
                            label: "Add a product",
                            icon: <Plus size={14} />,
                            // EmptyState's button hands its click on, so the sheet still opens from it.
                            onClick: (event?: ReactMouseEvent<HTMLElement>) => {
                              addProduct();
                              if (event) openProductsSheet(event);
                              else setIsProductsSheetOpen(true);
                            },
                          }}
                        />
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] text-[13px]">
                          <thead>
                            <tr className="border-b" style={{ borderColor: "var(--glass-border)" }}>
                              {["Product", "Type", "Sheet sizes", "Edge tape / Lacquer", "Misc charges"].map((heading) => (
                                <th key={heading} className={`${columnHeadClass} whitespace-nowrap px-2 pb-2 text-left`}>
                                  {heading}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {jobTypes.map((row, idx) => (
                              <tr
                                key={`product_summary_${idx}`}
                                onClick={openProductsSheet}
                                className="cursor-pointer border-b align-top transition last:border-none hover:brightness-[0.97]"
                                style={{ borderColor: "var(--glass-border)", backgroundColor: `color-mix(in srgb, ${row.color} 9%, transparent)` }}
                                title="Edit products"
                              >
                                <td className="px-2 py-2.5 font-medium" style={{ color: "var(--text-main)" }}>
                                  <span className="inline-flex items-center gap-2">
                                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                                    {row.name || "Untitled product"}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-2 py-2.5" style={{ color: "var(--text-main)" }}>{PRODUCT_TYPE_LABELS[row.type]}</td>
                                <td className="px-2 py-2.5" style={{ color: "var(--text-main)" }}>
                                  {(row.sheetPrices ?? []).length ? (
                                    (row.sheetPrices ?? []).map((sp, spIdx) => (
                                      <p key={spIdx} className="whitespace-nowrap tabular-nums">
                                        {sheetSizeLabel(sp.sheetSize)} · <span className="font-semibold">{computeOutputPrice(sp.pricePerSheet, sp.marginPercent)}</span>
                                      </p>
                                    ))
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-2 py-2.5 tabular-nums" style={{ color: "var(--text-main)" }}>
                                  {/* (A Lacquer product: its edge tape and its lacquer, one under the other.) */}
                                  {(jobTypeHasEdgeTape(row.type) && toStr(row.edgeTapePrice)) || (jobTypeHasLacquer(row.type) && toStr(row.lacquerSqmPrice)) ? (
                                    <>
                                      {jobTypeHasEdgeTape(row.type) && toStr(row.edgeTapePrice) ? (
                                        <p>
                                          <span className="font-semibold">{computeOutputPrice(row.edgeTapePrice, row.edgeTapeMarginPercent)}</span> / m
                                        </p>
                                      ) : null}
                                      {jobTypeHasLacquer(row.type) && toStr(row.lacquerSqmPrice) ? (
                                        <p>
                                          <span className="font-semibold">{computeOutputPrice(row.lacquerSqmPrice, row.lacquerMarginPercent)}</span> / m²
                                        </p>
                                      ) : null}
                                    </>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="px-2 py-2.5" style={{ color: "var(--text-main)" }}>
                                  {(row.miscCharges ?? []).filter((charge) => charge.name || charge.price).length
                                    ? (row.miscCharges ?? [])
                                        .filter((charge) => charge.name || charge.price)
                                        .map((charge, chargeIdx) => (
                                          <p key={chargeIdx} className="whitespace-nowrap tabular-nums">
                                            {charge.name || "Misc"} · <span className="font-semibold">{computeOutputPrice(charge.price, charge.marginPercent)}</span> / sheet
                                          </p>
                                        ))
                                    : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Panel>
                  {shouldRenderProductsSheet ? (
                    <ModalPortal>
                    {/* Full screen, like Item Categories — every product and its pricing in one table. */}
                    <div ref={productsSheetPanelRef} data-full-screen-window="true" className="fixed inset-0 z-[1750] flex flex-col bg-[var(--bg-app)]">
                      <div className="glass-page-header flex h-[56px] shrink-0 items-center justify-between gap-2 px-4 md:px-5">
                        <div className="inline-flex min-w-0 items-center gap-2 text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                          <Box size={14} className="shrink-0" />
                          <span className="truncate">Products</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button type="button" onClick={addProduct} className={secondaryButtonClass}>
                            <Plus size={14} />
                            <span className="max-sm:sr-only">Add product</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsProductsSheetOpen(false)}
                            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-semibold transition hover:brightness-95"
                            style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                          >
                            <ArrowLeft size={14} />
                            <span className="max-sm:sr-only">Back</span>
                          </button>
                        </div>
                      </div>
                      <div className="glass-scroll min-h-0 flex-1 overflow-auto p-3 md:p-4">
                        {/* Each product floats in its own card. Below desktop they keep their desktop column widths and
                            scroll sideways, rather than squeezing them. */}
                        <div className="mx-auto flex w-max flex-col gap-3">
                          {jobTypes.length === 0 ? (
                            <div className="rounded-[16px] border" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}>
                              <EmptyState
                                compact
                                icon={<Box size={16} />}
                                title="No products yet"
                                hint="Each product gets its own card here, with its pricing."
                                action={{ label: "Add product", icon: <Plus size={14} />, onClick: addProduct }}
                              />
                            </div>
                          ) : null}
                          {jobTypes.map((row, idx) => {
                            const collapsed = Boolean(productCollapsed[idx]);
                            const lineClass = `${PRODUCT_SHEET_GRID} border-b px-3 py-1.5`;
                            // Its lines (what drops down under it) in a lighter wash of its colour — the product's own row a
                            // stronger one — and a stripe of it down the left of them all.
                            const lineStyle = {
                              borderColor: "var(--glass-border)",
                              backgroundColor: `color-mix(in srgb, ${row.color} 8%, var(--panel-bg))`,
                              boxShadow: `inset 4px 0 0 color-mix(in srgb, ${row.color} 55%, transparent)`,
                            };
                            const sellCell = (price: string, margin: string, unit: string, prefix = "") => (
                              <span className="text-right text-[13px] tabular-nums" style={{ color: "var(--text-main)" }}>
                                <span className="font-semibold">
                                  {prefix}
                                  {computeOutputPrice(price, margin)}
                                </span>
                                <span className="text-[12px]"> {unit}</span>
                              </span>
                            );
                            // Every misc charge (margin on) — added on top of each sheet, whatever its size.
                            const miscPerSheet = (row.miscCharges ?? []).reduce((sum, charge) => sum + sellAmount(charge.price, charge.marginPercent), 0);
                            // Its lines come in three parts, each under a label strip in the product's colour (as strong as
                            // its own row): Sheets (the only lines that differ by size), Misc (added to every sheet) and
                            // On the quote (edge tape / lacquer, later).
                            const sectionLabel = (title: string, note = "", right?: React.ReactNode) => (
                              <div
                                className={`${PRODUCT_SHEET_GRID} border-b px-3 py-2`}
                                style={{
                                  borderColor: `color-mix(in srgb, ${row.color} 25%, var(--glass-border))`,
                                  backgroundColor: `color-mix(in srgb, ${row.color} 20%, var(--panel-bg))`,
                                  boxShadow: `inset 4px 0 0 ${row.color}`,
                                }}
                              >
                                <span />
                                <span className="col-span-3 flex min-w-0 items-baseline gap-2">
                                  <span
                                    className="shrink-0 text-[11px] font-bold uppercase tracking-[0.6px]"
                                    style={{ color: `color-mix(in srgb, ${row.color} 65%, var(--text-main))` }}
                                  >
                                    {title}
                                  </span>
                                  <span className="truncate text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                                    {note}
                                  </span>
                                </span>
                                <span className="text-right text-[12px] tabular-nums" style={{ color: "var(--text-main)" }}>
                                  {right}
                                </span>
                                <span />
                              </div>
                            );
                            const addLineButton = (label: string, onClick: () => void) => (
                              <div className={lineClass} style={lineStyle}>
                                <span />
                                <span className="col-span-4">
                                  <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: "var(--brand-strong)" }}>
                                    <Plus size={14} /> {label}
                                  </button>
                                </span>
                                <span />
                              </div>
                            );
                            return (
                              <div
                                key={idx}
                                id={`settings_product_${idx}`}
                                data-products-sheet-product="true"
                                // Its own floating card; the last row inside drops its bottom line (the card's edge is there).
                                className="overflow-hidden rounded-[16px] border"
                                style={{
                                  opacity: jobTypeDragIndex === idx ? 0.45 : 1,
                                  borderColor: `color-mix(in srgb, ${row.color} 30%, var(--glass-border))`,
                                  backgroundColor: "var(--panel-bg)",
                                  boxShadow: "var(--shadow-glass)",
                                }}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                }}
                                onDragEnter={(e) => {
                                  e.preventDefault();
                                  if (jobTypeDragIndex == null || jobTypeDragIndex === idx) return;
                                  setJobTypes((prev) => moveRowTo(prev, jobTypeDragIndex, idx));
                                  setJobTypeDragIndex(idx);
                                  setJobTypeDragOverIndex(idx);
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  setJobTypeDragIndex(null);
                                  setJobTypeDragOverIndex(null);
                                  endRowDrag();
                                  triggerAutosaveAfterRowDrop();
                                }}
                              >
                                {/* The product: drag to reorder, fold its lines away, its name and type, remove. */}
                                <div
                                  className={`${PRODUCT_SHEET_GRID} px-3 py-2.5`}
                                  style={{
                                    backgroundColor: `color-mix(in srgb, ${row.color} 20%, var(--panel-bg))`,
                                    boxShadow: `inset 4px 0 0 ${row.color}`,
                                  }}
                                >
                                  <span className="flex items-center gap-0.5">
                                    <button
                                      type="button"
                                      draggable
                                      onDragStart={(e) => {
                                        setJobTypeDragIndex(idx);
                                        setJobTypeDragOverIndex(idx);
                                        e.dataTransfer.setData("text/plain", `jobtype_${idx}`);
                                        startRowDrag(e, `settings_product_${idx}`, row.name, row.color);
                                      }}
                                      onDragEnd={() => {
                                        setJobTypeDragIndex(null);
                                        setJobTypeDragOverIndex(null);
                                        endRowDrag();
                                      }}
                                      className={gripClass}
                                      title="Drag to reorder"
                                    >
                                      <GripVertical size={15} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => toggleProductCollapsed(idx)}
                                      className="inline-flex h-7 w-6 items-center justify-center rounded-[7px] transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]"
                                      style={{ color: "var(--text-main)" }}
                                      aria-label={collapsed ? "Show this product's lines" : "Hide this product's lines"}
                                      aria-expanded={!collapsed}
                                    >
                                      <ChevronDown size={15} style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 180ms ease" }} />
                                    </button>
                                  </span>
                                  <span className="flex min-w-0 items-center gap-2">
                                    <ColorCircle value={row.color} size={24} onChange={(hex) => updateJobType(idx, { color: hex })} title="Product colour" />
                                    <input
                                      value={row.name}
                                      placeholder="Product name"
                                      onChange={(e) => updateJobType(idx, { name: e.target.value })}
                                      className={`${glassFieldSmClass} text-[13.5px] font-semibold`}
                                      aria-label="Product name"
                                    />
                                  </span>
                                  <span className="col-span-2">
                                    <GlassDropdown
                                      value={row.type}
                                      options={(Object.keys(PRODUCT_TYPE_LABELS) as JobTypeProductType[]).map((type) => ({ value: type, label: PRODUCT_TYPE_LABELS[type] }))}
                                      onChange={(next) => updateJobType(idx, { type: next as JobTypeProductType })}
                                      ariaLabel="Product type"
                                      triggerClassName={`${glassFieldSmClass} justify-between`}
                                    />
                                  </span>
                                  {/* Right of its type, in the Sell price column: each sheet size's total — the sheet plus all its
                                      misc charges (per sheet), each with its margin on — at a glance, even with its lines folded away.
                                      Edge tape / lacquer aren't in it: a quote adds those on the project's own metres / m² (its
                                      Product table). Hover one for how it adds up. */}
                                  <span className="flex flex-col items-end gap-0.5 text-right text-[12px] tabular-nums" style={{ color: "var(--text-main)" }}>
                                    <span className="text-[10px] font-bold uppercase tracking-[0.6px]">Total per sheet</span>
                                    {(row.sheetPrices ?? []).map((sp, spIdx) => {
                                      const sheet = sellAmount(sp.pricePerSheet, sp.marginPercent);
                                      const parts = [`Sheet ${formatMoney(sheet, companyCurrency)}`, miscPerSheet > 0 ? `misc ${formatMoney(miscPerSheet, companyCurrency)}` : ""].filter(Boolean);
                                      return (
                                        <span key={`row_price_${spIdx}`} className="whitespace-nowrap" title={parts.join(" + ")}>
                                          {sheetSizeLabel(sp.sheetSize)} ·{" "}
                                          <span className="font-semibold">{formatMoney(sheet + miscPerSheet, companyCurrency)}</span>
                                        </span>
                                      );
                                    })}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => removeFromList(setJobTypes, idx, row, `${toStr(row.name, "Product")} removed`)}
                                    className={dangerIconButtonClass}
                                    title="Remove product"
                                  >
                                    <X size={15} />
                                  </button>
                                </div>
                                {/* Its lines slide out from under it (and back up when it's folded away). */}
                                <div
                                  className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                                  style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
                                  inert={collapsed}
                                >
                                  <div className="min-h-0 overflow-hidden">
                                  <div
                                    className="border-t [&>div:last-child]:border-b-0"
                                    style={{ borderColor: `color-mix(in srgb, ${row.color} 25%, var(--glass-border))`, opacity: collapsed ? 0 : 1, transition: "opacity 200ms ease" }}
                                  >
                                    {/* Its column headings in the product row's own colour, so the two read as one block. */}
                                    <div
                                      className={`${PRODUCT_SHEET_GRID} border-b px-3 py-1.5`}
                                      style={{
                                        borderColor: `color-mix(in srgb, ${row.color} 25%, var(--glass-border))`,
                                        backgroundColor: `color-mix(in srgb, ${row.color} 20%, var(--panel-bg))`,
                                        boxShadow: `inset 4px 0 0 ${row.color}`,
                                      }}
                                    >
                                      <span />
                                      {["Item", "Cost", "Margin", "Sell price"].map((heading) => (
                                        <span
                                          key={heading}
                                          className={`${columnHeadClass} ${heading === "Sell price" ? "text-right" : ""}`}
                                          style={{ color: `color-mix(in srgb, ${row.color} 60%, var(--text-main))` }}
                                        >
                                          {heading}
                                        </span>
                                      ))}
                                      <span />
                                    </div>
                                    {sectionLabel("Sheets")}
                                    {(row.sheetPrices ?? []).map((sp, spIdx) => (
                                      <div key={`sheet_${spIdx}`} className={lineClass} style={lineStyle}>
                                        <span />
                                        <GlassDropdown
                                          value={sp.sheetSize}
                                          options={[
                                            { value: "", label: "Choose sheet size" },
                                            ...sheetSizes.map((ss) => {
                                              const value = `${ss.h} x ${ss.w}`;
                                              return { value, label: `${formatLength(ss.h, companyUnit, { withUnit: false })} × ${formatLength(ss.w, companyUnit)}` };
                                            }),
                                            ...(sp.sheetSize && !sheetSizes.some((ss) => `${ss.h} x ${ss.w}` === sp.sheetSize) ? [{ value: sp.sheetSize, label: sp.sheetSize }] : []),
                                          ]}
                                          onChange={(next) => updateJobTypeSheetPrice(idx, spIdx, { sheetSize: next })}
                                          ariaLabel="Sheet size"
                                          triggerClassName={`${glassFieldSmClass} justify-between`}
                                        />
                                        <input inputMode="decimal"
                                          value={sp.pricePerSheet}
                                          onChange={(e) => updateJobTypeSheetPrice(idx, spIdx, { pricePerSheet: e.target.value })}
                                          onBlur={(e) => updateJobTypeSheetPrice(idx, spIdx, { pricePerSheet: ensureDollarFormat(e.target.value) })}
                                          className={glassFieldSmClass}
                                          placeholder={formatMoney(0, companyCurrency)}
                                          aria-label="Cost per sheet"
                                        />
                                        <MarginInput value={sp.marginPercent} onChange={(next) => updateJobTypeSheetPrice(idx, spIdx, { marginPercent: next })} />
                                        {sellCell(sp.pricePerSheet, sp.marginPercent, "/ sheet")}
                                        <button type="button" onClick={() => removeJobTypeSheetPrice(idx, spIdx)} className={dangerIconButtonClass} title="Remove sheet size">
                                          <X size={15} />
                                        </button>
                                      </div>
                                    ))}
                                    {addLineButton("Sheet size", () => addJobTypeSheetPrice(idx))}
                                    {/* Misc: the same on every sheet, whatever its size — the strip shows what they add to each one. */}
                                    {sectionLabel(
                                      "Misc",
                                      "",
                                      miscPerSheet > 0 ? (
                                        <>
                                          <span className="font-semibold">+ {formatMoney(miscPerSheet, companyCurrency)}</span> / sheet
                                        </>
                                      ) : null,
                                    )}
                                    {(row.miscCharges ?? []).map((charge, chargeIdx) => (
                                      <div key={`misc_${chargeIdx}`} className={lineClass} style={lineStyle}>
                                        <span />
                                        <input
                                          value={charge.name}
                                          onChange={(e) => updateJobTypeMiscCharge(idx, chargeIdx, { name: e.target.value })}
                                          className={glassFieldSmClass}
                                          placeholder="e.g. Cutting"
                                          aria-label="Charge name"
                                        />
                                        <input inputMode="decimal"
                                          value={charge.price}
                                          onChange={(e) => updateJobTypeMiscCharge(idx, chargeIdx, { price: e.target.value })}
                                          onBlur={(e) => updateJobTypeMiscCharge(idx, chargeIdx, { price: e.target.value.trim() ? ensureDollarFormat(e.target.value) : "" })}
                                          className={glassFieldSmClass}
                                          placeholder={formatMoney(0, companyCurrency)}
                                          aria-label="Charge cost per sheet"
                                        />
                                        <MarginInput value={charge.marginPercent} onChange={(next) => updateJobTypeMiscCharge(idx, chargeIdx, { marginPercent: next })} />
                                        {sellCell(charge.price, charge.marginPercent, "/ sheet", "+ ")}
                                        <button
                                          type="button"
                                          onClick={() => removeJobTypeMiscCharge(idx, chargeIdx)}
                                          className={dangerIconButtonClass}
                                          title="Remove charge"
                                        >
                                          <X size={15} />
                                        </button>
                                      </div>
                                    ))}
                                    {addLineButton("Misc charge", () =>
                                      updateJobType(idx, { miscCharges: [...(row.miscCharges ?? []), { name: "", price: "", marginPercent: "" }] }),
                                    )}
                                    {/* Last, under everything that makes up its Total per sheet: edge tape / lacquer aren't in that total —
                                        a quote adds them later, on the project's own metres / m² (its Product table). */}
                                    {sectionLabel("On the quote", "Not in the total — added from the project's Product table")}
                                    {jobTypeHasEdgeTape(row.type) || jobTypeHasLacquer(row.type) ? (
                                      <>
                                        {jobTypeHasEdgeTape(row.type) ? (
                                          <div className={lineClass} style={lineStyle}>
                                            <span />
                                            <span className="px-1 text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
                                              Edge tape · per metre
                                            </span>
                                            <input inputMode="decimal"
                                              value={row.edgeTapePrice}
                                              onChange={(e) => updateJobType(idx, { edgeTapePrice: e.target.value })}
                                              onBlur={(e) => updateJobType(idx, { edgeTapePrice: e.target.value.trim() ? ensureDollarFormat(e.target.value) : "" })}
                                              className={glassFieldSmClass}
                                              placeholder={formatMoney(0, companyCurrency)}
                                              aria-label="Edge tape cost per metre"
                                            />
                                            <MarginInput value={row.edgeTapeMarginPercent} onChange={(next) => updateJobType(idx, { edgeTapeMarginPercent: next })} />
                                            {sellCell(row.edgeTapePrice, row.edgeTapeMarginPercent, "/ m")}
                                            <span />
                                          </div>
                                        ) : null}
                                        {jobTypeHasLacquer(row.type) ? (
                                          <div className={lineClass} style={lineStyle}>
                                            <span />
                                            <span className="px-1 text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
                                              {`Lacquer · per m² (${row.type === "lacquer-2" ? "2 sides" : "1 side"})`}
                                            </span>
                                            <input inputMode="decimal"
                                              value={row.lacquerSqmPrice}
                                              onChange={(e) => updateJobType(idx, { lacquerSqmPrice: e.target.value })}
                                              onBlur={(e) => updateJobType(idx, { lacquerSqmPrice: e.target.value.trim() ? ensureDollarFormat(e.target.value) : "" })}
                                              className={glassFieldSmClass}
                                              placeholder={formatMoney(0, companyCurrency)}
                                              aria-label="Lacquer cost per square metre"
                                            />
                                            <MarginInput value={row.lacquerMarginPercent} onChange={(next) => updateJobType(idx, { lacquerMarginPercent: next })} />
                                            {sellCell(row.lacquerSqmPrice, row.lacquerMarginPercent, "/ m²")}
                                            <span />
                                          </div>
                                        ) : null}
                                      </>
                                    ) : (
                                      <div className={lineClass} style={lineStyle}>
                                        <span />
                                        <span className="col-span-4 px-1 text-[12.5px]" style={{ color: "var(--text-main)" }}>
                                          Set a type to price its edge tape (and its lacquer per m², for Lacquer).
                                        </span>
                                        <span />
                                      </div>
                                    )}
                                  </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          <div>
                            <button type="button" onClick={addProduct} className={secondaryButtonClass}>
                              <Plus size={14} /> Add product
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    </ModalPortal>
                  ) : null}
                  <Panel
                    className="xl:col-span-2"
                    title="Extra charges"
                    icon={Receipt}
                    description="Charges a quote can include, each turned on or off in a project's Design tab. Default ones start on for every project."
                  >
                    <div className="space-y-1.5">
                      {extraCharges.length > 0 ? (
                        <div className="flex items-center gap-2 px-2">
                          <span className="w-6 shrink-0" />
                          <span className={`flex-1 ${columnHeadClass}`}>Charge</span>
                          <span className={`w-[100px] shrink-0 sm:w-[130px] ${columnHeadClass}`}>Price</span>
                          <span className={`w-[60px] shrink-0 text-center sm:w-[88px] ${columnHeadClass}`}>Default</span>
                          <span className="w-7 shrink-0" />
                        </div>
                      ) : (
                        <EmptyState compact icon={<Receipt size={16} />} title="No extra charges yet" hint="Charges you add here can be turned on in a project's Design tab." />
                      )}
                      {extraCharges.map((row, idx) => (
                        <div
                          key={row.id}
                          id={`settings_extra_charge_${idx}`}
                          className={listRowClass}
                          style={{ opacity: extraChargeDragIndex === idx ? 0.45 : 1 }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDragEnter={(e) => {
                            e.preventDefault();
                            if (extraChargeDragIndex == null || extraChargeDragIndex === idx) return;
                            setExtraCharges((prev) => moveRowTo(prev, extraChargeDragIndex, idx));
                            setExtraChargeDragIndex(idx);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setExtraChargeDragIndex(null);
                            endRowDrag();
                            triggerAutosaveAfterRowDrop();
                          }}
                        >
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              setExtraChargeDragIndex(idx);
                              e.dataTransfer.setData("text/plain", `extra_charge_${idx}`);
                              startRowDrag(e, `settings_extra_charge_${idx}`, row.name || "Charge", "#2F6BFF");
                            }}
                            onDragEnd={() => {
                              setExtraChargeDragIndex(null);
                              endRowDrag();
                            }}
                            className={gripClass}
                            title="Drag to reorder"
                          >
                            <GripVertical size={15} />
                          </button>
                          <input
                            value={row.name}
                            placeholder="e.g. Delivery"
                            onChange={(e) => setExtraCharges((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))}
                            className={`${glassFieldSmClass} min-w-0 flex-1`}
                            aria-label="Charge name"
                          />
                          <span className="w-[100px] shrink-0 sm:w-[130px]">
                            <input
                              inputMode="decimal"
                              value={row.price}
                              placeholder={formatMoney(0, companyCurrency)}
                              onChange={(e) => setExtraCharges((prev) => prev.map((v, i) => (i === idx ? { ...v, price: e.target.value } : v)))}
                              onBlur={(e) =>
                                setExtraCharges((prev) => prev.map((v, i) => (i === idx ? { ...v, price: e.target.value.trim() ? ensureDollarFormat(e.target.value) : "" } : v)))
                              }
                              className={glassFieldSmClass}
                              aria-label="Charge price"
                            />
                          </span>
                          <span className="flex w-[60px] shrink-0 justify-center sm:w-[88px]">
                            <GlassSwitch
                              size="sm"
                              checked={row.isDefault}
                              onChange={(on) => setExtraCharges((prev) => prev.map((v, i) => (i === idx ? { ...v, isDefault: on } : v)))}
                              ariaLabel="On for every project by default"
                            />
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFromList(setExtraCharges, idx, row, `${toStr(row.name, "Charge")} removed`)}
                            className={dangerIconButtonClass}
                            title="Remove charge"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setExtraCharges((prev) => [...prev, { id: genExtraChargeId(), name: "", price: "", isDefault: false }])}
                        className={`${secondaryButtonClass} mt-1.5`}
                      >
                        <Plus size={14} /> Add charge
                      </button>
                    </div>
                  </Panel>
                  <Panel className="xl:col-span-2" title="Quote discount" icon={Percent} description="Automatic discount tiers based on the quote total.">
                    <FieldRow label="Subtract from the quote total" hint="Shows the discount as an amount taken off the quote total.">
                      <GlassSwitch checked={minusOffQuoteTotal} onChange={(on) => setMinusOffQuoteTotal(on)} ariaLabel="Subtract discount from the quote total" />
                    </FieldRow>
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-2 px-2">
                        <span className="w-6 shrink-0" />
                        <span className={`flex-1 ${columnHeadClass}`}>Quote total from</span>
                        <span className={`flex-1 ${columnHeadClass}`}>Up to</span>
                        <span className={`flex-1 ${columnHeadClass}`}>Discount</span>
                        <span className="w-7 shrink-0" />
                      </div>
                      {discountTiers.map((row, idx) => (
                        <div
                          key={idx}
                          id={`settings_discount_${idx}`}
                          className={listRowClass}
                          style={{ opacity: discountTierDragIndex === idx ? 0.45 : 1 }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDragEnter={(e) => {
                            e.preventDefault();
                            if (discountTierDragIndex == null || discountTierDragIndex === idx) return;
                            setDiscountTiers((prev) => moveRowTo(prev, discountTierDragIndex, idx));
                            setDiscountTierDragIndex(idx);
                            setDiscountTierDragOverIndex(idx);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDiscountTierDragIndex(null);
                            setDiscountTierDragOverIndex(null);
                            endRowDrag();
                            triggerAutosaveAfterRowDrop();
                          }}
                        >
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              setDiscountTierDragIndex(idx);
                              setDiscountTierDragOverIndex(idx);
                              e.dataTransfer.setData("text/plain", `discount_${idx}`);
                              startRowDrag(e, `settings_discount_${idx}`, `${row.low || "0"} – ${row.high || "…"}`, "#16A34A");
                            }}
                            onDragEnd={() => {
                              setDiscountTierDragIndex(null);
                              setDiscountTierDragOverIndex(null);
                              endRowDrag();
                            }}
                            className={gripClass}
                            title="Drag to reorder"
                          >
                            <GripVertical size={15} />
                          </button>
                          {(["low", "high", "discount"] as const).map((field) => (
                            <input inputMode="decimal"
                              key={field}
                              value={row[field]}
                              placeholder={formatMoney(0, companyCurrency)}
                              onChange={(e) => setDiscountTiers((prev) => prev.map((v, i) => (i === idx ? { ...v, [field]: e.target.value } : v)))}
                              onBlur={(e) => setDiscountTiers((prev) => prev.map((v, i) => (i === idx ? { ...v, [field]: formatDiscountCurrency(e.target.value) } : v)))}
                              className={`${glassFieldSmClass} min-w-0 flex-1`}
                            />
                          ))}
                          <button type="button" onClick={() => removeFromList(setDiscountTiers, idx, row, "Discount tier removed")} className={dangerIconButtonClass} title="Remove tier">
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                      <button type="button" onClick={() => setDiscountTiers((prev) => [...prev, { low: "", high: "", discount: "" }])} className={`${secondaryButtonClass} mt-1.5`}>
                        <Plus size={14} /> Add tier
                      </button>
                    </div>
                  </Panel>
                </div>
              )}

              {active === "hardware" && (
                <Panel title="Hardware brands" icon={HardHat} description="Each brand's drawers, hinges and other parts. The default brand is used for new jobs. Drag to reorder." allowOverflow>
                  <div className="space-y-1.5">
                    {hardware.map((row, idx) => (
                      <div
                        key={idx}
                        className="space-y-1.5 rounded-[12px] transition-all"
                        style={{ opacity: hardwareDragIndex === idx ? 0.45 : 1 }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDragEnter={(e) => {
                          e.preventDefault();
                          if (hardwareDragIndex == null || hardwareDragIndex === idx) return;
                          setHardware((prev) => sanitizeHardwareRows(moveRowTo(prev, hardwareDragIndex, idx)));
                          setHardwareDragIndex(idx);
                          setHardwareDragOverIndex(idx);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setHardwareDragIndex(null);
                          setHardwareDragOverIndex(null);
                          endRowDrag();
                          triggerAutosaveAfterRowDrop();
                        }}
                      >
                        <div
                          id={`settings_hardware_${idx}`}
                          className="flex items-center gap-2 rounded-[12px] px-2 py-1.5"
                          style={{ backgroundColor: row.color || "#7D99B3", color: textColorForHex(row.color || "#7D99B3") }}
                        >
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => {
                            setHardwareDragIndex(idx);
                            setHardwareDragOverIndex(idx);
                            e.dataTransfer.setData("text/plain", `hardware_${idx}`);
                            startRowDrag(e, `settings_hardware_${idx}`, row.name, row.color);
                          }}
                          onDragEnd={() => {
                            setHardwareDragIndex(null);
                            setHardwareDragOverIndex(null);
                            endRowDrag();
                          }}
                          className="inline-flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded-[7px] opacity-80 transition hover:bg-white/15 hover:opacity-100 active:cursor-grabbing"
                          title="Drag to reorder"
                        >
                          <GripVertical size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleHardwareExpanded(idx)}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] opacity-85 transition hover:bg-white/15"
                          title={(hardwareExpanded[idx] ?? false) ? "Hide parts" : "Show drawers, hinges and other parts"}
                        >
                          <ChevronDown size={15} style={{ transform: (hardwareExpanded[idx] ?? false) ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms ease" }} />
                        </button>
                        <input
                          value={row.name}
                          placeholder="Brand name"
                          onChange={(e) => setHardware((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))}
                          className="h-8 min-w-0 flex-1 rounded-[8px] border border-transparent bg-transparent px-2 text-[13px] font-semibold outline-none transition placeholder:opacity-70 hover:border-white/40 focus:border-white/70 focus:bg-white/15"
                          style={{ color: "inherit" }}
                        />
                        <ColorCircle value={row.color || "#7D99B3"} onChange={(hex) => setHardware((prev) => prev.map((v, i) => (i === idx ? { ...v, color: hex } : v)))} />
                        <button
                          type="button"
                          onClick={() =>
                            setHardware((prev) => sanitizeHardwareRows(prev.map((v, i) => ({ ...v, default: i === idx ? !row.default : false }))))
                          }
                          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11.5px] font-semibold"
                          style={{ color: "inherit", opacity: row.default ? 1 : 0.8 }}
                          title="Use this brand by default"
                        >
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border-[1.5px]" style={{ borderColor: "currentColor" }}>
                            {row.default ? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "currentColor" }} /> : null}
                          </span>
                          Default
                        </button>
                        <button
                          type="button"
                          onClick={async (e) => {
                            const name = row.name.trim();
                            const ok = await confirmRemove.ask(
                              {
                                title: "Remove hardware brand",
                                message: `Remove ${name || "this brand"} and all of its drawers, hinges and other parts?`,
                                confirmLabel: "Remove brand",
                              },
                              e,
                            );
                            if (!ok) return;
                            const removed = row;
                            const at = idx;
                            setHardware((prev) => sanitizeHardwareRows(prev.filter((_, i) => i !== at)));
                            offerUndo(`${name || "Hardware brand"} removed`, () =>
                              setHardware((prev) => sanitizeHardwareRows([...prev.slice(0, at), removed, ...prev.slice(at)])),
                            );
                          }}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] opacity-85 transition hover:bg-white/20"
                          title="Remove brand"
                        >
                          <X size={15} />
                        </button>
                        </div>
                        {(hardwareExpanded[idx] ?? false) && (
                          <div
                            className="ml-8 space-y-2 rounded-[14px] border p-3 max-sm:ml-2"
                            style={{ backgroundColor: `color-mix(in srgb, ${row.color || "#7D99B3"} 7%, transparent)`, borderColor: "var(--glass-border)" }}
                          >
                            <Segmented
                              value={hardwareActiveTab[idx] ?? "drawers"}
                              options={[
                                { value: "drawers", label: "Drawers" },
                                { value: "hinges", label: "Hinges" },
                                { value: "other", label: "Other" },
                                { value: "ordering", label: "Ordering" },
                              ]}
                              onChange={(tab) => setHardwareActiveTab((prev) => ({ ...prev, [idx]: tab }))}
                            />
                            {(hardwareActiveTab[idx] ?? "drawers") === "drawers" && (
                              <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[10.5px] font-bold uppercase tracking-[0.8px] text-[var(--text-muted)]">Drawers</p>
                            <button
                              onClick={() =>
                                updateHardwareJsonList(idx, "drawersJson", (items) => [
                                  ...items,
                                  { name: "", bottoms: { widthMinus: "", depthMinus: "" }, backs: { widthMinus: "" }, hardwareLengths: [], hardwareWeights: [], spaceRequirement: "", default: items.length === 0 },
                                ])
                              }
                              className="inline-flex items-center gap-1 text-[12px] font-semibold"
                              style={{ color: "var(--brand-strong)" }}
                            >
                              <Plus size={14} /> Add drawer
                            </button>
                          </div>
                          <div className="space-y-2">

                            {(() => {
                              const drawerRows = parseJsonObjects(row.drawersJson);
                              return drawerRows.map((drawer, drawerIdx) => {
                                const drawerKey = `${idx}:${drawerIdx}`;
                                const isExpanded = drawerRowExpanded[drawerKey] ?? false;
                                return (
                                  <div
                                    key={drawerIdx}
                                    id={`settings_drawer_${idx}_${drawerIdx}`}
                                    className={`space-y-2 rounded-[12px] border border-[var(--glass-border)] bg-[color-mix(in_srgb,var(--panel-bg)_60%,transparent)] p-1.5 transition ${
                                      drawerDragHardwareIndex === idx && drawerDragIndex === drawerIdx ? "opacity-45" : ""
                                    }`}
                                    onDragOver={(e) => {
                                      e.preventDefault();
                                      e.dataTransfer.dropEffect = "move";
                                    }}
                                    onDragEnter={(e) => {
                                      e.preventDefault();
                                      if (drawerDragHardwareIndex !== idx || drawerDragIndex == null || drawerDragIndex === drawerIdx) return;
                                      updateHardwareJsonList(idx, "drawersJson", (items) => moveRowTo(items, drawerDragIndex, drawerIdx));
                                      setDrawerDragIndex(drawerIdx);
                                      setDrawerDragOverIndex(drawerIdx);
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      setDrawerDragHardwareIndex(null);
                                      setDrawerDragIndex(null);
                                      setDrawerDragOverIndex(null);
                                      endRowDrag();
                                      triggerAutosaveAfterRowDrop();
                                    }}
                                  >
                                    <div className="flex flex-wrap items-center gap-2">
                                      <button
                                        type="button"
                                        draggable
                                        onDragStart={(e) => {
                                          setDrawerDragHardwareIndex(idx);
                                          setDrawerDragIndex(drawerIdx);
                                          setDrawerDragOverIndex(drawerIdx);
                                          e.dataTransfer.setData("text/plain", `drawer_${idx}_${drawerIdx}`);
                                          startRowDrag(e, `settings_drawer_${idx}_${drawerIdx}`, readDrawerName(drawer), row.color);
                                        }}
                                        onDragEnd={() => {
                                          setDrawerDragHardwareIndex(null);
                                          setDrawerDragIndex(null);
                                          setDrawerDragOverIndex(null);
                                          endRowDrag();
                                        }}
                                        className={gripClass}
                                        title="Drag to reorder"
                                      >
                                        <GripVertical size={15} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => toggleDrawerRowExpanded(idx, drawerIdx)}
                                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]"
                                        style={{ color: "var(--text-muted)" }}
                                        title={isExpanded ? "Hide details" : "Show details"}
                                      >
                                        <ChevronDown size={15} style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms ease" }} />
                                      </button>
                                      <input
                                        value={String(drawer.name ?? "")}
                                        onChange={(e) =>
                                          updateHardwareJsonList(idx, "drawersJson", (items) =>
                                            items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "name", e.target.value) : v)),
                                          )
                                        }
                                        placeholder="Drawer name"
                                        className={`${gridCellInputClass} min-w-[140px] flex-1 font-semibold`}
                                      />
                                      {/* The space its runners need behind them — taken off a cabinet's depth before a length is picked. */}
                                      <label
                                        className="inline-flex shrink-0 items-center gap-1.5"
                                        title="Depth requirement — the space the runners need behind them, taken off the cabinet's depth before a hardware length is picked"
                                      >
                                        <span className="text-[11.5px] font-medium text-[var(--text-muted)]">Depth req.</span>
                                        <span className="relative block w-[76px]">
                                          <input
                                            inputMode="decimal"
                                            value={readDrawerSpaceRequirement(drawer)}
                                            onChange={(e) =>
                                              updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "spaceRequirement", e.target.value) : v)),
                                              )
                                            }
                                            placeholder="0"
                                            aria-label="Depth requirement"
                                            className={glassFieldSmClass}
                                            style={{ paddingRight: 30 }}
                                          />
                                          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-muted)]">mm</span>
                                        </span>
                                      </label>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          updateHardwareJsonList(idx, "drawersJson", (items) =>
                                            items.map((v, i) => writeDrawerField(v, "default", i === drawerIdx ? !drawer.default : false)),
                                          )
                                        }
                                        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11.5px] font-semibold"
                                        style={{ color: drawer.default ? "var(--brand-strong)" : "var(--text-muted)" }}
                                        title="Use this drawer by default"
                                      >
                                        <span
                                          className="inline-flex h-4 w-4 items-center justify-center rounded-full border-[1.5px]"
                                          style={{ borderColor: drawer.default ? "var(--brand)" : "color-mix(in srgb, var(--text-main) 25%, transparent)" }}
                                        >
                                          {drawer.default ? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--brand)" }} /> : null}
                                        </span>
                                        Default
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => removeHardwareJsonItem(idx, "drawersJson", drawerIdx, "Drawer")}
                                        className={dangerIconButtonClass}
                                        title="Remove drawer"
                                      >
                                        <X size={15} />
                                      </button>
                                    </div>
                                    {isExpanded && (() => {
                                      // Its runner lengths and weights (each a field with its unit, an X to take it off, and + to
                                      // add one), how its bottoms and backs are cut, then its heights — a chip each, opening the
                                      // pop-up that sets which lengths and weights that height comes in.
                                      const updateDrawer = (update: (item: Record<string, unknown>) => Record<string, unknown>) =>
                                        updateHardwareJsonList(idx, "drawersJson", (items) => items.map((v, i) => (i === drawerIdx ? update(v) : v)));
                                      // A length, weight or height taken off — and the Undo bar, putting back the drawer's lengths,
                                      // weights and heights as they were.
                                      const removeWithUndo = (message: string, update: (item: Record<string, unknown>) => Record<string, unknown>) => {
                                        const before = drawer;
                                        updateDrawer(update);
                                        offerUndo(message, () => updateDrawer((item) => restoreDrawerOptions(item, before)));
                                      };
                                      const optionList = (
                                        title: string,
                                        field: "hardwareLengths" | "hardwareWeights",
                                        kind: "length" | "weight",
                                        unit: string,
                                        promptLabel: string,
                                        placeholder: string,
                                      ) => {
                                        const values = field === "hardwareLengths" ? readDrawerLengths(drawer) : readDrawerWeights(drawer);
                                        return (
                                          <div className="flex flex-wrap items-center gap-2 text-[12px]">
                                            <p className="w-[120px] font-semibold text-[var(--text-main)]">{title}</p>
                                            {values.map((value, vIdx) => (
                                              <div key={`${drawerIdx}_${field}_${vIdx}`} className="inline-flex items-center gap-0.5">
                                                <span className="relative block w-[84px]">
                                                  <input
                                                    inputMode="decimal"
                                                    value={value}
                                                    onChange={(e) => {
                                                      const nextValue = e.target.value;
                                                      updateDrawer((item) =>
                                                        renameDrawerDefaultWeight(
                                                          renameDrawerHeightOption(
                                                            writeDrawerField(item, field, values.map((v, j) => (j === vIdx ? nextValue : v))),
                                                            kind,
                                                            value,
                                                            nextValue.trim() || null,
                                                          ),
                                                          kind,
                                                          value,
                                                          nextValue.trim() || null,
                                                        ),
                                                      );
                                                    }}
                                                    aria-label={`${title} ${value}`}
                                                    className={glassFieldSmClass}
                                                    style={{ paddingRight: 30 }}
                                                  />
                                                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-muted)]">{unit}</span>
                                                </span>
                                                {/* A weight: the drawer type's default — every height and length's, where it comes in it. */}
                                                {kind === "weight" ? (
                                                  (() => {
                                                    const isDefault = readDrawerDefaultWeight(drawer) === value.trim();
                                                    return (
                                                      <button
                                                        type="button"
                                                        onClick={() => updateDrawer((item) => writeDrawerDefaultWeight(item, isDefault ? "" : value))}
                                                        className="ml-1 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11.5px] font-semibold"
                                                        style={{ color: isDefault ? "var(--brand-strong)" : "var(--text-muted)" }}
                                                        title={isDefault ? `${value}kg is the default — click to clear` : `Make ${value}kg the default weight`}
                                                      >
                                                        <span
                                                          className="inline-flex h-4 w-4 items-center justify-center rounded-full border-[1.5px]"
                                                          style={{ borderColor: isDefault ? "var(--brand)" : "color-mix(in srgb, var(--text-main) 25%, transparent)" }}
                                                        >
                                                          {isDefault ? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--brand)" }} /> : null}
                                                        </span>
                                                        Default
                                                      </button>
                                                    );
                                                  })()
                                                ) : null}
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    removeWithUndo(`${value}${unit} removed`, (item) =>
                                                      renameDrawerDefaultWeight(
                                                        renameDrawerHeightOption(writeDrawerField(item, field, values.filter((_, j) => j !== vIdx)), kind, value, null),
                                                        kind,
                                                        value,
                                                        null,
                                                      ),
                                                    )
                                                  }
                                                  className={dangerIconButtonClass}
                                                  title={`Remove ${value}${unit}`}
                                                >
                                                  <X size={13} />
                                                </button>
                                              </div>
                                            ))}
                                            <button
                                              type="button"
                                              onClick={async () => {
                                                const next = await ask.prompt({ title: `Add ${promptLabel.toLowerCase()}`, label: promptLabel, placeholder, inputMode: "decimal" });
                                                const value = toStr(next);
                                                if (!value) return;
                                                updateDrawer((item) => writeDrawerField(item, field, [...(field === "hardwareLengths" ? readDrawerLengths(item) : readDrawerWeights(item)), value]));
                                              }}
                                              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-[color-mix(in_srgb,var(--text-main)_22%,transparent)] text-[var(--brand-strong)] transition hover:bg-[var(--brand-soft)]"
                                              title={`Add ${promptLabel.toLowerCase()}`}
                                            >
                                              <Plus size={14} />
                                            </button>
                                          </div>
                                        );
                                      };
                                      const cutField = (label: string, value: string, field: "bottomWidth" | "bottomDepth" | "backWidth") => (
                                        <label className="inline-flex items-center gap-1.5">
                                          <span className="text-[var(--text-muted)]">{label}</span>
                                          <span className="block w-[76px]">
                                            <input
                                              inputMode="decimal"
                                              value={value}
                                              onChange={(e) => updateDrawer((item) => writeDrawerField(item, field, e.target.value))}
                                              className={glassFieldSmClass}
                                            />
                                          </span>
                                        </label>
                                      );
                                      const heightRows = readDrawerBackHeights(drawer);
                                      const editorHere =
                                        drawerHeightEditor && drawerHeightEditor.hardwareIdx === idx && drawerHeightEditor.drawerIdx === drawerIdx ? drawerHeightEditor : null;
                                      // Opens the pop-up under what was pressed (kept within the row) — or shuts it, pressed again.
                                      const openHeightEditor = (e: ReactMouseEvent<HTMLElement>, heightIdx: number | null) => {
                                        if (editorHere && editorHere.heightIdx === heightIdx) {
                                          setDrawerHeightEditor(null);
                                          return;
                                        }
                                        const rowEl = e.currentTarget.closest("[data-drawer-heights-row]");
                                        const rowRect = rowEl?.getBoundingClientRect();
                                        const chipLeft = e.currentTarget.getBoundingClientRect().left - (rowRect?.left ?? 0);
                                        const left = Math.max(0, Math.min(chipLeft, (rowRect?.width ?? 480) - 480));
                                        setDrawerHeightEditor({ hardwareIdx: idx, drawerIdx, heightIdx, left });
                                      };
                                      return (
                                        <div className="space-y-2.5 px-2 pb-1.5 pl-9 max-sm:pl-2">
                                          {optionList("Hardware lengths", "hardwareLengths", "length", "mm", "Hardware length", "e.g. 500")}
                                          {optionList("Hardware weights", "hardwareWeights", "weight", "kg", "Hardware weight", "e.g. 65")}
                                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px]">
                                            <p className="w-[120px] font-semibold text-[var(--text-main)]">Cutting</p>
                                            <span className="font-medium text-[var(--text-main)]">Bottoms</span>
                                            {cutField("Width", readDrawerBottomWidth(drawer), "bottomWidth")}
                                            {cutField("Depth", readDrawerBottomDepth(drawer), "bottomDepth")}
                                            <span className="ml-3 font-medium text-[var(--text-main)]">Backs</span>
                                            {cutField("Width", readDrawerBackWidth(drawer), "backWidth")}
                                          </div>
                                          <div data-drawer-heights-row="true" className="relative flex flex-wrap items-center gap-2 text-[12px]">
                                            <p className="w-[120px] font-semibold text-[var(--text-main)]">Heights</p>
                                            {heightRows.map((height, hIdx) => {
                                              const label = readDrawerHeightLabel(height);
                                              const size = readDrawerHeightNumber(height);
                                              const { text: comesIn, restricted } = describeDrawerHeight(drawer, label);
                                              const open = editorHere?.heightIdx === hIdx;
                                              return (
                                                <button
                                                  key={`${drawerIdx}_height_${hIdx}`}
                                                  type="button"
                                                  data-drawer-height-chip="true"
                                                  onClick={(e) => openHeightEditor(e, hIdx)}
                                                  className={`glass-shine inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition hover:brightness-95 ${open ? "" : "glass-shine-neutral"}`}
                                                  style={open ? glassShineStyle(row.color || "#7D99B3", { color: textColorForHex(row.color || "#7D99B3") }) : { color: "var(--text-main)" }}
                                                  title={`${label}${size ? ` — back ${size}mm` : ""}${comesIn ? ` · ${comesIn}` : ""} — click to edit`}
                                                >
                                                  <span className="font-semibold">{label}</span>
                                                  {size ? <span className="opacity-70">{size}</span> : null}
                                                  {/* (Not every length or weight — a dot.) */}
                                                  {restricted ? <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "currentColor", opacity: 0.6 }} /> : null}
                                                </button>
                                              );
                                            })}
                                            <button
                                              type="button"
                                              data-drawer-height-chip="true"
                                              onClick={(e) => openHeightEditor(e, null)}
                                              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-[color-mix(in_srgb,var(--text-main)_22%,transparent)] text-[var(--brand-strong)] transition hover:bg-[var(--brand-soft)]"
                                              title="Add height"
                                            >
                                              <Plus size={14} />
                                            </button>
                                            {editorHere ? (
                                              <DrawerHeightEditor
                                                key={`${idx}:${drawerIdx}:${editorHere.heightIdx ?? "new"}`}
                                                drawer={drawer}
                                                heightIndex={editorHere.heightIdx}
                                                color={row.color || "#7D99B3"}
                                                left={editorHere.left}
                                                onCommit={(height) => updateDrawer((item) => writeDrawerHeight(item, editorHere.heightIdx, height))}
                                                onRemove={() => {
                                                  if (editorHere.heightIdx != null) {
                                                    const removeIdx = editorHere.heightIdx;
                                                    const removedLabel = readDrawerHeightLabel(heightRows[removeIdx] ?? "");
                                                    removeWithUndo(`Height ${removedLabel} removed`, (item) => removeDrawerHeight(item, removeIdx));
                                                  }
                                                  setDrawerHeightEditor(null);
                                                }}
                                                onClose={() => setDrawerHeightEditor(null)}
                                              />
                                            ) : null}
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                );
                              });
                            })()}
                          </div>
                              </div>
                            )}

                            {(hardwareActiveTab[idx] ?? "drawers") === "hinges" && (
                              <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[10.5px] font-bold uppercase tracking-[0.8px] text-[var(--text-muted)]">Hinges</p>
                            <button
                              onClick={() => updateHardwareJsonList(idx, "hingesJson", (items) => [...items, { name: "" }])}
                              className="inline-flex items-center gap-1 text-[12px] font-semibold"
                              style={{ color: "var(--brand-strong)" }}
                            >
                              <Plus size={14} /> Add hinge
                            </button>
                          </div>
                          <div className="space-y-2">
                            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
                              {parseJsonObjects(row.hingesJson).map((hinge, hingeIdx) => (
                                <div
                                  key={hingeIdx}
                                  id={`settings_hinge_${idx}_${hingeIdx}`}
                                  className={listRowClass}
                                  style={{ opacity: hingeDrag?.hardwareIndex === idx && hingeDrag.hingeIndex === hingeIdx ? 0.45 : 1 }}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "move";
                                  }}
                                  onDragEnter={(e) => {
                                    e.preventDefault();
                                    if (!hingeDrag || hingeDrag.hardwareIndex !== idx || hingeDrag.hingeIndex === hingeIdx) return;
                                    const fromIndex = hingeDrag.hingeIndex;
                                    updateHardwareJsonList(idx, "hingesJson", (items) => moveRowTo(items, fromIndex, hingeIdx));
                                    setHingeDrag({ hardwareIndex: idx, hingeIndex: hingeIdx });
                                    hingeDragMovedRef.current = true;
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    setHingeDrag(null);
                                    hingeDragMovedRef.current = false;
                                    endRowDrag();
                                    triggerAutosaveAfterRowDrop();
                                  }}
                                >
                                  <button
                                    type="button"
                                    draggable
                                    onDragStart={(e) => {
                                      setHingeDrag({ hardwareIndex: idx, hingeIndex: hingeIdx });
                                      hingeDragMovedRef.current = false;
                                      e.dataTransfer.setData("text/plain", `hinge_${idx}_${hingeIdx}`);
                                      startRowDrag(e, `settings_hinge_${idx}_${hingeIdx}`, toStr(hinge.name) || "Hinge", row.color);
                                    }}
                                    onDragEnd={() => {
                                      setHingeDrag(null);
                                      endRowDrag();
                                      if (hingeDragMovedRef.current) {
                                        hingeDragMovedRef.current = false;
                                        triggerAutosaveAfterRowDrop();
                                      }
                                    }}
                                    className={gripClass}
                                    title="Drag to reorder"
                                  >
                                    <GripVertical size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeHardwareJsonItem(idx, "hingesJson", hingeIdx, "Hinge")}
                                    className={dangerIconButtonClass}
                                  >
                                    <X size={15} />
                                  </button>
                                  <div className="min-w-0 flex-1">
                                  <input
                                    value={String(hinge.name ?? "")}
                                    onChange={(e) =>
                                      updateHardwareJsonList(idx, "hingesJson", (items) =>
                                        items.map((v, i) => (i === hingeIdx ? { ...v, name: e.target.value } : v)),
                                      )
                                    }
                                    placeholder="Hinge name"
                                    className={gridCellInputClass}
                                  />
                                  {/* Its supplier's item number (optional) — a copy button beside it on a project's order, to find
                                      it in their cart. */}
                                  <input
                                    value={String(hinge.itemNumber ?? "")}
                                    onChange={(e) =>
                                      updateHardwareJsonList(idx, "hingesJson", (items) =>
                                        items.map((v, i) => (i === hingeIdx ? { ...v, itemNumber: e.target.value } : v)),
                                      )
                                    }
                                    placeholder="ID number"
                                    aria-label="ID number"
                                    className={`${gridCellInputClass} h-7 text-[12px]`}
                                  />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                              </div>
                            )}

                            {(hardwareActiveTab[idx] ?? "drawers") === "other" && (
                              <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[10.5px] font-bold uppercase tracking-[0.8px] text-[var(--text-muted)]">Other</p>
                            <button
                              onClick={() => updateHardwareJsonList(idx, "otherJson", (items) => [...items, { name: "" }])}
                              className="inline-flex items-center gap-1 text-[12px] font-semibold"
                              style={{ color: "var(--brand-strong)" }}
                            >
                              <Plus size={14} /> Add other
                            </button>
                          </div>
                          <div className="space-y-2">
                            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
                              {parseJsonObjects(row.otherJson).map((other, otherIdx) => (
                                <div
                                  key={otherIdx}
                                  id={`settings_other_${idx}_${otherIdx}`}
                                  className={listRowClass}
                                  style={{ opacity: otherDrag?.hardwareIndex === idx && otherDrag.otherIndex === otherIdx ? 0.45 : 1 }}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "move";
                                  }}
                                  onDragEnter={(e) => {
                                    e.preventDefault();
                                    if (!otherDrag || otherDrag.hardwareIndex !== idx || otherDrag.otherIndex === otherIdx) return;
                                    const fromIndex = otherDrag.otherIndex;
                                    updateHardwareJsonList(idx, "otherJson", (items) => moveRowTo(items, fromIndex, otherIdx));
                                    setOtherDrag({ hardwareIndex: idx, otherIndex: otherIdx });
                                    otherDragMovedRef.current = true;
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    setOtherDrag(null);
                                    otherDragMovedRef.current = false;
                                    endRowDrag();
                                    triggerAutosaveAfterRowDrop();
                                  }}
                                >
                                  <button
                                    type="button"
                                    draggable
                                    onDragStart={(e) => {
                                      setOtherDrag({ hardwareIndex: idx, otherIndex: otherIdx });
                                      otherDragMovedRef.current = false;
                                      e.dataTransfer.setData("text/plain", `other_${idx}_${otherIdx}`);
                                      startRowDrag(e, `settings_other_${idx}_${otherIdx}`, toStr(other.name) || "Other", row.color);
                                    }}
                                    onDragEnd={() => {
                                      setOtherDrag(null);
                                      endRowDrag();
                                      if (otherDragMovedRef.current) {
                                        otherDragMovedRef.current = false;
                                        triggerAutosaveAfterRowDrop();
                                      }
                                    }}
                                    className={gripClass}
                                    title="Drag to reorder"
                                  >
                                    <GripVertical size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeHardwareJsonItem(idx, "otherJson", otherIdx, "Part")}
                                    className={dangerIconButtonClass}
                                  >
                                    <X size={15} />
                                  </button>
                                  <div className="min-w-0 flex-1">
                                  <input
                                    value={String(other.name ?? "")}
                                    onChange={(e) =>
                                      updateHardwareJsonList(idx, "otherJson", (items) =>
                                        items.map((v, i) => (i === otherIdx ? { ...v, name: e.target.value } : v)),
                                      )
                                    }
                                    placeholder="Other name"
                                    className={gridCellInputClass}
                                  />
                                  {/* Its supplier's item number (optional) — a copy button beside it on a project's order, to find
                                      it in their cart. */}
                                  <input
                                    value={String(other.itemNumber ?? "")}
                                    onChange={(e) =>
                                      updateHardwareJsonList(idx, "otherJson", (items) =>
                                        items.map((v, i) => (i === otherIdx ? { ...v, itemNumber: e.target.value } : v)),
                                      )
                                    }
                                    placeholder="ID number"
                                    aria-label="ID number"
                                    className={`${gridCellInputClass} h-7 text-[12px]`}
                                  />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                              </div>
                            )}
                            {(hardwareActiveTab[idx] ?? "drawers") === "ordering" && (() => {
                              // Copy for cart: how a project's order writes this brand's hinges and other items, a line each,
                              // for its supplier's quick order — placeholders for the item's number ({id}), quantity and name (one
                              // clicked goes in where the cursor is). Under it, what two of its items would come out as.
                              const formatFieldId = `settings_hardware_cart_format_${idx}`;
                              const insertPlaceholder = (token: string) => {
                                const field = document.getElementById(formatFieldId) as HTMLInputElement | null;
                                const current = row.cartCopyFormat;
                                const start = field?.selectionStart ?? current.length;
                                const end = field?.selectionEnd ?? current.length;
                                const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
                                setHardware((prev) => prev.map((v, i) => (i === idx ? { ...v, cartCopyFormat: next } : v)));
                                window.requestAnimationFrame(() => {
                                  const again = document.getElementById(formatFieldId) as HTMLInputElement | null;
                                  again?.focus();
                                  again?.setSelectionRange(start + token.length, start + token.length);
                                });
                              };
                              const numbered = [...parseJsonObjects(row.hingesJson), ...parseJsonObjects(row.otherJson)]
                                .map((item) => ({ name: toStr(item.name), id: toStr(item.itemNumber) }))
                                .filter((item) => item.name && item.id)
                                .slice(0, 2);
                              const examples = (numbered.length ? numbered : [{ name: "110° Soft Close", id: "71B3550" }]).map((item, i) => ({
                                ...item,
                                quantity: i === 0 ? 8 : 4,
                              }));
                              return (
                                <div className="space-y-2">
                                  <p className="text-[10.5px] font-bold uppercase tracking-[0.8px] text-[var(--text-muted)]">Copy for cart</p>
                                  <p className="text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                                    How a project&apos;s order copies {row.name || "this brand"}&apos;s hinges and other items, a line each, to paste
                                    into the supplier&apos;s quick order. Left blank: <span className="font-mono">{DEFAULT_CART_COPY_FORMAT}</span>{" "}
                                    (Blum&apos;s Quick order › Add items in bulk).
                                  </p>
                                  <input
                                    id={formatFieldId}
                                    value={row.cartCopyFormat}
                                    onChange={(e) => setHardware((prev) => prev.map((v, i) => (i === idx ? { ...v, cartCopyFormat: e.target.value } : v)))}
                                    placeholder={DEFAULT_CART_COPY_FORMAT}
                                    aria-label="Copy for cart format"
                                    spellCheck={false}
                                    className={`${gridCellInputClass} w-full font-mono`}
                                  />
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {CART_COPY_PLACEHOLDERS.map((placeholder) => (
                                      <button
                                        key={placeholder.token}
                                        type="button"
                                        // (Keeps the cursor where it was in the field.)
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => insertPlaceholder(placeholder.token)}
                                        className="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]"
                                        style={{ borderColor: "var(--glass-border)", color: "var(--text-main)" }}
                                        title={`Add ${placeholder.label.toLowerCase()}`}
                                      >
                                        <span className="font-mono">{placeholder.token}</span>
                                        <span className="text-[var(--text-muted)]">{placeholder.label}</span>
                                      </button>
                                    ))}
                                  </div>
                                  <div className="rounded-[10px] border px-3 py-2" style={{ borderColor: "var(--glass-border)" }}>
                                    <p className="pb-1 text-[11px] font-medium text-[var(--text-muted)]">Copies as</p>
                                    {examples.map((item) => (
                                      <p key={item.name} className="whitespace-pre font-mono text-[12px] font-medium" style={{ color: "var(--text-main)" }}>
                                        {formatCartCopyLine(row.cartCopyFormat, item).replace(/\t/g, "⇥")}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const nextIndex = hardware.length;
                        setHardware((prev) => sanitizeHardwareRows([...prev, { name: "", color: "#7D99B3", default: prev.length === 0, drawersJson: "[]", hingesJson: "[]", otherJson: "[]", cartCopyFormat: "" }]));
                        setHardwareExpanded((prev) => ({ ...prev, [nextIndex]: false }));
                        setHardwareActiveTab((prev) => ({ ...prev, [nextIndex]: "drawers" }));
                      }}
                      className={`${secondaryButtonClass} mt-1.5`}
                    >
                      <Plus size={14} /> Add hardware brand
                    </button>
                  </div>
                </Panel>
              )}

              {active === "backup" && (
                <div className="grid gap-[18px] max-lg:grid-cols-1">
                  <Panel title="Quote output template" icon={FileText} description="The header and footer printed on every exported quote." allowOverflow>
                    <div className="grid gap-3 max-lg:grid-cols-1 xl:grid-cols-2">
                      <StackField label="Header HTML">
                        <textarea
                          value={backupTemplate.quoteTemplateHeaderHtml}
                          onChange={(e) => setBackupTemplate((prev) => ({ ...prev, quoteTemplateHeaderHtml: e.target.value }))}
                          className={`${fieldInputClass} h-auto min-h-[130px] py-2 font-mono text-[12px]`}
                        />
                      </StackField>
                      <StackField label="Footer HTML">
                        <textarea
                          value={backupTemplate.quoteTemplateFooterHtml}
                          onChange={(e) => setBackupTemplate((prev) => ({ ...prev, quoteTemplateFooterHtml: e.target.value }))}
                          className={`${fieldInputClass} h-auto min-h-[130px] py-2 font-mono text-[12px]`}
                        />
                      </StackField>
                    </div>
                    <div className="mt-2">
                      <FieldRow label="Page size">
                        <GlassDropdown
                          value={backupTemplate.quoteTemplatePageSize || "A4"}
                          options={[
                            ...["A4", "A3", "Letter", "Legal"].map((v) => ({ value: v, label: v })),
                            ...(backupTemplate.quoteTemplatePageSize && !["A4", "A3", "Letter", "Legal"].includes(backupTemplate.quoteTemplatePageSize)
                              ? [{ value: backupTemplate.quoteTemplatePageSize, label: backupTemplate.quoteTemplatePageSize }]
                              : []),
                          ]}
                          onChange={(next) => setBackupTemplate((prev) => ({ ...prev, quoteTemplatePageSize: next }))}
                          ariaLabel="Page size"
                          triggerClassName={`${fieldInputClass} max-w-[180px] justify-between`}
                        />
                      </FieldRow>
                      <FieldRow label="Margin">
                        <LengthField
                          valueMm={backupTemplate.quoteTemplateMarginMm}
                          onChangeMm={(mm) => setBackupTemplate((prev) => ({ ...prev, quoteTemplateMarginMm: String(Math.round(Number(mm || 0))) }))}
                          unit={companyUnit}
                          className={fieldInputClass}
                          width={120}
                        />
                      </FieldRow>
                      <FieldRow label="Pin footer to the bottom" hint="Keeps the footer at the bottom of the last page.">
                        <GlassSwitch
                          checked={backupTemplate.quoteTemplateFooterPinBottom}
                          onChange={(on) => setBackupTemplate((prev) => ({ ...prev, quoteTemplateFooterPinBottom: on }))}
                          ariaLabel="Pin footer to the bottom"
                        />
                      </FieldRow>
                    </div>
                  </Panel>
                  {/* Everything, in one file to keep — its owner's or an admin's (lib/company-export.ts). */}
                  {isOwnerOrAdmin(currentMemberRole) ? (
                    <Panel
                      title="Full data export"
                      icon={DatabaseBackup}
                      description="Everything your company has in CutSmart, in one file to keep somewhere safe: settings, staff, contacts, leads, calendar events and every project with its quotes, specifications, cutlists and checklists. Photos and files are listed by their links."
                      headerRight={
                        <button
                          type="button"
                          onClick={() => void runCompanyExport()}
                          disabled={Boolean(companyExportProgress)}
                          className="glass-shine inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-[12.5px] font-semibold text-white transition hover:brightness-105 disabled:opacity-70"
                          style={glassShineStyle("var(--brand)")}
                        >
                          {companyExportProgress ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                          {companyExportProgress ? "Exporting…" : "Export everything"}
                        </button>
                      }
                    >
                      {companyExportProgress ? (
                        <div>
                          <p className="text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
                            {companyExportProgress.total
                              ? `${companyExportProgress.step} — ${companyExportProgress.done} of ${companyExportProgress.total}`
                              : `Reading ${companyExportProgress.step}…`}
                          </p>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--text-main) 8%, transparent)" }}>
                            <div
                              className="h-full rounded-full transition-[width] duration-300"
                              style={{
                                width: companyExportProgress.total ? `${Math.round((companyExportProgress.done / companyExportProgress.total) * 100)}%` : "8%",
                                backgroundImage: "var(--brand-gradient)",
                              }}
                            />
                          </div>
                        </div>
                      ) : companyExportResult?.ok && companyExportResult.counts ? (
                        <p className="text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
                          Saved —{" "}
                          {[
                            ["jobs", "projects"],
                            ["clients", "contacts"],
                            ["leads", "leads"],
                            ["calendarEvents", "calendar events"],
                            ["memberships", "staff"],
                          ]
                            .map(([key, label]) => `${companyExportResult.counts?.[key] ?? 0} ${label}`)
                            .join(", ")}
                          .
                        </p>
                      ) : companyExportResult && !companyExportResult.ok ? (
                        <p className="text-[12.5px] font-medium" style={{ color: "var(--danger-strong)" }}>
                          Couldn&apos;t export — check your connection and try again.
                        </p>
                      ) : (
                        <p className="text-[12.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                          A JSON file — it can take a minute for a company with lots of projects.
                        </p>
                      )}
                    </Panel>
                  ) : null}
                  <Panel
                    title="Backup snapshot"
                    icon={DatabaseBackup}
                    description="A copy of your key company settings to keep or check."
                    headerRight={
                      <button type="button" onClick={downloadBackupSnapshot} className={primaryButtonClass} style={primaryButtonStyle}>
                        <Download size={15} /> Export JSON
                      </button>
                    }
                  >
                    <pre
                      className="max-h-[360px] overflow-auto rounded-[12px] border border-dashed p-3 font-mono text-[11.5px]"
                      style={{ borderColor: "color-mix(in srgb, var(--text-main) 16%, transparent)", color: "var(--text-main)" }}
                    >
{JSON.stringify({
  companyId: activeCompanyId,
  defaultCurrency: companyCurrency,
  measurementUnit: companyUnit,
  dateFormat: normalizeDateFormat(form.dateFormat),
  projectArchiveAfter,
  projectStatuses: statuses,
  leadStatuses,
  smallJobStatuses,
  completionBonus: completionBonusPatch,
  projectTagUsage,
  quoteTemplatePageSize: backupTemplate.quoteTemplatePageSize,
  quoteTemplateMarginMm: backupTemplate.quoteTemplateMarginMm,
  quoteTemplateFooterPinBottom: backupTemplate.quoteTemplateFooterPinBottom,
}, null, 2)}
                    </pre>
                  </Panel>
                </div>
              )}
            </main>
          </div>
        </div>
        )}
        {shouldRenderZapierHelp ? (
          <ModalPortal>
          <div className="fixed inset-0 z-[1750] flex items-center justify-center px-4 py-4">
            <button type="button" aria-label="Close" onClick={() => setShowZapierHelp(false)} className="glass-modal-backdrop absolute inset-0" />
            <div ref={zapierHelpPanelRef} className="glass-modal-panel relative z-[1751] flex max-h-[calc(100svh-32px)] w-full max-w-[640px] flex-col overflow-hidden">
              <GlassModalHeader
                title="Connect Zapier leads"
                icon={
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] bg-[#FF5A1F]">
                    <img src="/logos/Zapier-logo.png" alt="Zapier" className="h-3.5 w-3.5 object-contain" />
                  </span>
                }
                onClose={() => setShowZapierHelp(false)}
              />
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-[13px]" style={{ color: "var(--text-main)" }}>
                {[
                  <>Create a Zap with <strong>Zapier Forms → New Submission</strong> as the trigger.</>,
                  <>Add <strong>Webhooks by Zapier → POST</strong> as the action.</>,
                  <>Paste your company webhook URL into the URL field.</>,
                  <>Set <strong>Payload Type</strong> to <strong>JSON</strong>.</>,
                  <>Add the lead fields you want to send — their key names become the lead fields CutSmart shows.</>,
                  <>Test the Zap, then publish it.</>,
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#FF5A1F] text-[11px] font-bold text-white">{i + 1}</span>
                    <p className="pt-0.5">{step}</p>
                  </div>
                ))}
                <div className="flex gap-2.5 rounded-[12px] px-3 py-2.5 text-[12px] leading-[1.5]" style={{ backgroundColor: "color-mix(in srgb, var(--text-main) 4%, transparent)", color: "var(--text-muted)" }}>
                  <Lightbulb size={15} className="mt-0.5 shrink-0" style={{ color: "var(--brand)" }} />
                  <p>
                    Keys like <strong style={{ color: "var(--text-main)" }}>Email</strong>, <strong style={{ color: "var(--text-main)" }}>Daytime Phone</strong> or{" "}
                    <strong style={{ color: "var(--text-main)" }}>Suburb</strong>{" "}show up on each lead automatically. The URL already includes your secure
                    company token, so no extra headers are needed.
                  </p>
                </div>
                {zapierWebhookUrl ? (
                  <StackField label="Webhook URL">
                    <div className="flex items-center gap-2">
                      <input value={zapierWebhookUrl} readOnly className={`${fieldInputClass} font-mono text-[11.5px]`} />
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(zapierWebhookUrl);
                            setZapierCopyStatus("copied");
                            if (zapierCopyResetTimerRef.current) window.clearTimeout(zapierCopyResetTimerRef.current);
                            zapierCopyResetTimerRef.current = window.setTimeout(() => {
                              setZapierCopyStatus("");
                              zapierCopyResetTimerRef.current = null;
                            }, 1400);
                          } catch {
                            setZapierCopyStatus("");
                          }
                        }}
                        className={secondaryButtonClass}
                      >
                        <Copy size={14} /> {zapierCopyStatus === "copied" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </StackField>
                ) : null}
              </div>
              <div className="flex justify-end border-t px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
                <button type="button" onClick={() => setShowZapierHelp(false)} className={primaryButtonClass} style={primaryButtonStyle}>Got it</button>
              </div>
            </div>
          </div>
          </ModalPortal>
        ) : null}
        {shouldRenderLeadFieldsCustomize ? (
          <ModalPortal>
          <div className="fixed inset-0 z-[1750] flex items-center justify-center px-4 py-4">
            <button type="button" aria-label="Close" onClick={() => setShowLeadFieldsCustomize(false)} className="glass-modal-backdrop absolute inset-0" />
            <div ref={leadFieldsPanelRef} className="glass-modal-panel relative z-[1751] flex h-[min(760px,calc(100svh-32px))] w-full max-w-[860px] flex-col overflow-hidden">
              <GlassModalHeader title="Customise lead fields" onClose={() => setShowLeadFieldsCustomize(false)} />
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                <div className="flex gap-2.5 rounded-[12px] px-3 py-2.5 text-[12px] leading-[1.5]" style={{ backgroundColor: "color-mix(in srgb, var(--text-main) 4%, transparent)", color: "var(--text-muted)" }}>
                  <Lightbulb size={15} className="mt-0.5 shrink-0" style={{ color: "var(--brand)" }} />
                  <p>
                    Drag to reorder — the order controls both the compact lead row and the expanded details. <strong style={{ color: "var(--text-main)" }}>Use for</strong>{" "}
                    tells CutSmart which field fills the client name, phone, email, address or notes when a lead becomes a project.
                  </p>
                </div>
                {leadFieldsLoading ? (
                  <SkeletonRows count={3} avatar={false} label="Loading fields" />
                ) : mergedLeadFieldLayout.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed" style={{ borderColor: "color-mix(in srgb, var(--text-main) 16%, transparent)" }}>
                    <EmptyState compact icon={<Link2 size={16} />} title="No lead fields yet" hint="Submit at least one Zapier lead and its fields will appear here." />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {/* Phones: "Use for" drops to its own line under each field (and its heading hides). */}
                    <div className="grid grid-cols-[28px_minmax(0,1fr)_170px_80px_80px] items-center gap-2 px-2 max-sm:grid-cols-[24px_minmax(0,1fr)_52px_52px]">
                      <span />
                      <span className={columnHeadClass}>Field</span>
                      <span className={`max-sm:hidden ${columnHeadClass}`}>Use for</span>
                      <span className={`text-center max-sm:leading-tight ${columnHeadClass}`}>Main row</span>
                      <span className={`text-center ${columnHeadClass}`}>Details</span>
                    </div>
                      {mergedLeadFieldLayout.map((field, idx) => (
                        <div
                          key={field.key}
                          id={`settings_lead_field_${idx}`}
                          className={`${listRowClass} grid grid-cols-[28px_minmax(0,1fr)_170px_80px_80px] max-sm:grid-cols-[24px_minmax(0,1fr)_52px_52px]`}
                          style={{ opacity: leadFieldDragIndex === idx ? 0.45 : 1 }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                          }}
                          onDragEnter={(event) => {
                            event.preventDefault();
                            if (leadFieldDragIndex == null || leadFieldDragIndex === idx) return;
                            setZapierLeads((prev) => ({
                              ...prev,
                              fieldLayout: normalizeLeadFieldLayoutOrder(
                                moveRowTo(
                                  mergeLeadFieldLayout(availableLeadFields, prev.fieldLayout),
                                  leadFieldDragIndex,
                                  idx,
                                ),
                              ),
                            }));
                            setLeadFieldDragIndex(idx);
                            setLeadFieldDragOverIndex(idx);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            setLeadFieldDragIndex(null);
                            setLeadFieldDragOverIndex(null);
                            endRowDrag();
                            triggerToggleAutosave();
                          }}
                        >
                          <button
                            type="button"
                            draggable
                            onDragStart={(event) => {
                              setLeadFieldDragIndex(idx);
                              setLeadFieldDragOverIndex(idx);
                              startRowDrag(event, `settings_lead_field_${idx}`, field.label, "#FF5A1F");
                            }}
                            onDragEnd={() => {
                              setLeadFieldDragIndex(null);
                              setLeadFieldDragOverIndex(null);
                              endRowDrag();
                            }}
                            className={gripClass}
                            title="Drag to reorder"
                          >
                            <GripVertical size={15} />
                          </button>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-semibold text-[var(--text-main)]">{field.label}</p>
                            <p className="truncate font-mono text-[10.5px] text-[var(--text-muted)]">{field.key}</p>
                          </div>
                          <span className="min-w-0 max-sm:col-start-2 max-sm:col-end-5 max-sm:row-start-2">
                            <GlassDropdown
                              value={field.projectFieldTarget || ""}
                              options={LEAD_PROJECT_FIELD_TARGET_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                              ariaLabel="Use for"
                              triggerClassName={`${glassFieldSmClass} justify-between`}
                              onChange={(value) => {
                                const nextTarget = String(value || "") as LeadProjectFieldTarget;
                                setZapierLeads((prev) => ({
                                  ...prev,
                                  fieldLayout: mergeLeadFieldLayout(availableLeadFields, prev.fieldLayout).map((row) => {
                                    const sameField =
                                      normalizeLeadFieldKey(row.key) === normalizeLeadFieldKey(field.key);
                                    const sameTarget =
                                      nextTarget &&
                                      row.projectFieldTarget === nextTarget &&
                                      normalizeLeadFieldKey(row.key) !== normalizeLeadFieldKey(field.key);
                                    if (sameField) return { ...row, projectFieldTarget: nextTarget };
                                    if (sameTarget) return { ...row, projectFieldTarget: "" };
                                    return row;
                                  }),
                                }));
                                triggerToggleAutosave();
                              }}
                            />
                          </span>
                          <span className="flex justify-center">
                            <GlassSwitch
                              size="sm"
                              ariaLabel="Show in main row"
                              checked={field.showInRow}
                              onChange={() =>
                                setZapierLeads((prev) => ({
                                  ...prev,
                                  fieldLayout: mergeLeadFieldLayout(availableLeadFields, prev.fieldLayout).map((row) =>
                                    normalizeLeadFieldKey(row.key) === normalizeLeadFieldKey(field.key)
                                      ? { ...row, showInRow: !row.showInRow }
                                      : row,
                                  ),
                                }))
                              }
                            />
                          </span>
                          <span className="flex justify-center">
                            <GlassSwitch
                              size="sm"
                              ariaLabel="Show in details"
                              checked={field.showInDetail}
                              onChange={() =>
                                setZapierLeads((prev) => ({
                                  ...prev,
                                  fieldLayout: mergeLeadFieldLayout(availableLeadFields, prev.fieldLayout).map((row) =>
                                    normalizeLeadFieldKey(row.key) === normalizeLeadFieldKey(field.key)
                                      ? { ...row, showInDetail: !row.showInDetail }
                                      : row,
                                  ),
                                }))
                              }
                            />
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              <div className="flex justify-end border-t px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
                <button type="button" onClick={() => setShowLeadFieldsCustomize(false)} className={primaryButtonClass} style={primaryButtonStyle}>Done</button>
              </div>
            </div>
          </div>
          </ModalPortal>
        ) : null}
        <DragGhostLayer controller={rowDragGhost} />
        {projectAutomations.layer}
        {leadAutomations.layer}
        {ask.element}
        {confirmRemove.element}
    </>
  );
}
