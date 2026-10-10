"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Building2, CheckCircle2, ChevronDown, CircleDollarSign, CircleHelp, ClipboardList, Clock3, DatabaseBackup, Download, GripVertical, HardHat, Layers3, LayoutDashboard, Link2, Loader2, Package2, Plus, RotateCcw, Search, Settings, Upload, Users, Wrench, X } from "lucide-react";
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
  normalizeCurrencyCode,
  normalizeDateFormat,
  normalizeMeasurementUnit,
  setActiveCompanyFormats,
  activeLength,
  activeDateTime,
} from "@/lib/company-formats";
import { CompanyJoinCodesModal } from "@/components/company-join-codes-modal";
import {
  cancelCompanyInvite,
  createTemporaryJoinCode,
  revokeJoinCodesForInvite,
  fetchCompanyInvites,
  fetchJoinCodes,
  revokeTemporaryJoinCode,
  type CompanyInviteRow,
  type JoinCodeRecord,
  type JoinCodesState,
} from "@/lib/company-join-codes";
import { FileText, Lightbulb } from "lucide-react";
import { Box, FileInput, FolderTree, LayoutTemplate, Lock, Percent, Receipt, Shield, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { isStaffContactCategory, withStaffContactCategory } from "@/lib/staff-contacts";
import { Archive, Award, CalendarDays, CircleDashed, Cog, Columns3, Contact, Copy, Cpu, DoorClosed, Eye, Factory, Globe2, HardHat as TradeIcon, ImageUp, Inbox, KanbanSquare, KeyRound, Palette, PanelLeft, RefreshCw, Ruler, Shapes, SlidersHorizontal, Star, Tags, Trash2 } from "lucide-react";
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
  useGlassPrompt,
} from "@/components/settings-ui";

type SettingsSection =
  | "company" | "dashboard" | "calendar" | "sales" | "production" | "nesting" | "materials"
  | "hardware" | "staff" | "integrations" | "backup";

type SubStageRow = { name: string; color: string; isDefault?: boolean };
// isComplete: the "Completed" toggle — projects in this status count as finished (stats, client portal
// closing and archiving; see lib/project-archive.ts). Project statuses only.
type StatusRow = { name: string; color: string; subStages?: SubStageRow[]; isComplete?: boolean };
type SheetSizeRow = { h: string; w: string; isDefault: boolean };
type BoardEdgingMemoryRow = { value: string; count: string };
type BoardColourMemoryRow = { value: string; count: string; edgings: BoardEdgingMemoryRow[] };
type DashboardLegendRow = { id: string; name: string; color: string };
type TagUsageRow = { value: string; count: string };
type ItemCategoryItemRow = { name: string; description: string; subcategory: string; price: string; markupPercent: string };
type ItemCategoryRow = { name: string; color: string; subcategories: string; items: ItemCategoryItemRow[] };
// Company-wide categories for Contacts-page contacts — kept here (not per-user) so staff stay
// consistent about what categories exist. Matched by name (not a synthetic id), same loose
// convention Part Types/Item Categories already use.
type ContactCategoryRow = { name: string; color: string };
type JobTypeSheetPriceRow = { sheetSize: string; pricePerSheet: string };
// "Grain" used to be its own checkbox; it's now one value of this Type dropdown, alongside the two
// lacquer-sidedness options that drive the Company Wrapped lacquer-SQM calculation and "Melteca"
// (a laminate finish that isn't lacquer at all — it simply never matches the lacquer-sidedness
// lookup, so it needs no special-case handling anywhere).
type JobTypeProductType = "" | "grain" | "lacquer-1" | "lacquer-2" | "melteca";
type JobTypeRow = { name: string; sheetPrices: JobTypeSheetPriceRow[]; showInSales: boolean; type: JobTypeProductType };
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
type PartTypeCategory = "" | "cabinetry" | "drawer" | "door" | "panel" | "extra";
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
type HardwareRow = { name: string; color: string; default: boolean; drawersJson: string; hingesJson: string; otherJson: string };
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
  "company.updates",
  "dashboard.complete.bonus",
  "calendar.view",
];

// The role pop-up lists permissions in these groups (any key not matched lands in "Other").
const PERMISSION_GROUPS: Array<{ label: string; match: (key: string) => boolean }> = [
  { label: "Company", match: (k) => k === "company.*" || k === "company.settings" || k === "company.updates" },
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
  "company.updates": "company.updates - Access Company Update Feed",
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

const sections: Array<{
  key: SettingsSection;
  label: string;
  group: string;
  description: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}> = [
  { key: "company", label: "Company", group: "General", icon: Building2, description: "Your brand and the formats used everywhere in CutSmart." },
  // Same icon as the sidebar's Dashboard item (components/app-shell.tsx topNav).
  { key: "dashboard", label: "Dashboard", group: "General", icon: LayoutDashboard, description: "Statuses, tags, contact categories, how long deleted items are kept and when finished projects are archived." },
  { key: "calendar", label: "Calendar", group: "General", icon: CalendarDays, description: "The categories events can belong to on the Calendar tab." },
  { key: "sales", label: "Sales", group: "Sales", icon: CircleDollarSign, description: "Lead form, quote & specs layouts, products, helpers and discounts." },
  { key: "production", label: "Production", group: "Workshop", icon: Wrench, description: "Cutlists, part types, gap allowances and production access." },
  { key: "nesting", label: "Machining", group: "Workshop", icon: Layers3, description: "Your machines, their settings, servicing and nesting rules." },
  { key: "materials", label: "Materials & Boards", group: "Workshop", icon: Package2, description: "Sheet thicknesses, finishes, sizes and remembered board colours." },
  { key: "hardware", label: "Hardware", group: "Workshop", icon: HardHat, description: "Hardware brands with their drawers, hinges and other parts." },
  { key: "staff", label: "Staff & Permissions", group: "Team & Data", icon: Users, description: "Who's in your company, their roles and what each role can do." },
  { key: "integrations", label: "Integrations", group: "Team & Data", icon: Link2, description: "Connect outside tools to CutSmart." },
  { key: "backup", label: "Backup & Output", group: "Team & Data", icon: DatabaseBackup, description: "Quote output templates and a snapshot of your settings." },
];
// What the sidebar search can find: every card (plus key individual settings) and the tab it's on.
const SETTINGS_SEARCH_INDEX: Array<{ section: SettingsSection; label: string; card: string; keywords?: string }> = [
  { section: "company", card: "Brand", label: "Company name" },
  { section: "company", card: "Brand", label: "Company logo" },
  { section: "company", card: "Brand", label: "Theme colour", keywords: "color brand" },
  { section: "company", card: "Regional formats", label: "Currency", keywords: "money price dollar" },
  { section: "company", card: "Regional formats", label: "Measurement unit", keywords: "mm inches millimetres" },
  { section: "company", card: "Regional formats", label: "Date format" },
  { section: "dashboard", card: "Project statuses", label: "Project statuses", keywords: "sub-stages board columns" },
  { section: "dashboard", card: "Lead statuses", label: "Lead statuses" },
  { section: "dashboard", card: "Contact categories", label: "Contact categories" },
  { section: "dashboard", card: "Completed project legend", label: "Completed project legend" },
  { section: "dashboard", card: "Tags", label: "Tags" },
  { section: "dashboard", card: "Finished projects", label: "Archive completed projects", keywords: "archived client portal link completed instantly recently deleted trash" },
  { section: "calendar", card: "Calendar categories", label: "Calendar categories", keywords: "events sub-calendars colours teamup" },
  { section: "calendar", card: "Workdays", label: "Workdays", keywords: "business days weekends" },
  { section: "calendar", card: "Workdays", label: "Show non-workdays", keywords: "hide weekends month week view" },
  { section: "sales", card: "Lead form", label: "Lead form URL" },
  { section: "sales", card: "Layout builders", label: "Specs & quote layouts", keywords: "template builder" },
  { section: "sales", card: "Client confirmation", label: "Reopen for editing" },
  { section: "sales", card: "Layout builders", label: "Item categories", keywords: "items picker" },
  { section: "sales", card: "Products", label: "Products", keywords: "job types sheet prices" },
  { section: "sales", card: "Quote helpers", label: "Quote helpers", keywords: "snippets" },
  { section: "sales", card: "Quote discount", label: "Quote discount", keywords: "tiers" },
  { section: "production", card: "Cutlist columns", label: "Cutlist columns" },
  { section: "production", card: "Production access", label: "Production access", keywords: "unlock code" },
  { section: "production", card: "Contractors", label: "Contractors", keywords: "trades" },
  { section: "production", card: "Gap allowances", label: "Gap allowances" },
  { section: "production", card: "Part types", label: "Part types", keywords: "autoclash" },
  { section: "nesting", card: "Machines", label: "Machines", keywords: "cnc table saw edge bander kerf" },
  { section: "materials", card: "Sheet thicknesses", label: "Sheet thicknesses" },
  { section: "materials", card: "Board finishes", label: "Board finishes" },
  { section: "materials", card: "Sheet sizes", label: "Sheet sizes" },
  { section: "materials", card: "Board colour memory", label: "Board colour memory", keywords: "edging" },
  { section: "hardware", card: "Hardware brands", label: "Hardware brands", keywords: "drawers hinges" },
  { section: "staff", card: "Staff", label: "Staff", keywords: "invite members" },
  { section: "staff", card: "Roles", label: "Roles & permissions" },
  { section: "integrations", card: "Zapier Forms", label: "Zapier", keywords: "webhook leads" },
  { section: "backup", card: "Quote output template", label: "Quote output template", keywords: "header footer page size margin" },
  { section: "backup", card: "Backup snapshot", label: "Backup snapshot", keywords: "export json" },
];
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const ACTIVE_COMPANY_THEME_COLOR_STORAGE_KEY = "cutsmart_active_company_theme_color";

function toStr(v: unknown, fallback = "") {
  const t = String(v ?? "").trim();
  return t || fallback;
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
// Same purpose as fieldInputClass but chromeless — no border/background of its own — for a
// spreadsheet-style grid where the row/column lines already do the separating and a bordered
// textbox per cell would just be visual noise. Only becomes visible on focus, so it's still
// discoverable as editable.
const gridCellInputClass = rowFieldClass;
const secondaryButtonClass = smallButtonClass;
// Row delete buttons: a quiet X that only turns red on hover (was a always-red tile).
const dangerIconButtonClass = iconRemoveButtonClass;

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
  const out = raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      const name = toStr(row.name);
      const isComplete = !completedTaken && Boolean(name) && isCompletedStatus(name);
      if (isComplete) completedTaken = true;
      return { name, color: toStr(row.color, "#64748B"), subStages: normalizeSubStages(row.subStages), isComplete };
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

function normalizeDashboardLegend(raw: unknown): DashboardLegendRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => {
      const row = item as Record<string, unknown>;
      const name = toStr(row.name);
      return {
        id: toStr(row.id, name.toLowerCase().replace(/\s+/g, "_") || `legend_${idx + 1}`),
        name,
        color: toStr(row.color, "#2A7A3B"),
      };
    })
    .filter((r) => r.name);
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
      const subs = Array.isArray(row.subcategories)
        ? (row.subcategories as Array<Record<string, unknown>>).map((s) => toStr(s?.name ?? s)).filter(Boolean)
        : [];
      const items = Array.isArray(row.items)
        ? (row.items as Array<Record<string, unknown>>).map((it) => ({
            name: toStr(it?.name),
            description: toStr(it?.description),
            subcategory: toStr(it?.subcategory),
            price: toStr(it?.price),
            markupPercent: toStr(it?.markupPercent),
          }))
        : [];
      return {
        name: toStr(row.name),
        color: toStr(row.color, "#7D99B3"),
        subcategories: subs.join(", "),
        items,
      };
    })
    .filter((r) => r.name);
}

function normalizeJobTypes(raw: unknown): JobTypeRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      const sheetPrices = Array.isArray(row.sheetPrices)
        ? (row.sheetPrices as Array<Record<string, unknown>>).map((sp) => ({
            sheetSize: toStr(sp?.sheetSize),
            pricePerSheet: toStr(sp?.pricePerSheet),
          }))
        : [];
      const fallbackSheetSize = toStr(row.sheetSize);
      const fallbackPrice = toStr(row.pricePerSheet);
      return {
        name: toStr(row.name),
        sheetPrices:
          sheetPrices.length > 0
            ? sheetPrices
            : fallbackSheetSize || fallbackPrice
              ? [{ sheetSize: fallbackSheetSize, pricePerSheet: fallbackPrice }]
              : [],
        showInSales: Boolean(row.showInSales ?? true),
        // Legacy docs only ever had `grain: boolean` — a previously-ticked row keeps reading as
        // "grain" once opened under the new Type dropdown instead of silently reverting to blank.
        type: (["grain", "lacquer-1", "lacquer-2", "melteca"].includes(toStr(row.type))
          ? toStr(row.type)
          : Boolean(row.grain ?? row.isGrain ?? false)
            ? "grain"
            : "") as JobTypeProductType,
      };
    })
    .filter((r) => r.name);
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
        categoryRaw === "cabinetry" || categoryRaw === "drawer" || categoryRaw === "door" || categoryRaw === "panel" || categoryRaw === "extra"
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
  return items.map((item) =>
    item && typeof item === "object" && typeof (item as Record<string, unknown>).name === "string"
      ? { ...(item as Record<string, unknown>), name: String((item as Record<string, unknown>).name).trim() }
      : item,
  );
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
  if (field === "hardwareLengths") {
    const rows = Array.isArray(value)
      ? (value as unknown[]).map((v) => toStr(v)).filter(Boolean)
      : String(value ?? "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
    next.hardwareLengths = rows;
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
  const [active, setActive] = useState<SettingsSection>("company");
  useEffect(() => {
    const requestedSection = searchParams.get("section");
    if (requestedSection && sections.some((item) => item.key === requestedSection)) {
      setActive(requestedSection as SettingsSection);
    }
    // Only honor the query param on first load — the sidebar's own onClick is the source of
    // truth for `active` after that, so this must not fight later in-page navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const [leadStatuses, setLeadStatuses] = useState<StatusRow[]>([]);
  const [dashboardLegend, setDashboardLegend] = useState<DashboardLegendRow[]>([]);
  const [legendDragIndex, setLegendDragIndex] = useState<number | null>(null);
  const [legendDragOverIndex, setLegendDragOverIndex] = useState<number | null>(null);
  const [statusDragIndex, setStatusDragIndex] = useState<number | null>(null);
  const [statusDragOverIndex, setStatusDragOverIndex] = useState<number | null>(null);
  const [leadStatusDragIndex, setLeadStatusDragIndex] = useState<number | null>(null);
  const [leadStatusDragOverIndex, setLeadStatusDragOverIndex] = useState<number | null>(null);
  const [projectTagUsage, setProjectTagUsage] = useState<TagUsageRow[]>([]);
  // Dashboard > Tags: the tag waiting on "Delete tag?" (its row, name and how many projects use it).
  const [pendingTagDelete, setPendingTagDelete] = useState<{ index: number; value: string; count: number } | null>(null);
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
  const [contractors, setContractors] = useState<string[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
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
  const [isItemCategoriesModalOpen, setIsItemCategoriesModalOpen] = useState(false);
  const [itemCategoriesModalOrigin, setItemCategoriesModalOrigin] = useState<GlassModalOrigin>(null);
  const itemCategoriesModalPanelRef = useRef<HTMLDivElement | null>(null);
  const itemCategoriesModalOriginElRef = useRef<HTMLElement | null>(null);
  const [jobTypes, setJobTypes] = useState<JobTypeRow[]>([]);
  // Sales Product names offered in the Quote/Specs group editor's Rules "IF <Product>" dropdown —
  // same "Incl in Sales" filter as the Product panel below and as a project's own "Product"
  // checklist (see companySalesProductConfigs in app/(app)/projects/[projectId]/page.tsx), so a
  // rule can only ever reference a product that actually appears there.
  const specsGroupProductOptions = useMemo(
    () => jobTypes.filter((row) => row.showInSales).map((row) => row.name.trim()).filter(Boolean),
    [jobTypes],
  );
  const [jobTypeExpanded, setJobTypeExpanded] = useState<Record<number, boolean>>({});
  const [jobTypeDragIndex, setJobTypeDragIndex] = useState<number | null>(null);
  const [jobTypeDragOverIndex, setJobTypeDragOverIndex] = useState<number | null>(null);
  const [quoteHelpers, setQuoteHelpers] = useState<QuoteHelperRow[]>([]);
  const [quoteHelperDragIndex, setQuoteHelperDragIndex] = useState<number | null>(null);
  const [quoteHelperDragOverIndex, setQuoteHelperDragOverIndex] = useState<number | null>(null);
  const [discountTiers, setDiscountTiers] = useState<DiscountTierRow[]>([]);
  const [discountTierDragIndex, setDiscountTierDragIndex] = useState<number | null>(null);
  const [discountTierDragOverIndex, setDiscountTierDragOverIndex] = useState<number | null>(null);
  const [minusOffQuoteTotal, setMinusOffQuoteTotal] = useState(false);
  // Defaults true (allowed) — this only ever RESTRICTS an existing capability (the "Reopen for
  // editing" safety-valve buttons on a sent/submitted Quote or Specifications sheet), so an
  // existing company that's never touched this setting should keep working exactly as before.
  const [salesAllowReopenForEditing, setSalesAllowReopenForEditing] = useState(true);
  const [salesLeadFormUrl, setSalesLeadFormUrl] = useState("");
  const quoteHelperRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [hardware, setHardware] = useState<HardwareRow[]>([]);
  const [hardwareExpanded, setHardwareExpanded] = useState<Record<number, boolean>>({});
  const [hardwareActiveTab, setHardwareActiveTab] = useState<Record<number, "drawers" | "hinges" | "other">>({});
  const [hardwareDragIndex, setHardwareDragIndex] = useState<number | null>(null);
  const [hardwareDragOverIndex, setHardwareDragOverIndex] = useState<number | null>(null);
  const [drawerRowExpanded, setDrawerRowExpanded] = useState<Record<string, boolean>>({});
  const [drawerHeightsExpanded, setDrawerHeightsExpanded] = useState<Record<string, boolean>>({});
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
        setDashboardLegend(normalizeDashboardLegend(doc.dashboardCompleteLegend));
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
        setContractors(normalizeStringList(doc.contractors, []));
        setRoles(normalizeRoles(doc.roles));
        setItemCategories(normalizeItemCategories(doc.itemCategories));
        setSpecsTemplateGrid(normalizeSpecsGrid(doc.specsTemplateGrid));
        setQuoteGridTemplate(normalizeSpecsGrid(doc.quoteGridTemplate));
        setJobTypes(normalizeJobTypes(doc.salesJobTypes));
        setQuoteHelpers(normalizeQuoteHelpers(doc.salesQuoteHelpers));
        setDiscountTiers(normalizeDiscountTiers(doc.salesQuoteDiscountTiers));
        setMinusOffQuoteTotal(Boolean(doc.salesMinusOffQuoteTotal));
        setSalesAllowReopenForEditing(doc.salesAllowReopenForEditing !== false);
        setSalesLeadFormUrl(toStr(doc.salesLeadFormUrl));
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
    setDrawerHeightsExpanded({});
  }, [active]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (activeRoleModalIndex === null) return;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
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
    document.body.style.overflow = "hidden";
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
    document.body.style.overflow = "hidden";
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
    if (record?.kind === "temporary") return { code: record.code, kind: "Temporary code" };
    if (record?.kind === "master") return { code: record.code, kind: "Old master code" };
    return { code: key.toUpperCase(), kind: "Code" };
  };

  const cancelInvite = async (invite: CompanyInviteRow) => {
    if (confirmCancelInviteId !== invite.id) {
      setConfirmCancelInviteId(invite.id);
      return;
    }
    setCancellingInviteId(invite.id);
    const ok = activeCompanyId ? await cancelCompanyInvite(activeCompanyId, invite.id) : false;
    setCancellingInviteId("");
    setConfirmCancelInviteId("");
    if (!ok) {
      setSaveLabel("Couldn't cancel the invite");
      return;
    }
    setPendingInvites((prev) => prev.filter((row) => row.id !== invite.id));
    setSaveLabel(`Invite cancelled: ${invite.email}`);
    // Its join code stops working too.
    if (activeCompanyId) void revokeJoinCodesForInvite(activeCompanyId, invite.id).then(() => setJoinCodesReloadTick((tick) => tick + 1));
  };

  // Revoking a temporary code someone has already joined with: remove them first (Staff's Remove
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

  const inviteStaffFromTopBar = async () => {
    if (!activeCompanyId || !canAddStaff || !canEditCompanySettings || isInvitingStaff) {
      return;
    }
    const email = await ask.prompt({ title: "Add staff", label: "Email address", placeholder: "name@company.co.nz", confirmLabel: "Send invite", inputMode: "email" });
    const cleanEmail = String(email || "").trim();
    if (!cleanEmail) return;
    if (!cleanEmail.includes("@")) {
      setSaveLabel("Invite failed (invalid email)");
      return;
    }

    setIsInvitingStaff(true);
    const result = await createCompanyInviteDetailed(activeCompanyId, cleanEmail, {
      companyName: toStr(form.name || company?.name || company?.companyName || activeCompanyId),
      invitedByUid: String(user?.uid || ""),
      invitedByName: String(user?.displayName || user?.email || ""),
    });
    if (result.ok) {
      // A one-person join code for them too, linked to the invite (Join key > Temporary codes): accepting
      // the invite uses it up, so they show as having joined with it, and revoking it removes them.
      const code = result.inviteId
        ? await createTemporaryJoinCode(activeCompanyId, cleanEmail, { inviteId: result.inviteId, invitedEmail: cleanEmail })
        : null;
      setSaveLabel(code?.ok && code.code ? `Invite sent: ${cleanEmail} · join code ${code.code}` : `Invite sent: ${cleanEmail}`);
      setInvitesReloadTick((tick) => tick + 1);
      setJoinCodesReloadTick((tick) => tick + 1);
    } else {
      setSaveLabel(`Invite failed (${result.error || "unknown"})`);
    }
    setIsInvitingStaff(false);
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
    setRemovingStaffUid(pendingStaffRemoval.uid);
    const result = await removeCompanyMemberDetailed(activeCompanyId, pendingStaffRemoval.uid, {
      transferToUid: toStr(transferTarget?.uid),
      transferToName: toStr(transferTarget?.displayName || transferTarget?.email || transferTarget?.uid),
      // Every kind is sent, on or off, so the server never falls back to its older "projects only" default.
      transfer: transferTarget
        ? pendingStaffRemoval.transfer
        : (Object.fromEntries(STAFF_REMOVAL_DATA_ROWS.map(({ kind }) => [kind, false])) as Record<MemberRemovalDataKind, boolean>),
    });
    setRemovingStaffUid("");
    if (!result.ok) {
      setStaffRemovalError(`Staff removal failed (${result.error || "unknown"})`);
      return;
    }
    setStaff((prev) => prev.filter((member) => toStr(member.uid) !== pendingStaffRemoval.uid));
    setOpenStaffRoleUid((current) => (current === pendingStaffRemoval.uid ? "" : current));
    setPendingStaffRemoval(null);
    const revokeCode = pendingStaffRemoval.revokeCode;
    if (revokeCode) {
      void revokeTemporaryJoinCode(activeCompanyId, revokeCode.key).then(() => setJoinCodesReloadTick((tick) => tick + 1));
    }
    const transferredTotal = Object.values(result.transferred ?? {}).reduce((sum, n) => sum + n, 0);
    const skippedContacts = result.skippedContacts ?? 0;
    const skippedNote = skippedContacts
      ? ` (${skippedContacts} contact${skippedContacts === 1 ? "" : "s"} skipped — already in their contacts)`
      : "";
    setSaveLabel(
      transferredTotal > 0
        ? `Removed ${pendingStaffRemoval.displayName} and transferred ${transferredTotal} item${transferredTotal === 1 ? "" : "s"}${skippedNote}`
        : `Removed ${pendingStaffRemoval.displayName}${skippedNote}`,
    );
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
    setItemCategories((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const current = parseSubcategoryNames(row.subcategories);
        const next = current.filter((v) => v.toLowerCase() !== String(name || "").toLowerCase());
        return { ...row, subcategories: next.join(", ") };
      }),
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
    setStatuses((prev) =>
      prev.map((row, i) => {
        if (i !== statusIndex) return row;
        return { ...row, subStages: (row.subStages ?? []).filter((_, j) => j !== subIndex) };
      }),
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

  const parseNumberLoose = (value: string) => {
    const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  };

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

  const removeItemCategoryItem = (catIndex: number, itemIndex: number) => {
    setItemCategories((prev) =>
      prev.map((row, i) => {
        if (i !== catIndex) return row;
        const nextItems = (row.items ?? []).filter((_, j) => j !== itemIndex);
        return { ...row, items: nextItems };
      }),
    );
  };


  const toggleJobTypeExpanded = (index: number) => {
    setJobTypeExpanded((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const addJobTypeSheetPrice = (index: number) => {
    const defaultSize = sheetSizes.find((s) => s.isDefault) ?? sheetSizes[0];
    const defaultValue = defaultSize ? `${defaultSize.h} x ${defaultSize.w}` : "";
    setJobTypes((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        return { ...row, sheetPrices: [...(row.sheetPrices ?? []), { sheetSize: defaultValue, pricePerSheet: formatMoney(0, companyCurrency) }] };
      }),
    );
    setJobTypeExpanded((prev) => ({ ...prev, [index]: true }));
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

  const removeJobTypeSheetPrice = (jobTypeIndex: number, sheetPriceIndex: number) => {
    setJobTypes((prev) =>
      prev.map((row, i) => {
        if (i !== jobTypeIndex) return row;
        const nextRows = (row.sheetPrices ?? []).filter((_, j) => j !== sheetPriceIndex);
        return { ...row, sheetPrices: nextRows };
      }),
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
  const shouldRenderItemCategoriesModal = useGlassModalPopOrigin(
    isItemCategoriesModalOpen,
    itemCategoriesModalOrigin,
    itemCategoriesModalPanelRef,
    undefined,
    itemCategoriesModalOriginElRef,
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

  const downloadBackupSnapshot = () => {
    const snapshot = {
      companyId: activeCompanyId,
      exportedAtIso: new Date().toISOString(),
      settings: {
        form,
        statuses,
        dashboardLegend,
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
        salesAllowReopenForEditing,
        salesLeadFormUrl,
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

  const toggleHardwareExpanded = (index: number) => {
    setHardwareExpanded((prev) => ({ ...prev, [index]: !(prev[index] ?? false) }));
  };

  const toggleDrawerRowExpanded = (hardwareIndex: number, drawerIndex: number) => {
    const key = `${hardwareIndex}:${drawerIndex}`;
    setDrawerRowExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
  };

  const toggleDrawerHeightsExpanded = (hardwareIndex: number, drawerIndex: number) => {
    const key = `${hardwareIndex}:${drawerIndex}:heights`;
    setDrawerHeightsExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
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
  // delete could revert counts changed elsewhere since this page opened.
  const onDeleteBoardColourMemoryRow = async (value: string) => {
    if (!activeCompanyId || !canEditCompanySettings) return;
    const targetValue = toStr(value);
    if (!targetValue) return;
    setBoardColourMemory((prev) => prev.filter((row) => row.value !== targetValue));
    try {
      const fresh = await fetchCompanyDoc(activeCompanyId);
      const freshRows = normalizeBoardColourMemory(fresh?.boardMaterialUsage).filter((row) => row.value !== targetValue);
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
        setSaveLabel(`Save failed (${result.error || "board-colour-remove-failed"})`);
      }
    } catch {
      setSaveLabel("Save failed (board-colour-remove-failed)");
    }
  };

  // Same fetch-fresh-then-patch reasoning as onDeleteBoardColourMemoryRow above — an edging's
  // count is also live, bumped from the project page whenever a board row's edging changes.
  const onDeleteBoardEdgingMemoryRow = async (colourValue: string, edgingValue: string) => {
    if (!activeCompanyId || !canEditCompanySettings) return;
    const targetColour = toStr(colourValue);
    const targetEdging = toStr(edgingValue);
    if (!targetColour || !targetEdging) return;
    setBoardColourMemory((prev) =>
      prev.map((row) =>
        row.value === targetColour
          ? { ...row, edgings: row.edgings.filter((edging) => edging.value !== targetEdging) }
          : row,
      ),
    );
    try {
      const fresh = await fetchCompanyDoc(activeCompanyId);
      const freshRows = normalizeBoardColourMemory(fresh?.boardMaterialUsage);
      const result = await saveCompanyDocPatchDetailed(activeCompanyId, {
        boardMaterialUsage: {
          colours: freshRows.map((row) => ({
            value: row.value,
            count: Number(row.count || 0),
            edgings: (row.value === targetColour ? row.edgings.filter((edging) => edging.value !== targetEdging) : row.edgings)
              .map((edging) => ({ value: edging.value, count: Number(edging.count || 0) })),
          })),
        },
      });
      if (!result.ok) {
        setSaveLabel(`Save failed (${result.error || "board-edging-remove-failed"})`);
      }
    } catch {
      setSaveLabel("Save failed (board-edging-remove-failed)");
    }
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
        subStages: (row.subStages ?? [])
          .map((sub) => ({ name: toStr(sub.name), color: toStr(sub.color, "#64748B"), isDefault: Boolean(sub.isDefault) }))
          .filter((sub) => sub.name),
      })),
      leadStatuses: leadStatuses.map((row, idx) => ({
        id: toStr(row.name, `lead_status_${idx + 1}`).toLowerCase().replace(/\s+/g, "_"),
        name: toStr(row.name),
        color: toStr(row.color, "#64748B"),
      })),
      dashboardCompleteLegend: dashboardLegend
        .map((row, idx) => {
          const name = toStr(row.name);
          if (!name) return null;
          return {
            id: toStr(row.id, name.toLowerCase().replace(/\s+/g, "_") || `legend_${idx + 1}`),
            name,
            color: toStr(row.color, "#2A7A3B"),
          };
        })
        .filter(Boolean),
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
      sheetSizes: sheetSizes
        .map((r) => ({ h: Number(r.h), w: Number(r.w), isDefault: r.isDefault }))
        .filter((r) => Number.isFinite(r.h) && Number.isFinite(r.w) && r.h > 0 && r.w > 0),
      partTypes: partTypes
        .map((row) => {
          const name = toStr(row.name);
          if (!name) return null;
          const category: PartTypeCategory =
            row.category === "cabinetry" || row.category === "drawer" || row.category === "door" || row.category === "panel" || row.category === "extra"
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
            .map((nameVal) => ({ name: nameVal, color: toStr(row.color, "#7D99B3") }));
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
            }))
            .filter((sp) => sp.sheetSize || sp.pricePerSheet);
          return {
            name,
            pricePerSheet: toStr(sheetPrices[0]?.pricePerSheet),
            sheetSize: toStr(sheetPrices[0]?.sheetSize),
            sheetPrices,
            showInSales: Boolean(row.showInSales),
            type: row.type,
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
      salesAllowReopenForEditing: Boolean(salesAllowReopenForEditing),
      salesLeadFormUrl: toStr(salesLeadFormUrl),
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
        dashboardCompleteLegend: dashboardLegend,
        projectTagUsage: { tags: projectTagUsage },
        boardThicknesses,
        boardFinishes,
        contractors,
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
          salesAllowReopenForEditing,
          salesLeadFormUrl,
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
    e.dataTransfer.effectAllowed = "move";
    const img = rowDragGhost.transparentImageRef.current;
    if (img) e.dataTransfer.setDragImage(img, 0, 0);
    rowDragGhost.spawn(e, originId, { label: label.trim() || "Untitled", color: color || "var(--brand)" });
  };
  const endRowDrag = () => rowDragGhost.end();
  const ask = useGlassPrompt();

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
  const resetSpecsTemplate = () => {
    if (!canEditCompanySettings) return;
    if (specsTemplateSaveTimeoutRef.current) clearTimeout(specsTemplateSaveTimeoutRef.current);
    setSpecsTemplateGrid(null);
    setSpecsTemplateEditorKey((prev) => prev + 1);
    setIsSpecsTemplateResetConfirmOpen(false);
    if (activeCompanyId) {
      void saveCompanyDocPatchDetailed(activeCompanyId, { specsTemplateGrid: null }).then((result) => {
        if (!result.ok) {
          console.error("Specs template reset failed:", result.error);
          setSpecsTemplateSaveError(result.error || "unknown-save-error");
        } else {
          setSpecsTemplateSaveError("");
        }
      });
    }
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
  const resetQuoteTemplate = () => {
    if (!canEditCompanySettings) return;
    if (quoteTemplateSaveTimeoutRef.current) clearTimeout(quoteTemplateSaveTimeoutRef.current);
    setQuoteGridTemplate(null);
    setQuoteTemplateEditorKey((prev) => prev + 1);
    setIsQuoteTemplateResetConfirmOpen(false);
    if (activeCompanyId) {
      void saveCompanyDocPatchDetailed(activeCompanyId, { quoteGridTemplate: null }).then((result) => {
        if (!result.ok) {
          console.error("Quote template reset failed:", result.error);
          setQuoteTemplateSaveError(result.error || "unknown-save-error");
        } else {
          setQuoteTemplateSaveError("");
        }
      });
    }
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
    dashboardLegend,
    calendarCategories,
    calendarWorkdays,
    calendarRetention,
    projectArchiveAfter,
    calendarShowToClientDefault,
    calendarShowNonWorkdays,
    projectTagUsage,
    boardThicknesses,
    boardFinishes,
    contractors,
    sheetSizes,
    partTypes,
    roles,
    itemCategories,
    jobTypes,
      quoteHelpers,
      discountTiers,
      minusOffQuoteTotal,
      salesAllowReopenForEditing,
      salesLeadFormUrl,
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

  return (
    <>
        {access.status === "loading" ? (
          <div
            className="rounded-[16px] border p-6 text-[13px] font-semibold"
            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
          >
            Checking access...
          </div>
        ) : access.status === "error" ? (
          <div
            className="rounded-[16px] border p-6 text-[13px] font-semibold"
            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
          >
            <p>Couldn&apos;t check your access to Company Settings — the connection may be slow or offline.</p>
            <button
              type="button"
              onClick={() => access.retry()}
              className="mt-3 inline-flex h-9 items-center rounded-[8px] border px-3 text-[12px] font-bold hover:brightness-95"
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
                      <p className="px-2.5 py-2 text-[12px]" style={{ color: "var(--text-muted)" }}>No settings match &ldquo;{search.trim()}&rdquo;</p>
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
                    <div className="flex items-center gap-2">
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
                      <span className="rounded-full px-2.5 py-0.5 text-[11.5px] font-bold" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}>
                        {toStr(company?.planName, "Free")}
                      </span>
                    </FieldRow>
                    <FieldRow label="Join key" hint="The master code people join with, and one-person temporary codes you can revoke.">
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
                                onClick={() => setForm((prev) => ({ ...prev, logoPath: "" }))}
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
                            onClick={() => setBoardThicknesses((prev) => prev.filter((_, i) => i !== idx))}
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
                            onClick={() => setBoardFinishes((prev) => prev.filter((_, i) => i !== idx))}
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
                          <button type="button" onClick={() => setSheetSizes((prev) => prev.filter((_, i) => i !== idx))} className={dangerIconButtonClass} title="Remove">
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
                        <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>Nothing recorded yet — colours appear here as they&apos;re used in cutlists.</p>
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
                                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold transition"
                                    style={
                                      m.isDefaultForType
                                        ? { backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }
                                        : { color: "var(--text-muted)" }
                                    }
                                  >
                                    <Star size={11} fill={m.isDefaultForType ? "currentColor" : "none"} /> {m.isDefaultForType ? "Default" : "Set default"}
                                  </button>
                                ) : null}
                                <button type="button" onClick={() => setMachines((prev) => prev.filter((row) => row.id !== m.id))} className={dangerIconButtonClass} title="Remove machine">
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
                    <div className="fixed inset-0 z-[1700] flex items-center justify-center px-4 py-4">
                      <button type="button" aria-label="Cancel" onClick={() => setNewMachineTypePickerOpen(false)} className="glass-modal-backdrop absolute inset-0" />
                      <div ref={addMachinePanelRef} className="glass-modal-panel relative z-[1701] w-full max-w-[520px] overflow-hidden">
                        <div className="glass-modal-header flex items-center justify-between px-4 py-3">
                          <p className="text-[13px] font-extrabold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>Add machine</p>
                          <button type="button" onClick={() => setNewMachineTypePickerOpen(false)} className={dangerIconButtonClass} aria-label="Close">
                            <X size={16} />
                          </button>
                        </div>
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
                  ) : null}
                  {shouldRenderMachineModal ? (
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
                        <div className="glass-modal-header flex items-center justify-between px-4 py-3">
                          <p className="text-[13px] font-extrabold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>
                            {activeMachine ? machineTypeLabel(activeMachine) : "Machine"} Settings
                          </p>
                          <button type="button" onClick={() => setActiveMachineModalId(null)} className={dangerIconButtonClass} aria-label="Close">
                            <X size={16} />
                          </button>
                        </div>
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
                                    <input
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
                                    <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>No service entries yet.</p>
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
                                          updateActiveMachine((m) => ({ serviceHistory: m.serviceHistory.filter((_, i) => i !== idx) }))
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
                                        <input
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
                                        <input
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
                                            updateActiveMachine((m) => ({
                                              edgebandingSettings: { ...m.edgebandingSettings, rules: m.edgebandingSettings.rules.filter((_, i) => i !== idx) },
                                            }))
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
                                    <input
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
                              onClick={() => setContractors((prev) => prev.filter((_, i) => i !== idx))}
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
                      <div className="min-w-[860px] space-y-1.5">
                        <div className="grid grid-cols-[36px_minmax(140px,1fr)_150px_210px_96px_86px_80px_32px] items-center gap-2 px-2">
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
                          <div key={`part_type_${idx}`} className={`${listRowClass} grid grid-cols-[36px_minmax(140px,1fr)_150px_210px_96px_86px_80px_32px]`}>
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
                              ]}
                              onChange={(next) =>
                                setPartTypes((prev) =>
                                  prev.map((v, i) =>
                                    i === idx
                                      ? { ...v, category: next === "cabinetry" || next === "drawer" || next === "door" || next === "panel" || next === "extra" ? next : "" }
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
                            <button type="button" onClick={() => setPartTypes((prev) => prev.filter((_, i) => i !== idx))} className={dangerIconButtonClass} title="Remove">
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
                <div className="grid gap-[18px] max-lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px]">
                  <Panel
                    title="Staff"
                    icon={Users}
                    description="Everyone in your company. Change someone's role from their role pill."
                    allowOverflow
                    headerRight={
                      canAddStaff ? (
                        <button
                          type="button"
                          onClick={() => void inviteStaffFromTopBar()}
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
                              // The join code made for this invite (Join key > Temporary codes).
                              const code = joinCodes?.codes.find((row) => row.inviteId === invite.id && row.status === "active");
                              return code ? (
                                <span className="font-mono text-[12px] font-semibold tracking-[1px]" style={{ color: "var(--text-main)" }} title="Their join code">
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
                  {shouldRenderRoleModal ? (
                    <div className="fixed inset-0 z-[1600] flex items-center justify-center px-4 py-4">
                      <button type="button" aria-label="Close role permissions" onClick={() => setActiveRoleModalIndex(null)} className="glass-modal-backdrop absolute inset-0" />
                      <div ref={roleModalPanelRef} className="glass-modal-panel relative z-[1601] flex max-h-[calc(100svh-32px)] w-full max-w-[820px] flex-col overflow-hidden">
                        <div className="glass-modal-header flex items-center justify-between px-4 py-3">
                          <p className="text-[13px] font-extrabold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>Role permissions</p>
                          <button type="button" onClick={() => setActiveRoleModalIndex(null)} className={dangerIconButtonClass} aria-label="Close">
                            <X size={16} />
                          </button>
                        </div>
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
                              if (activeRoleModalIndex === null || activeRoleIsProtected) return;
                              setRoles((prev) => prev.filter((_, idx) => idx !== activeRoleModalIndex));
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
                          <button type="button" onClick={() => setActiveRoleModalIndex(null)} className={primaryButtonClass} style={primaryButtonStyle}>
                            Done
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {shouldRenderOwnerTransferModal ? (
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
                        <div className="glass-modal-header flex items-center justify-between px-4 py-3">
                          <p className="text-[13px] font-extrabold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>
                            Transfer Owner Role
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingOwnerTransfer(null);
                              setPendingOwnerTransferTargetUid("");
                            }}
                            className={dangerIconButtonClass}
                            aria-label="Close"
                          >
                            <X size={16} />
                          </button>
                        </div>
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
                  ) : null}
                  {shouldRenderStaffRemovalModal ? (
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
                        <div className="glass-modal-header flex items-center justify-between px-4 py-3">
                          <p className="text-[13px] font-extrabold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>
                            Remove Staff Member
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              if (removingStaffUid) return;
                              setPendingStaffRemoval(null);
                              setStaffRemovalError("");
                            }}
                            className={dangerIconButtonClass}
                            aria-label="Close"
                          >
                            <X size={16} />
                          </button>
                        </div>
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
                                    Their temporary code{" "}
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
                  ) : null}
                </div>
              )}

              {active === "dashboard" && (
                <div className="grid gap-[18px] max-lg:grid-cols-1 xl:grid-cols-2">
                  <Panel
                    title="Project statuses"
                    icon={KanbanSquare}
                    description="The columns on your Dashboard board, in order. Drag to reorder; expand a status to add sub-stages. Tick Completed on the status that means a job is finished."
                  >
                    <div className="space-y-1.5">
                      {statuses.map((row, idx) => (
                        <div key={`project_status_${idx}`}>
                          <div
                            id={`settings_status_${idx}`}
                            className={listRowClass}
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
                              className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium transition max-sm:w-7 max-sm:justify-center max-sm:px-0 ${
                                hasCompletedStatus && !row.isComplete ? "invisible" : ""
                              }`}
                              style={
                                row.isComplete
                                  ? { borderColor: "var(--success-border)", backgroundColor: "var(--success-soft)", color: "var(--success-strong)" }
                                  : { borderColor: "var(--glass-border)", backgroundColor: "transparent", color: "var(--text-muted)" }
                              }
                            >
                              <CheckCircle2 size={13} />
                              <span className="max-sm:hidden">Completed</span>
                            </button>
                            {(row.subStages ?? []).length > 0 ? (
                              <span className={countPillClass} title="Sub-stages">
                                {(row.subStages ?? []).length}
                                <span className="max-sm:hidden">&nbsp;sub-stages</span>
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
                            <button type="button" onClick={() => setStatuses((prev) => prev.filter((_, i) => i !== idx))} className={dangerIconButtonClass} title="Remove">
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
                  <Panel title="Lead statuses" icon={Inbox} description="The columns on your Leads board.">
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
                          <ColorCircle value={row.color || "#64748B"} onChange={(hex) => setLeadStatuses((prev) => prev.map((v, i) => (i === idx ? { ...v, color: hex } : v)))} />
                          <input
                            value={row.name}
                            placeholder="Status name"
                            onChange={(e) => setLeadStatuses((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))}
                            className={gridCellInputClass}
                          />
                          <button type="button" onClick={() => setLeadStatuses((prev) => prev.filter((_, i) => i !== idx))} className={dangerIconButtonClass} title="Remove">
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                      <button type="button" onClick={() => setLeadStatuses((prev) => [...prev, { name: "", color: "#64748B" }])} className={`${secondaryButtonClass} mt-1.5`}>
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
                            <button type="button" onClick={() => setContactCategories((prev) => prev.filter((_, i) => i !== idx))} className={dangerIconButtonClass} title="Remove">
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
                  <Panel title="Completed project legend" icon={Award} description="Categories for the completed-projects breakdown on the Dashboard.">
                    <div className="space-y-1.5">
                      {dashboardLegend.map((row, idx) => (
                        <div
                          key={`${row.id}_${idx}`}
                          id={`settings_legend_${idx}`}
                          className={listRowClass}
                          style={{ opacity: legendDragIndex === idx ? 0.45 : 1 }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDragEnter={(e) => {
                            e.preventDefault();
                            if (legendDragIndex == null || legendDragIndex === idx) return;
                            setDashboardLegend((prev) => moveRowTo(prev, legendDragIndex, idx));
                            setLegendDragIndex(idx);
                            setLegendDragOverIndex(idx);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setLegendDragIndex(null);
                            setLegendDragOverIndex(null);
                            endRowDrag();
                            triggerAutosaveAfterRowDrop();
                          }}
                        >
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              setLegendDragIndex(idx);
                              setLegendDragOverIndex(idx);
                              e.dataTransfer.setData("text/plain", `${idx}`);
                              startRowDrag(e, `settings_legend_${idx}`, row.name, row.color);
                            }}
                            onDragEnd={() => {
                              setLegendDragIndex(null);
                              setLegendDragOverIndex(null);
                              endRowDrag();
                            }}
                            className={gripClass}
                            title="Drag to reorder"
                          >
                            <GripVertical size={15} />
                          </button>
                          <ColorCircle value={row.color || "#2A7A3B"} onChange={(hex) => setDashboardLegend((prev) => prev.map((v, i) => (i === idx ? { ...v, color: hex } : v)))} />
                          <input
                            value={row.name}
                            placeholder="Legend name"
                            onChange={(e) => setDashboardLegend((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))}
                            className={gridCellInputClass}
                          />
                          <button type="button" onClick={() => setDashboardLegend((prev) => prev.filter((_, i) => i !== idx))} className={dangerIconButtonClass} title="Remove">
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                      <button type="button" onClick={() => setDashboardLegend((prev) => [...prev, { id: `legend_${prev.length + 1}`, name: "", color: form.themeColor || "#2A7A3B" }])} className={`${secondaryButtonClass} mt-1.5`}>
                        <Plus size={14} /> Add legend item
                      </button>
                    </div>
                  </Panel>
                  <Panel title="Tags" icon={Tags} description="Tags you can put on projects. The number is how many projects use each one.">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {projectTagUsage.map((row, idx) => (
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
                                setProjectTagUsage((prev) => prev.filter((_, i) => i !== idx));
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
                    <div className="fixed inset-0 z-[1700] flex items-center justify-center px-4 py-4">
                      <button
                        type="button"
                        aria-label="Close delete tag popup"
                        onClick={() => setPendingTagDelete(null)}
                        className="glass-modal-backdrop absolute inset-0"
                      />
                      <div ref={tagDeletePanelRef} className="glass-modal-panel relative z-[1701] flex w-full max-w-[440px] flex-col overflow-hidden">
                        <div className="glass-modal-header flex items-center justify-between px-4 py-3">
                          <p className="text-[13px] font-extrabold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>
                            Delete tag?
                          </p>
                          <button type="button" onClick={() => setPendingTagDelete(null)} className={dangerIconButtonClass} aria-label="Close">
                            <X size={16} />
                          </button>
                        </div>
                        <div className="space-y-2 px-4 py-4">
                          <p className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                            {pendingTagDelete.count > 0
                              ? `“${pendingTagDelete.value}” is on ${pendingTagDelete.count} ${pendingTagDelete.count === 1 ? "project" : "projects"}. Deleting it takes it off ${pendingTagDelete.count === 1 ? "that project" : "all of them"}, including archived ones.`
                              : `“${pendingTagDelete.value}” isn't on any projects.`}
                          </p>
                          {pendingTagDelete.count > 0 ? (
                            <p className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                              The projects themselves stay as they are — only the tag is removed. This can&apos;t be undone (adding the tag again won&apos;t put it back on them).
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
                              // Matched by position and name, in case the list changed while this was open.
                              setProjectTagUsage((prev) => prev.filter((row, i) => !(i === target.index && row.value.trim() === target.value)));
                              // Saved straight away — that's when it comes off the projects (see save()).
                              triggerToggleAutosave();
                            }}
                            className="inline-flex h-9 items-center justify-center rounded-[10px] border px-4 text-[12px] font-medium text-white transition hover:brightness-95"
                            style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
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
                            onClick={() => setCalendarCategories((prev) => prev.filter((_, i) => i !== idx))}
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
                    <div className="fixed inset-0 z-[1750] flex items-center justify-center px-4 py-4">
                      <button type="button" aria-label="Close category access" onClick={() => setCalendarAccessIndex(null)} className="glass-modal-backdrop absolute inset-0" />
                      <div ref={calendarAccessPanelRef} role="dialog" className="glass-modal-panel relative z-[1751] flex max-h-[calc(100svh-32px)] w-full max-w-[560px] flex-col overflow-hidden">
                        <div className="glass-modal-header flex items-center gap-2.5 px-4 py-3">
                          <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: activeCalendarCategory.color || "#7D99B3" }} />
                          <p className="min-w-0 flex-1 truncate text-[15px] font-semibold" style={{ color: "var(--text-main)" }}>
                            {activeCalendarCategory.name || "Untitled category"} access
                          </p>
                          <button type="button" onClick={() => setCalendarAccessIndex(null)} className={dangerIconButtonClass} aria-label="Close">
                            <X size={16} />
                          </button>
                        </div>
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
                  ) : null}
                </div>
              )}

              {active === "sales" && (
                <div className="grid gap-[18px] max-lg:grid-cols-1 xl:grid-cols-2">
                  <Panel title="Lead form" icon={FileInput} description="Your public enquiry form. Submissions land in Leads.">
                    <FieldRow label="Public form URL">
                      <input value={salesLeadFormUrl} onChange={(e) => setSalesLeadFormUrl(e.target.value)} placeholder="https://..." className={fieldInputClass} />
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
                  {shouldRenderItemCategoriesModal ? (
                    <div className="fixed inset-0 z-[1750] flex items-center justify-center px-4 py-4">
                      <button
                        type="button"
                        aria-label="Close item categories"
                        onClick={() => setIsItemCategoriesModalOpen(false)}
                        className="glass-modal-backdrop absolute inset-0"
                      />
                      <div ref={itemCategoriesModalPanelRef} className="glass-modal-panel relative z-[1751] flex h-[min(760px,calc(100svh-32px))] w-full max-w-[1080px] flex-col overflow-hidden">
                        <div className="glass-modal-header flex items-center justify-between px-4 py-3">
                          <p className="text-[13px] font-extrabold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>Item categories</p>
                          <button type="button" onClick={() => setIsItemCategoriesModalOpen(false)} className={dangerIconButtonClass} aria-label="Close">
                            <X size={16} />
                          </button>
                        </div>
                        <div className="flex-1 overflow-y-auto max-lg:overflow-x-auto">
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
                                  <button type="button" onClick={() => setItemCategories((prev) => prev.filter((_, i) => i !== idx))} className={dangerIconButtonClass} title="Remove category"><X size={15} /></button>
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
                                      className="grid grid-cols-[30px_1fr_2.2fr_130px_110px_100px_110px] items-center gap-2 border-b px-4 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.6px]"
                                      style={{ borderColor: "var(--glass-border)", color: "var(--text-muted)" }}
                                    >
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
                                          className={`grid grid-cols-[30px_1fr_2.2fr_130px_110px_100px_110px] items-center gap-2 px-4 py-1.5 ${isLastItem ? "" : "border-b"}`}
                                          style={{ borderColor: "var(--glass-border)" }}
                                        >
                                          <button
                                            type="button"
                                            onClick={() => removeItemCategoryItem(idx, itemIdx)}
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
                                          <input
                                            value={itemRow.price}
                                            onChange={(e) => updateItemCategoryItem(idx, itemIdx, { price: e.target.value })}
                                            onBlur={(e) => updateItemCategoryItem(idx, itemIdx, { price: ensureDollarFormat(e.target.value) })}
                                            className={gridCellInputClass}
                                            placeholder={formatMoney(0, companyCurrency)}
                                          />
                                          <input
                                            value={itemRow.markupPercent}
                                            onChange={(e) => updateItemCategoryItem(idx, itemIdx, { markupPercent: e.target.value })}
                                            className={gridCellInputClass}
                                            placeholder="0"
                                          />
                                          <p className="truncate px-2 text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                                            {computeOutputPrice(itemRow.price, itemRow.markupPercent)}
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
                            <button type="button" onClick={() => setItemCategories((prev) => [...prev, { name: "", color: "#7D99B3", subcategories: "", items: [] }])} className={secondaryButtonClass}><Plus size={14} /> Add category</button>
                          </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-[var(--glass-border)] px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setIsItemCategoriesModalOpen(false)}
                            className={primaryButtonClass}
                            style={primaryButtonStyle}
                          >
                            Done
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {isSpecsLayoutModalOpen ? (
                    <div data-specs-layout-modal="true" className="fixed inset-0 z-[1000] flex flex-col bg-[var(--bg-app)]">
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
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-bold transition hover:brightness-95"
                            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                          >
                            <Download size={14} />
                            <span className="max-sm:sr-only">Download</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => specsTemplateFileInputRef.current?.click()}
                            title="Upload a template JSON file exported from another company"
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-bold transition hover:brightness-95"
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
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-bold transition hover:brightness-95"
                            style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
                          >
                            <RotateCcw size={14} />
                            <span className="max-sm:sr-only">Reset</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsSpecsLayoutModalOpen(false)}
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-bold transition hover:brightness-95"
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
                    <div className="fixed inset-0 z-[1010] flex items-center justify-center px-4 py-4">
                      <button
                        type="button"
                        aria-label="Close reset confirmation backdrop"
                        onClick={() => setIsSpecsTemplateResetConfirmOpen(false)}
                        className="glass-modal-backdrop absolute inset-0"
                      />
                      <div ref={specsTemplateResetConfirmPanelRef} className="glass-modal-panel relative w-[min(420px,96vw)] overflow-hidden">
                        <div className="glass-modal-header px-5 py-4">
                          <p className="text-[14px] font-bold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>Reset Template</p>
                        </div>
                        <div className="space-y-4 px-5 py-4">
                          <p className="text-[12px]" style={{ color: "var(--text-main)" }}>
                            This will permanently clear the entire specs template — every cell, row, column, and formatting choice. This can&apos;t be undone.
                          </p>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setIsSpecsTemplateResetConfirmOpen(false)}
                              className="h-9 rounded-[9px] border px-4 text-[12px] font-bold hover:brightness-95"
                              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={resetSpecsTemplate}
                              className="h-9 rounded-[9px] border px-4 text-[12px] font-bold text-white hover:brightness-95"
                              style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                            >
                              Reset Template
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {isQuoteLayoutModalOpen ? (
                    <div data-quote-layout-modal="true" className="fixed inset-0 z-[1000] flex flex-col bg-[var(--bg-app)]">
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
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-bold transition hover:brightness-95"
                            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                          >
                            <Download size={14} />
                            <span className="max-sm:sr-only">Download</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => quoteTemplateFileInputRef.current?.click()}
                            title="Upload a template JSON file exported from another company"
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-bold transition hover:brightness-95"
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
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-bold transition hover:brightness-95"
                            style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
                          >
                            <RotateCcw size={14} />
                            <span className="max-sm:sr-only">Reset</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsQuoteLayoutModalOpen(false)}
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-bold transition hover:brightness-95"
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
                    <div className="fixed inset-0 z-[1010] flex items-center justify-center px-4 py-4">
                      <button
                        type="button"
                        aria-label="Close reset confirmation backdrop"
                        onClick={() => setIsQuoteTemplateResetConfirmOpen(false)}
                        className="glass-modal-backdrop absolute inset-0"
                      />
                      <div ref={quoteTemplateResetConfirmPanelRef} className="glass-modal-panel relative w-[min(420px,96vw)] overflow-hidden">
                        <div className="glass-modal-header px-5 py-4">
                          <p className="text-[14px] font-bold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>Reset Template</p>
                        </div>
                        <div className="space-y-4 px-5 py-4">
                          <p className="text-[12px]" style={{ color: "var(--text-main)" }}>
                            This will permanently clear the entire quote template — every cell, row, column, and formatting choice. This can&apos;t be undone.
                          </p>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setIsQuoteTemplateResetConfirmOpen(false)}
                              className="h-9 rounded-[9px] border px-4 text-[12px] font-bold hover:brightness-95"
                              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={resetQuoteTemplate}
                              className="h-9 rounded-[9px] border px-4 text-[12px] font-bold text-white hover:brightness-95"
                              style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                            >
                              Reset Template
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <Panel className="xl:col-span-2" title="Products" icon={Box} description="Your products (job types), their type and per-sheet pricing. Drag to set the order they appear in." allowOverflow>
                    <div className="space-y-1.5">
                      {jobTypes.map((row, idx) => (
                        <div key={idx}>
                          <div
                            id={`settings_product_${idx}`}
                            className={`${listRowClass} flex-wrap`}
                            style={{ opacity: jobTypeDragIndex === idx ? 0.45 : 1 }}
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
                            <button
                              type="button"
                              draggable
                              onDragStart={(e) => {
                                setJobTypeDragIndex(idx);
                                setJobTypeDragOverIndex(idx);
                                e.dataTransfer.setData("text/plain", `jobtype_${idx}`);
                                startRowDrag(e, `settings_product_${idx}`, row.name, "#7D99B3");
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
                            <input
                              value={row.name}
                              placeholder="Product name"
                              onChange={(e) => setJobTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))}
                              className={`${gridCellInputClass} min-w-[160px] flex-1`}
                            />
                            <span className="w-[170px] shrink-0">
                              <GlassDropdown
                                value={row.type}
                                options={[
                                  { value: "", label: "No type" },
                                  { value: "grain", label: "Grain" },
                                  { value: "lacquer-1", label: "Lacquer (1 side)" },
                                  { value: "lacquer-2", label: "Lacquer (2 side)" },
                                  { value: "melteca", label: "Melteca" },
                                ]}
                                onChange={(next) => setJobTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, type: next as JobTypeProductType } : v)))}
                                ariaLabel="Product type"
                                triggerClassName={`${glassFieldSmClass} justify-between`}
                              />
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleJobTypeExpanded(idx)}
                              className={`${countPillClass} gap-1 transition hover:brightness-95`}
                              title="Sheet sizes & prices"
                            >
                              {row.sheetPrices?.length || 0} sheet size{(row.sheetPrices?.length || 0) === 1 ? "" : "s"}
                              <ChevronDown size={12} style={{ transform: jobTypeExpanded[idx] ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms ease" }} />
                            </button>
                            <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                              In sales
                              <GlassSwitch size="sm" checked={row.showInSales} onChange={(on) => setJobTypes((prev) => prev.map((v, i) => (i === idx ? { ...v, showInSales: on } : v)))} ariaLabel="Include in sales" />
                            </span>
                            <button type="button" onClick={() => setJobTypes((prev) => prev.filter((_, i) => i !== idx))} className={dangerIconButtonClass} title="Remove product">
                              <X size={15} />
                            </button>
                          </div>
                          {jobTypeExpanded[idx] && (
                            <div className="my-1.5 ml-8 grid gap-1.5 rounded-[12px] border border-dashed p-2.5 max-sm:ml-3" style={{ borderColor: "color-mix(in srgb, var(--text-main) 16%, transparent)" }}>
                              {(row.sheetPrices ?? []).map((sp, spIdx) => (
                                <div key={`${idx}_sheetprice_${spIdx}`} className={`${listRowClass} max-lg:flex-wrap`}>
                                  <span className="w-[200px] shrink-0 max-sm:w-full">
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
                                  </span>
                                  <input
                                    value={sp.pricePerSheet}
                                    onChange={(e) => updateJobTypeSheetPrice(idx, spIdx, { pricePerSheet: e.target.value })}
                                    onBlur={(e) => updateJobTypeSheetPrice(idx, spIdx, { pricePerSheet: ensureDollarFormat(e.target.value) })}
                                    className={`${glassFieldSmClass} w-[120px]`}
                                    placeholder={formatMoney(0, companyCurrency)}
                                  />
                                  <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>per sheet</span>
                                  <span className="flex-1" />
                                  <button type="button" onClick={() => removeJobTypeSheetPrice(idx, spIdx)} className={dangerIconButtonClass} title="Remove sheet size">
                                    <X size={15} />
                                  </button>
                                </div>
                              ))}
                              <div>
                                <button type="button" onClick={() => addJobTypeSheetPrice(idx)} className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: "var(--brand-strong)" }}>
                                  <Plus size={14} /> Add sheet size
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setJobTypes((prev) => [
                            ...prev,
                            {
                              name: "",
                              sheetPrices: [{ sheetSize: defaultSheetSizeValue(sheetSizes), pricePerSheet: ensureDollarFormat("0") }],
                              showInSales: true,
                              type: "",
                            },
                          ])
                        }
                        className={`${secondaryButtonClass} mt-1.5`}
                      >
                        <Plus size={14} /> Add product
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
                            <input
                              key={field}
                              value={row[field]}
                              placeholder={formatMoney(0, companyCurrency)}
                              onChange={(e) => setDiscountTiers((prev) => prev.map((v, i) => (i === idx ? { ...v, [field]: e.target.value } : v)))}
                              onBlur={(e) => setDiscountTiers((prev) => prev.map((v, i) => (i === idx ? { ...v, [field]: formatDiscountCurrency(e.target.value) } : v)))}
                              className={`${glassFieldSmClass} min-w-0 flex-1`}
                            />
                          ))}
                          <button type="button" onClick={() => setDiscountTiers((prev) => prev.filter((_, i) => i !== idx))} className={dangerIconButtonClass} title="Remove tier">
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
                <Panel title="Hardware brands" icon={HardHat} description="Each brand's drawers, hinges and other parts. The default brand is used for new jobs. Drag to reorder.">
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
                          onClick={() => setHardware((prev) => sanitizeHardwareRows(prev.filter((_, i) => i !== idx)))}
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
                                  { name: "", bottoms: { widthMinus: "", depthMinus: "" }, backs: { widthMinus: "" }, hardwareLengths: [], spaceRequirement: "", default: items.length === 0 },
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
                                    <div className="flex items-center gap-2">
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
                                        className={`${gridCellInputClass} min-w-0 flex-1 font-semibold`}
                                      />
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
                                        onClick={() => updateHardwareJsonList(idx, "drawersJson", (items) => items.filter((_, i) => i !== drawerIdx))}
                                        className={dangerIconButtonClass}
                                        title="Remove drawer"
                                      >
                                        <X size={15} />
                                      </button>
                                    </div>
                                    {isExpanded && (
                                      <div className="space-y-2.5 px-2 pb-1.5 pl-9 max-sm:pl-2">
                                        <div className="flex items-center gap-2 text-[12px] max-lg:flex-wrap">
                                          <p className="w-[70px] font-semibold text-[var(--text-main)]">Bottoms</p>
                                          <span className="text-[var(--text-muted)]">Width</span>
                                          <input
                                            value={readDrawerBottomWidth(drawer)}
                                            onChange={(e) =>
                                              updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "bottomWidth", e.target.value) : v)),
                                              )
                                            }
                                            className={`${glassFieldSmClass} w-[90px]`}
                                          />
                                          <span className="text-[var(--text-muted)]">Depth</span>
                                          <input
                                            value={readDrawerBottomDepth(drawer)}
                                            onChange={(e) =>
                                              updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "bottomDepth", e.target.value) : v)),
                                              )
                                            }
                                            className={`${glassFieldSmClass} w-[90px]`}
                                          />
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2 text-[12px]">
                                          <p className="w-[70px] font-semibold text-[var(--text-main)]">Backs</p>
                                          <span className="text-[var(--text-muted)]">Width</span>
                                          <input
                                            value={readDrawerBackWidth(drawer)}
                                            onChange={(e) =>
                                              updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "backWidth", e.target.value) : v)),
                                              )
                                            }
                                            className={`${glassFieldSmClass} w-[90px]`}
                                          />
                                          <span className="ml-2 text-[var(--text-muted)]">Heights</span>
                                          <button
                                            type="button"
                                            onClick={() => toggleDrawerHeightsExpanded(idx, drawerIdx)}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]"
                                            style={{ color: "var(--text-muted)" }}
                                            title={(drawerHeightsExpanded[`${idx}:${drawerIdx}:heights`] ?? false) ? "Hide heights" : "Edit heights"}
                                          >
                                            <ChevronDown
                                              size={15}
                                              style={{ transform: (drawerHeightsExpanded[`${idx}:${drawerIdx}:heights`] ?? false) ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms ease" }}
                                            />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              const next = await ask.prompt({ title: "Add back height", label: "Back height", placeholder: "e.g. M 500" });
                                              const value = toStr(next);
                                              if (!value) return;
                                              const current = readDrawerBackHeights(drawer);
                                              updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "backHeights", [...current, value]) : v)),
                                              );
                                            }}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-[color-mix(in_srgb,var(--text-main)_22%,transparent)] text-[var(--brand-strong)] transition hover:bg-[var(--brand-soft)]"
                                            title="Add back height"
                                          >
                                            <Plus size={14} />
                                          </button>
                                          {(() => {
                                            const heightRows = readDrawerBackHeights(drawer);
                                            const heightsOpen = drawerHeightsExpanded[`${idx}:${drawerIdx}:heights`] ?? false;
                                            if (!heightsOpen) {
                                              return (
                                                <div className="flex flex-wrap items-center gap-1">
                                                  {heightRows.map((height, hIdx) => (
                                                    <span
                                                      key={`${drawerIdx}_height_chip_${hIdx}`}
                                                      className="inline-flex h-6 min-w-[28px] items-center justify-center rounded-[999px] border border-[var(--glass-border)] bg-[var(--panel-bg)] px-2 text-[11px] font-semibold text-[var(--text-main)]"
                                                      title={height}
                                                    >
                                                      {readDrawerHeightLabel(height)}
                                                    </span>
                                                  ))}
                                                  {heightRows.length === 0 && (
                                                    <span className="text-[11px] text-[var(--text-muted)]">No heights</span>
                                                  )}
                                                </div>
                                              );
                                            }
                                            const firstHeight = heightRows[0];
                                            const remainingHeights = heightRows.slice(1);
                                            if (!firstHeight) {
                                              return (
                                                <div className="self-start">
                                                  <span className="text-[11px] text-[var(--text-muted)]">No heights</span>
                                                </div>
                                              );
                                            }
                                            return (
                                              <div className="self-start">
                                                <div className="flex items-center gap-1">
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      const current = readDrawerBackHeights(drawer);
                                                      const nextHeights = current.filter((_, j) => j !== 0);
                                                      updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                        items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "backHeights", nextHeights) : v)),
                                                      );
                                                    }}
                                                    className={dangerIconButtonClass}
                                                  >
                                                    <X size={13} />
                                                  </button>
                                                  <input
                                                    value={readDrawerHeightLabel(firstHeight)}
                                                    onChange={(e) => {
                                                      const current = readDrawerBackHeights(drawer);
                                                      const hiddenNumber = readDrawerHeightNumber(current[0] ?? "");
                                                      const nextValue = hiddenNumber ? `${e.target.value} ${hiddenNumber}` : e.target.value;
                                                      const nextHeights = current.map((v, j) => (j === 0 ? nextValue : v));
                                                      updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                        items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "backHeights", nextHeights) : v)),
                                                      );
                                                    }}
                                                    className={`${glassFieldSmClass} w-[92px]`}
                                                    title={firstHeight}
                                                  />
                                                  <span className="inline-flex h-7 min-w-[56px] items-center justify-center rounded-[999px] border border-[var(--glass-border)] bg-[var(--panel-bg)] px-2 text-[11px] font-semibold text-[var(--text-main)]">
                                                    {readDrawerHeightNumber(firstHeight) || "-"}
                                                  </span>
                                                </div>
                                                {remainingHeights.length > 0 && (
                                                  <div className="mt-1 space-y-1">
                                                    {remainingHeights.map((height, offsetIdx) => {
                                                      const hIdx = offsetIdx + 1;
                                                      return (
                                                        <div key={`${drawerIdx}_height_${hIdx}`} className="flex items-center gap-1">
                                                          <button
                                                            type="button"
                                                            onClick={() => {
                                                              const current = readDrawerBackHeights(drawer);
                                                              const nextHeights = current.filter((_, j) => j !== hIdx);
                                                              updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                                items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "backHeights", nextHeights) : v)),
                                                              );
                                                            }}
                                                            className={dangerIconButtonClass}
                                                          >
                                                            <X size={13} />
                                                          </button>
                                                          <input
                                                            value={readDrawerHeightLabel(height)}
                                                            onChange={(e) => {
                                                              const current = readDrawerBackHeights(drawer);
                                                              const hiddenNumber = readDrawerHeightNumber(current[hIdx] ?? "");
                                                              const nextValue = hiddenNumber ? `${e.target.value} ${hiddenNumber}` : e.target.value;
                                                              const nextHeights = current.map((v, j) => (j === hIdx ? nextValue : v));
                                                              updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                                items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "backHeights", nextHeights) : v)),
                                                              );
                                                            }}
                                                            className={`${glassFieldSmClass} w-[92px]`}
                                                            title={height}
                                                          />
                                                          <span className="inline-flex h-7 min-w-[56px] items-center justify-center rounded-[999px] border border-[var(--glass-border)] bg-[var(--panel-bg)] px-2 text-[11px] font-semibold text-[var(--text-main)]">
                                                            {readDrawerHeightNumber(height) || "-"}
                                                          </span>
                                                        </div>
                                                      );
                                                    })}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })()}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2 text-[12px]">
                                          <p className="w-[120px] font-semibold text-[var(--text-main)]">Hardware lengths</p>
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              const next = await ask.prompt({ title: "Add hardware length", label: "Length", placeholder: "e.g. 500", inputMode: "decimal" });
                                              const value = toStr(next);
                                              if (!value) return;
                                              const current = readDrawerLengths(drawer);
                                              updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "hardwareLengths", [...current, value]) : v)),
                                              );
                                            }}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-[color-mix(in_srgb,var(--text-main)_22%,transparent)] text-[var(--brand-strong)] transition hover:bg-[var(--brand-soft)]"
                                            title="Add hardware length"
                                          >
                                            <Plus size={14} />
                                          </button>
                                          <div className="flex flex-wrap items-center gap-2">
                                            {readDrawerLengths(drawer).map((length, lIdx) => (
                                              <div key={`${drawerIdx}_length_${lIdx}`} className="inline-flex items-center gap-1">
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const current = readDrawerLengths(drawer);
                                                    const nextLengths = current.filter((_, j) => j !== lIdx);
                                                    updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                      items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "hardwareLengths", nextLengths) : v)),
                                                    );
                                                  }}
                                                  className={dangerIconButtonClass}
                                                >
                                                  <X size={13} />
                                                </button>
                                                <input
                                                  value={length}
                                                  onChange={(e) => {
                                                    const current = readDrawerLengths(drawer);
                                                    const nextLengths = current.map((v, j) => (j === lIdx ? e.target.value : v));
                                                    updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                      items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "hardwareLengths", nextLengths) : v)),
                                                    );
                                                  }}
                                                  className={`${glassFieldSmClass} w-[90px]`}
                                                />
                                              </div>
                                            ))}
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-2 text-[12px] max-lg:flex-wrap">
                                          <p className="w-[120px] font-semibold text-[var(--text-main)]">Depth requirement</p>
                                          <input
                                            value={readDrawerSpaceRequirement(drawer)}
                                            onChange={(e) =>
                                              updateHardwareJsonList(idx, "drawersJson", (items) =>
                                                items.map((v, i) => (i === drawerIdx ? writeDrawerField(v, "spaceRequirement", e.target.value) : v)),
                                              )
                                            }
                                            className={`${glassFieldSmClass} w-[120px]`}
                                          />
                                        </div>
                                      </div>
                                    )}
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
                                    onClick={() => updateHardwareJsonList(idx, "hingesJson", (items) => items.filter((_, i) => i !== hingeIdx))}
                                    className={dangerIconButtonClass}
                                  >
                                    <X size={15} />
                                  </button>
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
                                    onClick={() => updateHardwareJsonList(idx, "otherJson", (items) => items.filter((_, i) => i !== otherIdx))}
                                    className={dangerIconButtonClass}
                                  >
                                    <X size={15} />
                                  </button>
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
                                </div>
                              ))}
                            </div>
                          </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const nextIndex = hardware.length;
                        setHardware((prev) => sanitizeHardwareRows([...prev, { name: "", color: "#7D99B3", default: prev.length === 0, drawersJson: "[]", hingesJson: "[]", otherJson: "[]" }]));
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
  dashboardCompleteLegend: dashboardLegend,
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
          <div className="fixed inset-0 z-[1750] flex items-center justify-center px-4 py-4">
            <button type="button" aria-label="Close" onClick={() => setShowZapierHelp(false)} className="glass-modal-backdrop absolute inset-0" />
            <div ref={zapierHelpPanelRef} className="glass-modal-panel relative z-[1751] flex max-h-[calc(100svh-32px)] w-full max-w-[640px] flex-col overflow-hidden">
              <div className="glass-modal-header flex items-center gap-3 px-4 py-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#FF5A1F]">
                  <img src="/logos/Zapier-logo.png" alt="Zapier" className="h-5 w-5 object-contain" />
                </span>
                <p className="flex-1 text-[13px] font-extrabold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>Connect Zapier leads</p>
                <button type="button" onClick={() => setShowZapierHelp(false)} className={dangerIconButtonClass} aria-label="Close">
                  <X size={16} />
                </button>
              </div>
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
        ) : null}
        {shouldRenderLeadFieldsCustomize ? (
          <div className="fixed inset-0 z-[1750] flex items-center justify-center px-4 py-4">
            <button type="button" aria-label="Close" onClick={() => setShowLeadFieldsCustomize(false)} className="glass-modal-backdrop absolute inset-0" />
            <div ref={leadFieldsPanelRef} className="glass-modal-panel relative z-[1751] flex h-[min(760px,calc(100svh-32px))] w-full max-w-[860px] flex-col overflow-hidden">
              <div className="glass-modal-header flex items-center justify-between px-4 py-3">
                <p className="text-[13px] font-extrabold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>Customise lead fields</p>
                <button type="button" onClick={() => setShowLeadFieldsCustomize(false)} className={dangerIconButtonClass} aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                <div className="flex gap-2.5 rounded-[12px] px-3 py-2.5 text-[12px] leading-[1.5]" style={{ backgroundColor: "color-mix(in srgb, var(--text-main) 4%, transparent)", color: "var(--text-muted)" }}>
                  <Lightbulb size={15} className="mt-0.5 shrink-0" style={{ color: "var(--brand)" }} />
                  <p>
                    Drag to reorder — the order controls both the compact lead row and the expanded details. <strong style={{ color: "var(--text-main)" }}>Use for</strong>{" "}
                    tells CutSmart which field fills the client name, phone, email, address or notes when a lead becomes a project.
                  </p>
                </div>
                {leadFieldsLoading ? (
                  <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>Loading fields...</p>
                ) : mergedLeadFieldLayout.length === 0 ? (
                  <p className="rounded-[12px] border border-dashed px-3 py-4 text-[12.5px]" style={{ borderColor: "color-mix(in srgb, var(--text-main) 16%, transparent)", color: "var(--text-muted)" }}>
                    No lead fields yet. Submit at least one Zapier lead and its fields will appear here.
                  </p>
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
        ) : null}
        <DragGhostLayer controller={rowDragGhost} />
        {ask.element}
    </>
  );
}
